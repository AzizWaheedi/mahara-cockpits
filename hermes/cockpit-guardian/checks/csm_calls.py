"""The CSM call store (hermes/csm-calls, migration 20261011c): every call, call form and media buyer change
per client reaches the client success cockpit, day by day, and since Stage 2a Fathom's webhook pushes each
Customer Success recording too (supabase/functions/fathom-webhook). Report-only: the guardian names what is
missing, a person (or the worker's next run) fixes it.

Aziz, 2026-10-11: "make sure that it never breaks and it's actually syncing."
"""
from __future__ import annotations

import re
from datetime import timedelta

from guard.context import Context, SourceError
from guard.model import KUWAIT, Check, Result, age_min, ago, fail, kuwait, ok, parse_time, unknown, warn
from guard.redact import brief_error, clean

# key: (minutes its last good run may be old, what it carries)
CSM_KEYS = {
    "csm-ghl-calls": (45, "booked calls from GoHighLevel"),
    "csm-checkin-form": (45, "the 1-1 call notes form"),
    "csm-forms-history": (45, "the onboarding, kickoff and Blueprint forms"),
    "csm-forms-record": (45, "kickoff and Blueprint records in the forms tables"),
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
LATE_DAYS = 14
KICKOFF_GRACE_MIN = 30
RUNBOOK = "hermes/csm-calls/RUNBOOK.md"
RECORD_KEY = "csm-forms-record"


def _tight(s: object) -> str:
    return re.sub(r"[^\w]", "", str(s or "").lower())


def _record_errors(r: dict | None) -> str | None:
    """The sentence for rows the forms record sweep could not record on its last read, or None. The row stays ok on
    purpose (Z15), so without this a sweep that fails on every row would read as synced on time. A row that failed reads
    as failed, and a count that is not a whole number is not read, never taken as 0 or as errors."""
    detail = r.get("detail") if r and r.get("ok") is True and isinstance(r.get("detail"), dict) else {}
    n = detail.get("errors")
    if not isinstance(n, int) or isinstance(n, bool) or n <= 0:
        return None
    code = detail.get("firstError")
    first = f" (first error {code})" if isinstance(code, str) and re.fullmatch(r"[0-9A-Z]{5}", code) else ""
    return f"{n} kickoff or Blueprint row{' was' if n == 1 else 's were'} not recorded in the forms tables on the last read{first}"


def run_freshness(ctx: Context) -> Result:
    rows = {r.get("key"): r for r in ctx.rows("cockpit_sync_state", "key,ok,note,detail,last_run_at,last_ok_at",
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
    not_recorded = _record_errors(rows.get(RECORD_KEY))
    if not_recorded:
        ev[RECORD_KEY]["errors"] = rows[RECORD_KEY]["detail"]["errors"]
    if problems:
        if not_recorded:
            problems.append(not_recorded)
            names.append(f"{RECORD_KEY}-errors")
        known = [t for t in since if t is not None]
        return fail("CSM call sync: " + "; ".join(problems) + ".", since=min(known) if known else None,
                    evidence=ev, items=sorted(names),
                    action=f"Read ~/.csm-calls/cron.log on the VPS and the row's note; {RUNBOOK} says how to rerun "
                           "each source.")
    if not_recorded:
        return warn(f"CSM call sync: {not_recorded}; every source synced on time.", evidence=ev,
                    items=[f"{RECORD_KEY}-errors"],
                    action="Read csm-forms-record's note. Nothing was sent and the next read tries again; still there an "
                           "hour later, the root RUNBOOK's Kickoff and Blueprint records section has the two queries that "
                           "find the row.")
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


def _cutover(ctx: Context):
    """When the 1-1 notes moved to the cockpit, or None while Typeform still takes them. Native only, and read as the
    database reads it (cockpit_form_native_since: provider_since, else the row's updated_at). No checkin row in the
    registry is could-not-be-checked, never "not switched yet"."""
    rows = ctx.rows("cockpit_forms", "provider,provider_since,updated_at", where=[("key", "eq", "checkin")], limit=1)
    if not rows:
        raise SourceError("The forms registry has no checkin row.")
    if rows[0].get("provider") != "native":
        return None
    return parse_time(rows[0].get("provider_since")) or parse_time(rows[0].get("updated_at"))


def _candidates_without_notes(ctx: Context, cutover) -> list[dict]:
    """Impromptu recordings since the cut-over, over a day old, still on no client. It reads the calls alone, plain
    columns only: a native send whose recording was a candidate delivers call_match, whose attach sets candidate
    false (20261027f_forms_core.sql), so a candidate still standing after 24 hours has no notes. It never reads
    cockpit_form_responses, whose answers hold the CSM's notes (docs/forms/STAGE2B-CONTRACT.md 4.10)."""
    rows = ctx.rows("cockpit_csm_calls", "id,source_id,starts_at,status,settled_reason",
                    where=[("source", "eq", "fathom"), ("candidate", "eq", True), ("starts_at", "gte", cutover.isoformat()),
                           ("starts_at", "lt", (ctx.now - timedelta(hours=24)).isoformat())], order="starts_at.asc")
    return [r for r in rows if r.get("status") != "gone" and not r.get("settled_reason")]


def run_unmatched(ctx: Context) -> Result:
    """Calls with no client over 7 days. An impromptu recording still waiting for its client (a candidate) and one
    the CSM set aside as not a 1-1 call (settled) are left out of the share and counted in the evidence
    (docs/forms/STAGE2-CONTRACT.md section 9): the CSM's impromptu calls alone would push it over the line.
    candidates_without_notes_24h is csm-impromptu-notes' count, null before the cut-over."""
    since = (ctx.now - timedelta(days=7)).isoformat()
    cutover = _cutover(ctx)
    without_notes = len(_candidates_without_notes(ctx, cutover)) if cutover else None
    rows = ctx.rows("cockpit_csm_calls", "id,task_id,source,candidate,settled_reason",
                    where=[("starts_at", "gte", since), ("starts_at", "lte", ctx.now.isoformat()),
                           ("source", "in", ["ghl_appointment", "fathom", "checkin_form"])])
    candidates = [c for c in rows if c.get("candidate") is True]
    settled = [c for c in rows if c.get("candidate") is not True and c.get("settled_reason")]
    calls = [c for c in rows if c.get("candidate") is not True and not c.get("settled_reason")]
    if not calls:
        return unknown("No call in the last 7 days to measure.",
                       evidence={"calls": 0, "candidates": len(candidates), "settled": len(settled),
                                 "candidates_without_notes_24h": without_notes})
    un = [c for c in calls if not c.get("task_id")]
    share = len(un) / len(calls)
    ev = {"calls": len(calls), "unmatched": len(un), "share": round(share, 3), "candidates": len(candidates),
          "settled": len(settled), "candidates_without_notes_24h": without_notes}
    if share > UNMATCHED_MAX:
        return warn(f"{len(un)} of {len(calls)} calls in the last 7 days ({share:.0%}) matched no client, over the "
                    f"{UNMATCHED_MAX:.0%} line.", evidence=ev,
                    action="Work the 'matched no client' queue on a client page; a recurring cause usually means a "
                           "GoHighLevel contact without its Client ID field.")
    return ok(f"{len(un)} of {len(calls)} calls in the last 7 days matched no client ({share:.0%}).", evidence=ev)


def _late_forms(ctx: Context, cutover) -> list[dict]:
    """1-1 notes sent in Typeform after the switch-over, newest first (docs/forms/STAGE2B-CONTRACT.md 4.9). No answers:
    the late row's notes are the person's to re-enter."""
    since = max(cutover, ctx.now - timedelta(days=LATE_DAYS)).isoformat()
    return ctx.rows("cockpit_csm_call_forms", "token,task_id,typed_client,submitted_at",
                    where=[("form_kind", "eq", "checkin_late"), ("submitted_at", "gte", since)],
                    order="submitted_at.desc")


def _late_clients(ctx: Context, late: list[dict]) -> list[str]:
    """Each late form's client as the board names it, else as typed. A form naming neither says so, never a blank."""
    board = {d.get("taskId"): d.get("name") for d in (r.get("data") or {} for r in ctx.rows(
        "cockpit_csm_sources", "data", where=[("table_name", "eq", "clients")]))}
    return sorted({clean(board.get(f.get("task_id")) or f.get("typed_client"), 60) or "no client named" for f in late})


def run_checkin_form(ctx: Context) -> Result:
    # By kind, not by form: the Typeform fRokTITH rows today, the cockpit's own cockpit-checkin rows after the
    # cut-over (docs/forms/STAGE2-CONTRACT.md 1.3). Freshness reads checkin only; a late Typeform form is its own
    # reading (4.9, Z15: the worker's row stays ok, so this warning is where a person hears of it).
    rows = ctx.rows("cockpit_csm_call_forms", "submitted_at", where=[("form_kind", "eq", "checkin")],
                    order="submitted_at.desc", limit=1)
    if not rows:
        return fail("No 1-1 call notes form is stored.", action=f"Run the typeform source by hand ({RUNBOOK}).")
    age = age_min(rows[0].get("submitted_at"), ctx.now)
    stale = age is None or age > FORM_MAX_DAYS * 1440
    old = (f"The newest 1-1 call notes form came in {ago(age)} ago (limit {FORM_MAX_DAYS} days): calls are happening "
           "without notes, or the form stopped reaching the store.")
    cutover = _cutover(ctx)
    late = _late_forms(ctx, cutover) if cutover else []
    if late:
        clients = _late_clients(ctx, late)
        newest = parse_time(late[0].get("submitted_at"))
        n = len(late)
        said = "1 1-1 note" if n == 1 else f"{n} 1-1 notes"
        sentence = (f"{said} arrived in Typeform after the switch-over, newest {kuwait(newest)}: "
                    f"{', '.join(clients[:12])}{'…' if len(clients) > 12 else ''}. Re-enter them in the 1-1 notes in the "
                    "cockpit and check that fRokTITH is closed.")
        return warn(sentence + (f" {old}" if stale else ""), since=parse_time(late[-1].get("submitted_at")),
                    evidence={"cutoverAt": cutover.isoformat(), "late": n, "newest": late[0].get("submitted_at"),
                              "clients": clients[:20], "stale": stale},
                    items=[str(f.get("token")) for f in late],
                    action="Late Typeform 1-1 notes in RUNBOOK.md says what to do with each one.")
    if stale:
        return warn(old, since=parse_time(rows[0].get("submitted_at")),
                    action="Ask the CSMs to send the 1-1 form after every call; if they did, check Typeform fRokTITH "
                           "against csm-checkin-form.")
    return ok(f"The newest 1-1 call notes form came in {ago(age)} ago.",
              evidence={"cutoverAt": cutover.isoformat() if cutover else None, "late": 0 if cutover else None})


PARITY_DAYS = 7
PARITY_FIELDS = {"lastNoteOn": "the note's day", "defcon": "DEFCON", "priority": "priority", "notes": "the commitments"}
PARITY_ACTION = ("Compare the client's newest fRokTITH response with cockpit_csm_call_forms; rerun the typeform source "
                 f"({RUNBOOK}); roll release N4 back if the store is wrong.")


def run_notes_parity(ctx: Context) -> Result:
    """Release N4 (docs/forms/STAGE2B-CONTRACT.md 4.4): the native feed reads the 1-1 notes from the store and, until
    the switch-over, compares them with Typeform fRokTITH on every client row (data.notesFrom, data.notesParity). G6
    needs 7 clean days; cleanSince is the time since which no client has read differs.

    Exactly the contract's four readings of rows that exist, so a warn incident of this check means the notes differ:
    G6 counts those of the last 7 days and leaves out one at level unknown, which only could not read. No client row
    at all is that case: it says nothing about N4, and an ok would clear an open incident. Whether the feed publishes at
    all is not this check's question: native-source-producer fails after 90 minutes without a publication, and G6
    itself holds while the newest client row (max source_snapshot_at) is over an hour old. The publish time is read as
    evidence only."""
    raw = ctx.rows("cockpit_csm_sources", "data,source_snapshot_at", where=[("table_name", "eq", "clients")])
    if not raw:
        return unknown("The client roster lists no client, so the 1-1 notes cannot be compared.",
                       evidence={"clients": 0})
    pairs = [(r.get("data"), r.get("source_snapshot_at")) for r in raw]
    pairs = [(d, at) for d, at in pairs if isinstance(d, dict) and d.get("notesFrom")]
    rows = [d for d, _ in pairs]
    if not rows:
        return ok("The native feed still reads the 1-1 notes from Typeform: release N4 is not live.",
                  evidence={"clients": 0})
    readings = [(d, d.get("notesParity") if isinstance(d.get("notesParity"), dict) else {}) for d in rows]
    count = {s: sum(1 for _, p in readings if p.get("state") == s) for s in ("same", "explained", "differs", "none", "off")}
    stamps = [parse_time(p.get("cleanSince")) for _, p in readings]
    since = max((t for t in stamps if t is not None), default=None)
    # Evidence only (never a reading): a person reading "Day k of 7" can see when the rows were last published.
    published = max((t for t in (parse_time(at) for _, at in pairs) if t is not None), default=None)
    ev = {"clients": len(rows), **count, "cleanSince": since.isoformat() if since else None,
          "publishedAt": published.isoformat() if published else None}
    differs = [(d, p) for d, p in readings if p.get("state") == "differs"]
    names = sorted(str(d.get("name") or d.get("taskId")) for d, _ in differs)
    if differs:
        ev["differing"] = names[:20]
        order = list(PARITY_FIELDS)
        fields = sorted({str(f) for _, p in differs for f in (p.get("fields") or [])},
                        key=lambda f: (order.index(f) if f in order else len(order), f))
        said = ", ".join(PARITY_FIELDS.get(f, f) for f in fields) or "a different newest form"
        return warn(f"For {len(differs)} clients the 1-1 notes read from the store differ from Typeform: "
                    f"{', '.join(names[:12])}{'…' if len(names) > 12 else ''} ({said}).", evidence=ev,
                    items=[_tight(n) for n in names], action=PARITY_ACTION)
    if count["off"] == len(rows):
        return ok("The 1-1 notes are native; the Typeform comparison is off.", evidence=ev)
    day = min(PARITY_DAYS, int((ctx.now - since).total_seconds() // 86400)) if since else 0
    n = count["same"] + count["explained"]
    return ok(f"Day {day} of {PARITY_DAYS}: the 1-1 notes read from the store match Typeform for {n} clients "
              f"({count['explained']} explained by timing or a hand match).", evidence=ev)


def _registered(detail: object) -> bool:
    """detail->>'registered' = 'true' on the fathom-webhook sync row (cockpit_forms_key_put and _mark write it)."""
    return isinstance(detail, dict) and str(detail.get("registered")).lower() == "true"


def _pushed(meeting: dict) -> bool:
    """A recording Fathom's webhook fires for: it holds a summary and is shared with a team (fathom-intake 6.3)."""
    raw = meeting.get("raw") if isinstance(meeting.get("raw"), dict) else {}
    return bool(str(meeting.get("summary") or "").strip()) and raw.get("shared_with") != "no_teams"


def run_fathom_webhook(ctx: Context) -> Result:
    """Fathom's push of each Customer Success recording (supabase/functions/fathom-webhook). Until the CEO registers
    the webhook, or once it is unregistered, nothing is due: a note, never a warning (docs/forms/STAGE2-CONTRACT.md
    A3, section 9). The 15-minute read brings the same recordings meanwhile. The pull when the notes open does too,
    but only once the Fathom key is saved, and the guardian cannot read the vault (cockpit_forms_keys has no grant,
    2.2), so the note never names the pull: with B7 open it would be false. Fathom pushes a recording only once its summary is ready, and only one shared with a team, so only those count
    (A7 item 8): a day of short or unshared calls is nothing to deliver."""
    rows = ctx.rows("cockpit_sync_state", "key,note,detail", where=[("key", "eq", "fathom-webhook")])
    row = rows[0] if rows else {}
    detail = row.get("detail") if isinstance(row.get("detail"), dict) else {}
    if not _registered(detail):
        off = parse_time(detail.get("unregisteredAt"))
        lead = f"Unregistered at {kuwait(off)}" if off else "Not registered yet"
        return ok(f"{lead}: calls arrive by the 15-minute read.", evidence={"registered": False})
    since = (ctx.now - timedelta(hours=24)).isoformat()
    seen = ctx.rows("cockpit_fathom_meetings", "recording_id,summary,raw",
                    where=[("recorder_team", "eq", "Customer Success"), ("first_seen_at", "gte", since)])
    due = [m for m in seen if _pushed(m)]
    deliveries = ctx.rows("cockpit_fathom_webhook_deliveries", "outcome,last_at", where=[("last_at", "gte", since)])
    count = {o: sum(1 for d in deliveries if d.get("outcome") == o) for o in ("stored", "ignored", "failed")}
    n, stored = len(due), count["stored"]
    ev = {"registered": True, "webhookIdLast4": detail.get("webhookIdLast4"), "csRecordings24h": len(seen),
          "due24h": n, "stored24h": stored, "ignored24h": count["ignored"], "failed24h": count["failed"],
          "note": clean(row.get("note"), 160)}
    if n and not stored:
        k = count["failed"]
        failed = f" {k} deliver{'y' if k == 1 else 'ies'} failed in that time." if k else ""
        return warn(f"The Fathom webhook stored no delivery in 24 h, while {n} Customer Success recording"
                    f"{'' if n == 1 else 's'} with a summary, shared with a team, reached the store by the 15-minute "
                    f"read or the pull.{failed}", evidence=ev)
    return ok(f"The Fathom webhook stored {stored} deliver{'y' if stored == 1 else 'ies'} in 24 h; {n} Customer Success "
              f"recording{'' if n == 1 else 's'} with a summary, shared with a team, reached the store.", evidence=ev)


def run_kickoff_webhook(ctx: Context) -> Result:
    """Typeform's push of each kickoff (supabase/functions/forms-door, docs/forms/STAGE2B-CONTRACT.md section 6). Until
    it is registered nothing is due. Once it is, a kickoff the 15-minute read stored first (source typeform_sync) is one
    the webhook missed, counted only from the registration: everything stored before it came by the read on purpose.
    Nothing is lost either way, so this is low and never reads a kickoff's content."""
    rows = ctx.rows("cockpit_sync_state", "key,note,detail", where=[("key", "eq", "forms-door:kickoff")])
    row = rows[0] if rows else {}
    detail = row.get("detail") if isinstance(row.get("detail"), dict) else {}
    if not _registered(detail):
        return ok("Not registered yet: kickoffs arrive by the 15-minute read.", evidence={"registered": False})
    registered = parse_time(detail.get("registeredAt"))
    since = ctx.now - timedelta(hours=24)
    since = max(since, registered) if registered else since
    missed = ctx.rows("cockpit_form_responses", "id,submitted_at",
                      where=[("form_key", "eq", "kickoff"), ("source", "eq", "typeform_sync"),
                             ("submitted_at", "gte", since.isoformat()),
                             ("submitted_at", "lt", (ctx.now - timedelta(minutes=KICKOFF_GRACE_MIN)).isoformat())],
                      order="submitted_at.asc")
    n = len(missed)
    ev = {"registered": True, "registeredAt": detail.get("registeredAt"), "missed24h": n,
          "lastDelivery": detail.get("lastDelivery"), "outcome": detail.get("outcome"), "note": clean(row.get("note"), 160)}
    if n:
        return warn(f"Typeform's webhook missed {n} kickoff{'' if n == 1 else 's'} in 24 h; the 15-minute read stored "
                    f"{'it' if n == 1 else 'them'}.", since=parse_time(missed[0].get("submitted_at")), evidence=ev,
                    items=[str(m.get("id")) for m in missed],
                    action="The 15-minute read still stores every kickoff. Run forms_key.py status and probe-typeform "
                           "kickoff, then register it again (RUNBOOK, Kickoff and Blueprint records).")
    return ok("Typeform's webhook missed no kickoff in 24 h.", evidence=ev)


def run_impromptu(ctx: Context) -> Result:
    """Every impromptu call the CSM records gets a client and 1-1 notes, or is set aside (docs/forms/STAGE2B-CONTRACT.md
    4.10, Z17). Counted from the cut-over: before it, Typeform takes the notes and a candidate says nothing. Evidence
    holds recording ids only, never a host, a title or an answer."""
    cutover = _cutover(ctx)
    if cutover is None:
        return ok("Counted from the switch-over to 1-1 notes in the cockpit; not switched yet.",
                  evidence={"cutoverAt": None, "candidates_without_notes_24h": None})
    rows = _candidates_without_notes(ctx, cutover)
    n = len(rows)
    # The prefix keeps each id whole: the store runs clean() on items and evidence, and clean() reads a bare 9-digit
    # Fathom recording id as a phone number, so every recording would fold into one "<number>" item.
    ids = [f"fathom_{r.get('source_id') or r.get('id')}" for r in rows]
    starts = [t.astimezone(KUWAIT) for t in (parse_time(r.get("starts_at")) for r in rows) if t is not None]
    ev = {"cutoverAt": cutover.isoformat(), "candidates_without_notes_24h": n,
          "oldestDay": starts[0].strftime("%Y-%m-%d") if starts else None, "recordingIds": ids[:10]}
    if not n:
        return ok(f"{n} impromptu calls since the switch-over all have 1-1 notes or a client.", evidence=ev)
    days = list(dict.fromkeys(f"{k.day} {k.strftime('%b')}" for k in starts))
    said = "1 impromptu call older than a day has" if n == 1 else f"{n} impromptu calls older than a day have"
    return warn(f"{said} no client and no 1-1 notes: {', '.join(days)}. Put each on its client and write its notes, or "
                "mark it Not a 1-1 call.",
                since=parse_time(rows[0].get("starts_at")), evidence=ev, items=ids,
                action="Open Today: each impromptu call has Place it and Not a 1-1 call.")


def run_evidence(ctx: Context) -> Result:
    """Held calls in the last 7 days with a recording or a 1-1 form linked. Only bookings on a client count, and that
    is decided here, not by a filter: no filter op says IS NOT NULL, and ("task_id", "neq", None) is task_id <> null
    through the read-only SQL door, which matches no row (the REST door's neq.None matched only by accident)."""
    since = (ctx.now - timedelta(days=7)).isoformat()
    appts = [a for a in ctx.rows("cockpit_csm_calls", "id,task_id,status,ends_at,starts_at",
                                 where=[("source", "eq", "ghl_appointment"), ("starts_at", "gte", since),
                                        ("starts_at", "lte", ctx.now.isoformat()),
                                        ("status", "in", ["confirmed", "showed", "held"])])
             if a.get("task_id")]
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


def _late(r: dict, limit: float, now) -> bool:
    """Failed, or no good run within the limit. Only a missing time is missing: an age of 0 is fresh."""
    age = age_min(r.get("last_ok_at"), now)
    return r.get("ok") is False or age is None or age > limit


def run_daily_line(ctx: Context) -> Result:
    """One line for the daily summary: calls synced yesterday, unmatched, stale sources."""
    try:
        rec = ctx.rows("cockpit_sync_state", "ok,note,detail", where=[("key", "eq", "csm-reconcile")])
        stale = [k for k, r in ((str(r.get("key")), r) for r in ctx.rows(
            "cockpit_sync_state", "key,ok,last_ok_at", where=[("key", "in", list(CSM_KEYS))]))
            if k in CSM_KEYS and _late(r, CSM_KEYS[k][0], ctx.now)]
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
          threshold="Any key with ok false, never run, or no good run within 45 min (26 h for csm-reconcile): fail. "
                    f"{RECORD_KEY} detail.errors above 0: warn.",
          run=run_freshness, owner="Hermes", confirm=2,
          action=f"Read ~/.csm-calls/cron.log; {RUNBOOK}."),
    Check(id="csm-calls-coverage", area="workers", name="Every live client has a recent call",
          means=f"Every Active or onboarding client has a call from any source within {CALL_GAP_DAYS} days.",
          severity="medium", reads="cockpit_csm_sources clients against cockpit_csm_calls",
          threshold=f"Any live client with no call in {CALL_GAP_DAYS} days: warn.", run=run_coverage,
          owner="the CSM lead", confirm=2, action="Book the listed clients."),
    Check(id="csm-calls-unmatched", area="workers", name="Calls matched to a client",
          means="Calls land on a client page rather than in the unmatched queue.", severity="medium",
          reads="cockpit_csm_calls over 7 days, leaving out candidates (impromptu recordings waiting for a client) "
                "and recordings set aside as not a 1-1 call",
          threshold=f"Over {UNMATCHED_MAX:.0%} unmatched: warn.",
          run=run_unmatched, owner="the CSM lead", confirm=3,
          action="Work the queue; fix the Client ID field on the GoHighLevel contacts it names."),
    Check(id="csm-checkin-form", area="workers", name="1-1 call notes keep coming",
          means="The 1-1 call notes form is sent after calls and reaches the store.", severity="medium",
          reads="max(submitted_at) of cockpit_csm_call_forms with form_kind checkin; once the registry says native, "
                f"its checkin_late rows of the last {LATE_DAYS} days since the cut-over",
          threshold=f"Older than {FORM_MAX_DAYS} days, or any 1-1 notes that arrived in Typeform after the switch-over: "
                    "warn.", run=run_checkin_form, owner="the CSM lead",
          confirm=2, action="Ask the CSMs for their notes; compare Typeform with the store."),
    Check(id="csm-notes-parity", area="workers", name="1-1 notes from the store match Typeform",
          means="The native feed reads the 1-1 notes from the store (release N4) and they read the same as Typeform "
                "until the switch-over, for seven clean days before it.",
          severity="medium",
          reads="cockpit_csm_sources clients: data.notesFrom and data.notesParity (source_snapshot_at as evidence only)",
          threshold="Any client whose notes read differs: warn. No client row at all: unknown, never ok. A feed that "
                    "stops publishing is native-source-producer's question, not this one's.",
          run=run_notes_parity, owner="the tech lead", confirm=3, action=PARITY_ACTION),
    Check(id="csm-fathom-webhook", area="workers", name="Fathom webhook delivers",
          means="Fathom pushes each Customer Success recording to the cockpit within minutes of the call.",
          severity="low",
          reads="cockpit_sync_state fathom-webhook (detail.registered), cockpit_fathom_webhook_deliveries, and the "
                "Customer Success rows of cockpit_fathom_meetings first seen in 24 h that hold a summary and whose "
                "raw shared_with is not no_teams (Fathom pushes only those)",
          threshold="Registered, a Customer Success recording first seen in the last 24 h that holds a summary and is "
                    "shared with a team, and no stored delivery in 24 h: warn.",
          run=run_fathom_webhook, owner="the tech lead", confirm=2,
          action="The poll still runs every 15 minutes. Check the webhook in Fathom's settings, or register it again "
                 "(RUNBOOK, 1-1 notes in the cockpit)."),
    Check(id="csm-impromptu-notes", area="workers", name="Impromptu calls get a client",
          means="Every impromptu call the CSM records gets a client and 1-1 notes, or is set aside as not a 1-1 call.",
          severity="medium",
          reads="cockpit_forms checkin (provider, provider_since) and cockpit_csm_calls: Fathom candidates since the "
                "cut-over and over 24 h old, id, source_id, starts_at, status and settled_reason only",
          threshold="Any such candidate not gone and not set aside: warn. Before the cut-over: ok.",
          run=run_impromptu, owner="the CSM lead", confirm=2,
          action="Open Today: each impromptu call has Place it and Not a 1-1 call."),
    Check(id="forms-kickoff-webhook", area="workers", name="Typeform kickoff webhook delivers",
          means="Typeform pushes each kickoff to the cockpit; the 15-minute read stores any it misses.", severity="low",
          reads="cockpit_sync_state forms-door:kickoff (detail.registered, detail.registeredAt) and the kickoff rows of "
                "cockpit_form_responses: id, source, submitted_at (never the answers)",
          threshold=f"Registered, and a kickoff of the last 24 h since registering, over {KICKOFF_GRACE_MIN} min old, "
                    "stored by the read and not the webhook: warn. Not registered: ok.",
          run=run_kickoff_webhook, owner="the tech lead", confirm=2,
          action="The 15-minute read still stores every kickoff. Check the webhook with forms_key.py (RUNBOOK, Kickoff "
                 "and Blueprint records)."),
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
