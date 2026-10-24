import asyncio
import json
import logging
import re
from collections.abc import Callable
from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import LlmUnavailableError, RateLimitedError
from app.schemas.contract import Language, TemplateId
from app.schemas.script import CourseScript, EpisodeDraft, EpisodeScript, SceneFixes, ScriptScene
from app.services.grounding import SENTENCE_BREAK, GroundedSource, check_scene, normalize

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = Template((PROMPTS_DIR / "script.md").read_text(encoding="utf-8"))
EPISODE_PROMPT = Template((PROMPTS_DIR / "script_episode.md").read_text(encoding="utf-8"))
REPAIR_PROMPT = Template((PROMPTS_DIR / "script_repair.md").read_text(encoding="utf-8"))
LANGUAGE_NAMES: dict[Language, str] = {"ru": "Russian", "en": "English"}
SCENES_MIN = 4
SCENES_MAX = 6
DEFAULT_TEMPLATE: TemplateId = "parkour_duo"
PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


def group_units(units: list[str], parts: int) -> list[list[str]]:
    total = sum(len(unit) for unit in units)
    groups: list[list[str]] = []
    current: list[str] = []
    consumed = 0
    for index, unit in enumerate(units):
        current.append(unit)
        consumed += len(unit)
        parts_left = parts - len(groups) - 1
        units_left = len(units) - index - 1
        if parts_left and (consumed >= total * (len(groups) + 1) / parts or units_left == parts_left):
            groups.append(current)
            current = []
    groups.append(current)
    return groups


def split_source(source_text: str, parts: int) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in PARAGRAPH_BREAK.split(source_text) if paragraph.strip()]
    if len(paragraphs) >= parts:
        return ["\n\n".join(group) for group in group_units(paragraphs, parts)]
    sentences = [sentence for sentence in SENTENCE_BREAK.split(normalize(source_text)) if sentence]
    return [" ".join(group) for group in group_units(sentences, min(parts, len(sentences)))]


def describe_failures(failing: list[tuple[ScriptScene, list[str]]]) -> str:
    return "\n\n".join(
        f"Scene {number}: {json.dumps(scene.model_dump(), ensure_ascii=False)}\nProblems: {'; '.join(problems)}"
        for number, (scene, problems) in enumerate(failing, start=1)
    )


async def repair_scenes(
    system: str, fragment: str, episode: int, failing: list[tuple[ScriptScene, list[str]]]
) -> list[ScriptScene | None]:
    prompt = REPAIR_PROMPT.substitute(
        episode_number=episode + 1, count=len(failing), problems=describe_failures(failing), fragment=fragment
    )
    try:
        fixes = await generate_json(system, prompt, SceneFixes)
    except (RateLimitedError, LlmUnavailableError) as exc:
        logger.warning("episode %d: repair call failed (%s), dropping %d scenes", episode, exc.code, len(failing))
        return [None] * len(failing)
    if len(fixes.scenes) != len(failing):
        logger.warning("episode %d: repair returned %d scenes for %d", episode, len(fixes.scenes), len(failing))
        return [None] * len(failing)
    source = GroundedSource(fragment)
    repaired: list[ScriptScene | None] = []
    for (original, _), scene in zip(failing, fixes.scenes, strict=True):
        check = check_scene(scene, source)
        # A repair may not escape grounding by switching speaker or dropping a quote the line had.
        dodged = check.scene.speaker != original.speaker or (
            bool(original.source_quote) and check.scene.source_quote is None
        )
        repaired.append(None if check.problems or dodged else check.scene)
    return repaired


async def write_episode(system: str, fragment: str, episode: int, episode_count: int) -> EpisodeDraft | None:
    prompt = EPISODE_PROMPT.substitute(episode_number=episode + 1, episode_count=episode_count, fragment=fragment)
    draft = await generate_json(system, prompt, EpisodeDraft)
    source = GroundedSource(fragment)
    checks = [check_scene(scene, source) for scene in draft.scenes]
    scenes: list[ScriptScene | None] = [check.scene for check in checks]
    failing = [index for index, check in enumerate(checks) if check.problems]
    if failing:
        logger.info("episode %d: %d of %d scenes failed grounding, repairing", episode, len(failing), len(checks))
        originals = [(draft.scenes[index], checks[index].problems) for index in failing]
        replacements = await repair_scenes(system, fragment, episode, originals)
        for index, replacement in zip(failing, replacements, strict=True):
            scenes[index] = replacement
    kept = [scene for scene in scenes if scene is not None]
    if not kept:
        logger.warning("episode %d: no grounded scenes left, dropping the episode", episode)
        return None
    return draft.model_copy(update={"scenes": kept})


EpisodeReady = Callable[[int, list[ScriptScene]], None]


async def attempt_episode(
    system: str, fragment: str, number: int, count: int, on_ready: EpisodeReady | None
) -> EpisodeDraft | RateLimitedError | LlmUnavailableError | None:
    try:
        draft = await write_episode(system, fragment, number, count)
    except (RateLimitedError, LlmUnavailableError) as exc:
        logger.warning("episode %d failed with %s, keeping the other episodes", number, exc.code)
        return exc
    if draft is not None and on_ready is not None:
        on_ready(number, draft.scenes)
    return draft


async def write_script(
    source_text: str,
    language: Language,
    episode_count: int,
    template: TemplateId | None,
    on_ready: EpisodeReady | None = None,
) -> CourseScript:
    fragments = split_source(source_text, episode_count)
    system = SYSTEM_PROMPT.substitute(
        language_name=LANGUAGE_NAMES[language], scenes_min=SCENES_MIN, scenes_max=SCENES_MAX
    )
    async with asyncio.TaskGroup() as group:
        tasks = [
            group.create_task(attempt_episode(system, fragment, number, len(fragments), on_ready))
            for number, fragment in enumerate(fragments)
        ]
    results = [task.result() for task in tasks]
    episodes = [
        EpisodeScript(number=number, title=result.title, template=template or DEFAULT_TEMPLATE, scenes=result.scenes)
        for number, result in enumerate(results)
        if isinstance(result, EpisodeDraft)
    ]
    if not episodes:
        failures = [result for result in results if isinstance(result, RateLimitedError | LlmUnavailableError)]
        if failures:
            raise failures[0]
        raise LlmUnavailableError("The AI could not write a lesson grounded in this text. Try again.")
    course_title = next(result.course_title for result in results if isinstance(result, EpisodeDraft))
    return CourseScript(course_title=course_title, language=language, episodes=episodes)
