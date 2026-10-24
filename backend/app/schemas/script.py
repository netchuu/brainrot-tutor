from pydantic import BaseModel, ConfigDict, Field

from app.schemas.contract import Language, Reaction, Sfx, Speaker, TemplateId


class ScriptModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ScriptScene(ScriptModel):
    speaker: Speaker
    text: str = Field(min_length=1)
    highlight: str | None
    picture_query: str | None
    reaction: Reaction
    sfx: Sfx
    source_quote: str | None


class EpisodeDraft(ScriptModel):
    course_title: str = Field(min_length=1)
    title: str = Field(min_length=1)
    scenes: list[ScriptScene] = Field(min_length=3, max_length=8)


class SceneFixes(ScriptModel):
    scenes: list[ScriptScene] = Field(min_length=1, max_length=8)


class EpisodeScript(ScriptModel):
    title: str
    template: TemplateId
    scenes: list[ScriptScene] = Field(min_length=1, max_length=8)


class CourseScript(ScriptModel):
    course_title: str
    language: Language
    episodes: list[EpisodeScript] = Field(min_length=1, max_length=3)
