import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from app.config import get_settings
from app.errors import BadInputError, SourceTooLongError
from app.schemas.script import ScriptScene

MAX_TEXT_CHARS = 220
MIN_QUOTE_CHARS = 20
MIN_QUOTE_WORDS = 4
MAX_QUOTE_CHARS = 500
QUOTE_MATCH_RATIO = 0.9
WHITESPACE = re.compile(r"\s+")
SENTENCE_BREAK = re.compile(r"(?<=[.!?…])\s+")
SPOKEN_WORD = re.compile(r"\w+(?:[-'\u2019]\w+)*")
NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
STEM_CHARS = 5


def normalize(text: str) -> str:
    return WHITESPACE.sub(" ", text).strip()


def defang(text: str) -> str:
    # Client and source text sit inside <<< >>> fences in prompts, so they must not be able to close one.
    return text.replace("<<<", "\u2039\u2039\u2039").replace(">>>", "\u203a\u203a\u203a")


def word_stems(text: str) -> set[str]:
    return {word.casefold()[:STEM_CHARS] for word in SPOKEN_WORD.findall(text) if len(word) > 2}


def is_proof_sized(quote: str) -> bool:
    return MIN_QUOTE_CHARS <= len(quote) <= MAX_QUOTE_CHARS and len(SPOKEN_WORD.findall(quote)) >= MIN_QUOTE_WORDS


def require_usable_source(source_text: str) -> None:
    max_chars = get_settings().max_source_chars
    if len(source_text) > max_chars:
        raise SourceTooLongError(f"source_text is longer than {max_chars} characters")
    if not source_text.strip():
        raise BadInputError("source_text contains no text")


@dataclass(frozen=True)
class SceneCheck:
    scene: ScriptScene
    problems: list[str]


class GroundedSource:
    def __init__(self, text: str) -> None:
        self.text = normalize(text)
        self.sentences = [sentence for sentence in SENTENCE_BREAK.split(self.text) if sentence]

    def contains_words(self, candidate: str) -> bool:
        return re.search(rf"(?<!\w){re.escape(candidate)}(?!\w)", self.text) is not None

    def snap_quote(self, quote: str) -> str | None:
        # A quote must be long enough to prove a fact, short enough to be one statement, and cut at word boundaries.
        candidate = normalize(quote)
        if not is_proof_sized(candidate):
            return None
        if self.contains_words(candidate):
            return candidate
        # A near-verbatim quote (other quote marks, yo/ye spelling, dash type) is replaced by the real source sentence.
        best_ratio, best_sentence = 0.0, None
        numbers = NUMBER.findall(candidate)
        for sentence in (sentence for sentence in self.sentences if is_proof_sized(sentence)):
            # A near match may differ in punctuation or spelling, never in its numbers.
            if NUMBER.findall(sentence) != numbers:
                continue
            matcher = SequenceMatcher(None, candidate, sentence, autojunk=False)
            if matcher.real_quick_ratio() < QUOTE_MATCH_RATIO or matcher.quick_ratio() < QUOTE_MATCH_RATIO:
                continue
            ratio = matcher.ratio()
            if ratio > best_ratio:
                best_ratio, best_sentence = ratio, sentence
        return best_sentence if best_ratio >= QUOTE_MATCH_RATIO else None


def fix_highlight(highlight: str | None, text: str) -> str | None:
    if highlight is None:
        return None
    wanted = highlight.strip().casefold()
    return next((word for word in SPOKEN_WORD.findall(text) if word.casefold() == wanted), None)


def check_scene(scene: ScriptScene, source: GroundedSource) -> SceneCheck:
    problems: list[str] = []
    text = normalize(scene.text)
    if not SPOKEN_WORD.search(text):
        problems.append("text has no words to speak")
    if len(text) > MAX_TEXT_CHARS:
        problems.append(f"text has {len(text)} characters; keep it under 200")
    quote = None
    if scene.source_quote is not None and scene.source_quote.strip():
        quote = source.snap_quote(scene.source_quote)
        if quote is None:
            problems.append("source_quote is not a sentence copied word for word from the SOURCE FRAGMENT")
    elif scene.speaker == "teacher":
        problems.append(
            "a teacher line needs a source_quote: one sentence copied word for word from the SOURCE FRAGMENT"
        )
    fixed = scene.model_copy(
        update={"text": text, "highlight": fix_highlight(scene.highlight, text), "source_quote": quote}
    )
    return SceneCheck(scene=fixed, problems=problems)
