from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas.contract import EpisodesRequest
from app.services.fixture_replay import load_episode_fixture, replay
from app.services.grounding import require_usable_source
from app.services.pipeline import stream_course

router = APIRouter(prefix="/api")

NDJSON_MEDIA_TYPE = "application/x-ndjson"
STREAM_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}


@router.post("/episodes/stream")
async def stream_episodes(body: EpisodesRequest, mock: bool = False) -> StreamingResponse:
    require_usable_source(body.source_text)
    if mock:
        lines = await load_episode_fixture()
        return StreamingResponse(replay(lines), media_type=NDJSON_MEDIA_TYPE, headers=STREAM_HEADERS)
    return StreamingResponse(stream_course(body), media_type=NDJSON_MEDIA_TYPE, headers=STREAM_HEADERS)
