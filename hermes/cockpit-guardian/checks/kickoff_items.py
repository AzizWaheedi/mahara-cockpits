"""Kickoff items as requests (docs/forms/WAVE56-CONTRACT.md 4.20; migration 20261103d): the CSM's Yes or No on each open
kickoff item. The doctor (cockpit_kickoff_items_doctor) checks that every item on is still asked by the kickoff with its
options, that its request type exists, is turned on and raises in one tap, and that cockpit_request_submit still takes
what Yes sends. This check reads the doctor's one-row view with the service key and says each problem in the doctor's
own sentence, so a type turned off in Requests settings or an option renamed by a kickoff redesign is said, never
silent. Report-only: nothing here writes, and no client name or card id is read.

Before the deploy the view is not there: the check reads "Not set up yet" as ok, never as zero. Only an error about the
view itself means that. The view runs the doctor (a plpgsql function) at read time, so once it is deployed a function or
column the doctor calls that changed or is gone answers 42883 or 42703 (PostgREST: 404 or 400, "... does not exist"):
that is the doctor failing, and the check fails with its sentence, never "Not set up yet".
"""
from __future__ import annotations

import re
from typing import Any, Optional

from guard.context import Context, SourceError, is_outage
from guard.model import Check, Result, fail, ok, warn
from guard.redact import clean

RUNBOOK = "RUNBOOK.md, Kickoff items as requests"
VIEW = "cockpit_kickoff_items_doctor_v"
# The doctor's sentence when Yes can no longer reach the submit: every Yes fails, so the check fails.
SUBMIT_BROKEN = "cockpit_request_submit no longer has"

# The view not deployed yet: PostgREST's PGRST205 is about the relation it was asked for, and a 42P01 or a schema-cache
# miss counts only when it names this view. Anything else is an error from inside the doctor.
_VIEW_MISSING = re.compile(
    r"PGRST205|(?:relation|Could not find the table)\W+(?:public\.)?" + VIEW + r"\b", re.I)
# PostgREST's error body: its code, and its message (escaped quotes kept; guard.db keeps 200 characters of the body, so
# the message may be cut, and then it ends in "...").
_CODE = re.compile(r'"code"\s*:\s*"(\w{1,10})"')
_MESSAGE = re.compile(r'"message"\s*:\s*"((?:[^"\\]|\\.)*)("?)')


def _why(e: BaseException) -> str:
    """The doctor's error in a few words: 'function public.x(unknown) does not exist (code 42883)'."""
    raw = str(e)
    msg, code = _MESSAGE.search(raw), _CODE.search(raw)
    if not msg or not msg.group(1).strip():
        return clean(raw, 240)
    text = msg.group(1).replace('\\"', '"') + ("" if msg.group(2) else "...")
    return clean(f"{text} (code {code.group(1)})" if code else text, 240)


def _report(ctx: Context) -> tuple[str, Any]:
    """('missing', None) before the deploy; ('broken', sentence) when the view is there and the doctor could not run;
    ('read', report or None). An outage, or no database door, is raised as before (could not be checked)."""
    try:
        rows = ctx.rows(VIEW, "report", limit=1)
    except SourceError as e:
        if _VIEW_MISSING.search(str(e)):
            return "missing", None
        if ctx.db is None or ctx.db_down or is_outage(e.__cause__):
            raise
        return "broken", _why(e)
    if not rows or not isinstance(rows[0].get("report"), dict):
        return "read", None
    return "read", rows[0]["report"]


def _item(problem: str) -> str:
    """The short name a problem sentence opens with ("WhatsApp sync: ..."), or what it is about."""
    if problem.startswith(SUBMIT_BROKEN):
        return "submit"
    return problem.split(":", 1)[0] if ":" in problem[:40] else "doctor"


def _int(v: Any) -> Optional[int]:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return None


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _texts(v: Any) -> list[str]:
    return [clean(x, 300) for x in v if isinstance(x, str) and x.strip()] if isinstance(v, list) else []


def run_doctor(ctx: Context) -> Result:
    how, rep = _report(ctx)
    if how == "missing":
        return ok("Not set up yet: kickoff items as requests are not deployed (20261103d).")
    if how == "broken":
        stop = "" if rep.endswith(".") else "."
        return fail(f"The kickoff items doctor could not run: {rep}{stop} A function or column it calls changed or is "
                    f"gone, so Yes, No and Today may fail the same way ({RUNBOOK}).", evidence={"error": rep}, items=["doctor"])
    if rep is None:
        return warn(f"The kickoff items doctor ({VIEW}) answered no report, so its checks could not be read.")
    problems = _texts(rep.get("problems"))
    notes = _texts(rep.get("notes"))
    on = [x for x in rep.get("on") or [] if isinstance(x, str)]
    counts = rep.get("counts") if isinstance(rep.get("counts"), dict) else {}
    offered = _int(counts.get("offered"))
    cards = _int(counts.get("cards"))
    evidence = {"on": on, "counts": counts, "problems": problems, "notes": notes, "checked_at": rep.get("checkedAt")}
    items = [_item(p) for p in problems]
    if any(p.startswith(SUBMIT_BROKEN) for p in problems):
        return fail(" ".join(problems), evidence=evidence, items=items)
    if problems:
        return warn(" ".join(problems), evidence=evidence, items=items)
    if not on:
        return ok("Every kickoff item is turned off (forms.kickoff_items), so none is offered.", evidence=evidence)
    if offered is None or cards is None:
        return warn("The kickoff items doctor gave no counts, so how many items wait could not be read.", evidence=evidence)
    waiting = (f"{_plural(offered, 'item')} on {_plural(cards, 'card')} {'waits' if offered == 1 else 'wait'} for a Yes or No."
               if offered else "No kickoff item waits for a Yes or No.")
    tail = f" {' '.join(notes)}" if notes else ""
    return ok(f"{_plural(len(on), 'kickoff item')} on, each raisable in one tap. {waiting}{tail}", evidence=evidence)


CHECKS = (
    Check("kickoff-items", "data", "Kickoff items as requests",
          "Each open kickoff item the CSM answers Yes to raises its request in one tap.", "medium",
          f"{VIEW} (the doctor of 20261103d), over REST with the service key.",
          "Warn: the doctor names a problem (a request type missing, turned off or asking more than the kickoff has, or "
          "an option the kickoff no longer asks, or forms.kickoff_items missing or not a list, so every item is off). "
          "Fail: Yes can no longer reach cockpit_request_submit, or the doctor itself cannot run.",
          run_doctor, owner="the systems manager",
          action=f"Turn the type back on or make its extra question optional in Requests settings, or turn the item off "
                 f"(forms.kickoff_items, set with cockpit_kickoff_items_switch); a changed submit, or a doctor that cannot "
                 f"run, is fixed on a branch ({RUNBOOK}).",
          confirm=1, clear=1),
)
