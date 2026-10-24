from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.episodes import NDJSON_MEDIA_TYPE, STREAM_HEADERS
from app.errors import BadInputError
from app.schemas.contract import TutorRequest
from app.services.grounding import require_usable_source
from app.services.tutor import stream_tutor

router = APIRouter(prefix="/api")


@router.post("/tutor")
async def tutor(body: TutorRequest) -> StreamingResponse:
    require_usable_source(body.source_text)
    last = body.messages[-1]
    if last.role != "user" or not last.content.strip():
        raise BadInputError("the last message must be a non-empty question from the user")
    return StreamingResponse(stream_tutor(body), media_type=NDJSON_MEDIA_TYPE, headers=STREAM_HEADERS)
