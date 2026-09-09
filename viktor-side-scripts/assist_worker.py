#!/usr/bin/env python
"""Do the work the media buyer hands to Viktor from inside the cockpit.

The cockpit cannot call an AI model or reach Drive itself — that path runs
through the Viktor tool gateway, which is the one dependency that has actually
gone down on us. So the cockpit only writes a request row; this worker, which
runs in the sandbox where those tools do work, picks it up and writes the
answer back into the same row.

Three kinds of request:
  copy      — write ad copy for a campaign, grounded in the winners archive
  creative  — pull creatives off a Google Drive link into the Meta ad account
  launch    — set a new client's campaign up: check what is missing, name it,
              write the copy, load the creatives, and say what is left for her

Usage:
    uv run python skills/client_onboarding_launch/scripts/assist_worker.py
    uv run python .../assist_worker.py --once   # single pass, no summary line
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import mimetypes
import os
import re
import sys
from pathlib import Path
from typing import Any

from sdk.tools.gdrive import gdrive_download
from sdk.tools.utils_tools import ai_structured_output

SYNC = Path(__file__).with_name("sync_cockpit.py")


def _load() -> Any:
    spec = importlib.util.spec_from_file_location("sync_cockpit", SYNC)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["sync_cockpit"] = mod
    spec.loader.exec_module(mod)
    return mod


M = _load()
convex = M.convex

# Rules that are not negotiable in anything client-facing. They are repeated in
# the prompt because a model that has not been told will reach for "contractor"
# and for local currency every single time. [aziz, standing]
HOUSE_RULES = """
Hard rules, no exceptions:
- Never call the audience "contractors" and never imply one-man teams. They are
  construction and design businesses, firms or companies.
- Never use the term "B2B" in anything a client or a lead will read.
- Every money figure is in USD. Never dinar, riyal or dirham.
- Write like one person talking to another. Short sentences. Concrete, not
  aspirational. No emoji walls, no "unlock", no "revolutionise".
- Headline under 40 characters. Primary text 2 to 4 short lines.
"""

# The model reaches for local currency and for "contractor" unless it is caught.
# A rule that is only in the prompt is a rule that gets broken, so it is checked
# on the way out too. [aziz, standing]
BANNED = re.compile(
    r"\b(riyal|dinar|dirham|contractors?)\b|ريال|دينار|درهم",
    re.IGNORECASE,
)


def house_rule_breaks(variants: list[dict]) -> list[str]:
    hits: list[str] = []
    for v in variants:
        for field in ("headline", "message", "description"):
            text = v.get(field) or ""
            for m in BANNED.finditer(text):
                hits.append(m.group(0))
    return sorted(set(hits))


DRIVE_ID = re.compile(r"(?:/d/|id=|/file/d/|folders/)([A-Za-z0-9_-]{16,})")


def drive_id(link: str) -> str | None:
    """The file id inside any shape of Drive link, or a bare id."""
    m = DRIVE_ID.search(link)
    if m:
        return m.group(1)
    bare = link.strip()
    return bare if re.fullmatch(r"[A-Za-z0-9_-]{16,}", bare) else None


async def write_copy(req: dict, ctx: dict) -> dict:
    """Ad copy grounded in what has actually won for this kind of client."""
    c = ctx.get("campaign") or {}
    client = req.get("client") or ctx.get("client") or c.get("clientName") or ""
    language = (
        req.get("language")
        or (ctx.get("prefs") or {}).get("language")
        or c.get("language")
        or "Arabic"
    )
    service = c.get("serviceType") or (ctx.get("onboarding") or {}).get("service") or ""
    city = c.get("city") or ""

    # Winners from the same service line first: those are the ones whose hooks
    # transfer. Fall back to the cheapest leads overall.
    winners = ctx.get("winners") or []
    same = [w for w in winners if service and w.get("serviceLine") == service]
    picked = (same or winners)[:8]
    proof = "\n\n".join(
        f"- {w.get('client')} · {w.get('city') or '?'} · ${round(w.get('cpl') or 0, 2)} a lead\n"
        f"  hook: {w.get('hook') or w.get('headline') or ''}\n"
        f"  copy: {(w.get('body') or '')[:400]}"
        for w in picked
    )

    prompt = f"""You write Meta ads for Mahara Media, a marketing agency whose
clients are construction and design businesses in the Gulf.

Write 5 ad options for: {client}
Service they sell: {service or "not stated"}
City: {city or "not stated"}
Language of the ad: {language}

What she asked for:
{req.get("brief") or "No brief given — write the strongest general options for this client."}

Ads that have actually produced cheap leads for similar clients — steal the
angles, not the words:
{proof or "No comparable winners on file yet."}
{HOUSE_RULES}
Give 5 distinct angles, not 5 rewrites of one sentence: outcome, objection,
proof, question, direct offer. Write in {language}. Name the angle in English.
"""
    res = await ai_structured_output(
        prompt=prompt,
        intelligence_level="smart",
        model="claude-sonnet-5",
        output_schema={
            "type": "object",
            "properties": {
                "variants": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "headline": {"type": "string"},
                            "message": {"type": "string"},
                            "description": {"type": "string"},
                            "angle": {"type": "string"},
                        },
                        "required": ["headline", "message", "angle"],
                    },
                },
                "note": {"type": "string"},
            },
            "required": ["variants"],
        },
    )
    if res.error or not res.result:
        raise RuntimeError(res.error or "no result")
    out = res.result
    variants = [
        {
            "headline": str(v.get("headline", ""))[:120],
            "message": str(v.get("message", ""))[:1200],
            "description": (str(v.get("description"))[:300] if v.get("description") else None),
            "angle": str(v.get("angle", ""))[:60] or None,
        }
        for v in (out.get("variants") or [])
    ][:5]
    breaks = house_rule_breaks([v for v in variants])
    if breaks:
        # One repair pass, naming exactly what was wrong. Cheaper and far more
        # reliable than hoping the next generation happens to comply.
        fix = await ai_structured_output(
            prompt=(
                "Rewrite these ads so they break none of the rules below. Keep "
                "the angle and the language of each one.\n"
                f"Rule breaks found: {', '.join(breaks)}\n{HOUSE_RULES}\n"
                f"Ads:\n{json.dumps(variants, ensure_ascii=False)}"
            ),
            intelligence_level="smart",
            model="claude-sonnet-5",
            output_schema={
                "type": "object",
                "properties": {
                    "variants": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "headline": {"type": "string"},
                                "message": {"type": "string"},
                                "description": {"type": "string"},
                                "angle": {"type": "string"},
                            },
                            "required": ["headline", "message", "angle"],
                        },
                    }
                },
                "required": ["variants"],
            },
        )
        if not fix.error and fix.result:
            repaired = [
                {
                    "headline": str(v.get("headline", ""))[:120],
                    "message": str(v.get("message", ""))[:1200],
                    "description": (
                        str(v.get("description"))[:300] if v.get("description") else None
                    ),
                    "angle": str(v.get("angle", ""))[:60] or None,
                }
                for v in (fix.result.get("variants") or [])
            ]
            if repaired and not house_rule_breaks(repaired):
                variants = repaired
                breaks = []

    note = out.get("note") or (
        f"{len(variants)} options, written off {len(picked)} ads that already "
        "produced cheap leads for this kind of client. Edit anything before you "
        "create them — nothing goes live until you switch it on."
    )
    if breaks:
        note += (
            " Check these before you use them — I could not get the wording "
            f"clean on: {', '.join(breaks)}."
        )
    return {"variants": variants, "note": note}


async def load_creatives(req: dict, ctx: dict) -> dict:
    """Pull each Drive link into the client's Meta ad account, ready to use."""
    c = ctx.get("campaign") or {}
    account = (
        c.get("metaAccountId")
        or (ctx.get("onboarding") or {}).get("accountId")
        or (ctx.get("launchWatch") or {}).get("accountId")
    )
    links = req.get("driveLinks") or []
    media: list[dict] = []
    for link in links:
        fid = drive_id(link)
        entry: dict[str, Any] = {"name": fid or link[:60], "link": link}
        if not fid:
            entry["error"] = "That is not a Google Drive link I can read."
            media.append(entry)
            continue
        if not account:
            entry["error"] = "No Meta ad account on this client yet."
            media.append(entry)
            continue
        try:
            got = await gdrive_download(unified_uri=fid)
            # The Drive tool puts the sandbox path on the response itself; the
            # `content` field is empty for binaries. Read both, top level first.
            info: dict[str, Any] = dict(got) if isinstance(got, dict) else {}
            payload = info.get("content")
            if isinstance(payload, str) and payload.strip().startswith("{"):
                info = {**json.loads(payload), **info}
            path = info.get("file_path") or info.get("path") or info.get("local_path")
            name = info.get("name") or info.get("file_name") or (
                Path(str(path)).name if path else fid
            )
            entry["name"] = str(name)[:120]
            if not path or not os.path.exists(path):
                entry["error"] = "Downloaded, but the file did not land in the sandbox."
                media.append(entry)
                continue
            guess = mimetypes.guess_type(str(name))[0] or ""
            is_video = guess.startswith("video") or str(name).lower().endswith(
                (".mp4", ".mov", ".m4v")
            )
            entry["kind"] = "video" if is_video else "image"
            up = M.meta_upload(account, path, is_video=is_video)
            if is_video:
                entry["videoId"] = up.get("id")
            else:
                entry["imageHash"] = up.get("hash")
                entry["thumbUrl"] = up.get("url")
        except Exception as exc:  # noqa: BLE001 — one bad file must not kill the batch
            entry["error"] = str(exc)[:300]
        media.append(entry)

    ok = [m for m in media if not m.get("error")]
    bad = [m for m in media if m.get("error")]
    note = f"{len(ok)} of {len(media)} creatives are in the ad account and ready to use."
    if bad:
        note += " Could not take: " + "; ".join(
            f"{m['name']} ({m['error']})" for m in bad[:4]
        )
    if not account:
        note = "No Meta ad account on this client yet, so there is nowhere to put these."
    return {"media": media, "note": note}


async def set_up_launch(req: dict, ctx: dict) -> dict:
    """Walk a new client's launch as far as it can go without her."""
    watch = ctx.get("launchWatch") or {}
    onb = ctx.get("onboarding") or {}
    client = req.get("client") or ctx.get("client") or ""
    account = onb.get("accountId") or watch.get("accountId")

    steps: list[dict] = []

    def step(label: str, state: str, detail: str | None = None) -> None:
        steps.append({"label": label, "state": state, "detail": detail})

    step(
        "Meta ad account",
        "done" if account else "blocked",
        f"Account {account}" if account else "No Meta ad account in Client Data yet.",
    )
    step(
        "Onboarding task in ClickUp",
        "done" if (watch.get("hasTask") or onb.get("taskId")) else "blocked",
        watch.get("taskUrl") or onb.get("taskUrl"),
    )
    for issue in watch.get("issues") or []:
        step(issue, "blocked", None)

    creative = None
    if req.get("driveLinks"):
        creative = await load_creatives(req, ctx)
        got = len([m for m in creative["media"] if not m.get("error")])
        step(
            "Creatives loaded into the ad account",
            "done" if got else "blocked",
            creative["note"],
        )
    else:
        step("Creatives", "waiting", "Paste the Drive links and I will load them.")

    copy_out = None
    try:
        copy_out = await write_copy(req, ctx)
        step("Ad copy written", "done", f"{len(copy_out['variants'])} options below.")
    except Exception as exc:  # noqa: BLE001
        step("Ad copy", "blocked", str(exc)[:200])

    # Naming follows the account convention already in the board so the tracker
    # keeps matching: Client-Mahara-<n>. Read the existing count off the sync.
    suggested = f"{client}-Mahara-1" if client else None
    step(
        "Campaign name",
        "waiting" if suggested else "blocked",
        f"Use {suggested} unless you want something else." if suggested else None,
    )
    step(
        "Build the campaign",
        "waiting",
        "Everything above is ready — open the builder and it is prefilled.",
    )

    blocked = [s for s in steps if s["state"] == "blocked"]
    note = (
        f"{client}: I got through what I can without you. "
        + (
            "Nothing is blocking the build."
            if not blocked
            else "Blocked on: " + "; ".join(s["label"] for s in blocked[:4]) + "."
        )
        + " Nothing was created live — the build is still your click."
    )
    return {
        "steps": steps,
        "note": note,
        "variants": (copy_out or {}).get("variants"),
        "media": (creative or {}).get("media"),
    }


HANDLERS = {"copy": write_copy, "creative": load_creatives, "launch": set_up_launch}


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()

    pending = convex("assist:pending", {}, kind="query") or []
    if not pending:
        if not args.once:
            print("nothing queued")
        return 0

    for req in pending:
        rid = req["id"]
        kind = req.get("kind")
        print(f"- {kind} for {req.get('client') or req.get('campaignName')}")
        convex("assist:claim", {"id": rid})
        try:
            ctx = convex(
                "assist:context",
                {
                    "campaignName": req.get("campaignName"),
                    "client": req.get("client"),
                },
                kind="query",
            )
            handler = HANDLERS.get(kind)
            if not handler:
                raise RuntimeError(f"unknown request kind {kind}")
            out = await handler(req, ctx or {})
            convex(
                "assist:fulfill",
                {"id": rid, "status": "ready", **{k: v for k, v in out.items() if v}},
            )
            print(f"  ready — {out.get('note', '')[:120]}")
        except Exception as exc:  # noqa: BLE001 — a failure must reach her, not the log
            convex(
                "assist:fulfill",
                {
                    "id": rid,
                    "status": "failed",
                    "error": str(exc)[:400],
                    "note": (
                        "I could not finish this one. The reason is below — it is "
                        "mine to fix, not yours to work around."
                    ),
                },
            )
            print(f"  failed — {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
