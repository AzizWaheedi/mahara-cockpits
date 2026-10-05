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
  the last week, and booked nothing since;
- cancelled (1, then 2): cancelled an intro or demo, and booked nothing since;
- new (1, then 2): came in during the last eight days, never booked, never
  reached on a call;
- after_call (2): a demo held in the last four days (the B2B rule: showed,
  or still confirmed once it has started; never invalid), no deal;
- nurture (3): in a nurture stage, last touched a week ago or more.

A sixth kind, reactivate, is never picked here: backlog waves (waves.py)
draft it, the CEO's opener with no model text.

Each kind is a sequence, like the HighLevel automation it replaces: its
cadence (hours after the event) is in the settings, and each message has
its own angle, so a lead never reads the same message twice. A message sent
or skipped counts as that step done. Nobody gets two messages within 20
hours (a reply to them excepted), and a lead has one open draft at a time.
A missed or cancelled call's sequence ends once the lead books another
intro or demo and keeps it, whether it is still to come or already held;
and a draft whose reason has gone (they booked again, someone answered,
the call it confirms was cancelled or moved) is closed.

How: WhatsApp first. Inside the lead's 24-hour window, a free message.
Outside it, an approved template through its HighLevel workflow, carrying
one line written for this lead, when a manager has set one up. Email only
when neither can go and the kind allows it, and never on a channel the lead
closed with HighLevel's do-not-disturb. While a HighLevel automation has
messaged the lead recently, the agent waits, so nobody gets both: the
setting's 20 hours while the old sequence still runs, three when that kind
takes the lead out of it at the send.

The words follow Aziz's spoken-Gulf voice rules for Arabic, mirror the
lead's own language, never invent a number, price, result or promise, and
carry one next step. Edits reps made to earlier drafts are shown to the
model as what good looks like. Lead data goes to frontier models only, never
to DeepSeek.

A lead who asks to stop is never put on do-not-disturb by the agent (H4,
2026-10-03): an explicit unsubscribe ("stop", "remove me", «احذف رقمي»)
becomes a question for a rep, and every other stop word ("not interested",
«لا تتصل») pauses the agent for that lead for 30 days. The dialer keeps them.
"""
from __future__ import annotations

import copy
import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http
from .errors import NotNow

KUWAIT = timedelta(hours=3)
GHL = "https://services.leadconnectorhq.com"
LOCATION = "7NI8yyJtwsh2OOWA5Icr"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
SEGMENTS = ("reply", "confirm", "no_show", "cancelled", "new", "after_call", "nurture", "reactivate")
# The tag that makes a contact one the team tests with (--contact drafts for
# no one else). Test contacts carry no roas tag, so no test ever books.
TEST_TAG = "cockpit-test"
# The calendars each kind of call is booked on (the `calendars` setting):
# "Demo 2" is a copy of "Demo", and a call on it is a demo whatever its row's
# call_type says.
CALL_KINDS = {"dsqmJ393Dwl9fDSbIVOI": "intro", "cFeDl0FY8iaXll61lus8": "intro",
              "jQqXS1YuFnmGZKLkrE62": "demo", "NDBNz6Og4yfpdpWmHrue": "demo"}
# What the model is told about one lead, at most (characters of JSON), and
# the messages of their conversation that always stay in it.
BRIEF_LIMIT = 24_000
KEEP_MESSAGES = 20
# A first message of a sequence goes between these hours on the lead's own
# clock (followups.first_hours); later steps follow the quiet hours.
FIRST_HOURS = (9, 18)
# Days the agent leaves a lead alone after a stop word that is not an
# explicit unsubscribe (followups.stop_pause_days).
STOP_PAUSE_DAYS = 30

# Hours after the event for each message of a sequence (the settings' cadence
# overrides these). The first no-show message goes a quarter of an hour after
# the missed call; a cancellation's goes as soon as it is seen.
CADENCE = {"new": [0.5, 24, 48, 96, 168], "no_show": [0.25, 24, 72, 144], "cancelled": [0, 48, 120],
           "after_call": [24, 72]}
# How far back each kind's event may lie: its last step above plus a day, so
# the last message is still due when a run comes round. A week dropped the
# fifth new-lead message (due on day seven), and three days the third
# cancellation one after a call cancelled on the day (due five days on).
WINDOW_DAYS = {"new": 8, "no_show": 7, "cancelled": 6, "after_call": 4}


def window_days(segment: str, steps: Optional[list[float]] = None) -> int:
    """How far back a kind's event may lie: its own window, or longer when the
    settings' cadence for it runs longer (a last step plus a day), so a
    sequence lengthened in the settings is never cut short by the window."""
    base = WINDOW_DAYS.get(segment, 7)
    if not steps:
        return base
    return max(base, -(-int(max(float(x) for x in steps) + 24) // 24))
GAP = timedelta(hours=20)
# How long a completed dial keeps a new lead out of the "not booked" kind.
REACHED_FOR = timedelta(hours=24)
# After a HighLevel automation's message: the setting's hours (20) while the
# old sequence still runs; this when the kind takes the lead out of it at the
# send (the take-over switch), only so the two do not arrive back to back.
TAKEOVER_WAIT = timedelta(hours=3)
# A call that is no booking kept: cancelled, missed, or not a real booking.
NOT_KEPT = ("cancelled", "noshow", "invalid")
# Two failed drafts or sends for a lead within a day set it aside until that
# day has passed: each run would pay for the same failure again.
FAILED_TWICE = 2
# A send claimed longer than this is a send that died midway.
STUCK = timedelta(minutes=30)
# What a follow-up's message may say about itself, as sales-api's stateOf
# reads HighLevel's statuses: gone, or failed. Anything else is not settled.
GONE = ("sent", "delivered", "read")
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
# Of those, the ones that ask to stop being messaged at all: only these may
# end in do-not-disturb, and only once a rep confirms it. "Not interested",
# "don't call me now" or «لا تتصل الحين» are not a legal stop; they pause
# the agent instead (H4: automatic do-not-disturb also drops the lead from
# the dialer and blocks every send).
UNSUBSCRIBE = re.compile(
    r"\b(unsubscribe|remove me|remove my (number|details)|opt[ -]?out|stop (messaging|messages|texting|sending|"
    r"contacting|whatsapp)|don'?t (message|text|whatsapp|contact) me|do not (message|text|whatsapp|contact) me)\b"
    r"|لا ?(تراسل|ترسل|تتواصل)|لا عاد (تراسل|ترسل|تتواصل)|وقف(وا)? (الرسائل|الرسايل|المراسلة)"
    r"|(احذف|احذفوا|امسح|امسحوا|شيل|شيلوا) رقمي",
    re.I)
# "Stop" alone (or with a word of punctuation) is an explicit unsubscribe; a
# "stop" inside a sentence ("we stop work at 5") is only a pause.
BARE_STOP = re.compile(r"^\W*(stop|stop it|stop please|please stop|ستوب|توقف|وقف|وقفوا)\W*$", re.I)
# Words that make a name on file a company's, not a person's (found
# 2026-09-26: of 2,720 recent and nurture leads, 51 names were a company's
# and 86 carried digits). Arabic ones are matched without a leading ال, لل or و.
COMPANY_WORDS = {
    "company", "co", "est", "establishment", "trading", "llc", "wll", "group", "holding", "holdings", "corp",
    "corporation", "inc", "ltd", "limited", "contracting", "contractors", "construction", "constructions",
    "engineering", "engineers", "consultants", "consultancy", "consulting", "enterprises", "factory", "services",
    "solutions", "interiors", "designs", "studio", "agency", "office", "properties", "realestate",
    "شركة", "شركه", "مؤسسة", "مؤسسه", "مجموعة", "مجموعه", "مكتب", "مصنع", "تجارة", "تجاره", "تجارية",
    "مقاولات", "قابضة", "هندسة", "هندسية", "ذمم",
}

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
    # Never sent to a model: the opener is the CEO's own words (waves.py).
    "reactivate": "A lead from the backlog. The CEO's opener only; their answer opens the window for a written reply.",
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


_TIME = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$")


def _ts(v: Any) -> Optional[datetime]:
    """A database time, whatever form PostgREST gives it: Postgres trims a
    fraction's trailing zeros ('...:00.12+00:00'), which Python 3.9's
    fromisoformat refuses for 1, 2, 4 or 5 digits, and may answer '+03',
    '+0300' or a space for the T. Every one of them reads; nothing else does."""
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    m = _TIME.match(str(v).strip())
    if not m:
        return None
    day, clock, frac, zone = m.groups()
    clock = clock or "00:00:00"
    if len(clock) == 5:
        clock += ":00"
    frac = ((frac or "") + "000000")[:6]
    if not zone or zone in ("Z", "z"):
        zone = "+00:00"
    elif len(zone) == 3:
        zone += ":00"
    elif ":" not in zone:
        zone = zone[:3] + ":" + zone[3:]
    try:
        t = datetime.fromisoformat(f"{day}T{clock}.{frac}{zone}")
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Calls, read by the B2B rule
# ---------------------------------------------------------------------------

def shown(call: dict[str, Any], now: datetime) -> bool:
    """Whether a call was held, by the B2B cockpit's rule (b2b_window_metrics):
    marked showed, or still confirmed once it has started. B2B counts invalid
    as shown as well; the agent never does, because a disqualified intro is
    written as invalid (sales-api dialer.ts) and is no lead to follow up.
    Found 2026-10-03: after_call asked for showed alone, and no demo in the
    last 30 days had been marked, so it never wrote a message."""
    start = _ts(call.get("start_at"))
    status = str(call.get("status") or "").lower()
    return bool(start and start <= now and status in ("showed", "confirmed"))


def with_kinds(calendar: list[dict[str, Any]], calendars: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    """The calendar copy with each call's kind filled in from its calendar
    when the row does not say (a call on "Demo 2" is a demo). `calendars` is
    the cockpit's setting of that name, {calendar_id: {"type": ...}}."""
    kinds = dict(CALL_KINDS)
    for cid, v in (calendars or {}).items():
        if isinstance(v, dict) and v.get("type"):
            kinds[str(cid)] = str(v["type"])
    out = []
    for a in calendar:
        kind = kinds.get(str(a.get("calendar_id") or ""))
        if a.get("call_type") not in ("intro", "demo") and kind in ("intro", "demo"):
            a = {**a, "call_type": kind}
        out.append(a)
    return out


def in_hours(now: datetime, country: Any, hours: Any = FIRST_HOURS, *, first: bool = True) -> bool:
    """Whether it is between the hours given (from, to) on the lead's own
    clock, in every zone of a country that spans several. A first message to
    a lead whose zone is not known (or whose clock this machine cannot read:
    no time zone database) never goes by itself (a person sends it); a later
    one keeps to Kuwait's clock."""
    try:
        a, b = int(hours[0]), int(hours[1])
    except (TypeError, ValueError, IndexError):
        a, b = FIRST_HOURS
    zones = lead_zones(country)
    offsets = [_zone_offset(z, now) for z in zones] if zones is not None else [None]
    if any(o is None for o in offsets):
        if first:
            return False
        offsets = [KUWAIT]
    return all(a <= (now + o).hour < b for o in offsets)


# The zones whose weekend includes Friday: quiet_days are read there as
# written (sales-api sendrules.ts FRIDAY_WEEKEND_ZONES, the same list). Not
# the UAE (Asia/Dubai): Saturday and Sunday since 2022 (stress2 round 3).
FRIDAY_WEEKEND_ZONES = frozenset({
    "Asia/Kuwait", "Asia/Riyadh", "Asia/Qatar", "Asia/Bahrain", "Asia/Muscat", "Asia/Baghdad", "Asia/Amman",
    "Asia/Damascus", "Asia/Aden", "Asia/Gaza", "Asia/Jerusalem", "Asia/Tehran", "Asia/Kabul", "Asia/Dhaka",
    "Africa/Cairo", "Africa/Tripoli", "Africa/Algiers", "Africa/Khartoum",
})


def lead_days_off(now: datetime, country: Any, days_off: Any) -> set[str]:
    """The lead's days off it is now, on their own clock, one per zone (fix
    round 4): quiet_days as written where the weekend includes Friday;
    elsewhere Friday is a working day and their Saturday and Sunday are off."""
    off = {str(d).lower() for d in (days_off or [])}
    zones = lead_zones(country) or LEAD_ZONES["kw"]
    out = set()
    for z in zones:
        o = _zone_offset(z, now)
        day = (now + (o if o is not None else KUWAIT)).strftime("%A").lower()
        mine = off if (z in FRIDAY_WEEKEND_ZONES or "friday" not in off) else (off - {"friday"}) | {"saturday", "sunday"}
        if day in mine:
            out.add(day)
    return out


def lead_days(now: datetime, country: Any) -> set[str]:
    """The weekday names (lower case) on the lead's clock now, one per zone."""
    zones = lead_zones(country) or LEAD_ZONES["kw"]
    out = set()
    for z in zones:
        off = _zone_offset(z, now)
        out.add((now + (off if off is not None else KUWAIT)).strftime("%A").lower())
    return out


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


def confirm_from(start: datetime, country: Any = None) -> datetime:
    """When a call booked more than a day ahead is confirmed: 18:00 the evening
    before a call that starts before noon (Kuwait), otherwise 09:00 that day
    (the dialer's rule, the call centre's too).

    A lead outside the Gulf is confirmed on their own clock: the same rule
    there, and when no moment between it and the call is 09:00 to 21:00 in
    every zone of their country (a 09:00 call in New York is 06:00 in Los
    Angeles), from the start of the last stretch of the day before that is."""
    k = start + KUWAIT
    if k.hour < 12:
        at = (k - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
    else:
        at = k.replace(hour=9, minute=0, second=0, microsecond=0)
    kuwait_rule = at - KUWAIT
    zones = lead_zones(country)
    if not zones or all(z in _FIXED_HOURS for z in zones):
        return kuwait_rule
    off = _zone_offset(zones[0], start)
    if off is None:
        return kuwait_rule
    local = start + off
    if local.hour < 12:
        at = (local - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0) - off
    else:
        at = local.replace(hour=9, minute=0, second=0, microsecond=0) - off
    step = timedelta(minutes=15)
    t = at
    while t < start - timedelta(minutes=30):
        if in_hours(t, country, CONFIRM_HOURS, first=False):
            return at
        t += step
    # The last moment before the call that is daytime in every zone, then back
    # to where that stretch began.
    t = start - timedelta(minutes=30)
    while t > start - timedelta(hours=48) and not in_hours(t, country, CONFIRM_HOURS, first=False):
        t -= step
    if not in_hours(t, country, CONFIRM_HOURS, first=False):
        return at
    while in_hours(t - step, country, CONFIRM_HOURS, first=False) and t - step > start - timedelta(hours=48):
        t -= step
    return t


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------

def window_open(last_inbound_wa: Optional[datetime], now: datetime) -> bool:
    return bool(last_inbound_wa and now - last_inbound_wa < timedelta(hours=23))


def _email(channel: Any) -> bool:
    return "email" in str(channel or "").lower()


def last_inbound(rows: list[dict[str, Any]]) -> tuple[Optional[datetime], str]:
    """When the lead last wrote, across their conversations in the inbox copy,
    and on what: a conversation's last WhatsApp from them, or its last
    message when that was theirs (whatever came after it from our side)."""
    best: tuple[Optional[datetime], str] = (None, "")
    for r in rows:
        for t, ch in ((_ts(r.get("inbound_whatsapp_at")), "whatsapp"),
                      (_ts(r.get("last_message_at")) if r.get("last_direction") == "inbound" else None,
                       str(r.get("last_type") or ""))):
            if t and (best[0] is None or t > best[0]):
                best = (t, ch)
    return best


def answers(channel: Any, their_channel: Any) -> bool:
    """Whether a message of ours on `channel` answers a lead who wrote on
    `their_channel`: an email answers only an email (a newsletter or an
    automation's email to a lead who asked on WhatsApp answers nothing)."""
    return not _email(channel) or _email(their_channel)


def reply_answered(thread: list[dict[str, Any]], inbox: list[dict[str, Any]], sends: list[dict[str, Any]],
                   ours: set[str]) -> bool:
    """Whether a person answered the lead after they last wrote: a message of
    ours after theirs that a person sent (not a HighLevel automation's, unless
    it is a template the cockpit itself sent through a workflow) on a channel
    that answers theirs. Found 2026-10-03: a reply was missed whenever the
    conversation's last message was ours, an automation's email included."""
    theirs = [(_ts(m.get("at")), str(m.get("channel") or "")) for m in thread if m.get("from") == "lead"]
    t_in, ch_in = last_inbound(inbox)
    if t_in:
        theirs.append((t_in, ch_in))
    theirs = [x for x in theirs if x[0]]
    if not theirs:
        return False
    last_t, their_ch = max(theirs, key=lambda x: x[0])
    for m in thread:
        at = _ts(m.get("at"))
        if m.get("from") != "us" or not at or at <= last_t:
            continue
        if m.get("source") == "workflow" and str(m.get("id")) not in ours:
            continue  # an automation's message, not an answer
        if answers(m.get("channel"), their_ch):
            return True
    return any(s.get("state") != "failed" and _ts(s.get("created_at")) and _ts(s["created_at"]) > last_t
               and answers(s.get("channel"), their_ch) for s in sends)


def blocked_channels(contact: dict[str, Any]) -> set[str]:
    """The channels HighLevel's do-not-disturb closes for this contact: every
    one when its own switch is on, else each whose setting is active, for
    example {"WhatsApp": {"status": "active"}}. The lead copy holds only the
    one switch (93 leads had WhatsApp or email closed with it off, 2026-09-26),
    so this is read from the contact itself."""
    if contact.get("dnd") is True:
        return {"whatsapp", "email"}
    ours = {"whatsapp": "whatsapp", "email": "email"}
    return {ours[str(k).lower()] for k, v in (contact.get("dndSettings") or {}).items()
            if str(k).lower() in ours and isinstance(v, dict)
            and str(v.get("status") or "").lower() in ("active", "permanent")}


def channel_for(lead: dict[str, Any], last_inbound_wa: Optional[datetime], now: datetime, *,
                template: bool = False, email_ok: bool = True, blocked: set[str] = frozenset()) -> Optional[str]:
    """WhatsApp inside the 24-hour window; else an approved WhatsApp template
    when one is set up and the lead can be greeted by name; else email if the
    kind allows it and there is an address; else nothing. A channel the lead
    closed with do-not-disturb (`blocked`) is skipped, and only that one."""
    if lead.get("dnd"):
        return None
    whatsapp = "whatsapp" not in blocked
    if whatsapp and window_open(last_inbound_wa, now):
        return "whatsapp"
    if whatsapp and template and str(lead.get("phone") or "").strip():
        return "whatsapp_template"
    if email_ok and "email" not in blocked and str(lead.get("email") or "").strip():
        return "email"
    return None


def person_name(name: Any) -> Optional[str]:
    """The first name to greet a lead by, or None when the name on file is not
    a person's: empty, a first name with digits in it ("Ahmed123"), or a
    company's ("Al Noor Trading Est", "مؤسسة النور")."""
    words = [w for w in re.split(r"[\s,()/&|_+\-]+", str(name or "").strip()) if w]
    if not words or re.search(r"\d", words[0]):
        return None
    for w in words:
        k = w.lower().replace(".", "")
        if k in COMPANY_WORDS or re.sub(r"^(وال|بال|لل|ال|و)", "", k) in COMPANY_WORDS:
            return None
    return words[0]


def language_for(lead: dict[str, Any], thread: list[dict[str, Any]]) -> str:
    """The language to write in: the lead's latest message with words in it
    decides (one Arabic message long ago, such as an ad's pre-filled text,
    no longer holds once they write in English), then their name, then
    where they are (the Gulf writes Arabic)."""
    for m in reversed(thread):
        text = str(m.get("text") or "") if m.get("from") == "lead" else ""
        if re.search(r"[\u0600-\u06ff]", text):
            return "ar"
        if re.search(r"[A-Za-z]", text):
            return "en"
    if re.search(r"[\u0600-\u06ff]", str(lead.get("name") or "")):
        return "ar"
    country = str(lead.get("country") or "").strip().lower()
    if not country or country in ARABIC_COUNTRIES or any(g in country for g in GULF):
        return "ar"
    return "en"


CLIENT_CLOSED = "An active client (tagged client in HighLevel): kept out of sales follow-ups."


def is_client(lead: Optional[dict[str, Any]]) -> bool:
    """Tagged client in HighLevel: an active client (Aziz, 2026-09-27: "They
    shouldn't be in any sales process"). The same test as sales-api
    clients.ts."""
    tags = (lead or {}).get("tags")
    return isinstance(tags, list) and any(str(t).strip().lower() == "client" for t in tags)


def eligible(lead: Optional[dict[str, Any]], dealt: set[str]) -> Optional[str]:
    """Why this contact is not the follow-up agent's to write to, or None.

    Only sales leads: in a sales pipeline or carrying a lead tag, and not a
    client. Found 2026-09-24: an existing client's contract email sat in the
    sales inbox and was drafted a sales pitch. Found 2026-09-27: 65 contacts
    tagged client sat open in a sales pipeline, two with drafts waiting."""
    if not lead:
        return "not in the cockpit's lead copy"
    c = str(lead.get("contact_id") or "")
    if is_client(lead):
        return "a client"
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

def booked_again(event: dict[str, Any], calls: list[dict[str, Any]], now: datetime) -> bool:
    """Whether the lead booked another intro or demo after this missed or
    cancelled one and kept it (not cancelled, missed or invalid): one still
    to come, one that starts later, or one booked later (a cancelled call
    moved earlier). Held already or not, they booked again, so the event's
    sequence is over. Checked 2026-09-26: a lead who missed Monday's call and
    showed on Wednesday would have been asked on Thursday whether they still
    wanted the call."""
    aid = str(event.get("appointment_id") or "")
    start, booked = _ts(event.get("start_at")), _ts(event.get("booked_at"))
    for x in calls:
        if x is event or (aid and str(x.get("appointment_id") or "") == aid) or x.get("status") in NOT_KEPT:
            continue
        if x.get("call_type") not in ("intro", "demo"):
            continue
        xs, xb = _ts(x.get("start_at")), _ts(x.get("booked_at"))
        if (xs and xs > now) or (xs and start and xs > start) or (xb and booked and xb > booked):
            return True
    return False


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
    # A lead who wrote is a reply candidate, but the run may find a person
    # answered them already (in the HighLevel app, say). Their other due kind
    # then still goes, so a reply candidate never takes the lead's one place:
    # it carries the next kind with it ("then"). Found 2026-10-03: a no-show
    # who wrote "stuck in traffic" and was answered lost the no-show step for
    # two days.
    replies: dict[str, dict[str, Any]] = {}

    def add(c: str, seg: str, touch: int, tier: int, *, appointment_id: Optional[str] = None,
            start_at: Optional[datetime] = None, due_at: Optional[datetime] = None) -> bool:
        if not c or c in open_drafts or (c in replies if seg == "reply" else c in seen):
            return False
        if seg != "reply" and c in last_sent and now - last_sent[c] < GAP:
            return False
        score, reasons = heat(by_lead.get(c) or {}, now, hot=c in hot, inbound_at=inbound.get(c))
        entry = {"contact_id": c, "segment": seg, "touch": touch, "of": len(steps_of.get(seg) or [1]),
                 "tier": tier, "heat": score, "reasons": reasons, "appointment_id": appointment_id,
                 "start_at": start_at.isoformat() if start_at else None,
                 "due_at": (due_at or now).isoformat()}
        if seg == "reply":
            replies[c] = entry
        else:
            seen.add(c)
            out.append(entry)
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

    # They wrote in the last two days and the cockpit has not answered. The
    # conversation's own last message may be ours and still no answer (an
    # automation's, an email to a WhatsApp question): the run reads the
    # conversation and tells a person's answer apart.
    rows_of: dict[str, list[dict[str, Any]]] = {}
    for r in inbox:
        rows_of.setdefault(str(r.get("contact_id") or ""), []).append(r)
    wrote = {c: last_inbound(rs) for c, rs in rows_of.items() if c}
    for c, (t, ch) in sorted(((c, w) for c, w in wrote.items() if w[0]), key=lambda x: x[1][0], reverse=True):
        if now - t >= timedelta(hours=48):
            continue
        if any(str(s.get("contact_id") or "") == c and s.get("state") != "failed" and _ts(s.get("created_at"))
               and _ts(s["created_at"]) > t and answers(s.get("channel"), ch) for s in sends):
            continue
        add(c, "reply", 1, 0)

    live = ("cancelled", "noshow", "invalid", "showed")
    calls = [a for a in with_kinds(calendar) if a.get("call_type") in ("intro", "demo") and _ts(a.get("start_at"))]
    calls_of: dict[str, list[dict[str, Any]]] = {}
    for a in calls:
        calls_of.setdefault(str(a.get("contact_id") or ""), []).append(a)
    confirmed = {str(x.get("appointment_id")) for x in confirmations
                 if x.get("result") in ("confirmed", "message_sent", "reschedule", "cancelled")}

    # A call booked more than a day ahead, due for its confirmation.
    for a in sorted(calls, key=lambda a: str(a.get("start_at"))):
        c, start, booked = str(a.get("contact_id") or ""), _ts(a.get("start_at")), _ts(a.get("booked_at"))
        aid = str(a.get("appointment_id") or "")
        if a.get("status") in live or not booked or not aid or start <= now or start - now > timedelta(hours=36):
            continue
        if start - booked < timedelta(hours=24) or now < confirm_from(start, (by_lead.get(c) or {}).get("country")):
            continue
        if aid in confirmed or aid in drafted_appts or (inbound.get(c) and inbound[c] > booked):
            continue
        add(c, "confirm", 1, 0 if start - now <= timedelta(hours=3) else 1, appointment_id=aid, start_at=start)

    # Missed or cancelled, and nothing booked since.
    for seg, status in (("no_show", "noshow"), ("cancelled", "cancelled")):
        latest: dict[str, dict[str, Any]] = {}
        lo = now - timedelta(days=window_days(seg, steps_of.get(seg)))
        hi = now if seg == "no_show" else now + timedelta(days=21)
        for a in calls:
            if a.get("status") != status:
                continue
            c, t = str(a.get("contact_id") or ""), _ts(a.get("start_at"))
            if c and lo <= t <= hi and (c not in latest or _ts(latest[c].get("start_at")) < t):
                latest[c] = a
        for c, a in latest.items():
            start = _ts(a.get("start_at"))
            if booked_again(a, calls_of.get(c, []), now):
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
        if not created or now - created > timedelta(days=window_days("new", steps_of.get("new"))) \
                or c in ever_booked or c in reached:
            continue
        if lead.get("lead_class") not in ("qualified", "unqualified") and not lead.get("pipeline_id"):
            continue
        nxt = step(c, "new", created, created + timedelta(hours=(steps_of.get("new") or [0])[0]))
        if nxt:
            add(c, "new", nxt[0], 1 if nxt[0] == 1 else 2, due_at=nxt[1])

    # A demo held (the B2B rule: showed, or confirmed once started; never
    # invalid) and no deal since. An unmarked demo waits the first step's day,
    # in which a no-show mark moves the lead to the no-show sequence instead.
    after_days = window_days("after_call", steps_of.get("after_call"))
    for a in sorted(calls, key=lambda a: str(a.get("start_at")), reverse=True):
        c, start = str(a.get("contact_id") or ""), _ts(a.get("start_at"))
        if a.get("call_type") != "demo" or not shown(a, now) or c in deals:
            continue
        if not (now - timedelta(days=after_days) <= start <= now):
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

    for c, r in replies.items():
        other = next((d for d in out if d["contact_id"] == c), None)
        if other is not None:
            out.remove(other)
            r["then"] = other
        out.append(r)
    out.sort(key=lambda d: (d["tier"], -d["heat"], d["due_at"]))
    return out


# ---------------------------------------------------------------------------
# What the agent is told about one lead
# ---------------------------------------------------------------------------

def _q(v: str) -> str:
    return http.quote(v)


def _ghl_headers(token: str, version: str = "2021-04-15") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Version": version, "Accept": "application/json", "User-Agent": UA}


def _conversations(token: str, contact_id: str) -> tuple[dict[str, str], list[dict[str, Any]]]:
    h = _ghl_headers(token)
    _, _, raw = http.request("GET", f"{GHL}/conversations/search?locationId={LOCATION}&contactId={_q(contact_id)}&limit=10",
                             headers=h, timeout=30, retries=1)
    return h, (json.loads(raw.decode("utf-8") or "{}").get("conversations") or [])[:4]


def _message_page(h: dict[str, str], conversation: str, limit: int,
                  cursor: Optional[str] = None) -> tuple[list[dict[str, Any]], bool, Optional[str]]:
    """One page of a conversation as HighLevel serves it: newest first,
    `limit` a page, `nextPage` and `lastMessageId` for the older ones."""
    q = f"limit={limit}" + (f"&lastMessageId={_q(cursor)}" if cursor else "")
    _, _, raw = http.request("GET", f"{GHL}/conversations/{_q(conversation)}/messages?{q}",
                             headers=h, timeout=30, retries=1)
    d = json.loads(raw.decode("utf-8") or "{}")
    inner = d.get("messages") or {}
    items = list((inner.get("messages") if isinstance(inner, dict) else inner) or [])
    more = bool(inner.get("nextPage")) if isinstance(inner, dict) else False
    last = (inner.get("lastMessageId") if isinstance(inner, dict) else None) or None
    return items, more, (str(last) if last else None)


# A lead's message with no words of its own (a voice note, a picture, a
# document) is still the lead writing (stress2, round 2): kept in the thread
# with a placeholder, so "they wrote to us lately" sees it.
_CHAT_TYPES = ("TYPE_WHATSAPP", "TYPE_SMS", "TYPE_FACEBOOK", "TYPE_INSTAGRAM", "TYPE_LIVE_CHAT", "TYPE_WEBCHAT")


def _placeholder(m: dict[str, Any]) -> str:
    kind = str(m.get("contentType") or "").lower()
    files = m.get("attachments") if isinstance(m.get("attachments"), list) else []
    if kind.startswith("audio") or any(str(a).lower().split("?")[0].endswith((".ogg", ".opus", ".mp3", ".m4a", ".aac"))
                                       for a in files):
        return "[a voice note]"
    if kind.startswith("image"):
        return "[a picture]"
    if kind.startswith("video"):
        return "[a video]"
    return "[an attachment]" if files else "[a message with no text]"


def _as_message(m: dict[str, Any]) -> Optional[dict[str, Any]]:
    body = str(m.get("body") or "").strip()
    inbound = m.get("direction") == "inbound"
    if not body and inbound:
        files = m.get("attachments") if isinstance(m.get("attachments"), list) else []
        if files or str(m.get("messageType") or "") in _CHAT_TYPES:
            body = _placeholder(m)
    if not (body or m.get("direction") == "outbound"):
        return None
    return {"id": m.get("id"), "at": m.get("dateAdded"),
            "from": "lead" if inbound else "us",
            "channel": str(m.get("messageType") or "").replace("TYPE_", "").lower(),
            "source": m.get("source"), "status": m.get("status"), "text": body[:600]}


def ghl_thread(token: str, contact_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """The lead's last messages across their HighLevel conversations, oldest
    first: one page of each. Never the place to look for a stop (a lead's
    words can sit behind a page of automations): that is ghl_history."""
    if not token:
        return []
    h, convs = _conversations(token, contact_id)
    msgs: list[dict[str, Any]] = []
    for c in convs:
        items, _more, _last = _message_page(h, str(c["id"]), limit)
        msgs += [x for x in (_as_message(m) for m in items) if x]
    msgs.sort(key=lambda m: str(m.get("at") or ""))
    return msgs[-limit:]


# How far back a lead's conversation is read for their own last words:
# HISTORY_PAGES pages of HISTORY_PAGE messages in each conversation.
HISTORY_PAGE = 50
HISTORY_PAGES = 6


def ghl_history(token: str, contact_id: str, *, page: int = HISTORY_PAGE,
                pages: int = HISTORY_PAGES) -> tuple[list[dict[str, Any]], bool]:
    """The lead's messages across their HighLevel conversations, oldest first,
    each conversation read back page by page (HighLevel's cursor) until the
    lead's own latest words are in it or the conversation ends (stress2,
    round 1: a STOP behind a page of automated emails was never read, and the
    lead was written the opener). Answers (messages, whole): whole is False
    when a conversation still had older pages after `pages` and none of the
    lead's words were seen, so a stop could be hidden in it; a caller then
    writes nothing to the lead."""
    if not token:
        return [], True
    h, convs = _conversations(token, contact_id)
    msgs: list[dict[str, Any]] = []
    whole = True
    for c in convs:
        seen: set[str] = set()
        cursor: Optional[str] = None
        for _ in range(max(1, pages)):
            items, more, last = _message_page(h, str(c["id"]), page, cursor)
            fresh = [m for m in items if not m.get("id") or str(m["id"]) not in seen]
            seen |= {str(m["id"]) for m in fresh if m.get("id")}
            msgs += [x for x in (_as_message(m) for m in fresh) if x]
            if any(m.get("direction") == "inbound" and str(m.get("body") or "").strip() for m in fresh) or not more:
                break
            cursor = last or next((str(m["id"]) for m in reversed(items) if m.get("id")), None)
            if not fresh or not cursor:
                whole = False
                break
        else:
            whole = False
    msgs.sort(key=lambda m: str(m.get("at") or ""))
    return msgs, whole


def ghl_probe(token: str) -> int:
    """One read of the sales sub-account's conversations, for the doctor: the agent's key still works."""
    _, _, raw = http.request("GET", f"{GHL}/conversations/search?locationId={LOCATION}&limit=1",
                             headers=_ghl_headers(token), timeout=30, retries=1)
    return len(json.loads(raw.decode("utf-8") or "{}").get("conversations") or [])


def ghl_contact(token: str, contact_id: str) -> dict[str, Any]:
    """The contact as HighLevel holds it: the first name a template greets,
    and the channels its do-not-disturb closes."""
    if not token:
        return {}
    _, _, raw = http.request("GET", f"{GHL}/contacts/{_q(contact_id)}", headers=_ghl_headers(token, "2021-07-28"),
                             timeout=30, retries=1)
    return json.loads(raw.decode("utf-8") or "{}").get("contact") or {}


def ghl_message(token: str, message_id: str) -> dict[str, Any]:
    """One message as HighLevel holds it now, with its status: HighLevel
    takes a WhatsApp message as pending, and Meta decides after."""
    _, _, raw = http.request("GET", f"{GHL}/conversations/messages/{_q(message_id)}", headers=_ghl_headers(token),
                             timeout=30, retries=1)
    d = json.loads(raw.decode("utf-8") or "{}")
    return (d.get("message") if isinstance(d.get("message"), dict) else d) or {}


def state_of(status: Any) -> str:
    """A message's state from HighLevel's status, read the way sales-api's stateOf reads it."""
    s = str(status or "").lower()
    if s in ("failed", "undelivered", "opt_out"):
        return "failed"
    if s in ("read", "opened", "clicked"):
        return "read"
    if s == "delivered":
        return "delivered"
    if s in ("sent", "connected"):
        return "sent"
    return "sending"


def _chunks(items: list[str], n: int = 100) -> list[list[str]]:
    return [items[i:i + n] for i in range(0, len(items), n)]


def _in(ids: list[str]) -> str:
    return f"in.({','.join(_q(x) for x in ids)})"


ROOMS = "cockpit_sales_rooms"
LIVE_CALENDAR = "live"


def live_calls(sb: Any, contacts: Optional[list[str]] = None, *, since: Optional[datetime] = None,
               until: Optional[datetime] = None, reached: bool = True) -> list[dict[str, Any]]:
    """The live calls the count booked or moved when a lead joined a video
    room (rooms.ts runCount, D2), as calendar rows: held ("showed") calls of
    the room's kind at the minute the lead joined. They are on
    rooms.live_calendar_id, which D25 keeps out of B2B's map, so the
    cockpit's calendar copy never has them; the room is their only record.
    A count taken back (count_undo_at) is no call. `since` and `until`
    bound the join time.

    `reached` (the default, for what to write to a lead): also the joins that
    stand and are not booked (stress2, round 2): a join only a hand press
    reported, waiting for a manager's confirm (count_result self_reported),
    and the count's mark of the lead's own call (count_result null with the
    call's id). The lead talked to a rep on video, so no "we missed you" and
    no never-booked opener goes to them. Booking counts (a wave's outcomes)
    pass reached=False: an unconfirmed join is no booking yet. And a join
    that stands with nothing counted at all (stress2 round 4, count-off-
    video-join-invisible-to-desk): rooms.count_on_join off, as it ships, or
    a count still running; the room is the call's only record then."""
    cols = "select=id,contact_id,call_kind,lead_in_at,count_result,count_appointment_id,count_undo_at,taken_back_join_at"
    bound = ""
    if since:
        bound += f"&lead_in_at=gte.{_q(since.isoformat())}"
    if until:
        bound += f"&lead_in_at=lte.{_q(until.isoformat())}"
    queries = [(f"{cols}&lead_in_at=not.is.null&count_result=in.(booked,moved)&count_appointment_id=not.is.null"
                f"&count_undo_at=is.null{bound}", False)]
    if reached:
        # A join whose count could not book (failed: HighLevel refused it, the
        # seat has no HighLevel user, another rep's call; unclear: its answer
        # was lost) is still a call the lead had (stress2 round 5,
        # failed-count-join-invisible-to-desk). It is no booking, so outcomes
        # (reached=False) never counts it.
        queries += [(f"{cols}&lead_in_at=not.is.null&count_result=in.(self_reported,failed,unclear){bound}", True),
                    (f"{cols}&lead_in_at=not.is.null&count_result=is.null&count_appointment_id=not.is.null{bound}", True),
                    (f"{cols}&lead_in_at=not.is.null&count_result=is.null&count_appointment_id=is.null{bound}", True)]
    rows: list[tuple[dict[str, Any], bool]] = []
    for q, uncounted in queries:
        if contacts is None:
            rows += [(r, uncounted) for r in sb.select_all(ROOMS, q, order="id")]
        else:
            for chunk in _chunks(sorted({str(c) for c in contacts if c})):
                rows += [(r, uncounted) for r in sb.select_all(ROOMS, f"{q}&contact_id={_in(chunk)}", order="id")]
    out = []
    for r, uncounted in rows:
        kind = str(r.get("call_kind") or "")
        if kind not in ("intro", "demo") or not r.get("contact_id"):
            continue
        if uncounted:
            # The join stands only when "That was not the lead" did not take it
            # back: after the taken-back join's own time (20261004a), else the press.
            joined, undo = _ts(r.get("lead_in_at")), _ts(r.get("count_undo_at"))
            taken = _ts(r.get("taken_back_join_at"))
            bound = None if undo is None else (min(taken, undo) if taken is not None else undo)
            if joined is None or (bound is not None and joined <= bound):
                continue
        appt = str(r.get("count_appointment_id") or "") or f"room:{r.get('id')}"
        out.append({"appointment_id": appt, "contact_id": str(r["contact_id"]),
                    "calendar_id": LIVE_CALENDAR, "call_type": kind, "start_at": r.get("lead_in_at"),
                    "booked_at": r.get("lead_in_at"), "status": "showed", "live": True,
                    # A call the count moved to the join was booked at its own
                    # time: its own calendar row says when (stress2 round 3).
                    **({"moved": True} if r.get("count_result") == "moved" else {}),
                    **({"uncounted": True} if uncounted else {})})
    return out


def with_live(calendar: list[dict[str, Any]], live: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The calendar copy and the live calls together; a moved call the copy
    already holds (the same appointment id) is kept once, as the copy has it.
    A live booking's own copy (rooms.ts copyLiveBooking, on the live calendar)
    keeps the live mark, so it reads as the live call it is (stress2 round 5)."""
    seen = {str(a.get("appointment_id")) for a in calendar}
    booked_live = {str(a.get("appointment_id")) for a in live if not a.get("moved")}
    marked = [({**a, "live": True} if str(a.get("appointment_id")) in booked_live and not a.get("live") else a)
              for a in calendar]
    return marked + [a for a in live if str(a.get("appointment_id")) not in seen]


# The lead's time zone by the ISO country code the lead copy keeps (about 250
# leads are outside the Gulf). A country that spans zones lists its first and
# last: a first message goes only in hours that are daytime in both. The same
# table as sales-api (sendrules.ts LEAD_ZONES); tests/test_stress_time.py
# compares them.
LEAD_ZONES: dict[str, tuple[str, ...]] = {
    "kw": ("Asia/Kuwait",), "sa": ("Asia/Riyadh",), "qa": ("Asia/Qatar",), "bh": ("Asia/Bahrain",),
    "ae": ("Asia/Dubai",), "om": ("Asia/Muscat",), "iq": ("Asia/Baghdad",), "jo": ("Asia/Amman",),
    "lb": ("Asia/Beirut",), "sy": ("Asia/Damascus",), "ye": ("Asia/Aden",), "ps": ("Asia/Gaza",),
    "il": ("Asia/Jerusalem",), "ir": ("Asia/Tehran",), "tr": ("Europe/Istanbul",), "eg": ("Africa/Cairo",),
    "ly": ("Africa/Tripoli",), "tn": ("Africa/Tunis",), "dz": ("Africa/Algiers",), "ma": ("Africa/Casablanca",),
    "sd": ("Africa/Khartoum",), "et": ("Africa/Addis_Ababa",), "ke": ("Africa/Nairobi",), "ng": ("Africa/Lagos",),
    "za": ("Africa/Johannesburg",), "gh": ("Africa/Accra",), "gb": ("Europe/London",), "uk": ("Europe/London",),
    "ie": ("Europe/Dublin",), "fr": ("Europe/Paris",), "de": ("Europe/Berlin",), "it": ("Europe/Rome",),
    "es": ("Europe/Madrid",), "pt": ("Europe/Lisbon",), "nl": ("Europe/Amsterdam",), "be": ("Europe/Brussels",),
    "ch": ("Europe/Zurich",), "at": ("Europe/Vienna",), "se": ("Europe/Stockholm",), "no": ("Europe/Oslo",),
    "dk": ("Europe/Copenhagen",), "fi": ("Europe/Helsinki",), "pl": ("Europe/Warsaw",), "cz": ("Europe/Prague",),
    "gr": ("Europe/Athens",), "ro": ("Europe/Bucharest",), "hu": ("Europe/Budapest",), "ua": ("Europe/Kyiv",),
    "cy": ("Asia/Nicosia",), "ru": ("Europe/Moscow", "Asia/Vladivostok"), "pk": ("Asia/Karachi",),
    "in": ("Asia/Kolkata",), "bd": ("Asia/Dhaka",), "lk": ("Asia/Colombo",), "np": ("Asia/Kathmandu",),
    "af": ("Asia/Kabul",), "cn": ("Asia/Shanghai",), "hk": ("Asia/Hong_Kong",), "tw": ("Asia/Taipei",),
    "jp": ("Asia/Tokyo",), "kr": ("Asia/Seoul",), "sg": ("Asia/Singapore",), "my": ("Asia/Kuala_Lumpur",),
    "th": ("Asia/Bangkok",), "vn": ("Asia/Ho_Chi_Minh",), "ph": ("Asia/Manila",), "id": ("Asia/Jakarta", "Asia/Jayapura"),
    "au": ("Australia/Perth", "Australia/Sydney"), "nz": ("Pacific/Auckland",),
    "us": ("America/New_York", "America/Los_Angeles"), "ca": ("America/Halifax", "America/Vancouver"),
    "mx": ("America/Mexico_City", "America/Tijuana"), "br": ("America/Sao_Paulo", "America/Manaus"),
    "ar": ("America/Argentina/Buenos_Aires",), "cl": ("America/Santiago",), "co": ("America/Bogota",),
    "pe": ("America/Lima",),
}
_OMAN = re.compile(r"^\s*om\s*$|\boman\b|muscat|مسقط|عمان", re.I)


def lead_zones(country: Any) -> Optional[tuple[str, ...]]:
    """The lead's zones: the ISO code's, the Gulf by name (UAE and Oman
    UTC+4), Kuwait's for no country at all, and None for a code the table
    does not know (a first message then waits for a person)."""
    c = str(country or "").strip()
    if not c:
        return LEAD_ZONES["kw"]
    if c.lower() in LEAD_ZONES:
        return LEAD_ZONES[c.lower()]
    if PLUS_FOUR.search(c):
        return LEAD_ZONES["om"] if _OMAN.search(c) else LEAD_ZONES["ae"]
    if re.fullmatch(r"[A-Za-z]{2}", c):
        return None
    return LEAD_ZONES["kw"]


# The Gulf's zones keep one offset all year (no daylight saving): known even
# on a machine with no time zone database. Every other zone's offset comes
# from zoneinfo only; without it the zone's clock is not known (None).
_FIXED_HOURS = {"Asia/Kuwait": 3, "Asia/Riyadh": 3, "Asia/Qatar": 3, "Asia/Bahrain": 3, "Asia/Baghdad": 3,
                "Asia/Aden": 3, "Asia/Dubai": 4, "Asia/Muscat": 4}
# A confirmation goes between these hours on the lead's clock (sales-api's later-message hours).
CONFIRM_HOURS = (9, 21)


def _zone_offset(zone: str, at: datetime) -> Optional[timedelta]:
    """The zone's UTC offset at `at`, or None when this machine cannot read
    it (no time zone database) and the zone is not one of the Gulf's fixed
    ones: missing is never zero, and never silently Kuwait's."""
    try:
        from zoneinfo import ZoneInfo
        off = at.astimezone(ZoneInfo(zone)).utcoffset()
        if off is not None:
            return off
    except Exception:  # noqa: BLE001 - no tz database on this machine
        pass
    h = _FIXED_HOURS.get(zone)
    return timedelta(hours=h) if h is not None else None


def lead_offset(country: Any, at: Optional[datetime] = None) -> timedelta:
    """The lead's clock at `at` (now when not given): their first zone's
    offset; UTC+4 in the UAE and Oman, UTC+3 elsewhere in the Gulf and when
    the country (or its clock on this machine) is not known."""
    zones = lead_zones(country) or LEAD_ZONES["kw"]
    off = _zone_offset(zones[0], at or datetime.now(timezone.utc))
    return off if off is not None else KUWAIT


def _utc_words(off: timedelta) -> str:
    minutes = int(off.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    h, m = divmod(abs(minutes), 60)
    return f"UTC{sign}{h}" + (f":{m:02d}" if m else "")


def _place(zone: str) -> str:
    return zone.rsplit("/", 1)[-1].replace("_", " ")


def call_words(start: datetime, now: datetime, country: Any = None) -> dict[str, str]:
    """A booked call's day and time on the lead's own clock, as the message
    may name them, and the words for which clock that is: the offset at the
    call's time and the place whose clock it is (New York's for a country
    that spans zones), never "as Kuwait" unless it is Kuwait's clock."""
    zones = lead_zones(country) or LEAD_ZONES["kw"]
    off = _zone_offset(zones[0], start)
    known = off is not None
    off = off if known else KUWAIT
    k, today = start + off, (now + off).date()
    rel = "today" if k.date() == today else "tomorrow" if k.date() == today + timedelta(days=1) else k.strftime("%A")
    if not known:
        zone = f"Kuwait time ({_utc_words(KUWAIT)}): the lead's own clock could not be read"
    elif zones[0] in _FIXED_HOURS:
        zone = "their own time (UTC+4)" if off == timedelta(hours=4) else "their own time (UTC+3, as Kuwait)"
    elif len(zones) > 1:
        zone = f"{_place(zones[0])} time ({_utc_words(off)}); the country has more than one clock"
    else:
        zone = f"their own time ({_utc_words(off)}, {_place(zones[0])})"
    return {"day": k.strftime("%A %d %B"), "relative": rel, "time_24h": k.strftime("%H:%M"), "zone": zone}


def asked_to_stop(thread: list[dict[str, Any]]) -> bool:
    """The lead's own latest message says stop or not interested (a later
    "actually, tell me more" opens them up again)."""
    return stop_of(thread) is not None


def stop_kind(text: Any) -> Optional[str]:
    """What a lead's words ask: "unsubscribe" (stop messaging me at all, which
    a rep may confirm as do-not-disturb), "pause" (not interested, not now,
    don't call: the agent leaves them for 30 days), or None."""
    t = str(text or "").strip()
    if not t:
        return None
    if BARE_STOP.match(t) or UNSUBSCRIBE.search(t):
        return "unsubscribe"
    return "pause" if OPT_OUT.search(t) else None


def stop_of(thread: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The lead's latest message with words in it, when it asks to stop:
    {kind, at, text}. Only the latest one is read here; once a stop is kept
    in the cockpit (record_stop), its row holds the lead until a rep resumes
    it, whatever the lead writes after (hold_of)."""
    theirs = [m for m in thread if m.get("from") == "lead" and str(m.get("text") or "").strip()]
    if not theirs:
        return None
    last = theirs[-1]
    kind = stop_kind(last.get("text"))
    if not kind:
        return None
    return {"kind": kind, "at": _ts(last.get("at")), "text": str(last.get("text") or "").strip()[:200]}


STOPS = "cockpit_sales_followup_stops"


def stop_hold(stop: Optional[dict[str, Any]], row: Optional[dict[str, Any]], now: datetime,
              pause_days: int = STOP_PAUSE_DAYS) -> Optional[str]:
    """Why the agent leaves this lead alone now, in words for the run's log,
    or None. `row` is what the cockpit holds about this stop (a rep's answer
    to it), when it can be read: resumed, paused until a day, or put on
    WhatsApp do-not-disturb. Without it, an unsubscribe waits for a rep and a
    pause runs 30 days from the lead's message."""
    if not stop:
        return None
    state = str((row or {}).get("state") or "")
    if state == "resumed":
        return None
    if state == "paused" or (not state and stop["kind"] == "pause"):
        until = _ts((row or {}).get("paused_until")) or ((stop.get("at") or now) + timedelta(days=pause_days))
        return f"paused until {until.date().isoformat()} after writing a stop word" if now < until else None
    if state == "dnd":
        return "asked to stop; a rep put WhatsApp on do-not-disturb"
    return "asked to stop; a rep confirms it before anything else goes"


def _rows_of(rows: Optional[dict[str, Any]], contact: str) -> list[dict[str, Any]]:
    """Every stops row the cockpit holds for a lead, newest first (a single
    row, as an older caller may pass, is read as a list of one)."""
    r = (rows or {}).get(contact)
    if isinstance(r, dict):
        r = [r]
    return sorted((x for x in (r or []) if isinstance(x, dict)), key=lambda x: _ts(x.get("said_at")) or datetime.min.replace(tzinfo=timezone.utc),
                  reverse=True)


def hold_of(rows: Optional[dict[str, Any]], contact: str, now: datetime) -> Optional[tuple[str, str]]:
    """What the cockpit's stops rows say about a lead now, whatever the lead
    wrote since: (kind, words) or None. Every row counts, not only the
    newest, so a rep's pause is never hidden behind a newer stop word, and a
    rep's answer is never hidden behind a newer pause.

    - asked: an unsubscribe a rep has not answered; nothing goes until they do.
    - dnd: a rep put WhatsApp on do-not-disturb.
    - paused (a stop word) or manual (a rep's own pause): until paused_until.
    Only a rep's resume lifts a row: a row said before the latest resume
    holds nothing. A later message from the lead lifts nothing (spec P3 §4:
    a paused lead leaves that state when a rep resumes it)."""
    mine = _rows_of(rows, contact)
    resumed = [(_ts(r.get("decided_at")) or _ts(r.get("said_at"))) for r in mine if r.get("state") == "resumed"]
    resumed_at = max((t for t in resumed if t), default=None)
    for r in mine:
        state, said = str(r.get("state") or ""), _ts(r.get("said_at"))
        if state == "resumed" or (resumed_at and said and said <= resumed_at):
            continue
        if state == "asked":
            return "asked", "asked to stop; a rep confirms it before anything else goes"
        if state == "dnd":
            return "dnd", "asked to stop; a rep put WhatsApp on do-not-disturb"
        until = _ts(r.get("paused_until"))
        if state == "paused" and until and now < until:
            if r.get("kind") == "manual":
                return "manual", f"paused by a rep until {until.date().isoformat()}"
            return "paused", f"paused until {until.date().isoformat()} after writing a stop word"
    return None


def new_stop_hold(rows: Optional[dict[str, Any]], contact: str, stop: Optional[dict[str, Any]], now: datetime,
                  pause_days: int = STOP_PAUSE_DAYS) -> tuple[Optional[str], bool]:
    """The lead's latest stop word in their thread: (why it holds them now,
    whether it is new to the cockpit and is to be kept for a rep). A stop the
    cockpit already keeps is decided by its row (hold_of), never here; a new
    one holds as stop_hold says, unless a rep resumed the lead after it was
    written. Without the rows (the table unreadable), the words decide."""
    if not stop:
        return None, False
    if stop_row_for(rows, contact, stop) is not None:
        return None, False
    resumed = [(_ts(r.get("decided_at")) or _ts(r.get("said_at"))) for r in _rows_of(rows, contact)
               if r.get("state") == "resumed"]
    resumed_at = max((t for t in resumed if t), default=None)
    if resumed_at and stop.get("at") and stop["at"] <= resumed_at:
        return None, False
    return stop_hold(stop, None, now, pause_days), True


def manual_hold(rows: Optional[dict[str, Any]], contact: str, now: datetime) -> Optional[str]:
    """A rep's own pause from the lead page ("Pause the agent for this
    lead") when it is what holds the lead now: a stops row of kind manual,
    paused until a time still to come, and no rep's resume since."""
    h = hold_of(rows, contact, now)
    return h[1] if h and h[0] == "manual" else None


def record_stop(sb: Any, contact: str, stop: dict[str, Any], now: datetime, pause_days: int = STOP_PAUSE_DAYS,
                warn: Callable[[str], None] = lambda _m: None) -> bool:
    """The stop kept where a rep sees it: an unsubscribe as a question for a
    rep ("Stop WhatsApp for them?"), a pause with the day it ends. Once per
    lead message; a rep's answer is never written over. Never do-not-disturb:
    only a rep's yes does that, through sales-api. A failed write leaves the
    lead alone all the same, and says so."""
    at = stop.get("at") or now
    row = {"contact_id": contact, "said_at": at.isoformat(), "kind": stop["kind"], "said": stop["text"][:200],
           "state": "asked" if stop["kind"] == "unsubscribe" else "paused",
           "paused_until": None if stop["kind"] == "unsubscribe" else (at + timedelta(days=pause_days)).isoformat(),
           "created_by": "sales-desk"}
    try:
        sb.rest("POST", f"{STOPS}?on_conflict=contact_id,said_at", json_body=[row],
                prefer="resolution=ignore-duplicates,return=minimal")
        return True
    except Exception as e:  # noqa: BLE001 - the lead is left alone anyway
        warn(f"followups: {contact}'s stop could not be kept for a rep ({http.scrub(str(e))[:120]}); "
             "the agent leaves them alone all the same")
        return False


def stops_for(sb: Any, contacts: list[str]) -> Optional[dict[str, list[dict[str, Any]]]]:
    """Every stop the cockpit holds for each lead, newest first, or None when
    they cannot be read (the table not there yet): unknown, never "no
    stops". Found 2026-10-03: keeping only the newest row hid a rep's pause
    behind a newer stop word, and a rep's answer behind a newer pause."""
    out: dict[str, list[dict[str, Any]]] = {}
    try:
        for chunk in _chunks(sorted(set(contacts))):
            for r in sb.select_all(STOPS, f"select=*&contact_id={_in(chunk)}", order="contact_id,said_at"):
                out.setdefault(str(r.get("contact_id")), []).append(r)
    except Exception:  # noqa: BLE001 - said by the caller
        return None
    return {c: _rows_of(out, c) for c in out}


def stop_row_for(rows: Optional[dict[str, Any]], contact: str,
                 stop: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The cockpit's row about this very stop (the same lead message), if
    any, among every row it holds for the lead."""
    if not stop or not stop.get("at"):
        return None
    return next((r for r in _rows_of(rows, contact)
                 if r.get("kind") != "manual" and _ts(r.get("said_at")) == stop.get("at")), None)


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
    # window, so the lead waits for the next run instead. It is read back to
    # the lead's own last words (stress2, round 1: a stop behind a page of
    # automations); one too long to read that far is not read either.
    try:
        thread, thread_ok = ghl_history(ghl_token, c)
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
        "conversation": [{k: m.get(k) for k in ("at", "from", "channel", "text")} for m in thread[-20:]],
        "now_kuwait": kuwait_now(now).strftime("%A %d %B %Y, %H:%M"),
        # Who the message is from: the lead's own rep, by first name, or nobody.
        "rep": (rep_name or "").split(" ")[0] or None,
        "rep_ar": (rep_ar or "").split(" ")[0] or None,
    }
    due_context(ctx, lead, due, now)
    ctx["_thread"] = thread
    ctx["_thread_ok"] = thread_ok
    return ctx


def due_context(ctx: dict[str, Any], lead: dict[str, Any], due: Optional[dict[str, Any]], now: datetime) -> None:
    """The parts of the brief that belong to the message being written (the
    call it is about, its number in the sequence), set again when a run moves
    from an answered reply to the lead's next kind."""
    ctx.pop("the_call", None)
    ctx.pop("message_number", None)
    if due and due.get("start_at") and due.get("segment") in ("confirm", "no_show", "cancelled"):
        appts = ctx.get("calls_on_the_calendar") or []
        a = next((x for x in appts if _ts(x.get("start_at")) == _ts(due["start_at"])), {})
        ctx["the_call"] = {"type": a.get("call_type"), **call_words(_ts(due["start_at"]), now, lead.get("country"))}
    if due and due.get("segment") in ANGLES:
        ctx["message_number"] = f"{due.get('touch', 1)} of {due.get('of') or len(ANGLES[due['segment']])}"


def _cut(v: Any, n: int) -> Any:
    return v[:n] if isinstance(v, str) and len(v) > n else v


def brief(ctx: dict[str, Any], limit: int = BRIEF_LIMIT) -> str:
    """What the model reads about a lead, as whole JSON no longer than
    `limit`, the newest messages of their conversation kept whatever else has
    to give: older call summaries, research and notes shrink first, then the
    older messages' words. Found 2026-10-03: the brief was cut at 24,000
    characters from its end, so the conversation, last in it, lost its newest
    messages first (and the JSON its closing)."""
    c = copy.deepcopy(ctx)
    c["conversation"] = list(c.get("conversation") or [])[-KEEP_MESSAGES:]

    def text() -> str:
        return json.dumps(c, ensure_ascii=False, indent=1, default=str)

    def each(key: str, fn: Callable[[dict[str, Any]], dict[str, Any]], keep: Optional[int] = None) -> None:
        items = [x for x in (c.get(key) or []) if isinstance(x, dict)]
        c[key] = [fn(x) for x in (items[:keep] if keep is not None else items)]

    def research(n: int) -> None:
        r = c.get("research")
        if isinstance(r, dict):
            tp = r.get("talking_points")
            c["research"] = {"company": _cut(r.get("company"), n),
                             "talking_points": [_cut(t, n // 3) for t in tp[:5]] if isinstance(tp, list) else _cut(tp, n)}

    def messages(n: int, keep_whole: int) -> None:
        conv = c["conversation"]
        for i, m in enumerate(conv[:max(0, len(conv) - keep_whole)]):
            if isinstance(m, dict):
                conv[i] = {**m, "text": _cut(m.get("text"), n)}

    shrink: list[Callable[[], None]] = [
        lambda: research(800),
        lambda: each("recorded_calls", lambda r: {**r, "summary": _cut(r.get("summary"), 1000),
                                                  "action_items": _cut(r.get("action_items"), 300)}),
        lambda: each("what_the_calls_told_us", lambda n: {k: _cut(v, 500) for k, v in n.items()}),
        lambda: each("rep_notes", lambda n: {**n, "text": _cut(n.get("text"), 300)}),
        lambda: c["lead"].update({k: _cut(v, 400) for k, v in (c.get("lead") or {}).items()})
        if isinstance(c.get("lead"), dict) else None,
        lambda: each("recorded_calls", lambda r: {**r, "summary": _cut(r.get("summary"), 400),
                                                  "action_items": _cut(r.get("action_items"), 150)}, keep=1),
        lambda: each("phone_calls", lambda d: {**d, "summary_en": _cut(d.get("summary_en"), 200)}, keep=3),
        lambda: each("calls_on_the_calendar", lambda a: a, keep=3),
        lambda: research(200),
        lambda: messages(300, keep_whole=5),
        lambda: each("what_the_calls_told_us", lambda n: {k: _cut(v, 200) for k, v in n.items()}, keep=1),
        lambda: each("rep_notes", lambda n: {**n, "text": _cut(n.get("text"), 120)}, keep=2),
        lambda: messages(120, keep_whole=2),
        lambda: [c.pop(k, None) for k in ("research", "recorded_calls", "phone_calls", "what_the_calls_told_us")],
        lambda: messages(120, keep_whole=0),
        lambda: messages(40, keep_whole=0),
    ]
    out = text()
    for step in shrink:
        if len(out) <= limit:
            break
        step()
        out = text()
    if len(out) > limit:
        # Nothing left to give but the lead's own answers: shortened to fit,
        # the conversation's newest messages still in it, whole JSON.
        c["lead"] = {k: _cut(v, 60) for k, v in (c.get("lead") or {}).items()} if isinstance(c.get("lead"), dict) else None
        out = text()
    return out


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
    sent = sb.select_all("cockpit_sales_followups", "select=id,contact_id,decided_at&status=eq.sent&replied_at=is.null"
                                                    f"&decided_at=gte.{_q((now - timedelta(days=7)).isoformat())}",
                         order="id")
    if not sent:
        return 0
    ids = sorted({str(f["contact_id"]) for f in sent})
    inbox: list[dict[str, Any]] = []
    for chunk in _chunks(ids):
        inbox += sb.select_all("cockpit_sales_inbox", "select=contact_id,last_message_at,last_direction,inbound_whatsapp_at"
                                                      f"&contact_id={_in(chunk)}", order="conversation_id")
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


# An approved backlog opener waits only for the lead's hours and day off: it
# may still go this long after its turn (sales-api followup.batch keeps it).
APPROVED_KEEP = timedelta(hours=72)


# The error a draft closed as stale carries (here and in the waves' send).
STALE_DRAFT = "Went stale before anyone sent it."


def expire_stale(sb: Any, now: datetime) -> int:
    """Drafts past their time (a WhatsApp window that closed, two days
    unanswered) are marked expired: the page already hides them, and while
    they stayed drafts they held the lead's one open draft, so the agent
    never wrote them a fresh one. A backlog opener a manager approved is a
    template (no window) waiting for the lead's hours: it is kept until 72
    hours past its turn, unless someone holds it."""
    stale = {"status": "expired", "decided_at": now.isoformat(), "error": STALE_DRAFT}
    out = sb.rest("PATCH", f"cockpit_sales_followups?status=eq.draft&segment=neq.reactivate"
                           f"&expires_at=lt.{_q(now.isoformat())}",
                  json_body=stale, prefer="return=representation")
    n = len(out) if isinstance(out, list) else 0
    openers = sb.select("cockpit_sales_followups", "select=id&status=eq.draft&segment=eq.reactivate"
                                                   f"&expires_at=lt.{_q(now.isoformat())}&limit=500")
    if not openers:
        return n
    approved: dict[str, Optional[datetime]] = {}
    for chunk in _chunks([str(f["id"]) for f in openers]):
        for m in sb.select("cockpit_sales_followup_meta", f"select=followup_id,send_after,held_by&followup_id={_in(chunk)}"
                                                          "&limit=1000"):
            if m.get("send_after") and not m.get("held_by"):
                approved[str(m["followup_id"])] = _ts(m.get("send_after"))
    for f in openers:
        fid = str(f["id"])
        turn = approved.get(fid)
        if fid in approved and turn and turn + APPROVED_KEEP > now:
            continue
        gone = sb.rest("PATCH", f"cockpit_sales_followups?id=eq.{_q(fid)}&status=eq.draft", json_body=stale,
                       prefer="return=representation")
        n += bool(isinstance(gone, list) and gone)
    return n


def _settle(settle: Optional[Callable[[str], dict[str, Any]]], followup_id: str, warn: Callable[[str], None]) -> None:
    """The cockpit's word on a send the desk has just read back (followup.settle).
    Refused or unreachable, the message row still says what happened; the
    follow-up waits for a person, and the log says so."""
    if not settle:
        return
    try:
        out = settle(followup_id) or {}
    except Exception as e:  # noqa: BLE001 - said in the log
        out = {"error": http.scrub(str(e))}
    if isinstance(out, dict) and out.get("error"):
        warn(f"followups: {followup_id} could not be settled in the cockpit: {str(out['error'])[:160]}")


def free_stuck(sb: Any, now: datetime, settle: Optional[Callable[[str], dict[str, Any]]] = None,
               warn: Callable[[str], None] = lambda _m: None) -> int:
    """Follow-ups a send claimed (sending) half an hour ago or more and never
    finished: the cockpit's send died midway, and the draft held the lead's
    one open draft for good. Its message decides where it goes: one HighLevel
    took, sent (and settled); a failed one, failed; one that may or may not
    have gone, failed, saying so; none at all, back to a draft for a person
    to approve again. Each move is conditional on the claim read, so a send
    that finishes meanwhile wins."""
    rows = sb.select("cockpit_sales_followups", "select=id,decided_at&status=eq.sending"
                                                f"&decided_at=lt.{_q((now - STUCK).isoformat())}&order=decided_at.asc&limit=100")
    if not rows:
        return 0
    msgs = sb.select("cockpit_sales_messages", "select=id,followup_id,state,ghl_message_id,error"
                                               f"&followup_id={_in([str(r['id']) for r in rows])}")
    of: dict[str, list[dict[str, Any]]] = {}
    for m in msgs:
        of.setdefault(str(m.get("followup_id") or ""), []).append(m)
    freed = 0
    for r in rows:
        ms = of.get(str(r["id"]), [])
        went = next((m for m in ms if m.get("state") != "failed" and (m.get("ghl_message_id") or m.get("state") in GONE)),
                    None)
        bad = next((m for m in ms if m.get("state") == "failed"), None)
        if went:
            body: dict[str, Any] = {"status": "sent", "message_id": went["id"], "error": None}
        elif bad:
            body = {"status": "failed", "message_id": bad["id"], "error": str(bad.get("error") or "HighLevel marked it failed")}
        elif ms:
            body = {"status": "failed", "message_id": ms[0]["id"],
                    "error": ("The send stopped halfway and may not have gone out. Read the conversation in HighLevel "
                              "before writing to the lead again.")}
        else:
            body = {"status": "draft", "decided_by": None, "decided_at": None,
                    "error": "The send stopped before anything went out. Approve it again."}
        out = sb.rest("PATCH", f"cockpit_sales_followups?id=eq.{_q(str(r['id']))}&status=eq.sending"
                               f"&decided_at=eq.{_q(str(r['decided_at']))}", json_body=body, prefer="return=representation")
        if not (isinstance(out, list) and out):
            continue
        freed += 1
        if body["status"] == "sent":
            _settle(settle, str(r["id"]), warn)
    return freed


def gone_reason(d: dict[str, Any], calls: list[dict[str, Any]], inbox: list[dict[str, Any]],
                sends: list[dict[str, Any]], now: datetime) -> Optional[str]:
    """Why an open draft is no longer needed, or None while it still is."""
    made = _ts(d.get("created_at"))
    if d.get("segment") == "reply":
        # An email after it answers only an email draft (an automation's
        # newsletter is no answer to a WhatsApp question).
        ch = d.get("channel") or "whatsapp"
        after = [_ts(r.get("last_message_at")) for r in inbox
                 if r.get("last_direction") == "outbound" and answers(r.get("last_type"), ch)]
        after += [_ts(m.get("created_at")) for m in sends if m.get("state") != "failed" and answers(m.get("channel"), ch)]
        if made and any(t and t > made for t in after):
            return "A message went to the lead after this draft was made, so it answers an older conversation."
        return None
    aid = str(d.get("appointment_id") or "")
    event = next((a for a in calls if aid and str(a.get("appointment_id") or "") == aid), None)
    if d.get("segment") in ("no_show", "cancelled"):
        if event and booked_again(event, calls, now):
            return "The lead booked another call, so this message is not needed."
        return None
    if not aid:
        return None
    if event is None:
        return "The call this confirms is no longer on the calendar."
    if event.get("status") in ("cancelled", "invalid"):
        return "The call this confirms was cancelled."
    start, was = _ts(event.get("start_at")), _ts((d.get("context") or {}).get("start_at"))
    if start and start <= now:
        return "The call this confirms has already started."
    if start and was and start != was:
        return "The call this confirms was moved; a confirmation for the new time is written when it is due."
    return None


OPENER_REPLIED = "The lead wrote in after this opener was written; a person answers them."


def conversation_moved(sb: Any, contact: str, since: datetime, channel: Optional[str]) -> bool:
    """Whether the lead's conversation has a message newer than `since` in
    the inbox copy, as sales-api's sendFollowup reads it (an outbound email
    moves nothing on for a WhatsApp draft). Not readable: False, and the
    send's own check still holds."""
    try:
        rows = sb.select("cockpit_sales_inbox", "select=last_message_at,last_direction,last_type,inbound_whatsapp_at"
                                                f"&contact_id=eq.{_q(contact)}&limit=5")
    except Exception:  # noqa: BLE001 - the send's own check is the second net
        return False
    for r in rows:
        last = _ts(r.get("last_message_at"))
        email = "email" in str(r.get("last_type") or "").lower()
        if last and last > since and (r.get("last_direction") == "inbound" or not (channel != "email" and email)):
            return True
        wa_in = _ts(r.get("inbound_whatsapp_at"))
        if wa_in and wa_in > since:
            return True
    return False
OPENER_BOOKED = "The lead has a call booked now, so the backlog opener was taken back."


def opener_gone(d: dict[str, Any], calls: list[dict[str, Any]], inbox: list[dict[str, Any]],
                now: datetime) -> Optional[str]:
    """Why an open backlog opener (reactivate) is no longer wanted, or None:
    the lead wrote in after it was written (their own message is the one to
    answer, and an open opener would hold back the reply draft for up to two
    days), or a call of theirs is booked and still to come (a "How are you?"
    to a lead booked for tomorrow)."""
    made = _ts(d.get("created_at"))
    t_in, _ = last_inbound(inbox)
    if made and t_in and t_in > made:
        return OPENER_REPLIED
    for a in calls:
        start = _ts(a.get("start_at"))
        if a.get("call_type") in ("intro", "demo") and start and start > now and a.get("status") not in NOT_KEPT:
            return OPENER_BOOKED
    return None


def close_gone(sb: Any, now: datetime) -> int:
    """Open drafts whose reason has gone, closed as stale with the reason: a
    no-show or cancellation message once the lead booked again, a reply once
    a message went to them, a confirmation once its call was cancelled, moved
    or held, and a backlog opener once the lead wrote in or booked a call.
    Left open, each waited for a rep who could only skip it, and held the
    lead's one open draft meanwhile."""
    drafts = sb.select_all("cockpit_sales_followups", "select=id,contact_id,segment,channel,appointment_id,created_at,"
                                                      "context&status=eq.draft"
                                                      "&segment=in.(reply,confirm,no_show,cancelled,reactivate)",
                           order="id")
    if not drafts:
        return 0
    calls: dict[str, list[dict[str, Any]]] = {}
    inbox: dict[str, list[dict[str, Any]]] = {}
    sends: dict[str, list[dict[str, Any]]] = {}
    booking = sorted({str(d["contact_id"]) for d in drafts if d.get("segment") != "reply"})
    replying = sorted({str(d["contact_id"]) for d in drafts if d.get("segment") in ("reply", "reactivate")})
    for chunk in _chunks(booking):
        found = sb.select_all("cockpit_sales_calendar", "select=appointment_id,contact_id,call_type,start_at,booked_at,status"
                                                        f"&contact_id={_in(chunk)}&call_type=in.(intro,demo)",
                              order="appointment_id")
        for a in with_live(found, live_calls(sb, chunk)):
            calls.setdefault(str(a.get("contact_id") or ""), []).append(a)
    if replying:
        oldest = min((_ts(d.get("created_at")) or now) for d in drafts if d.get("segment") in ("reply", "reactivate"))
        for chunk in _chunks(replying):
            for r in sb.select_all("cockpit_sales_inbox", f"select=contact_id,last_message_at,last_direction,last_type,"
                                                          f"inbound_whatsapp_at&contact_id={_in(chunk)}", order="conversation_id"):
                inbox.setdefault(str(r.get("contact_id") or ""), []).append(r)
            for m in sb.select_all("cockpit_sales_messages", f"select=contact_id,created_at,state,channel"
                                                             f"&contact_id={_in(chunk)}"
                                                             f"&created_at=gte.{_q(oldest.isoformat())}", order="id"):
                sends.setdefault(str(m.get("contact_id") or ""), []).append(m)
    closed = 0
    for d in drafts:
        c = str(d["contact_id"])
        if d.get("segment") == "reactivate":
            why = opener_gone(d, calls.get(c, []), inbox.get(c, []), now)
        else:
            why = gone_reason(d, calls.get(c, []), inbox.get(c, []), sends.get(c, []), now)
        if not why:
            continue
        out = sb.rest("PATCH", f"cockpit_sales_followups?id=eq.{_q(str(d['id']))}&status=eq.draft",
                      json_body={"status": "expired", "decided_at": now.isoformat(), "error": why},
                      prefer="return=representation")
        closed += bool(isinstance(out, list) and out)
    return closed


def close_clients(sb: Any, now: datetime) -> int:
    """Open drafts for a contact tagged client, closed with the reason: an
    active client gets no sales follow-up. The tag can arrive after a draft
    was written, when a lead signs; sales-api refuses to send one anyway."""
    drafts = sb.select_all("cockpit_sales_followups", "select=id,contact_id&status=eq.draft", order="id")
    if not drafts:
        return 0
    clients: set[str] = set()
    for chunk in _chunks(sorted({str(d["contact_id"]) for d in drafts})):
        clients |= {str(lead.get("contact_id")) for lead in
                    sb.select("cockpit_sales_leads", f"select=contact_id,tags&contact_id={_in(chunk)}") if is_client(lead)}
    closed = 0
    for d in drafts:
        if str(d["contact_id"]) not in clients:
            continue
        out = sb.rest("PATCH", f"cockpit_sales_followups?id=eq.{_q(str(d['id']))}&status=eq.draft",
                      json_body={"status": "expired", "decided_at": now.isoformat(), "error": CLIENT_CLOSED},
                      prefer="return=representation")
        closed += bool(isinstance(out, list) and out)
    return closed


def settle_sends(sb: Any, token: str, now: datetime, settle: Optional[Callable[[str], dict[str, Any]]] = None,
                 warn: Callable[[str], None] = lambda _m: None) -> dict[str, int]:
    """Follow-ups sent in the last two days whose message HighLevel had not
    shown gone or failed at the send (a WhatsApp message still pending):
    its status is read again, written on the message row, and the cockpit
    settles the follow-up (followup.settle): a failed message fails the
    follow-up, and one seen to have gone takes the lead out of the old
    automation when its kind takes over. Without this, a send not seen at
    once did neither."""
    rows = sb.select_all("cockpit_sales_followups", "select=id,message_id&status=eq.sent&message_id=not.is.null"
                                                    f"&decided_at=gte.{_q((now - timedelta(days=2)).isoformat())}",
                         order="id")
    followup_of = {str(r["message_id"]): str(r["id"]) for r in rows}
    msgs: list[dict[str, Any]] = []
    for chunk in _chunks(sorted(followup_of)):
        msgs += sb.select("cockpit_sales_messages", f"select=id,state,provider_status,ghl_message_id&id={_in(chunk)}")
    out = {"read": 0, "gone": 0, "failed": 0}
    for m in msgs:
        if m.get("state") == "failed" or state_of(m.get("provider_status")) in GONE or not m.get("ghl_message_id"):
            continue
        try:
            status = str(ghl_message(token, str(m["ghl_message_id"])).get("status") or "").lower()
        except Exception as e:  # noqa: BLE001 - read again next run
            warn(f"followups: message {m['id']}'s status could not be read from HighLevel: {http.scrub(str(e))[:160]}")
            continue
        out["read"] += 1
        state = state_of(status)
        if state == "sending":
            continue  # still pending: the next run reads it again
        sb.rest("PATCH", f"cockpit_sales_messages?id=eq.{_q(str(m['id']))}", prefer="return=minimal", json_body={
            "state": state, "provider_status": status, "updated_at": now.isoformat(),
            "error": f"HighLevel marked it {status}" if state == "failed" else None})
        out["failed" if state == "failed" else "gone"] += 1
        _settle(settle, followup_of[str(m["id"])], warn)
    return out


_INVISIBLE = re.compile("[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")


def norm_text(v: Any) -> str:
    """Words as sales-api compares them (sendrules.ts normText): NFKC, no
    zero-width or direction marks, one space, no case."""
    import unicodedata
    t = unicodedata.normalize("NFKC", str(v or ""))
    return re.sub(r"\s+", " ", _INVISIBLE.sub("", t)).strip().lower()


def same_text(a: Any, b: Any) -> bool:
    """The same message (sendrules.ts sameText): equal once normalised, or one
    starts with the other's first 60 characters (HighLevel can add a
    template's button or footer)."""
    x, y = norm_text(a), norm_text(b)
    if not x or not y:
        return False
    if x == y:
        return True
    n = min(60, len(x), len(y))
    return n >= 20 and (x.startswith(y[:n]) or y.startswith(x[:n]))


def template_hit(thread: list[dict[str, Any]], row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """The template message a workflow send posted, in the lead's conversation:
    ours, on WhatsApp, from a workflow, at most 15 s before the send's row,
    with the template's own words (C29, as sales-api's matchSent)."""
    at = _ts(row.get("created_at"))
    if at is None:
        return None
    words = str(row.get("body") or "").strip()
    return next((m for m in reversed(thread) if m.get("from") == "us" and m.get("channel") == "whatsapp"
                 and m.get("source") == "workflow" and _ts(m.get("at")) and _ts(m["at"]) >= at - timedelta(seconds=15)
                 and (not words or same_text(m.get("text"), words))), None)


def mark_template_seen(sb: Any, row: dict[str, Any], hit: dict[str, Any], now: datetime) -> str:
    """A workflow send found in the conversation: its row says what HighLevel shows. Answers the state."""
    status = str(hit.get("status") or "sent").lower()
    state = "failed" if status in ("failed", "undelivered") else "read" if status == "read" \
        else "delivered" if status == "delivered" else "sent"
    sb.rest("PATCH", f"cockpit_sales_messages?id=eq.{_q(str(row['id']))}", prefer="return=minimal", json_body={
        "state": state, "provider_status": status, "ghl_message_id": hit.get("id"),
        "error": "HighLevel marked it failed" if state == "failed" else None, "updated_at": now.isoformat()})
    return state


def agent_still_on(sb: Any) -> bool:
    """followups.enabled read again (stress2 round 4): False once a manager
    switched the agent off. Not readable: the run goes on, on the reading it
    started with."""
    try:
        value = sb.setting("followups")
    except Exception:  # noqa: BLE001 - one unread switch never ends a run
        return True
    return not (isinstance(value, dict) and value.get("enabled") is False)


def reconcile_templates(sb: Any, token: str, now: datetime, settle: Optional[Callable[[str], dict[str, Any]]] = None,
                        warn: Callable[[str], None] = lambda _m: None) -> dict[str, int]:
    """Template sends HighLevel took but had not shown yet: find the message
    in the conversation, or, after half an hour, say it never went. Either
    way a follow-up's send is then settled in the cockpit (followup.settle),
    which fails a follow-up that never went. Only a message with the
    template's own words is it (C29, as sales-api's matchSent): another
    workflow's WhatsApp (one of HighLevel's old automations) never settles
    it (stress2, round 1). An enrolment whose answer was lost (state
    unclear) is settled the same way (stress2, round 2): until then sales-api
    holds every other template to the lead for six hours, since it may still
    be in HighLevel's queue."""
    rows = sb.select("cockpit_sales_messages", "select=id,contact_id,created_at,followup_id,body&via=eq.workflow"
                                               "&or=(provider_status.eq.enrolled,state.eq.unclear)"
                                               f"&created_at=gte.{_q((now - timedelta(hours=6)).isoformat())}"
                                               "&limit=50")
    found = gone = 0
    for r in rows:
        at = _ts(r.get("created_at"))
        if at is None:
            continue
        try:
            thread = ghl_thread(token, str(r["contact_id"]))
        except Exception:  # noqa: BLE001 - try again next run
            continue
        hit = template_hit(thread, r)
        if hit:
            mark_template_seen(sb, r, hit, now)
            found += 1
        elif now - at > timedelta(minutes=30):
            sb.rest("PATCH", f"cockpit_sales_messages?id=eq.{_q(str(r['id']))}", prefer="return=minimal", json_body={
                "state": "failed", "provider_status": "not sent",
                "error": ("The workflow did not send it within half an hour. In HighLevel, check the workflow is "
                          "published and allows re-entry."), "updated_at": now.isoformat()})
            gone += 1
        else:
            continue
        if r.get("followup_id"):
            _settle(settle, str(r["followup_id"]), warn)
    return {"found": found, "never_sent": gone}


# ---------------------------------------------------------------------------
# One pass
# ---------------------------------------------------------------------------

def _line_route(templates: list[dict[str, Any]], language: str, segment: str, *,
                named: bool = True) -> Optional[dict[str, Any]]:
    """The active template that carries a written line, in this language, for
    this kind; one that greets by first name only when the lead has one."""
    for t in sorted(templates, key=lambda t: int(t.get("sort") or 100)):
        variables = t.get("variables") or []
        if t.get("active") and t.get("workflow_id") and t.get("language") == language and "line" in variables \
                and (not t.get("segments") or segment in t["segments"]) and (named or "first_name" not in variables):
            return t
    return None


# The sentence every WhatsApp send from the desk waits behind until the WA
# Connector is off and one template to a test contact showed exactly one
# message (whatsapp_guard.connector_off and single_copy_ok_at).
GATE_CLOSED = "WhatsApp sends from the desk are off until the WA Connector is off and the single-copy test passes."


def wa_gate(guard: Optional[dict[str, Any]]) -> Optional[str]:
    """Why no WhatsApp may go out from the desk now, or None when it may: the
    WA Connector copies every WhatsApp step on the number (5,168 doubles), so
    nothing the desk sends by itself goes on WhatsApp until a manager has
    marked the connector off and the single-copy test passed. Unreadable is
    closed, never open."""
    g = guard if isinstance(guard, dict) else {}
    ok = _ts(g.get("single_copy_ok_at"))
    if g.get("connector_off") is not True or not ok:
        return GATE_CLOSED
    # A single-copy test from before the connector last went off proves nothing (sendrules.ts gateOpen).
    off = _ts(g.get("connector_off_at"))
    if off and ok < off:
        return GATE_CLOSED
    return None


def is_test_contact(lead: Optional[dict[str, Any]]) -> bool:
    tags = (lead or {}).get("tags")
    return isinstance(tags, list) and any(str(t).strip().lower() == TEST_TAG for t in tags)


def test_refusal(lead: Optional[dict[str, Any]], contact: str) -> Optional[str]:
    """Why --contact will not draft for this contact, or None."""
    if not lead:
        return f"{contact} is not in the cockpit's lead copy, so nothing was drafted."
    if not is_test_contact(lead):
        return f"{contact} is not tagged {TEST_TAG}. --contact drafts only for test contacts, so nothing was drafted."
    if is_client(lead):
        return f"{contact} is tagged client as well as {TEST_TAG}. A client gets no sales follow-up, so nothing was drafted."
    return None


def forced_due(contact: str, segment: str, calendar: list[dict[str, Any]], lead: dict[str, Any], now: datetime,
               cadence: dict[str, list[float]]) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    """The first message of a kind for a test contact, due now whatever its
    calls say (`--segment`). The call it is about is its latest of the right
    kind, when there is one; a confirmation needs a call still to come."""
    calls = sorted((a for a in with_kinds(calendar) if a.get("call_type") in ("intro", "demo") and _ts(a.get("start_at"))),
                   key=lambda a: str(a.get("start_at")), reverse=True)
    want = {"no_show": lambda a: a.get("status") == "noshow", "cancelled": lambda a: a.get("status") == "cancelled",
            "after_call": lambda a: a.get("call_type") == "demo",
            "confirm": lambda a: _ts(a.get("start_at")) > now and a.get("status") not in NOT_KEPT}.get(segment)
    call = next((a for a in calls if want(a)), None) if want else None
    if segment == "confirm" and not call:
        return None, "This contact has no call still to come, so there is nothing to confirm."
    score, reasons = heat(lead, now)
    steps = {**CADENCE, **cadence}.get(segment) or [1]
    return {"contact_id": contact, "segment": segment, "touch": 1, "of": len(steps), "tier": 0, "heat": score,
            "reasons": reasons, "appointment_id": (call or {}).get("appointment_id"),
            "start_at": (call or {}).get("start_at") and _ts(call["start_at"]).isoformat(),
            "due_at": now.isoformat()}, None


def _housekeeping(sb: Any, ghl_token: str, now: datetime, settle: Optional[Callable[[str], dict[str, Any]]],
                  warn: Callable[[str], None]) -> dict[str, Any]:
    return {
        "stuck_freed": free_stuck(sb, now, settle, warn),
        "went_stale": expire_stale(sb, now),
        "reason_gone": close_gone(sb, now),
        "clients_closed": close_clients(sb, now),
        "replies_marked": track_replies(sb, now),
        "templates": reconcile_templates(sb, ghl_token, now, settle, warn) if ghl_token else {"found": 0, "never_sent": 0},
        "settled": settle_sends(sb, ghl_token, now, settle, warn) if ghl_token else {"read": 0, "gone": 0, "failed": 0},
    }


def _raced(e: Exception) -> bool:
    """A draft refused because the lead has an open one already: another run
    (or a rep's own) got there first. Not a failure."""
    return isinstance(e, http.HttpError) and e.status == 409 or "23505" in str(e) or "duplicate key" in str(e)


def run(sb: Any, provider: Any, log: Callable[[str], None], *, settings: dict[str, Any], ghl_token: str,
        now: Optional[datetime] = None, autosend: Optional[Callable[[str], dict[str, Any]]] = None,
        settle: Optional[Callable[[str], dict[str, Any]]] = None,
        warn: Optional[Callable[[str], None]] = None, only_contact: Optional[str] = None,
        force_segment: Optional[str] = None, model_down: Optional[str] = None,
        guard: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """One pass: pick the leads, write the drafts, put them in front of the reps.
    `log` says what was done; `warn` what went wrong for one lead, which the
    cron's log keeps even when the desk runs quiet.

    `only_contact` is the test path (desk.py followups --contact): one
    contact tagged cockpit-test, nobody else's rows touched, nothing sent by
    itself, and with `force_segment` that kind's first message whether or not
    it is due. A test contact on do-not-disturb still gets its draft, saying
    so, for the refusal test: sales-api refuses the send.

    `model_down` is the sentence the run's model check ended with (the
    sign-in lapsed): the run keeps the books and counts who is due, and asks
    no model."""
    now = now or datetime.now(timezone.utc)
    # The run's clock as it moves (stress2 round 3): `now` plus the time this
    # run has taken, so a draft carries the moment its thread was read.
    began = time.monotonic()

    def moment() -> datetime:
        return now + timedelta(seconds=time.monotonic() - began)

    warn = warn or log
    test = bool(only_contact)
    if force_segment and force_segment not in SEGMENTS:
        return {"skipped": f"{force_segment} is not a kind of follow-up. Use one of: {', '.join(SEGMENTS)}."}
    if not test and not settings.get("enabled", True):
        return {"skipped": "the follow-up agent is switched off"}
    test_lead: Optional[dict[str, Any]] = None
    books: dict[str, Any] = {}
    if test:
        test_lead = next(iter(sb.select("cockpit_sales_leads", f"select=*&contact_id=eq.{_q(only_contact)}&limit=1")), None)
        refusal = test_refusal(test_lead, str(only_contact))
        if refusal:
            return {"skipped": refusal}
    else:
        # Every other lead's rows are kept in order on a real run only: a test
        # touches nothing but its own contact.
        books = _housekeeping(sb, ghl_token, now, settle, warn)
    if quiet(now, settings.get("quiet") or {}):
        return {"skipped": "quiet hours"}
    if test and force_segment == "reactivate":
        from . import waves  # the opener, written without a model
        return waves.draft_test_opener(sb, test_lead or {}, settings=settings, ghl_token=ghl_token, now=now,
                                       log=log, warn=warn)
    today = (kuwait_now(now).replace(hour=0, minute=0, second=0, microsecond=0) - KUWAIT).isoformat()
    if test:
        room = 1
    else:
        # Backlog openers have their own day (waves.per_day) and never take
        # these drafts' room.
        written_today = len(sb.select("cockpit_sales_followups",
                                      f"select=id&created_at=gte.{_q(today)}&segment=neq.reactivate&limit=500"))
        room = min(int(settings.get("per_run", 12)), int(settings.get("per_day", 60)) - written_today)
        if room <= 0:
            return {"skipped": f"today's {settings.get('per_day', 60)} drafts are written"}

    cadence = {k: [float(x) for x in v] for k, v in (settings.get("cadence") or {}).items() if v}
    steps_of = {**CADENCE, **cadence}
    back = max(window_days(s, steps_of.get(s)) for s in WINDOW_DAYS)
    new_days = window_days("new", steps_of.get("new"))
    only = f"&contact_id=eq.{_q(only_contact)}" if test else ""

    # Every read that can pass 1,000 rows goes page by page: the API stops at
    # 1,000, and a missing row is a step that looks undone or a lead never seen.
    week = (now - timedelta(days=7)).isoformat()
    new_since = (now - timedelta(days=new_days)).isoformat()
    inbox = sb.select_all("cockpit_sales_inbox", "select=contact_id,last_message_at,last_direction,last_type,inbound_whatsapp_at"
                                                 f"&last_message_at=gte.{_q((now - timedelta(days=2)).isoformat())}{only}",
                          order="conversation_id")
    calendar = with_kinds(sb.select_all(
        "cockpit_sales_calendar", "select=appointment_id,contact_id,calendar_id,call_type,start_at,booked_at,status"
                                  f"&start_at=gte.{_q((now - timedelta(days=back)).isoformat())}"
                                  f"&start_at=lte.{_q((now + timedelta(days=21)).isoformat())}{only}",
        order="appointment_id"), sb.setting("calendars") or {})
    # A live call the count booked when the lead joined a video room is a held
    # call of its kind: the "new" and "no_show" messages never ask a lead who
    # just had their intro live to book it.
    calendar = with_live(calendar, live_calls(sb, [only_contact] if test and only_contact else None,
                                              since=now - timedelta(days=back), until=now + timedelta(days=21)))
    if test:
        leads = [dict(test_lead or {})]
    else:
        leads = sb.select_all("cockpit_sales_leads", "select=*&or=" + _q(f'(lead_created_at.gte."{new_since}",stage_name.ilike.*nurture*)'),
                              order="contact_id")
    sends = sb.select_all("cockpit_sales_messages", "select=contact_id,created_at,state,via,channel,ghl_message_id"
                                                    f"&created_at=gte.{_q((now - timedelta(days=14)).isoformat())}{only}",
                          order="id")
    followups = sb.select_all("cockpit_sales_followups", "select=contact_id,segment,status,created_at,decided_at,appointment_id"
                                                         f"&created_at=gte.{_q((now - timedelta(days=max(30, back + 1))).isoformat())}"
                                                         f"{only}", order="id")
    open_drafts = {str(d["contact_id"]) for d in followups if d["status"] in ("draft", "sending")}
    deals = {str(d["contact_id"]) for d in sb.select("cockpit_sales_deals",
                                                     f"select=contact_id&submitted_at=gte.{_q(week)}{only}&limit=500")
             if d.get("contact_id")}
    # A completed dial keeps a new lead out of the "not booked" messages for a
    # day only (spec P3 §3.2): someone spoke to them, so no message lands on
    # top of the call, but a call that did not end in a booking is no reason
    # to leave them for the rest of the eight days.
    reached = {str(d["contact_id"]) for d in sb.select_all(
        "cockpit_sales_dials", f"select=contact_id&state=eq.completed"
                               f"&occurred_at=gte.{_q((now - REACHED_FOR).isoformat())}{only}", order="call_id")
        if d.get("contact_id")}
    confirmations = sb.select_all("cockpit_sales_confirmations", "select=appointment_id,result"
                                                                 f"&start_at=gte.{_q((now - timedelta(hours=1)).isoformat())}",
                                  order="id")
    # Only a row still being worked is hot: a closed or lost one stays on the
    # sheet for the record (20260927f_sales_hot_sheet.sql).
    hot = {str(h["contact_id"]) for h in sb.select_all("cockpit_sales_hot",
                                                       f"select=contact_id&removed_at=is.null&status=eq.nurturing{only}",
                                                       order="contact_id")}
    templates = sb.select("cockpit_sales_wa_templates", "select=*&active=eq.true")
    # Leads the reads above name but the lead read left out, being older than
    # the new-lead window and not in nurture (a no-show from last month, a
    # call to confirm, the hot list, someone who wrote): read as well, so
    # their heat and language are theirs and not a blank lead's.
    known = {str(l.get("contact_id")) for l in leads}
    wanted = {str(a.get("contact_id") or "") for a in calendar} | {str(r.get("contact_id") or "") for r in inbox} | hot
    for chunk in _chunks(sorted(wanted - known - {""})):
        leads += sb.select("cockpit_sales_leads", f"select=*&contact_id={_in(chunk)}")
    # When a lead was last touched: our sends, their conversation's last
    # message (the whole inbox copy, not only the last two days), or a call.
    last_touch: dict[str, str] = {}
    whole_inbox = sb.select_all("cockpit_sales_inbox", f"select=contact_id,last_message_at{only}", order="conversation_id")
    calls = sb.select_all("cockpit_sales_dials", "select=contact_id,occurred_at"
                                                 f"&occurred_at=gte.{_q((now - timedelta(days=60)).isoformat())}{only}",
                          order="call_id")
    for s, col in [(x, "created_at") for x in sends] + [(x, "decided_at") for x in followups if x["status"] == "sent"] \
            + [(x, "last_message_at") for x in whole_inbox] + [(x, "occurred_at") for x in calls]:
        c = str(s.get("contact_id") or "")
        if c and s.get(col):
            last_touch[c] = max(last_touch.get(c, ""), str(s.get(col)))
    for lead in leads:
        lead["last_touch_at"] = last_touch.get(str(lead["contact_id"])) or None
    # A lead whose drafts or sends failed twice in the last day is set aside
    # until that day has passed: each run would pay for the same failure again.
    failures: dict[str, int] = {}
    for f in followups:
        t = _ts(f.get("decided_at")) or _ts(f.get("created_at"))
        if f.get("status") == "failed" and t and now - t < timedelta(hours=24):
            failures[str(f["contact_id"])] = failures.get(str(f["contact_id"]), 0) + 1
    aside = {c for c, n in failures.items() if n >= FAILED_TWICE}

    if test and force_segment:
        due, why_not = forced_due(str(only_contact), force_segment, calendar, test_lead or {}, now, cadence)
        if not due:
            return {"skipped": why_not}
        if str(only_contact) in open_drafts:
            return {"skipped": "This contact already has an open draft. Approve or skip it first."}
        picked = [due]
    else:
        nurture_today = 0 if test else len(sb.select("cockpit_sales_followups",
                                                     f"select=id&segment=eq.nurture&created_at=gte.{_q(today)}&limit=500"))
        nurture_room = max(0, int(settings.get("nurture_per_day", 20)) - nurture_today)
        picked = pick(now, inbox=inbox, calendar=calendar, leads=leads, followups=followups, sends=sends,
                      open_drafts=open_drafts, deals=deals, reached=reached, confirmations=confirmations, hot=hot,
                      cadence=cadence, nurture_every_days=int(settings.get("nurture_every_days", 7)),
                      nurture_room=nurture_room)
        if test:
            picked = [d for d in picked if d["contact_id"] == str(only_contact)]
            if not picked:
                return {"skipped": "Nothing is due for this contact now. Name a kind with --segment to draft one anyway."}
        # The Gulf's day off: only answers to leads who wrote, and confirmations
        # of calls coming up, are written on it.
        days_off = [str(d).lower() for d in settings.get("quiet_days", ["friday"])]
        if kuwait_now(now).strftime("%A").lower() in days_off:
            picked = [d for d in picked if d["segment"] in ("reply", "confirm")]
            for d in picked:
                if (d.get("then") or {}).get("segment") not in (None, "reply", "confirm"):
                    d.pop("then", None)
    # Without a model nothing can be written: who is due is counted, said
    # beside the reason, and nobody is drafted (never "0 written" as if all
    # were well).
    if model_down:
        return {"model_down": model_down, "picked": len(picked), "written": 0, "failed": 0, "no_open_channel": 0,
                "by_channel": {}, "room": room, **books}
    by_id = {str(l["contact_id"]): l for l in leads}
    people = sb.select("cockpit_sales_people", "select=email,ghl_user_id,name,name_ar,active&active=eq.true&limit=200")
    seat_of = {str(p["ghl_user_id"]): str(p["email"]) for p in people if p.get("ghl_user_id")}
    arabic_name_of = {str(p["ghl_user_id"]): str(p.get("name_ar") or "") for p in people if p.get("ghl_user_id")}
    reps = sb.select("cockpit_sales_reps", "select=ghl_user_id,display_name&limit=200")
    rep_name_of = {str(r["ghl_user_id"]): str(r.get("display_name") or "") for r in reps if r.get("ghl_user_id")}
    ours_by_contact: dict[str, set[str]] = {}
    for s in sends:
        if s.get("via") == "workflow" and s.get("ghl_message_id"):
            ours_by_contact.setdefault(str(s["contact_id"]), set()).add(str(s["ghl_message_id"]))
    gap_hours = float(settings.get("automation_gap_hours", 20))
    takeover = settings.get("takeover") or {}
    fallback = settings.get("email_fallback") or {}
    pause_days = int(settings.get("stop_pause_days", STOP_PAUSE_DAYS) or STOP_PAUSE_DAYS)
    first_hours = settings.get("first_hours") or FIRST_HOURS
    # What the cockpit holds about each due lead's stop (a rep's answer).
    # Unreadable is unknown: the thread's own words still decide, and no stop
    # is written over.
    stop_rows = stops_for(sb, [d["contact_id"] for d in picked]) if picked else {}
    if stop_rows is None:
        warn("followups: the stops table could not be read; stop words still leave leads alone, but no rep is "
             "asked about them until it can be")
    gate: Optional[str] = None
    gate_read = False

    # Every client, however many: a lead missing here would be pitched as a stranger.
    dealt = {str(d["contact_id"]) for d in sb.select_all("cockpit_sales_deals", f"select=contact_id{only}", order="response_id")
             if d.get("contact_id")}
    written = no_channel = failed = sent_auto = not_leads = held = talking = unread = stopped = paused = 0
    set_aside = answered = raced = kept = moved_on = 0
    by_channel: dict[str, int] = {}
    switched_off = False
    for due in picked:
        if written >= room:
            break
        # The switch again before each lead (stress2 round 4, agent-kill-
        # switch-read-once-per-run): a manager who switches the agent off
        # mid-run stops it there, never minutes of drafts later.
        if not test and not agent_still_on(sb):
            switched_off = True
            log("followups: the agent was switched off during this run; nothing more is written")
            break
        contact, segment = due["contact_id"], due["segment"]
        if contact in aside:
            set_aside += 1
            continue
        lead = by_id.get(contact) or next(iter(sb.select("cockpit_sales_leads", f"select=*&contact_id=eq.{_q(contact)}&limit=1")), None)
        why_not = eligible(lead, dealt)
        if test and why_not and why_not != "a client":
            why_not = None  # a test contact need not sit in a pipeline
        if why_not or not lead or (lead.get("dnd") and not test):
            not_leads += 1
            continue
        # What the cockpit already holds about this lead's stops (a rep's own
        # pause, an unsubscribe waiting for a rep, a 30-day pause): it holds
        # whatever they wrote since, until a rep resumes it.
        kept_stop = hold_of(stop_rows, contact, now)
        if kept_stop:
            if kept_stop[0] in ("asked", "dnd"):
                stopped += 1
            else:
                paused += 1
            log(f"followups: {contact} {kept_stop[1]}; nothing written")
            continue
        owner = str(lead.get("assigned_to") or "")
        owner_ghl = owner or None
        channel: Optional[str] = None
        asking = False
        try:
            # The moment just before the lead's conversation is read: the
            # draft's created_at (stress2 round 3,
            # drafter-model-minute-hides-newest-message). The model's minute
            # comes after it, so whatever anyone wrote meanwhile is newer than
            # the draft, and sales-api's "the conversation moved on" and
            # close_gone both see it.
            read_at = moment()
            ctx = context_for(sb, lead, ghl_token, now, rep_name_of.get(owner), due, arabic_name_of.get(owner))
            thread = ctx.pop("_thread")
            if not ctx.pop("_thread_ok", True):
                unread += 1
                warn(f"followups: {contact} waits: HighLevel's conversation could not be read")
                continue
            # A stop word: an explicit unsubscribe waits for a rep; any other
            # pauses the agent for this lead for 30 days. Never do-not-disturb.
            stop = stop_of(thread)
            hold, new = new_stop_hold(stop_rows, contact, stop, now, pause_days)
            if new and stop_rows is not None:
                record_stop(sb, contact, stop, now, pause_days, warn)
            if hold:
                if stop["kind"] == "unsubscribe":
                    stopped += 1
                else:
                    paused += 1
                log(f"followups: {contact} {hold}; nothing written")
                continue
            # They wrote, and a person answered after it: no reply is needed
            # (the inbox copy runs minutes behind, and its last message may be
            # an automation's or an email, which answer nothing).
            if segment == "reply":
                mine = [r for r in inbox if str(r.get("contact_id")) == contact]
                theirs_sends = [s for s in sends if str(s.get("contact_id")) == contact]
                if reply_answered(thread, mine, theirs_sends, ours_by_contact.get(contact, set())):
                    answered += 1
                    nxt = due.get("then")
                    if not nxt or (test and force_segment):
                        log(f"followups: {contact} was answered after they wrote; no reply drafted")
                        continue
                    # Their other kind is still due (a no-show, a new lead's
                    # step): it goes on, with every check below.
                    due, segment = nxt, nxt["segment"]
                    due_context(ctx, lead, due, now)
                    log(f"followups: {contact} was answered after they wrote; their {segment} message is next")
            # A HighLevel automation messaged them lately: wait, so nobody gets
            # both. A confirmation waits less, since the reminders are generic;
            # a kind that takes the lead out of the automation at the send
            # waits only so the two do not arrive back to back.
            auto_at = automation_message(thread, ours_by_contact.get(contact, set()))
            if segment == "confirm":
                wait = timedelta(hours=4)
            elif takeover.get(segment) is True:
                wait = TAKEOVER_WAIT
            else:
                wait = timedelta(hours=gap_hours)
            if segment != "reply" and auto_at and now - auto_at < wait:
                held += 1
                continue
            # Someone wrote to them from HighLevel itself lately: they are in a conversation.
            by_hand = max((_ts(m.get("at")) for m in thread if m.get("from") == "us" and m.get("source") != "workflow"
                           and _ts(m.get("at"))), default=None)
            if segment != "reply" and by_hand and now - by_hand < GAP:
                talking += 1
                continue
            # The contact as HighLevel holds it now: the channels its
            # do-not-disturb closes, and the first name a template greets.
            try:
                person = ghl_contact(ghl_token, contact)
            except Exception as e:  # noqa: BLE001 - said in the run's counts
                unread += 1
                warn(f"followups: {contact} waits: HighLevel's contact could not be read: {http.scrub(str(e))[:160]}")
                continue
            blocked = blocked_channels(person)
            reach = lead
            dnd_note = ""
            if test and (lead.get("dnd") or blocked):
                # The refusal test: drafted as if open, refused at the send.
                dnd_note = ("Test contact: do-not-disturb is on, so the cockpit should refuse to send this "
                            "(the refusal test). ")
                reach, blocked = {**lead, "dnd": False}, set()
            ins = [_ts(m["at"]) for m in thread if m["from"] == "lead" and m["channel"] == "whatsapp" and _ts(m.get("at"))]
            ins += [_ts(r.get("inbound_whatsapp_at")) for r in inbox
                    if str(r.get("contact_id")) == contact and _ts(r.get("inbound_whatsapp_at"))]
            last_wa_in = max((t for t in ins if t), default=None)
            language = language_for(lead, thread)
            # A name on file that is not a person's (digits, a company's) is
            # never used to greet them, by the model or by a template.
            first = person_name(lead.get("name"))
            route = None
            if not window_open(last_wa_in, now):
                route = _line_route(templates, language, segment,
                                    named=bool(first and person_name(person.get("firstName"))))
            channel = channel_for(reach, last_wa_in, now, template=route is not None,
                                  email_ok=fallback.get(segment, True) is not False, blocked=blocked)
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
            if not first:
                ctx["lead"]["name"] = None
            user = (f"Channel: {channel}\nWrite in: {'Arabic' if language == 'ar' else 'English'}\n"
                    + ("" if first else "Greet them without a name: the name on file is not a person's first name.\n")
                    + "\nWhat we know about this lead:\n" + brief(ctx))
            draft, asking = None, True
            for _ in range(2):
                reply = provider.complete(system, user, temperature=None, timeout=300)
                draft = parse_draft(reply.text, channel, language if channel == "whatsapp_template" else None)
                if draft:
                    break
            if not draft:
                raise ValueError("the model did not return a usable draft")
            asking = False
            if channel == "whatsapp" and last_wa_in:
                expires = last_wa_in + timedelta(hours=24)
            elif segment == "confirm" and due.get("start_at"):
                expires = min(now + timedelta(hours=48), _ts(due["start_at"]) - timedelta(hours=1))
            else:
                expires = now + timedelta(hours=48)
            # The conversation again, as the inbox copy has it now: a message
            # newer than the thread the model saw (the lead's, or a person's
            # answer) means this draft answers an older conversation. Nothing
            # is written; the next run drafts from the conversation as it is.
            if conversation_moved(sb, contact, read_at, channel):
                moved_on += 1
                log(f"followups: {contact}'s conversation moved on while the draft was written; the next run drafts again")
                continue
            # Switched off while the model wrote (up to two tries of 300 s):
            # nothing is put in front of the reps after the switch.
            if not test and not agent_still_on(sb):
                switched_off = True
                log("followups: the agent was switched off while a draft was written; it was not kept")
                break
            # A plain insert: the one-open-draft-per-lead index refuses a
            # second one if a rep's own run raced this one.
            try:
                made = sb.rest("POST", "cockpit_sales_followups", json_body=[{
                    "created_at": read_at.isoformat(),
                    "contact_id": contact, "owner_ghl": owner_ghl, "owner_email": seat_of.get(owner_ghl or ""),
                    "segment": segment, "channel": channel,
                    "template_key": (route or {}).get("key") if channel == "whatsapp_template" else None,
                    "touch": due["touch"], "heat": due["heat"], "appointment_id": due.get("appointment_id"),
                    "subject": draft["subject"], "body": draft["body"], "why": (dnd_note + draft["why"])[:300],
                    # The call's time as it was when this was written: a confirmation
                    # whose call moves since is closed (close_gone).
                    "context": {k: ctx.get(k) for k in ("lead", "calls_on_the_calendar", "rep_notes", "the_call")}
                               | {"heat": due["reasons"], "start_at": due.get("start_at")}
                               | ({"test": True} if test else {}),
                    "model": getattr(provider, "model", None), "status": "draft", "expires_at": expires.isoformat(),
                }], prefer="return=representation")
            except http.HttpError as e:
                if not _raced(e):
                    raise
                raced += 1
                log(f"followups: {contact} already has an open draft (another run wrote it); nothing more written")
                continue
            written += 1
            by_channel[channel] = by_channel.get(channel, 0) + 1
            log(f"followups: {segment} #{due['touch']} {channel} draft for {contact} (heat {due['heat']})")
            # Only a kind of message a manager has trusted goes without a person,
            # and it goes through the cockpit's own send with all its checks. A
            # test draft never does.
            new_id = str((made[0] if isinstance(made, list) and made else {}).get("id") or "")
            if test or not (autosend and new_id and (settings.get("autosend") or {}).get(segment) is True):
                continue
            if channel.startswith("whatsapp"):
                if not gate_read:
                    gate_read = True
                    try:
                        gate = wa_gate(guard if guard is not None else sb.setting("whatsapp_guard"))
                    except Exception:  # noqa: BLE001 - unreadable is closed
                        gate = GATE_CLOSED
                if gate:
                    kept += 1
                    warn(f"followups: {contact} kept for a person: {gate}")
                    continue
            if segment not in ("reply", "confirm") and due["touch"] == 1 and not in_hours(now, lead.get("country"), first_hours):
                kept += 1
                warn(f"followups: {contact} kept for a person: a first message goes between {int(first_hours[0])}:00 and "
                     f"{int(first_hours[1])}:00 on the lead's clock")
                continue
            try:
                out = autosend(new_id)
                if not out.get("ok") and str(out.get("code") or "") == "not_sent_yet":
                    # Nothing went (HighLevel or the database did not answer
                    # before the message row; stress2 round 5): asked once
                    # more, so a blip never leaves the draft to a person.
                    out = autosend(new_id)
                if out.get("ok"):
                    sent_auto += 1
                else:
                    warn(f"followups: {contact} kept for a person: {str(out.get('error'))[:160]}")
            except Exception as e:  # noqa: BLE001 - the draft is still there for a person
                warn(f"followups: {contact} kept for a person: {http.scrub(str(e))[:160]}")
        except NotNow:
            raise
        except Exception as e:  # noqa: BLE001 - one lead is not worth the rest
            failed += 1
            msg = http.scrub(str(e))[:200]
            warn(f"followups: {contact} failed: {msg}")
            if asking and channel:
                # Kept as a failed follow-up, so a lead the model fails on
                # twice in a day is set aside rather than paid for every run.
                try:
                    sb.rest("POST", "cockpit_sales_followups", prefer="return=minimal", json_body=[{
                        "contact_id": contact, "owner_ghl": owner_ghl, "owner_email": seat_of.get(owner_ghl or ""),
                        "segment": segment, "channel": channel, "touch": due["touch"], "heat": due["heat"],
                        "appointment_id": due.get("appointment_id"), "body": "No draft: the assistant could not write one.",
                        "why": "The assistant tried to write this message and could not.",
                        "model": getattr(provider, "model", None), "status": "failed", "decided_at": now.isoformat(),
                        "error": msg}])
                except Exception as e2:  # noqa: BLE001 - the warning above is the record then
                    warn(f"followups: {contact}'s failure could not be kept: {http.scrub(str(e2))[:160]}")
    return {"picked": len(picked), "written": written, "by_channel": by_channel, "sent_by_itself": sent_auto,
            **({"switched_off": "the follow-up agent was switched off during this run"} if switched_off else {}),
            "kept_for_a_person": kept, "held_for_automation": held, "in_a_conversation": talking,
            "already_answered": answered, "asked_to_stop": stopped, "paused": paused,
            "stops_unread": stop_rows is None, "conversation_unreadable": unread, "no_open_channel": no_channel,
            "not_sales_leads": not_leads, "set_aside": set_aside, "raced": raced, "failed": failed, "room": room,
            "moved_on_while_written": moved_on,
            **({"test": True} if test else {}),
            **{k: books.get(k, 0) for k in ("replies_marked", "went_stale", "reason_gone", "clients_closed", "stuck_freed")},
            "templates": books.get("templates", {"found": 0, "never_sent": 0}),
            "settled": books.get("settled", {"read": 0, "gone": 0, "failed": 0})}
