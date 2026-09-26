"""The follow-up agent: it finds the leads who need a message now, hottest
first, writes one from everything the cockpit knows about them, and puts it
in front of the lead's rep to approve. Nothing reaches a lead until a person
says yes, unless a manager has switched that kind of message to send by
itself.

Aziz, 2026-09-24: "an agent ... that goes into our CRM and actually follows
up ... with context on their specific situation, with the history, the call
we had, and anything it has in terms of data ... with approval ... until
it's fully trained."

Aziz, 2026-09-26: "a lot of WhatsApp messages that they can send, not just
email, because the reply rates are very low" and "I want to actually start
replacing our follow-ups ... for the hottest leads first ... Long term, they
may not even need approval after a while ... more customized messages" for
the no-shows, the cancellations and the new leads who did not book.

Who, most urgent first, and within that the hottest first (the dialer's
heat: the hot list, qualified, revenue, money ready, wrote to us, fresh):
- reply (tier 0): they wrote in the last 48 hours and nobody answered;
- confirm (tier 0 within three hours of the call, else 1): a call booked
  more than a day ahead, from the evening before (a morning call) or that
  morning, when nobody has confirmed it and they have not written since
  booking;
- no_show (tier 1 for the first message, then 2): missed an intro or demo in
  the last week, nothing rebooked;
- cancelled (1, then 2): cancelled an intro or demo, nothing rebooked;
- new (1, then 2): came in during the last week, never booked, never reached
  on a call;
- after_call (2): a demo showed in the last four days, no deal;
- nurture (3): in a nurture stage, last touched a week ago or more.

Each kind is a sequence, like the HighLevel automation it replaces: its
cadence (hours after the event) is in the settings, and each message has
its own angle, so a lead never reads the same message twice. A message sent
or skipped counts as that step done. Nobody gets two messages within 20
hours (a reply to them excepted), and a lead has one open draft at a time.

How: WhatsApp first. Inside the lead's 24-hour window, a free message.
Outside it, an approved template through its HighLevel workflow, carrying
one line written for this lead, when a manager has set one up. Email only
when neither can go and the kind allows it. While a HighLevel automation
has messaged the lead recently, the agent waits, so nobody gets both.

The words follow Aziz's spoken-Gulf voice rules for Arabic, mirror the
lead's own language, never invent a number, price, result or promise, and
carry one next step. Edits reps made to earlier drafts are shown to the
model as what good looks like. Lead data goes to OpenAI only, never to
DeepSeek.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http
from .errors import NotNow

KUWAIT = timedelta(hours=3)
GHL = "https://services.leadconnectorhq.com"
LOCATION = "7NI8yyJtwsh2OOWA5Icr"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
SEGMENTS = ("reply", "confirm", "no_show", "cancelled", "new", "after_call", "nurture")

# Hours after the event for each message of a sequence (the settings' cadence
# overrides these). The first no-show message goes a quarter of an hour after
# the missed call; a cancellation's goes as soon as it is seen.
CADENCE = {"new": [0.5, 24, 48, 96, 168], "no_show": [0.25, 24, 72, 144], "cancelled": [0, 48, 120],
           "after_call": [24, 72]}
GAP = timedelta(hours=20)
GULF = ("kuwait", "saudi", "ksa", "emirates", "uae", "qatar", "bahrain", "oman", "الكويت", "السعودية", "الإمارات",
        "قطر", "البحرين", "عمان")
# The UAE and Oman keep UTC+4; Kuwait, Saudi Arabia, Qatar and Bahrain UTC+3.
# A call's time goes to the lead in their own clock. The lead copy holds ISO
# codes (SA, KW, AE, QA, BH, 2026-09-26); names are matched too.
PLUS_FOUR = re.compile(r"^\s*(ae|om)\s*$|emirates|\buae\b|u\.a\.e|dubai|abu dhabi|sharjah|ajman|\boman\b|muscat"
                       r"|الإمارات|الامارات|دبي|أبوظبي|ابوظبي|الشارقة|مسقط", re.I)
# Countries whose leads write Arabic unless they show otherwise (ISO codes).
ARABIC_COUNTRIES = {"sa", "kw", "ae", "qa", "bh", "om", "eg", "jo", "iq", "lb", "sy", "ye", "ps", "ly", "tn", "dz",
                    "ma", "sd"}
# A lead who asked to be left alone gets nothing from the agent: messaging
# them anyway is how a number gets reported to Meta, and then limited.
OPT_OUT = re.compile(
    r"\b(stop|unsubscribe|remove me|opt out|don'?t (contact|message|text|call|whatsapp) me|do not (contact|message|text|call)"
    r"|leave me alone|not interested|no longer interested)\b"
    r"|لا ?(تراسل|ترسل|تتواصل|تتصل|تكلم)|لا عاد (تراسل|ترسل|تتواصل|تتصل)|وقف(وا)? (الرسائل|الرسايل|المراسلة)"
    r"|(احذف|احذفوا|امسح|امسحوا|شيل|شيلوا) رقمي|لا تزعج|مو مهتم|مش مهتم|غير مهتم|ما عاد مهتم",
    re.I)

VOICE = """How Mahara writes to a lead:
- Answer in the language the lead uses with us. If they write Arabic, write spoken Gulf Arabic
  (Kuwaiti or Saudi, as they speak), casual and respectful, never textbook Arabic, never hype.
- Short. WhatsApp: two to four short lines. Email: a subject and three short paragraphs at most.
- One clear next step (confirm a time, pick a new slot, answer one question, open the deck).
- Speak to their situation: what they told us, what happened on the call. No generic templates.
- Never invent a number, price, result, client name, discount or promise. If a figure is needed
  and not in the facts, leave it out. Mahara's only approved proof line is «أكثر من ٧٠ شركة بالخليج».
- Say «دولار», never put $ inside Arabic text. No em-dashes. No quote marks around words. No emojis
  beyond one at most.
- Never pretend to be the lead's friend or invent urgency ("last chance", fake deadlines).
- Never propose a specific day or time: the rep's calendar is not in front of you. Ask when suits
  them, or offer "today or tomorrow" in words. The one exception is a call they already booked,
  given in the facts as the_call: name its day and time exactly as given.
- In Arabic text write numbers in Arabic-Indic digits, all of them.
- Email: sign with the rep's first name as given in the facts ("rep"; in an Arabic email "rep_ar"
  when it is given); if no rep is given, sign nothing. WhatsApp needs no signature. Never sign as
  anyone else."""

GOAL = {
    "reply": "They wrote to us and nobody has answered. Answer what they asked, then move them to the next step.",
    "confirm": ("They booked a call more than a day ago, and it is coming up. Check they can still make it: name "
                "the day and time from the_call, give one reason from what they told us why the call is worth "
                "their time, and ask them to reply to confirm. If the time no longer suits, offer to move it."),
    "no_show": "They missed their call. No blame. Offer to find a new time that suits them.",
    "cancelled": "They cancelled their call. No guilt. Check all is well and offer a time that suits them better.",
    "new": "They came in recently and have not booked a call. Get the intro call booked.",
    "after_call": "They had the demo and have not signed. Follow up on the one thing that mattered on the call.",
    "nurture": "A long-term lead. A short, useful check-in about their situation; no pressure, one soft question.",
}

# What each message of a sequence does, so no two read alike.
ANGLES = {
    "new": ["Introduce the rep in one line and ask when suits them for a short call.",
            "Ask one real question about their situation, from their answers (their challenge, services or goal).",
            "Give the one approved proof line, tie it to their field, and ask if they want to see how it works.",
            "A short plain check: are they still looking to bring in more projects?",
            "A polite last message: we leave it here, and they can reply any time."],
    "no_show": ["They just missed the call: no blame, ask if they want a new time today or tomorrow.",
                "Check in: did something come up? Ask if they still want the call.",
                "Remind them what they said they wanted, from their answers or the notes, and offer to rebook.",
                "A polite last message: we leave it here, and they can reply any time to rebook."],
    "cancelled": ["Ask if all is well and offer to find a better time.",
                  "Remind them what they wanted from the call and ask if it still matters to them.",
                  "A polite last message: reply any time and we set a new time."],
    "after_call": ["Follow up on the one thing that mattered most on the call.",
                   "Take the question or doubt left open on the call, answer it plainly, and ask for the next step."],
}

CHANNEL_RULES = {
    "whatsapp": "Channel: WhatsApp, a free message inside their 24-hour window.",
    "email": "Channel: email. A subject and at most three short paragraphs.",
    "whatsapp_template": (
        "Channel: a WhatsApp template. Write ONE line only: no line breaks, at most 300 characters, in {lang}. "
        "It goes into this approved template, which already greets them by name, says who it is from and "
        "asks them to reply:\n{preview}\nSo do not greet them, do not sign, and do not ask them to reply here: "
        "write only the middle line ({{{{3}}}}), which must read naturally between the greeting and the ending. "
        "Put that line in body."),
}

SYSTEM = """You write one follow-up message from a Mahara Media sales rep to a lead.
Mahara brings construction, architecture, interior design and fit-out firms in the Gulf
qualified project leads through paid ads.

{voice}

Why this lead now: {goal}
{angle}
{channel}

Answer with one JSON object only:
{{"body": str, "subject": str | null, "why": str, "language": "ar" | "en"}}
- body: the message itself, ready to send.
- subject: for email only; null otherwise.
- why: one sentence for the rep, in English, on why this message and why now.
{examples}"""


def kuwait_now(now: datetime) -> datetime:
    return now + KUWAIT


def quiet(now: datetime, q: dict[str, Any]) -> bool:
    """True between the quiet hours (Kuwait), when no draft is written."""
    h = kuwait_now(now).hour
    a, b = int(q.get("from", 21)), int(q.get("to", 9))
    return h >= a or h < b if a > b else a <= h < b


def _ts(v: Any) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        t = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# How hot a lead is: the dialer's heat (sales-api dialer.ts), the same weights
# ---------------------------------------------------------------------------

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def revenue_of(answer: Any) -> Optional[float]:
    """The yearly revenue a form answer points at, in dollars, or None."""
    t = str(answer or "").lower().translate(_DIGITS)
    if not t.strip():
        return None
    nums: list[float] = []
    for m in re.finditer(r"(\d[\d,.]*)\s*(k|m|mil|million|ألف|الف|مليون)?", t):
        try:
            n = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        unit = m.group(2) or ""
        if re.search(r"^m|mil|مليون", unit):
            n *= 1_000_000
        elif re.search(r"^k|ألف|الف", unit):
            n *= 1_000
        if n > 0:
            nums.append(n)
    if not nums:
        return None
    top = max(nums)
    if re.search(r"أقل|اقل|less|under|below", t):
        return top * 0.4
    if re.search(r"أكثر|اكثر|more|over|above|\+", t):
        return top
    return min(nums)


def ready_of(answer: Any) -> Optional[tuple[bool, Optional[float]]]:
    """Whether the lead said they have money ready to invest (and how much, at least)."""
    t = str(answer or "").lower()
    if not t.strip():
        return None
    if re.search(r"مو مستعد|مش مستعد|غير مستعد|not ready|no budget", t):
        return (False, None)
    floor = revenue_of(re.sub(r"أكثر|اكثر|more than", "+", t))
    return None if floor is None else (True, floor)


def heat(lead: dict[str, Any], now: datetime, *, hot: bool = False,
         inbound_at: Optional[datetime] = None) -> tuple[int, list[str]]:
    """A score to order leads of the same kind, and the reasons a rep reads."""
    score, reasons = 0, []
    if hot:
        score += 3
        reasons.append("On the hot list")
    if lead.get("lead_class") == "qualified":
        score += 3
        reasons.append("Qualified")
    elif lead.get("lead_class") == "unqualified":
        score += 1
    revenue = revenue_of(lead.get("revenue"))
    if revenue is not None and revenue >= 1_000_000:
        score += 2
        reasons.append("$1M+ a year")
    elif revenue is not None and revenue >= 250_000:
        score += 1
        reasons.append("$250k+ a year")
    ready = ready_of(lead.get("readiness"))
    if ready and ready[0]:
        score += 2 if ready[1] is not None and ready[1] >= 8_000 else 1
        reasons.append("Ready to invest")
    elif ready and not ready[0]:
        score -= 1
    if inbound_at and now - inbound_at <= timedelta(days=1):
        score += 2
        reasons.append("Wrote to us")
    created = _ts(lead.get("lead_created_at"))
    if created and now - created <= timedelta(hours=1):
        score += 2
        reasons.append("Came in this hour")
    elif created and now - created <= timedelta(days=1):
        score += 1
    if "hot" in str(lead.get("stage_name") or "").lower() and not hot:
        score += 2
        reasons.append("Hot Leads stage")
    return score, reasons[:3]


def confirm_from(start: datetime) -> datetime:
    """When a call booked more than a day ahead is confirmed: 18:00 the evening
    before a call that starts before noon (Kuwait), otherwise 09:00 that day
    (the dialer's rule, the call centre's too)."""
    k = start + KUWAIT
    if k.hour < 12:
        at = (k - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
    else:
        at = k.replace(hour=9, minute=0, second=0, microsecond=0)
    return at - KUWAIT


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------

def window_open(last_inbound_wa: Optional[datetime], now: datetime) -> bool:
    return bool(last_inbound_wa and now - last_inbound_wa < timedelta(hours=23))


def channel_for(lead: dict[str, Any], last_inbound_wa: Optional[datetime], now: datetime, *,
                template: bool = False, email_ok: bool = True) -> Optional[str]:
    """WhatsApp inside the 24-hour window; else an approved WhatsApp template
    when one is set up and the lead can be greeted by name; else email if the
    kind allows it and there is an address; else nothing."""
    if lead.get("dnd"):
        return None
    if window_open(last_inbound_wa, now):
        return "whatsapp"
    if template and str(lead.get("phone") or "").strip():
        return "whatsapp_template"
    if email_ok and str(lead.get("email") or "").strip():
        return "email"
    return None


def language_for(lead: dict[str, Any], thread: list[dict[str, Any]]) -> str:
    """The language to write in: the lead's own messages first, then their
    name, then where they are (the Gulf writes Arabic)."""
    theirs = [str(m.get("text") or "") for m in thread if m.get("from") == "lead" and m.get("text")]
    if theirs:
        return "ar" if any(re.search(r"[\u0600-\u06ff]", t) for t in theirs) else "en"
    if re.search(r"[\u0600-\u06ff]", str(lead.get("name") or "")):
        return "ar"
    country = str(lead.get("country") or "").strip().lower()
    if not country or country in ARABIC_COUNTRIES or any(g in country for g in GULF):
        return "ar"
    return "en"


def eligible(lead: Optional[dict[str, Any]], dealt: set[str]) -> Optional[str]:
    """Why this contact is not the follow-up agent's to write to, or None.

    Only sales leads: in a sales pipeline or carrying a lead tag, and not a
    client. Found 2026-09-24: an existing client's contract email sat in the
    sales inbox and was drafted a sales pitch."""
    if not lead:
        return "not in the cockpit's lead copy"
    c = str(lead.get("contact_id") or "")
    if str(lead.get("contact_type") or "").lower() == "customer" or c in dealt:
        return "a client"
    if "closed" in str(lead.get("stage_name") or "").lower():
        return "a client"
    if str(lead.get("opp_status") or "").lower() in ("won", "lost", "abandoned"):
        return "no longer in the pipeline"
    if not lead.get("pipeline_name") and not lead.get("lead_class"):
        return "not a sales lead (no pipeline, no lead tag)"
    return None


# ---------------------------------------------------------------------------
# Who needs a message now
# ---------------------------------------------------------------------------

def pick(now: datetime, *, inbox: list[dict[str, Any]], calendar: list[dict[str, Any]], leads: list[dict[str, Any]],
         followups: list[dict[str, Any]] = (), sends: list[dict[str, Any]] = (), open_drafts: set[str] = frozenset(),
         deals: set[str] = frozenset(), reached: set[str] = frozenset(), confirmations: list[dict[str, Any]] = (),
         hot: set[str] = frozenset(), cadence: Optional[dict[str, list[float]]] = None,
         nurture_every_days: int = 7, nurture_room: int = 1_000_000) -> list[dict[str, Any]]:
    """Everyone who needs a message now, each lead once, most urgent first and
    the hottest first within that. `followups` are the agent's drafts of the
    last weeks (their status says which steps are done), `sends` the
    cockpit's own sends, `reached` leads someone spoke to on a call lately."""
    steps_of = {**CADENCE, **{k: [float(x) for x in v] for k, v in (cadence or {}).items() if v}}
    last_sent: dict[str, datetime] = {}
    for s in sends:
        t = _ts(s.get("created_at"))
        if t and s.get("state") != "failed":
            c = str(s.get("contact_id") or "")
            last_sent[c] = max(last_sent.get(c, t), t)
    decided: dict[tuple[str, str], list[datetime]] = {}
    drafted_appts: set[str] = set()
    for f in followups:
        c, seg = str(f.get("contact_id") or ""), str(f.get("segment") or "")
        t = _ts(f.get("decided_at")) or _ts(f.get("created_at"))
        if f.get("status") == "sent" and t:
            last_sent[c] = max(last_sent.get(c, t), t)
        if f.get("status") in ("sent", "skipped") and t:
            decided.setdefault((c, seg), []).append(t)
        if seg == "confirm" and f.get("appointment_id") and f.get("status") in ("draft", "sending", "sent", "skipped"):
            drafted_appts.add(str(f["appointment_id"]))
    inbound: dict[str, datetime] = {}
    for r in inbox:
        c = str(r.get("contact_id") or "")
        for t in (_ts(r.get("inbound_whatsapp_at")),
                  _ts(r.get("last_message_at")) if r.get("last_direction") == "inbound" else None):
            if c and t:
                inbound[c] = max(inbound.get(c, t), t)
    by_lead = {str(l.get("contact_id")): l for l in leads}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(c: str, seg: str, touch: int, tier: int, *, appointment_id: Optional[str] = None,
            start_at: Optional[datetime] = None, due_at: Optional[datetime] = None) -> bool:
        if not c or c in seen or c in open_drafts:
            return False
        if seg != "reply" and c in last_sent and now - last_sent[c] < GAP:
            return False
        seen.add(c)
        score, reasons = heat(by_lead.get(c) or {}, now, hot=c in hot, inbound_at=inbound.get(c))
        out.append({"contact_id": c, "segment": seg, "touch": touch, "of": len(steps_of.get(seg) or [1]),
                    "tier": tier, "heat": score, "reasons": reasons, "appointment_id": appointment_id,
                    "start_at": start_at.isoformat() if start_at else None,
                    "due_at": (due_at or now).isoformat()})
        return True

    def step(c: str, seg: str, since: datetime, first_due: datetime) -> Optional[tuple[int, datetime]]:
        """The next message of a sequence, if one is due: counted from the
        steps sent or skipped since the event, spaced by the cadence from the
        first one."""
        steps = steps_of.get(seg) or []
        done = sorted(t for t in decided.get((c, seg), []) if t >= since - timedelta(hours=1))
        n = len(done) + 1
        if n > len(steps):
            return None
        due = first_due if n == 1 else done[0] + timedelta(hours=steps[n - 1] - steps[0])
        return (n, due) if due <= now else None

    # They wrote and nobody answered.
    for r in sorted(inbox, key=lambda r: str(r.get("last_message_at") or ""), reverse=True):
        t = _ts(r.get("last_message_at"))
        if r.get("last_direction") == "inbound" and t and now - t < timedelta(hours=48):
            add(str(r.get("contact_id") or ""), "reply", 1, 0)

    live = ("cancelled", "noshow", "invalid", "showed")
    calls = [a for a in calendar if a.get("call_type") in ("intro", "demo") and _ts(a.get("start_at"))]
    rebooked: dict[str, datetime] = {}
    for a in calls:
        t = _ts(a.get("start_at"))
        if a.get("status") not in live and t > now:
            c = str(a.get("contact_id") or "")
            rebooked[c] = min(rebooked.get(c, t), t)
    confirmed = {str(x.get("appointment_id")) for x in confirmations
                 if x.get("result") in ("confirmed", "message_sent", "reschedule", "cancelled")}

    # A call booked more than a day ahead, due for its confirmation.
    for a in sorted(calls, key=lambda a: str(a.get("start_at"))):
        c, start, booked = str(a.get("contact_id") or ""), _ts(a.get("start_at")), _ts(a.get("booked_at"))
        aid = str(a.get("appointment_id") or "")
        if a.get("status") in live or not booked or not aid or start <= now or start - now > timedelta(hours=36):
            continue
        if start - booked < timedelta(hours=24) or now < confirm_from(start):
            continue
        if aid in confirmed or aid in drafted_appts or (inbound.get(c) and inbound[c] > booked):
            continue
        add(c, "confirm", 1, 0 if start - now <= timedelta(hours=3) else 1, appointment_id=aid, start_at=start)

    # Missed or cancelled, and nothing booked since.
    for seg, status in (("no_show", "noshow"), ("cancelled", "cancelled")):
        latest: dict[str, dict[str, Any]] = {}
        for a in calls:
            if a.get("status") != status:
                continue
            c, t = str(a.get("contact_id") or ""), _ts(a.get("start_at"))
            lo, hi = (now - timedelta(days=7), now) if seg == "no_show" else (now - timedelta(days=3), now + timedelta(days=21))
            if c and lo <= t <= hi and (c not in latest or _ts(latest[c].get("start_at")) < t):
                latest[c] = a
        for c, a in latest.items():
            start = _ts(a.get("start_at"))
            if c in rebooked and (seg == "cancelled" or rebooked[c] > start):
                continue
            if seg == "no_show":
                since, first_due = start, start + timedelta(hours=(steps_of.get(seg) or [0])[0])
            else:
                # When a call was cancelled is not in the copy: the first message goes when it is seen.
                since = _ts(a.get("booked_at")) or start - timedelta(days=30)
                first_due = now
            nxt = step(c, seg, since, first_due)
            if nxt:
                add(c, seg, nxt[0], 1 if nxt[0] == 1 else 2, appointment_id=str(a.get("appointment_id") or "") or None,
                    start_at=start, due_at=nxt[1])

    # New leads who never booked and nobody has reached.
    ever_booked = {str(a.get("contact_id") or "") for a in calendar}
    for lead in sorted(leads, key=lambda l: str(l.get("lead_created_at") or ""), reverse=True):
        c, created = str(lead.get("contact_id") or ""), _ts(lead.get("lead_created_at"))
        if not created or now - created > timedelta(days=7) or c in ever_booked or c in reached:
            continue
        if lead.get("lead_class") not in ("qualified", "unqualified") and not lead.get("pipeline_id"):
            continue
        nxt = step(c, "new", created, created + timedelta(hours=(steps_of.get("new") or [0])[0]))
        if nxt:
            add(c, "new", nxt[0], 1 if nxt[0] == 1 else 2, due_at=nxt[1])

    # A demo that showed and no deal since.
    for a in calls:
        c, start = str(a.get("contact_id") or ""), _ts(a.get("start_at"))
        if a.get("call_type") != "demo" or a.get("status") != "showed" or c in deals:
            continue
        if not (now - timedelta(days=4) <= start <= now):
            continue
        nxt = step(c, "after_call", start, start + timedelta(hours=(steps_of.get("after_call") or [0])[0]))
        if nxt:
            add(c, "after_call", nxt[0], 2, appointment_id=str(a.get("appointment_id") or "") or None,
                start_at=start, due_at=nxt[1])

    # Long-term leads last, qualified and newest first, no more than today's
    # room for check-ins: hundreds are due at once, and they must not bury
    # the drafts that cannot wait.
    nurture = [l for l in leads if "nurture" in str(l.get("stage_name") or "").lower()
               and (not _ts(l.get("last_touch_at")) or now - _ts(l.get("last_touch_at")) >= timedelta(days=nurture_every_days))]
    nurture.sort(key=lambda l: str(l.get("lead_created_at") or ""), reverse=True)
    nurture.sort(key=lambda l: l.get("lead_class") != "qualified")
    added = 0
    for lead in nurture:
        if added >= nurture_room:
            break
        added += add(str(lead.get("contact_id") or ""), "nurture", 1, 3)

    out.sort(key=lambda d: (d["tier"], -d["heat"], d["due_at"]))
    return out


# ---------------------------------------------------------------------------
# What the agent is told about one lead
# ---------------------------------------------------------------------------

def _q(v: str) -> str:
    return http.quote(v)


def _ghl_headers(token: str, version: str = "2021-04-15") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Version": version, "Accept": "application/json", "User-Agent": UA}


def ghl_thread(token: str, contact_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """The lead's last messages across their HighLevel conversations, oldest first."""
    if not token:
        return []
    h = _ghl_headers(token)
    _, _, raw = http.request("GET", f"{GHL}/conversations/search?locationId={LOCATION}&contactId={_q(contact_id)}&limit=10",
                             headers=h, timeout=30, retries=1)
    convs = (json.loads(raw.decode("utf-8") or "{}").get("conversations") or [])[:4]
    msgs: list[dict[str, Any]] = []
    for c in convs:
        _, _, raw = http.request("GET", f"{GHL}/conversations/{_q(str(c['id']))}/messages?limit={limit}",
                                 headers=h, timeout=30, retries=1)
        d = json.loads(raw.decode("utf-8") or "{}")
        inner = d.get("messages") or {}
        for m in (inner.get("messages") if isinstance(inner, dict) else inner) or []:
            body = str(m.get("body") or "").strip()
            if body or m.get("direction") == "outbound":
                msgs.append({"id": m.get("id"), "at": m.get("dateAdded"),
                             "from": "lead" if m.get("direction") == "inbound" else "us",
                             "channel": str(m.get("messageType") or "").replace("TYPE_", "").lower(),
                             "source": m.get("source"), "status": m.get("status"), "text": body[:600]})
    msgs.sort(key=lambda m: str(m.get("at") or ""))
    return msgs[-limit:]


def ghl_probe(token: str) -> int:
    """One read of the sales sub-account's conversations, for the doctor: the agent's key still works."""
    _, _, raw = http.request("GET", f"{GHL}/conversations/search?locationId={LOCATION}&limit=1",
                             headers=_ghl_headers(token), timeout=30, retries=1)
    return len(json.loads(raw.decode("utf-8") or "{}").get("conversations") or [])


def ghl_contact(token: str, contact_id: str) -> dict[str, Any]:
    """The contact as HighLevel holds it: the first name a template greets."""
    if not token:
        return {}
    _, _, raw = http.request("GET", f"{GHL}/contacts/{_q(contact_id)}", headers=_ghl_headers(token, "2021-07-28"),
                             timeout=30, retries=1)
    return json.loads(raw.decode("utf-8") or "{}").get("contact") or {}


def lead_offset(country: Any) -> timedelta:
    """The lead's clock: UTC+4 in the UAE and Oman, UTC+3 elsewhere in the Gulf (and when unknown)."""
    return timedelta(hours=4) if PLUS_FOUR.search(str(country or "")) else KUWAIT


def call_words(start: datetime, now: datetime, country: Any = None) -> dict[str, str]:
    """A booked call's day and time on the lead's own clock, as the message may name them."""
    off = lead_offset(country)
    k, today = start + off, (now + off).date()
    rel = "today" if k.date() == today else "tomorrow" if k.date() == today + timedelta(days=1) else k.strftime("%A")
    return {"day": k.strftime("%A %d %B"), "relative": rel, "time_24h": k.strftime("%H:%M"),
            "zone": "their own time (UTC+4)" if off == timedelta(hours=4) else "their own time (UTC+3, as Kuwait)"}


def asked_to_stop(thread: list[dict[str, Any]]) -> bool:
    """The lead's own latest message says stop or not interested (a later
    "actually, tell me more" opens them up again)."""
    theirs = [str(m.get("text") or "") for m in thread if m.get("from") == "lead" and m.get("text")]
    return bool(theirs) and bool(OPT_OUT.search(theirs[-1]))


def context_for(sb: Any, lead: dict[str, Any], ghl_token: str, now: datetime,
                rep_name: Optional[str] = None, due: Optional[dict[str, Any]] = None,
                rep_ar: Optional[str] = None) -> dict[str, Any]:
    """Everything the cockpit knows that a rep would want the message to know."""
    c = str(lead["contact_id"])
    appts = sb.select("cockpit_sales_calendar",
                      f"select=call_type,start_at,status,assigned_user_name&contact_id=eq.{_q(c)}&order=start_at.desc&limit=6")
    dials = sb.select("cockpit_sales_dials",
                      f"select=occurred_at,direction,state,duration_s,summary_en,agent_name&contact_id=eq.{_q(c)}"
                      "&order=occurred_at.desc&limit=5")
    notes = sb.select("cockpit_sales_notes", f"select=body,author,created_at&contact_id=eq.{_q(c)}"
                                             "&deleted_at=is.null&order=created_at.desc&limit=5")
    recs = sb.select("cockpit_sales_recordings",
                     f"select=title,started_at,summary,action_items&contact_id=eq.{_q(c)}&order=started_at.desc&limit=2")
    call_notes = sb.select("cockpit_sales_call_notes",
                           f"select=call_type,call_at,notes&contact_id=eq.{_q(c)}&order=call_at.desc&limit=2")
    research = sb.select("cockpit_sales_research",
                         f"select=brief&contact_id=eq.{_q(c)}&status=eq.ready&order=requested_at.desc&limit=1")
    # A conversation that cannot be read is not an empty one: without it the
    # agent cannot see an automation's message, the lead's stop, or their
    # window, so the lead waits for the next run instead.
    try:
        thread, thread_ok = ghl_thread(ghl_token, c), True
    except Exception:  # noqa: BLE001 - said in the run's counts
        thread, thread_ok = [], False
    brief = (research[0].get("brief") if research else None) or {}
    ctx = {
        "lead": {k: lead.get(k) for k in ("name", "company", "country", "lead_class", "stage_name", "revenue",
                                           "revenue_goal", "readiness", "challenge", "decision_maker", "services",
                                           "ad_name", "lead_created_at")},
        "calls_on_the_calendar": appts,
        "phone_calls": [{k: d.get(k) for k in ("occurred_at", "direction", "state", "duration_s", "summary_en")}
                        for d in dials],
        "rep_notes": [{"text": str(n.get("body") or "")[:600], "at": n.get("created_at")} for n in notes],
        "recorded_calls": [{"title": r.get("title"), "at": r.get("started_at"),
                            "summary": str(r.get("summary") or "")[:2500],
                            "action_items": str(r.get("action_items") or "")[:800]} for r in recs],
        "what_the_calls_told_us": [{"call": n.get("call_type"), "at": n.get("call_at"),
                                    **{k: (n.get("notes") or {}).get(k) for k in
                                       ("summary", "real_problem", "objections", "expectations", "next_steps")}}
                                   for n in call_notes],
        "research": {"company": (brief.get("company") or {}).get("summary"),
                     "talking_points": brief.get("talking_points")} if brief else None,
        "conversation": [{k: m.get(k) for k in ("at", "from", "channel", "text")} for m in thread],
        "now_kuwait": kuwait_now(now).strftime("%A %d %B %Y, %H:%M"),
        # Who the message is from: the lead's own rep, by first name, or nobody.
        "rep": (rep_name or "").split(" ")[0] or None,
        "rep_ar": (rep_ar or "").split(" ")[0] or None,
    }
    if due and due.get("start_at") and due.get("segment") in ("confirm", "no_show", "cancelled"):
        a = next((x for x in appts if _ts(x.get("start_at")) == _ts(due["start_at"])), {})
        ctx["the_call"] = {"type": a.get("call_type"), **call_words(_ts(due["start_at"]), now, lead.get("country"))}
    if due and due.get("segment") in ANGLES:
        ctx["message_number"] = f"{due.get('touch', 1)} of {due.get('of') or len(ANGLES[due['segment']])}"
    ctx["_thread"] = thread
    ctx["_thread_ok"] = thread_ok
    return ctx


def examples_block(approved: list[dict[str, Any]]) -> str:
    """Rep-approved messages of this kind, the edited ones first: what good looks like here."""
    if not approved:
        return ""
    lines = ["", "Messages reps approved before for this kind of lead (match their tone and length, not their facts):"]
    for a in approved[:5]:
        lines.append(f"- ({a.get('channel')}) {str(a.get('final_body') or a.get('body') or '')[:500]}")
    return "\n".join(lines)


def parse_draft(text: str, channel: str, language: Optional[str] = None) -> Optional[dict[str, Any]]:
    """The model's JSON, checked: a body, a subject for email, one sentence of
    why; a template's line flattened to one line in the template's language."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except ValueError:
        return None
    body = str(d.get("body") or "").strip()
    why = str(d.get("why") or "").strip()
    subject = str(d.get("subject") or "").strip() or None
    if channel == "whatsapp_template":
        body = re.sub(r"\s{2,}", " ", re.sub(r"[\r\n\t\u2028\u2029]+", " ", body)).strip()
        arabic = bool(re.search(r"[\u0600-\u06ff]", body))
        if len(body) > 700 or (language == "ar" and not arabic) or (language == "en" and arabic):
            return None
    if not body or not why or len(body) > (4000 if channel.startswith("whatsapp") else 8000):
        return None
    if channel == "email" and not subject:
        return None
    if re.search(r"\$\s*\d", body) and re.search(r"[\u0600-\u06ff]", body):
        return None  # a $ inside Arabic text flips; the rules say دولار
    return {"body": body, "subject": subject if channel == "email" else None, "why": why[:300],
            "language": "ar" if re.search(r"[\u0600-\u06ff]", body) else "en"}


def automation_message(thread: list[dict[str, Any]], ours: set[str]) -> Optional[datetime]:
    """When a HighLevel automation last messaged the lead (not a template the
    cockpit itself sent through a workflow)."""
    times = [_ts(m.get("at")) for m in thread
             if m.get("from") == "us" and m.get("source") == "workflow" and str(m.get("id")) not in ours]
    return max((t for t in times if t), default=None)


# ---------------------------------------------------------------------------
# After a send: did they write back, and did the workflow send the template
# ---------------------------------------------------------------------------

def track_replies(sb: Any, now: datetime) -> int:
    """Mark the follow-ups a lead wrote back to (the week after the send), so
    each kind's reply rate can be read beside the automation it replaces."""
    sent = sb.select("cockpit_sales_followups", "select=id,contact_id,decided_at&status=eq.sent&replied_at=is.null"
                                                f"&decided_at=gte.{_q((now - timedelta(days=7)).isoformat())}&limit=500")
    if not sent:
        return 0
    ids = sorted({str(f["contact_id"]) for f in sent})
    inbox: list[dict[str, Any]] = []
    for i in range(0, len(ids), 100):
        inbox += sb.select("cockpit_sales_inbox", "select=contact_id,last_message_at,last_direction,inbound_whatsapp_at"
                                                  f"&contact_id=in.({','.join(_q(x) for x in ids[i:i + 100])})")
    latest: dict[str, datetime] = {}
    for r in inbox:
        c = str(r.get("contact_id") or "")
        for t in (_ts(r.get("inbound_whatsapp_at")),
                  _ts(r.get("last_message_at")) if r.get("last_direction") == "inbound" else None):
            if t:
                latest[c] = max(latest.get(c, t), t)
    marked = 0
    for f in sent:
        t, at = latest.get(str(f["contact_id"])), _ts(f.get("decided_at"))
        if t and at and t > at:
            sb.rest("PATCH", f"cockpit_sales_followups?id=eq.{_q(str(f['id']))}", json_body={"replied_at": t.isoformat()},
                    prefer="return=minimal")
            marked += 1
    return marked


def expire_stale(sb: Any, now: datetime) -> int:
    """Drafts past their time (a WhatsApp window that closed, two days
    unanswered) are marked expired: the page already hides them, and while
    they stayed drafts they held the lead's one open draft, so the agent
    never wrote them a fresh one."""
    out = sb.rest("PATCH", f"cockpit_sales_followups?status=eq.draft&expires_at=lt.{_q(now.isoformat())}",
                  json_body={"status": "expired", "decided_at": now.isoformat(),
                             "error": "Went stale before anyone sent it."},
                  prefer="return=representation")
    return len(out) if isinstance(out, list) else 0


def reconcile_templates(sb: Any, token: str, now: datetime) -> dict[str, int]:
    """Template sends HighLevel took but had not shown yet: find the message
    in the conversation, or, after half an hour, say it never went."""
    rows = sb.select("cockpit_sales_messages", "select=id,contact_id,created_at&via=eq.workflow"
                                               f"&provider_status=eq.enrolled&created_at=gte.{_q((now - timedelta(hours=6)).isoformat())}"
                                               "&limit=50")
    found = gone = 0
    for r in rows:
        at = _ts(r.get("created_at"))
        try:
            thread = ghl_thread(token, str(r["contact_id"]))
        except Exception:  # noqa: BLE001 - try again next run
            continue
        hit = next((m for m in reversed(thread) if m.get("from") == "us" and m.get("channel") == "whatsapp"
                    and m.get("source") == "workflow" and _ts(m.get("at")) and _ts(m["at"]) >= at - timedelta(seconds=15)), None)
        if hit:
            status = str(hit.get("status") or "sent").lower()
            state = "failed" if status in ("failed", "undelivered") else "read" if status == "read" \
                else "delivered" if status == "delivered" else "sent"
            sb.rest("PATCH", f"cockpit_sales_messages?id=eq.{_q(str(r['id']))}", prefer="return=minimal", json_body={
                "state": state, "provider_status": status, "ghl_message_id": hit.get("id"),
                "error": "HighLevel marked it failed" if state == "failed" else None, "updated_at": now.isoformat()})
            found += 1
        elif now - at > timedelta(minutes=30):
            sb.rest("PATCH", f"cockpit_sales_messages?id=eq.{_q(str(r['id']))}", prefer="return=minimal", json_body={
                "state": "failed", "provider_status": "not sent",
                "error": ("The workflow did not send it within half an hour. In HighLevel, check the workflow is "
                          "published and allows re-entry."), "updated_at": now.isoformat()})
            gone += 1
    return {"found": found, "never_sent": gone}


# ---------------------------------------------------------------------------
# One pass
# ---------------------------------------------------------------------------

def _line_route(templates: list[dict[str, Any]], language: str, segment: str) -> Optional[dict[str, Any]]:
    """The active template that carries a written line, in this language, for this kind."""
    for t in sorted(templates, key=lambda t: int(t.get("sort") or 100)):
        if t.get("active") and t.get("workflow_id") and t.get("language") == language \
                and "line" in (t.get("variables") or []) and (not t.get("segments") or segment in t["segments"]):
            return t
    return None


def run(sb: Any, provider: Any, log: Callable[[str], None], *, settings: dict[str, Any], ghl_token: str,
        now: Optional[datetime] = None, autosend: Optional[Callable[[str], dict[str, Any]]] = None) -> dict[str, Any]:
    """One pass: pick the leads, write the drafts, put them in front of the reps."""
    now = now or datetime.now(timezone.utc)
    if not settings.get("enabled", True):
        return {"skipped": "the follow-up agent is switched off"}
    stale = expire_stale(sb, now)
    replied = track_replies(sb, now)
    reconciled = reconcile_templates(sb, ghl_token, now) if ghl_token else {"found": 0, "never_sent": 0}
    if quiet(now, settings.get("quiet") or {}):
        return {"skipped": "quiet hours"}
    today = (kuwait_now(now).replace(hour=0, minute=0, second=0, microsecond=0) - KUWAIT).isoformat()
    written_today = len(sb.select("cockpit_sales_followups", f"select=id&created_at=gte.{_q(today)}&limit=500"))
    room = min(int(settings.get("per_run", 12)), int(settings.get("per_day", 60)) - written_today)
    if room <= 0:
        return {"skipped": f"today's {settings.get('per_day', 60)} drafts are written"}

    week = (now - timedelta(days=7)).isoformat()
    inbox = sb.select("cockpit_sales_inbox", f"select=contact_id,last_message_at,last_direction,last_type,inbound_whatsapp_at"
                                             f"&last_message_at=gte.{_q((now - timedelta(days=2)).isoformat())}&limit=500")
    calendar = sb.select("cockpit_sales_calendar", "select=appointment_id,contact_id,call_type,start_at,booked_at,status"
                                                   f"&start_at=gte.{_q(week)}&start_at=lte.{_q((now + timedelta(days=21)).isoformat())}"
                                                   "&limit=2000")
    leads = sb.select("cockpit_sales_leads", "select=*&or=" + _q(f'(lead_created_at.gte."{week}",stage_name.ilike.*nurture*)')
                      + "&limit=3000")
    sends = sb.select("cockpit_sales_messages", "select=contact_id,created_at,state,via,ghl_message_id"
                                                f"&created_at=gte.{_q((now - timedelta(days=14)).isoformat())}&limit=3000")
    followups = sb.select("cockpit_sales_followups", "select=contact_id,segment,status,created_at,decided_at,appointment_id"
                                                     f"&created_at=gte.{_q((now - timedelta(days=30)).isoformat())}&limit=5000")
    open_drafts = {str(d["contact_id"]) for d in followups if d["status"] in ("draft", "sending")}
    deals = {str(d["contact_id"]) for d in sb.select("cockpit_sales_deals", f"select=contact_id&submitted_at=gte.{_q(week)}&limit=500")
             if d.get("contact_id")}
    reached = {str(d["contact_id"]) for d in sb.select(
        "cockpit_sales_dials", f"select=contact_id&state=eq.completed&occurred_at=gte.{_q(week)}&limit=3000")
        if d.get("contact_id")}
    confirmations = sb.select("cockpit_sales_confirmations", "select=appointment_id,result"
                                                             f"&start_at=gte.{_q((now - timedelta(hours=1)).isoformat())}&limit=2000")
    hot = {str(h["contact_id"]) for h in sb.select("cockpit_sales_hot", "select=contact_id&removed_at=is.null&limit=2000")}
    templates = sb.select("cockpit_sales_wa_templates", "select=*&active=eq.true")
    # When a lead was last touched: our sends, their conversation's last
    # message (the whole inbox copy, not only the last two days), or a call.
    last_touch: dict[str, str] = {}
    whole_inbox = sb.select("cockpit_sales_inbox", "select=contact_id,last_message_at&limit=1000")
    calls = sb.select("cockpit_sales_dials", "select=contact_id,occurred_at"
                                             f"&occurred_at=gte.{_q((now - timedelta(days=60)).isoformat())}&limit=5000")
    for s, col in [(x, "created_at") for x in sends] + [(x, "decided_at") for x in followups if x["status"] == "sent"] \
            + [(x, "last_message_at") for x in whole_inbox] + [(x, "occurred_at") for x in calls]:
        c = str(s.get("contact_id") or "")
        if c and s.get(col):
            last_touch[c] = max(last_touch.get(c, ""), str(s.get(col)))
    for lead in leads:
        lead["last_touch_at"] = last_touch.get(str(lead["contact_id"])) or None

    nurture_today = len(sb.select("cockpit_sales_followups",
                                  f"select=id&segment=eq.nurture&created_at=gte.{_q(today)}&limit=500"))
    nurture_room = max(0, int(settings.get("nurture_per_day", 20)) - nurture_today)
    picked = pick(now, inbox=inbox, calendar=calendar, leads=leads, followups=followups, sends=sends,
                  open_drafts=open_drafts, deals=deals, reached=reached, confirmations=confirmations, hot=hot,
                  cadence=settings.get("cadence"), nurture_every_days=int(settings.get("nurture_every_days", 7)),
                  nurture_room=nurture_room)
    by_id = {str(l["contact_id"]): l for l in leads}
    people = sb.select("cockpit_sales_people", "select=email,ghl_user_id,name_ar,active&active=eq.true&limit=200")
    seat_of = {str(p["ghl_user_id"]): str(p["email"]) for p in people if p.get("ghl_user_id")}
    arabic_name_of = {str(p["ghl_user_id"]): str(p.get("name_ar") or "") for p in people if p.get("ghl_user_id")}
    reps = sb.select("cockpit_sales_reps", "select=ghl_user_id,display_name&limit=200")
    rep_name_of = {str(r["ghl_user_id"]): str(r.get("display_name") or "") for r in reps if r.get("ghl_user_id")}
    ours_by_contact: dict[str, set[str]] = {}
    for s in sends:
        if s.get("via") == "workflow" and s.get("ghl_message_id"):
            ours_by_contact.setdefault(str(s["contact_id"]), set()).add(str(s["ghl_message_id"]))
    gap_hours = float(settings.get("automation_gap_hours", 20))
    fallback = settings.get("email_fallback") or {}

    dealt = {str(d["contact_id"]) for d in sb.select("cockpit_sales_deals", "select=contact_id&limit=2000")
             if d.get("contact_id")}
    written = no_channel = failed = sent_auto = not_leads = held = talking = unread = stopped = 0
    by_channel: dict[str, int] = {}
    for due in picked:
        if written >= room:
            break
        contact, segment = due["contact_id"], due["segment"]
        lead = by_id.get(contact) or next(iter(sb.select("cockpit_sales_leads", f"select=*&contact_id=eq.{_q(contact)}&limit=1")), None)
        if eligible(lead, dealt) or not lead or lead.get("dnd"):
            not_leads += 1
            continue
        try:
            owner = str(lead.get("assigned_to") or "")
            ctx = context_for(sb, lead, ghl_token, now, rep_name_of.get(owner), due, arabic_name_of.get(owner))
            thread = ctx.pop("_thread")
            if not ctx.pop("_thread_ok", True):
                unread += 1
                log(f"followups: {contact} waits: HighLevel's conversation could not be read")
                continue
            if asked_to_stop(thread):
                stopped += 1
                log(f"followups: {contact} asked not to be messaged; nothing written")
                continue
            # A HighLevel automation messaged them lately: wait, so nobody gets
            # both. A confirmation waits less, since the reminders are generic.
            auto_at = automation_message(thread, ours_by_contact.get(contact, set()))
            wait = timedelta(hours=4 if segment == "confirm" else gap_hours)
            if segment != "reply" and auto_at and now - auto_at < wait:
                held += 1
                continue
            # Someone wrote to them from HighLevel itself lately: they are in a conversation.
            by_hand = max((_ts(m.get("at")) for m in thread if m.get("from") == "us" and m.get("source") != "workflow"
                           and _ts(m.get("at"))), default=None)
            if segment != "reply" and by_hand and now - by_hand < GAP:
                talking += 1
                continue
            ins = [_ts(m["at"]) for m in thread if m["from"] == "lead" and m["channel"] == "whatsapp" and _ts(m.get("at"))]
            ins += [_ts(r.get("inbound_whatsapp_at")) for r in inbox
                    if str(r.get("contact_id")) == contact and _ts(r.get("inbound_whatsapp_at"))]
            last_wa_in = max((t for t in ins if t), default=None)
            language = language_for(lead, thread)
            route = None
            if not window_open(last_wa_in, now):
                route = _line_route(templates, language, segment)
                if route and not str((ghl_contact(ghl_token, contact) if ghl_token else {}).get("firstName") or "").strip():
                    route = None  # the template greets them by a first name HighLevel does not have
            channel = channel_for(lead, last_wa_in, now, template=route is not None,
                                  email_ok=fallback.get(segment, True) is not False)
            if not channel:
                no_channel += 1
                continue
            approved = sb.select("cockpit_sales_followups", f"select=channel,body,final_body,edited&segment=eq.{segment}"
                                                            f"&channel=eq.{channel}&status=eq.sent&order=edited.desc,decided_at.desc&limit=5")
            angles = ANGLES.get(segment) or []
            angle = f"This message's angle: {angles[min(due['touch'], len(angles)) - 1]}" if angles else ""
            rules = CHANNEL_RULES[channel].format(lang="Arabic" if language == "ar" else "English",
                                                  preview=(route or {}).get("preview", ""))
            system = SYSTEM.format(voice=VOICE, goal=GOAL[segment], angle=angle, channel=rules,
                                   examples=examples_block(approved))
            user = (f"Channel: {channel}\nWrite in: {'Arabic' if language == 'ar' else 'English'}\n\n"
                    "What we know about this lead:\n"
                    + json.dumps(ctx, ensure_ascii=False, indent=1, default=str)[:24000])
            draft = None
            for _ in range(2):
                reply = provider.complete(system, user, temperature=None, timeout=300)
                draft = parse_draft(reply.text, channel, language if channel == "whatsapp_template" else None)
                if draft:
                    break
            if not draft:
                raise ValueError("the model did not return a usable draft")
            owner_ghl = str(lead.get("assigned_to") or "") or None
            if channel == "whatsapp" and last_wa_in:
                expires = last_wa_in + timedelta(hours=24)
            elif segment == "confirm" and due.get("start_at"):
                expires = min(now + timedelta(hours=48), _ts(due["start_at"]) - timedelta(hours=1))
            else:
                expires = now + timedelta(hours=48)
            # A plain insert: the one-open-draft-per-lead index refuses a
            # second one if a rep's own run raced this one.
            made = sb.rest("POST", "cockpit_sales_followups", json_body=[{
                "contact_id": contact, "owner_ghl": owner_ghl, "owner_email": seat_of.get(owner_ghl or ""),
                "segment": segment, "channel": channel, "template_key": (route or {}).get("key") if channel == "whatsapp_template" else None,
                "touch": due["touch"], "heat": due["heat"], "appointment_id": due.get("appointment_id"),
                "subject": draft["subject"], "body": draft["body"], "why": draft["why"],
                "context": {k: ctx.get(k) for k in ("lead", "calls_on_the_calendar", "rep_notes", "the_call")} | {"heat": due["reasons"]},
                "model": getattr(provider, "model", None), "status": "draft", "expires_at": expires.isoformat(),
            }], prefer="return=representation")
            written += 1
            by_channel[channel] = by_channel.get(channel, 0) + 1
            log(f"followups: {segment} #{due['touch']} {channel} draft for {contact} (heat {due['heat']})")
            # Only a kind of message a manager has trusted goes without a person,
            # and it goes through the cockpit's own send with all its checks.
            new_id = str((made[0] if isinstance(made, list) and made else {}).get("id") or "")
            if autosend and new_id and (settings.get("autosend") or {}).get(segment) is True:
                try:
                    out = autosend(new_id)
                    if out.get("ok"):
                        sent_auto += 1
                    else:
                        log(f"followups: {contact} kept for a person: {str(out.get('error'))[:160]}")
                except Exception as e:  # noqa: BLE001 - the draft is still there for a person
                    log(f"followups: {contact} kept for a person: {http.scrub(str(e))[:160]}")
        except NotNow:
            raise
        except Exception as e:  # noqa: BLE001 - one lead is not worth the rest
            failed += 1
            log(f"followups: {contact} failed: {http.scrub(str(e))[:200]}")
    return {"picked": len(picked), "written": written, "by_channel": by_channel, "sent_by_itself": sent_auto,
            "held_for_automation": held, "in_a_conversation": talking, "asked_to_stop": stopped,
            "conversation_unreadable": unread, "no_open_channel": no_channel, "not_sales_leads": not_leads,
            "failed": failed, "room": room, "replies_marked": replied, "went_stale": stale,
            "templates": reconciled}
