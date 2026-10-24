import asyncio
import base64
import json
import sys
import time
from pathlib import Path
from typing import Any

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "fixture_script.json"
OUTPUT = ROOT / "fixtures" / "episode-stream.ndjson"
# Russian voice of each character, as in backend/app/services/cast.py
CHARACTER_VOICES = {
    "professor": {"voice": "ru-RU-SvetlanaNeural", "pitch": "+0Hz", "rate": "+0%"},
    "mechanic": {"voice": "en-US-BrianMultilingualNeural", "pitch": "-5Hz", "rate": "+0%"},
    "robot": {"voice": "de-DE-FlorianMultilingualNeural", "pitch": "-10Hz", "rate": "-5%"},
    "kid": {"voice": "en-US-EmmaMultilingualNeural", "pitch": "+20Hz", "rate": "+10%"},
    "gamer": {"voice": "fr-FR-RemyMultilingualNeural", "pitch": "+10Hz", "rate": "+12%"},
    "cat": {"voice": "fr-FR-VivienneMultilingualNeural", "pitch": "+25Hz", "rate": "+8%"},
}
# edge-tts default output is 48 kbit/s mono MP3, so bytes map directly to duration
MP3_BYTES_PER_MS = 48_000 / 8 / 1000
TICKS_PER_MS = 10_000


async def synthesize(text: str, character: str) -> tuple[bytes, list[dict[str, Any]]]:
    style = CHARACTER_VOICES[character]
    communicate = edge_tts.Communicate(
        text, style["voice"], rate=style["rate"], pitch=style["pitch"], boundary="WordBoundary"
    )
    audio = bytearray()
    words: list[dict[str, Any]] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            start = round(chunk["offset"] / TICKS_PER_MS)
            end = round((chunk["offset"] + chunk["duration"]) / TICKS_PER_MS)
            words.append({"text": chunk["text"], "start_ms": start, "end_ms": end})
    return bytes(audio), words


def build_scene(episode: int, index: int, spec: dict[str, Any], audio: bytes, words: list[dict[str, Any]]) -> dict[str, Any]:
    seed = spec.get("picture_seed")
    picture = None
    if seed:
        picture = {
            "query": spec["picture_query"],
            "url": f"https://picsum.photos/seed/{seed}/720/720",
            "credit": "Lorem Picsum (fixture only)",
        }
    return {
        "id": f"e{episode}s{index}",
        "speaker": spec["speaker"],
        "text": spec["text"],
        "highlight": spec["highlight"],
        "words": words,
        "words_estimated": False,
        "audio": {
            "mime": "audio/mpeg",
            "base64": base64.b64encode(audio).decode("ascii"),
            "duration_ms": round(len(audio) / MP3_BYTES_PER_MS),
        },
        "picture": picture,
        "formula": spec.get("formula"),
        "term": spec.get("term"),
        "rank": spec.get("rank"),
        "verdict": spec.get("verdict"),
        "reaction": spec["reaction"],
        "sfx": spec["sfx"],
        "source_quote": spec["source_quote"],
    }


async def main() -> int:
    script = json.loads(SCRIPT.read_text(encoding="utf-8"))
    started = time.perf_counter()
    events: list[dict[str, Any]] = [
        {
            "type": "plan",
            "course_title": script["course_title"],
            "language": script["language"],
            "episodes": [
                {
                    "index": i,
                    "title": ep["title"],
                    "template": ep["template"],
                    "scene_count": len(ep["scenes"]),
                    "cast": ep["cast"],
                    "background": ep["background"],
                }
                for i, ep in enumerate(script["episodes"])
            ],
        }
    ]
    for ep_index, episode in enumerate(script["episodes"]):
        cast = episode["cast"]
        results = await asyncio.gather(*(synthesize(s["text"], cast[s["speaker"]]) for s in episode["scenes"]))
        for sc_index, (spec, (audio, words)) in enumerate(zip(episode["scenes"], results, strict=True)):
            if not audio or not words:
                print(f"no audio or timings for e{ep_index}s{sc_index}", file=sys.stderr)
                return 1
            events.append({"type": "scene", "episode": ep_index, "index": sc_index, "scene": build_scene(ep_index, sc_index, spec, audio, words)})
        events.append({"type": "episode_done", "episode": ep_index})
    events.append({"type": "done", "elapsed_ms": round((time.perf_counter() - started) * 1000)})
    OUTPUT.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events), encoding="utf-8")
    print(f"wrote {len(events)} events to {OUTPUT.relative_to(ROOT.parent)} in {time.perf_counter() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
