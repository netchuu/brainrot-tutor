import asyncio
import logging
import time
from collections.abc import AsyncIterator

from pydantic import BaseModel

from app.errors import AppError, LlmUnavailableError
from app.schemas.contract import (
    CharacterId,
    DoneEvent,
    EpisodeDoneEvent,
    EpisodeOutline,
    EpisodesRequest,
    ErrorEvent,
    Language,
    PlanEvent,
    Scene,
    SceneEvent,
)
from app.schemas.script import CourseScript, ScriptScene
from app.services.cast import character_for, course_seed, pick_background, pick_cast
from app.services.narrator import narrate
from app.services.pictures import find_picture
from app.services.script_writer import write_script

logger = logging.getLogger(__name__)

SCRIPT_DEADLINE_S = 40
MEDIA_CONCURRENCY = 6


def ndjson(event: BaseModel) -> str:
    return event.model_dump_json() + "\n"


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def plan_for(script: CourseScript, seed: int) -> PlanEvent:
    outlines = [
        EpisodeOutline(
            index=index,
            title=episode.title,
            template=episode.template,
            scene_count=len(episode.scenes),
            cast=pick_cast(seed, index),
            background=pick_background(seed, index, episode.template),
        )
        for index, episode in enumerate(script.episodes)
    ]
    return PlanEvent(type="plan", course_title=script.course_title, language=script.language, episodes=outlines)


async def build_scene(
    scene: ScriptScene, scene_id: str, character: CharacterId, language: Language, limiter: asyncio.Semaphore
) -> Scene:
    async with limiter:
        narration, picture = await asyncio.gather(
            narrate(scene.text, character, language), find_picture(scene.picture_query)
        )
    return Scene(
        id=scene_id,
        speaker=scene.speaker,
        text=scene.text,
        highlight=scene.highlight,
        words=narration.words,
        words_estimated=narration.words_estimated,
        audio=narration.audio,
        picture=picture,
        formula=None,
        term=None,
        rank=None,
        verdict=None,
        reaction=scene.reaction,
        sfx=scene.sfx,
        source_quote=scene.source_quote,
    )


async def write_script_in_time(request: EpisodesRequest) -> CourseScript:
    try:
        async with asyncio.timeout(SCRIPT_DEADLINE_S):
            return await write_script(request.source_text, request.language, request.episode_count, request.template)
    except TimeoutError:
        raise LlmUnavailableError("Writing the lesson took too long. Try again.") from None


async def stream_course(request: EpisodesRequest) -> AsyncIterator[str]:
    started = time.perf_counter()
    tasks: list[asyncio.Task[Scene]] = []
    try:
        script = await write_script_in_time(request)
        logger.info("script ready after %d ms", elapsed_ms(started))
        plan = plan_for(script, course_seed(request.source_text))
        # The semaphore admits waiters in creation order, so episode 0 gets its voices and pictures first.
        limiter = asyncio.Semaphore(MEDIA_CONCURRENCY)
        episodes: list[list[asyncio.Task[Scene]]] = []
        for outline, episode in zip(plan.episodes, script.episodes, strict=True):
            episode_tasks = [
                asyncio.create_task(
                    build_scene(
                        scene,
                        f"e{outline.index}s{index}",
                        character_for(outline.cast, scene.speaker),
                        request.language,
                        limiter,
                    )
                )
                for index, scene in enumerate(episode.scenes)
            ]
            episodes.append(episode_tasks)
            tasks.extend(episode_tasks)
        yield ndjson(plan)
        for episode_index, episode_tasks in enumerate(episodes):
            for scene_index, task in enumerate(episode_tasks):
                scene = await task
                if episode_index == 0 and scene_index == 0:
                    logger.info("first scene after %d ms", elapsed_ms(started))
                yield ndjson(SceneEvent(type="scene", episode=episode_index, index=scene_index, scene=scene))
            yield ndjson(EpisodeDoneEvent(type="episode_done", episode=episode_index))
            logger.info("episode %d done after %d ms", episode_index, elapsed_ms(started))
        yield ndjson(DoneEvent(type="done", elapsed_ms=elapsed_ms(started)))
    except AppError as exc:
        logger.warning("episode stream ended with %s after %d ms", exc.code, elapsed_ms(started))
        yield ndjson(exc.to_event())
    except Exception:
        # Once streaming has started the status is already 200, so the contract's error event is the only signal left.
        logger.exception("episode stream failed after %d ms", elapsed_ms(started))
        message = "Something went wrong while making the lesson. Try again."
        yield ndjson(ErrorEvent(type="error", code="internal", message=message, retryable=False))
    finally:
        for task in tasks:
            task.cancel()
