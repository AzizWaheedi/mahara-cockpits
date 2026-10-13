"""Alerts in plain sentences: what broke, since when, what the guardian
already tried, and what a person must do.

Rules (catalogue G1):
- one message when an incident opens and one when it resolves, and at most
  one message per check every 6 hours (a check that flaps is held);
- one more when an open incident gets worse: its level rises (an urgent
  check skips the 6-hour hold for that) or a new name joins what is failing;
- at most 3 new incidents posted one by one per run; the rest go in one
  digest line, so an outage never floods the channel;
- non-urgent messages go out Saturday to Thursday, 09:00 to 21:00 Kuwait
  time; outside that they wait for the next scan inside it. Urgent ones
  (the CEO sections stale, the VPS or Supabase down, WhatsApp double sends)
  go any time;
- an incident someone else already alerts on (the Hermes monitors, the sales
  watchdog) is recorded but not posted while that system is healthy;
- never a secret, a phone number, an email or a lead's name: every sentence
  goes through redact.clean and evidence is never posted.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, Optional

from . import http
from .model import KUWAIT, ago, kuwait, parse_time
from .redact import clean

THROTTLE = timedelta(hours=6)
MAX_OPENINGS = 3            # posted one by one in a run; the rest in one digest
MAX_RESOLVED = 3
LEVEL_WORDS = {"fail": "Broken", "warn": "Warning", "unknown": "Could not be checked"}
LEVEL_ICONS = {"fail": "🔴", "warn": "🟠", "unknown": "⚪"}
# Owners tagged in Slack on their own incidents (13 Oct 2026: Muhammed). Every other owner stays plain text.
OWNER_MENTIONS = {"the systems manager": "U0AS90SHMH8"}
NO_FIX = "nothing; there is no safe automatic fix for this"


def in_hours(now: datetime) -> bool:
    k = now.astimezone(KUWAIT)
    return k.weekday() != 4 and 9 <= k.hour < 21  # Friday is weekday 4


def _since(inc: dict[str, Any], now: datetime) -> str:
    t = parse_time(inc.get("first_seen_at"))
    if t is None:
        return "an unknown time"
    return f"{kuwait(t)} ({ago((now - t).total_seconds() / 60)})"


def tried_sentence(inc: dict[str, Any], check: Any, mode: str) -> str:
    if inc.get("fix_capped"):
        return clean(inc.get("fix_note") or "its fix ran 3 times in 24 hours and the cause is still there", 300)
    attempts = inc.get("fix_attempts") or []
    real = [a for a in attempts if not a.get("planned") and not a.get("pending")]
    if real:
        a = real[-1]
        when = kuwait(parse_time(a.get("at")))
        more = f" ({len(real)} attempts so far)" if len(real) > 1 else ""
        return f"{a.get('fix')} at {when}{more}: {a.get('detail')}"
    if check is not None and check.fix is not None:
        if mode != "fix":
            return f"nothing yet; it is in report-only mode, so it did not {check.fix.describe}"
        return f"nothing yet; it will {check.fix.describe} on its next run"
    return NO_FIX


def owner_tag(text: Any, limit: int = 600) -> str:
    """Cleans `text`, then turns every owner who asked to be tagged into a Slack mention."""
    out = clean(text, limit)
    for label, uid in OWNER_MENTIONS.items():
        out = re.sub(re.escape(label), f"<@{uid}>", out, flags=re.IGNORECASE)
    return out


def _message(icon: str, head: str, inc: dict[str, Any], check: Any, now: datetime, mode: str,
             changed: str = "") -> str:
    """Slack mrkdwn (13 Oct 2026): a bold headline, what it reads, what the guardian did (only when it did
    something), what a person must do, then one grey line with the owner, since when and the check id."""
    lines = [f"{icon} *{clean(head, 200)}*"]
    if changed:
        lines.append(f"*Changed:* {clean(changed, 400)}.")
    lines.append(clean(inc.get("detail"), 600))
    tried = tried_sentence(inc, check, mode)
    if tried != NO_FIX:
        lines.append(f"*Guardian:* {clean(tried, 400)}.")
    lines.append(f"*Do:* {owner_tag(inc.get('action') or 'read this check in python3 guardian.py report on the VPS')}")
    lines.append(f"_Owner: {owner_tag(inc.get('owner') or 'nobody named')} · since {_since(inc, now)} · "
                 f"{clean(inc.get('check_id'), 80)}_")
    return "\n".join(l for l in lines if l)


def opened_text(inc: dict[str, Any], check: Any, now: datetime, mode: str) -> str:
    level = inc.get("level")
    return _message(LEVEL_ICONS.get(level, "⚪"), f"{LEVEL_WORDS.get(level, 'Problem')}: {inc.get('title')}",
                    inc, check, now, mode)


def worse_text(inc: dict[str, Any], check: Any, now: datetime, mode: str, changes: list[str]) -> str:
    return _message(LEVEL_ICONS.get(inc.get("level"), "⚪"), f"Worse: {inc.get('title')}", inc, check, now, mode,
                    "; ".join(changes))


def better_text(inc: dict[str, Any], check: Any, now: datetime, mode: str, changes: list[str]) -> str:
    """Still open, but no longer broken: without it the last word in the channel stayed 'Worse' for hours
    after the cause had cleared (Ad billing alerts, 12 Oct 2026)."""
    return _message(LEVEL_ICONS.get(inc.get("level"), "⚪"), f"Better: {inc.get('title')}", inc, check, now, mode,
                    "; ".join(changes))


def digest_text(incs: list[dict[str, Any]]) -> str:
    lines = [f"*{len(incs)} more problems opened in the same scan:*"]
    for i in incs:
        level = i.get("level")
        lines.append(f"• {LEVEL_ICONS.get(level, '⚪')} " + owner_tag(
            f"{i.get('title')} ({LEVEL_WORDS.get(level, 'problem').lower()}, {i.get('owner')})"))
    lines.append("_Each is in `python3 guardian.py report` on the VPS, with what it read and what to do._")
    return "\n".join(lines)


def _resolved_title(text: str) -> str:
    first = text.splitlines()[0] if text else ""
    m = re.match(r"^(?:✅ \*Resolved: (.*)\*|\[guardian\] Resolved: (.*))$", first)  # the second: queued before 13 Oct
    return (m.group(1) or m.group(2)) if m else first


def resolved_digest_text(texts: list[str]) -> str:
    return clean(f"✅ *Also resolved:* {'; '.join(_resolved_title(t) for t in texts)}.", 3000)


def unwritable_text(home: str, error: str) -> str:
    return "\n".join([
        clean(f"🔴 *Broken: the guardian cannot write {home}*", 300),
        clean(f"{error}. Until it can, it reads only: it posts nothing else and fixes nothing, because every "
              "throttle and backoff lives in that folder.", 600),
        clean(f"*Do:* free space on the VPS (df -h; du -xh ~ | sort -h | tail), then check {home} is writable by "
              "hermes.", 400),
        "_Owner: Hermes · this message repeats at most every 6 hours_",
    ])


def resolved_text(inc: dict[str, Any], now: datetime) -> str:
    opened = parse_time(inc.get("first_seen_at")) or parse_time(inc.get("opened_at"))
    took = ago((now - opened).total_seconds() / 60) if opened else "an unknown time"
    return "\n".join([
        clean(f"✅ *Resolved: {inc.get('title')}*", 300),
        clean(f"_Open {took}, from {kuwait(opened)} to {kuwait(now)} · {inc.get('resolved_by')}_", 600),
    ])


class Slack:
    """chat.postMessage with SLACK_BOT_TOKEN to SLACK_HEALTH_CHANNEL."""

    def __init__(self, token: str, channel: str, *, post=None):
        self.token = token
        self.channel = channel
        self._post = post
        self.unreachable = False         # set by a network error: later posts in this run are not tried

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
            if e.status == 0 or e.status >= 500:
                self.unreachable = True
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

    @property
    def broken(self) -> bool:
        """Slack did not answer earlier in this run: keep the rest queued, do not wait on it again."""
        return bool(self.slack is not None and self.slack.unreachable)

    def post(self, text: str) -> bool:
        if self.dry_run or self.slack is None:
            self.held.append(text)
            return False
        if self.broken:
            return False
        err = self.slack.send(text)
        if err:
            self.errors.append(err)
            return False
        self.sent.append(text)
        return True
