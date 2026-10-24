import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

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
    Picture,
    PlanEvent,
    Scene,
    SceneEvent,
)
from app.schemas.script import CourseScript, ScriptScene
from app.services.cast import character_for, course_seed, pick_background, pick_cast
from app.services.narrator import Narration, narrate
from app.services.pictures import find_picture
from app.services.script_writer import SCENES_MAX, EpisodeReady, write_script

logger = logging.getLogger(__name__)

SCRIPT_DEADLINE_S = 40
# Vercel stops the function at 60 s; ending earlier leaves room to send the error event.
STREAM_BUDGET_S = 55
MEDIA_CONCURRENCY = 4


@dataclass(frozen=True)
class SceneMedia:
    narration: Narration
    picture: Picture | None


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
            cast=pick_cast(seed, episode.number),
            background=pick_background(seed, episode.number, episode.template),
        )
        for index, episode in enumerate(script.episodes)
    ]
    return PlanEvent(type="plan", course_title=script.course_title, language=script.language, episodes=outlines)


async def fetch_media(
    scene: ScriptScene, label: str, character: CharacterId, language: Language, limiter: asyncio.Semaphore
) -> SceneMedia:
    async with limiter:
        started = time.perf_counter()
        async with asyncio.TaskGroup() as group:
            voice = group.create_task(narrate(scene.text, character, language))
            picture = group.create_task(find_picture(scene.picture_query))
        logger.info("%s voice and picture after %d ms", label, elapsed_ms(started))
    return SceneMedia(narration=voice.result(), picture=picture.result())


def scene_from(scene: ScriptScene, scene_id: str, media: SceneMedia) -> Scene:
    return Scene(
        id=scene_id,
        speaker=scene.speaker,
        text=scene.text,
        highlight=scene.highlight,
        words=media.narration.words,
        words_estimated=media.narration.words_estimated,
        audio=media.narration.audio,
        picture=media.picture,
        formula=scene.formula,
        term=scene.term,
        rank=scene.rank,
        verdict=scene.verdict,
        reaction=scene.reaction,
        sfx=scene.sfx,
        source_quote=scene.source_quote,
    )


async def write_script_in_time(request: EpisodesRequest, on_ready: EpisodeReady) -> CourseScript:
    try:
        async with asyncio.timeout(SCRIPT_DEADLINE_S):
            return await write_script(
                request.source_text, request.language, request.episode_count, request.template, on_ready
            )
    except TimeoutError:
        raise LlmUnavailableError("Writing the lesson took too long. Try again.") from None


async def within_budget(task: asyncio.Task[SceneMedia], started: float) -> SceneMedia:
    remaining = STREAM_BUDGET_S - (time.perf_counter() - started)
    try:
        return await asyncio.wait_for(task, max(remaining, 0))
    except TimeoutError:
        raise LlmUnavailableError("Making the lesson took too long. Try again.") from None


async def stream_course(request: EpisodesRequest) -> AsyncIterator[str]:
    started = time.perf_counter()
    seed = course_seed(request.source_text)
    # Episode 0 gets its own slots so the first scene never queues behind later episodes.
    first_limiter = asyncio.Semaphore(SCENES_MAX)
    shared_limiter = asyncio.Semaphore(MEDIA_CONCURRENCY)
    media: dict[int, list[asyncio.Task[SceneMedia]]] = {}
    consumed: set[asyncio.Task[SceneMedia]] = set()

    def start_media(number: int, scenes: list[ScriptScene]) -> None:
        cast = pick_cast(seed, number)
        limiter = first_limiter if number == 0 else shared_limiter
        media[number] = [
            asyncio.create_task(
                fetch_media(scene, f"e{number}s{index}", character_for(cast, scene.speaker), request.language, limiter)
            )
            for index, scene in enumerate(scenes)
        ]
        logger.info("episode %d script ready after %d ms, voices started", number, elapsed_ms(started))

    try:
        script = await write_script_in_time(request, start_media)
        yield ndjson(plan_for(script, seed))
        for episode_index, episode in enumerate(script.episodes):
            for scene_index, (scene, task) in enumerate(zip(episode.scenes, media[episode.number], strict=True)):
                consumed.add(task)
                scene_media = await within_budget(task, started)
                if episode_index == 0 and scene_index == 0:
                    logger.info("first scene after %d ms", elapsed_ms(started))
                event_scene = scene_from(scene, f"e{episode_index}s{scene_index}", scene_media)
                yield ndjson(SceneEvent(type="scene", episode=episode_index, index=scene_index, scene=event_scene))
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
        for task in (task for tasks in media.values() for task in tasks):
            if task not in consumed and task.done() and not task.cancelled() and task.exception() is not None:
                logger.error("unsent scene media failed: %r", task.exception())
            task.cancel()
