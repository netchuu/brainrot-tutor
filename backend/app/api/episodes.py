from typing import Annotated, Literal

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.errors import SourceTooLongError
from app.schemas.contract import EpisodesRequest
from app.services.fixture_replay import load_episode_fixture, replay

router = APIRouter(prefix="/api")

NDJSON_MEDIA_TYPE = "application/x-ndjson"
STREAM_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}


@router.post("/episodes/stream")
async def stream_episodes(body: EpisodesRequest, mock: Annotated[Literal["1"], Query()]) -> StreamingResponse:
    max_chars = get_settings().max_source_chars
    if len(body.source_text) > max_chars:
        raise SourceTooLongError(f"source_text is longer than {max_chars} characters")
    lines = await load_episode_fixture()
    return StreamingResponse(replay(lines), media_type=NDJSON_MEDIA_TYPE, headers=STREAM_HEADERS)
