"""Alerts in plain sentences: what broke, since when, what the guardian
already tried, and what a person must do.

Rules (catalogue G1):
- one message when an incident opens and one when it resolves, and at most
  one message per check every 6 hours (a check that flaps is held);
- non-urgent messages go out Saturday to Thursday, 09:00 to 21:00 Kuwait
  time; outside that they wait for the next scan inside it. Urgent ones
  (Convex down, the VPS or Supabase down, WhatsApp double sends) go any time;
- an incident someone else already alerts on (Convex's salesWatch, the
  Hermes monitors, the sales watchdog) is recorded but not posted while that
  system is healthy;
- never a secret, a phone number, an email or a lead's name: every sentence
  goes through redact.clean and evidence is never posted.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from . import http
from .model import KUWAIT, ago, kuwait, parse_time
from .redact import clean

THROTTLE = timedelta(hours=6)


def in_hours(now: datetime) -> bool:
    k = now.astimezone(KUWAIT)
    return k.weekday() != 4 and 9 <= k.hour < 21  # Friday is weekday 4


def _since(inc: dict[str, Any], now: datetime) -> str:
    t = parse_time(inc.get("first_seen_at"))
    if t is None:
        return "an unknown time"
    return f"{kuwait(t)} ({ago((now - t).total_seconds() / 60)})"


def tried_sentence(inc: dict[str, Any], check: Any, mode: str) -> str:
    attempts = inc.get("fix_attempts") or []
    real = [a for a in attempts if not a.get("planned")]
    if real:
        a = real[-1]
        when = kuwait(parse_time(a.get("at")))
        more = f" ({len(real)} attempts so far)" if len(real) > 1 else ""
        return f"{a.get('fix')} at {when}{more}: {a.get('detail')}"
    if check is not None and check.fix is not None:
        if mode != "fix":
            return f"nothing yet; it is in report-only mode, so it did not {check.fix.describe}"
        return f"nothing yet; it will {check.fix.describe} on its next run"
    return "nothing; there is no safe automatic fix for this"


def opened_text(inc: dict[str, Any], check: Any, now: datetime, mode: str) -> str:
    level = {"fail": "Broken", "warn": "Warning", "unknown": "Could not be checked"}.get(inc.get("level"), "Problem")
    lines = [
        f"[guardian] {level}: {inc.get('title')}",
        f"What broke: {inc.get('detail')}",
        f"Since: {_since(inc, now)}.",
        f"What the guardian tried: {tried_sentence(inc, check, mode)}.",
        f"What a person must do ({inc.get('owner')}): {inc.get('action') or 'look at the check named above'}",
    ]
    return "\n".join(clean(l, 600) for l in lines)


def resolved_text(inc: dict[str, Any], now: datetime) -> str:
    opened = parse_time(inc.get("first_seen_at")) or parse_time(inc.get("opened_at"))
    took = ago((now - opened).total_seconds() / 60) if opened else "an unknown time"
    lines = [
        f"[guardian] Resolved: {inc.get('title')}",
        f"It was open from {kuwait(opened)} to {kuwait(now)} ({took}).",
        f"What fixed it: {inc.get('resolved_by')}.",
    ]
    return "\n".join(clean(l, 600) for l in lines)


class Slack:
    """chat.postMessage with SLACK_BOT_TOKEN to SLACK_HEALTH_CHANNEL."""

    def __init__(self, token: str, channel: str, *, post=None):
        self.token = token
        self.channel = channel
        self._post = post

    @property
    def ready(self) -> bool:
        return bool(self.token and self.channel)

    def send(self, text: str) -> Optional[str]:
        """Posts `text`. Returns None when it went, or the reason it did not."""
        if not self.ready:
            return "SLACK_BOT_TOKEN or SLACK_HEALTH_CHANNEL is not set"
        body = {"channel": self.channel, "text": text[:3800], "unfurl_links": False, "unfurl_media": False}
        if self._post:
            return self._post(body)
        try:
            r = http.request("POST", "https://slack.com/api/chat.postMessage",
                             headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json; charset=utf-8"},
                             json_body=body, timeout=20)
        except http.HttpError as e:
            return clean(e, 160)
        out = r.json() or {}
        if r.status != 200 or not out.get("ok"):
            return f"Slack answered {r.status} {out.get('error')}"
        return None


class Outbox:
    """Collects messages during a scan; the CLI decides whether they go."""

    def __init__(self, slack: Optional[Slack], *, dry_run: bool):
        self.slack = slack
        self.dry_run = dry_run
        self.sent: list[str] = []
        self.held: list[str] = []
        self.errors: list[str] = []

    def post(self, text: str) -> bool:
        if self.dry_run or self.slack is None:
            self.held.append(text)
            return False
        err = self.slack.send(text)
        if err:
            self.errors.append(err)
            return False
        self.sent.append(text)
        return True
