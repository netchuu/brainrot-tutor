from fastapi import APIRouter

from app.schemas.contract import HealthResponse

router = APIRouter(prefix="/api")


@router.get("/health")
async def health() -> HealthResponse:
    return HealthResponse(status="ok")
