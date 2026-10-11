"""The CSM call store (hermes/csm-calls, migration 20261011c): every call, call form and media buyer change
per client reaches the client success cockpit, day by day. Report-only: the guardian names what is missing,
a person (or the worker's next run) fixes it.

Aziz, 2026-10-11: "make sure that it never breaks and it's actually syncing."
"""
from __future__ import annotations

import re
from datetime import timedelta

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, kuwait, ok, parse_time, unknown, warn
from guard.redact import brief_error, clean

# key: (minutes its last good run may be old, what it carries)
CSM_KEYS = {
    "csm-ghl-calls": (45, "booked calls from GoHighLevel"),
    "csm-checkin-form": (45, "the 1-1 call notes form"),
    "csm-forms-history": (45, "the onboarding, kickoff and Blueprint forms"),
    "csm-fathom": (45, "Fathom recordings"),
    "csm-meta-activities": (45, "Meta's activity log"),
    "csm-media-changes": (45, "media buyer changes"),
    "csm-eod-mentions": (45, "team EODs that mention a client"),
    "csm-reconcile": (26 * 60, "the daily source-against-store check"),
}
UNMATCHED_MAX = 0.20
CALL_GAP_DAYS = 21
FORM_MAX_DAYS = 7
EVIDENCE_MIN = 0.70
CHANGE_GAP_DAYS = 3
RUNBOOK = "hermes/csm-calls/RUNBOOK.md"


def _tight(s: object) -> str:
    return re.sub(r"[^\w]", "", str(s or "").lower())


def run_freshness(ctx: Context) -> Result:
    rows = {r.get("key"): r for r in ctx.rows("cockpit_sync_state", "key,ok,note,last_run_at,last_ok_at",
                                              where=[("key", "in", list(CSM_KEYS))])}
    problems, names, since = [], [], []
    for key, (limit, label) in CSM_KEYS.items():
        r = rows.get(key)
        if r is None:
            problems.append(f"{label} ({key}) has never run")
            names.append(f"{key}-never-run")
            continue
        if r.get("ok") is False:
            problems.append(f"{label} failed its last run: {brief_error(r.get('note'), 140)}")
            names.append(f"{key}-failing")
        age = age_min(r.get("last_ok_at"), ctx.now)
        if age is None or age > limit:
            problems.append(f"{label} has had no good run for {ago(age)} (limit {ago(limit)})")
            names.append(f"{key}-stale")
            since.append(parse_time(r.get("last_ok_at")) or parse_time(r.get("last_run_at")))
    ev = {k: {"ok": r.get("ok"), "last_ok_at": r.get("last_ok_at"), "note": clean(r.get("note"), 160)}
          for k, r in rows.items()}
    if problems:
        known = [t for t in since if t is not None]
        return fail("CSM call sync: " + "; ".join(problems) + ".", since=min(known) if known else None,
                    evidence=ev, items=sorted(names),
                    action=f"Read ~/.csm-calls/cron.log on the VPS and the row's note; {RUNBOOK} says how to rerun "
                           "each source.")
    return ok(f"All {len(CSM_KEYS)} CSM call sources synced on time.", evidence=ev)


def _live_clients(ctx: Context) -> list[dict]:
    out = []
    for r in ctx.rows("cockpit_csm_sources", "data", where=[("table_name", "eq", "clients")]):
        d = r.get("data") or {}
        if d.get("bucket") in ("management", "onboarding") and d.get("taskId"):
            out.append(d)
    return out


def run_coverage(ctx: Context) -> Result:
    """Every live client (Active and onboarding) has a call from any source in the last 21 days."""
    clients = _live_clients(ctx)
    if not clients:
        return unknown("The client roster lists no live client.")
    since = (ctx.now - timedelta(days=CALL_GAP_DAYS)).isoformat()
    calls = ctx.rows("cockpit_csm_calls", "task_id,starts_at,status",
                     where=[("starts_at", "gte", since), ("starts_at", "lte", ctx.now.isoformat())])
    seen = {c.get("task_id") for c in calls if c.get("task_id") and c.get("status") not in ("cancelled", "gone")}
    missing = sorted(str(c.get("name")) for c in clients if c.get("taskId") not in seen)
    ev = {"live": len(clients), "with_call": len(clients) - len(missing), "missing": missing}
    if missing:
        return warn(f"{len(missing)} of {len(clients)} live clients have no call in {CALL_GAP_DAYS} days in any source: "
                    f"{', '.join(missing[:12])}{'…' if len(missing) > 12 else ''}.", evidence=ev,
                    items=[_tight(m) for m in missing],
                    action="Book them, or check the calls happened off GoHighLevel and unrecorded (log them in the "
                           "cockpit so the history is true).")
    return ok(f"All {len(clients)} live clients have a call within {CALL_GAP_DAYS} days.", evidence=ev)


def run_unmatched(ctx: Context) -> Result:
    since = (ctx.now - timedelta(days=7)).isoformat()
    calls = ctx.rows("cockpit_csm_calls", "id,task_id,source",
                     where=[("starts_at", "gte", since), ("starts_at", "lte", ctx.now.isoformat()),
                            ("source", "in", ["ghl_appointment", "fathom", "checkin_form"])])
    if not calls:
        return unknown("No call in the last 7 days to measure.")
    un = [c for c in calls if not c.get("task_id")]
    share = len(un) / len(calls)
    ev = {"calls": len(calls), "unmatched": len(un), "share": round(share, 3)}
    if share > UNMATCHED_MAX:
        return warn(f"{len(un)} of {len(calls)} calls in the last 7 days ({share:.0%}) matched no client, over the "
                    f"{UNMATCHED_MAX:.0%} line.", evidence=ev,
                    action="Work the 'matched no client' queue on a client page; a recurring cause usually means a "
                           "GoHighLevel contact without its Client ID field.")
    return ok(f"{len(un)} of {len(calls)} calls in the last 7 days matched no client ({share:.0%}).", evidence=ev)


def run_checkin_form(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_csm_call_forms", "submitted_at", where=[("form_id", "eq", "fRokTITH")],
                    order="submitted_at.desc", limit=1)
    if not rows:
        return fail("No 1-1 call notes form is stored.", action=f"Run the typeform source by hand ({RUNBOOK}).")
    age = age_min(rows[0].get("submitted_at"), ctx.now)
    if age is None or age > FORM_MAX_DAYS * 1440:
        return warn(f"The newest 1-1 call notes form came in {ago(age)} ago (limit {FORM_MAX_DAYS} days): calls are "
                    "happening without notes, or the form stopped reaching the store.",
                    since=parse_time(rows[0].get("submitted_at")),
                    action="Ask the CSMs to send the 1-1 form after every call; if they did, check Typeform fRokTITH "
                           "against csm-checkin-form.")
    return ok(f"The newest 1-1 call notes form came in {ago(age)} ago.")


def run_evidence(ctx: Context) -> Result:
    """Held calls in the last 7 days with a recording or a 1-1 form linked."""
    since = (ctx.now - timedelta(days=7)).isoformat()
    appts = ctx.rows("cockpit_csm_calls", "id,status,ends_at,starts_at",
                     where=[("source", "eq", "ghl_appointment"), ("task_id", "neq", None), ("starts_at", "gte", since),
                            ("starts_at", "lte", ctx.now.isoformat()), ("status", "in", ["confirmed", "showed", "held"])])
    if not appts:
        return unknown("No held call in the last 7 days to measure.")
    ids = {a["id"] for a in appts}
    rec = {c.get("linked_call_id") for c in ctx.rows("cockpit_csm_calls", "linked_call_id",
                                                     where=[("source", "eq", "fathom"), ("starts_at", "gte", since)])}
    forms = {f.get("linked_call_id") for f in ctx.rows("cockpit_csm_call_forms", "linked_call_id",
                                                       where=[("submitted_at", "gte", since)])}
    covered = ids & (rec | forms)
    share = len(covered) / len(ids)
    ev = {"held": len(ids), "with_evidence": len(covered), "share": round(share, 3)}
    if share < EVIDENCE_MIN:
        return warn(f"Only {len(covered)} of {len(ids)} held calls in the last 7 days ({share:.0%}) have a recording "
                    f"or a 1-1 form, under the {EVIDENCE_MIN:.0%} line.", evidence=ev,
                    action="CSMs share their Fathom recordings with the team and send the 1-1 form after each call.")
    return ok(f"{len(covered)} of {len(ids)} held calls in the last 7 days have a recording or a 1-1 form.",
              evidence=ev)


def run_changes(ctx: Context) -> Result:
    """Every client with spend has a media buyer change in the last 3 days."""
    spenders = {}
    for c in ctx.rows("cockpit_campaigns", "client_name,spend_7d", where=[("spend_7d", "gt", 0)]):
        spenders[_tight(c.get("client_name"))] = c.get("client_name")
    clients = {_tight(d.get("name")): d for d in _live_clients(ctx)}
    spend_clients = [clients[k] for k in spenders if k in clients]
    if not spend_clients:
        return unknown("No live client with ad spend in the last 7 days could be matched.")
    since = (ctx.now - timedelta(days=CHANGE_GAP_DAYS)).isoformat()
    changed = {r.get("task_id") for r in ctx.rows("cockpit_csm_changes", "task_id", where=[("at", "gte", since)])}
    missing = sorted(str(c.get("name")) for c in spend_clients if c.get("taskId") not in changed)
    ev = {"spending": len(spend_clients), "missing": missing}
    if missing:
        return warn(f"{len(missing)} of {len(spend_clients)} clients with spend have no media buyer change in "
                    f"{CHANGE_GAP_DAYS} days: {', '.join(missing[:10])}{'…' if len(missing) > 10 else ''}. Either the "
                    "change feed is stale or nobody touched these campaigns.", evidence=ev,
                    items=[_tight(m) for m in missing],
                    action="Read csm-meta-activities and csm-media-changes in cockpit_sync_state first.")
    return ok(f"All {len(spend_clients)} clients with spend have a change in {CHANGE_GAP_DAYS} days.", evidence=ev)


def run_daily_line(ctx: Context) -> Result:
    """One line for the daily summary: calls synced yesterday, unmatched, stale sources."""
    try:
        rec = ctx.rows("cockpit_sync_state", "ok,note,detail", where=[("key", "eq", "csm-reconcile")])
        stale = [k for k, r in ((str(r.get("key")), r) for r in ctx.rows(
            "cockpit_sync_state", "key,ok,last_ok_at", where=[("key", "in", list(CSM_KEYS))]))
            if k in CSM_KEYS and (r.get("ok") is False or (age_min(r.get("last_ok_at"), ctx.now) or 1e9) > CSM_KEYS[k][0])]
    except SourceError:
        return unknown("The CSM call store could not be read.")
    detail = (rec[0].get("detail") or {}) if rec else {}
    s = detail.get("summary") or {}
    line = (f"CSM calls: {s.get('callsYesterday', '?')} synced yesterday, {s.get('unmatched', '?')} unmatched, "
            f"{len(stale)} stale source(s){': ' + ', '.join(stale) if stale else ''}.")
    return ok(line) if not stale and (not rec or rec[0].get("ok") is not False) else warn(line)


CHECKS = [
    Check(id="csm-calls-sync", area="workers", name="CSM call sync",
          means="Calls, call forms, recordings and media buyer changes reach the client success cockpit.",
          severity="high", reads="cockpit_sync_state keys " + ", ".join(CSM_KEYS),
          threshold="Any key with ok false, never run, or no good run within 45 min (26 h for csm-reconcile): fail.",
          run=run_freshness, owner="Hermes", confirm=2,
          action=f"Read ~/.csm-calls/cron.log; {RUNBOOK}."),
    Check(id="csm-calls-coverage", area="workers", name="Every live client has a recent call",
          means=f"Every Active or onboarding client has a call from any source within {CALL_GAP_DAYS} days.",
          severity="medium", reads="cockpit_csm_sources clients against cockpit_csm_calls",
          threshold=f"Any live client with no call in {CALL_GAP_DAYS} days: warn.", run=run_coverage,
          owner="the CSM lead", confirm=2, action="Book the listed clients."),
    Check(id="csm-calls-unmatched", area="workers", name="Calls matched to a client",
          means="Calls land on a client page rather than in the unmatched queue.", severity="medium",
          reads="cockpit_csm_calls over 7 days", threshold=f"Over {UNMATCHED_MAX:.0%} unmatched: warn.",
          run=run_unmatched, owner="the CSM lead", confirm=3,
          action="Work the queue; fix the Client ID field on the GoHighLevel contacts it names."),
    Check(id="csm-checkin-form", area="workers", name="1-1 call notes keep coming",
          means="The 1-1 call notes form is sent after calls and reaches the store.", severity="medium",
          reads="max(submitted_at) of cockpit_csm_call_forms fRokTITH",
          threshold=f"Older than {FORM_MAX_DAYS} days: warn.", run=run_checkin_form, owner="the CSM lead",
          confirm=2, action="Ask the CSMs for their notes; compare Typeform with the store."),
    Check(id="csm-call-evidence", area="workers", name="Held calls have a recording or notes",
          means="Most held calls carry a Fathom recording or a 1-1 form.", severity="low",
          reads="held GoHighLevel calls over 7 days and their linked recordings and forms",
          threshold=f"Under {EVIDENCE_MIN:.0%}: warn.", run=run_evidence, owner="the CSM lead", alert=False),
    Check(id="csm-change-feed", area="workers", name="Media buyer changes reach the client page",
          means="Each client with spend shows a recent media buyer change.", severity="medium",
          reads="cockpit_campaigns spend_7d against cockpit_csm_changes",
          threshold=f"Any client with spend and no change in {CHANGE_GAP_DAYS} days: warn.", run=run_changes,
          owner="the media buyer", confirm=3, alert=False),
    Check(id="csm-daily-line", area="workers", name="CSM calls, yesterday",
          means="One line for the daily summary.", severity="low",
          reads="cockpit_sync_state csm-reconcile and the csm-* keys", threshold="Any stale source: warn.",
          run=run_daily_line, owner="Hermes", alert=False),
]
