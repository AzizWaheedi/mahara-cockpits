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

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

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
    def __init__(self) -> None:
        self.base = os.environ["DESK_SUPABASE_URL"].rstrip("/")
        self.key = os.environ["DESK_SUPABASE_KEY"]

    def _call(self, method: str, path: str, body=None, prefer: str = ""):
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


def ghl(path: str, token: str, version: str = "2021-04-15") -> dict:
    req = urllib.request.Request(
        GHL + path,
        headers={
            "Authorization": f"Bearer {token}",
            "Version": version,
            "Accept": "application/json",
            "User-Agent": UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GHL {e.code}: {e.read().decode()[:200]}") from e


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


def deepseek(system: str, user: str, *, max_tokens: int = 1200) -> str:
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
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.loads(r.read().decode())
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
            token,
        )
        convs = data.get("conversations") or []
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
        if stop:
            break
        page += 1
    return threads, messages


def pull_thread(sb: Store, token: str, location: str, cv: dict, cutoff) -> int:
    cid = str(cv.get("id"))
    data = ghl(f"/conversations/{urllib.parse.quote(cid)}/messages?limit=50", token)
    raw = data.get("messages")
    msgs = raw.get("messages") if isinstance(raw, dict) else (raw or [])

    rows, newest_in, newest_out, newest = [], None, None, None
    provider = None
    for m in msgs or []:
        at = iso(m.get("dateAdded"))
        if not at or datetime.fromisoformat(at) < cutoff:
            continue
        provider = provider or m.get("conversationProviderId")
        kind, text, speaker = read_body(str(m.get("body") or ""))
        direction = "inbound" if m.get("direction") == "inbound" else "outbound"
        rows.append({
            "id": str(m.get("id")),
            "thread_id": cid,
            "direction": direction,
            "body": text,
            "kind": kind,
            "speaker": speaker,
            "at": at,
        })
        newest = max(newest or at, at)
        # A Mahara name on a group message means it was one of ours, so it
        # counts as us having spoken however the bridge labelled it.
        if direction == "inbound" and not ours(speaker):
            newest_in = max(newest_in or at, at)
        else:
            newest_out = max(newest_out or at, at)

    if not rows:
        return 0

    name = str(cv.get("fullName") or cv.get("contactName") or "")
    phone = str(cv.get("phone") or "")
    sb.upsert("wa_threads", [{
        "id": cid,
        "location_id": location,
        "is_group": is_group(name, phone),
        "contact_id": str(cv.get("contactId") or ""),
        "contact_name": name[:120] or None,
        "phone": phone[:40] or None,
        "provider_id": provider,
        "last_at": newest,
        "last_inbound_at": newest_in,
        "last_outbound_at": newest_out,
        # They spoke last, so it is on us. GHL's unread count treats our
        # own sends from the phone as reads and gets this wrong.
        "awaiting_us": bool(newest_in and (not newest_out or newest_in > newest_out)),
        "updated_at": now(),
    }])
    sb.upsert("wa_messages", rows)
    return len(rows)


def draft_for(sb: Store, thread: dict) -> bool:
    """Write the reply for one thread. False when there is nothing to answer."""
    tid = thread["id"]
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
        sb.upsert("wa_drafts", [{
            "thread_id": tid,
            "ar": None, "en": None,
            "why": "Their last message is a voice note. Listen to it in WhatsApp first.",
            "based_on": "(voice note)",
            "model": "none",
            "drafted_at": now(),
        }], on_conflict="thread_id")
        return True

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

    sb.upsert("wa_drafts", [{
        "thread_id": tid,
        "ar": ar or None,
        "en": en or None,
        "why": str(parsed.get("why") or "")[:300] or None,
        "based_on": (last_in.get("body") or "")[:300],
        "model": "deepseek-chat",
        "drafted_at": now(),
        # A new inbound invalidates whatever was sent before it.
        "sent_at": None, "sent_by": None, "sent_lang": None, "sent_body": None,
    }], on_conflict="thread_id")
    return True


def main() -> int:
    token = os.environ.get("GHL_MAHARA_PIT")
    location = os.environ.get("GHL_MAHARA_LOCATION")
    if not token or not location:
        note("GHL_MAHARA_PIT / GHL_MAHARA_LOCATION are not set")
        return 2

    sb = Store()
    state = sb.get(f"wa_state?select=*&location_id=eq.{urllib.parse.quote(location)}")
    if not state:
        note("no watermark for this location; refusing to scan the whole history")
        return 2

    threads, messages = scan(sb, token, location, state[0]["scan_since"])
    note(f"scanned: {threads} thread(s) moved, {messages} new message(s)")

    waiting = sb.get(
        "wa_threads?select=id,contact_name,is_group,last_inbound_at"
        "&awaiting_us=is.true&archived=is.false&order=last_inbound_at.desc&limit=40"
    )
    drafted = failed = 0
    for t in waiting:
        existing = sb.get(
            f"wa_drafts?select=drafted_at&thread_id=eq.{urllib.parse.quote(t['id'])}"
        )
        # Redraft only when they have said something since the last draft.
        if existing and str(existing[0]["drafted_at"]) > str(t["last_inbound_at"]):
            continue
        try:
            if draft_for(sb, t):
                drafted += 1
        except Exception as e:  # one bad thread must not stop the desk
            failed += 1
            note(f"  {t['id']} ({t.get('contact_name')}): {type(e).__name__}: {e}")

    sb.patch(
        f"wa_state?location_id=eq.{urllib.parse.quote(location)}",
        {"last_scan": now()},
    )
    note(f"{len(waiting)} waiting on us, {drafted} drafted, {failed} failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
