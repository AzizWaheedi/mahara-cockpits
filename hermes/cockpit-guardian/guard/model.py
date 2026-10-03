"""What a check is, what it returns, and the time helpers every check shares."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

KUWAIT = timezone(timedelta(hours=3))

# What a reading can be. Only warn and fail (and unknown, after a while) open
# an incident. not_deployed and paused are decisions or plans, never errors.
OK = "ok"
WARN = "warn"
FAIL = "fail"
UNKNOWN = "unknown"
NOT_DEPLOYED = "not_deployed"
PAUSED = "paused"
STATUSES = (OK, WARN, FAIL, UNKNOWN, NOT_DEPLOYED, PAUSED)
BAD = (WARN, FAIL)

SEVERITIES = ("critical", "high", "medium", "low")
OWNERS = ("the CEO", "Hermes", "the systems manager", "the creative director", "whoever deployed",
          "whoever runs sessions")


@dataclass
class Result:
    status: str
    summary: str                         # the reading, one plain sentence
    since: Optional[datetime] = None     # broken since, when the source says so
    evidence: dict[str, Any] = field(default_factory=dict)
    action: Optional[str] = None         # overrides the check's human action
    caused_by: Optional[str] = None      # another check id whose incident covers this one
    coverage_gap: bool = False           # unknown because an optional key or door is missing here
    data: dict[str, Any] = field(default_factory=dict)  # for the fix, never shown

    def __post_init__(self) -> None:
        if self.status not in STATUSES:
            raise ValueError(f"unknown status {self.status}")


@dataclass
class FixOutcome:
    ok: bool
    detail: str
    done: bool = False                   # the fix itself resolves the incident (no recheck needed)


@dataclass
class Fix:
    name: str
    describe: str                        # what it does, as a plain clause ("start one catch-up run of recordings")
    apply: Callable[[Any, "Result"], FixOutcome]
    max_attempts: int = 5


@dataclass
class Check:
    id: str
    area: str
    name: str                            # a short title ("Claude sign-in on the VPS")
    means: str                           # what it means, one plain sentence
    severity: str                        # how bad a failure is: critical, high, medium, low
    reads: str                           # how it reads
    threshold: str                       # when it turns warn or fail
    run: Callable[[Any], Result]
    fix: Optional[Fix] = None
    on_resolve: Optional[Fix] = None     # run once when the incident clears (fix mode only)
    owner: str = "the CEO"
    action: str = ""                     # what a person must do
    catalogue: str = ""                  # failure catalogue ids (H1, S4, ...)
    urgent: bool = False                 # alert at any hour, Friday too
    confirm: int = 1                     # bad readings in a row before an incident opens
    quiet_because: Optional[str] = None  # convex | hermes | sales-watchdog: someone else already alerts
    alert: bool = True                   # False: the daily summary carries it, never its own message

    def __post_init__(self) -> None:
        if self.severity not in SEVERITIES:
            raise ValueError(f"{self.id}: severity {self.severity}")
        if not re.match(r"^[a-z][a-z0-9-]{2,60}$", self.id):
            raise ValueError(f"bad check id {self.id}")


# ---- time ------------------------------------------------------------------

def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(t: Optional[datetime]) -> Optional[str]:
    if t is None:
        return None
    return t.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


_TZ_SHORT = re.compile(r"([+-]\d{2})$")
_FRACTION = re.compile(r"\.(\d{1,6})")


def parse_time(v: Any) -> Optional[datetime]:
    """ISO, Postgres text (2026-10-03 20:20:51.312+03), epoch seconds or milliseconds."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        secs = float(v) / 1000.0 if v > 10_000_000_000 else float(v)
        return datetime.fromtimestamp(secs, timezone.utc)
    s = str(v).strip().replace("Z", "+00:00")
    s = _TZ_SHORT.sub(r"\1:00", s)
    s = _FRACTION.sub(lambda m: "." + m.group(1).ljust(6, "0"), s, count=1)
    try:
        t = datetime.fromisoformat(s)
    except ValueError:
        return None
    return t.astimezone(timezone.utc) if t.tzinfo else t.replace(tzinfo=timezone.utc)


def age_min(v: Any, now: datetime) -> Optional[float]:
    t = parse_time(v)
    if t is None:
        return None
    return (now - t).total_seconds() / 60.0


def ago(minutes: Optional[float]) -> str:
    if minutes is None:
        return "an unknown time"
    m = max(0.0, minutes)
    if m < 1:
        return "under a minute"
    if m < 90:
        return f"{int(round(m))} min"
    if m < 48 * 60:
        return f"{m / 60:.1f} h"
    return f"{m / 1440:.1f} days"


def kuwait(t: Optional[datetime]) -> str:
    if t is None:
        return "an unknown time"
    k = t.astimezone(KUWAIT)
    return f"{k.day} {k.strftime('%b %H:%M')} Kuwait time"


def ok(summary: str, **kw: Any) -> Result:
    return Result(OK, summary, **kw)


def warn(summary: str, **kw: Any) -> Result:
    return Result(WARN, summary, **kw)


def fail(summary: str, **kw: Any) -> Result:
    return Result(FAIL, summary, **kw)


def unknown(summary: str, **kw: Any) -> Result:
    return Result(UNKNOWN, summary, **kw)


def not_deployed(summary: str, **kw: Any) -> Result:
    return Result(NOT_DEPLOYED, summary, **kw)


def paused(summary: str, **kw: Any) -> Result:
    return Result(PAUSED, summary, **kw)
