import hashlib
from dataclasses import dataclass

from app.schemas.contract import BackgroundId, Cast, CharacterId, Language, Speaker, TemplateId


@dataclass(frozen=True)
class CharacterVoice:
    ru: str
    en: str
    pitch: str
    rate: str


# Multilingual voices speak Russian with word timings; ru-RU-DmitryNeural drops sentences, so it is not used.
CHARACTER_VOICES: dict[CharacterId, CharacterVoice] = {
    "professor": CharacterVoice("ru-RU-SvetlanaNeural", "en-US-AvaMultilingualNeural", "+0Hz", "+0%"),
    "mechanic": CharacterVoice("en-US-BrianMultilingualNeural", "en-US-BrianMultilingualNeural", "-5Hz", "+0%"),
    "robot": CharacterVoice("de-DE-FlorianMultilingualNeural", "de-DE-FlorianMultilingualNeural", "-10Hz", "-5%"),
    "kid": CharacterVoice("en-US-EmmaMultilingualNeural", "en-US-EmmaMultilingualNeural", "+20Hz", "+10%"),
    "gamer": CharacterVoice("fr-FR-RemyMultilingualNeural", "fr-FR-RemyMultilingualNeural", "+10Hz", "+12%"),
    "cat": CharacterVoice("fr-FR-VivienneMultilingualNeural", "fr-FR-VivienneMultilingualNeural", "+25Hz", "+8%"),
}
CAST_PAIRS: tuple[Cast, ...] = (
    Cast(teacher="professor", student="kid"),
    Cast(teacher="mechanic", student="gamer"),
    Cast(teacher="robot", student="cat"),
)
GAMEPLAY_BACKGROUNDS: tuple[BackgroundId, ...] = ("parkour", "surf", "runner")
SPLIT_SCREEN_BACKGROUND: BackgroundId = "satisfying"


def course_seed(source_text: str) -> int:
    return int.from_bytes(hashlib.sha256(source_text.encode("utf-8")).digest()[:4], "big")


def pick_cast(seed: int, episode: int) -> Cast:
    return CAST_PAIRS[(seed + episode) % len(CAST_PAIRS)]


def pick_background(seed: int, episode: int, template: TemplateId) -> BackgroundId:
    if template == "split_screen":
        return SPLIT_SCREEN_BACKGROUND
    return GAMEPLAY_BACKGROUNDS[(seed + episode) % len(GAMEPLAY_BACKGROUNDS)]


def voice_for(character: CharacterId, language: Language) -> tuple[str, str, str]:
    voice = CHARACTER_VOICES[character]
    return (voice.ru if language == "ru" else voice.en), voice.pitch, voice.rate


def character_for(cast: Cast, speaker: Speaker) -> CharacterId:
    return cast.teacher if speaker == "teacher" else cast.student
