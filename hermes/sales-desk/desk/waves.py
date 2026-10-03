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
2. The desk enrolls the pool once. Every lead in it becomes a member, and a
   tenth is held back by sha256('waves:'||contact_id). Held-back members are
   never written to; they are what the wave is measured against.
3. On working days from 09:00 Kuwait, the desk drafts the day's openers:
   at most waves.per_day (40) across the running waves, served in the pool
   order below, newest first within a pool. Each is a `reactivate` draft
   carrying the opener template, for the owner to approve as a batch. A new
   batch waits while an earlier day's openers still wait for approval.
4. Once a batch is approved (followup.batch writes send_after on each
   draft's meta row), the desk sends one every batch_gap_s (45 s). It sends
   only between 09:00 and 18:00 on the lead's clock, and stops short of the
   sender ceiling with 10 slots left for the demo chat's tick. Nothing goes
   on WhatsApp while the WA Connector gate is shut.

Wave openers never take the follow-up agent's own room (followups.per_day).
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import followups as fu
from . import http

WAVES = "cockpit_sales_followup_waves"
MEMBERS = "cockpit_sales_followup_wave_members"
META = "cockpit_sales_followup_meta"
FOLLOWUPS = "cockpit_sales_followups"
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
# A member sent an opener lately is not enrolled in another wave.
RECENT_DAYS = 30
# A member another wave may not take: still to be written to, written to,
# or held back (a held-back lead messaged by a second wave would no longer
# measure anything).
OPEN_STATES = ("waiting", "drafted", "held_out")


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


def pool_of(lead: dict[str, Any], calls: list[dict[str, Any]], dealt: bool,
            now: datetime) -> Optional[tuple[str, Optional[datetime]]]:
    """The backlog pool a lead belongs to, and when the event that put them
    there happened (newest first sorts on it), or None. `calls` are the
    lead's intro and demo calls with their kinds filled in (fu.with_kinds).

    - no_show_cancelled: their latest call was missed or cancelled;
    - unclosed_demo: their latest held call (the B2B rule) was a demo, no deal;
    - good_intro: their latest held call was an intro, with no demo after it;
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
    if last.get("call_type") == "demo":
        return "unclosed_demo", fu._ts(last["start_at"])
    if any(a.get("call_type") == "demo" and fu._ts(a["start_at"]) > fu._ts(last["start_at"]) for a in mine):
        return None
    return "good_intro", fu._ts(last["start_at"])


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


def global_refusal(status: int, out: dict[str, Any]) -> bool:
    """A refusal that holds every send, not just this lead's: sales-api says
    so (hold_all), or it is the ceiling, the day's templates, the switch, a
    WhatsApp pause or an empty wallet."""
    if out.get("hold_all") is True or status in (429, 503):
        return True
    e = str(out.get("error") or "").lower()
    return any(w in e for w in ("today's", "switched off", "are paused", "paused:", "wallet", "funds",
                                "30 messages in ten minutes", "single-copy"))


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def _waves(sb: Any) -> list[dict[str, Any]]:
    rows = sb.select(WAVES, "select=*&state=in.(running,paused)&order=started_at.asc&limit=50")
    order = {p: i for i, p in enumerate(POOLS)}
    return sorted(rows, key=lambda w: (order.get(str(w.get("pool")), 99), str(w.get("started_at") or "")))


def _calls_of(sb: Any, contacts: Optional[list[str]] = None) -> dict[str, list[dict[str, Any]]]:
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
    return out


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


# ---------------------------------------------------------------------------
# Enrolment: a running wave's pool, once
# ---------------------------------------------------------------------------

def pools(sb: Any, now: datetime) -> dict[str, list[tuple[str, Optional[datetime]]]]:
    """Every lead in a backlog pool now: {pool: [(contact_id, event_at)]}."""
    leads = sb.select_all("cockpit_sales_leads", LEAD_COLS, order="contact_id")
    calls, dealt = _calls_of(sb), _dealt(sb)
    out: dict[str, list[tuple[str, Optional[datetime]]]] = {p: [] for p in POOLS}
    for lead in leads:
        c = str(lead.get("contact_id") or "")
        p = pool_of(lead, calls.get(c, []), c in dealt, now) if c else None
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
    """Leads another wave already has: open in a running or paused wave, or
    sent an opener in the last 30 days. One wave at a time per lead."""
    others = [str(w["id"]) for w in sb.select(WAVES, "select=id,state&state=in.(running,paused)&limit=50")
              if str(w["id"]) != str(wave_id)]
    busy: set[str] = set()
    if others:
        busy |= {str(m["contact_id"]) for m in sb.select_all(
            MEMBERS, f"select=contact_id,wave_id&wave_id={fu._in(others)}&state=in.({','.join(OPEN_STATES)})",
            order="contact_id")}
    since = (now - timedelta(days=RECENT_DAYS)).isoformat()
    busy |= {str(m["contact_id"]) for m in sb.select_all(
        MEMBERS, f"select=contact_id,wave_id&state=eq.sent&drafted_at=gte.{fu._q(since)}", order="contact_id")}
    return busy


def enroll(sb: Any, wave: dict[str, Any], now: datetime, w: dict[str, Any],
           log: Callable[[str], None]) -> dict[str, int]:
    """A running wave's pool, once: every lead in it a member, a tenth held
    back. A pool with nobody in it ends the wave (state done) rather than
    being read again every run."""
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
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        try:
            sb.rest("POST", f"{MEMBERS}?on_conflict=wave_id,contact_id", json_body=chunk,
                    prefer="resolution=ignore-duplicates,return=minimal")
            added += len(chunk)
        except http.HttpError:
            # One lead in the chunk is another wave's (the one-running-wave
            # index): each goes in on its own, and that one stays out.
            for r in chunk:
                try:
                    sb.rest("POST", f"{MEMBERS}?on_conflict=wave_id,contact_id", json_body=[r],
                            prefer="resolution=ignore-duplicates,return=minimal")
                    added += 1
                except http.HttpError:
                    taken += 1
    held = sum(1 for r in rows if r["arm"] == "holdout")
    if not rows:
        sb.rest("PATCH", f"{WAVES}?id=eq.{fu._q(wid)}&state=eq.running", json_body={"state": "done"},
                prefer="return=minimal")
        log(f"waves: {POOL_WORDS[pool]}: nobody is in this pool now; the wave is done")
    else:
        log(f"waves: {POOL_WORDS[pool]}: {len(rows)} leads enrolled, {held} held back to measure the effect")
    return {"enrolled": added, "held_back": held, "skipped_busy": taken}


# ---------------------------------------------------------------------------
# Keeping members in step with their drafts
# ---------------------------------------------------------------------------

def sync(sb: Any, wave_ids: list[str], now: datetime) -> dict[str, int]:
    """Each drafted member's state from its draft: sent, skipped by a rep
    (out of the wave), failed at HighLevel, or expired with nobody deciding
    (back to waiting, so no lead leaves the wave without a message)."""
    out = {"sent": 0, "excluded": 0, "failed": 0, "back": 0}
    if not wave_ids:
        return out
    drafted = sb.select_all(MEMBERS, f"select=wave_id,contact_id,followup_id&wave_id={fu._in(wave_ids)}"
                                     "&state=eq.drafted&followup_id=not.is.null", order="contact_id")
    by_id = {str(m["followup_id"]): m for m in drafted}
    status: dict[str, str] = {}
    for chunk in fu._chunks(sorted(by_id)):
        for f in sb.select(FOLLOWUPS, f"select=id,status&id={fu._in(chunk)}&limit=1000"):
            status[str(f["id"])] = str(f.get("status") or "")
    for fid, m in by_id.items():
        s = status.get(fid)
        if s == "sent":
            body, k = {"state": "sent"}, "sent"
        elif s == "skipped":
            body, k = {"state": "excluded", "excluded_reason": "A rep skipped the opener."}, "excluded"
        elif s == "failed":
            body, k = {"state": "failed"}, "failed"
        elif s == "expired" or s is None:
            body, k = {"state": "waiting", "followup_id": None, "drafted_at": None}, "back"
        else:
            continue
        done = sb.rest("PATCH", f"{MEMBERS}?wave_id=eq.{fu._q(str(m['wave_id']))}&contact_id=eq.{fu._q(str(m['contact_id']))}"
                                f"&state=eq.drafted&followup_id=eq.{fu._q(fid)}", json_body=body,
                       prefer="return=representation")
        out[k] += bool(isinstance(done, list) and done)
    return out


# ---------------------------------------------------------------------------
# One opener
# ---------------------------------------------------------------------------

def opener_for(lead: dict[str, Any], person: dict[str, Any], thread: list[dict[str, Any]],
               routes: dict[str, dict[str, Any]], owner: Optional[dict[str, Any]], now: datetime, *,
               stop_row: Optional[dict[str, Any]] = None, pause_days: int = fu.STOP_PAUSE_DAYS,
               gap_hours: float = 20, test: bool = False) -> dict[str, Any]:
    """Whether this lead gets the opener now, and its words: {"ok": True,
    route, text, language}, or {"exclude": why} (out of the wave for good),
    or {"later": why} (another day). `test` drafts past do-not-disturb, for
    the refusal test."""
    blocked = fu.blocked_channels(person)
    if not test and (lead.get("dnd") or "whatsapp" in blocked):
        return {"exclude": "WhatsApp do-not-disturb is on for this lead."}
    if not str(person.get("phone") or "").strip():
        return {"exclude": "No phone number in HighLevel."}
    first = fu.person_name(person.get("firstName")) if fu.person_name(lead.get("name")) else None
    if not first:
        return {"exclude": "No first name to greet them by (the opener greets by it)."}
    stop = fu.stop_of(thread)
    hold = fu.stop_hold(stop, stop_row if (stop_row or {}).get("kind") != "manual" else None, now, pause_days)
    if hold:
        return {"exclude": f"The lead {hold}.", "stop": stop}
    last_wa = max((fu._ts(m.get("at")) for m in thread if m.get("from") == "lead" and m.get("channel") == "whatsapp"
                   and fu._ts(m.get("at"))), default=None)
    if fu.window_open(last_wa, now):
        return {"exclude": "They wrote in the last day: a person answers them, not an opener."}
    auto_at = fu.automation_message(thread, set())
    if auto_at and now - auto_at < timedelta(hours=gap_hours):
        return {"later": "A HighLevel automation messaged them lately."}
    by_hand = max((fu._ts(m.get("at")) for m in thread if m.get("from") == "us" and m.get("source") != "workflow"
                   and fu._ts(m.get("at"))), default=None)
    if by_hand and now - by_hand < fu.GAP:
        return {"later": "Someone wrote to them from HighLevel lately."}
    language = fu.language_for(lead, thread)
    route = routes.get(language)
    if not route:
        return {"later": f"The {OPENERS[language]} template is not set up yet."}
    text = opener_text(route, first, signature(owner, language))
    if not text:
        return {"later": f"The {OPENERS[language]} route asks for more than a name and a rep, so it is no opener."}
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

def draft_day(sb: Any, now: datetime, *, settings: dict[str, Any], w: dict[str, Any], waves: list[dict[str, Any]],
              guard: Optional[dict[str, Any]], ghl_token: str, log: Callable[[str], None],
              warn: Callable[[str], None], deadline: Optional[Callable[[], bool]] = None) -> dict[str, Any]:
    """Today's openers for the running waves, in pool order, newest first,
    no more than the day's room. Returns counts, or {"waiting": why} when
    the batch cannot be written now (a sentence for the status row)."""
    out: dict[str, Any] = {"drafted": 0, "excluded": 0, "later": 0, "raced": 0, "unreadable": 0}
    running = [x for x in waves if x.get("state") == "running"]
    if not running:
        return out
    gate = fu.wa_gate(guard)
    if gate:
        return {**out, "waiting": gate}
    k = fu.kuwait_now(now)
    days_off = [str(d).lower() for d in settings.get("quiet_days", ["friday"])]
    first_hours = settings.get("first_hours") or fu.FIRST_HOURS
    if k.strftime("%A").lower() in days_off or fu.quiet(now, settings.get("quiet") or {}) \
            or k.hour < int(first_hours[0]):
        return {**out, "waiting": f"The next batch is written after {int(first_hours[0])}:00 on a working day."}
    midnight = kuwait_midnight(now).isoformat()
    open_old = sb.select(FOLLOWUPS, "select=id&segment=eq.reactivate&status=in.(draft,sending)"
                                    f"&context->>wave_id=not.is.null&created_at=lt.{fu._q(midnight)}&limit=1")
    if open_old:
        return {**out, "waiting": "An earlier day's openers still wait for approval, so no new batch is written."}
    routes = _routes(sb)
    if not routes:
        return {**out, "waiting": "The opener templates (opener_ar, opener_en) are not set up yet, so no opener can be written."}
    ids = [str(x["id"]) for x in running]
    today = sb.select_all(MEMBERS, f"select=wave_id,contact_id&wave_id={fu._in(ids)}&drafted_at=gte.{fu._q(midnight)}",
                          order="contact_id")
    room = int(w["per_day"]) - len(today)
    if room <= 0:
        return {**out, "waiting": f"Today's {w['per_day']} openers are written. The next batch is tomorrow."}
    owners = _owners(sb)
    pause_days = int(settings.get("stop_pause_days", fu.STOP_PAUSE_DAYS) or fu.STOP_PAUSE_DAYS)
    gap_hours = float(settings.get("automation_gap_hours", 20))
    for wave in running:
        wid = str(wave["id"])
        wave_room = min(room, int(wave.get("per_day") or w["per_day"]) - sum(1 for m in today if str(m["wave_id"]) == wid))
        if wave_room <= 0:
            continue
        waiting = sb.select(MEMBERS, f"select=*&wave_id=eq.{fu._q(wid)}&arm=eq.wave&state=eq.waiting"
                                     f"&order=event_at.desc.nullslast&limit={min(1000, wave_room * 4)}")
        if not waiting:
            continue
        contacts = [str(m["contact_id"]) for m in waiting]
        leads: dict[str, dict[str, Any]] = {}
        for chunk in fu._chunks(contacts):
            for l in sb.select("cockpit_sales_leads", f"{LEAD_COLS}&contact_id={fu._in(chunk)}"):
                leads[str(l["contact_id"])] = l
        calls, dealt = _calls_of(sb, contacts), _dealt(sb, contacts)
        open_drafts: dict[str, dict[str, Any]] = {}
        for chunk in fu._chunks(contacts):
            for f in sb.select(FOLLOWUPS, f"select=id,contact_id,segment,context&status=in.(draft,sending)"
                                          f"&contact_id={fu._in(chunk)}&limit=1000"):
                open_drafts[str(f["contact_id"])] = f
        stop_rows = fu.stops_for(sb, contacts)
        drafted_here = 0
        for m in waiting:
            if drafted_here >= wave_room or (deadline and deadline()):
                break
            c = str(m["contact_id"])

            def exclude(why: str) -> None:
                sb.rest("PATCH", f"{MEMBERS}?wave_id=eq.{fu._q(wid)}&contact_id=eq.{fu._q(c)}&state=eq.waiting",
                        json_body={"state": "excluded", "excluded_reason": why[:300]}, prefer="return=minimal")
                out["excluded"] += 1

            lead = leads.get(c)
            if not lead or not pool_of(lead, calls.get(c, []), c in dealt, now):
                exclude("No longer in a backlog pool (booked, signed, a client, or out of the lead copy).")
                continue
            have = open_drafts.get(c)
            if have:
                if have.get("segment") == "reactivate" and str((have.get("context") or {}).get("wave_id")) == wid:
                    # A run that stopped after writing the draft: adopt it.
                    _mark_drafted(sb, wid, c, str(have["id"]), now)
                    drafted_here += 1
                    out["drafted"] += 1
                else:
                    out["later"] += 1
                continue
            try:
                thread = fu.ghl_thread(ghl_token, c)
                person = fu.ghl_contact(ghl_token, c)
            except Exception as e:  # noqa: BLE001 - tried again on a later run
                out["unreadable"] += 1
                warn(f"waves: {c} waits: HighLevel could not be read ({http.scrub(str(e))[:120]})")
                continue
            manual = fu.manual_hold(stop_rows, c, now)
            if manual:
                out["later"] += 1
                continue
            stop = fu.stop_of(thread)
            row = fu.stop_row_for(stop_rows, c, stop)
            if stop and row is None and stop_rows is not None:
                fu.record_stop(sb, c, stop, now, pause_days, warn)
            owner = owners.get(str(lead.get("assigned_to") or ""))
            o = opener_for(lead, person, thread, routes, owner, now, stop_row=row, pause_days=pause_days,
                           gap_hours=gap_hours)
            if o.get("exclude"):
                exclude(o["exclude"])
                continue
            if o.get("later"):
                out["later"] += 1
                continue
            pool = str(wave.get("pool"))
            row_ = _draft_row(lead, o, owner, now, why=(f"Backlog wave, {POOL_WORDS.get(pool, pool)}: the CEO's opener, "
                                                       "no AI text. Their answer opens the window for a written reply."),
                              context={"wave_id": wid, "pool": pool, "event_at": m.get("event_at"), "arm": "wave"})
            try:
                made = sb.rest("POST", FOLLOWUPS, json_body=[row_], prefer="return=representation")
            except http.HttpError as e:
                if not fu._raced(e):
                    raise
                out["raced"] += 1
                continue
            fid = str((made[0] if isinstance(made, list) and made else {}).get("id") or "")
            if not fid:
                continue
            try:
                sb.rest("POST", f"{META}?on_conflict=followup_id", prefer="resolution=ignore-duplicates,return=minimal",
                        json_body=[{"followup_id": fid, "kind_key": f"reactivate.{o['language']}.whatsapp_template",
                                    "wave_id": wid}])
            except http.HttpError as e:
                warn(f"waves: {c}'s opener has no meta row ({http.scrub(str(e))[:120]}); it can be approved on its own, "
                     "not in a batch")
            _mark_drafted(sb, wid, c, fid, now)
            drafted_here += 1
            out["drafted"] += 1
            log(f"waves: opener ({o['language']}) drafted for {c}")
        room -= drafted_here
        if room <= 0:
            break
    return out


def _mark_drafted(sb: Any, wid: str, c: str, fid: str, now: datetime) -> None:
    sb.rest("PATCH", f"{MEMBERS}?wave_id=eq.{fu._q(wid)}&contact_id=eq.{fu._q(c)}&state=eq.waiting",
            json_body={"state": "drafted", "followup_id": fid, "drafted_at": now.isoformat()}, prefer="return=minimal")


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
    return sb.select("cockpit_sales_messages", f"select=id,created_at&sent_by=eq.{DESK}"
                                               f"&created_at=gte.{fu._q(since.isoformat())}&order=created_at.desc&limit={CEILING + 1}")


def send_due(sb: Any, api: Callable[[str, dict[str, Any]], tuple[int, dict[str, Any]]], *, settings: dict[str, Any],
             w: dict[str, Any], waves: list[dict[str, Any]], guard: Optional[dict[str, Any]],
             clock: Callable[[], datetime], sleep: Callable[[float], None], budget_s: float,
             log: Callable[[str], None], warn: Callable[[str], None]) -> dict[str, Any]:
    """Approved drafts whose time has come (meta.send_after), sent one by one
    through sales-api (followup.send_due), at least batch_gap_s apart, the
    gap kept from the desk's own last send across runs too. Held back: a
    draft someone held, anything on WhatsApp while the gate is shut, a lead
    outside 09:00 to 18:00 on their clock (or on their day off), and every
    send once the desk is near the sender ceiling or sales-api holds them
    all. A run stops before its budget runs out; the next one carries on."""
    started = clock()
    out: dict[str, Any] = {"due": 0, "sent": 0, "refused": 0, "held": 0, "outside_hours": 0, "gate": 0, "stopped": None}
    paused = {str(x["id"]) for x in waves if x.get("state") == "paused"}
    meta = sb.select(META, f"select=followup_id,send_after,held_by,wave_id&send_after=lte.{fu._q(started.isoformat())}"
                           "&held_by=is.null&order=send_after.asc&limit=200")
    meta = [m for m in meta if str(m.get("wave_id") or "") not in paused]
    if not meta:
        return out
    fups: dict[str, dict[str, Any]] = {}
    for chunk in fu._chunks([str(m["followup_id"]) for m in meta]):
        for f in sb.select(FOLLOWUPS, f"select=id,contact_id,channel,segment,touch&status=eq.draft&id={fu._in(chunk)}&limit=1000"):
            fups[str(f["id"])] = f
    due = [m for m in meta if str(m["followup_id"]) in fups]
    out["due"] = len(due)
    if not due:
        return out
    countries: dict[str, Any] = {}
    for chunk in fu._chunks(sorted({str(f["contact_id"]) for f in fups.values()})):
        for l in sb.select("cockpit_sales_leads", f"select=contact_id,country&contact_id={fu._in(chunk)}"):
            countries[str(l["contact_id"])] = l.get("country")
    gate = fu.wa_gate(guard)
    gap = float(w["batch_gap_s"])
    first_hours = settings.get("first_hours") or fu.FIRST_HOURS
    days_off = [str(d).lower() for d in settings.get("quiet_days", ["friday"])]
    last = next(iter(_desk_sends_since(sb, started - timedelta(seconds=gap))), None)
    last_at = fu._ts((last or {}).get("created_at"))
    in_a_row = 0
    for m in due:
        fid = str(m["followup_id"])
        f = fups[fid]
        now = clock()
        if str(f.get("channel") or "").startswith("whatsapp") and gate:
            out["gate"] += 1
            continue
        country = countries.get(str(f["contact_id"]))
        local = now + fu.lead_offset(country)
        if not fu.in_hours(now, country, first_hours) or local.strftime("%A").lower() in days_off:
            out["outside_hours"] += 1
            continue
        recent = _desk_sends_since(sb, now - CEILING_WINDOW)
        if len(recent) >= CEILING - RESERVE:
            out["stopped"] = (f"The desk sent {len(recent)} messages in ten minutes; the rest wait so the sender "
                              f"ceiling keeps {RESERVE} for the demo chat.")
            break
        wait = 0.0 if not last_at else gap - (now - last_at).total_seconds()
        if (now - started).total_seconds() + max(0.0, wait) + 20 > budget_s:
            out["stopped"] = "This run's time is up; the next run carries on."
            break
        if wait > 0:
            sleep(wait)
        fresh = next(iter(sb.select(META, f"select=held_by&followup_id=eq.{fu._q(fid)}&limit=1")), {})
        if fresh.get("held_by"):
            out["held"] += 1
            continue
        try:
            status, res = api("followup.send_due", {"id": fid})
        except Exception as e:  # noqa: BLE001 - the door did not answer: stop, the next run tries again
            out["stopped"] = f"sales-api did not answer: {http.scrub(str(e))[:160]}"
            break
        last_at = clock()
        if status == 200 and not res.get("error"):
            out["sent"] += 1
            in_a_row = 0
            log(f"waves: sent {fid}")
            continue
        if global_refusal(status, res):
            out["stopped"] = str(res.get("error") or f"sales-api answered {status}")[:300]
            break
        out["refused"] += 1
        in_a_row += 1
        warn(f"waves: {fid} not sent: {str(res.get('error') or status)[:160]}")
        if in_a_row >= 3:
            out["stopped"] = f"Three sends in a row were refused; the last: {str(res.get('error') or status)[:200]}"
            break
    return out


# ---------------------------------------------------------------------------
# One pass of the waves job
# ---------------------------------------------------------------------------

def run(sb: Any, api: Callable[[str, dict[str, Any]], tuple[int, dict[str, Any]]], *, settings: dict[str, Any],
        guard: Optional[dict[str, Any]], ghl_token: str, log: Callable[[str], None],
        warn: Optional[Callable[[str], None]] = None, clock: Optional[Callable[[], datetime]] = None,
        sleep: Optional[Callable[[float], None]] = None, budget_s: float = 270) -> dict[str, Any]:
    """Enrol new waves, keep members in step, write today's batch, send
    what is due. Every step says what it did; none is skipped silently."""
    import time
    clock = clock or (lambda: datetime.now(timezone.utc))
    sleep = sleep or time.sleep
    warn = warn or log
    started = clock()
    w = settings_of(settings)
    waves = _waves(sb)
    out: dict[str, Any] = {"waves": [{"id": x["id"], "pool": x.get("pool"), "state": x.get("state")} for x in waves]}
    if not waves:
        out["sent"] = send_due(sb, api, settings=settings, w=w, waves=[], guard=guard, clock=clock, sleep=sleep,
                               budget_s=budget_s, log=log, warn=warn)
        return out
    enrolled: dict[str, Any] = {}
    for x in waves:
        if x.get("state") != "running":
            continue
        if not sb.select(MEMBERS, f"select=contact_id&wave_id=eq.{fu._q(str(x['id']))}&limit=1"):
            enrolled[str(x["id"])] = enroll(sb, x, started, w, log)
    out["enrolled"] = enrolled
    waves = _waves(sb)
    out["synced"] = sync(sb, [str(x["id"]) for x in waves], started)
    if not ghl_token:
        out["drafted"] = {"waiting": "GHL_B2B_API_KEY is not set, so no lead's conversation can be read and no opener "
                                     "is written."}
    else:
        half = budget_s / 2
        out["drafted"] = draft_day(sb, started, settings=settings, w=w, waves=waves, guard=guard, ghl_token=ghl_token,
                                   log=log, warn=warn,
                                   deadline=lambda: (clock() - started).total_seconds() > half)
    left = budget_s - (clock() - started).total_seconds()
    out["sent"] = send_due(sb, api, settings=settings, w=w, waves=waves, guard=guard, clock=clock, sleep=sleep,
                           budget_s=max(0.0, left), log=log, warn=warn)
    return out


def words(out: dict[str, Any]) -> tuple[bool, str]:
    """The waves job's status row: (ok, one plain line). A wave that cannot
    move for a setup reason is not ok, and says what is missing."""
    waves = out.get("waves") or []
    sent = out.get("sent") or {}
    parts: list[str] = []
    ok = True
    if not waves:
        parts.append("No wave is running")
    else:
        running = [x for x in waves if x.get("state") == "running"]
        parts.append(f"{len(running)} wave{'s' if len(running) != 1 else ''} running"
                     + (f", {len(waves) - len(running)} paused" if len(waves) > len(running) else ""))
        for wid, e in (out.get("enrolled") or {}).items():
            parts.append(f"{e['enrolled']} leads enrolled, {e['held_back']} held back to measure the effect")
        d = out.get("drafted") or {}
        if d.get("waiting"):
            parts.append(d["waiting"].rstrip("."))
            setup = ("not set up" in d["waiting"] or "single-copy" in d["waiting"] or "is not set" in d["waiting"])
            ok = ok and not (setup and running)
        if d.get("drafted"):
            parts.append(f"{d['drafted']} openers written for approval")
        if d.get("excluded"):
            parts.append(f"{d['excluded']} left out")
        if d.get("later"):
            parts.append(f"{d['later']} wait for another day")
        if d.get("unreadable"):
            parts.append(f"{d['unreadable']} waiting because HighLevel could not be read")
    if sent.get("sent"):
        parts.append(f"{sent['sent']} sent")
    if sent.get("gate"):
        parts.append(f"{sent['gate']} approved but held: {fu.GATE_CLOSED.rstrip('.')}")
        ok = False
    if sent.get("outside_hours"):
        parts.append(f"{sent['outside_hours']} wait for 09:00 to 18:00 on the lead's clock")
    if sent.get("held"):
        parts.append(f"{sent['held']} held by a person")
    if sent.get("refused"):
        parts.append(f"{sent['refused']} refused by the cockpit")
    if sent.get("stopped"):
        parts.append(f"sending stopped: {str(sent['stopped']).rstrip('.')}")
    return ok, "; ".join(parts)
