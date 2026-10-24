import logging

from app.clients.pexels import search_photo
from app.errors import PictureError
from app.schemas.contract import Picture

logger = logging.getLogger(__name__)


async def find_picture(query: str | None) -> Picture | None:
    if query is None or not query.strip():
        return None
    search = query.strip()
    try:
        photo = await search_photo(search)
    except PictureError as exc:
        logger.warning("picture lookup failed: %s", exc)
        return None
    if photo is None:
        return None
    return Picture(query=search, url=photo.src.large, credit=f"Photo by {photo.photographer} on Pexels")
