import asyncio
import json
import logging
import re
from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import AppError, LlmUnavailableError
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
    except AppError as exc:
        logger.warning("episode %d: repair call failed (%s), dropping %d scenes", episode, exc.code, len(failing))
        return [None] * len(failing)
    if len(fixes.scenes) != len(failing):
        logger.warning("episode %d: repair returned %d scenes for %d", episode, len(fixes.scenes), len(failing))
        return [None] * len(failing)
    source = GroundedSource(fragment)
    rechecked = [check_scene(scene, source) for scene in fixes.scenes]
    return [check.scene if not check.problems else None for check in rechecked]


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


async def write_script(
    source_text: str, language: Language, episode_count: int, template: TemplateId | None
) -> CourseScript:
    fragments = split_source(source_text, episode_count)
    system = SYSTEM_PROMPT.substitute(
        language_name=LANGUAGE_NAMES[language], scenes_min=SCENES_MIN, scenes_max=SCENES_MAX
    )
    try:
        async with asyncio.TaskGroup() as group:
            tasks = [
                group.create_task(write_episode(system, fragment, index, len(fragments)))
                for index, fragment in enumerate(fragments)
            ]
    except* AppError as failures:
        raise failures.exceptions[0] from None
    drafts = [draft for draft in (task.result() for task in tasks) if draft is not None]
    if not drafts:
        raise LlmUnavailableError("The AI could not write a lesson grounded in this text. Try again.")
    episodes = [
        EpisodeScript(title=draft.title, template=template or DEFAULT_TEMPLATE, scenes=draft.scenes) for draft in drafts
    ]
    return CourseScript(course_title=drafts[0].course_title, language=language, episodes=episodes)
