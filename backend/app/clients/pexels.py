import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.errors import PictureError

PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"
PEXELS_TIMEOUT_S = 5.0


class PexelsSource(BaseModel):
    large: str


class PexelsPhoto(BaseModel):
    photographer: str
    src: PexelsSource


class PexelsSearch(BaseModel):
    photos: list[PexelsPhoto]


async def search_photo(query: str) -> PexelsPhoto | None:
    api_key = get_settings().pexels_api_key
    if api_key is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=PEXELS_TIMEOUT_S) as client:
            response = await client.get(
                PEXELS_SEARCH_URL,
                params={"query": query, "per_page": 1},
                headers={"Authorization": api_key.get_secret_value()},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise PictureError(f"Pexels search failed: {type(exc).__name__}") from exc
    try:
        result = PexelsSearch.model_validate_json(response.content)
    except ValidationError as exc:
        raise PictureError("Pexels answered with an unexpected body") from exc
    return result.photos[0] if result.photos else None
