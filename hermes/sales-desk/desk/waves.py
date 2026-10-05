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
   back by sha256('waves:{wave id}:'||contact_id), drawn afresh for each
   wave (a second wave on the same pool never holds back the same tenth
   again). Held-back members are never
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
from .supabase import STATUS, audit

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
                  "30 messages in ten minutes", "single-copy",
                  # Meta's own account: an empty prepaid balance or a refused card
                  # (131042, "Business eligibility payment issue"), never one lead's.
                  "131042", "payment", "eligibility",
                  # The template's setup, not the lead's (sales-api index.ts templateRoute and
                  # sendTemplate, code "setup"): every opener of the template waits in the queue.
                  "template is not set up", "template is not in the cockpit", "contact fields are not set",
                  "contact fields for the room code", "setting wa_fields")
# A refusal about the lead's hours: the draft waits an hour, it is not set aside.
HOURS_WORDS = ("between 9", "their time", "their clock", "day off", "friday", "quiet hours", "first message goes",
               "does not send", "time zone")
# Refusals that only say the draft's own state moved (another run is sending
# it, a manager paused the wave, sales-api's clock is a moment behind): the
# draft is not at fault, so it is never set aside for a person.
STATE_RACE = re.compile(r"someone else has just dealt with this draft|this draft was already|not approved to go yet"
                        r"|paused or stopped|is held, so it was not sent|backlog opener was taken back"
                        r"|kind of opener is off|already going out"
                        # The lead wrote (or a rep did) since the opener was written:
                        # sales-api took it back, which is the opener working as meant.
                        r"|conversation has moved on"
                        # A rep paused the agent for the lead, or an earlier
                        # template to them is still on its way: it waits (fix round 4).
                        r"|agent is paused for this lead|has not arrived yet", re.I)
# followup.level's table: a kind a manager switched Off gets no opener written or sent.
LEVELS = "cockpit_sales_followup_levels"
# An approved opener may still go this long after its turn (followups.APPROVED_KEEP).
APPROVED_KEEP = timedelta(hours=72)
# How a send_due run ended, and which endings are a fault (the row turns red).
FAULTS = ("refusals", "hold_all", "outage", "error", "no_answer", "budget")
# sales-api's mark on an opener it is sending (followupAgent.ts SENDING), and
# the age past which it is a send that stopped half way (SENDING_STALE_MS):
# such an opener is asked for again, never stranded.
SENDING = "sales-desk:sending"
# finish()'s done_reason: a wave that ran out of leads, never one a manager stopped.
FINISHED = "Every lead in the wave has had its opener or left the wave."
# HighLevel answered the contact read with "not found" (merged or deleted).
GONE_CONTACT = "This contact is no longer in HighLevel (merged or deleted)."
# The conversation could not be read back to the lead's own last words.
LONG_THREAD = ("A person writes to this lead: their HighLevel conversation is too long to read back to their own "
               "last words, so a stop could be hidden in it.")


# HighLevel's words for a contact that is not there (a 400 or 422 carries them;
# a gateway's "Bad Request" or "Version header is not valid" does not).
GONE_WORDS = re.compile(r"not\s*found|does\s*not\s*exist|doesn'?t\s*exist|no\s+such\s+contact|deleted|merged", re.I)
# A member HighLevel called gone once waits for a second answer on a later run.
GONE_ONCE = "HighLevel said the contact is not there; it is asked again within the hour before the lead is let go."


def contact_gone(e: Exception) -> bool:
    """HighLevel's answer that it has no such contact on the contact read: a
    404, or a 400 or 422 whose words say so (stress2, round 2: a gateway's
    "Bad Request" or a refused Version header is not about the contact). An
    answer, not an outage (0, 5xx and 429 are)."""
    if not (isinstance(e, http.HttpError) and "/contacts/" in str(e.url or "")):
        return False
    if e.status == 404:
        return True
    if e.status not in (400, 422):
        return False
    raw = e.body.decode("utf-8", "replace") if isinstance(e.body, (bytes, bytearray)) else str(e.body or "")
    return bool(GONE_WORDS.search(f"{e} {raw}"))


# sales-api's AGENT_COPY.opener_stage_out, word for word.
OPENER_STAGE_OUT = ("The lead's deal is in a disqualified or lost stage in the CRM, so the backlog opener was "
                    "taken back.")
# An opener sales-api failed on (a 500) waits this long, behind the rest of the batch.
ERROR_WAIT = timedelta(minutes=30)
# HighLevel's 400, 404 or 422 about one lead's contact (passed on in a 500): that lead's refusal, not
# every send's, only when it is a 404 or its words say the contact is not there (GONE_WORDS).
LEAD_4XX = re.compile(r"HighLevel said (400|404|422)\b", re.I)
SENDING_STALE = timedelta(minutes=5)


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


def wave_salt(salt: str, wave_id: str) -> str:
    """One wave's own holdout salt: the waves' salt and the wave's id, so a
    second wave on the same pool draws its arms afresh (never the same tenth
    held back from every wave), and still apart from the demo chat's
    ('threads:'||contact_id, C36)."""
    return f"{salt}:{wave_id}"


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


# A deal the team ended in the CRM: its stage says disqualified or lost (any
# case, with or without the stage's emoji). A rep who disqualifies in
# HighLevel moves the deal there and leaves the call as it was, so the call's
# own mark never says so (stress2, round 1: 57 such leads in production).
STAGE_OUT = re.compile(r"disqualif|(?<![a-z])lost(?![a-z])", re.I)


def stage_out(lead: Optional[dict[str, Any]]) -> bool:
    """The lead's deal sits in a CRM stage that ends it: disqualified or lost."""
    return bool(STAGE_OUT.search(str((lead or {}).get("stage_name") or "")))


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
    Nobody with a call still to come, a deal, a client tag, a latest call
    marked invalid (disqualified), or a deal in a disqualified or lost stage
    in the CRM is in a pool."""
    if not is_lead(lead) or fu.is_client(lead) or dealt or str(lead.get("contact_type") or "").lower() == "customer":
        return None
    if str(lead.get("opp_status") or "").lower() == "won" or "closed" in str(lead.get("stage_name") or "").lower():
        return None
    if stage_out(lead):
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
    if res.get("hold_all") is True or res.get("code") == "setup" or status in (429, 503) \
            or any(w in e for w in HOLD_ALL_WORDS):
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


# Two waves runs at once (a manual run beside the cron's, outside flock) must
# never both write the day's batch or both send inside one gap: a lease on a
# status row, taken with a compare-and-set on its time, decides.
LEASE_FREE = "1970-01-01T00:00:00+00:00"
DRAFT_LEASE = "waves-draft-lease"
SEND_LEASE = "waves-send-lease"
DRAFT_LEASE_S = 200


def _lease_at(sb: Any, job: str) -> Optional[datetime]:
    """When the lease was last taken, or None (free, or no row yet)."""
    rows = sb.select(STATUS, f"select=at&worker=eq.{DESK}&job=eq.{_q(job)}&limit=1")
    t = fu._ts(rows[0].get("at")) if rows else None
    return t if t and t > datetime(1971, 1, 1, tzinfo=timezone.utc) else None


def _take_lease(sb: Any, job: str, now: datetime, hold_s: float) -> bool:
    """Takes the lease when the last holder took it more than `hold_s` ago
    (or let it go): one PATCH that only lands on the row as it was read."""
    sb.rest("POST", f"{STATUS}?on_conflict=worker,job", prefer="resolution=ignore-duplicates,return=minimal",
            json_body=[{"worker": DESK, "job": job, "ok": True, "at": LEASE_FREE,
                        "detail": "A lease that keeps two waves runs from working at once."}])
    got = sb.rest("PATCH", f"{STATUS}?worker=eq.{DESK}&job=eq.{_q(job)}"
                           f"&at=lt.{_q((now - timedelta(seconds=hold_s)).isoformat())}",
                  json_body={"at": now.isoformat(), "ok": True}, prefer="return=representation")
    return bool(isinstance(got, list) and got)


def _let_go(sb: Any, job: str, taken_at: datetime) -> None:
    try:
        sb.rest("PATCH", f"{STATUS}?worker=eq.{DESK}&job=eq.{_q(job)}&at=eq.{_q(taken_at.isoformat())}",
                json_body={"at": LEASE_FREE}, prefer="return=minimal")
    except Exception:  # noqa: BLE001 - it runs out by itself
        pass


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
    # A live call the count booked when the lead joined a video room is a held
    # call of its kind (never on B2B's calendars, D25): a lead who had their
    # intro live is in no "never booked" pool, and booked, not closed, in a wave.
    rows = fu.with_live(rows, fu.live_calls(sb, contacts))
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
    salt = wave_salt(w["salt"], wid)
    rows = [{"wave_id": wid, "contact_id": c, "arm": "holdout" if holdout(c, share, salt) else "wave",
             "state": "held_out" if holdout(c, share, salt) else "waiting",
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
    # What the wave holds, by arm, read back: a run that finishes an
    # enrolment an earlier run stopped half way adds nothing itself (every
    # insert is ignore-duplicates), and still says what the wave holds
    # (stress2 round 4, enrolment-finished-next-run-says-zero-enrolled).
    arms = [str(m.get("arm") or "") for m in sb.select_all(MEMBERS, f"select=arm,contact_id&wave_id=eq.{_q(wid)}",
                                                            order="contact_id")]
    held_now = sum(1 for a in arms if a == "holdout")
    body: dict[str, Any] = {"enrolled_at": now.isoformat()}
    out: dict[str, Any] = {"enrolled": len(arms), "held_back": held_now, "skipped_busy": taken}
    if added != len(arms):
        out["added_now"] = added
    if not arms:
        why = ("nobody is in this pool now" if not in_pool else
               "every lead in this pool is already in another wave or had an opener in the last 30 days")
        body.update({"state": "done", "done_reason": f"Nobody to message: {why}."})
        out["done"] = f"Nobody to message: {why}"
        log(f"waves: {POOL_WORDS[pool]}: {why}; the wave is done")
    else:
        log(f"waves: {POOL_WORDS[pool]}: {out['enrolled']} leads enrolled, {held_now} held back to measure the effect"
            + (f" ({added} added by this run)" if added != len(arms) else ""))
    sb.rest("PATCH", f"{WAVES}?id=eq.{_q(wid)}&enrolled_at=is.null", json_body=body, prefer="return=minimal")
    audit(sb, "waves.enroll", WAVES, wid, after=out,
          metadata={"pool": pool, "holdout_share": share, "salt": salt,
                    "arms": {"wave": len(arms) - held_now, "holdout": held_now},
                    "this_run": {"wave": len(rows) - held, "holdout": held}})
    return out


# ---------------------------------------------------------------------------
# Keeping members in step with their drafts, and with what the opener did
# ---------------------------------------------------------------------------

# Words a failed draft carries when its send may have gone after all (free_stuck,
# sendFollowup's "may have gone"): never retried, a person reads HighLevel.
MAY_HAVE_GONE = re.compile(r"may (not )?have gone|stopped halfway|did not confirm", re.I)


def _maybe_went(f: dict[str, Any], msgs: list[dict[str, Any]]) -> Optional[str]:
    """Whether a failed opener may have reached the lead: "sent" when its
    message says it went (HighLevel's id, a sent state, or the workflow
    enrolled), "unclear" when it may have (a row still sending or unclear, or
    the draft's own error says so), else None (it certainly did not go)."""
    # A message Meta failed (an empty wallet, the per-person marketing limit,
    # a number not on WhatsApp) never went, though HighLevel keeps its id:
    # only a row that is not failed counts (as free_stuck reads it).
    if any(str(m.get("state") or "") != "failed"
           and (m.get("ghl_message_id") or str(m.get("state") or "") in ("sent", "delivered", "read")
                or str(m.get("provider_status") or "").lower() == "enrolled") for m in msgs):
        return "sent"
    if any(str(m.get("state") or "") in ("sending", "unclear") for m in msgs):
        return "unclear"
    if MAY_HAVE_GONE.search(str(f.get("error") or "")):
        return "unclear"
    return None


def sync(sb: Any, wave_ids: list[str], now: datetime) -> dict[str, int]:
    """Each drafted member's state from its draft: sent (the 14 days start),
    skipped by a rep (out of the wave, watched from their turn), failed
    (drafted again the next day, once, unless the reason will not change, or
    the send may have gone: then never again), or expired with nobody
    deciding (back to waiting, so no lead leaves the wave without a
    message). A missing draft is one a run never finished: back to waiting."""
    out = {"sent": 0, "excluded": 0, "failed": 0, "back": 0}
    per: dict[str, dict[str, int]] = {}
    if not wave_ids:
        return out
    drafted = sb.select_all(MEMBERS, f"select=wave_id,contact_id,followup_id,fail_count,due_at&wave_id={fu._in(wave_ids)}"
                                     "&state=eq.drafted&followup_id=not.is.null", order="contact_id,wave_id")
    by_id = {str(m["followup_id"]): m for m in drafted}
    drafts: dict[str, dict[str, Any]] = {}
    for chunk in fu._chunks(sorted(by_id)):
        for f in sb.select(FOLLOWUPS, f"select=id,status,error,decided_at&id={fu._in(chunk)}&limit=1000"):
            drafts[str(f["id"])] = f
    failed_ids = sorted(fid for fid, f in drafts.items() if f.get("status") == "failed")
    # An opener a person held that went stale while held (expire_stale keeps
    # a held opener only its 48 hours): the hold was the rep's decision, so
    # the wave never writes the lead a fresh opener without it (stress2,
    # round 2: Approve all would send what the rep held).
    expired_ids = sorted(fid for fid, f in drafts.items() if f.get("status") == "expired")
    held_by_person: dict[str, dict[str, Any]] = {}
    for chunk in fu._chunks(expired_ids):
        for x in sb.select(META, f"select=followup_id,held_by,hold_reason&followup_id={fu._in(chunk)}&limit=1000"):
            who = str(x.get("held_by") or "")
            if who and who not in (DESK, SENDING):
                held_by_person[str(x["followup_id"])] = x
    msgs: dict[str, list[dict[str, Any]]] = {}
    for chunk in fu._chunks(failed_ids):
        for m in sb.select(MESSAGES, "select=followup_id,state,provider_status,ghl_message_id,created_at,error"
                                     f"&followup_id={fu._in(chunk)}&limit=1000"):
            msgs.setdefault(str(m.get("followup_id") or ""), []).append(m)
    moved: dict[str, list[str]] = {}
    for fid, m in by_id.items():
        f = drafts.get(fid) or {}
        s = f.get("status") if f else None
        # The member's turn, stamped when it came: never moved.
        turn = m.get("due_at") or now.isoformat()
        if s == "sent":
            body, k = {"state": "sent", "sent_at": f.get("decided_at") or now.isoformat()}, "sent"
        elif s == "skipped":
            body, k = {"state": "excluded", "excluded_reason": "A rep skipped the opener.",
                       "due_at": turn}, "excluded"
        elif s == "failed":
            n = int(m.get("fail_count") or 0) + 1
            err = http.scrub(str(f.get("error") or ""))[:200]
            k = "failed"
            went = _maybe_went(f, msgs.get(fid, []))
            if went == "sent":
                # It went (the workflow ran, or HighLevel has the message):
                # the lead had their opener, and is watched as sent.
                sent_at = next((x.get("created_at") for x in msgs.get(fid, []) if x.get("created_at")), None)
                body, k = {"state": "sent", "sent_at": sent_at or f.get("decided_at") or now.isoformat(),
                           "last_error": err}, "sent"
            elif went == "unclear" or not _no_send_for_certain(msgs.get(fid, [])) or MAY_HAVE_GONE.search(err):
                # It may have gone (a workflow that did not send within half an
                # hour may still run late): never a second opener, as for a
                # member counted as sent (stress2, round 2).
                body = {"state": "excluded", "fail_count": n, "last_error": err, "due_at": turn,
                        "excluded_reason": ("The opener may have gone; a person checks HighLevel before anyone "
                                            "writes to the lead again.")}
                k = "excluded"
            elif HIGHLEVEL_ACCOUNT.search(err) or any(HIGHLEVEL_ACCOUNT.search(str(x.get("error") or "")) for x in msgs.get(fid, [])):
                # HighLevel's rate limit or token (stress2 round 3): not this
                # lead's failure; written again soon, never counted against them.
                body = {"state": "waiting", "followup_id": None, "drafted_at": None, "fail_count": n - 1,
                        "last_error": err, "next_try_at": (now + HIGHLEVEL_RETRY).isoformat()}
            elif ACCOUNT_FAILED.search(err) or any(ACCOUNT_FAILED.search(str(x.get("error") or "")) for x in msgs.get(fid, [])):
                # Meta's own account failed it (the prepaid balance, a refused
                # card): not this lead's failure, so it is not counted against
                # them; the opener is written again once the account is right.
                body = {"state": "waiting", "followup_id": None, "drafted_at": None, "fail_count": n - 1,
                        "last_error": err, "next_try_at": (now + RETRY_AFTER).isoformat()}
            elif n >= FAIL_LIMIT or PERMANENT.search(err):
                body = {"state": "excluded", "fail_count": n, "last_error": err, "due_at": turn,
                        "excluded_reason": (f"The opener failed{' twice' if n >= FAIL_LIMIT else ''}: "
                                            f"{err or 'no reason given'}")[:300]}
            else:
                body = {"state": "waiting", "followup_id": None, "drafted_at": None, "fail_count": n,
                        "last_error": err, "next_try_at": (now + RETRY_AFTER).isoformat()}
        elif s == "expired" and fid in held_by_person:
            why = str(held_by_person[fid].get("hold_reason") or "").strip().rstrip(".")
            body = {"state": "excluded", "due_at": turn,
                    "excluded_reason": (f"A rep held the opener and did not release it"
                                        f"{': ' + why if why else ''}. The wave writes this lead no other opener.")[:300]}
            k = "excluded"
        elif s == "expired" or s is None:
            body, k = {"state": "waiting", "followup_id": None, "drafted_at": None}, "back"
        else:
            continue
        done = sb.rest("PATCH", f"{_member(str(m['wave_id']), str(m['contact_id']), 'drafted')}"
                                f"&followup_id=eq.{_q(fid)}", json_body=body, prefer="return=representation")
        if isinstance(done, list) and done:
            out[k] += 1
            per.setdefault(str(m["wave_id"]), {}).setdefault(k, 0)
            per[str(m["wave_id"])][k] += 1
            moved.setdefault(str(m["wave_id"]), []).append(f"{m['contact_id']}:{body['state']}")
    _sent_then_failed(sb, wave_ids, now, out, moved, per)
    # Each wave's row with its own counts (stress2 round 3).
    for wid, changes in moved.items():
        audit(sb, "waves.sync", WAVES, wid, after=per.get(wid, {}), metadata={"members": changes[:200]})
    return out


# A member counted as sent is looked at again for this long after its send:
# Meta's answer to a template can come after the waves run counted it.
SENT_RECHECK = timedelta(days=3)
# Meta's own failure on the message (its code, or HighLevel's failed or
# undelivered status): the opener certainly did not reach the lead.
META_FAILED = re.compile(r"\b13\d{4}\b|\bmeta\b|marked it (failed|undelivered)", re.I)


# Meta's account, not the lead: the prepaid balance or the card (131042), or
# HighLevel's wallet. Such a failure holds every send and counts against no lead.
ACCOUNT_FAILED = re.compile(r"131042|payment|eligibility|wallet|insufficient|\bfunds\b|\bbalance\b", re.I)
# HighLevel answered the send itself with a refusal: certainly not sent.
HIGHLEVEL_REFUSED = re.compile(r"highlevel did not send|highlevel said 4\d\d", re.I)
# HighLevel's own state, not the lead's (stress2 round 3): its burst limit
# (shared with the dialer and the mirror) or its token. Counted against no
# lead, and tried again soon.
HIGHLEVEL_ACCOUNT = re.compile(r"highlevel said (429|401|403)\b|too many requests", re.I)
# How soon an opener HighLevel's own state refused is written again.
HIGHLEVEL_RETRY = timedelta(minutes=30)


def _no_send_for_certain(msgs: list[dict[str, Any]]) -> bool:
    """A failed opener certainly never reached the lead: no message reached
    HighLevel at all, Meta (or HighLevel's status) failed every message, or
    HighLevel refused every send outright. A workflow that did not send within
    half an hour, or a send whose answer was lost, is not certain."""
    if not msgs:
        return True
    if _failed_for_certain(msgs):
        return True
    return all(str(m.get("state") or "") == "failed" and HIGHLEVEL_REFUSED.search(str(m.get("error") or ""))
               for m in msgs)


def _failed_for_certain(msgs: list[dict[str, Any]]) -> bool:
    """Every message of the opener failed, and Meta (or HighLevel's status
    for it) said so. A workflow that did not send within half an hour is not
    certain: it may still run late, and a retry would be a second opener."""
    if not msgs or any(str(m.get("state") or "") != "failed" for m in msgs):
        return False
    return any(str(m.get("provider_status") or "").lower() in ("failed", "undelivered")
               or META_FAILED.search(str(m.get("error") or "")) for m in msgs)


def _sent_then_failed(sb: Any, wave_ids: list[str], now: datetime, out: dict[str, int],
                      moved: dict[str, list[str]], per: Optional[dict[str, dict[str, int]]] = None) -> None:
    """Wave members counted as sent whose opener failed afterwards (stress2,
    round 1): sendTemplate's read-back saw the template pending, the member
    was moved to sent, and Meta's answer (the per-person limit 131049, a
    number not on WhatsApp) came later, failing the message and the draft.
    The lead never had the opener: a certain failure follows the failed rules
    (waiting again, once, or out for a reason that will not change); one that
    may have gone is taken out for a person to check. Never left counted as
    messaged."""
    sent = sb.select_all(MEMBERS, f"select=wave_id,contact_id,followup_id,fail_count,due_at,sent_at"
                                  f"&wave_id={fu._in(wave_ids)}&arm=eq.wave&state=eq.sent&followup_id=not.is.null"
                                  f"&sent_at=gte.{_q((now - SENT_RECHECK).isoformat())}", order="contact_id,wave_id")
    if not sent:
        return
    by_id = {str(m["followup_id"]): m for m in sent}
    failed: dict[str, dict[str, Any]] = {}
    for chunk in fu._chunks(sorted(by_id)):
        for f in sb.select(FOLLOWUPS, f"select=id,status,error&id={fu._in(chunk)}&status=eq.failed&limit=1000"):
            failed[str(f["id"])] = f
    if not failed:
        return
    msgs: dict[str, list[dict[str, Any]]] = {}
    for chunk in fu._chunks(sorted(failed)):
        for m in sb.select(MESSAGES, "select=followup_id,state,provider_status,ghl_message_id,error,created_at"
                                     f"&followup_id={fu._in(chunk)}&limit=1000"):
            msgs.setdefault(str(m.get("followup_id") or ""), []).append(m)
    for fid, f in failed.items():
        m = by_id[fid]
        mine = msgs.get(fid, [])
        if _maybe_went(f, mine) == "sent":
            continue
        n = int(m.get("fail_count") or 0) + 1
        err = http.scrub(str(f.get("error") or ""))[:200]
        turn = m.get("due_at") or m.get("sent_at") or now.isoformat()
        if not _failed_for_certain(mine) or MAY_HAVE_GONE.search(err):
            body = {"state": "excluded", "fail_count": n, "last_error": err, "due_at": turn,
                    "excluded_reason": ("The opener may have gone; a person checks HighLevel before anyone writes "
                                        "to the lead again.")}
        elif HIGHLEVEL_ACCOUNT.search(err) or any(HIGHLEVEL_ACCOUNT.search(str(x.get("error") or "")) for x in mine):
            # HighLevel's rate limit or token, not the lead (stress2 round 3).
            body = {"state": "waiting", "followup_id": None, "drafted_at": None, "sent_at": None, "fail_count": n - 1,
                    "last_error": err, "next_try_at": (now + HIGHLEVEL_RETRY).isoformat(), "due_at": turn}
        elif ACCOUNT_FAILED.search(err) or any(ACCOUNT_FAILED.search(str(x.get("error") or "")) for x in mine):
            # Meta's account (the balance, the card), not the lead: not counted against them (stress2, round 2).
            body = {"state": "waiting", "followup_id": None, "drafted_at": None, "sent_at": None, "fail_count": n - 1,
                    "last_error": err, "next_try_at": (now + RETRY_AFTER).isoformat(), "due_at": turn}
        elif n >= FAIL_LIMIT or PERMANENT.search(err):
            body = {"state": "excluded", "fail_count": n, "last_error": err, "due_at": turn,
                    "excluded_reason": (f"The opener failed{' twice' if n >= FAIL_LIMIT else ''}: "
                                        f"{err or 'no reason given'}")[:300]}
        else:
            body = {"state": "waiting", "followup_id": None, "drafted_at": None, "sent_at": None, "fail_count": n,
                    "last_error": err, "next_try_at": (now + RETRY_AFTER).isoformat(), "due_at": turn}
        path = f"{_member(str(m['wave_id']), str(m['contact_id']), 'sent')}&followup_id=eq.{_q(fid)}"
        try:
            done = sb.rest("PATCH", path, json_body=body, prefer="return=representation")
        except http.HttpError as e:
            if not _conflict(e) or body["state"] != "waiting":
                raise
            # Waiting again would put the lead in two running waves: out instead.
            body = {"state": "excluded", "fail_count": n, "last_error": err, "due_at": turn,
                    "excluded_reason": f"The opener failed: {err or 'no reason given'}"[:300]}
            done = sb.rest("PATCH", path, json_body=body, prefer="return=representation")
        if isinstance(done, list) and done:
            k = "failed" if body["state"] == "waiting" else "excluded"
            out[k] += 1
            if per is not None:
                per.setdefault(str(m["wave_id"]), {}).setdefault(k, 0)
                per[str(m["wave_id"])][k] += 1
            moved.setdefault(str(m["wave_id"]), []).append(f"{m['contact_id']}:sent->{body['state']}")


def _t0(m: dict[str, Any]) -> Optional[datetime]:
    """When a member's 14 days start (intent to treat at the turn, both arms
    alike): the moment their place in the order came up (due_at), stamped
    once on the wave member whose turn it is (drafted, put off or taken
    out) and on the holdout twins level with them, and never moved after.
    sent_at only records when the opener went: a manager's approval the next
    morning, or a turn put off a day, never starts the wave arm's clock
    later than the holdout's. A member whose turn never came (a stopped wave
    let them go first) has no due_at and is in neither arm's comparison
    (waves.ts countMembers); an older wave member with only sent_at counts
    from it."""
    t = fu._ts(m.get("due_at"))
    if t:
        return t
    return fu._ts(m.get("sent_at")) if m.get("arm") == "wave" else None


def outcomes(sb: Any, wave_ids: list[str], now: datetime) -> dict[str, int]:
    """What each opener did, the same way for both arms: booked (an intro or
    demo booked after the send, within 14 days), replied (the lead wrote
    after it; still watched for a booking), or closed 14 days after it. The
    wave's effect is its booking rate minus the holdout's, both counted over
    every member of their arm. "replied" is read from the inbox copy, which
    keeps a conversation's latest message, so replied_at is their latest
    message after the send, not always their first. Members taken out of the
    wave arm at their turn, and members of a stopped wave whose turn never
    came are not (they are in neither arm's comparison)."""
    out = {"replied": 0, "booked": 0, "closed": 0}
    if not wave_ids:
        return out
    watched = [m for m in sb.select_all(
        MEMBERS, f"select=wave_id,contact_id,arm,state,sent_at,due_at,added_at,replied_at&wave_id={fu._in(wave_ids)}"
                 f"&state=in.({','.join(WATCHED + ('excluded',))})", order="contact_id,wave_id") if _t0(m)]
    if not watched:
        return out
    contacts = sorted({str(m["contact_id"]) for m in watched})
    since = min(_t0(m) for m in watched)
    moved: dict[str, list[str]] = {}
    booked: dict[str, list[datetime]] = {}
    inbound: dict[str, datetime] = {}
    for chunk in fu._chunks(contacts):
        found = sb.select_all(
            "cockpit_sales_calendar", "select=appointment_id,contact_id,calendar_id,call_type,booked_at,status"
                                      f"&contact_id={fu._in(chunk)}&booked_at=gte.{_q(since.isoformat())}",
            order="appointment_id")
        # A live call the opener led to (the lead joined a video room) is its
        # booking too; a join that waits for a manager's confirm is not yet
        # (stress2, round 2: reached, never booked, until it is counted). A
        # call the count moved to the join is not a booking made at the join:
        # it was booked at its own time, which its calendar row carries, and
        # the copy read here is cut at `since` (stress2 round 3).
        live = [a for a in fu.live_calls(sb, chunk, since=since, reached=False) if not a.get("moved")]
        for a in fu.with_kinds(fu.with_live(found, live)):
            t = fu._ts(a.get("booked_at"))
            if t and a.get("call_type") in ("intro", "demo"):
                booked.setdefault(str(a["contact_id"]), []).append(t)
        for r in sb.select_all("cockpit_sales_inbox", "select=contact_id,last_message_at,last_direction,inbound_whatsapp_at"
                                                      f"&contact_id={fu._in(chunk)}", order="conversation_id"):
            t, _ = fu.last_inbound([r])
            c = str(r.get("contact_id") or "")
            if t and (c not in inbound or t > inbound[c]):
                inbound[c] = t
    per: dict[str, dict[str, int]] = {}
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
        elif wrote and state not in ("replied", "excluded"):
            body, k = {"state": "replied", "replied_at": wrote.isoformat()}, "replied"
        else:
            continue
        if _move(sb, str(m["wave_id"]), c, state, body):
            out[k] += 1
            mine = per.setdefault(str(m["wave_id"]), {})
            mine[k] = mine.get(k, 0) + 1
            moved.setdefault(str(m["wave_id"]), []).append(f"{c}:{m.get('arm')}:{body['state']}")
    # Each wave's row carries its own counts, never the run's across waves (stress2 round 3).
    for wid, changes in moved.items():
        audit(sb, "waves.outcomes", WAVES, wid, after=per.get(wid, {}), metadata={"members": changes[:200]})
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
    wave_of = {str(m["followup_id"]): str(m["wave_id"]) for m in rows if m.get("followup_id")}
    per: dict[str, dict[str, int]] = {}

    def count(wid: str, k: str, n: int = 1) -> None:
        if n:
            out[k] = out.get(k, 0) + n
            mine = per.setdefault(wid, {})
            mine[k] = mine.get(k, 0) + n

    for fid in [i for i in fids if status.get(i) == "draft"]:
        gone = sb.rest("PATCH", f"{FOLLOWUPS}?id=eq.{_q(fid)}&status=eq.draft", prefer="return=representation",
                       json_body={"status": "expired", "decided_at": now.isoformat(),
                                  "error": "The wave was stopped, so this opener was taken back."})
        if isinstance(gone, list) and gone:
            status[fid] = "expired"
            count(wave_of.get(fid, ""), "taken_back")
    for m in rows:
        wid, c, state = str(m["wave_id"]), str(m["contact_id"]), str(m.get("state"))
        stopped = why_of.get(wid) or "The wave was stopped."
        # Both arms let go of the leads whose turn never came: no due_at, so
        # neither arm's comparison counts them (like with like), and a wave
        # started again on the pool may take them at once.
        if state == "waiting":
            reason = f"{stopped.rstrip('.')} before their opener went."
        elif state == "drafted" and status.get(str(m.get("followup_id") or ""), "") in ("expired", ""):
            reason = f"{stopped.rstrip('.')} before their opener went; it was taken back."
        elif state == "held_out" and not m.get("due_at"):
            if why_of.get(wid) == FINISHED:
                # finish() stopped between the wave's done and this stamp (fix
                # round 4): the wave did finish, so their 14 days start now, as
                # finish() would have started them. They stay in the comparison.
                if _move(sb, wid, c, state, {"due_at": now.isoformat()}):
                    count(wid, "started")
                continue
            reason = "The wave ended before their turn, so they are not measured."
        else:
            continue  # sending: the next run's sync sees how it ended
        count(wid, "excluded", int(_move(sb, wid, c, state, {"state": "excluded", "excluded_reason": reason[:300]})))
    # A row only for a wave that took back or let go of someone, with its own
    # counts (stress2 round 3: never the run's across every wave).
    for x in done:
        mine = per.get(str(x["id"]), {})
        if mine.get("taken_back") or mine.get("excluded"):
            audit(sb, "waves.wind_down", WAVES, str(x["id"]), after=mine, metadata={"reason": why_of.get(str(x["id"]))})
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
        # An opener of the wave still open (approved and waiting for its turn,
        # or being sent) is work left: the wave is not done under it.
        mine = [str(m["followup_id"]) for m in sb.select(META, f"select=followup_id&wave_id=eq.{_q(wid)}&limit=1000")]
        if any(sb.select(FOLLOWUPS, f"select=id&id={fu._in(chunk)}&status=in.(draft,sending)&limit=1")
               for chunk in fu._chunks(mine)):
            continue
        done = sb.rest("PATCH", f"{WAVES}?id=eq.{_q(wid)}&state=eq.running", prefer="return=representation",
                       json_body={"state": "done", "done_reason": FINISHED})
        if isinstance(done, list) and done:
            sb.rest("PATCH", f"{MEMBERS}?wave_id=eq.{_q(wid)}&arm=eq.holdout&state=eq.held_out&due_at=is.null",
                    json_body={"due_at": now.isoformat()}, prefer="return=minimal")
            audit(sb, "waves.finish", WAVES, wid, before={"state": "running"}, after={"state": "done"})
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
        # A member taken out at their turn is watched to their 14 days too (outcomes closes them).
        if sb.select(MEMBERS, f"select=contact_id&wave_id=eq.{_q(wid)}"
                              f"&state=in.({','.join(sorted(set(OPEN_STATES) | set(WATCHED)))})&limit=1") \
                or sb.select(MEMBERS, f"select=contact_id&wave_id=eq.{_q(wid)}&state=eq.excluded&due_at=not.is.null&limit=1"):
            continue
        sb.rest("PATCH", f"{WAVES}?id=eq.{_q(wid)}&settled_at=is.null", json_body={"settled_at": now.isoformat()},
                prefer="return=minimal")
        audit(sb, "waves.settle", WAVES, wid, after={"settled_at": now.isoformat()})
        settled.append(wid)
    return settled


# ---------------------------------------------------------------------------
# One opener
# ---------------------------------------------------------------------------

def opener_for(lead: dict[str, Any], person: dict[str, Any], thread: list[dict[str, Any]],
               routes: dict[str, dict[str, Any]], owner: Optional[dict[str, Any]], now: datetime, *,
               stop_rows: Optional[dict[str, Any]] = None, pause_days: int = fu.STOP_PAUSE_DAYS,
               gap_hours: float = 20, added_at: Optional[datetime] = None, test: bool = False,
               inbox_rows: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
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
    # The inbox copy's own last word from the lead, as a second source
    # (stress2, round 2): a message HighLevel's thread kept with no words.
    last_in, _ = fu.last_inbound(inbox_rows or [])
    if last_in and (wrote is None or last_in > wrote):
        wrote = last_in
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


def _ensure_meta(sb: Any, fid: str, wid: str, language: Any, warn: Callable[[str], None]) -> bool:
    """The opener's meta row, with its wave and kind, written if it is not
    there (ignore-duplicates: one written before stays as it is). Without it
    Approve all would make one with no wave, and a paused or stopped wave
    would no longer hold the opener. A failure is said; the next run's
    repair_meta writes it."""
    lang = str(language or "")
    row: dict[str, Any] = {"followup_id": fid, "wave_id": wid}
    if lang in OPENERS:
        row["kind_key"] = f"reactivate.{lang}.whatsapp_template"
    try:
        sb.rest("POST", f"{META}?on_conflict=followup_id", prefer="resolution=ignore-duplicates,return=minimal",
                json_body=[row])
        return True
    except http.HttpError as e:
        warn(f"waves: opener {fid} has no meta row yet ({http.scrub(str(e))[:120]}); the next run writes it")
        return False


def repair_meta(sb: Any, wave_ids: list[str], warn: Callable[[str], None]) -> int:
    """Every open opener of these waves gets its meta row (its wave and
    kind), and a meta row made without its wave (Approve all on an opener
    whose meta was lost) gets it back, before anything is approved or sent."""
    if not wave_ids:
        return 0
    drafts = sb.select_all(FOLLOWUPS, "select=id,context&segment=eq.reactivate&status=eq.draft"
                                      f"&context->>wave_id={fu._in(wave_ids)}", order="id")
    if not drafts:
        return 0
    have: dict[str, dict[str, Any]] = {}
    for chunk in fu._chunks(sorted(str(f["id"]) for f in drafts)):
        for m in sb.select(META, f"select=followup_id,wave_id&followup_id={fu._in(chunk)}&limit=1000"):
            have[str(m["followup_id"])] = m
    fixed = 0
    for f in drafts:
        fid, ctx = str(f["id"]), (f.get("context") or {})
        wid = str(ctx.get("wave_id") or "")
        m = have.get(fid)
        if m is None:
            fixed += _ensure_meta(sb, fid, wid, ctx.get("language"), warn)
        elif not m.get("wave_id") and wid:
            try:
                sb.rest("PATCH", f"{META}?followup_id=eq.{_q(fid)}&wave_id=is.null", json_body={"wave_id": wid},
                        prefer="return=minimal")
                fixed += 1
            except http.HttpError as e:
                warn(f"waves: opener {fid}'s meta row has no wave ({http.scrub(str(e))[:120]})")
    return fixed


def levels_of(sb: Any) -> dict[str, str]:
    """followup.level's word for each opener kind ({kind_key: level}); a kind
    switched Off gets no opener written or sent."""
    rows = sb.select(LEVELS, "select=kind_key,level&limit=500")
    return {str(r["kind_key"]): str(r.get("level") or "") for r in rows
            if str(r.get("kind_key") or "").startswith("reactivate.")}


# ---------------------------------------------------------------------------
# The day's batch
# ---------------------------------------------------------------------------

def _undecided_old(sb: Any, midnight: str, running: Optional[set[str]] = None) -> dict[str, int]:
    """An earlier day's wave openers nobody has decided on yet, by wave:
    still a draft, not approved into a batch (no send_after) and not held.
    One a rep held, or one approved and waiting for the lead's hours, is
    decided. Only a running wave's count (`running`, when given): a paused
    wave's old openers wait for its resume and hold no other wave's batch."""
    old = sb.select(FOLLOWUPS, "select=id,context&segment=eq.reactivate&status=eq.draft&context->>wave_id=not.is.null"
                               f"&created_at=lt.{_q(midnight)}&limit=500")
    if not old:
        return {}
    decided: set[str] = set()
    wave_of: dict[str, str] = {}
    for chunk in fu._chunks([str(f["id"]) for f in old]):
        for m in sb.select(META, f"select=followup_id,send_after,held_by,wave_id&followup_id={fu._in(chunk)}&limit=1000"):
            if m.get("send_after") or m.get("held_by"):
                decided.add(str(m["followup_id"]))
            if m.get("wave_id"):
                wave_of[str(m["followup_id"])] = str(m["wave_id"])
    out: dict[str, int] = {}
    for f in old:
        fid = str(f["id"])
        if fid in decided:
            continue
        wid = wave_of.get(fid) or str((f.get("context") or {}).get("wave_id") or "")
        if running is not None and wid not in running:
            continue
        out[wid] = out.get(wid, 0) + 1
    return out


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
    # The month's template budget (fix round 4): spent (or unreadable), no
    # opener is written for approval that could not go this month; each one
    # would hold its lead's one open draft until it went stale.
    spent = template_budget(sb, guard, now)
    if spent:
        return {**out, "waiting": spent, "setup": True}
    k = fu.kuwait_now(now)
    days_off = [str(d).lower() for d in settings.get("quiet_days", ["friday"])]
    first_hours = settings.get("first_hours") or fu.FIRST_HOURS
    if k.strftime("%A").lower() in days_off or fu.quiet(now, settings.get("quiet") or {}) \
            or k.hour < int(first_hours[0]):
        return {**out, "waiting": f"The next batch is written after {int(first_hours[0])}:00 on a working day."}
    midnight = kuwait_midnight(now).isoformat()
    # Each running wave waits only on its own earlier openers nobody decided
    # on; a paused wave's wait for its resume and hold no other wave's batch.
    undecided = _undecided_old(sb, midnight, {str(x["id"]) for x in running})
    if undecided:
        out["blocked_waves"] = undecided
        running = [x for x in running if not undecided.get(str(x["id"]))]
        if not running:
            return {**out, "blocked": True,
                    "waiting": (f"{sum(undecided.values())} of an earlier day's openers still wait for approval, so no "
                                "new batch is written. Approve or hold them under Today's batch on the Follow-ups page.")}
    routes = _routes(sb)
    if not routes:
        return {**out, "setup": True,
                "waiting": "The opener templates (opener_ar, opener_en) are not set up yet, so no opener can be written."}
    try:
        levels = levels_of(sb)
    except http.HttpError as e:
        return {**out, "waiting": f"The opener levels could not be read ({http.scrub(str(e))[:120]}); the next run "
                                  "writes the batch."}
    if all(levels.get(f"reactivate.{lang}.whatsapp_template") == "off" for lang in routes):
        return {**out, "waiting": "Every opener kind is switched off (Follow-ups, levels), so no opener is written."}
    today = sb.select(FOLLOWUPS, "select=id,context&segment=eq.reactivate&context->>wave_id=not.is.null"
                                 f"&created_at=gte.{_q(midnight)}&limit=1000")
    by_wave: dict[str, int] = {}
    for f in today:
        wid = str((f.get("context") or {}).get("wave_id") or "")
        by_wave[wid] = by_wave.get(wid, 0) + 1
    room = int(w["per_day"]) - len(today)
    if room <= 0:
        return {**out, "waiting": f"Today's {w['per_day']} openers are written. The next batch is tomorrow."}
    ctx = {"owners": _owners(sb), "routes": routes, "ghl_token": ghl_token, "levels": levels,
           "pause_days": int(settings.get("stop_pause_days", fu.STOP_PAUSE_DAYS) or fu.STOP_PAUSE_DAYS),
           "gap_hours": float(settings.get("automation_gap_hours", 20)),
           "windows": sequence_windows(settings)}
    try:
        leased = _take_lease(sb, DRAFT_LEASE, now, DRAFT_LEASE_S)
    except http.HttpError as e:
        return {**out, "waiting": f"The drafting lease could not be read ({http.scrub(str(e))[:120]}); the next run writes the batch."}
    if not leased:
        return {**out, "waiting": "Another waves run is writing today's batch; this one leaves it to that run."}
    try:
        return _draft_waves(sb, running, room, by_wave, now, ctx, out, w, log, warn, deadline)
    finally:
        _let_go(sb, DRAFT_LEASE, now)


def _draft_waves(sb: Any, running: list[dict[str, Any]], room: int, by_wave: dict[str, int], now: datetime,
                 ctx: dict[str, Any], out: dict[str, Any], w: dict[str, Any], log: Callable[[str], None],
                 warn: Callable[[str], None], deadline: Optional[Callable[[], bool]]) -> dict[str, Any]:
    """The running waves' openers for today, under the drafting lease."""
    # The day's count again, now that this run holds the lease: a run that
    # wrote some meanwhile has used that room.
    midnight = kuwait_midnight(now).isoformat()
    today = sb.select(FOLLOWUPS, "select=id,context&segment=eq.reactivate&context->>wave_id=not.is.null"
                                 f"&created_at=gte.{_q(midnight)}&limit=1000")
    by_wave = {}
    for f in today:
        wid = str((f.get("context") or {}).get("wave_id") or "")
        by_wave[wid] = by_wave.get(wid, 0) + 1
    room = int(w["per_day"]) - len(today)
    if room <= 0:
        return {**out, "waiting": f"Today's {w['per_day']} openers are written. The next batch is tomorrow."}
    for wave in running:
        wid = str(wave["id"])
        # A wave started at 0 openers a day writes none (0 is a number, not "unset").
        per_day = wave.get("per_day") if wave.get("per_day") is not None else w["per_day"]
        wave_room = min(room, int(per_day) - by_wave.get(wid, 0))
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
    written: list[str] = []
    excluded: list[str] = []
    seen: set[str] = set()
    for _ in range(PAGES):
        if made >= wave_room or (deadline and deadline()):
            break
        # The agent's switch again on every page (stress2 round 4): openers
        # stop being written once a manager switched the agent off.
        if not fu.agent_still_on(sb):
            out["switched_off"] = True
            log("waves: the follow-up agent was switched off during this run; no more openers are written")
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
            for f in sb.select(FOLLOWUPS, f"select=id,contact_id,status,context&segment=eq.reactivate"
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

            # Their turn has come: due_at is stamped now, once (never moved
            # after), whatever happens next (drafted, put off, taken out), and
            # the holdout twins level with them get the same moment below, so
            # both arms' 14 days start together (intent to treat at the turn).
            turn = {"due_at": m.get("due_at") or now.isoformat()}
            events.append(m.get("event_at"))

            def exclude(why: str) -> None:
                # Taken out at their turn: watched like their twins in the holdout.
                if _move(sb, wid, c, "waiting", {"state": "excluded", "excluded_reason": why[:300], **turn}):
                    out["excluded"] += 1
                    excluded.append(c)

            def later(why: str, until: datetime) -> None:
                _move(sb, wid, c, "waiting", {"next_try_at": until.isoformat(), "later_reason": why[:300], **turn})
                out["later"] += 1

            lead = leads.get(c)
            if not lead or not pool_of(lead, calls.get(c, []), c in dealt, now, cals):
                # An opener an earlier run wrote for them and died before
                # moving the member (fix round 4) is taken back with them, so
                # no open opener is left for a lead the wave let go of.
                p = prior.get(c)
                if p and str(p.get("status") or "") == "draft":
                    sb.rest("PATCH", f"{FOLLOWUPS}?id=eq.{_q(str(p['id']))}&status=eq.draft", prefer="return=minimal",
                            json_body={"status": "expired", "decided_at": now.isoformat(),
                                       "error": "The lead left the backlog pool, so this opener was taken back."})
                exclude("No longer in a backlog pool (booked, signed, a client, or out of the lead copy).")
                continue
            p = prior.get(c)
            if p:
                # A run that stopped between its draft and the rest: the opener
                # is adopted, and its meta row (the wave every gate reads) is
                # written now if that run did not get to it.
                _ensure_meta(sb, str(p["id"]), wid, (p.get("context") or {}).get("language"), warn)
                if _move(sb, wid, c, "waiting", {"state": "drafted", "followup_id": str(p["id"]),
                                                 "drafted_at": now.isoformat(), **turn}):
                    made += 1
                    out["drafted"] += 1
                continue
            if c in other:
                later("Another draft for this lead is open.", now + LATER["open_draft"])
                continue
            # A lead whose clock the cockpit does not know (a country code
            # with no time zone in the table): sales-api lets no first message
            # go by itself to them, so no opener is written for the desk to
            # send; they are taken out with the reason, and a person writes.
            if fu.lead_zones(lead.get("country")) is None:
                exclude(f"A person writes this lead's first message: their time zone is not known "
                        f"(country {str(lead.get('country') or '').strip().upper()}).")
                continue
            # The route first, from what the lead copy says: a lead whose
            # template is not set up waits a day without HighLevel being read.
            lang = fu.language_for(lead, [])
            if lang not in routes:
                later(f"The {OPENERS[lang]} template is not set up yet.", now + LATER["route"])
                # Missing is never zero: the row names the template they wait for.
                no_route = out.setdefault("no_route", {})
                no_route[OPENERS[lang]] = no_route.get(OPENERS[lang], 0) + 1
                continue
            if ctx["levels"].get(f"reactivate.{lang}.whatsapp_template") == "off":
                later("This kind of opener is switched off (Follow-ups, levels).", now + LATER["route"])
                continue
            kept = fu.hold_of(stop_rows, c, now)
            if kept:
                if kept[0] == "manual":
                    later(f"The lead is {kept[1]}.", now + LATER["paused"])
                else:
                    exclude(f"The lead {kept[1]}.")
                continue
            # The follow-up agent's own sequence for this lead still runs (a
            # no-show, a new lead, after a call): the opener waits until it
            # has run, so the lead never gets "How are you?" in the middle of
            # it (stress2 round 3, backlog-wave-overlaps-agent-sequences).
            try:
                seq = in_sequence(sb, c, now, ctx["windows"])
            except http.HttpError as e:
                out["unreadable"] += 1
                _move(sb, wid, c, "waiting", {"next_try_at": (now + LATER["unreadable"]).isoformat(),
                                              "later_reason": "The agent's own messages to the lead could not be read."})
                warn(f"waves: {c} waits: the agent's own messages could not be read ({http.scrub(str(e))[:120]})")
                continue
            if seq:
                later(f"The follow-up agent is still taking them through its {SEQUENCE_WORDS.get(seq[0], seq[0])} "
                      "messages; the opener waits until those have run.", seq[1])
                continue
            try:
                person = fu.ghl_contact(ctx["ghl_token"], c)
                thread, whole = fu.ghl_history(ctx["ghl_token"], c)
            except Exception as e:  # noqa: BLE001 - tried again within the hour
                if contact_gone(e):
                    # HighLevel answered: the contact was merged away or
                    # deleted. Let go at their turn, never retried as an
                    # outage (stress2, round 1), so the wave can finish; on
                    # the second such answer, a run apart (stress2, round 2:
                    # one answer may be a deploy's or a gateway's).
                    if str(m.get("later_reason") or "") == GONE_ONCE:
                        exclude(GONE_CONTACT)
                    else:
                        _move(sb, wid, c, "waiting", {"next_try_at": (now + LATER["unreadable"]).isoformat(),
                                                      "later_reason": GONE_ONCE})
                        out["unreadable"] += 1
                    continue
                out["unreadable"] += 1
                _move(sb, wid, c, "waiting", {"next_try_at": (now + LATER["unreadable"]).isoformat(),
                                              "later_reason": "HighLevel could not be read."})
                warn(f"waves: {c} waits: HighLevel could not be read ({http.scrub(str(e))[:120]})")
                continue
            if not whole:
                # The lead's own last words could not be reached (a long run
                # of automated messages): a stop could be hidden there, so no
                # opener is written; a person writes (stress2, round 1).
                exclude(LONG_THREAD)
                continue
            stop = fu.stop_of(thread)
            _, new = fu.new_stop_hold(stop_rows, c, stop, now, ctx["pause_days"])
            if new and stop_rows is not None:
                fu.record_stop(sb, c, stop, now, ctx["pause_days"], warn)
            owner = owners.get(str(lead.get("assigned_to") or ""))
            try:
                inbox = sb.select("cockpit_sales_inbox", "select=inbound_whatsapp_at,last_message_at,last_direction,"
                                                         f"last_type&contact_id=eq.{_q(c)}&limit=20")
            except Exception:  # noqa: BLE001 - the thread itself is the first source
                inbox = []
            o = opener_for(lead, person, thread, routes, owner, now, stop_rows=stop_rows, pause_days=ctx["pause_days"],
                           gap_hours=ctx["gap_hours"], added_at=fu._ts(m.get("added_at")), inbox_rows=inbox)
            if o.get("exclude"):
                exclude(o["exclude"])
                continue
            if o.get("later"):
                later(o["later"], o["until"])
                continue
            # The draft first (with the wave's id in its context), then its
            # meta row, then the member points at it: the member's followup_id
            # is a foreign key to the draft, so the member can never point at
            # a draft that is not there. A run that dies between the two
            # leaves a draft this wave's next run adopts (`prior` above),
            # never a second opener; a member another run moved meanwhile
            # leaves the draft just written, which is taken back.
            fid = str(uuid.uuid4())
            row = _draft_row(lead, o, owner, now, why=(f"Backlog wave, {POOL_WORDS.get(pool, pool)}: the CEO's opener, "
                                                      "no AI text. Their answer opens the window for a written reply."),
                             context={"wave_id": wid, "pool": pool, "event_at": m.get("event_at"), "arm": "wave"})
            try:
                sb.rest("POST", FOLLOWUPS, json_body=[{"id": fid, **row}], prefer="return=minimal")
            except http.HttpError as e:
                if _check_violation(e):
                    return made, SEGMENT_REFUSED
                if not fu._raced(e):
                    raise
                out["raced"] += 1
                later("Another draft for this lead was written meanwhile.", now + LATER["open_draft"])
                continue
            _ensure_meta(sb, fid, wid, o["language"], warn)
            if not _move(sb, wid, c, "waiting", {"state": "drafted", "followup_id": fid, "drafted_at": now.isoformat(),
                                                 **turn}):
                sb.rest("PATCH", f"{FOLLOWUPS}?id=eq.{_q(fid)}&status=eq.draft", prefer="return=minimal",
                        json_body={"status": "expired", "decided_at": now.isoformat(),
                                   "error": "Another run moved this lead in the wave meanwhile, so this opener was taken back."})
                continue
            written.append(fid)
            made += 1
            out["drafted"] += 1
            log(f"waves: opener ({o['language']}) drafted for {c}")
        if len(page) < size:
            break
    if written or excluded:
        audit(sb, "waves.draft", WAVES, wid, after={"drafted": len(written), "excluded": len(excluded)},
              metadata={"followup_ids": written[:200], "excluded": excluded[:200]})
    if events:
        # The held-back leads level with today's turns (newest first) start
        # their 14 days now, as the wave members whose turn came did: each arm
        # is measured over the same days.
        dated = [fu._ts(e) for e in events]
        cut = "" if any(d is None for d in dated) else f"&event_at=gte.{_q(min(dated).isoformat())}"
        sb.rest("PATCH", f"{MEMBERS}?wave_id=eq.{_q(wid)}&arm=eq.holdout&state=eq.held_out&due_at=is.null{cut}",
                json_body={"due_at": now.isoformat()}, prefer="return=minimal")
    return made, None


def stamp_twins(sb: Any, wid: str) -> int:
    """The held-back twins whose turn has come and whose 14 days never
    started (stress2 round 4, holdout-stamp-lost-on-blip): the one write at
    the end of a day's drafting failed, and every later run that day stopped
    at "today's openers are written". Each twin takes the moment of the turn
    it is level with: the due_at of the wave member just older than it in the
    turn order (newest first), so both arms start from the same moment,
    whichever run catches up. Answers how many were stamped."""
    turned = sb.select_all(MEMBERS, f"select=contact_id,event_at,due_at&wave_id=eq.{_q(wid)}&arm=eq.wave"
                                    "&due_at=not.is.null", order="contact_id")
    if not turned:
        return 0
    twins = sb.select_all(MEMBERS, f"select=contact_id,event_at&wave_id=eq.{_q(wid)}&arm=eq.holdout"
                                   "&state=eq.held_out&due_at=is.null", order="contact_id")
    if not twins:
        return 0
    dated = sorted(((fu._ts(m.get("event_at")), str(m["due_at"])) for m in turned if fu._ts(m.get("event_at"))),
                   key=lambda x: x[0])
    undated = sorted(str(m["due_at"]) for m in turned if not fu._ts(m.get("event_at")))
    stamp: dict[str, list[str]] = {}
    for t in twins:
        at = fu._ts(t.get("event_at"))
        if at is None:
            # The turn order puts undated leads last: level once an undated member's turn came.
            due = undated[0] if undated else None
        else:
            older = [d for e, d in dated if e <= at]
            # The member just older than the twin had its turn: the twin was level then.
            due = older[-1] if older else (undated[0] if undated else None)
        if due:
            stamp.setdefault(due, []).append(str(t["contact_id"]))
    n = 0
    for due, contacts in stamp.items():
        for chunk in fu._chunks(sorted(contacts)):
            sb.rest("PATCH", f"{MEMBERS}?wave_id=eq.{_q(wid)}&arm=eq.holdout&state=eq.held_out&due_at=is.null"
                             f"&contact_id={fu._in(chunk)}", json_body={"due_at": due}, prefer="return=minimal")
            n += len(chunk)
    return n


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
        person = fu.ghl_contact(ghl_token, c)
        thread, whole = fu.ghl_history(ghl_token, c)
    except Exception as e:  # noqa: BLE001 - said in one sentence
        return {"skipped": f"HighLevel could not be read for this contact: {http.scrub(str(e))[:160]}"}
    if not whole:
        return {"skipped": LONG_THREAD}
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

# A workflow that takes every enrolment and sends nothing (stress2 round 3,
# silent-workflow-burns-whole-opener-batch): the desk's last SILENT_RUN
# template openers all came back unseen (provider_status "enrolled", or failed
# by the reconcile as never sent). The batch holds; one opener is tried again
# SILENT_PROBE_AFTER after the last, so a workflow fixed in HighLevel lets
# the batch go on by itself, and a broken one costs one lead each time.
SILENT_RUN = 3
SILENT_PROBE_AFTER = timedelta(hours=2)
# An opener stored "enrolled" (HighLevel took it, its message not seen within
# sales-api's read-back) is looked for in the lead's conversation before it
# counts as unseen, and only once this long has passed since it went: a
# workflow slower than the read-back is no silent one (stress2 round 4,
# slow-workflow-read-as-silent-holds-batch).
SILENT_GRACE = timedelta(seconds=60)
NEVER_SENT = re.compile(r"did not send it within half an hour", re.I)
SILENT_WORKFLOW = ("The opener's HighLevel workflow took the last {n} openers and sent nothing, so the batch holds. "
                   "In HighLevel, check the workflow is published and allows re-entry; one opener is tried again "
                   "at {at}.")


def _silent_workflow(sb: Any, now: datetime, token: Optional[str] = None) -> Optional[str]:
    """Why the template openers hold for a workflow that sends nothing, or
    None. With HighLevel's key, the last openers HighLevel has not shown yet
    are looked for in their leads' conversations first (as the follow-ups
    job's reconcile does at :07 and :37, which the batch never waits for),
    and only those older than SILENT_GRACE count; a conversation that cannot
    be read leaves its opener unseen (missing is never zero)."""
    rows = sb.select(MESSAGES, f"select=id,contact_id,body,state,provider_status,error,created_at&sent_by=eq.{DESK}"
                               f"&via=eq.workflow&followup_id=not.is.null&order=created_at.desc&limit={SILENT_RUN + 3}")

    def enrolled(r: dict[str, Any]) -> bool:
        return str(r.get("state") or "") == "sent" and str(r.get("provider_status") or "").lower() == "enrolled"

    if token:
        for r in rows:
            if not enrolled(r) or not r.get("contact_id"):
                continue
            try:
                hit = fu.template_hit(fu.ghl_thread(token, str(r["contact_id"])), r)
                if hit:
                    r["state"] = fu.mark_template_seen(sb, r, hit, now)
                    r["provider_status"] = str(hit.get("status") or "sent").lower()
            except Exception:  # noqa: BLE001 - not read: it stays unseen
                continue
        rows = [r for r in rows if (made := fu._ts(r.get("created_at"))) is not None and now - made >= SILENT_GRACE]
    rows = rows[:SILENT_RUN]
    if len(rows) < SILENT_RUN:
        return None
    unseen = all(enrolled(r) or (str(r.get("state") or "") == "failed" and NEVER_SENT.search(str(r.get("error") or "")))
                 for r in rows)
    newest = fu._ts(rows[0].get("created_at"))
    if not unseen or newest is None or now - newest >= SILENT_PROBE_AFTER:
        return None
    at = (newest + SILENT_PROBE_AFTER + timedelta(hours=3)).strftime("%H:%M")  # Kuwait
    return SILENT_WORKFLOW.format(n=SILENT_RUN, at=at)


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
             log: Callable[[str], None], warn: Callable[[str], None],
             ghl_token: Optional[str] = None) -> dict[str, Any]:
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
                           "outside_hours": 0, "gate": 0, "wave_not_running": 0, "kind_off": 0, "raced": 0,
                           "left_pool": 0, "stopped": None, "stop_kind": None}
    # The database's clock, for every comparison with a time the database
    # wrote (a message's created_at): the Date header's offset when the
    # client has one. Times the desk writes itself (its lease, last_at) are on
    # the same clock, so a VPS clock off the database's never slows the pace.
    off = getattr(sb, "clock_offset", None)
    skew = timedelta(seconds=float(off)) if isinstance(off, (int, float)) and abs(float(off)) < 3600 else timedelta(0)

    def db_now() -> datetime:
        return clock() + skew

    drafts = sb.select_all(FOLLOWUPS, "select=id,contact_id,channel,segment,touch,expires_at,context,created_at"
                                      "&status=eq.draft", order="id")
    if not drafts:
        return out
    fups = {str(f["id"]): f for f in drafts}
    meta: list[dict[str, Any]] = []
    # Openers whose send stopped half way: counted as asked for again only
    # when followup.send_due is called for them (stress2, round 1), never
    # when a check keeps them back (a paused wave, the hours, the time).
    stalled_ids: set[str] = set()
    stale_mark = _q((started + skew - SENDING_STALE).isoformat())
    for chunk in fu._chunks(sorted(fups)):
        cols = f"select=followup_id,send_after,held_by,held_at,wave_id,kind_key&followup_id={fu._in(chunk)}" \
               f"&send_after=lte.{_q((started + skew).isoformat())}"
        meta += sb.select(META, f"{cols}&held_by=is.null&limit=1000")
        # An opener whose send stopped half way (the Edge Function's wall
        # clock, a crash before its message row, a clear that failed): its
        # sending mark is older than five minutes, and sales-api takes it again.
        stalled = sb.select(META, f"{cols}&held_by=eq.{_q(SENDING)}&held_at=lt.{stale_mark}&limit=1000")
        stalled_ids |= {str(x["followup_id"]) for x in stalled}
        meta += stalled
    if not meta:
        return out
    meta.sort(key=lambda m: (fu._ts(m.get("send_after")) or started, str(m["followup_id"])))

    def wave_of(m: dict[str, Any]) -> str:
        """The opener's wave: its meta's, else the draft's own (a meta row made without it)."""
        return str(m.get("wave_id") or (fups[str(m["followup_id"])].get("context") or {}).get("wave_id") or "")

    def kind_of(m: dict[str, Any]) -> str:
        f = fups[str(m["followup_id"])]
        lang = str((f.get("context") or {}).get("language") or "")
        return str(m.get("kind_key") or (f"reactivate.{lang}.{f.get('channel')}" if f.get("segment") == "reactivate"
                                          and lang else ""))

    state_of = {str(x["id"]): str(x.get("state") or "") for x in waves}
    unknown = sorted({wave_of(m) for m in meta if wave_of(m)} - set(state_of))
    for chunk in fu._chunks(unknown):
        for x in sb.select(WAVES, f"select=id,state&id={fu._in(chunk)}&limit=1000"):
            state_of[str(x["id"])] = str(x.get("state") or "")
    try:
        levels = levels_of(sb) if any(kind_of(m) for m in meta) else {}
    except http.HttpError as e:
        # Missing is never zero: a kind that may be switched off is not sent on a guess.
        out["stopped"], out["stop_kind"] = (f"The opener levels could not be read ({http.scrub(str(e))[:120]}); "
                                            "nothing is sent until they can be."), "error"
        return out
    due = []
    for m in meta:
        wid = wave_of(m)
        if wid and state_of.get(wid) != "running":
            out["wave_not_running"] += 1
            continue
        if levels.get(kind_of(m)) == "off":
            out["kind_off"] += 1
            continue
        due.append(m)
    out["due"] = len(due)
    if not due:
        return out
    # An approved opener waits for the lead's hours and day off, never long
    # enough to go stale: it may go until 72 hours past its turn.
    for m in due:
        fid = str(m["followup_id"])
        turn = fu._ts(m.get("send_after"))
        keep = (turn + APPROVED_KEEP) if turn else None
        stale = fu._ts(fups[fid].get("expires_at"))
        if keep and fups[fid].get("segment") == "reactivate" and (stale is None or stale < keep):
            try:
                sb.rest("PATCH", f"{FOLLOWUPS}?id=eq.{_q(fid)}&status=eq.draft", prefer="return=minimal",
                        json_body={"expires_at": keep.isoformat()})
            except http.HttpError as e:
                warn(f"waves: {fid}'s expiry was not moved ({http.scrub(str(e))[:120]})")
    countries: dict[str, Any] = {}
    leads: dict[str, dict[str, Any]] = {}
    due_contacts = sorted({str(fups[str(m["followup_id"])]["contact_id"]) for m in due})
    for chunk in fu._chunks(due_contacts):
        for l in sb.select("cockpit_sales_leads", f"{LEAD_COLS}&contact_id={fu._in(chunk)}"):
            countries[str(l["contact_id"])] = l.get("country")
            leads[str(l["contact_id"])] = l
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

    def unread(what: str) -> None:
        """An opener that waits because a check could not be read (stress2 round 3): counted, with why."""
        out["unread"] = out.get("unread", 0) + 1
        whys = out.setdefault("unread_why", [])
        if what not in whys:
            whys.append(what)

    def kept_back(fid: str, f: dict[str, Any], m: dict[str, Any], now: datetime) -> bool:
        """Whether this opener is kept back without a send (counted in `out`)."""
        fresh = next(iter(sb.select(META, f"select=held_by,held_at,wave_id&followup_id=eq.{_q(fid)}&limit=1")), {})
        held_by = fresh.get("held_by")
        mark_at = fu._ts(fresh.get("held_at"))
        stalled_mark = held_by == SENDING and (mark_at is None or mark_at < db_now() - SENDING_STALE)
        if held_by and not stalled_mark:
            out["held"] += 1
            return True
        # A rep paused the agent for this lead, or the lead asked to stop,
        # since the opener was approved (fix round 4): it waits in the queue,
        # never sent and never set aside. Unreadable: it waits too.
        c = str(f["contact_id"])
        rows = fu.stops_for(sb, [c])
        if rows is None:
            # Not read is never "paused" (stress2 round 3): said as what it is.
            unread("the lead's stops could not be read")
            log(f"waves: {fid} waits: the stops could not be read")
            return True
        stopped = (fu.hold_of(rows, c, now) or (None, None))[1]
        if stopped:
            out["paused"] = out.get("paused", 0) + 1
            log(f"waves: {fid} waits: {stopped}")
            return True
        if f.get("segment") == "reactivate":
            # The lead may have left the backlog since the batch was approved,
            # by the pools' own rules: booked (a call still to come, or one
            # booked since the opener was written), a call held in the last
            # day, a latest call marked invalid, a deal, a client, no longer a
            # tagged lead. Then the opener is taken back, never sent.
            try:
                left = _left_pool(sb, c, leads.get(c), now, since=f.get("created_at"), windows=sequence_windows(settings))
            except Exception as e:  # noqa: BLE001 - unreadable: it waits, never goes on a guess
                warn(f"waves: {fid} waits: whether the lead is still in the backlog could not be read "
                     f"({http.scrub(str(e))[:120]})")
                unread("whether the lead is still in the backlog could not be read")
                return True
            if left:
                gone = sb.rest("PATCH", f"{FOLLOWUPS}?id=eq.{_q(fid)}&status=eq.draft", prefer="return=representation",
                               json_body={"status": "expired", "decided_at": now.isoformat(), "error": left})
                out["left_pool"] += bool(isinstance(gone, list) and gone)
                return True
        if not sb.select(FOLLOWUPS, f"select=id&id=eq.{_q(fid)}&status=eq.draft&limit=1"):
            out["gone"] += 1  # sent, skipped or expired meanwhile (another run, a rep)
            return True
        if f.get("segment") == "reactivate" and ghl_token is not None:
            # run() always passes the key as read ("" when it is not set);
            # None is only a caller that wires no HighLevel reads (the send's
            # unit tests). No key is no read (stress2 round 4, no-ghl-key-
            # skips-send-time-conversation-read): the opener waits, and the
            # row says why.
            if not ghl_token:
                unread("the lead's conversation (GHL_B2B_API_KEY is not set)")
                return True
            if live_conversation(fid, f, c, now):
                return True
        expires = fu._ts(f.get("expires_at"))
        if expires and expires <= db_now():
            # Past its 72 hours while nothing could go (the agent switched off
            # over a long weekend): it went stale. Closed here, never asked
            # for: sales-api would close it and refuse, which is no refusal
            # about the lead and must never stop this morning's openers.
            closed = sb.rest("PATCH", f"{FOLLOWUPS}?id=eq.{_q(fid)}&status=eq.draft", prefer="return=representation",
                             json_body={"status": "expired", "decided_at": now.isoformat(), "error": fu.STALE_DRAFT})
            out["stale"] = out.get("stale", 0) + bool(isinstance(closed, list) and closed)
            return True
        wid = wave_of(m)
        now_state = next(iter(sb.select(WAVES, f"select=state&id=eq.{_q(wid)}&limit=1")), None) if wid else None
        if now_state is not None and now_state.get("state") != "running":
            out["wave_not_running"] += 1  # a manager paused or stopped it while this run waited
            return True
        return False


    def live_conversation(fid: str, f: dict[str, Any], c: str, now: datetime) -> bool:
        """The lead's conversation as HighLevel has it now (stress2 round 3,
        approved-opener-sent-inside-inbox-mirror-lag): the drafting rules are
        asked again at the send, never only when the opener was written, and
        never from the inbox copy alone (sales-mirror refreshes it every three
        minutes). The lead wrote after the opener was written: it is taken
        back for a person to answer. An automation or a person of ours wrote
        lately: it waits out the gap, in the queue. Not read: it waits."""
        try:
            thread = fu.ghl_thread(str(ghl_token), c, limit=20)
        except Exception as e:  # noqa: BLE001 - unreadable: it waits, never goes on a guess
            warn(f"waves: {fid} waits: the lead's conversation could not be read ({http.scrub(str(e))[:120]})")
            unread("the lead's conversation in HighLevel could not be read")
            return True
        made = fu._ts(f.get("created_at"))
        wrote = max((fu._ts(x.get("at")) for x in thread if x.get("from") == "lead" and fu._ts(x.get("at"))), default=None)
        if made and wrote and wrote > made:
            gone = sb.rest("PATCH", f"{FOLLOWUPS}?id=eq.{_q(fid)}&status=eq.draft", prefer="return=representation",
                           json_body={"status": "expired", "decided_at": now.isoformat(), "error": fu.OPENER_REPLIED})
            out["left_pool"] += bool(isinstance(gone, list) and gone)
            return True
        gap = timedelta(hours=float(settings.get("automation_gap_hours", 20)))
        auto_at = fu.automation_message(thread, set())
        by_hand = max((fu._ts(x.get("at")) for x in thread if x.get("from") == "us" and x.get("source") != "workflow"
                       and fu._ts(x.get("at"))), default=None)
        until = None
        if auto_at and now - auto_at < gap:
            until = auto_at + gap
        if by_hand and now - by_hand < fu.GAP:
            until = max(until or now, by_hand + fu.GAP)
        if until:
            try:
                sb.rest("PATCH", f"{META}?followup_id=eq.{_q(fid)}&held_by=is.null", prefer="return=minimal",
                        json_body={"send_after": until.isoformat()})
            except http.HttpError as e:
                warn(f"waves: {fid}'s send was not put off ({http.scrub(str(e))[:120]})")
            out["put_off"] = out.get("put_off", 0) + 1
            log(f"waves: {fid} waits until {until.isoformat()}: we messaged the lead lately")
            return True
        return False

    def still_kept_back(fid: str) -> bool:
        """The cheap checks again after the lease: held meanwhile, the draft
        gone, or its wave paused or stopped (counted in `out`)."""
        fresh = next(iter(sb.select(META, f"select=held_by,held_at,wave_id&followup_id=eq.{_q(fid)}&limit=1")), {})
        held_by = fresh.get("held_by")
        mark_at = fu._ts(fresh.get("held_at"))
        stalled_mark = held_by == SENDING and (mark_at is None or mark_at < db_now() - SENDING_STALE)
        if held_by and not stalled_mark:
            out["held"] += 1
            return True
        if not sb.select(FOLLOWUPS, f"select=id&id=eq.{_q(fid)}&status=eq.draft&limit=1"):
            out["gone"] += 1
            return True
        wid = str(fresh.get("wave_id") or "")
        now_state = next(iter(sb.select(WAVES, f"select=state&id=eq.{_q(wid)}&limit=1")), None) if wid else None
        if now_state is not None and now_state.get("state") != "running":
            out["wave_not_running"] += 1
            return True
        return False

    for m in due:
        fid = str(m["followup_id"])
        f = fups[fid]
        now = clock()
        channel = str(f.get("channel") or "")
        if channel.startswith("whatsapp") and gate:
            out["gate"] += 1
            continue
        country = countries.get(str(f["contact_id"]))
        # A first message (an opener) keeps to 09:00 to 18:00 on the lead's
        # clock (every zone of a country that spans several; a person sends
        # it when the zone is not known); a later step or a reply to 09:00 to
        # 21:00, as sendFollowup does; never on the lead's day off.
        first = int(f.get("touch") or 1) == 1 and f.get("segment") not in ("reply", "confirm")
        hours = first_hours if first else later_hours
        if not fu.in_hours(now, country, hours, first=first) or fu.lead_days_off(now, country, days_off):
            out["outside_hours"] += 1
            continue
        if channel == "whatsapp_template":
            if not spent_read:
                spent_read, spent = True, template_budget(sb, guard, now)
            if spent:
                stop("budget", spent)
                break
        if channel == "whatsapp_template":
            try:
                silent = _silent_workflow(sb, db_now(), ghl_token)
            except http.HttpError as e:
                silent = f"Whether the opener's workflow sends could not be read ({http.scrub(str(e))[:120]}); the batch waits."
            if silent:
                stop("hold_all", silent)
                break
        recent = _desk_sends_since(sb, db_now() - CEILING_WINDOW)
        if len(recent) >= CEILING - RESERVE:
            stop("ceiling", f"The desk sent {len(recent)} messages in ten minutes; the rest wait so the sender "
                            f"ceiling keeps {RESERVE} for the demo chat.")
            break
        # Every check that can keep an opener back without a send runs before
        # the send lease (stress2, round 2): a paused lead, a held opener, a
        # lead who left the backlog, a draft gone or stale, or a wave paused
        # meanwhile never spends a batch gap, and never stalls the openers
        # behind it at the head of the queue.
        if kept_back(fid, f, m, clock()):
            continue
        out_of_time = False
        leased = False
        slept = False
        lease_taken_at: Optional[datetime] = None
        for _ in range(6):
            now = clock()
            dbn = db_now()
            newest = next(iter(_desk_sends_since(sb, dbn - timedelta(seconds=gap))), None)
            try:
                held = _lease_at(sb, SEND_LEASE)
            except http.HttpError:
                held = None
            # The gap counts from this run's last send, the desk's last message,
            # and the last send another run is making right now (its lease), all
            # on the database's clock. A message time ahead of that clock (a VPS
            # clock behind the database's, with no offset known yet) says
            # nothing the lease does not, and never stretches the wait.
            last_msg = fu._ts((newest or {}).get("created_at"))
            if last_msg and last_msg > dbn + timedelta(seconds=2):
                last_msg = None
            t = max((x for x in (last_at, last_msg, held) if x), default=None)
            wait = 0.0 if not t else min(gap, gap - (dbn - t).total_seconds())
            if (now - started).total_seconds() + max(0.0, wait) + 20 > budget_s:
                out_of_time = True
                break
            if wait <= 0:
                try:
                    if _take_lease(sb, SEND_LEASE, dbn, max(1.0, gap - 1)):
                        leased = True
                        lease_taken_at = dbn
                        break
                except http.HttpError:
                    leased = True
                    break  # no lease row to be had: the gap read above stands
                continue  # another run took it between the read and now: read again
            sleep(wait)
            slept = True
        if out_of_time:
            stop("time", "This run's time is up; the next run carries on.")
            break
        if not leased:
            # Six tries and another run held the send lease each time: that run
            # is sending, so this one never sends beside it.
            stop("busy", "Another waves run is sending now; this one leaves the batch to it.")
            break
        # The state may have moved while this run waited for the gap: the
        # cheap checks again, and a send that is not made gives the lease back.
        # The lead may have written while this run waited out the gap (stress2
        # round 4, reply-during-gap-wait-gets-opener): their conversation is
        # read again before the send, never only before the wait.
        if still_kept_back(fid) or (slept and f.get("segment") == "reactivate" and ghl_token
                                    and live_conversation(fid, f, str(f["contact_id"]), clock())):
            if lease_taken_at is not None:
                _let_go(sb, SEND_LEASE, lease_taken_at)
            continue
        if fid in stalled_ids:
            out["stalled"] = out.get("stalled", 0) + 1
        try:
            status, res = api("followup.send_due", {"id": fid})
        except Exception as e:  # noqa: BLE001 - the door did not answer: stop, the next run tries again
            stop("no_answer", f"sales-api did not answer: {http.scrub(str(e))[:160]}")
            break
        res = res if isinstance(res, dict) else {}
        verdict, err = judge(status, res)
        # Only a 404, or a 400 or 422 whose words say the contact is not
        # there (stress2 round 3): a gateway's "Bad Request" is an outage.
        if verdict == "error" and LEAD_4XX.search(err) and (re.search(r"HighLevel said 404\b", err, re.I) or GONE_WORDS.search(err)):
            # HighLevel refused this lead's own contact (merged or deleted),
            # passed on as sales-api's 500: this lead's refusal, set aside for
            # a person, never a stop for every run (fix round 4).
            verdict = "lead"
        if verdict == "sent":
            last_at = db_now()
            out["sent"] += 1
            in_a_row = 0
            log(f"waves: sent {fid}")
            continue
        # HighLevel refused this one opener "for a moment" (sales-api's
        # highlevelBlip: a 400 or 422 it cannot tell from a gateway's, the
        # opener left in the queue untouched): it may be about this contact
        # alone. It waits behind the batch, and the next opener is tried once;
        # a second refusal of the same kind is an outage and stops the run
        # (stress2 round 4, one-refused-opener-holds-batch-at-head). A 502
        # "HighLevel did not send it" fails its opener, so it is never probed.
        blip = verdict == "hold_all" and str(res.get("code") or "") == "outage"
        if blip and not out.get("moved_behind"):
            if res.get("message"):
                last_at = db_now()
            try:
                moved = sb.rest("PATCH", f"{META}?followup_id=eq.{_q(fid)}&held_by=is.null",
                                prefer="return=representation",
                                json_body={"send_after": (clock() + ERROR_WAIT).isoformat()})
            except http.HttpError as e:
                warn(f"waves: {fid} could not be moved behind the batch ({http.scrub(str(e))[:120]})")
                moved = None
            if isinstance(moved, list) and moved:
                out["moved_behind"] = 1
                out["moved_why"] = err[:200]
                warn(f"waves: {fid} waits {int(ERROR_WAIT.total_seconds() // 60)} minutes behind the batch: {err[:160]}")
                continue
        if verdict in ("hold_all", "outage", "error"):
            if res.get("message"):
                last_at = db_now()
            if verdict == "error":
                # sales-api failed on this opener: it waits behind the batch, so
                # the next run does not stop at the same opener again (fix round 4).
                try:
                    sb.rest("PATCH", f"{META}?followup_id=eq.{_q(fid)}&held_by=is.null", prefer="return=minimal",
                            json_body={"send_after": (clock() + ERROR_WAIT).isoformat()})
                    err = f"{err} (that opener waits {int(ERROR_WAIT.total_seconds() // 60)} minutes; the rest go first)"
                except http.HttpError as e:
                    warn(f"waves: {fid} could not be moved behind the batch ({http.scrub(str(e))[:120]})")
            stop(verdict, err)
            break
        if verdict == "hours":
            # sales-api reads the lead's clock otherwise: it waits an hour, in the queue.
            sb.rest("PATCH", f"{META}?followup_id=eq.{_q(fid)}", prefer="return=minimal",
                    json_body={"send_after": (clock() + timedelta(hours=1)).isoformat()})
            out["outside_hours"] += 1
            continue
        if verdict == "lead" and STATE_RACE.search(err):
            # Another run is sending it, the wave was paused, or sales-api's
            # clock is a moment behind: left in the queue, never set aside.
            out["raced"] += 1
            continue
        if verdict == "lead" and (res.get("closed") or not sb.select(
                FOLLOWUPS, f"select=id&id=eq.{_q(fid)}&status=eq.draft&limit=1")):
            # The refusal closed the draft itself (it went stale, the lead is an
            # active client): no page shows a closed draft, so it is not set
            # aside for a person, and it is no refusal about this batch.
            out["gone"] += 1
            continue
        in_a_row += 1
        if verdict == "failed":
            last_at = db_now()
            out["failed"] += 1
            warn(f"waves: {fid} failed at HighLevel or Meta: {err[:160]}")
        else:
            out["refused"] += 1
            try:
                kept = sb.rest("PATCH", f"{META}?followup_id=eq.{_q(fid)}&held_by=is.null", prefer="return=representation",
                               json_body={"send_after": None, "held_by": DESK, "held_at": clock().isoformat(),
                                          "hold_reason": err[:300]})
                if not (isinstance(kept, list) and kept):
                    # sales-api's followup.send_due sets a refused draft aside
                    # itself (with an audit row) before it answers, so the
                    # desk's own write finds it held: it is set aside all the same.
                    now_meta = next(iter(sb.select(META, f"select=held_by&followup_id=eq.{_q(fid)}&limit=1")), {})
                    kept = [now_meta] if now_meta.get("held_by") == DESK else []
                out["set_aside"] += bool(kept)
            except http.HttpError as e:
                warn(f"waves: {fid} could not be set aside ({http.scrub(str(e))[:120]})")
            warn(f"waves: {fid} not sent, set aside for a person: {err[:160]}")
        if in_a_row >= 3:
            stop("refusals", f"Three sends in a row were refused or failed; the last: {err[:200]}")
            break
    # Every write of the paced send has its audit row: an approved opener
    # closed as stale is a manager's decision undone (stress2, round 1).
    if out["sent"] or out["set_aside"] or out["left_pool"] or out["failed"] or out.get("stale"):
        audit(sb, "waves.send", META, None, after={k: v for k, v in out.items() if v and k not in ("due",)})
    return out


# The follow-up agent's own sequences, which a backlog opener never lands in
# the middle of (stress2 round 3), and how the waiting line names them.
SEQUENCES = ("no_show", "cancelled", "new", "after_call")
SEQUENCE_WORDS = {"no_show": "missed-call", "cancelled": "cancelled-call", "new": "new-lead", "after_call": "after-call"}
OPENER_IN_SEQUENCE = ("The follow-up agent started its own messages to the lead after this opener was written, so "
                      "the backlog opener was taken back; the wave writes them again once those have run.")


def sequence_windows(settings: dict[str, Any]) -> dict[str, int]:
    """Each sequence's window in days with the settings' cadence (fu.window_days)."""
    cadence = {k: [float(x) for x in v] for k, v in (settings.get("cadence") or {}).items() if v}
    steps = {**fu.CADENCE, **cadence}
    return {k: fu.window_days(k, steps.get(k)) for k in SEQUENCES}


def in_sequence(sb: Any, contact: str, now: datetime, windows: dict[str, int],
                since: Optional[datetime] = None) -> Optional[tuple[str, datetime]]:
    """The agent's sequence that still runs for this lead, and when it is
    over: a follow-up of a sequence kind written inside that kind's window
    (`since`: written after it), whatever became of it. A step a rep
    skipped, one that expired unapproved, or one that failed is a step the
    agent's pick() counts and moves on from (or drafts again), so the
    sequence still runs (stress2 round 4, skipped-sequence-step-lets-
    backlog-opener-in). Raises when the follow-ups cannot be read."""
    back = now - timedelta(days=max(windows.values() or [8]))
    rows = sb.select(FOLLOWUPS, f"select=segment,created_at,status&contact_id=eq.{_q(contact)}"
                                f"&segment=in.({','.join(SEQUENCES)})"
                                f"&status=in.(sent,draft,sending,skipped,expired,failed)"
                                f"&created_at=gte.{_q(back.isoformat())}&order=created_at.desc&limit=20")
    best: Optional[tuple[str, datetime]] = None
    for r in rows:
        made = fu._ts(r.get("created_at"))
        seg = str(r.get("segment") or "")
        if not made or seg not in windows or (since and made <= since):
            continue
        until = made + timedelta(days=windows[seg])
        if until > now and (best is None or until > best[1]):
            best = (seg, until)
    return best


def _left_pool(sb: Any, contact: str, lead: Optional[dict[str, Any]], now: datetime,
               since: Any = None, windows: Optional[dict[str, int]] = None) -> Optional[str]:
    """Why a lead whose opener was approved is no longer in a backlog pool,
    or None, by pool_of's own rules (fix round 4): a call of theirs still to
    come, or booked after the opener was written (`since`); a call held (the
    B2B rule) within HELD_WAIT; a latest call marked invalid (disqualified);
    a deal; a client tag or a customer; a deal won or closed; no longer a
    tagged lead; a deal moved to a disqualified or lost stage in the CRM.
    Only a positive reason takes the opener back."""
    if lead and fu.is_client(lead):
        return "The lead is a client now, so the backlog opener was taken back."
    if lead and str(lead.get("contact_type") or "").lower() == "customer":
        return "The lead is a customer now, so the backlog opener was taken back."
    if lead and (str(lead.get("opp_status") or "").lower() == "won" or "closed" in str(lead.get("stage_name") or "").lower()):
        return "The lead's deal is won or closed, so the backlog opener was taken back."
    if lead and stage_out(lead):
        return OPENER_STAGE_OUT
    if lead and isinstance(lead.get("tags"), list) and not is_lead(lead):
        return "The lead is no longer tagged as a lead, so the backlog opener was taken back."
    (calls, _cals), dealt = _calls_of(sb, [contact]), _dealt(sb, [contact])
    if contact in dealt:
        return "The lead has a deal now, so the backlog opener was taken back."
    mine = sorted((a for a in calls.get(contact, []) if a.get("call_type") in ("intro", "demo") and fu._ts(a.get("start_at"))),
                  key=lambda a: fu._ts(a["start_at"]))
    for a in mine:
        if fu._ts(a["start_at"]) > now and a.get("status") not in fu.NOT_KEPT:
            return fu.OPENER_BOOKED
    written = fu._ts(since)
    if written and any((fu._ts(a.get("booked_at")) or written) > written for a in mine):
        return "The lead booked a call after this opener was written, so the backlog opener was taken back."
    if mine and str(mine[-1].get("status") or "").lower() == "invalid":
        return "The lead's latest call was marked invalid (disqualified), so the backlog opener was taken back."
    if any(fu.shown(a, now) and fu._ts(a["start_at"]) > now - HELD_WAIT for a in mine):
        return "The lead had a call in the last day, so the backlog opener was taken back."
    # The agent began one of its own sequences for the lead after the opener
    # was written (stress2 round 3): taken back, never "How are you?" in it.
    if windows and written and in_sequence(sb, contact, now, windows, since=written):
        return OPENER_IN_SEQUENCE
    return None


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
    if not settings.get("enabled", True):
        # Read as the drafter reads it (followups.run): anything but on, set by
        # hand (null, 0), is off. Stop still works while it is off (contract-v2
        # 0b.12): a wave a manager stopped lets go of its leads and takes its
        # openers back, so none stays open until the agent is on again.
        out["skipped"] = "The follow-up agent is switched off (followups.enabled), so no wave drafts or sends"
        winding = _winding(sb)
        if winding:
            try:
                ids = [str(x["id"]) for x in winding]
                sync(sb, ids, started)
                out["wound_down"] = wind_down(sb, winding, started)
            except Exception as e:  # noqa: BLE001 - said, and the next run tries again
                warn(f"waves: a stopped wave could not be wound down while the agent is off ({http.scrub(str(e))[:120]})")
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
                # One wave's enrolment that fails (a statement timeout on the
                # members' insert, an outage reading the pool) is said and
                # tried again next run; every other wave's approved openers
                # still go below.
                try:
                    enrolled[str(x["id"])] = enroll(sb, x, started, w, log)
                except Exception as e:  # noqa: BLE001 - said on the row, never fatal to the sends
                    why = http.scrub(str(e))[:160]
                    enrolled[str(x["id"])] = {"error": why}
                    warn(f"waves: {POOL_WORDS.get(str(x.get('pool')), x.get('pool'))}: the enrolment failed ({why}); "
                         "the next run tries again")
        out["enrolled"] = enrolled
        if enrolled:
            waves, winding = _waves(sb), _winding(sb)
        # Twins whose turn came and whose stamp a failed run never wrote,
        # caught up whatever today's drafting does (stress2 round 4).
        for x in waves:
            if x.get("state") == "running" and x.get("enrolled_at"):
                try:
                    caught = stamp_twins(sb, str(x["id"]))
                    if caught:
                        log(f"waves: {caught} held-back leads' 14 days started with the turns they are level with")
                except http.HttpError as e:
                    warn(f"waves: the held-back leads' start could not be caught up ({http.scrub(str(e))[:120]}); "
                         "the next run tries again")
        more = sync(sb, [str(x["id"]) for x in waves], started)
        out["synced"] = {k: synced[k] + more[k] for k in synced}
        ids = [str(x["id"]) for x in waves] + [str(x["id"]) for x in winding]
        out["outcomes"] = outcomes(sb, ids, started)
        try:
            out["meta_repaired"] = repair_meta(sb, [str(x["id"]) for x in waves], warn)
        except http.HttpError as e:
            warn(f"waves: the openers' meta rows could not be checked ({http.scrub(str(e))[:120]})")
        if not ghl_token:
            out["drafted"] = {"waiting": "GHL_B2B_API_KEY is not set, so no lead's conversation can be read and no "
                                         "opener is written.", "setup": True}
        else:
            half = budget_s / 2
            # Only a wave whose whole pool is in (enrolled_at) writes a batch:
            # one whose enrolment broke half way would serve its first chunk
            # (the leads by contact id) before the newest of the pool.
            ready = [x for x in waves if x.get("enrolled_at") or x.get("state") != "running"]
            out["drafted"] = draft_day(sb, started, settings=settings, w=w, waves=ready, guard=guard,
                                       ghl_token=ghl_token, log=log, warn=warn,
                                       deadline=lambda: (clock() - started).total_seconds() > half)
        out["finished"] = finish(sb, [x for x in waves if x.get("state") == "running"], started, log)
        out["settled"] = settle(sb, winding, started)
    left = budget_s - (clock() - started).total_seconds()
    out["sent"] = send_due(sb, api, settings=settings, w=w, waves=waves, guard=guard, clock=clock, sleep=sleep,
                           budget_s=max(0.0, left), log=log, warn=warn, ghl_token=ghl_token)
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
        if e.get("error"):
            parts.append(f"a wave's leads could not be enrolled ({str(e['error']).rstrip('.')}); the next run tries again")
            ok = False
            continue
        parts.append(e["done"] if e.get("done") else
                     f"{e['enrolled']} leads enrolled, {e['held_back']} held back to measure the effect")
    d = out.get("drafted") or {}
    if d.get("waiting"):
        parts.append(str(d["waiting"]).rstrip("."))
        legacy = any(s in str(d["waiting"]) for s in ("not set up", "single-copy", "is not set"))
        if (d.get("setup") or d.get("blocked") or legacy) and running:
            ok = False
    if d.get("blocked_waves") and not d.get("blocked"):
        n = sum(int(v) for v in d["blocked_waves"].values())
        parts.append(f"{n} of an earlier day's openers wait for approval, so their wave writes no new batch")
    if d.get("drafted"):
        parts.append(f"{d['drafted']} openers written for approval")
    if d.get("switched_off"):
        parts.append("the follow-up agent was switched off during this run, so no more openers were written")
    if d.get("excluded"):
        parts.append(f"{d['excluded']} left out")
    if d.get("later"):
        parts.append(f"{d['later']} wait for another day")
    for tpl, n in sorted((d.get("no_route") or {}).items()):
        lang = "English" if tpl.endswith("_en") else "Arabic" if tpl.endswith("_ar") else tpl
        parts.append(f"{n} {lang} lead{'s' if n != 1 else ''} wait for the {tpl} template, which is not set up yet: "
                     "a manager sets it up and makes it live")
        ok = False
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
    if sent.get("paused"):
        n = sent["paused"]
        parts.append(f"{n} wait{'s' if n == 1 else ''}: the agent is paused for {'that lead' if n == 1 else 'their leads'}")
    if sent.get("put_off"):
        n = sent["put_off"]
        parts.append(f"{n} put off: we messaged {'that lead' if n == 1 else 'those leads'} lately, so "
                     f"{'it waits' if n == 1 else 'they wait'} out the gap")
    if sent.get("unread"):
        n = sent["unread"]
        what = " and ".join(sent.get("unread_why") or ["a check"]).replace(" could not be read", "")
        parts.append(f"{n} wait{'s' if n == 1 else ''}: {what} could not be read; the next run tries again")
        # Not ok while nothing goes and every due opener waits on an unread check.
        if not sent.get("sent"):
            ok = False
    if sent.get("stalled"):
        n = sent["stalled"]
        parts.append(f"{n} opener{'s' if n != 1 else ''} whose send had stopped half way "
                     f"{'were' if n != 1 else 'was'} asked for again")
    if sent.get("stale"):
        n = sent["stale"]
        parts.append(f"{n} approved opener{'s' if n != 1 else ''} went stale before {'they' if n != 1 else 'it'} "
                     f"could go and {'were' if n != 1 else 'was'} closed; the wave writes {'them' if n != 1 else 'it'} again")
    if sent.get("wave_not_running"):
        parts.append(f"{sent['wave_not_running']} approved for a wave that is paused or stopped, so not sent")
    # Openers taken back or skipped at the send are said, never only counted
    # (stress2, round 2: missing is never zero).
    if sent.get("left_pool"):
        n = sent["left_pool"]
        parts.append(f"{n} approved opener{'s' if n != 1 else ''} taken back at the send: "
                     f"{'their leads' if n != 1 else 'the lead'} booked, held a call or left the backlog")
    if sent.get("gone"):
        n = sent["gone"]
        parts.append(f"{n} already sent, skipped or closed meanwhile")
    if sent.get("raced"):
        n = sent["raced"]
        parts.append(f"{n} left in the queue because {'their' if n != 1 else 'its'} state moved")
    if sent.get("kind_off"):
        parts.append(f"{sent['kind_off']} approved but their kind of opener is switched off, so not sent")
    if sent.get("moved_behind"):
        why = str(sent.get("moved_why") or "").rstrip(".")
        parts.append(f"1 opener HighLevel refused waits {int(ERROR_WAIT.total_seconds() // 60)} minutes behind the batch"
                     + (f" ({why})" if why else ""))
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
                                          "wave_not_running", "kind_off", "stale", "raced", "left_pool", "paused",
                                          "unread", "put_off", "moved_behind")) \
        or sent.get("stop_kind") in ("time", "ceiling", "busy")
    if sent.get("due") and not explained:
        parts.append(f"{sent['due']} approved openers are due and none went")
        ok = False
    return ok, "; ".join(parts)
