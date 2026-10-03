"""Backlog waves: the CEO's opener to the leads already in a job, forty a day,
newest first, with a tenth held back to measure what it does.

New leads fell from 74 a week in August to none in the week of 28 September
(roas-tagged, cockpit_sales_leads, read 2026-10-03). Reactivating the leads
already in a job is the only lever with volume, so it goes first, and it
needs no model: the opener is the CEO's own words, and the lead's answer
opens the WhatsApp window for a written reply.

    opener_ar: «السلام عليكم {{1}}، معاك {{2}}. كيف حالك؟»
    opener_en: "Hi {{1}}, it's {{2}} from Mahara Media. How are you?"

How a wave runs. sales-api holds the buttons; this is the desk's half.
1. A manager starts a wave on one pool (followup.wave): a row in
   cockpit_sales_followup_waves, state running.
2. The desk enrols the pool, chunk by chunk, until every chunk is in
   (enrolled_at). Every lead in it becomes a member, and a tenth is held
   back by sha256('waves:'||contact_id). Held-back members are never
   written to; they are what the wave is measured against.
3. On working days from 09:00 Kuwait, the desk drafts the day's openers:
   at most waves.per_day (40) across the running waves, served in the pool
   order below, newest first within a pool. Each is a `reactivate` draft
   carrying the opener template, for the owner to approve as a batch. A new
   batch waits while an earlier day's openers still wait for anyone to
   decide on them.
4. Once a batch is approved (followup.batch writes send_after on each
   draft's meta row), the desk sends one every batch_gap_s (45 s). It sends
   only between 09:00 and 18:00 on the lead's clock, only for a wave still
   running, and stops short of the sender ceiling with 10 slots left for the
   demo chat's tick. Nothing goes on WhatsApp while the WA Connector gate is
   shut, or once the month's template budget is spent.
5. Each member follows its draft (sent, skipped, failed and tried again
   once, expired and drafted again), then what the opener did: replied or
   booked within 14 days of the send, else closed. Held-back members get the
   same 14 days from the day their place in the order came up, so the two
   arms are compared over the same time.
6. A wave a manager stops is wound down: its open openers are taken back,
   its waiting members leave it, and it lets go of every lead it held.

Wave openers never take the follow-up agent's own room (followups.per_day),
and nothing here runs while the follow-up agent is switched off
(followups.enabled).
"""
from __future__ import annotations

import hashlib
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import followups as fu
from . import http

WAVES = "cockpit_sales_followup_waves"
MEMBERS = "cockpit_sales_followup_wave_members"
META = "cockpit_sales_followup_meta"
FOLLOWUPS = "cockpit_sales_followups"
MESSAGES = "cockpit_sales_messages"
# The spec's order: the warmest backlog first.
POOLS = ("no_show_cancelled", "good_intro", "unclosed_demo", "never_booked")
POOL_WORDS = {"no_show_cancelled": "no-shows and cancellations", "good_intro": "good intros with no demo",
              "unclosed_demo": "demos with no close", "never_booked": "leads who never booked"}
# A lead is a contact tagged with a ROAS tag (the CEO's rule, 2026-09-21).
# Untagged and not-ready contacts are not leads: email nurture only.
ROAS_TAGS = ("roas-qualified", "roas-unqualified")
OPENERS = {"ar": "opener_ar", "en": "opener_en"}
DEFAULTS: dict[str, Any] = {"per_day": 40, "holdout_share": 0.1, "batch_gap_s": 45, "salt": "waves"}
# sales-api's senderCeiling: 30 messages in ten minutes per sender, and the
# desk is one sender (sales-desk). Waves stop with RESERVE slots left for
# the demo chat's tick, which sends as the desk too.
CEILING = 30
CEILING_WINDOW = timedelta(minutes=10)
RESERVE = 10
DESK = "sales-desk"
# A lead sent an opener (or measured in a holdout) lately is not enrolled in
# another wave.
RECENT_DAYS = 30
# The members the one-running-wave index covers (one per lead across every
# wave): still to be written to, written to, or held back.
OPEN_STATES = ("waiting", "drafted", "held_out")
# Members still being watched for what the opener did.
WATCHED = ("sent", "replied", "held_out")
OUTCOME_DAYS = 14
# A held call puts a lead in a pool only once a day has passed with nothing
# booked after it (spec P3 §3.2: "no demo 24 h later"); a no-show mark in
# that day moves them to the no-show pool instead.
HELD_WAIT = timedelta(hours=24)
# The demo calendars (spec P3 §3.2): a demo held anywhere else is not one
# the unclosed-demo pool follows up.
DEMO_CALENDARS = frozenset(cid for cid, kind in fu.CALL_KINDS.items() if kind == "demo")
# A failed opener is drafted again the next day, once; a second failure, or
# a reason that will not change, takes the lead out of the wave.
FAIL_LIMIT = 2
RETRY_AFTER = timedelta(hours=20)
PERMANENT = re.compile(r"not on whatsapp|not a whatsapp|no whatsapp|invalid (phone|number)|do[- ]not[- ]disturb|\bdnd\b"
                       r"|opted out|opt[- ]?out|asked not to be contacted", re.I)
# When a lead who is not ready yet is looked at again.
LATER = {"route": timedelta(days=1), "open_draft": timedelta(hours=6), "unreadable": timedelta(hours=1),
         "paused": timedelta(days=1)}
PAGES = 10
# What one template costs at most (Meta's marketing rate in Kuwait, D18),
# when whatsapp_guard does not say.
TEMPLATE_RATE_USD = 0.0792
TEMPLATE_BUDGET_USD = 100.0
SEGMENT_REFUSED = ("The database refuses the reactivate kind: migration 20261003b (the follow-ups segment check) "
                   "has not landed, so no opener can be written.")
# A refusal from sales-api that holds every send, not just this lead's.
HOLD_ALL_WORDS = ("today's", "switched off", "are paused", "paused:", "wallet", "funds", "insufficient", "budget",
                  "30 messages in ten minutes", "single-copy")
# A refusal about the lead's hours: the draft waits an hour, it is not set aside.
HOURS_WORDS = ("between 9", "their time", "their clock", "day off", "friday", "quiet hours", "first message goes")
# How a send_due run ended, and which endings are a fault (the row turns red).
FAULTS = ("refusals", "hold_all", "outage", "error", "no_answer", "budget")


def settings_of(followups: Optional[dict[str, Any]]) -> dict[str, Any]:
    """followups.waves, each value checked and kept in bounds: a mistyped
    setting never sends faster than every 30 seconds or holds back half."""
    w = (followups or {}).get("waves") or {}
    w = w if isinstance(w, dict) else {}

    def num(k: str, lo: float, hi: float, cast: Callable[[Any], Any]) -> Any:
        try:
            v = cast(w.get(k, DEFAULTS[k]))
        except (TypeError, ValueError):
            v = DEFAULTS[k]
        return min(hi, max(lo, v))

    salt = str(w.get("salt") or DEFAULTS["salt"]).strip() or DEFAULTS["salt"]
    return {"per_day": num("per_day", 0, 200, int), "holdout_share": num("holdout_share", 0.0, 0.5, float),
            "batch_gap_s": num("batch_gap_s", 30, 3600, float), "salt": salt}


def holdout(contact_id: str, share: float = 0.1, salt: str = "waves") -> bool:
    """Whether a lead is held back from waves: the first 32 bits of
    sha256(salt + ':' + contact_id) below the share. The same lead lands
    the same way every time, and the salt keeps it apart from the demo
    chat's own holdout (sha256('threads:'||contact_id))."""
    h = hashlib.sha256(f"{salt}:{contact_id}".encode("utf-8")).hexdigest()
    return int(h[:8], 16) / 0x1_0000_0000 < float(share)


def is_lead(lead: Optional[dict[str, Any]]) -> bool:
    tags = (lead or {}).get("tags")
    return isinstance(tags, list) and any(str(t).strip().lower() in ROAS_TAGS for t in tags)


def demo_calendars(calendars: Optional[dict[str, Any]] = None) -> set[str]:
    """The demo calendars: the two the spec names, and any the cockpit's
    `calendars` setting marks as a demo."""
    out = set(DEMO_CALENDARS)
    for cid, v in (calendars or {}).items():
        if isinstance(v, dict) and str(v.get("type") or "") == "demo":
            out.add(str(cid))
    return out


def pool_of(lead: dict[str, Any], calls: list[dict[str, Any]], dealt: bool, now: datetime,
            demo_cals: Optional[set[str]] = None) -> Optional[tuple[str, Optional[datetime]]]:
    """The backlog pool a lead belongs to, and when the event that put them
    there happened (newest first sorts on it), or None. `calls` are the
    lead's intro and demo calls with their kinds filled in (fu.with_kinds).

    - no_show_cancelled: their latest call was missed or cancelled;
    - unclosed_demo: their latest held call (the B2B rule) was a demo on a
      demo calendar, a day ago or more, and no deal;
    - good_intro: their latest held call was an intro a day ago or more, with
      no demo after it;
    - never_booked: no intro or demo ever.
    Nobody with a call still to come, a deal, a client tag, or a latest call
    marked invalid (disqualified) is in a pool."""
    if not is_lead(lead) or fu.is_client(lead) or dealt or str(lead.get("contact_type") or "").lower() == "customer":
        return None
    if str(lead.get("opp_status") or "").lower() == "won" or "closed" in str(lead.get("stage_name") or "").lower():
        return None
    mine = sorted((a for a in calls if a.get("call_type") in ("intro", "demo") and fu._ts(a.get("start_at"))),
                  key=lambda a: fu._ts(a["start_at"]))
    if not mine:
        return "never_booked", fu._ts(lead.get("lead_created_at"))
    if any(fu._ts(a["start_at"]) > now and a.get("status") not in fu.NOT_KEPT for a in mine):
        return None
    latest = mine[-1]
    status = str(latest.get("status") or "").lower()
    if status in ("noshow", "cancelled"):
        return "no_show_cancelled", fu._ts(latest["start_at"])
    if status == "invalid":
        return None
    held = [a for a in mine if fu.shown(a, now)]
    if not held:
        return None
    last = held[-1]
    if fu._ts(last["start_at"]) > now - HELD_WAIT:
        return None
    if last.get("call_type") == "demo":
        cals = DEMO_CALENDARS if demo_cals is None else demo_cals
        if str(last.get("calendar_id") or "") not in cals:
            return None
        return "unclosed_demo", fu._ts(last["start_at"])
    if any(a.get("call_type") == "demo" and fu._ts(a["start_at"]) > fu._ts(last["start_at"]) for a in mine):
        return None
    return "good_intro", fu._ts(last["start_at"])


def first_name(lead: dict[str, Any], person: dict[str, Any]) -> Optional[str]:
    """The name the opener greets the lead by, written exactly as the lead
    receives it: sales-api's sendTemplate fills {{1}} with the first word of
    HighLevel's first name, so "Abdul-Rahman" stays whole. None when either
    the lead copy's name or HighLevel's first name is not a person's (a
    company's, digits)."""
    if not (fu.person_name(lead.get("name")) and fu.person_name(person.get("firstName"))):
        return None
    words = str(person.get("firstName") or "").strip().split()
    return words[0] if words else None


def opener_text(route: dict[str, Any], first: str, rep: str) -> Optional[str]:
    """The opener as the lead reads it: the template's text with {{n}} filled
    by position, the way sales-api's renderTemplate fills it. None when the
    route wants anything but a first name and a rep (a line is model text)."""
    variables = list(route.get("variables") or [])
    if not route.get("preview") or any(v not in ("first_name", "rep_name") for v in variables):
        return None
    values = {"first_name": first, "rep_name": rep}
    text = str(route["preview"])
    for i, v in enumerate(variables, 1):
        text = text.replace("{{%d}}" % i, values[v])
    return text


def signature(owner: Optional[dict[str, Any]], language: str) -> str:
    """Who the opener is from, as sales-api's signatureFor signs a desk send:
    the lead's own rep by first name (in Arabic letters in Arabic), else the
    sales team."""
    first = lambda v: (str(v or "").strip().split() or [""])[0]  # noqa: E731
    if language == "ar":
        return first((owner or {}).get("name_ar")) or "فريق المبيعات"
    return first((owner or {}).get("name")) or "the sales team"


def kuwait_midnight(now: datetime) -> datetime:
    return fu.kuwait_now(now).replace(hour=0, minute=0, second=0, microsecond=0) - fu.KUWAIT


def judge(status: int, res: dict[str, Any]) -> tuple[str, str]:
    """What sales-api's answer to one send means, and its words:
    - sent: the message went;
    - hold_all: nothing else may go now (sales-api says so, the ceiling, the
      day's templates, the switch, a WhatsApp pause, the wallet, the budget);
    - outage: HighLevel did not take it (a 502, "HighLevel did not send it");
    - error: sales-api itself failed or does not know the action (a 5xx, a
      400, a 401/403/404), so every other send would fail the same way;
    - hours: outside the lead's hours on sales-api's clock; it waits an hour;
    - failed: HighLevel took it and Meta failed it (an HTTP 200 whose
      follow-up or message failed);
    - lead: a refusal for this lead only (do-not-disturb, the conversation
      moved on, someone else dealt with it)."""
    f = res.get("followup") if isinstance(res.get("followup"), dict) else {}
    msg = res.get("message") if isinstance(res.get("message"), dict) else {}
    err = str(res.get("error") or msg.get("error") or f.get("error") or "").strip()
    e = err.lower()
    if res.get("hold_all") is True or status in (429, 503) or any(w in e for w in HOLD_ALL_WORDS):
        return "hold_all", err or f"sales-api answered {status}"
    if status in (502, 504) or "highlevel did not send" in e:
        return "outage", err or f"sales-api answered {status}"
    if status in (400, 401, 403, 404, 405) or status >= 500:
        return "error", f"sales-api answered {status}" + (f": {err}" if err else "")
    failed = str(f.get("status") or "") in ("failed", "expired") or str(msg.get("state") or "") == "failed"
    if status == 200 and not res.get("error") and not failed:
        return "sent", ""
    if any(w in e for w in HOURS_WORDS):
        return "hours", err
    if failed:
        return "failed", err or "HighLevel took it and it failed"
    return "lead", err or f"sales-api answered {status}"


def global_refusal(status: int, out: dict[str, Any]) -> bool:
    """A refusal that holds every send, not just this lead's."""
    return judge(status, out)[0] in ("hold_all", "outage", "error")


def _conflict(e: Exception) -> bool:
    """A row another wave already holds (the one-running-wave index), or one
    already in: anything else is an outage and is said as one."""
    return isinstance(e, http.HttpError) and (e.status == 409 or "23505" in str(e))


def _check_violation(e: Exception) -> bool:
    text = str(e)
    return isinstance(e, http.HttpError) and ("23514" in text or "check constraint" in text.lower()
                                              or "segment_check" in text)


def _q(v: Any) -> str:
    return fu._q(str(v))


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def _waves(sb: Any) -> list[dict[str, Any]]:
    rows = sb.select(WAVES, "select=*&state=in.(running,paused)&order=started_at.asc&limit=50")
    order = {p: i for i, p in enumerate(POOLS)}
    return sorted(rows, key=lambda w: (order.get(str(w.get("pool")), 99), str(w.get("started_at") or "")))


def _winding(sb: Any) -> list[dict[str, Any]]:
    """Waves that are done but still hold members to let go of, or to watch
    to their 14 days."""
    return sb.select(WAVES, "select=*&state=eq.done&settled_at=is.null&order=started_at.asc&limit=50")


def _calls_of(sb: Any, contacts: Optional[list[str]] = None) -> tuple[dict[str, list[dict[str, Any]]], set[str]]:
    calendars = sb.setting("calendars") or {}
    rows: list[dict[str, Any]] = []
    cols = "select=appointment_id,contact_id,calendar_id,call_type,start_at,booked_at,status"
    if contacts is None:
        rows = sb.select_all("cockpit_sales_calendar", cols, order="appointment_id")
    else:
        for chunk in fu._chunks(sorted(set(contacts))):
            rows += sb.select_all("cockpit_sales_calendar", f"{cols}&contact_id={fu._in(chunk)}", order="appointment_id")
    out: dict[str, list[dict[str, Any]]] = {}
    for a in fu.with_kinds(rows, calendars):
        out.setdefault(str(a.get("contact_id") or ""), []).append(a)
    return out, demo_calendars(calendars)


def _dealt(sb: Any, contacts: Optional[list[str]] = None) -> set[str]:
    if contacts is None:
        rows = sb.select_all("cockpit_sales_deals", "select=contact_id", order="response_id")
    else:
        rows = []
        for chunk in fu._chunks(sorted(set(contacts))):
            rows += sb.select("cockpit_sales_deals", f"select=contact_id&contact_id={fu._in(chunk)}&limit=1000")
    return {str(d["contact_id"]) for d in rows if d.get("contact_id")}


LEAD_COLS = ("select=contact_id,name,company,country,tags,lead_created_at,lead_class,contact_type,stage_name,"
             "opp_status,assigned_to,phone,email,dnd,revenue,readiness")


def _member(wid: str, c: str, state: str) -> str:
    return f"{MEMBERS}?wave_id=eq.{_q(wid)}&contact_id=eq.{_q(c)}&state=eq.{state}"


def _move(sb: Any, wid: str, c: str, state: str, body: dict[str, Any]) -> bool:
    """One member moved, only from the state it was read in: a member another
    run moved meanwhile is left as it is."""
    done = sb.rest("PATCH", _member(wid, c, state), json_body=body, prefer="return=representation")
    return bool(isinstance(done, list) and done)


# ---------------------------------------------------------------------------
# Enrolment: a running wave's pool, until every chunk is in
# ---------------------------------------------------------------------------

def pools(sb: Any, now: datetime) -> dict[str, list[tuple[str, Optional[datetime]]]]:
    """Every lead in a backlog pool now: {pool: [(contact_id, event_at)]}."""
    leads = sb.select_all("cockpit_sales_leads", LEAD_COLS, order="contact_id")
    (calls, cals), dealt = _calls_of(sb), _dealt(sb)
    out: dict[str, list[tuple[str, Optional[datetime]]]] = {p: [] for p in POOLS}
    for lead in leads:
        c = str(lead.get("contact_id") or "")
        p = pool_of(lead, calls.get(c, []), c in dealt, now, cals) if c else None
        if p:
            out[p[0]].append((c, p[1]))
    return out


def pools_summary(sb: Any, now: datetime, w: dict[str, Any]) -> dict[str, Any]:
    """How many leads each pool holds now and how many its holdout keeps
    back; written nowhere (desk.py waves --pools)."""
    out = {}
    for p, members in pools(sb, now).items():
        held = sum(holdout(c, w["holdout_share"], w["salt"]) for c, _ in members)
        out[p] = {"leads": len(members), "held_back": held, "to_message": len(members) - held}
    return out


def _busy(sb: Any, wave_id: str, now: datetime) -> set[str]:
    """Leads another wave already has: open in any other wave (the
    one-running-wave index's own rule, whatever that wave's state), or sent
    an opener, or measured in a holdout, in the last 30 days."""
    busy = {str(m["contact_id"]) for m in sb.select_all(
        MEMBERS, f"select=contact_id,wave_id&state=in.({','.join(OPEN_STATES)})&wave_id=neq.{_q(wave_id)}",
        order="contact_id,wave_id")}
    since = (now - timedelta(days=RECENT_DAYS)).isoformat()
    busy |= {str(m["contact_id"]) for m in sb.select_all(
        MEMBERS, "select=contact_id,wave_id&or=" + fu._q(f'(sent_at.gte."{since}",due_at.gte."{since}")'),
        order="contact_id,wave_id")}
    return busy


def enroll(sb: Any, wave: dict[str, Any], now: datetime, w: dict[str, Any],
           log: Callable[[str], None]) -> dict[str, Any]:
    """A running wave's pool: every lead in it a member, a tenth held back.
    Run until the wave carries enrolled_at, so a run that dies after one
    chunk is finished by the next (a member already in is left as it is).
    A wave nobody can join (an empty pool, or every lead in another wave)
    ends (state done) and says why, rather than being read again every run."""
    wid, pool = str(wave["id"]), str(wave.get("pool") or "")
    if pool not in POOLS:
        raise ValueError(f"wave {wid} names a pool the desk does not know ({pool})")
    share = float(wave.get("holdout_share") if wave.get("holdout_share") is not None else w["holdout_share"])
    busy = _busy(sb, wid, now)
    in_pool = pools(sb, now)[pool]
    members = [(c, at) for c, at in in_pool if c not in busy]
    taken = len(in_pool) - len(members)
    rows = [{"wave_id": wid, "contact_id": c, "arm": "holdout" if holdout(c, share, w["salt"]) else "wave",
             "state": "held_out" if holdout(c, share, w["salt"]) else "waiting",
             "event_at": at.isoformat() if at else None, "added_at": now.isoformat()} for c, at in members]
    added = 0

    def post(body: list[dict[str, Any]]) -> int:
        made = sb.rest("POST", f"{MEMBERS}?on_conflict=wave_id,contact_id", json_body=body,
                       prefer="resolution=ignore-duplicates,return=representation")
        return len(made) if isinstance(made, list) else 0

    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        try:
            added += post(chunk)
        except http.HttpError as e:
            if not _conflict(e):
                raise  # an outage, a refused key, a missing column: said on the row, never "busy"
            # One lead in the chunk is another wave's (the one-running-wave
            # index): each goes in on its own, and that one stays out.
            for r in chunk:
                try:
                    added += post([r])
                except http.HttpError as e2:
                    if not _conflict(e2):
                        raise
                    taken += 1
    held = sum(1 for r in rows if r["arm"] == "holdout")
    body: dict[str, Any] = {"enrolled_at": now.isoformat()}
    out: dict[str, Any] = {"enrolled": added, "held_back": held, "skipped_busy": taken}
    if not sb.select(MEMBERS, f"select=contact_id&wave_id=eq.{_q(wid)}&limit=1"):
        why = ("nobody is in this pool now" if not in_pool else
               "every lead in this pool is already in another wave or had an opener in the last 30 days")
        body.update({"state": "done", "done_reason": f"Nobody to message: {why}."})
        out["done"] = f"Nobody to message: {why}"
        log(f"waves: {POOL_WORDS[pool]}: {why}; the wave is done")
    else:
        log(f"waves: {POOL_WORDS[pool]}: {added} leads enrolled, {held} held back to measure the effect")
    sb.rest("PATCH", f"{WAVES}?id=eq.{_q(wid)}&enrolled_at=is.null", json_body=body, prefer="return=minimal")
    return out


# ---------------------------------------------------------------------------
# Keeping members in step with their drafts, and with what the opener did
# ---------------------------------------------------------------------------

def sync(sb: Any, wave_ids: list[str], now: datetime) -> dict[str, int]:
    """Each drafted member's state from its draft: sent (the 14 days start),
    skipped by a rep (out of the wave), failed (drafted again the next day,
    once, unless the reason will not change), or expired with nobody
    deciding (back to waiting, so no lead leaves the wave without a
    message). A missing draft is one a run never finished: back to waiting."""
    out = {"sent": 0, "excluded": 0, "failed": 0, "back": 0}
    if not wave_ids:
        return out
    drafted = sb.select_all(MEMBERS, f"select=wave_id,contact_id,followup_id,fail_count&wave_id={fu._in(wave_ids)}"
                                     "&state=eq.drafted&followup_id=not.is.null", order="contact_id,wave_id")
    by_id = {str(m["followup_id"]): m for m in drafted}
    drafts: dict[str, dict[str, Any]] = {}
    for chunk in fu._chunks(sorted(by_id)):
        for f in sb.select(FOLLOWUPS, f"select=id,status,error,decided_at&id={fu._in(chunk)}&limit=1000"):
            drafts[str(f["id"])] = f
    for fid, m in by_id.items():
        f = drafts.get(fid) or {}
        s = f.get("status") if f else None
        if s == "sent":
            body, k = {"state": "sent", "sent_at": f.get("decided_at") or now.isoformat()}, "sent"
        elif s == "skipped":
            body, k = {"state": "excluded", "excluded_reason": "A rep skipped the opener."}, "excluded"
        elif s == "failed":
            n = int(m.get("fail_count") or 0) + 1
            err = http.scrub(str(f.get("error") or ""))[:200]
            k = "failed"
            if n >= FAIL_LIMIT or PERMANENT.search(err):
                body = {"state": "excluded", "fail_count": n, "last_error": err,
                        "excluded_reason": (f"The opener failed{' twice' if n >= FAIL_LIMIT else ''}: "
                                            f"{err or 'no reason given'}")[:300]}
            else:
                body = {"state": "waiting", "followup_id": None, "drafted_at": None, "fail_count": n,
                        "last_error": err, "next_try_at": (now + RETRY_AFTER).isoformat()}
        elif s == "expired" or s is None:
            body, k = {"state": "waiting", "followup_id": None, "drafted_at": None}, "back"
        else:
            continue
        done = sb.rest("PATCH", f"{_member(str(m['wave_id']), str(m['contact_id']), 'drafted')}"
                                f"&followup_id=eq.{_q(fid)}", json_body=body, prefer="return=representation")
        out[k] += bool(isinstance(done, list) and done)
    return out


def _t0(m: dict[str, Any]) -> Optional[datetime]:
    """When a member's 14 days start: the send, or for the holdout the day
    their place in the order came up."""
    return fu._ts(m.get("sent_at")) if m.get("arm") == "wave" else fu._ts(m.get("due_at"))


def outcomes(sb: Any, wave_ids: list[str], now: datetime) -> dict[str, int]:
    """What each opener did, the same way for both arms: booked (an intro or
    demo booked after the send, within 14 days), replied (the lead wrote
    after it; still watched for a booking), or closed 14 days after it. The
    wave's effect is its booking rate minus the holdout's, both counted over
    every member of their arm. "replied" is read from the inbox copy, which
    keeps a conversation's latest message, so replied_at is their latest
    message after the send, not always their first."""
    out = {"replied": 0, "booked": 0, "closed": 0}
    if not wave_ids:
        return out
    watched = [m for m in sb.select_all(
        MEMBERS, f"select=wave_id,contact_id,arm,state,sent_at,due_at,replied_at&wave_id={fu._in(wave_ids)}"
                 f"&state=in.({','.join(WATCHED)})", order="contact_id,wave_id") if _t0(m)]
    if not watched:
        return out
    contacts = sorted({str(m["contact_id"]) for m in watched})
    since = min(_t0(m) for m in watched)
    booked: dict[str, list[datetime]] = {}
    inbound: dict[str, datetime] = {}
    for chunk in fu._chunks(contacts):
        for a in fu.with_kinds(sb.select_all(
                "cockpit_sales_calendar", "select=appointment_id,contact_id,calendar_id,call_type,booked_at,status"
                                          f"&contact_id={fu._in(chunk)}&booked_at=gte.{_q(since.isoformat())}",
                order="appointment_id")):
            t = fu._ts(a.get("booked_at"))
            if t and a.get("call_type") in ("intro", "demo"):
                booked.setdefault(str(a["contact_id"]), []).append(t)
        for r in sb.select_all("cockpit_sales_inbox", "select=contact_id,last_message_at,last_direction,inbound_whatsapp_at"
                                                      f"&contact_id={fu._in(chunk)}", order="conversation_id"):
            t, _ = fu.last_inbound([r])
            c = str(r.get("contact_id") or "")
            if t and (c not in inbound or t > inbound[c]):
                inbound[c] = t
    for m in watched:
        c, t0, state = str(m["contact_id"]), _t0(m), str(m.get("state"))
        end = t0 + timedelta(days=OUTCOME_DAYS)
        b = min((t for t in booked.get(c, []) if t0 < t <= end), default=None)
        wrote = inbound.get(c) if inbound.get(c) and inbound[c] > t0 else None
        if b:
            body, k = {"state": "booked", "booked_at": b.isoformat(),
                       **({"replied_at": wrote.isoformat()} if wrote and not m.get("replied_at") else {})}, "booked"
        elif now >= end:
            body, k = {"state": "closed", "closed_at": now.isoformat(),
                       **({"replied_at": wrote.isoformat()} if wrote and not m.get("replied_at") else {})}, "closed"
        elif wrote and state != "replied":
            body, k = {"state": "replied", "replied_at": wrote.isoformat()}, "replied"
        else:
            continue
        out[k] += _move(sb, str(m["wave_id"]), c, state, body)
    return out


def wind_down(sb: Any, done: list[dict[str, Any]], now: datetime) -> dict[str, int]:
    """A wave that is done (a manager stopped it) lets go of every lead it
    still holds: its open openers are taken back (expired, so nobody sends
    them by mistake), its waiting members leave it, and held-back members
    whose turn never came are not measured. Members whose opener went, and
    held-back members whose turn came, stay watched to their 14 days."""
    out = {"taken_back": 0, "excluded": 0}
    ids = [str(x["id"]) for x in done]
    if not ids:
        return out
    why_of = {str(x["id"]): str(x.get("done_reason") or "").strip() for x in done}
    rows = sb.select_all(MEMBERS, f"select=wave_id,contact_id,arm,state,followup_id,due_at&wave_id={fu._in(ids)}"
                                  f"&state=in.({','.join(OPEN_STATES)})", order="contact_id,wave_id")
    fids = sorted({str(m["followup_id"]) for m in rows if m.get("state") == "drafted" and m.get("followup_id")})
    status: dict[str, str] = {}
    for chunk in fu._chunks(fids):
        for f in sb.select(FOLLOWUPS, f"select=id,status&id={fu._in(chunk)}&limit=1000"):
            status[str(f["id"])] = str(f.get("status") or "")
    for fid in [i for i in fids if status.get(i) == "draft"]:
        gone = sb.rest("PATCH", f"{FOLLOWUPS}?id=eq.{_q(fid)}&status=eq.draft", prefer="return=representation",
                       json_body={"status": "expired", "decided_at": now.isoformat(),
                                  "error": "The wave was stopped, so this opener was taken back."})
        if isinstance(gone, list) and gone:
            status[fid] = "expired"
            out["taken_back"] += 1
    for m in rows:
        wid, c, state = str(m["wave_id"]), str(m["contact_id"]), str(m.get("state"))
        stopped = why_of.get(wid) or "The wave was stopped."
        if state == "waiting":
            reason = f"{stopped.rstrip('.')} before their opener went."
        elif state == "drafted" and status.get(str(m.get("followup_id") or ""), "") in ("expired", ""):
            reason = f"{stopped.rstrip('.')} before their opener went; it was taken back."
        elif state == "held_out" and not m.get("due_at"):
            reason = "The wave ended before their turn, so they are not measured."
        else:
            continue  # sending: the next run's sync sees how it ended
        out["excluded"] += _move(sb, wid, c, state, {"state": "excluded", "excluded_reason": reason[:300]})
    return out


def finish(sb: Any, running: list[dict[str, Any]], now: datetime, log: Callable[[str], None]) -> list[str]:
    """A running wave with nobody left to write to is done: every lead in it
    had its opener or left it. Held-back members whose turn had not come
    start their 14 days now, with the last of the wave."""
    ended = []
    for x in running:
        wid = str(x["id"])
        if not x.get("enrolled_at"):
            continue  # enrolment not finished: the next run finishes it first
        if sb.select(MEMBERS, f"select=contact_id&wave_id=eq.{_q(wid)}&state=in.(waiting,drafted)&limit=1"):
            continue
        done = sb.rest("PATCH", f"{WAVES}?id=eq.{_q(wid)}&state=eq.running", prefer="return=representation",
                       json_body={"state": "done",
                                  "done_reason": "Every lead in the wave has had its opener or left the wave."})
        if isinstance(done, list) and done:
            sb.rest("PATCH", f"{MEMBERS}?wave_id=eq.{_q(wid)}&arm=eq.holdout&state=eq.held_out&due_at=is.null",
                    json_body={"due_at": now.isoformat()}, prefer="return=minimal")
            ended.append(wid)
            log(f"waves: {POOL_WORDS.get(str(x.get('pool')), x.get('pool'))}: every lead has had its opener or left; "
                "the wave is done")
    return ended


def settle(sb: Any, done: list[dict[str, Any]], now: datetime) -> list[str]:
    """A done wave with no member left to let go of or to watch is settled:
    it is not read again."""
    settled = []
    for x in done:
        wid = str(x["id"])
        if sb.select(MEMBERS, f"select=contact_id&wave_id=eq.{_q(wid)}"
                              f"&state=in.({','.join(sorted(set(OPEN_STATES) | set(WATCHED)))})&limit=1"):
            continue
        sb.rest("PATCH", f"{WAVES}?id=eq.{_q(wid)}&settled_at=is.null", json_body={"settled_at": now.isoformat()},
                prefer="return=minimal")
        settled.append(wid)
    return settled


# ---------------------------------------------------------------------------
# One opener
# ---------------------------------------------------------------------------

def opener_for(lead: dict[str, Any], person: dict[str, Any], thread: list[dict[str, Any]],
               routes: dict[str, dict[str, Any]], owner: Optional[dict[str, Any]], now: datetime, *,
               stop_rows: Optional[dict[str, Any]] = None, pause_days: int = fu.STOP_PAUSE_DAYS,
               gap_hours: float = 20, added_at: Optional[datetime] = None, test: bool = False) -> dict[str, Any]:
    """Whether this lead gets the opener now, and its words: {"ok": True,
    route, text, language}, or {"exclude": why} (out of the wave for good),
    or {"later": why, "until": when} (looked at again then). `test` drafts
    past do-not-disturb, for the refusal test."""
    c = str(lead.get("contact_id") or "")
    blocked = fu.blocked_channels(person)
    if not test and (lead.get("dnd") or "whatsapp" in blocked):
        return {"exclude": "WhatsApp do-not-disturb is on for this lead."}
    if not str(person.get("phone") or "").strip():
        return {"exclude": "No phone number in HighLevel."}
    first = first_name(lead, person)
    if not first:
        return {"exclude": "No first name to greet them by (the opener greets by it)."}
    kept = fu.hold_of(stop_rows, c, now)
    if kept:
        if kept[0] == "manual":
            return {"later": f"The lead is {kept[1]}.", "until": now + LATER["paused"]}
        return {"exclude": f"The lead {kept[1]}."}
    stop = fu.stop_of(thread)
    hold, _ = fu.new_stop_hold(stop_rows, c, stop, now, pause_days)
    if hold:
        return {"exclude": f"The lead {hold}.", "stop": stop}
    # A lead who wrote lately is in a conversation, or came back by themself:
    # a person answers them, never "How are you?" in the middle of it.
    wrote = max((fu._ts(m.get("at")) for m in thread if m.get("from") == "lead" and fu._ts(m.get("at"))), default=None)
    if wrote and (now - wrote < timedelta(days=OUTCOME_DAYS) or (added_at and wrote > added_at)):
        return {"exclude": "They wrote to us lately (in the last 14 days, or since the wave began): a person answers "
                           "them, not an opener."}
    auto_at = fu.automation_message(thread, set())
    if auto_at and now - auto_at < timedelta(hours=gap_hours):
        return {"later": "A HighLevel automation messaged them lately.", "until": auto_at + timedelta(hours=gap_hours)}
    by_hand = max((fu._ts(m.get("at")) for m in thread if m.get("from") == "us" and m.get("source") != "workflow"
                   and fu._ts(m.get("at"))), default=None)
    if by_hand and now - by_hand < fu.GAP:
        return {"later": "Someone wrote to them from HighLevel lately.", "until": by_hand + fu.GAP}
    language = fu.language_for(lead, thread)
    route = routes.get(language)
    if not route:
        return {"later": f"The {OPENERS[language]} template is not set up yet.", "until": now + LATER["route"]}
    text = opener_text(route, first, signature(owner, language))
    if not text:
        return {"later": f"The {OPENERS[language]} route asks for more than a name and a rep, so it is no opener.",
                "until": now + LATER["route"]}
    return {"ok": True, "route": route, "text": text, "language": language}


def _routes(sb: Any) -> dict[str, dict[str, Any]]:
    """The opener templates a manager has set up: active, with the workflow that sends them."""
    rows = sb.select("cockpit_sales_wa_templates", f"select=*&key=in.({','.join(OPENERS.values())})")
    return {lang: r for lang, key in OPENERS.items() for r in rows
            if r.get("key") == key and r.get("active") and r.get("workflow_id") and r.get("language") == lang}


def _owners(sb: Any) -> dict[str, dict[str, Any]]:
    people = sb.select("cockpit_sales_people", "select=email,ghl_user_id,name,name_ar,active&active=eq.true&limit=200")
    return {str(p["ghl_user_id"]): p for p in people if p.get("ghl_user_id")}


def _draft_row(lead: dict[str, Any], o: dict[str, Any], owner: Optional[dict[str, Any]], now: datetime, *,
               why: str, context: dict[str, Any]) -> dict[str, Any]:
    score, reasons = fu.heat(lead, now)
    return {
        "contact_id": str(lead["contact_id"]), "owner_ghl": lead.get("assigned_to") or None,
        "owner_email": (owner or {}).get("email"), "segment": "reactivate", "channel": "whatsapp_template",
        "template_key": o["route"]["key"], "touch": 1, "heat": score, "appointment_id": None, "subject": None,
        "body": o["text"], "why": why[:300],
        "context": {**context, "heat": reasons, "language": o["language"],
                    "lead": {k: lead.get(k) for k in ("name", "company", "country", "lead_class")}},
        "model": None, "status": "draft", "created_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=48)).isoformat(),
    }


# ---------------------------------------------------------------------------
# The day's batch
# ---------------------------------------------------------------------------

def _undecided_old(sb: Any, midnight: str) -> int:
    """An earlier day's wave openers nobody has decided on yet: still a
    draft, not approved into a batch (no send_after) and not held. One a rep
    held, or one approved and waiting for the lead's hours, is decided."""
    old = sb.select(FOLLOWUPS, "select=id&segment=eq.reactivate&status=eq.draft&context->>wave_id=not.is.null"
                               f"&created_at=lt.{_q(midnight)}&limit=500")
    if not old:
        return 0
    decided: set[str] = set()
    for chunk in fu._chunks([str(f["id"]) for f in old]):
        for m in sb.select(META, f"select=followup_id,send_after,held_by&followup_id={fu._in(chunk)}&limit=1000"):
            if m.get("send_after") or m.get("held_by"):
                decided.add(str(m["followup_id"]))
    return sum(1 for f in old if str(f["id"]) not in decided)


def draft_day(sb: Any, now: datetime, *, settings: dict[str, Any], w: dict[str, Any], waves: list[dict[str, Any]],
              guard: Optional[dict[str, Any]], ghl_token: str, log: Callable[[str], None],
              warn: Callable[[str], None], deadline: Optional[Callable[[], bool]] = None) -> dict[str, Any]:
    """Today's openers for the running waves, in pool order, newest first,
    no more than the day's room. Returns counts, or {"waiting": why} when
    the batch cannot be written now (a sentence for the status row), with
    "setup" when something must be set up first and "blocked" when an
    earlier batch waits for a person."""
    out: dict[str, Any] = {"drafted": 0, "excluded": 0, "later": 0, "raced": 0, "unreadable": 0}
    running = [x for x in waves if x.get("state") == "running"]
    if not running:
        return out
    gate = fu.wa_gate(guard)
    if gate:
        return {**out, "waiting": gate, "setup": True}
    k = fu.kuwait_now(now)
    days_off = [str(d).lower() for d in settings.get("quiet_days", ["friday"])]
    first_hours = settings.get("first_hours") or fu.FIRST_HOURS
    if k.strftime("%A").lower() in days_off or fu.quiet(now, settings.get("quiet") or {}) \
            or k.hour < int(first_hours[0]):
        return {**out, "waiting": f"The next batch is written after {int(first_hours[0])}:00 on a working day."}
    midnight = kuwait_midnight(now).isoformat()
    undecided = _undecided_old(sb, midnight)
    if undecided:
        return {**out, "blocked": True,
                "waiting": (f"{undecided} of an earlier day's openers still wait for approval, so no new batch is "
                            "written. Approve, hold or skip them on the Follow-ups page.")}
    routes = _routes(sb)
    if not routes:
        return {**out, "setup": True,
                "waiting": "The opener templates (opener_ar, opener_en) are not set up yet, so no opener can be written."}
    today = sb.select(FOLLOWUPS, "select=id,context&segment=eq.reactivate&context->>wave_id=not.is.null"
                                 f"&created_at=gte.{_q(midnight)}&limit=1000")
    by_wave: dict[str, int] = {}
    for f in today:
        wid = str((f.get("context") or {}).get("wave_id") or "")
        by_wave[wid] = by_wave.get(wid, 0) + 1
    room = int(w["per_day"]) - len(today)
    if room <= 0:
        return {**out, "waiting": f"Today's {w['per_day']} openers are written. The next batch is tomorrow."}
    ctx = {"owners": _owners(sb), "routes": routes, "ghl_token": ghl_token,
           "pause_days": int(settings.get("stop_pause_days", fu.STOP_PAUSE_DAYS) or fu.STOP_PAUSE_DAYS),
           "gap_hours": float(settings.get("automation_gap_hours", 20))}
    for wave in running:
        wid = str(wave["id"])
        wave_room = min(room, int(wave.get("per_day") or w["per_day"]) - by_wave.get(wid, 0))
        if wave_room <= 0:
            continue
        made, refused = _draft_wave(sb, wave, wave_room, now, ctx, out, log, warn, deadline)
        if refused:
            return {**out, "waiting": refused, "setup": True}
        room -= made
        if room <= 0 or (deadline and deadline()):
            break
    return out


def _draft_wave(sb: Any, wave: dict[str, Any], wave_room: int, now: datetime, ctx: dict[str, Any],
                out: dict[str, Any], log: Callable[[str], None], warn: Callable[[str], None],
                deadline: Optional[Callable[[], bool]]) -> tuple[int, Optional[str]]:
    """One wave's openers for today, page by page until its room is filled
    or nobody is ready. A lead who is not ready is looked at again when they
    may be (next_try_at), so the same newest leads never hide the older ones
    behind them, and HighLevel is not read for them every five minutes."""
    wid, pool = str(wave["id"]), str(wave.get("pool"))
    routes, owners = ctx["routes"], ctx["owners"]
    made = 0
    events: list[Any] = []
    seen: set[str] = set()
    for _ in range(PAGES):
        if made >= wave_room or (deadline and deadline()):
            break
        size = min(200, max(20, (wave_room - made) * 4))
        page = sb.select(MEMBERS, f"select=*&wave_id=eq.{_q(wid)}&arm=eq.wave&state=eq.waiting&or="
                         + fu._q(f'(next_try_at.is.null,next_try_at.lte."{now.isoformat()}")')
                         + f"&order=event_at.desc.nullslast&limit={size}")
        waiting = [m for m in page if str(m["contact_id"]) not in seen]
        if not waiting:
            break
        seen |= {str(m["contact_id"]) for m in waiting}
        contacts = [str(m["contact_id"]) for m in waiting]
        leads: dict[str, dict[str, Any]] = {}
        prior: dict[str, dict[str, Any]] = {}
        other: set[str] = set()
        rank = {"sent": 0, "sending": 1, "draft": 2, "skipped": 3}
        for chunk in fu._chunks(contacts):
            for l in sb.select("cockpit_sales_leads", f"{LEAD_COLS}&contact_id={fu._in(chunk)}"):
                leads[str(l["contact_id"])] = l
            # This wave's own opener for the lead, whatever became of it: a
            # run that stopped between the draft and the member is never a
            # second opener (expired and failed ones are history: sync has
            # already put the member back for a new one).
            for f in sb.select(FOLLOWUPS, f"select=id,contact_id,status&segment=eq.reactivate"
                                          f"&context->>wave_id=eq.{_q(wid)}&contact_id={fu._in(chunk)}&limit=1000"):
                s = str(f.get("status") or "")
                c = str(f["contact_id"])
                if s in rank and (c not in prior or rank[s] < rank[str(prior[c].get("status"))]):
                    prior[c] = f
            for f in sb.select(FOLLOWUPS, f"select=id,contact_id,segment,context&status=in.(draft,sending)"
                                          f"&contact_id={fu._in(chunk)}&limit=1000"):
                if not (f.get("segment") == "reactivate" and str((f.get("context") or {}).get("wave_id")) == wid):
                    other.add(str(f["contact_id"]))
        (calls, cals), dealt = _calls_of(sb, contacts), _dealt(sb, contacts)
        stop_rows = fu.stops_for(sb, contacts)
        for m in waiting:
            if made >= wave_room or (deadline and deadline()):
                break
            c = str(m["contact_id"])

            def exclude(why: str) -> None:
                out["excluded"] += _move(sb, wid, c, "waiting", {"state": "excluded", "excluded_reason": why[:300]})

            def later(why: str, until: datetime) -> None:
                _move(sb, wid, c, "waiting", {"next_try_at": until.isoformat(), "later_reason": why[:300]})
                out["later"] += 1

            lead = leads.get(c)
            if not lead or not pool_of(lead, calls.get(c, []), c in dealt, now, cals):
                exclude("No longer in a backlog pool (booked, signed, a client, or out of the lead copy).")
                continue
            p = prior.get(c)
            if p:
                if _move(sb, wid, c, "waiting", {"state": "drafted", "followup_id": str(p["id"]),
                                                 "drafted_at": now.isoformat()}):
                    made += 1
                    out["drafted"] += 1
                    events.append(m.get("event_at"))
                continue
            if c in other:
                later("Another draft for this lead is open.", now + LATER["open_draft"])
                continue
            # The route first, from what the lead copy says: a lead whose
            # template is not set up waits a day without HighLevel being read.
            lang = fu.language_for(lead, [])
            if lang not in routes:
                later(f"The {OPENERS[lang]} template is not set up yet.", now + LATER["route"])
                continue
            kept = fu.hold_of(stop_rows, c, now)
            if kept:
                if kept[0] == "manual":
                    later(f"The lead is {kept[1]}.", now + LATER["paused"])
                else:
                    exclude(f"The lead {kept[1]}.")
                continue
            try:
                thread = fu.ghl_thread(ctx["ghl_token"], c)
                person = fu.ghl_contact(ctx["ghl_token"], c)
            except Exception as e:  # noqa: BLE001 - tried again within the hour
                out["unreadable"] += 1
                _move(sb, wid, c, "waiting", {"next_try_at": (now + LATER["unreadable"]).isoformat(),
                                              "later_reason": "HighLevel could not be read."})
                warn(f"waves: {c} waits: HighLevel could not be read ({http.scrub(str(e))[:120]})")
                continue
            stop = fu.stop_of(thread)
            _, new = fu.new_stop_hold(stop_rows, c, stop, now, ctx["pause_days"])
            if new and stop_rows is not None:
                fu.record_stop(sb, c, stop, now, ctx["pause_days"], warn)
            owner = owners.get(str(lead.get("assigned_to") or ""))
            o = opener_for(lead, person, thread, routes, owner, now, stop_rows=stop_rows, pause_days=ctx["pause_days"],
                           gap_hours=ctx["gap_hours"], added_at=fu._ts(m.get("added_at")))
            if o.get("exclude"):
                exclude(o["exclude"])
                continue
            if o.get("later"):
                later(o["later"], o["until"])
                continue
            # The member is marked first, with the draft's own id, then the
            # draft is written: a run that dies between the two leaves a
            # member pointing at no draft, which sync puts back to waiting.
            # Never a draft no member points at, so never a second opener.
            fid = str(uuid.uuid4())
            if not _move(sb, wid, c, "waiting", {"state": "drafted", "followup_id": fid, "drafted_at": now.isoformat()}):
                continue
            row = _draft_row(lead, o, owner, now, why=(f"Backlog wave, {POOL_WORDS.get(pool, pool)}: the CEO's opener, "
                                                      "no AI text. Their answer opens the window for a written reply."),
                             context={"wave_id": wid, "pool": pool, "event_at": m.get("event_at"), "arm": "wave"})
            try:
                sb.rest("POST", FOLLOWUPS, json_body=[{"id": fid, **row}], prefer="return=minimal")
            except http.HttpError as e:
                sb.rest("PATCH", f"{_member(wid, c, 'drafted')}&followup_id=eq.{_q(fid)}", prefer="return=minimal",
                        json_body={"state": "waiting", "followup_id": None, "drafted_at": None})
                if _check_violation(e):
                    return made, SEGMENT_REFUSED
                if not fu._raced(e):
                    raise
                out["raced"] += 1
                later("Another draft for this lead was written meanwhile.", now + LATER["open_draft"])
                continue
            try:
                sb.rest("POST", f"{META}?on_conflict=followup_id", prefer="resolution=ignore-duplicates,return=minimal",
                        json_body=[{"followup_id": fid, "kind_key": f"reactivate.{o['language']}.whatsapp_template",
                                    "wave_id": wid}])
            except http.HttpError as e:
                warn(f"waves: {c}'s opener has no meta row ({http.scrub(str(e))[:120]}); it can be approved on its own, "
                     "not in a batch")
            made += 1
            out["drafted"] += 1
            events.append(m.get("event_at"))
            log(f"waves: opener ({o['language']}) drafted for {c}")
        if len(page) < size:
            break
    if events:
        # The held-back leads level with today's batch (newest first) start
        # their 14 days now, so each arm is measured over the same days.
        dated = [fu._ts(e) for e in events]
        cut = "" if any(d is None for d in dated) else f"&event_at=gte.{_q(min(dated).isoformat())}"
        sb.rest("PATCH", f"{MEMBERS}?wave_id=eq.{_q(wid)}&arm=eq.holdout&state=eq.held_out&due_at=is.null{cut}",
                json_body={"due_at": now.isoformat()}, prefer="return=minimal")
    return made, None


def draft_test_opener(sb: Any, lead: dict[str, Any], *, settings: dict[str, Any], ghl_token: str, now: datetime,
                      log: Callable[[str], None], warn: Callable[[str], None]) -> dict[str, Any]:
    """The opener for one test contact (followups --contact X --segment
    reactivate): no wave, no pool, no model. Do-not-disturb does not stop it,
    so the refusal test reaches sales-api; the draft says so."""
    c = str(lead.get("contact_id") or "")
    if sb.select(FOLLOWUPS, f"select=id&contact_id=eq.{fu._q(c)}&status=in.(draft,sending)&limit=1"):
        return {"skipped": "This contact already has an open draft. Approve or skip it first."}
    routes = _routes(sb)
    if not routes:
        return {"skipped": "The opener templates (opener_ar, opener_en) are not set up yet, so no opener can be written."}
    try:
        thread, person = fu.ghl_thread(ghl_token, c), fu.ghl_contact(ghl_token, c)
    except Exception as e:  # noqa: BLE001 - said in one sentence
        return {"skipped": f"HighLevel could not be read for this contact: {http.scrub(str(e))[:160]}"}
    owner = _owners(sb).get(str(lead.get("assigned_to") or ""))
    o = opener_for(lead, person, thread, routes, owner, now, test=True,
                   pause_days=int(settings.get("stop_pause_days", fu.STOP_PAUSE_DAYS) or fu.STOP_PAUSE_DAYS))
    if not o.get("ok"):
        return {"skipped": o.get("exclude") or o.get("later")}
    dnd = bool(lead.get("dnd") or fu.blocked_channels(person))
    note = ("Test contact: do-not-disturb is on, so the cockpit should refuse to send this (the refusal test). "
            if dnd else "Test contact. ")
    made = sb.rest("POST", FOLLOWUPS, prefer="return=representation", json_body=[_draft_row(
        lead, o, owner, now, why=note + "The CEO's opener, no AI text.", context={"test": True})])
    log(f"followups: reactivate opener ({o['language']}) drafted for test contact {c}")
    return {"picked": 1, "written": 1, "by_channel": {"whatsapp_template": 1}, "test": True,
            "id": (made[0] if isinstance(made, list) and made else {}).get("id"),
            "failed": 0, "no_open_channel": 0, "room": 1}


# ---------------------------------------------------------------------------
# Sending an approved batch, paced
# ---------------------------------------------------------------------------

def _desk_sends_since(sb: Any, since: datetime) -> list[dict[str, Any]]:
    return sb.select(MESSAGES, f"select=id,created_at&sent_by=eq.{DESK}"
                               f"&created_at=gte.{_q(since.isoformat())}&order=created_at.desc&limit={CEILING + 1}")


def template_budget(sb: Any, guard: Optional[dict[str, Any]], now: datetime) -> Optional[str]:
    """Why no WhatsApp template may go now for the month's budget (D18:
    whatsapp_guard.template_budget_usd_month, $100 across every source), or
    None. Spend is an estimate: this month's templates (messages sent
    through a workflow and not failed, as sales-api counts its daily
    ceiling) at the rate given, Meta's marketing rate in Kuwait when none
    is. Unreadable is not zero: the templates wait."""
    g = guard if isinstance(guard, dict) else {}

    def num(k: str, default: float) -> float:
        try:
            v = float(g.get(k, default))
        except (TypeError, ValueError):
            return default
        return v if v == v else default

    budget, rate = num("template_budget_usd_month", TEMPLATE_BUDGET_USD), num("template_rate_usd", TEMPLATE_RATE_USD)
    rate = rate if rate > 0 else TEMPLATE_RATE_USD
    cap = max(0, math.floor(budget / rate + 1e-9))
    start = (fu.kuwait_now(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0) - fu.KUWAIT).isoformat()
    n, offset = 0, 0
    try:
        while n < cap:
            rows = sb.select(MESSAGES, f"select=id&via=eq.workflow&state=neq.failed&created_at=gte.{_q(start)}"
                                       f"&order=id&limit=1000&offset={offset}")
            n += len(rows)
            if len(rows) < 1000:
                break
            offset += 1000
    except Exception as e:  # noqa: BLE001 - said, and the templates wait
        return f"This month's WhatsApp template spend could not be read ({http.scrub(str(e))[:120]}), so templates wait."
    if n >= cap:
        return (f"This month's WhatsApp template budget is spent: about ${n * rate:.0f} of ${budget:.0f} "
                f"({n} templates at about ${rate:g} each, an estimate). A manager raises "
                "whatsapp_guard.template_budget_usd_month, or templates wait for next month.")
    return None


def send_due(sb: Any, api: Callable[[str, dict[str, Any]], tuple[int, dict[str, Any]]], *, settings: dict[str, Any],
             w: dict[str, Any], waves: list[dict[str, Any]], guard: Optional[dict[str, Any]],
             clock: Callable[[], datetime], sleep: Callable[[float], None], budget_s: float,
             log: Callable[[str], None], warn: Callable[[str], None]) -> dict[str, Any]:
    """Approved drafts whose time has come (meta.send_after), sent one by one
    through sales-api (followup.send_due), at least batch_gap_s apart, the
    gap kept from the desk's last send across runs too (read again after each
    wait, so a second run's send counts). Read from the open drafts first,
    so drafts long since sent never stand in the way of today's.

    Held back: a draft someone held, a draft whose wave is not running (a
    manager paused or stopped it), anything on WhatsApp while the gate is
    shut or once the month's template budget is spent, a lead outside 09:00
    to 18:00 on their clock (or on their day off), and every send once the
    desk is near the sender ceiling or sales-api holds them all. A refusal
    for one lead sets that draft aside for a person (meta.held_by
    sales-desk, with the reason), so it never blocks the batch behind it. A
    run stops before its budget runs out; the next one carries on."""
    started = clock()
    out: dict[str, Any] = {"due": 0, "sent": 0, "refused": 0, "failed": 0, "set_aside": 0, "held": 0, "gone": 0,
                           "outside_hours": 0, "gate": 0, "wave_not_running": 0, "stopped": None, "stop_kind": None}
    drafts = sb.select_all(FOLLOWUPS, "select=id,contact_id,channel,segment,touch&status=eq.draft", order="id")
    if not drafts:
        return out
    fups = {str(f["id"]): f for f in drafts}
    meta: list[dict[str, Any]] = []
    for chunk in fu._chunks(sorted(fups)):
        meta += sb.select(META, f"select=followup_id,send_after,held_by,wave_id&followup_id={fu._in(chunk)}"
                                f"&send_after=lte.{_q(started.isoformat())}&held_by=is.null&limit=1000")
    if not meta:
        return out
    meta.sort(key=lambda m: (fu._ts(m.get("send_after")) or started, str(m["followup_id"])))
    state_of = {str(x["id"]): str(x.get("state") or "") for x in waves}
    unknown = sorted({str(m["wave_id"]) for m in meta if m.get("wave_id")} - set(state_of))
    for chunk in fu._chunks(unknown):
        for x in sb.select(WAVES, f"select=id,state&id={fu._in(chunk)}&limit=1000"):
            state_of[str(x["id"])] = str(x.get("state") or "")
    due = []
    for m in meta:
        wid = str(m.get("wave_id") or "")
        if wid and state_of.get(wid) != "running":
            out["wave_not_running"] += 1
            continue
        due.append(m)
    out["due"] = len(due)
    if not due:
        return out
    countries: dict[str, Any] = {}
    for chunk in fu._chunks(sorted({str(fups[str(m["followup_id"])]["contact_id"]) for m in due})):
        for l in sb.select("cockpit_sales_leads", f"select=contact_id,country&contact_id={fu._in(chunk)}"):
            countries[str(l["contact_id"])] = l.get("country")
    gate = fu.wa_gate(guard)
    gap = float(w["batch_gap_s"])
    first_hours = settings.get("first_hours") or fu.FIRST_HOURS
    q = settings.get("quiet") or {}
    later_hours = (int(q.get("to", 9)), int(q.get("from", 21)))
    days_off = [str(d).lower() for d in settings.get("quiet_days", ["friday"])]
    spent: Optional[str] = None
    spent_read = False
    last_at: Optional[datetime] = None
    in_a_row = 0

    def stop(kind: str, words: str) -> None:
        out["stopped"], out["stop_kind"] = words[:300], kind

    for m in due:
        fid = str(m["followup_id"])
        f = fups[fid]
        now = clock()
        channel = str(f.get("channel") or "")
        if channel.startswith("whatsapp") and gate:
            out["gate"] += 1
            continue
        country = countries.get(str(f["contact_id"]))
        local = now + fu.lead_offset(country)
        # A first message (an opener) keeps to 09:00 to 18:00 on the lead's
        # clock; a later step or a reply to 09:00 to 21:00, as sendFollowup does.
        first = int(f.get("touch") or 1) == 1 and f.get("segment") not in ("reply", "confirm")
        hours = first_hours if first else later_hours
        if not fu.in_hours(now, country, hours) or local.strftime("%A").lower() in days_off:
            out["outside_hours"] += 1
            continue
        if channel == "whatsapp_template":
            if not spent_read:
                spent_read, spent = True, template_budget(sb, guard, now)
            if spent:
                stop("budget", spent)
                break
        recent = _desk_sends_since(sb, now - CEILING_WINDOW)
        if len(recent) >= CEILING - RESERVE:
            stop("ceiling", f"The desk sent {len(recent)} messages in ten minutes; the rest wait so the sender "
                            f"ceiling keeps {RESERVE} for the demo chat.")
            break
        out_of_time = False
        for _ in range(3):
            now = clock()
            newest = next(iter(_desk_sends_since(sb, now - timedelta(seconds=gap))), None)
            t = max((x for x in (last_at, fu._ts((newest or {}).get("created_at"))) if x), default=None)
            wait = 0.0 if not t else gap - (now - t).total_seconds()
            if (now - started).total_seconds() + max(0.0, wait) + 20 > budget_s:
                out_of_time = True
                break
            if wait <= 0:
                break
            sleep(wait)
        if out_of_time:
            stop("time", "This run's time is up; the next run carries on.")
            break
        fresh = next(iter(sb.select(META, f"select=held_by,wave_id&followup_id=eq.{_q(fid)}&limit=1")), {})
        if fresh.get("held_by"):
            out["held"] += 1
            continue
        if not sb.select(FOLLOWUPS, f"select=id&id=eq.{_q(fid)}&status=eq.draft&limit=1"):
            out["gone"] += 1  # sent, skipped or expired meanwhile (another run, a rep)
            continue
        wid = str(m.get("wave_id") or "")
        now_state = next(iter(sb.select(WAVES, f"select=state&id=eq.{_q(wid)}&limit=1")), None) if wid else None
        if now_state is not None and now_state.get("state") != "running":
            out["wave_not_running"] += 1  # a manager paused or stopped it while this run waited
            continue
        try:
            status, res = api("followup.send_due", {"id": fid})
        except Exception as e:  # noqa: BLE001 - the door did not answer: stop, the next run tries again
            stop("no_answer", f"sales-api did not answer: {http.scrub(str(e))[:160]}")
            break
        res = res if isinstance(res, dict) else {}
        verdict, err = judge(status, res)
        if verdict == "sent":
            last_at = clock()
            out["sent"] += 1
            in_a_row = 0
            log(f"waves: sent {fid}")
            continue
        if verdict in ("hold_all", "outage", "error"):
            if res.get("message"):
                last_at = clock()
            stop(verdict, err)
            break
        if verdict == "hours":
            # sales-api reads the lead's clock otherwise: it waits an hour, in the queue.
            sb.rest("PATCH", f"{META}?followup_id=eq.{_q(fid)}", prefer="return=minimal",
                    json_body={"send_after": (clock() + timedelta(hours=1)).isoformat()})
            out["outside_hours"] += 1
            continue
        in_a_row += 1
        if verdict == "failed":
            last_at = clock()
            out["failed"] += 1
            warn(f"waves: {fid} failed at HighLevel or Meta: {err[:160]}")
        else:
            out["refused"] += 1
            try:
                kept = sb.rest("PATCH", f"{META}?followup_id=eq.{_q(fid)}&held_by=is.null", prefer="return=representation",
                               json_body={"send_after": None, "held_by": DESK, "held_at": clock().isoformat(),
                                          "hold_reason": err[:300]})
                out["set_aside"] += bool(isinstance(kept, list) and kept)
            except http.HttpError as e:
                warn(f"waves: {fid} could not be set aside ({http.scrub(str(e))[:120]})")
            warn(f"waves: {fid} not sent, set aside for a person: {err[:160]}")
        if in_a_row >= 3:
            stop("refusals", f"Three sends in a row were refused or failed; the last: {err[:200]}")
            break
    return out


# ---------------------------------------------------------------------------
# One pass of the waves job
# ---------------------------------------------------------------------------

def run(sb: Any, api: Callable[[str, dict[str, Any]], tuple[int, dict[str, Any]]], *, settings: dict[str, Any],
        guard: Optional[dict[str, Any]], ghl_token: str, log: Callable[[str], None],
        warn: Optional[Callable[[str], None]] = None, clock: Optional[Callable[[], datetime]] = None,
        sleep: Optional[Callable[[float], None]] = None, budget_s: float = 270) -> dict[str, Any]:
    """Enrol new waves, keep members in step, wind down stopped waves, watch
    what openers did, write today's batch, end waves with nobody left, send
    what is due. Every step says what it did; none is skipped silently.
    Nothing at all while the follow-up agent is switched off."""
    import time
    clock = clock or (lambda: datetime.now(timezone.utc))
    sleep = sleep or time.sleep
    warn = warn or log
    started = clock()
    w = settings_of(settings)
    waves = _waves(sb)
    out: dict[str, Any] = {"waves": [{"id": x["id"], "pool": x.get("pool"), "state": x.get("state")} for x in waves]}
    if settings.get("enabled") is False:
        out["skipped"] = "The follow-up agent is switched off (followups.enabled), so no wave drafts or sends"
        return out
    winding = _winding(sb)
    if waves or winding:
        # A stopped wave lets go of its leads first, so a wave started again
        # on the same pool in the same five minutes finds them free.
        synced = sync(sb, [str(x["id"]) for x in winding], started)
        if winding:
            out["wound_down"] = wind_down(sb, winding, started)
        enrolled: dict[str, Any] = {}
        for x in waves:
            if x.get("state") == "running" and not x.get("enrolled_at"):
                enrolled[str(x["id"])] = enroll(sb, x, started, w, log)
        out["enrolled"] = enrolled
        if enrolled:
            waves, winding = _waves(sb), _winding(sb)
        more = sync(sb, [str(x["id"]) for x in waves], started)
        out["synced"] = {k: synced[k] + more[k] for k in synced}
        ids = [str(x["id"]) for x in waves] + [str(x["id"]) for x in winding]
        out["outcomes"] = outcomes(sb, ids, started)
        if not ghl_token:
            out["drafted"] = {"waiting": "GHL_B2B_API_KEY is not set, so no lead's conversation can be read and no "
                                         "opener is written.", "setup": True}
        else:
            half = budget_s / 2
            out["drafted"] = draft_day(sb, started, settings=settings, w=w, waves=waves, guard=guard,
                                       ghl_token=ghl_token, log=log, warn=warn,
                                       deadline=lambda: (clock() - started).total_seconds() > half)
        out["finished"] = finish(sb, [x for x in waves if x.get("state") == "running"], started, log)
        out["settled"] = settle(sb, winding, started)
    left = budget_s - (clock() - started).total_seconds()
    out["sent"] = send_due(sb, api, settings=settings, w=w, waves=waves, guard=guard, clock=clock, sleep=sleep,
                           budget_s=max(0.0, left), log=log, warn=warn)
    return out


def words(out: dict[str, Any]) -> tuple[bool, str]:
    """The waves job's status row: (ok, one plain line). Not ok whenever a
    running wave cannot move (the switch, the gate, the templates, the key,
    the database's kind check, an earlier batch nobody decided on) or
    sending stopped on a fault, and the line says what to do."""
    waves = out.get("waves") or []
    running = [x for x in waves if x.get("state") == "running"]
    sent = out.get("sent") or {}
    parts: list[str] = []
    ok = True
    if out.get("skipped"):
        line = str(out["skipped"]).rstrip(".")
        if running:
            line += f"; {len(running)} wave{'s' if len(running) != 1 else ''} wait{'' if len(running) != 1 else 's'}"
        return not running, line
    if not waves:
        parts.append("No wave is running")
    else:
        parts.append(f"{len(running)} wave{'s' if len(running) != 1 else ''} running"
                     + (f", {len(waves) - len(running)} paused" if len(waves) > len(running) else ""))
    for e in (out.get("enrolled") or {}).values():
        parts.append(e["done"] if e.get("done") else
                     f"{e['enrolled']} leads enrolled, {e['held_back']} held back to measure the effect")
    d = out.get("drafted") or {}
    if d.get("waiting"):
        parts.append(str(d["waiting"]).rstrip("."))
        legacy = any(s in str(d["waiting"]) for s in ("not set up", "single-copy", "is not set"))
        if (d.get("setup") or d.get("blocked") or legacy) and running:
            ok = False
    if d.get("drafted"):
        parts.append(f"{d['drafted']} openers written for approval")
    if d.get("excluded"):
        parts.append(f"{d['excluded']} left out")
    if d.get("later"):
        parts.append(f"{d['later']} wait for another day")
    if d.get("unreadable"):
        parts.append(f"{d['unreadable']} waiting because HighLevel could not be read")
    wd = out.get("wound_down") or {}
    if wd.get("taken_back") or wd.get("excluded"):
        parts.append(f"a stopped wave let go of {wd.get('excluded', 0)} leads"
                     + (f" and took back {wd['taken_back']} openers" if wd.get("taken_back") else ""))
    oc = out.get("outcomes") or {}
    if oc.get("replied") or oc.get("booked"):
        parts.append(f"since their opener: {oc.get('replied', 0)} replied, {oc.get('booked', 0)} booked")
    if out.get("finished"):
        parts.append(f"{len(out['finished'])} wave{'s' if len(out['finished']) != 1 else ''} finished: every lead had "
                     "its opener or left")
    if sent.get("sent"):
        parts.append(f"{sent['sent']} sent")
    if sent.get("gate"):
        parts.append(f"{sent['gate']} approved but held: {fu.GATE_CLOSED.rstrip('.')}")
        ok = False
    if sent.get("outside_hours"):
        parts.append(f"{sent['outside_hours']} wait for 09:00 to 18:00 on the lead's clock")
    if sent.get("held"):
        parts.append(f"{sent['held']} held by a person")
    if sent.get("wave_not_running"):
        parts.append(f"{sent['wave_not_running']} approved for a wave that is paused or stopped, so not sent")
    if sent.get("failed"):
        parts.append(f"{sent['failed']} failed at HighLevel or Meta")
    if sent.get("refused"):
        parts.append(f"{sent['refused']} refused by the cockpit"
                     + (f", {sent['set_aside']} set aside for a person on the Follow-ups page" if sent.get("set_aside") else ""))
    if sent.get("stopped"):
        parts.append(f"sending stopped: {str(sent['stopped']).rstrip('.')}")
        if sent.get("stop_kind") in FAULTS:
            ok = False
    explained = any(sent.get(k) for k in ("sent", "gate", "outside_hours", "held", "gone", "refused", "failed",
                                          "wave_not_running")) or sent.get("stop_kind") in ("time", "ceiling")
    if sent.get("due") and not explained:
        parts.append(f"{sent['due']} approved openers are due and none went")
        ok = False
    return ok, "; ".join(parts)
