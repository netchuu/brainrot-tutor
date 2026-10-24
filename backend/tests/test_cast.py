from typing import get_args

from app.schemas.contract import CharacterId, TemplateId
from app.services.cast import CHARACTER_VOICES, course_seed, pick_background, pick_cast, voice_for
from build_fixtures import CHARACTER_VOICES as FIXTURE_VOICES
from tests.conftest import SOURCE_TEXT


def test_every_character_has_a_voice_in_both_languages() -> None:
    assert set(CHARACTER_VOICES) == set(get_args(CharacterId))
    assert voice_for("professor", "ru") == ("ru-RU-SvetlanaNeural", "+0Hz", "+0%")
    assert voice_for("professor", "en") == ("en-US-AvaMultilingualNeural", "+0Hz", "+0%")


def test_three_episodes_get_three_different_casts_and_backgrounds() -> None:
    seed = course_seed(SOURCE_TEXT)

    casts = [pick_cast(seed, episode) for episode in range(3)]
    backgrounds = [pick_background(seed, episode, "parkour_duo") for episode in range(3)]

    assert len({(cast.teacher, cast.student) for cast in casts}) == 3
    assert len(set(backgrounds)) == 3
    assert all(cast.teacher != cast.student for cast in casts)


def test_split_screen_always_uses_the_satisfying_clip() -> None:
    templates: tuple[TemplateId, ...] = get_args(TemplateId)

    for episode in range(3):
        for template in templates:
            background = pick_background(7, episode, template)
            assert (background == "satisfying") == (template == "split_screen")


def test_course_seed_is_stable_and_depends_on_the_text() -> None:
    assert course_seed(SOURCE_TEXT) == course_seed(SOURCE_TEXT)
    assert course_seed(SOURCE_TEXT) != course_seed(SOURCE_TEXT + " ")


def test_fixture_generator_uses_the_same_russian_voices() -> None:
    assert {
        character: {"voice": voice.ru, "pitch": voice.pitch, "rate": voice.rate}
        for character, voice in CHARACTER_VOICES.items()
    } == FIXTURE_VOICES
