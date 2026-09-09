#!/usr/bin/env python
"""Answer a cockpit question from the sandbox.

The media buyer's questions arrive in Viktor's Slack DM via the outbox relay.
The answer has to go back into the campaign's own thread in the cockpit,
otherwise she has to keep two conversations in her head.

Usage:
    uv run python skills/client_onboarding_launch/scripts/cockpit_reply.py --list
    uv run python skills/client_onboarding_launch/scripts/cockpit_reply.py \
        --campaign "Arcturus-Mahara-3\\9" --text "Scale it. CPL is $5 on 3 days."
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

SYNC = Path(__file__).with_name("sync_cockpit.py")


def _load():
    spec = importlib.util.spec_from_file_location("sync_cockpit", SYNC)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["sync_cockpit"] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="show unanswered questions")
    ap.add_argument("--campaign", help="campaign id (its name)")
    ap.add_argument("--text", help="the answer")
    args = ap.parse_args()

    m = _load()

    if args.list or not (args.campaign and args.text):
        waiting = m.convex("chat:waiting", {}, kind="query") or []
        if not waiting:
            print("nothing waiting")
            return 0
        for w in waiting:
            print(f"- [{w['campaign']}] {w.get('who') or 'media buyer'}: {w['text']}")
            if w.get("context"):
                print(f"    context: {w['context']}")
        return 0

    res = m.convex(
        "chat:reply", {"campaignId": args.campaign, "text": args.text}
    )
    print(res)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
