"""The follow-up agent: it finds the leads who need a message now, writes one
from everything the cockpit knows about them, and puts it in front of the
lead's rep to approve. Nothing reaches a lead until a person says yes, unless
a manager has switched that kind of message to send by itself.

Aziz, 2026-09-24: "an agent ... that goes into our CRM and actually follows
up ... with context on their specific situation, with the history, the call
we had, and anything it has in terms of data. Also, it should be able to do
that for the first few days with approval, and even for long-term leads as
well, until it's fully trained. They can just approve it, and it goes
straight up. The sales manager should be able to see it as well."

Who, in this order (one open draft per lead, a day's quiet after any send):
- reply: they wrote in the last 48 hours and nobody answered;
- no_show: missed an intro or demo in the last 3 days, nothing rebooked;
- new: came in during the last 3 days, not reached, at most 3 touches;
- after_call: a demo showed in the last 2 days, no deal since;
- nurture: in a nurture stage, last touched a week ago or more.

How: WhatsApp only while the lead's 24-hour window is open (they wrote in
the last day), otherwise email when there is an address, otherwise nothing
(said in the run's count, not guessed around). The words follow Aziz's
spoken-Gulf voice rules for Arabic, mirror the lead's own language, never
invent a number, price, result or promise, and carry one next step. Edits
reps made to earlier drafts are shown to the model as what good looks like.

Lead data goes to OpenAI only, never to DeepSeek.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http

KUWAIT = timedelta(hours=3)
GHL = "https://services.leadconnectorhq.com"
LOCATION = "7NI8yyJtwsh2OOWA5Icr"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
SEGMENTS = ("reply", "no_show", "new", "after_call", "nurture")

VOICE = """How Mahara writes to a lead:
- Answer in the language the lead uses with us. If they write Arabic, write spoken Gulf Arabic
  (Kuwaiti or Saudi, as they speak), casual and respectful, never textbook Arabic, never hype.
- Short. WhatsApp: two to four short lines. Email: a subject and three short paragraphs at most.
- One clear next step (confirm a time, pick a new slot, answer one question, open the deck).
- Speak to their situation: what they told us, what happened on the call. No generic templates.
- Never invent a number, price, result, client name, discount or promise. If a figure is needed
  and not in the facts, leave it out. Mahara's only approved proof line is «أكثر من ٧٠ شركة بالخليج».
- Say «دولار», never put $ inside Arabic text. No em-dashes. No emojis beyond one at most.
- Never pretend to be the lead's friend or invent urgency ("last chance", fake deadlines).
- Never propose a specific day or time: the rep's calendar is not in front of you. Ask when suits
  them, or offer "today or tomorrow" in words.
- In Arabic text write numbers in Arabic-Indic digits, all of them.
- Email: sign with the rep's first name as given in the facts ("rep"); if no rep is given, sign
  nothing. WhatsApp needs no signature. Never sign as anyone else."""

GOAL = {
    "reply": "They wrote to us and nobody has answered. Answer what they asked, then move them to the next step.",
    "no_show": "They missed their call. No blame. Offer to find a new time that suits them.",
    "new": "They just came in and we have not reached them. Introduce the rep briefly and get the intro call booked.",
    "after_call": "They had the demo and have not signed. Follow up on the one thing that mattered on the call.",
    "nurture": "A long-term lead. A short, useful check-in about their situation; no pressure, one soft question.",
}

SYSTEM = """You write one follow-up message from a Mahara Media sales rep to a lead.
Mahara brings construction, architecture, interior design and fit-out firms in the Gulf
qualified project leads through paid ads.

{voice}

Why this lead now: {goal}

Answer with one JSON object only:
{{"body": str, "subject": str | null, "why": str, "language": "ar" | "en"}}
- body: the message itself, ready to send.
- subject: for email only; null for WhatsApp.
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
    try:
        t = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def channel_for(lead: dict[str, Any], last_inbound_wa: Optional[datetime], now: datetime) -> Optional[str]:
    """WhatsApp inside the 24-hour window, else email if there is one, else nothing."""
    if lead.get("dnd"):
        return None
    if last_inbound_wa and now - last_inbound_wa < timedelta(hours=23):
        return "whatsapp"
    if str(lead.get("email") or "").strip():
        return "email"
    return None


def pick(now: datetime, *, inbox: list[dict[str, Any]], calendar: list[dict[str, Any]], leads: list[dict[str, Any]],
         sends: list[dict[str, Any]], open_drafts: set[str], deals: set[str], nurture_every_days: int = 7,
         recent_dials: set[str] = frozenset()) -> list[tuple[str, str]]:
    """(contact_id, segment) for everyone who needs a message now, most urgent first,
    each lead once. `sends` are recent cockpit sends and follow-ups; `recent_dials`
    leads someone called in the last day."""
    touched = {str(s["contact_id"]) for s in sends if _ts(s.get("created_at")) and now - _ts(s["created_at"]) < timedelta(hours=22)}
    out: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(cid: Any, seg: str) -> None:
        c = str(cid or "")
        if c and c not in seen and c not in open_drafts and c not in touched:
            seen.add(c)
            out.append((c, seg))

    for r in sorted(inbox, key=lambda r: str(r.get("last_message_at") or ""), reverse=True):
        t = _ts(r.get("last_message_at"))
        if r.get("last_direction") == "inbound" and t and now - t < timedelta(hours=48):
            add(r.get("contact_id"), "reply")
    booked_after: dict[str, datetime] = {}
    for a in calendar:
        t = _ts(a.get("start_at"))
        if t and a.get("status") not in ("cancelled", "noshow") and t > now:
            c = str(a.get("contact_id") or "")
            booked_after[c] = max(booked_after.get(c, t), t)
    for a in sorted(calendar, key=lambda a: str(a.get("start_at") or ""), reverse=True):
        t = _ts(a.get("start_at"))
        c = str(a.get("contact_id") or "")
        if not t or not c:
            continue
        if a.get("status") == "noshow" and now - t < timedelta(days=3) and c not in booked_after:
            add(c, "no_show")
    by_contact_touches: dict[str, int] = {}
    for s in sends:
        by_contact_touches[str(s["contact_id"])] = by_contact_touches.get(str(s["contact_id"]), 0) + 1
    for lead in sorted(leads, key=lambda l: str(l.get("lead_created_at") or ""), reverse=True):
        c = str(lead.get("contact_id") or "")
        t = _ts(lead.get("lead_created_at"))
        if t and now - t < timedelta(days=3) and c not in recent_dials and by_contact_touches.get(c, 0) < 3 \
                and lead.get("lead_class") in ("qualified", "unqualified"):
            add(c, "new")
    for a in calendar:
        t = _ts(a.get("start_at"))
        c = str(a.get("contact_id") or "")
        if a.get("call_type") == "demo" and a.get("status") == "showed" and t and now - t < timedelta(days=2) \
                and c not in deals:
            add(c, "after_call")
    for lead in leads:
        c = str(lead.get("contact_id") or "")
        if "nurture" in str(lead.get("stage_name") or "").lower():
            last = _ts(lead.get("last_touch_at"))
            if not last or now - last >= timedelta(days=nurture_every_days):
                add(c, "nurture")
    return out


# ---------------------------------------------------------------------------
# What the agent is told about one lead
# ---------------------------------------------------------------------------

def _q(v: str) -> str:
    return http.quote(v)


def ghl_thread(token: str, contact_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """The lead's last messages across their HighLevel conversations, oldest first."""
    if not token:
        return []
    h = {"Authorization": f"Bearer {token}", "Version": "2021-04-15", "Accept": "application/json", "User-Agent": UA}
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
            if body:
                msgs.append({"at": m.get("dateAdded"), "from": "lead" if m.get("direction") == "inbound" else "us",
                             "channel": str(m.get("messageType") or "").replace("TYPE_", "").lower(), "text": body[:600]})
    msgs.sort(key=lambda m: str(m.get("at") or ""))
    return msgs[-limit:]


def context_for(sb: Any, lead: dict[str, Any], ghl_token: str, now: datetime,
                rep_name: Optional[str] = None) -> dict[str, Any]:
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
    research = sb.select("cockpit_sales_research",
                         f"select=brief&contact_id=eq.{_q(c)}&status=eq.ready&order=requested_at.desc&limit=1")
    try:
        thread = ghl_thread(ghl_token, c)
    except Exception:  # noqa: BLE001 - the rest of the story still helps
        thread = []
    brief = (research[0].get("brief") if research else None) or {}
    return {
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
        "research": {"company": (brief.get("company") or {}).get("summary"),
                     "talking_points": brief.get("talking_points")} if brief else None,
        "conversation": thread,
        "now_kuwait": kuwait_now(now).strftime("%A %d %B %Y, %H:%M"),
        # Who the message is from: the lead's own rep, by first name, or nobody.
        "rep": (rep_name or "").split(" ")[0] or None,
    }


def examples_block(approved: list[dict[str, Any]]) -> str:
    """Rep-approved messages of this kind, the edited ones first: what good looks like here."""
    if not approved:
        return ""
    lines = ["", "Messages reps approved before for this kind of lead (match their tone and length, not their facts):"]
    for a in approved[:5]:
        lines.append(f"- ({a.get('channel')}) {str(a.get('final_body') or a.get('body') or '')[:500]}")
    return "\n".join(lines)


def parse_draft(text: str, channel: str) -> Optional[dict[str, Any]]:
    """The model's JSON, checked: a body, a subject for email, one sentence of why."""
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
    if not body or not why or len(body) > (4000 if channel == "whatsapp" else 8000):
        return None
    if channel == "email" and not subject:
        return None
    if re.search(r"\$\s*\d", body) and re.search(r"[؀-ۿ]", body):
        return None  # a $ inside Arabic text flips; the rules say دولار
    return {"body": body, "subject": subject if channel == "email" else None, "why": why[:300],
            "language": "ar" if re.search(r"[؀-ۿ]", body) else "en"}


def run(sb: Any, provider: Any, log: Callable[[str], None], *, settings: dict[str, Any], ghl_token: str,
        now: Optional[datetime] = None, autosend: Optional[Callable[[str], dict[str, Any]]] = None) -> dict[str, Any]:
    """One pass: pick the leads, write the drafts, put them in front of the reps."""
    now = now or datetime.now(timezone.utc)
    if not settings.get("enabled", True):
        return {"skipped": "the follow-up agent is switched off"}
    if quiet(now, settings.get("quiet") or {}):
        return {"skipped": "quiet hours"}
    today = (kuwait_now(now).replace(hour=0, minute=0, second=0, microsecond=0) - KUWAIT).isoformat()
    written_today = len(sb.select("cockpit_sales_followups", f"select=id&created_at=gte.{_q(today)}&limit=500"))
    room = min(int(settings.get("per_run", 12)), int(settings.get("per_day", 60)) - written_today)
    if room <= 0:
        return {"skipped": f"today's {settings.get('per_day', 60)} drafts are written"}

    since3 = (now - timedelta(days=3)).isoformat()
    inbox = sb.select("cockpit_sales_inbox", f"select=contact_id,last_message_at,last_direction,last_type,inbound_whatsapp_at"
                                             f"&last_message_at=gte.{_q((now - timedelta(days=2)).isoformat())}&limit=500")
    calendar = sb.select("cockpit_sales_calendar", f"select=contact_id,call_type,start_at,status"
                                                   f"&start_at=gte.{_q(since3)}&limit=1000")
    leads = sb.select("cockpit_sales_leads", "select=*&or=" + _q(f'(lead_created_at.gte."{since3}",stage_name.ilike.*nurture*)')
                      + "&limit=2000")
    sends = sb.select("cockpit_sales_messages", f"select=contact_id,created_at&created_at=gte.{_q((now - timedelta(days=14)).isoformat())}&limit=2000")
    drafts = sb.select("cockpit_sales_followups", "select=contact_id,created_at,status&status=in.(draft,sending,sent)"
                                                  f"&created_at=gte.{_q((now - timedelta(days=14)).isoformat())}&limit=2000")
    open_drafts = {str(d["contact_id"]) for d in drafts if d["status"] in ("draft", "sending")}
    sent_followups = [d for d in drafts if d["status"] == "sent"]
    deals = {str(d["contact_id"]) for d in sb.select("cockpit_sales_deals", f"select=contact_id&submitted_at=gte.{_q(since3)}&limit=500")
             if d.get("contact_id")}
    recent_dials = {str(d["contact_id"]) for d in sb.select(
        "cockpit_sales_dials", f"select=contact_id&state=eq.completed&occurred_at=gte.{_q((now - timedelta(days=1)).isoformat())}&limit=1000")
        if d.get("contact_id")}
    # When a nurture lead was last touched: our sends, or the inbox's last message.
    last_touch: dict[str, str] = {}
    for s in sends + sent_followups:
        last_touch[str(s["contact_id"])] = max(last_touch.get(str(s["contact_id"]), ""), str(s.get("created_at") or ""))
    for r in inbox:
        last_touch[str(r["contact_id"])] = max(last_touch.get(str(r["contact_id"]), ""), str(r.get("last_message_at") or ""))
    for lead in leads:
        lead["last_touch_at"] = last_touch.get(str(lead["contact_id"])) or None

    picked = pick(now, inbox=inbox, calendar=calendar, leads=leads, sends=sends + sent_followups,
                  open_drafts=open_drafts, deals=deals, recent_dials=recent_dials,
                  nurture_every_days=int(settings.get("nurture_every_days", 7)))
    by_id = {str(l["contact_id"]): l for l in leads}
    people = sb.select("cockpit_sales_people", "select=email,ghl_user_id,active&active=eq.true&limit=200")
    seat_of = {str(p["ghl_user_id"]): str(p["email"]) for p in people if p.get("ghl_user_id")}
    reps = sb.select("cockpit_sales_reps", "select=ghl_user_id,display_name&limit=200")
    rep_name_of = {str(r["ghl_user_id"]): str(r.get("display_name") or "") for r in reps if r.get("ghl_user_id")}

    written = no_channel = failed = sent_auto = 0
    for contact, segment in picked:
        if written >= room:
            break
        lead = by_id.get(contact) or next(iter(sb.select("cockpit_sales_leads", f"select=*&contact_id=eq.{_q(contact)}&limit=1")), None)
        if not lead or lead.get("dnd"):
            continue
        try:
            ctx = context_for(sb, lead, ghl_token, now, rep_name_of.get(str(lead.get("assigned_to") or "")))
            ins = [_ts(m["at"]) for m in ctx["conversation"]
                   if m["from"] == "lead" and m["channel"] == "whatsapp" and _ts(m.get("at"))]
            ins += [_ts(r.get("inbound_whatsapp_at")) for r in inbox
                    if str(r.get("contact_id")) == contact and _ts(r.get("inbound_whatsapp_at"))]
            last_wa_in = max((t for t in ins if t), default=None)
            channel = channel_for(lead, last_wa_in, now)
            if not channel:
                no_channel += 1
                continue
            approved = sb.select("cockpit_sales_followups", f"select=channel,body,final_body,edited&segment=eq.{segment}"
                                                            "&status=eq.sent&order=edited.desc,decided_at.desc&limit=5")
            system = SYSTEM.format(voice=VOICE, goal=GOAL[segment], examples=examples_block(approved))
            user = (f"Channel: {channel}\n\nWhat we know about this lead:\n"
                    + json.dumps(ctx, ensure_ascii=False, indent=1, default=str)[:24000])
            draft = None
            for _ in range(2):
                reply = provider.complete(system, user, temperature=None, timeout=300)
                draft = parse_draft(reply.text, channel)
                if draft:
                    break
            if not draft:
                raise ValueError("the model did not return a usable draft")
            owner_ghl = str(lead.get("assigned_to") or "") or None
            expires = (last_wa_in + timedelta(hours=24)) if channel == "whatsapp" and last_wa_in else now + timedelta(hours=48)
            # A plain insert: the one-open-draft-per-lead index refuses a
            # second one if a rep's own run raced this one.
            made = sb.rest("POST", "cockpit_sales_followups", json_body=[{
                "contact_id": contact, "owner_ghl": owner_ghl, "owner_email": seat_of.get(owner_ghl or ""),
                "segment": segment, "channel": channel, "subject": draft["subject"], "body": draft["body"],
                "why": draft["why"], "context": {k: ctx[k] for k in ("lead", "calls_on_the_calendar", "rep_notes")},
                "model": getattr(provider, "model", None), "status": "draft", "expires_at": expires.isoformat(),
            }], prefer="return=representation")
            written += 1
            log(f"followups: {segment} {channel} draft for {contact}")
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
        except Exception as e:  # noqa: BLE001 - one lead is not worth the rest
            failed += 1
            log(f"followups: {contact} failed: {http.scrub(str(e))[:200]}")
    return {"picked": len(picked), "written": written, "sent_by_itself": sent_auto,
            "no_open_channel": no_channel, "failed": failed, "room": room}
