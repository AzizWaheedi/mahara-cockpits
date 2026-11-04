"""The waves 3-4 client forms (docs/forms/WAVE34-CONTRACT.md 6.2): the daily schedule, invites past their 14 days, phone
alerts, WhatsApp form links, token limits, the portal's presence push, the client voice against its second source, low
scores waiting for a call, follow-up steps that failed after an answer was stored, answers through a retired link, the
onboarding webhook against the 10-minute read, and the two Make forms' webhooks. Report-only: each reading names the gap
and who closes it; nothing here writes.

Every read is a view or a table over REST with the service key (the browser RPCs are seat-gated and refuse the
guardian). Before the deploy each check reads "not set up yet" as ok, never as zero: a table, a view or a setting that is
not there yet is a sentence, not a count.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, warn
from guard.redact import clean

RUNBOOK = "RUNBOOK.md, Client forms (waves 3 and 4)"
SCHEDULE_KEY = "form-schedule"
DAY_MIN = 26 * 60
EXPIRY_GRACE_MIN = 26 * 60
PUSH_STUCK_MIN = 15
DRAFT_WAIT_MIN = 48 * 60
LIMITED_PER_HOUR = 50
PRESENCE_STALE_MIN = 30
VOICE_DAYS = 30
LOW_DAYS = 14
LOW_WAIT_BUSINESS_HOURS = 24
HOOK_DAYS = 7
ONBOARDING_COMPARE_DAYS = 14
ONBOARDING_GRACE_MIN = 30
MAKE_FORMS = {"onboarding": "client onboarding form", "new_client": "New Client Form"}
FORM_WORDS = {"nps": "The NPS survey", "csat": "The onboarding survey", "exit_survey": "The termination survey",
              "pause_request": "The pause request", "pause_consent": "The pause consent"}
KUWAIT = timezone(timedelta(hours=3))

# A table, view or column a later migration adds: the read says so instead of failing the scan.
_NOT_THERE = re.compile(r"PGRST20[45]|42P01|42703|does not exist|Could not find|404", re.I)


def _maybe(ctx: Context, table: str, select: str = "*", where=(), order: Optional[str] = None,
           limit: Optional[int] = None) -> Optional[list[dict[str, Any]]]:
    """Rows, or None when the object is not there yet. Any other failure is the scan's 'could not be checked'."""
    try:
        return ctx.rows(table, select, where=where, order=order, limit=limit)
    except SourceError as e:
        if _NOT_THERE.search(str(e)):
            return None
        raise


def _setting(ctx: Context, key: str) -> Optional[dict[str, Any]]:
    rows = _maybe(ctx, "cockpit_settings", "key,value", where=[("key", "eq", key)], limit=1)
    if not rows:
        return None
    v = rows[0].get("value")
    return v if isinstance(v, dict) else None


def _state(ctx: Context, key: str) -> Optional[dict[str, Any]]:
    rows = _maybe(ctx, "cockpit_sync_state", "key,ok,note,detail,last_run_at,last_ok_at", where=[("key", "eq", key)], limit=1)
    return rows[0] if rows else None


def _detail(row: Optional[dict[str, Any]]) -> dict[str, Any]:
    d = (row or {}).get("detail")
    return d if isinstance(d, dict) else {}


def _int(v: Any) -> Optional[int]:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and v.strip().lstrip("-").isdigit():
        return int(v)
    return None


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat()


# ---- form-schedule -------------------------------------------------------------------------------------------

def run_schedule(ctx: Context) -> Result:
    setting = _setting(ctx, "forms.schedule")
    if setting is None:
        return ok("Not set up yet: forms.schedule is not seeded (20261102c).")
    row = _state(ctx, SCHEDULE_KEY)
    on = setting.get("on") is True
    if not on:
        return ok("The client forms schedule is off (forms.schedule); it turns on at D-C5. The daily sweep still runs."
                  if row else "The client forms schedule is off and has not reported a run yet.")
    if row is None:
        return fail("The client forms schedule is on but has never reported a run (pg_cron mahara-form-schedule).")
    age = age_min(row.get("last_run_at"), ctx.now)
    d = _detail(row)
    ev = {"last_run_at": row.get("last_run_at"), "issued": d.get("issued"), "skipped": d.get("skipped")}
    if age is None or age > DAY_MIN:
        return fail(f"The client forms schedule has not run for {ago(age)} (limit {ago(DAY_MIN)}), so no NPS or onboarding "
                    "survey goes out by date.", evidence=ev, since=parse_time(row.get("last_run_at")))
    issued = d.get("issued") if isinstance(d.get("issued"), dict) else {}
    skipped = d.get("skipped") if isinstance(d.get("skipped"), dict) else {}
    total = sum(_int(v) or 0 for v in issued.values())
    if total == 0 and (_int(skipped.get("notLive")) or 0) > 0:
        return warn("The schedule ran and sent nothing because a form is not switched on for clients "
                    f"({clean(row.get('note'), 200)}). Switch it on with cockpit_form_client_go_live, or turn the schedule "
                    "off.", evidence=ev)
    if row.get("ok") is False:
        return warn(f"The last schedule run could not issue every invite: {clean(row.get('note'), 240)}", evidence=ev)
    return ok(f"The client forms schedule ran {ago(age)} ago: {clean(row.get('note'), 200)}", evidence=ev)


# ---- invites-expiry ------------------------------------------------------------------------------------------

def run_expiry(ctx: Context) -> Result:
    cutoff = _iso(ctx.now - timedelta(minutes=EXPIRY_GRACE_MIN))
    rows = _maybe(ctx, "cockpit_form_invites", "id,form_key,expires_at",
                  where=[("state", "eq", "open"), ("expires_at", "lt", cutoff)])
    if rows is None:
        return ok("Not set up yet: the client form invites table is not there (20261102a).")
    if rows:
        return warn(f"{_plural(len(rows), 'invite')} stayed open more than 26 hours past their 14 days, so the daily sweep "
                    "is not running. Screens already read them as expired; check pg_cron mahara-form-schedule.",
                    items=[str(r.get("id")) for r in rows][:20])
    return ok("No client form invite is open past its 14 days.")


# ---- invite-push ---------------------------------------------------------------------------------------------

def run_push(ctx: Context) -> Result:
    cutoff = _iso(ctx.now - timedelta(minutes=PUSH_STUCK_MIN))
    rows = _maybe(ctx, "cockpit_form_invites", "id,push_state,updated_at",
                  where=[("push_state", "eq", "sending"), ("updated_at", "lt", cutoff)])
    if rows is None:
        return ok("Not set up yet: the client form invites table is not there (20261102a).")
    if rows:
        return warn(f"{_plural(len(rows), 'phone alert')} for a form invite {'has' if len(rows) == 1 else 'have'} been "
                    f"sending for over {PUSH_STUCK_MIN} minutes. Read the portal's form_invite_push log line.",
                    items=[str(r.get("id")) for r in rows][:20])
    return ok("No form invite phone alert is stuck.")


# ---- invite-links --------------------------------------------------------------------------------------------

def run_links(ctx: Context) -> Result:
    rows = _maybe(ctx, "cockpit_client_messages", "id,state,created_at", where=[("kind", "eq", "form_invite"),
                                                                              ("state", "in", ["unknown", "draft"])])
    if rows is None:
        return ok("Not set up yet: the client messages table is not there.")
    unknown = [r for r in rows if r.get("state") == "unknown"]
    old = [r for r in rows if r.get("state") == "draft" and (age_min(r.get("created_at"), ctx.now) or 0) > DRAFT_WAIT_MIN]
    if unknown:
        return warn(f"{_plural(len(unknown), 'form link')} may or may not be in the client's WhatsApp group (unknown). "
                    "Look in the group; the tech lead settles each one.", items=[str(r.get("id")) for r in unknown][:20])
    if old:
        return warn(f"{_plural(len(old), 'form link')} {'waits' if len(old) == 1 else 'wait'} for a CSM's approval for more "
                    "than 48 hours.", items=[str(r.get("id")) for r in old][:20])
    return ok("No WhatsApp form link is unknown or waiting more than 48 hours for approval.")


# ---- token-limits --------------------------------------------------------------------------------------------

def run_tokens(ctx: Context) -> Result:
    since = _iso(ctx.now - timedelta(hours=1))
    rows = _maybe(ctx, "cockpit_form_token_opens", "id", where=[("outcome", "eq", "limited"), ("at", "gte", since)])
    if rows is None:
        return ok("Not set up yet: the form link opens table is not there (20261102a).")
    if len(rows) > LIMITED_PER_HOUR:
        return warn(f"{len(rows)} form link opens were refused as too many tries in the last hour (limit "
                    f"{LIMITED_PER_HOUR}). Someone may be guessing links; read cockpit_form_token_opens by network.")
    return ok(f"{_plural(len(rows), 'form link open')} refused for too many tries in the last hour.")


# ---- presence ------------------------------------------------------------------------------------------------

def run_presence(ctx: Context) -> Result:
    setting = _setting(ctx, "forms.client")
    if setting is None:
        return ok("Not set up yet: forms.client is not seeded (20261102a).")
    if setting.get("presence") is not True:
        return ok("The portal's presence push is off (forms.client.presence); it turns on at D-PR.")
    rows = _maybe(ctx, "cockpit_portal_presence", "location_id,pushed_at", order="pushed_at.desc", limit=1)
    if rows is None:
        return ok("Not set up yet: the portal presence table is not there (20261102a).")
    if not rows:
        return warn("The portal's presence push is on but no workspace has reported yet. Read the portal's form_presence "
                    "log line.")
    age = age_min(rows[0].get("pushed_at"), ctx.now)
    if age is None or age > PRESENCE_STALE_MIN:
        return warn(f"The portal last pushed who opened it {ago(age)} ago (limit {PRESENCE_STALE_MIN} minutes), so Send a "
                    "form may pick the wrong channel. Read the portal cron's form_presence log line.")
    return ok(f"The portal pushed who opened it {ago(age)} ago.")


# ---- voice-count ---------------------------------------------------------------------------------------------

def run_voice(ctx: Context) -> Result:
    since = _iso(ctx.now - timedelta(days=VOICE_DAYS))
    answers = _maybe(ctx, "cockpit_client_voice_v", "clickup_task_id",
                     where=[("form_key", "eq", "nps"), ("submitted_at", "gte", since)])
    if answers is None:
        return ok("Not set up yet: the client voice view is not there (20261102c).")
    events = _maybe(ctx, "cockpit_form_invite_events", "invite_id", where=[("event", "eq", "answered"), ("at", "gte", since)])
    if events is None:
        return ok("Not set up yet: the invite events table is not there (20261102a).")
    ids = sorted({str(e.get("invite_id")) for e in events if e.get("invite_id")})
    cards: set = set()
    if ids:
        invites = _maybe(ctx, "cockpit_form_invites", "id,task_id,form_key,origin",
                         where=[("id", "in", ids), ("form_key", "eq", "nps"), ("origin", "neq", "canary")]) or []
        cards = {i.get("task_id") for i in invites if i.get("task_id")}
    answered = {a.get("clickup_task_id") for a in answers if a.get("clickup_task_id")}
    ev = {"cards_with_answer": len(answered), "cards_with_answered_invite": len(cards)}
    if len(answered) != len(cards):
        return warn(f"In the last {VOICE_DAYS} days {_plural(len(cards), 'client')} answered an NPS invite but "
                    f"{_plural(len(answered), 'client')} {'has' if len(answered) == 1 else 'have'} an NPS answer. The CEO's NPS "
                    "says both; read the answers and invites of the clients that differ.", evidence=ev)
    if not answered:
        return ok(f"No NPS answers in the last {VOICE_DAYS} days, so there is nothing to compare yet.", evidence=ev)
    return ok(f"{_plural(len(answered), 'client')} answered NPS in the last {VOICE_DAYS} days, the same as the answered "
              "invites.", evidence=ev)


# ---- low-score-open ------------------------------------------------------------------------------------------

def _business_hours(start: datetime, end: datetime) -> float:
    """Hours between the two, counting Sunday to Thursday in Kuwait only."""
    if end <= start:
        return 0.0
    hours = 0.0
    t = start.astimezone(KUWAIT)
    end_k = end.astimezone(KUWAIT)
    while t < end_k:
        step = min(t + timedelta(hours=1), end_k)
        if t.weekday() not in (4, 5):  # Friday, Saturday
            hours += (step - t).total_seconds() / 3600
        t = step
    return hours


def run_low(ctx: Context) -> Result:
    setting = _setting(ctx, "voice.low_score")
    line = _int((setting or {}).get("max"))
    since = _iso(ctx.now - timedelta(days=LOW_DAYS))
    rows = _maybe(ctx, "cockpit_client_voice_v", "response_id,clickup_task_id,client_name,form_key,score,submitted_at",
                  where=[("form_key", "in", ["nps", "csat"]), ("submitted_at", "gte", since)])
    if rows is None:
        return ok("Not set up yet: the client voice view is not there (20261102c).")
    if line is None:
        return warn("voice.low_score has no max, so low scores cannot be told apart. Set the line in the forms editor.")
    low = [r for r in rows if _int(r.get("score")) is not None and _int(r.get("score")) <= line]
    if not low:
        return ok(f"No NPS or onboarding answer at or under {line} in the last {LOW_DAYS} days.")
    reqs = _maybe(ctx, "cockpit_requests", "client_task_id,created_at,state",
                  where=[("type_key", "eq", "client_low_score"), ("created_at", "gte", since)]) or []
    waiting = []
    for r in low:
        at = parse_time(r.get("submitted_at"))
        if at is None:
            continue
        covered = any(q.get("client_task_id") == r.get("clickup_task_id") and q.get("state") != "cancelled"
                      and (parse_time(q.get("created_at")) or at) >= at for q in reqs)
        if not covered and _business_hours(at, ctx.now) > LOW_WAIT_BUSINESS_HOURS:
            waiting.append(r)
    if waiting:
        names = sorted({clean(r.get("client_name") or r.get("clickup_task_id"), 60) for r in waiting})
        return warn(f"{_plural(len(waiting), 'low score')} waited more than a business day with no low-score ticket: "
                    f"{', '.join(names)}. The CSM calls the client and opens the ticket from Today.",
                    items=[str(r.get("response_id")) for r in waiting][:20])
    return ok(f"{_plural(len(low), 'low score')} in the last {LOW_DAYS} days, each with a ticket or still inside a business day.")


# ---- hook-failed ---------------------------------------------------------------------------------------------

def run_hooks(ctx: Context) -> Result:
    since = _iso(ctx.now - timedelta(days=HOOK_DAYS))
    rows = _maybe(ctx, "cockpit_form_invite_events", "id,invite_id,detail,at",
                  where=[("event", "eq", "hook_failed"), ("at", "gte", since)])
    if rows is None:
        return ok("Not set up yet: the invite events table is not there (20261102a).")
    if rows:
        hooks = sorted({str((r.get("detail") or {}).get("hook") or "a hook") for r in rows if isinstance(r.get("detail"), dict)})
        return warn(f"{_plural(len(rows), 'client answer was', 'client answers were')} stored but a follow-up step failed"
                    f"{' (' + ', '.join(hooks) + ')' if hooks else ''}. Re-run it from the runbook.",
                    items=[str(r.get("invite_id")) for r in rows][:20])
    return ok(f"No follow-up step of a client answer failed in the last {HOOK_DAYS} days.")


# ---- legacy-24h ----------------------------------------------------------------------------------------------

def run_legacy(ctx: Context) -> Result:
    since = _iso(ctx.now - timedelta(hours=24))
    rows = _maybe(ctx, "cockpit_form_responses", "id,form_key,submitted_at",
                  where=[("state", "eq", "legacy"), ("source", "eq", "typeform_webhook"), ("submitted_at", "gte", since)])
    if rows is None:
        return ok("Not set up yet: the forms tables are not there.")
    if not rows:
        return ok("No answer came through a retired form link in the last 24 hours.")
    forms = _maybe(ctx, "cockpit_forms", "key,provider") or []
    native = {f.get("key") for f in forms if f.get("provider") == "native"}
    live = (_setting(ctx, "forms.client") or {}).get("live")
    if isinstance(live, list) and "pause_consent" in live:
        native.add("pause_request")
    retired = [r for r in rows if r.get("form_key") in native]
    if not retired:
        return ok("No answer came through a retired form link in the last 24 hours.")
    counts: dict = {}
    for r in retired:
        counts[r.get("form_key")] = counts.get(r.get("form_key"), 0) + 1
    parts = [f"{FORM_WORDS.get(k, k)} came through the old link {_plural(n, 'time')} today" for k, n in sorted(counts.items())]
    return warn("; ".join(parts) + ". Each is kept; close the old Typeform if it is still open.",
                items=[str(r.get("id")) for r in retired][:20])


# ---- onboarding-webhook --------------------------------------------------------------------------------------

def run_onboarding(ctx: Context) -> Result:
    row = _state(ctx, "forms-door:onboarding")
    d = _detail(row)
    if row is None or d.get("registered") is not True:
        return ok("Not set up yet: the client onboarding webhook is not registered (D-C6); the 10-minute read keeps the "
                  "onboarding answers.")
    since = parse_time(d.get("registeredAt"))
    if since is None:
        return warn("The client onboarding webhook is registered but its registration time is unknown, so the poll cannot "
                    "be compared. Run forms_key.py register-typeform onboarding again.")
    if ctx.now - since > timedelta(days=ONBOARDING_COMPARE_DAYS):
        return ok(f"The client onboarding webhook was compared with the 10-minute read for {ONBOARDING_COMPARE_DAYS} days.")
    model = _maybe(ctx, "cockpit_client_onboarding", "clickup_task_id,forms")
    stored = _maybe(ctx, "cockpit_form_responses", "external_id",
                    where=[("form_key", "eq", "onboarding"), ("submitted_at", "gte", _iso(since))])
    if model is None or stored is None:
        return ok("Not set up yet: the onboarding read model or the forms tables are not there.")
    got = {s.get("external_id") for s in stored}
    missed = []
    for m in model:
        f = (m.get("forms") or {}).get("onboarding") if isinstance(m.get("forms"), dict) else None
        if not isinstance(f, dict):
            continue
        at = parse_time(f.get("submitted_at"))
        if at is None or at < since or f.get("response_id") in got:
            continue
        if (ctx.now - at) > timedelta(minutes=ONBOARDING_GRACE_MIN):
            missed.append(m.get("clickup_task_id"))
    if missed:
        return warn(f"{_plural(len(missed), 'onboarding answer')} reached the 10-minute read but not the webhook in over "
                    f"{ONBOARDING_GRACE_MIN} minutes. Probe it with forms_key.py probe-typeform onboarding.",
                    items=[str(x) for x in missed][:20])
    return ok("Every onboarding answer since the webhook was registered reached it as well as the 10-minute read.")


# ---- forms-door-make -----------------------------------------------------------------------------------------

def run_make_doors(ctx: Context) -> Result:
    problems, live, items = [], [], []
    for form, words in MAKE_FORMS.items():
        row = _state(ctx, f"forms-door:{form}")
        d = _detail(row)
        if row is None or d.get("registered") is not True:
            continue
        live.append(words)
        if d.get("outcome") == "failed" or row.get("ok") is False:
            why = clean(d.get('reason') or row.get('note'), 140).rstrip(". ")
            problems.append(f"the {words} webhook's last delivery failed: {why}")
            items.append(f"{form}-failed")
    if problems:
        text = "; ".join(problems)
        return fail(text[:1].upper() + text[1:] + ". Probe it with forms_key.py probe-typeform.", items=items)
    if not live:
        return ok("Not set up yet: the client onboarding and New Client Form webhooks are not registered (D-C6, D-NCF).")
    return ok(f"The {' and '.join(live)} {'webhook answers' if len(live) == 1 else 'webhooks answer'}; a quiet form is "
              "normal (Make keeps every effect).")


CHECKS = (
    Check("form-schedule", "workers", "Client forms schedule",
          "NPS goes on day 60 and every 90 days after, and the onboarding survey after launch, by the daily run.", "medium",
          "cockpit_settings forms.schedule and cockpit_sync_state form-schedule (pg_cron mahara-form-schedule, 07:00 UTC).",
          "Fail: no run in 26 hours while the schedule is on. Warn: a run sent nothing because a form is not live.",
          run_schedule, owner="the systems manager",
          action=f"Check pg_cron mahara-form-schedule; turn forms.schedule off if it misbehaves ({RUNBOOK}).", confirm=1, clear=1),
    Check("invites-expiry", "workers", "Form invites past their 14 days",
          "An invite closes 14 days after it is sent.", "low", "cockpit_form_invites open past expires_at.",
          "Warn: one is open more than 26 hours past its expiry (the daily sweep is not running).", run_expiry,
          owner="the systems manager", action="Check pg_cron mahara-form-schedule.", confirm=1, clear=1, alert=False),
    Check("invite-push", "workers", "Form invite phone alerts",
          "A form invite's phone alert is sent or settled within minutes.", "low",
          "cockpit_form_invites push_state sending.", f"Warn: one is sending for over {PUSH_STUCK_MIN} minutes.", run_push,
          owner="the tech lead", action="Read the portal cron's form_invite_push log line.", confirm=2, clear=1, alert=False),
    Check("invite-links", "workers", "WhatsApp form links",
          "A form link sent by WhatsApp is approved and delivered.", "medium",
          "cockpit_client_messages kind form_invite, states unknown and draft.",
          "Warn: any unknown; a draft waiting more than 48 hours.", run_links, owner="the CSM lead",
          action="Approve or withdraw the link from Send a form; the tech lead settles an unknown.", confirm=1, clear=1),
    Check("token-limits", "data", "Form link guessing",
          "Nobody is guessing form links.", "medium", "cockpit_form_token_opens outcome limited in the last hour.",
          f"Warn: more than {LIMITED_PER_HOUR} in an hour.", run_tokens, owner="the tech lead",
          action="Read the opens by network hash; the limits already refuse them.", confirm=1, clear=1),
    Check("presence", "workers", "Portal presence push",
          "The cockpit knows who opened each client's portal, so Send a form picks the right channel.", "low",
          "cockpit_settings forms.client.presence and cockpit_portal_presence.pushed_at.",
          f"Warn: the newest push is older than {PRESENCE_STALE_MIN} minutes while the push is on.", run_presence,
          owner="the tech lead", action="Read the portal cron's form_presence log line.", confirm=2, clear=1, alert=False),
    Check("voice-count", "data", "Client voice against the invites",
          "Every NPS answer the CEO counts has an answered invite behind it.", "medium",
          "cockpit_client_voice_v (cards with an NPS answer, 30 days) and cockpit_form_invite_events joined to non-canary "
          "NPS invites (cards with an answered invite, 30 days), over REST.",
          "Warn: the two card counts differ.", run_voice, owner="the systems manager",
          action="Read the answers and invites of the clients that differ.", confirm=1, clear=1, alert=False),
    Check("low-score-open", "data", "Low scores waiting for a call",
          "A client who scores the survey at or under the line gets a call and a ticket.", "high",
          "cockpit_client_voice_v (14 days, voice.low_score.max) and cockpit_requests type client_low_score, over REST.",
          "Warn: a low score waits more than a business day with no ticket.", run_low, owner="the CSM lead",
          action="The CSM calls the client and opens the low-score ticket from Today.", confirm=1, clear=1),
    Check("hook-failed", "workers", "Client answers' follow-up steps",
          "Every stored client answer runs its follow-up steps (notices, the card).", "medium",
          "cockpit_form_invite_events event hook_failed in the last 7 days.", "Warn: any.", run_hooks,
          owner="the tech lead", action=f"Fix the hook, then re-run cockpit_form_client_submitted ({RUNBOOK}).",
          confirm=1, clear=1),
    Check("legacy-24h", "data", "Answers through a retired form link",
          "Clients use the cockpit's forms, not a retired Typeform.", "low",
          "cockpit_form_responses state legacy in 24 hours for a form now native.", "Warn: any.", run_legacy,
          owner="the systems manager", action="Close the old Typeform; the answer is kept.", confirm=1, clear=1, alert=False),
    Check("onboarding-webhook", "workers", "Client onboarding webhook",
          "Each client onboarding answer reaches the cockpit by its webhook as well as the 10-minute read.", "low",
          "cockpit_client_onboarding forms.onboarding against stored onboarding responses, for 14 days after D-C6.",
          f"Warn: an answer only the poll has, older than {ONBOARDING_GRACE_MIN} minutes.", run_onboarding,
          owner="the systems manager", action="Run forms_key.py probe-typeform onboarding.", confirm=1, clear=1, alert=False),
    Check("forms-door-make", "workers", "Client onboarding and New Client Form webhooks",
          "The two Typeforms Make owns are recorded in the cockpit.", "medium",
          "cockpit_sync_state forms-door:onboarding and forms-door:new_client.",
          "Fail: the last delivery failed. A quiet form is normal.", run_make_doors, owner="the systems manager",
          action="Run forms_key.py status and probe-typeform for the form.", confirm=1, clear=1),
)
