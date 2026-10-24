import asyncio
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from string import Template
from typing import get_args

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import LlmUnavailableError, RateLimitedError
from app.schemas.contract import Language, TemplateId
from app.schemas.script import AiTemplate, CourseScript, EpisodeDraft, EpisodeScript, SceneFixes, ScriptScene
from app.services.cache import LruCache, cache_key
from app.services.grounding import SENTENCE_BREAK, GroundedSource, check_scene, defang, normalize, word_stems

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = Template((PROMPTS_DIR / "script.md").read_text(encoding="utf-8"))
EPISODE_PROMPT = Template((PROMPTS_DIR / "script_episode.md").read_text(encoding="utf-8"))
REPAIR_PROMPT = Template((PROMPTS_DIR / "script_repair.md").read_text(encoding="utf-8"))
LANGUAGE_NAMES: dict[Language, str] = {"ru": "Russian", "en": "English"}
SCENES_MIN = 4
SCENES_MAX = 6
AI_TEMPLATES: tuple[AiTemplate, ...] = get_args(AiTemplate)
CHOOSE_TEMPLATE = (
    "Choose the template that fits the SOURCE FRAGMENT best and put it in template: "
    "split_screen when it has a formula, a calculation or one central definition; "
    "fake_chat for a story, a process or cause and effect; parkour_duo otherwise. "
    "Only these three may be chosen."
)
MAX_TERM_CHARS = 80
SCRIPT_CACHE: LruCache[CourseScript] = LruCache(32)
MAX_FORMULA_CHARS = 200
TEX_DELIMITERS = re.compile(r"\$|\\[()\[\]]")
TEX_COMMAND = re.compile(r"\\[A-Za-z]+")
FORMULA_TOKEN = re.compile(r"[A-Za-z]+|\d+(?:[.,]\d+)*")
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


@dataclass(frozen=True)
class Repair:
    scenes: list[ScriptScene | None]
    provider_failed: bool


@dataclass(frozen=True)
class EpisodeOutcome:
    draft: EpisodeDraft | None
    degraded: bool


async def repair_scenes(
    system: str, fragment: str, episode: int, failing: list[tuple[ScriptScene, list[str]]]
) -> Repair:
    prompt = REPAIR_PROMPT.substitute(
        episode_number=episode + 1, count=len(failing), problems=describe_failures(failing), fragment=defang(fragment)
    )
    try:
        fixes = await generate_json(system, prompt, SceneFixes)
    except (RateLimitedError, LlmUnavailableError) as exc:
        logger.warning("episode %d: repair call failed (%s), dropping %d scenes", episode, exc.code, len(failing))
        return Repair(scenes=[None] * len(failing), provider_failed=True)
    if len(fixes.scenes) != len(failing):
        logger.warning("episode %d: repair returned %d scenes for %d", episode, len(fixes.scenes), len(failing))
        return Repair(scenes=[None] * len(failing), provider_failed=False)
    source = GroundedSource(fragment)
    repaired: list[ScriptScene | None] = []
    for (original, _), scene in zip(failing, fixes.scenes, strict=True):
        check = check_scene(scene, source)
        # A repair may not escape grounding by switching speaker or dropping a quote the line had.
        dodged = check.scene.speaker != original.speaker or (
            bool(original.source_quote) and check.scene.source_quote is None
        )
        repaired.append(None if check.problems or dodged else check.scene)
    return Repair(scenes=repaired, provider_failed=False)


async def write_episode(
    system: str, fragment: str, episode: int, episode_count: int, forced: TemplateId | None = None
) -> EpisodeOutcome:
    prompt = EPISODE_PROMPT.substitute(
        episode_number=episode + 1, episode_count=episode_count, fragment=defang(fragment)
    )
    draft = await generate_json(system, prompt, EpisodeDraft)
    source = GroundedSource(fragment)
    checks = [check_scene(scene, source) for scene in draft.scenes]
    scenes: list[ScriptScene | None] = [check.scene for check in checks]
    failing = [index for index, check in enumerate(checks) if check.problems]
    degraded = False
    if failing:
        logger.info("episode %d: %d of %d scenes failed grounding, repairing", episode, len(failing), len(checks))
        originals = [(draft.scenes[index], checks[index].problems) for index in failing]
        repair = await repair_scenes(system, fragment, episode, originals)
        degraded = repair.provider_failed
        for index, replacement in zip(failing, repair.scenes, strict=True):
            scenes[index] = replacement
    template = episode_template(draft, forced)
    kept = [fit_template(scene, template, fragment) for scene in scenes if scene is not None]
    if not kept:
        logger.warning("episode %d: no grounded scenes left, dropping the episode", episode)
        return EpisodeOutcome(draft=None, degraded=degraded)
    return EpisodeOutcome(draft=draft.model_copy(update={"scenes": kept, "template": template}), degraded=degraded)


def appears_in(token: str, text: str) -> bool:
    return re.search(rf"(?<![A-Za-z0-9]){re.escape(token)}(?![A-Za-z0-9])", text) is not None


def clean_formula(formula: str | None, grounding: str) -> str | None:
    cleaned = TEX_DELIMITERS.sub("", formula or "").strip()
    if not 0 < len(cleaned) <= MAX_FORMULA_CHARS:
        return None
    # Every number and variable must come from the fragment or the spoken line, so a copied example cannot slip in.
    tokens = FORMULA_TOKEN.findall(TEX_COMMAND.sub(" ", cleaned))
    return cleaned if all(appears_in(token, grounding) for token in tokens) else None


def clean_term(term: str | None, grounding: str) -> str | None:
    cleaned = normalize(term or "")
    if not 0 < len(cleaned) <= MAX_TERM_CHARS:
        return None
    return cleaned if word_stems(cleaned) & word_stems(grounding) else None


def fit_template(scene: ScriptScene, template: TemplateId, fragment: str) -> ScriptScene:
    # Slots belong to one template each; anything else the model filled in is cleared so the player never sees it.
    split_screen = template == "split_screen"
    formula_grounding = f"{fragment} {scene.text}"
    term_grounding = f"{scene.source_quote or ''} {scene.text}"
    return scene.model_copy(
        update={
            "formula": clean_formula(scene.formula, formula_grounding) if split_screen else None,
            "term": clean_term(scene.term, term_grounding) if split_screen else None,
            "rank": scene.rank if template == "top3_countdown" and scene.rank in (1, 2, 3) else None,
            "verdict": scene.verdict if template == "myth_or_fact" else None,
        }
    )


def episode_template(draft: EpisodeDraft, forced: TemplateId | None) -> TemplateId:
    if forced is not None:
        return forced
    return draft.template if draft.template in AI_TEMPLATES else "parkour_duo"


def template_rule(forced: TemplateId | None) -> str:
    if forced is None:
        return CHOOSE_TEMPLATE
    return f'The template is fixed: put "{forced}" in template and write every scene for it.'


EpisodeReady = Callable[[int, list[ScriptScene]], None]


async def attempt_episode(
    system: str, fragment: str, number: int, count: int, forced: TemplateId | None, on_ready: EpisodeReady | None
) -> EpisodeOutcome | RateLimitedError | LlmUnavailableError:
    try:
        outcome = await write_episode(system, fragment, number, count, forced)
    except (RateLimitedError, LlmUnavailableError) as exc:
        logger.warning("episode %d failed with %s, keeping the other episodes", number, exc.code)
        return exc
    if outcome.draft is not None and on_ready is not None:
        on_ready(number, outcome.draft.scenes)
    return outcome


async def write_script(
    source_text: str,
    language: Language,
    episode_count: int,
    template: TemplateId | None,
    on_ready: EpisodeReady | None = None,
) -> CourseScript:
    key = cache_key("script", source_text, language, episode_count, template)
    cached = SCRIPT_CACHE.get(key)
    if cached is not None:
        logger.info("script served from cache")
        for episode in cached.episodes:
            if on_ready is not None:
                on_ready(episode.number, episode.scenes)
        return cached
    fragments = split_source(source_text, episode_count)
    system = SYSTEM_PROMPT.substitute(
        language_name=LANGUAGE_NAMES[language],
        scenes_min=SCENES_MIN,
        scenes_max=SCENES_MAX,
        template_rule=template_rule(template),
    )
    async with asyncio.TaskGroup() as group:
        tasks = [
            group.create_task(attempt_episode(system, fragment, number, len(fragments), template, on_ready))
            for number, fragment in enumerate(fragments)
        ]
    results = [task.result() for task in tasks]
    drafts = [
        (number, result.draft)
        for number, result in enumerate(results)
        if isinstance(result, EpisodeOutcome) and result.draft is not None
    ]
    failures = [result for result in results if isinstance(result, RateLimitedError | LlmUnavailableError)]
    if not drafts:
        if failures:
            raise failures[0]
        raise LlmUnavailableError("The AI could not write a lesson grounded in this text. Try again.")
    episodes = [
        EpisodeScript(number=number, title=draft.title, template=draft.template, scenes=draft.scenes)
        for number, draft in drafts
    ]
    script = CourseScript(course_title=drafts[0][1].course_title, language=language, episodes=episodes)
    # A course shortened by a provider failure is not kept; the next request may get all of it.
    degraded = bool(failures) or any(isinstance(result, EpisodeOutcome) and result.degraded for result in results)
    if not degraded:
        SCRIPT_CACHE.put(key, script)
    return script
