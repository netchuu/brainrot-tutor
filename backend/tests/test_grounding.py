import pytest

from app.schemas.contract import Speaker
from app.schemas.script import ScriptScene
from app.services.grounding import GroundedSource, check_scene, fix_highlight, normalize
from tests.conftest import SOURCE_TEXT

SENTENCE = (
    "Но у заводских настроек есть запас прочности: "
    "слишком агрессивная прошивка может привести к детонации и перегреву двигателя."
)


def scene(
    text: str = "Слишком агрессивная прошивка ведёт к перегреву.",
    quote: str | None = SENTENCE,
    speaker: Speaker = "teacher",
) -> ScriptScene:
    return ScriptScene(
        speaker=speaker,
        text=text,
        highlight="перегреву",
        picture_query="overheated engine",
        reaction="shocked",
        sfx="buzzer",
        source_quote=quote,
    )


def test_normalize_collapses_whitespace() -> None:
    assert normalize("  ЭБУ —\n\n это   компьютер ") == "ЭБУ — это компьютер"


def test_exact_quote_is_kept_after_whitespace_normalisation() -> None:
    source = GroundedSource(SOURCE_TEXT)

    assert source.snap_quote(SENTENCE.replace(" ", "\n", 3)) == SENTENCE


def test_near_verbatim_quote_snaps_to_source_sentence() -> None:
    source = GroundedSource(SOURCE_TEXT)
    drifted = "«Детонация - это взрывное, неконтролируемое сгорание смеси, которое разрушает поршни»."

    assert source.snap_quote(drifted) == (
        "Детонация — это взрывное, неконтролируемое сгорание смеси, которое разрушает поршни."
    )


def test_invented_quote_is_rejected() -> None:
    source = GroundedSource(SOURCE_TEXT)

    assert source.snap_quote("Чип-тюнинг всегда безопасен и увеличивает мощность вдвое.") is None
    assert source.snap_quote("   ") is None


def test_highlight_is_fixed_to_text_or_dropped() -> None:
    text = "Мозг машины называется ЭБУ."

    assert fix_highlight("ЭБУ", text) == "ЭБУ"
    assert fix_highlight("мозг", text) == "Мозг"
    assert fix_highlight("двигатель", text) is None
    assert fix_highlight("Мо", text) is None
    assert fix_highlight("Мозг машины", text) is None
    assert fix_highlight("  ", text) is None
    assert fix_highlight(None, text) is None


def test_grounded_scene_passes() -> None:
    check = check_scene(scene(), GroundedSource(SOURCE_TEXT))

    assert check.problems == []
    assert check.scene.source_quote == SENTENCE
    assert check.scene.highlight == "перегреву"


def test_student_question_without_quote_passes() -> None:
    question = scene(text="А что будет, если перестараться?", quote=None, speaker="student")

    check = check_scene(question, GroundedSource(SOURCE_TEXT))

    assert check.problems == []
    assert check.scene.source_quote is None
    assert check.scene.highlight is None


@pytest.mark.parametrize("quote", [None, "   "])
def test_teacher_line_without_quote_is_a_problem(quote: str | None) -> None:
    check = check_scene(scene(quote=quote), GroundedSource(SOURCE_TEXT))

    assert len(check.problems) == 1
    assert "teacher line needs a source_quote" in check.problems[0]


@pytest.mark.parametrize("fragment", ["—", ".", "ЭБУ", "блок управления"])
def test_short_fragment_is_not_a_quote(fragment: str) -> None:
    assert fragment in SOURCE_TEXT
    assert GroundedSource(SOURCE_TEXT).snap_quote(fragment) is None


def test_short_whole_sentence_is_a_quote() -> None:
    source = GroundedSource(
        "Это важно. Прошивка меняет карты, по которым блок управления решает, сколько топлива подать."
    )

    assert source.snap_quote("Это важно.") == "Это важно."


@pytest.mark.parametrize("text", ["   ", "...", "— !"])
def test_text_without_words_is_a_problem(text: str) -> None:
    check = check_scene(scene(text=text, quote=None, speaker="student"), GroundedSource(SOURCE_TEXT))

    assert check.problems == ["text has no words to speak"]


def test_long_text_and_invented_quote_are_problems() -> None:
    invented = "Этого предложения в исходном тексте нет совсем."
    check = check_scene(scene(text="слово " * 40, quote=invented), GroundedSource(SOURCE_TEXT))

    assert len(check.problems) == 2
    assert "characters" in check.problems[0]
    assert "source_quote" in check.problems[1]
