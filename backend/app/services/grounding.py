import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from app.schemas.script import ScriptScene

MAX_TEXT_CHARS = 220
QUOTE_MATCH_RATIO = 0.9
WHITESPACE = re.compile(r"\s+")
SENTENCE_BREAK = re.compile(r"(?<=[.!?…])\s+")


def normalize(text: str) -> str:
    return WHITESPACE.sub(" ", text).strip()


@dataclass(frozen=True)
class SceneCheck:
    scene: ScriptScene
    problems: list[str]


class GroundedSource:
    def __init__(self, text: str) -> None:
        self.text = normalize(text)
        self.sentences = [sentence for sentence in SENTENCE_BREAK.split(self.text) if sentence]

    def snap_quote(self, quote: str) -> str | None:
        candidate = normalize(quote)
        if not candidate:
            return None
        if candidate in self.text:
            return candidate
        # A near-verbatim quote (other quote marks, yo/ye spelling, dash type) is replaced by the real source sentence.
        best_ratio, best_sentence = 0.0, None
        for sentence in self.sentences:
            matcher = SequenceMatcher(None, candidate, sentence, autojunk=False)
            if matcher.real_quick_ratio() < QUOTE_MATCH_RATIO or matcher.quick_ratio() < QUOTE_MATCH_RATIO:
                continue
            ratio = matcher.ratio()
            if ratio > best_ratio:
                best_ratio, best_sentence = ratio, sentence
        return best_sentence if best_ratio >= QUOTE_MATCH_RATIO else None


def fix_highlight(highlight: str | None, text: str) -> str | None:
    if highlight is None or not highlight.strip():
        return None
    word = highlight.strip()
    if word in text:
        return word
    match = re.search(re.escape(word), text, re.IGNORECASE)
    return match.group(0) if match else None


def check_scene(scene: ScriptScene, source: GroundedSource) -> SceneCheck:
    problems: list[str] = []
    text = normalize(scene.text)
    if len(text) > MAX_TEXT_CHARS:
        problems.append(f"text has {len(text)} characters; keep it under 200")
    quote = None
    if scene.source_quote is not None and scene.source_quote.strip():
        quote = source.snap_quote(scene.source_quote)
        if quote is None:
            problems.append("source_quote is not a sentence copied word for word from the SOURCE FRAGMENT")
    fixed = scene.model_copy(
        update={"text": text, "highlight": fix_highlight(scene.highlight, text), "source_quote": quote}
    )
    return SceneCheck(scene=fixed, problems=problems)
