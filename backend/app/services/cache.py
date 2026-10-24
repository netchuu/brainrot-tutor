import hashlib
import json
from collections import OrderedDict
from collections.abc import Callable

CLEARERS: list[Callable[[], None]] = []


def cache_key(*parts: object) -> str:
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


class LruCache[V]:
    def __init__(self, max_entries: int) -> None:
        self.max_entries = max_entries
        self.entries: OrderedDict[str, V] = OrderedDict()
        CLEARERS.append(self.entries.clear)

    def get(self, key: str) -> V | None:
        value = self.entries.get(key)
        if value is not None:
            self.entries.move_to_end(key)
        return value

    def put(self, key: str, value: V) -> None:
        self.entries[key] = value
        self.entries.move_to_end(key)
        while len(self.entries) > self.max_entries:
            self.entries.popitem(last=False)


def clear_all() -> None:
    for clear in CLEARERS:
        clear()
