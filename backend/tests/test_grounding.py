from app.schemas.script import ScriptScene
from app.services.grounding import GroundedSource, check_scene, fix_highlight, normalize
from tests.conftest import SOURCE_TEXT

SENTENCE = (
    "Но у заводских настроек есть запас прочности: "
    "слишком агрессивная прошивка может привести к детонации и перегреву двигателя."
)


def scene(text: str = "Слишком агрессивная прошивка ведёт к перегреву.", quote: str | None = SENTENCE) -> ScriptScene:
    return ScriptScene(
        speaker="teacher",
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
    assert fix_highlight("  ", text) is None
    assert fix_highlight(None, text) is None


def test_grounded_scene_passes() -> None:
    check = check_scene(scene(), GroundedSource(SOURCE_TEXT))

    assert check.problems == []
    assert check.scene.source_quote == SENTENCE
    assert check.scene.highlight == "перегреву"


def test_question_without_quote_passes() -> None:
    check = check_scene(scene(text="А что будет, если перестараться?", quote=None), GroundedSource(SOURCE_TEXT))

    assert check.problems == []
    assert check.scene.source_quote is None
    assert check.scene.highlight is None


def test_long_text_and_invented_quote_are_problems() -> None:
    check = check_scene(scene(text="слово " * 40, quote="Этого нет в тексте."), GroundedSource(SOURCE_TEXT))

    assert len(check.problems) == 2
    assert "characters" in check.problems[0]
    assert "source_quote" in check.problems[1]
