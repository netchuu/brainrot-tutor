import logging

from app.clients.pexels import search_photo
from app.errors import PictureError
from app.schemas.contract import Picture
from app.services.cache import LruCache, cache_key

logger = logging.getLogger(__name__)

# Pexels allows about 200 searches an hour, so found pictures are reused.
PICTURE_CACHE: LruCache[Picture] = LruCache(512)


async def find_picture(query: str | None) -> Picture | None:
    if query is None or not query.strip():
        return None
    search = query.strip()
    key = cache_key("picture", search)
    cached = PICTURE_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        photo = await search_photo(search)
    except PictureError as exc:
        logger.warning("picture lookup failed: %s", exc)
        return None
    if photo is None:
        return None
    picture = Picture(query=search, url=photo.src.large, credit=f"Photo by {photo.photographer} on Pexels")
    PICTURE_CACHE.put(key, picture)
    return picture
