#!/usr/bin/env python3
"""Hala, the WhatsApp desk.

Scans the Mahara client account's conversations, keeps the ones that have
moved since the watermark, and drafts a reply in both languages for every
thread where the client spoke last.

Two things about this account that are not obvious and cost an afternoon
if you assume otherwise:

* **WhatsApp arrives as `TYPE_CUSTOM_SMS`.** There is no `TYPE_WHATSAPP`
  traffic at all. The bridge stamps its own markers into the body --
  ``🔁 Sent from another device`` on anything sent from the phone,
  ``>AUDIO<`` in place of a voice note, ``↩️ Replied to:`` around a quote.
  Filtering for a WhatsApp message type finds an empty account.
* **The history is not ours.** Aziz, 2026-09-20: everything before
  switch-on belongs to a previous CSM. Drafting from it would answer
  somebody else's conversation, so the watermark starts at switch-on and
  only ever moves forward.

Nothing here sends. Drafting and sending are deliberately separate: a
person reads the draft, edits it, and presses the button.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from tools import provider_json

DRY_RUN = True
OBSERVE_LIMIT = 200
WAITING_PAGE_SIZE = 100
WAITING_PAGE_LIMIT = 20
MAX_DRAFTS_PER_RUN = 40

GHL = "https://services.leadconnectorhq.com"
# Higgsfield and GoHighLevel both sit behind a Cloudflare bot rule that
# answers a default urllib agent 403 before the API sees the request.
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def note(line: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {line}", flush=True)


class Store:
    def __init__(self, *, apply: bool = False) -> None:
        self.base = os.environ["DESK_SUPABASE_URL"].rstrip("/")
        if self.base != "https://bldgtotkfmhoxmlzowdx.supabase.co":
            raise ValueError("The inbox target must be Creative Triage")
        self.key = os.environ["DESK_SUPABASE_KEY"]
        self.apply = apply
        self.planned_writes = 0

    def _call(self, method: str, path: str, body=None, prefer: str = ""):
        if method != "GET" and not self.apply:
            self.planned_writes += 1
            note(f"DRY_RUN: {method} {path.split('?', 1)[0]}")
            return []
        data = json.dumps(body).encode() if body is not None else None
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(
            f"{self.base}/rest/v1/{path}", data=data, method=method, headers=headers
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else []

    def get(self, path):
        return self._call("GET", path)

    def upsert(self, table: str, rows: list[dict], on_conflict: str = "id"):
        if not rows:
            return
        self._call(
            "POST",
            f"{table}?on_conflict={on_conflict}",
            rows,
            "resolution=merge-duplicates,return=minimal",
        )

    def patch(self, path: str, body: dict):
        self._call("PATCH", path, body, "return=minimal")

    def health(self, provider, method, resource, phase, status):
        self._call("POST", "cockpit_csm_provider_health", {
            "provider": provider, "method": method, "resource": resource,
            "phase": phase, "http_status": status,
        }, "return=minimal")

    def save_draft(self, thread, previous_drafted_at, draft):
        return self._call("POST", "rpc/cockpit_wa_worker_draft", {
            "p_thread": thread["id"], "p_inbound_at": thread["last_inbound_at"],
            "p_previous_drafted_at": previous_drafted_at, "p_draft": draft,
        })

    def publish_thread(self, thread, messages):
        return self._call("POST", "rpc/cockpit_wa_worker_thread", {
            "p_thread": thread, "p_messages": messages,
        })


def ghl(path: str, token: str, version: str = "2021-04-15", *, store: Store) -> dict:
    return provider_json(store, "ghl", "GET", GHL + path, {
        "Authorization": f"Bearer {token}", "Version": version,
        "Accept": "application/json", "User-Agent": UA,
    })


# The bridge's own markers. Stripped before a model reads the text, and
# used to work out what a message actually was.
SENT_ELSEWHERE = re.compile(r"\s*🔁\s*Sent from another device\s*\([^)]*\)\s*🔁\s*")
QUOTED = re.compile(r"^↩️\s*Replied to:\s*(.*?)\s*(?:↪️\s*Message:\s*(.*))?$", re.S)
# In a group the bridge stamps who spoke onto the front of every inbound
# message. It is the only place that information exists.
SPEAKER = re.compile(r"^👤\s*(.+?)\s*(?:\(([^)]*)\))?\s*\n+", re.S)


# Our own people posting into a group arrive as inbound, because the
# bridge reports anything not sent through GoHighLevel as incoming. Left
# alone, the desk decides the client is waiting and drafts a reply to a
# colleague.
OURS = re.compile(r"mahara", re.I)


def ours(speaker: str | None) -> bool:
    return bool(speaker and OURS.search(speaker))


def is_group(name: str, phone: str) -> bool:
    """Whether a thread is a WhatsApp group.

    GoHighLevel does not say. Every group here is bridged through a
    virtual Chinese number the bridge allocates per group, and is named
    with a 📢 by whoever set it up; real one-to-one chats carry the
    contact's own Gulf or regional number. Either sign is enough.
    """
    return phone.startswith("+86") or "📢" in name


def read_body(raw: str) -> tuple[str, str, str | None]:
    """Return (kind, clean text, speaker) for one bridged message."""
    text = SENT_ELSEWHERE.sub(" ", raw or "").strip()
    speaker = None
    m = SPEAKER.match(text)
    if m:
        speaker = m.group(1).strip()[:80]
        text = text[m.end():].strip()
    if text.startswith(">AUDIO<"):
        return "audio", "", speaker
    if text in (">IMAGE<", ">PHOTO<"):
        return "image", "", speaker
    if text.startswith(">") and text.endswith("<"):
        return "file", "", speaker
    q = QUOTED.match(text)
    if q:
        # Keep only what they actually said, not the line they quoted.
        return "quote", (q.group(2) or q.group(1) or "").strip(), speaker
    return "text", text, speaker


def iso(value) -> str | None:
    """GoHighLevel dates its two objects differently.

    A conversation's `lastMessageDate` is epoch milliseconds; a message's
    `dateAdded` is an ISO string. Reading one as the other silently drops
    every message, which looked exactly like an empty account.
    """
    if not value:
        return None
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
        except ValueError:
            return None
    try:
        return datetime.fromtimestamp(int(value) / 1000, timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


DRAFT_SYSTEM = """You draft the reply a Mahara account manager would send on
WhatsApp to a client of a Gulf marketing agency.

Return JSON only: {"ar": "...", "en": "...", "why": "one short line"}

Both languages carry the same message. `ar` is the one that will usually
be sent, so write it first and write it properly; `en` is the same reply
for an English-speaking contact, not a translation exercise.

How these messages actually read:
- Short. Two or three lines. This is WhatsApp, not email.
- No greeting stack. No "Dear", no "I hope this message finds you well".
- Plain and specific. If they asked when something lands, give a day or
  say when you will know. Never "soon", never "shortly".
- Arabic is Gulf, not Modern Standard. Write it the way a Kuwaiti or
  Saudi account manager types it.
- Never promise a date, a number or a deliverable that is not already in
  the thread. If the answer needs something you do not have, the reply
  says you are checking and when you will come back.
- No emoji unless the client used them first.
- Never apologise more than once, and never for existing.

`why` is for the person about to press send: one line on what this is
answering, so a wrong draft is obvious without reading the thread again.

Some of these are **group chats** with the client's own people in them.
You are told when. In a group: answer the person who spoke, by name if
they were named, and remember the client's whole side is reading. Never
discuss money, another client, or anything internal in a group.
"""


def deepseek(store: Store, system: str, user: str, *, max_tokens: int = 1200) -> str:
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("DEEPSEEK_API_KEY is not set")
    body = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }
    out = provider_json(store, "deepseek", "POST", "https://api.deepseek.com/chat/completions",
                        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, body)
    return out["choices"][0]["message"]["content"]


def only_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?|\n?```$", "", text).strip()
    start = min((i for i in (text.find("{"), text.find("[")) if i != -1), default=-1)
    if start == -1:
        raise ValueError("no JSON in that answer")
    return json.loads(text[start:])


def scan(sb: Store, token: str, location: str, since: str) -> tuple[int, int]:
    """Pull conversations that moved since the watermark. Returns (threads, messages)."""
    found = sb.get(f"wa_state?select=scan_since&location_id=eq.{urllib.parse.quote(location)}")
    cutoff = datetime.fromisoformat(str(found[0]["scan_since"])) if found else datetime.fromisoformat(since)

    page, threads, messages = 0, 0, 0
    while page < 20:
        data = ghl(
            f"/conversations/search?locationId={urllib.parse.quote(location)}"
            f"&limit=100&offset={page * 100}&sort=desc&sortBy=last_message_date",
            token, store=sb,
        )
        convs = data.get("conversations")
        if not isinstance(convs, list):
            raise ValueError("The provider conversation page is missing")
        if not convs:
            break

        stop = False
        for cv in convs:
            last = iso(cv.get("lastMessageDate")) or iso(cv.get("dateUpdated"))
            if last and datetime.fromisoformat(last) < cutoff:
                # Sorted newest first, so the first one older than the
                # watermark means everything after it is older too.
                stop = True
                break
            threads += 1
            messages += pull_thread(sb, token, location, cv, cutoff)
        if stop or len(convs) < 100:
            break
        page += 1
    else:
        raise ValueError("The conversation scan reached its safety bound. Do not publish a healthy scan")
    return threads, messages


def messages_since(sb: Store, token: str, cid: str, cutoff) -> list[dict]:
    result, seen, cursor = [], set(), None
    for _ in range(20):
        path = f"/conversations/{urllib.parse.quote(cid)}/messages?limit=50&type=TYPE_CUSTOM_SMS"
        if cursor:
            path += "&lastMessageId=" + urllib.parse.quote(cursor)
        data = ghl(path, token, store=sb)
        raw = data.get("messages")
        page = raw.get("messages") if isinstance(raw, dict) else raw
        if not isinstance(page, list):
            raise ValueError("The provider message page is missing")
        crossed_watermark = False
        for message in page:
            mid, at = message.get("id"), iso(message.get("dateAdded"))
            if not isinstance(mid, str) or not mid or mid in seen or at is None:
                raise ValueError("The provider page contains a missing or repeated message identity")
            seen.add(mid)
            if datetime.fromisoformat(at) < cutoff:
                crossed_watermark = True
            else:
                result.append(message)
        more = raw.get("nextPage") if isinstance(raw, dict) else None
        if crossed_watermark or more is False or (more is not True and len(page) < 50):
            return result
        if not page:
            raise ValueError("The provider cursor did not advance")
        cursor = page[-1]["id"]
    raise ValueError("The message scan reached its safety bound. Do not publish a healthy scan")


def pull_thread(sb: Store, token: str, location: str, cv: dict, cutoff) -> int:
    cid, contact = cv.get("id"), cv.get("contactId")
    if not isinstance(cid, str) or not cid or not isinstance(contact, str) or not contact:
        raise ValueError("The provider conversation or contact identity is missing")
    existing = sb.get(f"wa_threads?select=id,provider_id,last_at,last_inbound_at,last_outbound_at&id=eq.{urllib.parse.quote(cid)}")
    previous = existing[0] if existing else {}
    msgs = messages_since(sb, token, cid, cutoff)

    rows, newest_in, newest_out, newest = [], previous.get("last_inbound_at"), previous.get("last_outbound_at"), previous.get("last_at")
    provider = previous.get("provider_id")
    for m in msgs:
        at = iso(m.get("dateAdded"))
        if not at or datetime.fromisoformat(at) < cutoff:
            continue
        mid = m.get("id")
        if not isinstance(mid, str) or not mid or m.get("direction") not in ("inbound", "outbound"):
            raise ValueError("The provider message identity or direction is missing")
        provider = m.get("conversationProviderId") or provider
        kind, text, speaker = read_body(str(m.get("body") or ""))
        direction = m["direction"]
        status = m.get("status")
        delivery_status = status if direction == "outbound" and status in ("pending", "sent", "delivered", "read", "failed") else None
        rows.append({
            "id": mid, "thread_id": cid, "direction": direction,
            "body": text, "kind": kind, "speaker": speaker, "at": at,
            "delivery_status": delivery_status,
        })
        newest = later(newest, at)
        if direction == "inbound" and not ours(speaker):
            newest_in = later(newest_in, at)
        elif direction == "inbound" or delivery_status in ("delivered", "read"):
            newest_out = later(newest_out, at)
    if not rows:
        return 0

    name = str(cv.get("fullName") or cv.get("contactName") or "")
    phone = str(cv.get("phone") or "")
    sb.publish_thread({
        "id": cid,
        "location_id": location,
        "is_group": is_group(name, phone),
        "contact_id": contact,
        "contact_name": name[:120] or None,
        "phone": phone[:40] or None,
        "provider_id": provider,
        "last_at": newest,
        "last_inbound_at": newest_in,
        "last_outbound_at": newest_out,
        # They spoke last, so it is on us. GHL's unread count treats our
        # own sends from the phone as reads and gets this wrong.
        "awaiting_us": bool(newest_in and (not newest_out or datetime.fromisoformat(newest_in) > datetime.fromisoformat(newest_out))),
        "updated_at": now(),
    }, rows)
    return len(rows)

def later(left: str | None, right: str) -> str:
    return right if left is None or datetime.fromisoformat(right) > datetime.fromisoformat(left) else left


def observe_submitted(sb: Store, token: str, location: str) -> int:
    location_key = urllib.parse.quote("context->>locationId", safe="")
    intents = sb.get(
        "cockpit_wa_reply_intents?select=id,thread_id,provider_message_id,context"
        f"&state=eq.accepted&{location_key}=eq.{urllib.parse.quote(location)}"
        f"&order=accepted_at.asc&limit={OBSERVE_LIMIT + 1}"
    )
    if len(intents) > OBSERVE_LIMIT:
        raise ValueError("The submitted-message observation reached its safety bound")
    observed = 0
    for intent in intents:
        context = intent["context"]
        if context.get("locationId") != location:
            continue
        mid = intent["provider_message_id"]
        message = ghl(f"/conversations/messages/{urllib.parse.quote(mid)}", token, version="2023-02-21", store=sb)
        if (message.get("id") != mid or message.get("conversationId") != intent["thread_id"]
                or message.get("locationId") != location or message.get("contactId") != context.get("contactId")
                or message.get("conversationProviderId") != context.get("providerId")
                or message.get("direction") != "outbound" or message.get("messageType") != "TYPE_CUSTOM_SMS"):
            raise ValueError("The provider delivery observation does not match the submitted WhatsApp message")
        status = message.get("status")
        if status not in ("pending", "sent", "delivered", "read", "failed"):
            continue
        thread_id = urllib.parse.quote(intent["thread_id"])
        message_id = urllib.parse.quote(mid)
        current_rows = sb.get(
            f"wa_messages?select=delivery_status&id=eq.{message_id}"
            f"&thread_id=eq.{thread_id}&limit=1"
        )
        if len(current_rows) != 1:
            raise ValueError("The mirrored outbound message is missing or ambiguous")
        current = current_rows[0].get("delivery_status")
        if current not in (None, "pending", "sent", "delivered", "read", "failed"):
            raise ValueError("The mirrored outbound delivery status is invalid")
        if current == status or current == "read" or (current == "delivered" and status != "read"):
            continue
        current_filter = "is.null" if current is None else f"eq.{urllib.parse.quote(current)}"
        sb.patch(
            f"wa_messages?id=eq.{message_id}&thread_id=eq.{thread_id}"
            f"&delivery_status={current_filter}",
            {"delivery_status": status},
        )
        observed += 1
    return observed


def draft_for(sb: Store, thread: dict) -> bool:
    """Write the reply for one thread. False when there is nothing to answer."""
    tid = thread["id"]
    previous = sb.get(f"wa_drafts?select=drafted_at&thread_id=eq.{urllib.parse.quote(tid)}")
    previous_drafted_at = previous[0]["drafted_at"] if previous else None
    msgs = sb.get(
        f"wa_messages?select=direction,body,kind,speaker,at"
        f"&thread_id=eq.{urllib.parse.quote(tid)}&order=at.desc&limit=14"
    )
    if not msgs:
        return False
    msgs = list(reversed(msgs))

    last_in = next(
        (m for m in reversed(msgs)
         if m["direction"] == "inbound" and not ours(m.get("speaker"))),
        None,
    )
    if not last_in:
        return False
    if last_in["kind"] == "audio" and not (last_in.get("body") or "").strip():
        # A voice note is the commonest last message here and we cannot
        # hear it. Guessing a reply to an unread message is worse than
        # saying plainly that somebody has to listen.
        return bool(sb.save_draft(thread, previous_drafted_at, {
            "ar": None, "en": None,
            "why": "Their last message is a voice note. Listen to it in WhatsApp first.",
            "based_on": "(voice note)", "model": "none",
        }))

    lines = []
    for m in msgs:
        who = "CLIENT" if m["direction"] == "inbound" else "US"
        if ours(m.get("speaker")):
            who = f"US ({m['speaker']})"
        elif m.get("speaker"):
            who = str(m["speaker"])
        body = (m.get("body") or "").strip()
        if not body:
            body = {"audio": "(voice note)", "image": "(image)",
                    "file": "(attachment)"}.get(m["kind"], "(empty)")
        lines.append(f"{who}: {body[:400]}")

    where = (
        "A GROUP CHAT with the client's own team in it."
        if thread.get("is_group")
        else "A one-to-one chat."
    )
    answer = deepseek(
        sb,
        DRAFT_SYSTEM,
        f"CONTACT: {thread.get('contact_name') or 'unknown'}\n"
        f"WHERE: {where}\n\n"
        f"THE THREAD, oldest first:\n" + "\n".join(lines[-14:]) +
        "\n\nDraft the reply to their last message.",
    )
    parsed = only_json(answer)
    ar = str(parsed.get("ar") or "").strip()
    en = str(parsed.get("en") or "").strip()
    if not ar and not en:
        raise ValueError("the model returned no reply")

    return bool(sb.save_draft(thread, previous_drafted_at, {
        "ar": ar or None, "en": en or None,
        "why": str(parsed.get("why") or "")[:300] or None,
        "based_on": (last_in.get("body") or "")[:300], "model": "deepseek-chat",
    }))


def main() -> int:
    parser = argparse.ArgumentParser(description="Native CSM inbox. Dry-run by default. Never sends messages.")
    parser.add_argument("--apply", action="store_true", default=not DRY_RUN, help="Apply source writes and generate drafts. Requires approval for this run.")
    parser.add_argument("--source-only", action="store_true", help="Mirror provider changes and advance the watermark; skip delivery observations and drafts.")
    parser.add_argument("--doctor", action="store_true")
    args = parser.parse_args()
    required = ["GHL_MAHARA_PIT", "GHL_MAHARA_LOCATION", "DESK_SUPABASE_URL", "DESK_SUPABASE_KEY"]
    if args.apply and not args.source_only:
        required.append("DEEPSEEK_API_KEY")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        note("Missing configuration: " + ", ".join(missing))
        return 2
    token, location = os.environ["GHL_MAHARA_PIT"], os.environ["GHL_MAHARA_LOCATION"]
    sb = Store(apply=args.apply)
    state = sb.get(f"wa_state?select=*&location_id=eq.{urllib.parse.quote(location)}")
    if not state:
        note("no watermark for this location; refusing to scan the whole history")
        return 2
    floor = datetime(2026, 9, 20, tzinfo=timezone.utc)
    watermark = datetime.fromisoformat(state[0]["scan_since"])
    if watermark.tzinfo is None or watermark < floor:
        note("The watermark predates switch-on. Refusing to draft old conversations.")
        return 2
    connection = sb.get("cockpit_wa_connections?select=app,desk,enabled,location_id&app=eq.client-success")
    if len(connection) != 1 or not connection[0]["enabled"] or connection[0]["location_id"] != location:
        note("The native CSM connection does not match this location. Do not use another desk inbox.")
        return 2
    if args.doctor:
        note("Native inbox configuration, CSM connection, and switch-on watermark are valid. No scan or model call ran.")
        return 0

    begun_at = now()
    threads, messages = scan(sb, token, location, state[0]["scan_since"])
    note(f"scanned: {threads} thread(s) moved, {messages} new message(s)")
    if not args.source_only:
        observed = observe_submitted(sb, token, location)
        note(f"Delivery observations: {observed}. Only delivered/read confirms delivery.")
    if not sb.apply:
        note(f"DRY_RUN complete: {sb.planned_writes} planned writes. No drafts, heartbeat, or model call was applied.")
        return 0

    drafted = failed = 0
    waiting_count = 0
    eligible_attempts = 0
    eligible_remainder = page_cap = False
    if not args.source_only:
        base = (
            "wa_threads?select=id,contact_name,is_group,last_inbound_at"
            f"&location_id=eq.{urllib.parse.quote(location)}&desk=eq.csm&awaiting_us=is.true&archived=is.false"
            f"&last_inbound_at=gte.{urllib.parse.quote(state[0]['scan_since'])}&order=last_inbound_at.desc,id.desc"
        )
        for page in range(WAITING_PAGE_LIMIT):
            waiting = sb.get(f"{base}&limit={WAITING_PAGE_SIZE}&offset={page * WAITING_PAGE_SIZE}")
            if not waiting:
                break
            waiting_count += len(waiting)
            for t in waiting:
                existing = sb.get(
                    f"wa_drafts?select=drafted_at&thread_id=eq.{urllib.parse.quote(t['id'])}"
                )
                # Redraft only when they have said something since the last draft.
                if existing and datetime.fromisoformat(existing[0]["drafted_at"]) >= datetime.fromisoformat(t["last_inbound_at"]):
                    continue
                if eligible_attempts >= MAX_DRAFTS_PER_RUN:
                    eligible_remainder = True
                    break
                eligible_attempts += 1
                try:
                    if draft_for(sb, t):
                        drafted += 1
                except Exception as e:  # one bad thread must not stop the desk
                    failed += 1
                    note(f"Draft unavailable: {type(e).__name__}. Check the provider health ledger.")
            if eligible_remainder or len(waiting) < WAITING_PAGE_SIZE:
                break
        else:
            page_cap = True

    if failed or eligible_remainder or page_cap:
        if failed:
            note(f"{failed} draft(s) failed. The scan watermark was not advanced, so the next run can retry them.")
        if eligible_remainder:
            note("More eligible threads remain. The scan watermark was not advanced so the next run can continue.")
        if page_cap:
            note("Waiting-thread pagination reached its safety bound. The scan watermark was not advanced.")
        return 1

    sb.patch(
        f"wa_state?location_id=eq.{urllib.parse.quote(location)}",
        {"last_scan": now(), "scan_since": begun_at},
    )
    if args.source_only:
        note("Source-only run complete. Delivery observations and drafts were skipped.")
    else:
        note(f"{waiting_count} waiting on us, {drafted} drafted, {failed} failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
