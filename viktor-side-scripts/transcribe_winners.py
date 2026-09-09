"""
Read the scripts off our video ads and put them in the market database.

Why a video model and not speech-to-text: a sample of 8 ads found **4 with an
Arabic voiceover and 4 completely silent** — motion graphics with on-screen
Arabic text. Audio transcription would have returned an empty string for half
the library and quietly under-reported the best-performing style. `analyze_video`
watches frames and hears audio, so it reads both. [meta, 2026-09-06]

Separate pass from `collect_market_plays.py` because it is slow and costs money
per video. Safe to interrupt: each video is written back the moment it is done,
and finished ads are never re-fetched.

    uv run python transcribe_winners.py --limit 20 --min-spend 100

Aziz's ask, 2026-09-06: "not only the targeting, but also the types of ads,
types of copy, the types of scripts, and all that stuff should go into the
database."
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from collect_market_plays import convex, graph, meta_token  # noqa: E402

from sdk.tools.utils_tools import analyze_video  # noqa: E402

PROMPT = """This is a Meta ad for a construction, architecture or interior
design business in the Gulf, usually in Arabic.

Return ONLY a JSON object, no other text, with these keys:
- "script": the full script of the ad. If someone speaks, transcribe the
  voiceover. If nobody speaks, transcribe the on-screen text in the order it
  appears. Keep the original language (Arabic stays Arabic).
- "hook": just the first line or opening claim, exactly as it appears.
- "voice": one of "voiceover", "text on screen", "both", "silent".
- "structure": one short English sentence describing how the ad is built
  (for example "problem, then proof, then free consultation offer").
"""


def video_source(video_id: str, token: str) -> tuple[str | None, float | None]:
    try:
        r = graph(video_id, token, fields="source,length")
        return r.get("source"), r.get("length")
    except RuntimeError as exc:
        print(f"    source failed: {str(exc)[:120]}")
        return None, None


def download(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=180) as resp:
            dest.write_bytes(resp.read())
        return dest.stat().st_size > 1000
    except Exception as exc:  # noqa: BLE001
        print(f"    download failed: {str(exc)[:120]}")
        return False


def parse(raw: str) -> dict | None:
    """The model is asked for bare JSON but sometimes fences it."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        text = text[4:] if text.startswith("json") else text
    try:
        out = json.loads(text)
        return out if isinstance(out, dict) else None
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
        return None


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=15)
    ap.add_argument("--min-spend", type=float, default=100)
    # A three-minute "ad" is almost always a mis-tagged long-form video.
    ap.add_argument("--max-seconds", type=float, default=300)
    args = ap.parse_args()

    token = meta_token()
    pending = convex("market:untranscribed", {"minSpend": args.min_spend}, kind="query")
    print(f"{len(pending)} video ads without a script (>= ${args.min_spend:.0f} spend)")
    todo = pending[: args.limit]

    done = failed = skipped = 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, ad in enumerate(todo, 1):
            print(f"[{i}/{len(todo)}] {ad['client'][:22]} · ${ad['spend']:.0f}")
            src, length = video_source(ad["videoId"], token)
            if not src:
                failed += 1
                continue
            if length and length > args.max_seconds:
                print(f"    skipped: {length:.0f}s is too long to be an ad")
                skipped += 1
                continue
            dest = Path(tmp) / f"{ad['videoId']}.mp4"
            if not download(src, dest):
                failed += 1
                continue
            try:
                res = await analyze_video(file_path=str(dest), prompt=PROMPT)
                data = parse(res.text or "")
            except Exception as exc:  # noqa: BLE001
                print(f"    analyse failed: {str(exc)[:140]}")
                data = None
            finally:
                dest.unlink(missing_ok=True)

            script = (data or {}).get("script", "").strip() if data else ""
            if not script:
                print("    no script recovered")
                failed += 1
                continue

            structure = (data or {}).get("structure", "").strip()
            convex(
                "market:storeTranscript",
                {
                    "adsetId": ad["adsetId"],
                    "adId": ad["adId"],
                    # Structure first: it is the reusable part, and it keeps the
                    # useful line visible when the UI truncates.
                    "transcript": (
                        f"[{structure}]\n\n{script}" if structure else script
                    )[:4000],
                    "hook": ((data or {}).get("hook") or "").strip()[:300] or None,
                    "voice": ((data or {}).get("voice") or "").strip()[:40] or None,
                },
            )
            done += 1
            print(f"    {(data or {}).get('voice', '?')}: {script[:80]}...")

    print(f"\nscripts stored {done} · failed {failed} · skipped {skipped} of {len(todo)}")
    if done:
        # Push the new scripts into the permanent winners archive too, so a
        # retired winner keeps the script we paid to read.
        arch = convex("market:archiveWinners", {})
        print(f"winners archive: {arch['archived']} kept, {arch['added']} new")


if __name__ == "__main__":
    asyncio.run(main())
