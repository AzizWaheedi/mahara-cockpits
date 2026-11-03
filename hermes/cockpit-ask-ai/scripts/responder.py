#!/usr/bin/env python3
"""Fast responder for cockpit chat questions (Hermes chat v2).

The cockpits queue chat questions in public.cockpit_ask_ai_jobs. Until now a
Hermes cron agent answered them every 5 minutes. This worker answers chat jobs
within seconds instead:

  claim (2 s poll) -> read the asker's scoped data -> one model call -> post.

The model is called through Hermes' own credential pool and fallback order
(the Ask AI cron job's model first, then config.yaml fallback_providers), so it
runs on the same subscription logins the agent uses. The cron agent stays as
the fallback: if this worker is down, it still answers chat within 5 minutes,
and it keeps answering the background kinds (comment_digest, call_brief).

Read-only: Supabase GETs with the service key, Google Drive reads with the team
OAuth keys. The only writes are the queue RPCs (claim, complete, fail).

Commands (run with the Hermes venv python, as the hermes user on the VPS):
  responder.py doctor                      keys, Hermes import, model chain (booleans only)
  responder.py run [--seconds 55] --apply  answer chat jobs for up to N seconds
  responder.py replay <job_id> [...] [--as=<app>]
                                           replay finished jobs: build the data, call the
                                           model, print the answer. Posts nothing. --as
                                           asks as another cockpit's assistant.
Without --apply, run only reads the queue and prints what it would claim.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import askai  # noqa: E402  (shared env and HTTP helpers)

HERMES_HOME = os.environ.get("HERMES_HOME", "/docker/hermes-agent-ff5p/data")
HERMES_SRC = os.environ.get("HERMES_SRC", "/opt/hermes-host")
KEYS_FILES = (os.path.join(HERMES_HOME, "bibi/api-keys.env"), "/opt/data/bibi/api-keys.env")
ASK_AI_CRON_NAME = "Cockpit Ask AI"
STATE_DIR = os.environ.get("ASKAI_STATE_DIR", os.path.expanduser("~/.cockpit-ask-ai"))
KUWAIT = timezone(timedelta(hours=3))
LEASE_SECONDS = 180
POLL_SECONDS = 2.0
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 5_000_000
DRIVE_ID = re.compile(r"(?:drive|docs)\.google\.com/(?:file/d/|document/d/|presentation/d/|spreadsheets/d/|open\?id=|uc\?id=)([A-Za-z0-9_-]{20,})")


def log(line: str) -> None:
    print(f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {line}", flush=True)


# ---------------------------------------------------------------- settings


def load_env() -> dict[str, str]:
    for path in KEYS_FILES:
        if os.path.exists(path):
            askai.KEYS = path
            break
    return askai.env()


def supabase(e: dict[str, str]) -> tuple[str, str]:
    url = (e.get("COCKPIT_SUPABASE_URL") or e.get("DESK_SUPABASE_URL") or "").rstrip("/")
    key = e.get("COCKPIT_SUPABASE_KEY") or e.get("DESK_SUPABASE_KEY") or ""
    if not (url.startswith("https://") and len(key) >= 20):
        raise SystemExit("FAIL config: COCKPIT_SUPABASE_URL and COCKPIT_SUPABASE_KEY are required (read by name from api-keys.env)")
    return f"{url}/rest/v1", key


def model_chain() -> list[tuple[str, str]]:
    """The Ask AI cron job's model first, then Hermes' fallback order. Read fresh each cycle."""
    chain: list[tuple[str, str]] = []
    try:
        jobs = json.load(open(os.path.join(HERMES_HOME, "cron/jobs.json")))
        jobs = jobs.get("jobs", jobs) if isinstance(jobs, dict) else jobs
        for j in jobs:
            if j.get("name") == ASK_AI_CRON_NAME and j.get("provider") and j.get("model"):
                chain.append((j["provider"], j["model"]))
    except Exception as exc:  # the chain still has the fallbacks
        log(f"WARN model chain: cron job unreadable ({type(exc).__name__})")
    try:
        import yaml  # Hermes venv dependency

        cfg = yaml.safe_load(open(os.path.join(HERMES_HOME, "config.yaml"))) or {}
        for fb in cfg.get("fallback_providers") or []:
            pair = (fb.get("provider"), fb.get("model"))
            if all(pair) and pair not in chain:
                chain.append(pair)
    except Exception as exc:
        log(f"WARN model chain: config.yaml unreadable ({type(exc).__name__})")
    return chain


def ask_model(messages: list[dict[str, Any]], chain: list[tuple[str, str]]) -> tuple[str, str]:
    """One completion through Hermes' credential pool. Returns (text, 'provider/model')."""
    os.environ.setdefault("HERMES_HOME", HERMES_HOME)
    if HERMES_SRC not in sys.path:
        sys.path.insert(0, HERMES_SRC)
    from agent.auxiliary_client import call_llm

    problems = []
    for provider, model in chain:
        try:
            resp = call_llm(provider=provider, model=model, messages=messages, max_tokens=1500, timeout=90)
            text = (resp.choices[0].message.content or "").strip()
            if text:
                return text, f"{provider}/{model}"
            problems.append(f"{provider}/{model}: empty answer")
        except Exception as exc:
            problems.append(f"{provider}/{model}: {type(exc).__name__} {str(exc)[:120]}")
    raise RuntimeError("; ".join(problems) or "no model configured")


# ---------------------------------------------------------------- reads


def get(rest: str, key: str, table: str, query: dict[str, str]) -> list[dict[str, Any]] | None:
    """One PostgREST read. None means the source could not be read (never treat it as zero)."""
    out = askai.call(f"{rest}/{table}?{urllib.parse.urlencode(query, safe='(),.*:')}", key)
    return out if isinstance(out, list) else None


def num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def money(v: float) -> str:
    return f"${v:,.2f}"


def find_client(job: dict[str, Any], names: list[str]) -> str | None:
    """The page's client, else a scoped client named in this question or the last few."""
    if job.get("client_name"):
        return job["client_name"]
    texts = [job.get("prompt") or ""] + [h.get("prompt") or "" for h in (job.get("context") or {}).get("history", [])[:3]]
    for text in texts:
        low = text.lower()
        for name in sorted(names, key=len, reverse=True):
            if name and name.lower() in low:
                return name
            first = re.split(r"[\s|\-_/]+", name.strip())[0]
            if len(first) >= 4 and re.search(rf"(?<![\w]){re.escape(first.lower())}(?![\w])", low):
                return name
    return None


def client_pack(rest: str, key: str, client: str) -> tuple[str, list[str]]:
    lines: list[str] = []
    sources: list[str] = []
    since14 = (datetime.now(KUWAIT) - timedelta(days=14)).date().isoformat()
    since7 = (datetime.now(KUWAIT) - timedelta(days=7)).date().isoformat()

    camps = get(rest, key, "cockpit_campaigns", {
        "client_name": f"ilike.{client}", "source_deleted": "is.false",
        "select": "client_name,meta_account_id,verdict,reason,spend_7d,spend_today,leads_7d,leads_today,cpl,frequency,link_ctr,service_mode,synced_at,name:raw_data->>campaignName,bookings:raw_data->>bookings7d,cpb:raw_data->>costPerBooking",
    })
    if camps is None:
        lines.append("Campaign board: could not be read right now.")
    elif not camps:
        lines.append("Campaign board: no live campaign is tied to this client.")
    else:
        sources.append("media buyer campaign board")
        lines.append(f"Campaign board (synced {kuwait_time(camps[0].get('synced_at'))} Kuwait time; today = the Kuwait day so far):")
        for c in camps:
            lines.append(
                f"- {c.get('name') or 'campaign'}: verdict {plain_verdict(c.get('verdict'))}"
                f" ({(c.get('reason') or '').strip()[:160]}); last 7 days spend {money(num(c.get('spend_7d')))},"
                f" leads {int(num(c.get('leads_7d')))}, cost per lead {money(num(c.get('cpl'))) if c.get('cpl') else 'n/a'},"
                f" bookings {c.get('bookings') if c.get('bookings') is not None else 'not measured'}, cost per booking {money(num(c.get('cpb'))) if c.get('cpb') else 'n/a'},"
                f" frequency {num(c.get('frequency')):.2f}, link CTR {num(c.get('link_ctr')):.2f}%; today spend {money(num(c.get('spend_today')))}, leads {int(num(c.get('leads_today')))}, today cost per lead {today_cpl(c)}"
            )
    accounts = {str(c["meta_account_id"]).replace("act_", "") for c in camps or [] if c.get("meta_account_id")}
    tied = get(rest, key, "clients", {"name": f"ilike.{client}", "select": "meta_ad_account_id"}) or []
    accounts |= {str(t["meta_ad_account_id"]).replace("act_", "") for t in tied if t.get("meta_ad_account_id")}
    accounts = sorted(a for a in accounts if a.isdigit())
    if not accounts:
        lines.append("Ad results: no Meta ad account is tied to this client in the cockpit, so ad numbers are not available.")
    else:
        rows = get(rest, key, "cockpit_media_daily_stats", {
            "day": f"gte.{since14}", "data->>accountId": f"in.({','.join(accounts)})", "select": "day,data", "limit": "5000",
        })
        if rows is None:
            lines.append("Ad results: could not be read right now.")
        elif rows:
            sources.append("Meta ad results by day (cockpit_media_daily_stats, USD)")
            ads: dict[str, dict[str, Any]] = {}
            for r in rows:
                d = r.get("data") or {}
                a = ads.setdefault(d.get("metaAdId") or d.get("adName") or "?", {"name": d.get("adName"), "campaign": d.get("campaignName"), "adset": d.get("adSetName"), "s7": 0.0, "l7": 0, "s14": 0.0, "l14": 0, "clicks7": 0, "imp7": 0, "last": ""})
                a["s14"] += num(d.get("spend")); a["l14"] += int(num(d.get("leads")))
                if str(r.get("day")) >= since7:
                    a["s7"] += num(d.get("spend")); a["l7"] += int(num(d.get("leads")))
                    a["clicks7"] += int(num(d.get("linkClicks"))); a["imp7"] += int(num(d.get("impressions")))
                a["last"] = max(a["last"], str(r.get("day")))
            lines.append(f"Ads, last 7 and 14 days (days to {max(a['last'] for a in ads.values())}):")
            for a in sorted(ads.values(), key=lambda x: -x["s7"])[:15]:
                cpl7 = money(a["s7"] / a["l7"]) if a["l7"] else "no leads"
                ctr = f"{100 * a['clicks7'] / a['imp7']:.2f}%" if a["imp7"] else "n/a"
                lines.append(f"- \"{a['name']}\" (campaign {a['campaign']}, ad set {a['adset']}): 7d spend {money(a['s7'])}, leads {a['l7']}, cost per lead {cpl7}, link CTR {ctr}; 14d spend {money(a['s14'])}, leads {a['l14']}")
        else:
            lines.append("Ad results: no ad spent in the last 14 days.")

    digests = get(rest, key, "cockpit_comment_watch_items", {
        "client_name": f"ilike.{client}", "digest": "not.is.null", "order": "posted_at.desc", "limit": "5", "select": "posted_at,author,digest",
    })
    if digests:
        sources.append("ClickUp card comments (comment watch digests)")
        lines.append("Latest client card comments, newest first:")
        for d in digests:
            g = d.get("digest") or {}
            bits = [g.get("summary") or ""] + [f"{k}: {'; '.join(g.get(k) or [])}" for k in ("clientRequests", "nextSteps", "risks", "dos", "donts") if g.get(k)]
            lines.append(f"- {str(d.get('posted_at'))[:10]} by {d.get('author') or 'someone'}: " + " | ".join(b for b in bits if b)[:700])
    elif digests is None:
        lines.append("Client card comments: could not be read right now.")

    sync = get(rest, key, "cockpit_lead_sync_status", {"client_name": f"ilike.{client}", "select": "state,reason,meta_24h,crm_24h,missing_24h,checked_at"})
    if sync:
        sources.append("lead sync watch")
        for s in sync:
            lines.append(f"Lead sync (Facebook leads vs CRM, checked {str(s.get('checked_at'))[:16]}): {s.get('state')}, last 24 h Meta {s.get('meta_24h')}, CRM {s.get('crm_24h')}, missing {s.get('missing_24h')}. {s.get('reason') or ''}".strip())

    word = re.sub(r"[^\w-]", "", (client.split() or [""])[0])  # \w covers Arabic letters too
    tasks = None if len(word) < 3 else get(rest, key, "cockpit_task_mirror", {
        "or": f"(name.ilike.*{word}*,list_name.ilike.*{word}*)", "status_type": "neq.closed", "gone_at": "is.null", "archived": "is.false",
        "order": "date_updated.desc", "limit": "10", "select": "name,status,due_on,list_name",
    })
    if tasks:
        sources.append("ClickUp tasks (task mirror)")
        lines.append("Open ClickUp tasks that name this client:")
        lines += [f"- {t.get('name')} ({t.get('status')}, list {t.get('list_name')}, due {t.get('due_on') or 'none'})" for t in tasks]

    reqs = get(rest, key, "cockpit_creative_requests", {"client_name": f"ilike.{client}", "order": "created_at.desc", "limit": "5", "select": "status,source_ad_name,request_reason,note,created_at"})
    if reqs:
        sources.append("creative requests")
        lines.append("Latest creative requests:")
        lines += [f"- {str(r.get('created_at'))[:10]} {r.get('status')}: {r.get('source_ad_name') or ''} {(r.get('request_reason') or r.get('note') or '')[:200]}".rstrip() for r in reqs]
    return "\n".join(lines), sources


def overview_pack(rest: str, key: str, names: list[str]) -> tuple[str, list[str]]:
    camps = get(rest, key, "cockpit_campaigns", {"source_deleted": "is.false", "select": "client_name,verdict,reason,spend_7d,leads_7d,cpl,spend_today,leads_today,synced_at,name:raw_data->>campaignName,bookings:raw_data->>bookings7d", "order": "client_name"})
    if camps is None:
        return "Campaign board: could not be read right now.", []
    allowed = {n.lower().strip() for n in names}
    camps = [c for c in camps if (c.get("client_name") or "").lower().strip() in allowed]
    if not camps:
        return "Campaign board: no live campaign for the clients this person can see.", []
    synced = kuwait_time(camps[0].get("synced_at"))
    s_today, l_today = sum(num(c.get("spend_today")) for c in camps), sum(int(num(c.get("leads_today"))) for c in camps)
    s7, l7 = sum(num(c.get("spend_7d")) for c in camps), sum(int(num(c.get("leads_7d"))) for c in camps)
    lines = [
        f"Campaign board for every live campaign of the clients this person can see (synced {synced} Kuwait time).",
        f"Totals: today so far (Kuwait day, up to the sync) spend {money(s_today)}, leads {l_today}; last 7 days spend {money(s7)}, leads {l7}, cost per lead {money(s7 / l7) if l7 else 'n/a'}.",
    ]
    # Grouped by verdict so the answer copies the groups instead of re-sorting them.
    groups: dict[str, list[dict[str, Any]]] = {}
    for c in camps:
        groups.setdefault(plain_verdict(c.get("verdict")), []).append(c)
    order = ["doing well", "watch", "should stop"]
    for verdict in order + sorted(set(groups) - set(order)):
        if verdict in groups:
            lines.append(f"Verdict {verdict} ({len(groups[verdict])} campaigns):")
            lines += [overview_line(c) for c in groups[verdict]]
    return "\n".join(lines), ["media buyer campaign board"]


def overview_line(c: dict[str, Any]) -> str:
    return (
        f"- {c.get('client_name')} / {c.get('name') or 'campaign'}:"
        f" today spend {money(num(c.get('spend_today')))}, leads {int(num(c.get('leads_today')))}, cost per lead {today_cpl(c)};"
        f" last 7 days spend {money(num(c.get('spend_7d')))}, leads {int(num(c.get('leads_7d')))}, cost per lead {money(num(c.get('cpl'))) if c.get('cpl') else 'n/a'},"
        f" bookings {c.get('bookings') if c.get('bookings') is not None else 'not measured'}. {(c.get('reason') or '')[:120]}"
    )


VERDICT_WORDS = {"scale": "doing well", "hold": "watch", "kill": "should stop"}


def plain_verdict(v: Any) -> str:
    return VERDICT_WORDS.get(str(v or "").lower(), str(v) if v else "no verdict")


def today_cpl(c: dict[str, Any]) -> str:
    leads = int(num(c.get("leads_today")))
    return money(num(c.get("spend_today")) / leads) if leads else "n/a (no leads today)"


def kuwait_time(ts: Any) -> str:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(KUWAIT).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return str(ts)[:16]


# ---------------------------------------------------------------- Google Drive


def drive_token(e: dict[str, str]) -> str | None:
    if not all(e.get(k) for k in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")):
        return None
    body = urllib.parse.urlencode({"client_id": e["GOOGLE_CLIENT_ID"], "client_secret": e["GOOGLE_CLIENT_SECRET"], "refresh_token": e["GOOGLE_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=body), timeout=20) as r:
            return json.loads(r.read()).get("access_token")
    except Exception:
        return None


def fetch(url: str, token: str, limit: int) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}), timeout=30) as r:
            data = r.read(limit + 1)
            return data if len(data) <= limit else None
    except Exception:
        return None


def drive_pack(e: dict[str, str], texts: list[str]) -> tuple[str, list[dict[str, Any]], list[str]]:
    """Read the Drive files linked in the question (and the last few). Returns notes, image parts, sources."""
    ids: list[str] = []
    for t in texts:
        for fid in DRIVE_ID.findall(t or ""):
            if fid not in ids:
                ids.append(fid)
    if not ids:
        return "", [], []
    token = drive_token(e)
    if not token:
        return "Drive files: the assistant has no Drive access configured, so the linked files could not be opened.", [], []
    notes, images = ["Linked Drive files, in the order they were sent:"], []
    for n, fid in enumerate(ids[:MAX_IMAGES], 1):
        meta_raw = fetch(f"https://www.googleapis.com/drive/v3/files/{fid}?supportsAllDrives=true&fields=name,mimeType,size,thumbnailLink,videoMediaMetadata(durationMillis,width,height)", token, 200_000)
        if not meta_raw:
            notes.append(f"File {n}: the assistant cannot open it (no access, or it was deleted). Ask for it to be shared with the team Drive.")
            continue
        m = json.loads(meta_raw)
        mime, name = m.get("mimeType", ""), m.get("name", "file")
        label = f"File {n} \"{name}\" ({mime})"
        img: bytes | None = None
        if mime.startswith("image/") and num(m.get("size")) <= MAX_IMAGE_BYTES:
            img = fetch(f"https://www.googleapis.com/drive/v3/files/{fid}?alt=media&supportsAllDrives=true", token, MAX_IMAGE_BYTES)
            mime_img = mime
        elif m.get("thumbnailLink"):
            img = fetch(re.sub(r"=s\d+$", "=s1000", m["thumbnailLink"]), token, MAX_IMAGE_BYTES)
            mime_img = "image/jpeg"
        if mime == "application/vnd.google-apps.document":
            txt = fetch(f"https://www.googleapis.com/drive/v3/files/{fid}/export?mimeType=text/plain", token, 60_000)
            notes.append(f"{label} text:\n" + (txt.decode("utf-8", "replace")[:12000] if txt else "(text could not be read)"))
        elif mime.startswith("video/"):
            v = m.get("videoMediaMetadata") or {}
            secs = round(num(v.get("durationMillis")) / 1000)
            notes.append(f"{label}: a video, {secs} s long, {v.get('width')}x{v.get('height')}. The assistant sees only its thumbnail frame, not the sound or the full video.")
        else:
            notes.append(f"{label}: attached as an image below." if img else f"{label}: the assistant can see only the name of this file type.")
        if img:
            images.append({"type": "image_url", "image_url": {"url": f"data:{mime_img};base64,{base64.b64encode(img).decode()}"}})
    return "\n".join(notes), images, (["Google Drive files"] if len(notes) > 1 else [])


# ---------------------------------------------------------------- prompt

# Each cockpit has its own assistant (decision 2026-11-03). The chat panel shows
# the same names from hermesText.ts ASSISTANTS; keep the two in step.
ASSISTANTS = {
    "media-buyer": ("Signal", """You are Signal, the media buyer's ads assistant.
Lead with ad results: spend, leads, cost per lead, bookings, which campaigns are doing well or should stop, and which ads look tired.
Client relationships belong to Anchor in the client success cockpit and creative work to Lens in the creative cockpit: answer what the DATA shows, then say who covers the rest."""),
    "client-success": ("Anchor", """You are Anchor, the client success assistant.
Lead with each client as a relationship: their comments, lead sync problems, open tasks and what to tell them next. Ad numbers support that story; they are not the headline.
Ad decisions belong to Signal in the media buyer cockpit and creative work to Lens in the creative cockpit: answer what the DATA shows, then say who covers the rest."""),
    "creative": ("Lens", """You are Lens, the creative assistant.
Lead with creative: open creative requests and their reasons, which ads, hooks and angles have the best cost per lead, and fresh angles to try. Ad numbers support creative choices.
Budget and campaign decisions belong to Signal in the media buyer cockpit and client relationships to Anchor in the client success cockpit: answer what the DATA shows, then say who covers the rest."""),
}
DEFAULT_ASSISTANT = ("the cockpit assistant", "You are the cockpit assistant.")


def assistant_for(app: Any) -> tuple[str, str]:
    return ASSISTANTS.get(str(app), DEFAULT_ASSISTANT)


SYSTEM = """You work inside Mahara Media's cockpits and answer one team member at a time. Use only your own name; never call yourself Hermes.
Mahara runs Meta ads and sales follow-up for construction and design businesses in the Gulf.

Answer rules:
- Answer in the language and dialect of the question. Arabic questions get natural Gulf Arabic, not formal MSA.
- Lead with the answer. Keep it short: under 180 words unless the person asks for more or for copy.
- Use only the DATA block, the COCKPIT GUIDE and the attached files. Never invent a number, a name or a status.
- Answer straight away. When the exact window asked for is not in the DATA, give the closest window you have and name it in the first line. Never ask "do you want me to"; just answer. When nothing in the DATA fits, say what is missing in one line.
- Every number you give says its window ("today so far", "last 7 days"). Never put a 7-day figure beside a today figure in one line without naming both windows. Money is always USD.
- "How do I", "where do I" and "from where" questions are answered from the COCKPIT GUIDE: name the menu item and the button. Never name a page, button or setting that is not in the guide or the DATA, and never describe what a page does beyond what the guide says.
- You cannot act: you never upload, edit, publish, pause, message clients or change settings. If asked, say so in one line and point to the place in the COCKPIT GUIDE where the person does it, then help with what you can (a checklist, a draft, copy).
- Never add a "to do this, go to" line unless the person asked where or how.
- Say campaign verdicts in plain words (doing well, watch, should stop), not "scale / hold / kill" or "gates".
- A short reply such as "yes", "نعم" or "do it" answers your previous message: continue from it.
- When a file is attached, describe what you actually see in it before you write copy for it.
- Format: short paragraphs, "- " bullets, **bold** for the key figure. No tables, no "---" lines, no emoji, no em dashes.

House rules for ad copy:
- Never call the audience "contractors" and never imply one-man teams. They are construction and design businesses, firms or companies.
- Never use "B2B" in anything a client or a lead will read.
- Write like one person talking to another. Short sentences. Concrete, not aspirational. No "unlock", no "revolutionise".
- Headline under 40 characters. Primary text 2 to 4 short lines. Arabic copy in Gulf spoken register.
- When asked for options, give distinct angles: outcome, objection, proof, question, direct offer."""

# Where things are, per cockpit: menu names from each app's AppSidebar.tsx and
# the buttons people ask about. Keep it in step when a menu or button moves.
SHARED_GUIDE = """- Ask a team (menu, Team section): ask another team for something; it becomes a ClickUp task with its SOP steps and an owner.
- Team meetings (menu).
- Client performance (menu): every active client against its targets; open a client for its ads.
- The round button at the bottom right ("Ask" and your name): this chat."""

COCKPIT_GUIDE = {
    "media-buyer": """Media buyer cockpit menu:
- Today: the day's tasks and numbers.
- Ads: the campaign board. Each campaign card and each ad has a "New creative" button: pick a reason (more ads to test, new angle or hook, refresh a fatigued ad, improve the edit) and the request goes to the creative director. The same card has "This is not for me" to send a request to another team's ClickUp board.
- Clients: every client's account; open a client to see its campaigns, ads and the same "New creative" button.
- Library: the SOPs (the simple SOP, the in-depth SOP, the written SOP in ClickUp, raise a ticket).
""" + SHARED_GUIDE,
    "client-success": """Client success cockpit menu:
- Today
- Inbox
- Clients: every client; open one for its details.
- Money
- Links
""" + SHARED_GUIDE,
    "creative": """Creative director cockpit menu:
- Today
- Clients: the client database.
- Library (what works)
- Social: the social calendar.
- Funnels
- Links
New creative requests from media buyers arrive here from the Ads page "New creative" button in the media buyer cockpit.
""" + SHARED_GUIDE,
}


def build_messages(job: dict[str, Any], data: str, images: list[dict[str, Any]], page: str | None) -> list[dict[str, Any]]:
    # The data goes with the rules, so the chat reads in order and a short reply
    # ("yes", "do it") lands right after the answer it refers to.
    ctx = job.get("context") or {}
    now = datetime.now(KUWAIT).strftime("%Y-%m-%d %H:%M")
    data_block = f"DATA (read {now} Kuwait time; cockpit {job.get('app')}; the person's role {job.get('role')}; page {page or 'unknown'})\n{data}"
    guide = COCKPIT_GUIDE.get(str(job.get("app")), SHARED_GUIDE)
    _, identity = assistant_for(job.get("app"))
    msgs: list[dict[str, Any]] = [{"role": "system", "content": f"{identity}\n{SYSTEM}\n\nCOCKPIT GUIDE (where things are)\n{guide}\n\n{data_block}"}]
    for h in reversed((ctx.get("history") or [])[:8]):  # history arrives newest first
        reply = askai_reply(h.get("result"))
        if h.get("prompt") and reply:
            msgs += [{"role": "user", "content": h["prompt"]}, {"role": "assistant", "content": reply}]
    prompt = job.get("prompt") or ""
    msgs.append({"role": "user", "content": [{"type": "text", "text": prompt}, *images] if images else prompt})
    return msgs


def askai_reply(result: Any) -> str:
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        for k in ("reply", "answer", "text"):
            if isinstance(result.get(k), str) and result[k].strip():
                return result[k]
    return ""


def guess_client(job: dict[str, Any], names: list[str], chain: list[tuple[str, str]]) -> str | None:
    """Ask the fastest model which scoped client the chat is about ("ماربيل" -> "Marble and more")."""
    history = [h.get("prompt") or "" for h in reversed((job.get("context") or {}).get("history", [])[:3])]
    said = "\n".join(f"- {t[:300]}" for t in [*history, job.get("prompt") or ""] if t.strip())
    msgs = [
        {"role": "system", "content": "You map a team member's chat to one client. Names may be written in Arabic, shortened or misspelled. Pick a client only when the chat writes its name (in any spelling or script). Reply with exactly one name copied from the list, or NONE when no client is named or you are unsure."},
        {"role": "user", "content": f"Clients:\n{chr(10).join(names)}\n\nThe chat, oldest first:\n{said}"},
    ]
    fast = [c for c in chain if "haiku" in c[1]] + [c for c in chain if "haiku" not in c[1]]
    try:
        text, _ = ask_model(msgs, fast)
    except RuntimeError:
        return None
    pick = text.strip().strip('"').strip()
    return next((n for n in names if n.lower() == pick.lower()), None)


CEO_EMAILS = {"aziz@maharamedia.com", "awaheedi2008@gmail.com"}


def visible_clients(rest: str, key: str, uid: str | None, profile_names: list[str]) -> list[str]:
    """Every client the asker may see, by the database's own rule (cockpit_ask_ai_owner_allowed).

    Admins, the CEO and members with no client list see every client, including
    board clients that have no profile row. Others see only their own list.
    When the member cannot be read, the scoped profile names are the safe answer.
    """
    member = get(rest, key, "cockpit_members", {"auth_user_id": f"eq.{uid}", "active": "is.true", "select": "email,roles,clients"}) if uid else None
    if not member:
        return profile_names
    m = member[0]
    mine = [c for c in (m.get("clients") or []) if c]
    names = list(profile_names)
    if "admin" in (m.get("roles") or []) or (m.get("email") or "").lower() in CEO_EMAILS or not mine:
        board = get(rest, key, "cockpit_campaigns", {"source_deleted": "is.false", "select": "client_name"}) or []
        names += [b["client_name"] for b in board if b.get("client_name")]
    else:
        names += mine
    seen: dict[str, str] = {}
    for n in names:
        seen.setdefault(n.strip().lower(), n.strip())
    return list(seen.values())


def prepare(job: dict[str, Any], e: dict[str, str], rest: str, key: str, chain: list[tuple[str, str]]) -> tuple[list[dict[str, Any]], list[str], str | None]:
    ctx = job.get("context") or {}
    profiles = ctx.get("profiles") or []
    meta = get(rest, key, "cockpit_ask_ai_jobs", {"id": f"eq.{job['id']}", "select": "auth_user_id,page:metadata->request->context->>page"})
    page = (meta[0].get("page") if meta else None) or None
    names = visible_clients(rest, key, meta[0].get("auth_user_id") if meta else None, [p.get("client_name") for p in profiles if p.get("client_name")])
    client = find_client(job, names) or (guess_client(job, names, chain) if names else None)
    parts = [f"Clients this person can see: {', '.join(names) if names else 'none'}."]
    sources: list[str] = []
    prof = next((p for p in profiles if client and (p.get("client_name") or "").lower() == client.lower()), None)
    if prof:
        sources.append("client profile")
        parts.append("Client profile: " + json.dumps({k: prof.get(k) for k in ("client_name", "service", "stage", "health", "kpi", "notes", "overview")}, ensure_ascii=False)[:2500])
    if client:
        text, src = client_pack(rest, key, client)
    else:
        text, src = overview_pack(rest, key, names)
    parts.append(text)
    sources += src
    history_prompts = [h.get("prompt") or "" for h in (ctx.get("history") or [])[:3]]
    notes, images, dsrc = drive_pack(e, [job.get("prompt") or ""] + history_prompts)
    if notes:
        parts.append(notes)
    sources += dsrc
    return build_messages(job, "\n\n".join(parts), images, page), sources, client


def answer(job: dict[str, Any], e: dict[str, str], rest: str, key: str, chain: list[tuple[str, str]]) -> dict[str, Any]:
    messages, sources, client = prepare(job, e, rest, key, chain)
    try:
        text, used = ask_model(messages, chain)
    except RuntimeError:
        if not isinstance(messages[-1]["content"], list):
            raise
        # A model that refuses images still answers from the text and the file notes.
        messages[-1]["content"] = messages[-1]["content"][0]["text"] + "\n(The attached images could not be sent to the model.)"
        text, used = ask_model(messages, chain)
    return {"reply": text, "model": used, "sources": sources, "client": client, "engine": "responder-v2"}


# ---------------------------------------------------------------- loop


def write_state(state: dict[str, Any]) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = os.path.join(STATE_DIR, "heartbeat.json.tmp")
    json.dump(state, open(tmp, "w"))
    os.replace(tmp, os.path.join(STATE_DIR, "heartbeat.json"))


def run(seconds: int, apply: bool) -> int:
    e = load_env()
    rest, key = supabase(e)
    worker = f"responder-{os.uname().nodename if hasattr(os, 'uname') else 'host'}-{os.getpid()}"
    if not apply:
        out = get(rest, key, "cockpit_ask_ai_jobs", {"status": "eq.queued", "kind": "eq.chat", "hidden": "is.false", "select": "id,app,created_at", "order": "created_at.asc", "limit": "5"})
        log(f"DRY RUN would claim {0 if out is None else len(out)} chat job(s): {json.dumps(out)[:400]}")
        return 0 if out is not None else 1
    state_path = os.path.join(STATE_DIR, "heartbeat.json")
    try:
        state = json.load(open(state_path))
    except Exception:
        state = {}
    chain = model_chain()
    if not chain:
        log("FAIL cycle: no model chain (Ask AI cron job and fallback_providers unreadable)")
        return 1
    end, answered, failed, errors = time.time() + seconds, 0, 0, 0
    while time.time() < end:
        claimed = askai.call(f"{rest}/rpc/cockpit_claim_ask_ai_jobs", key, {"p_worker_id": worker, "p_kinds": ["chat"], "p_limit": 2, "p_lease_seconds": LEASE_SECONDS}, method="POST")
        if not isinstance(claimed, list):
            errors += 1
            log(f"FAIL claim: {json.dumps(claimed)[:300]}")
            time.sleep(10)
            continue
        for job in claimed:
            started = time.time()
            try:
                result = answer(job, e, rest, key, chain)
                ok = askai.call(f"{rest}/rpc/cockpit_complete_ask_ai_job", key, {"p_job_id": job["id"], "p_lease_token": job["lease_token"], "p_result": result, "p_worker_id": worker}, method="POST")
                if ok is True:
                    answered += 1
                    state["last_success_at"] = datetime.now(timezone.utc).isoformat()
                    log(f"OK job={job['id'][:8]} model={result['model']} client={result['client'] or '-'} sources={len(result['sources'])} secs={time.time() - started:.1f}")
                else:
                    failed += 1
                    log(f"FAIL job={job['id'][:8]} complete rejected: {json.dumps(ok)[:200]}")
            except Exception as exc:
                failed += 1
                name = assistant_for(job.get("app"))[0].capitalize()
                reason = f"{name} could not reach its model right now. It will try again in a moment." if "RuntimeError" in type(exc).__name__ else f"{name} hit an error while reading the data. It will try again in a moment."
                askai.call(f"{rest}/rpc/cockpit_fail_ask_ai_job", key, {"p_job_id": job["id"], "p_lease_token": job["lease_token"], "p_error": reason, "p_worker_id": worker}, method="POST")
                log(f"FAIL job={job['id'][:8]} {type(exc).__name__}: {str(exc)[:300]}")
        if not claimed:
            time.sleep(POLL_SECONDS)
    state.update({"last_cycle_at": datetime.now(timezone.utc).isoformat(), "last_cycle": {"answered": answered, "failed": failed, "claim_errors": errors}, "model_chain": [f"{p}/{m}" for p, m in chain]})
    write_state(state)
    log(f"{'OK' if not (failed or errors) else 'FAIL'} cycle answered={answered} failed={failed} claim_errors={errors}")
    return 0 if not (failed or errors) else 1


def replay(job_ids: list[str], as_app: str | None = None) -> int:
    e = load_env()
    rest, key = supabase(e)
    chain = model_chain()
    bad = 0
    for jid in job_ids:
        rows = get(rest, key, "cockpit_ask_ai_jobs", {"id": f"eq.{jid}", "select": "id,app,role,client_name,kind,prompt,context"})
        if not rows:
            log(f"FAIL replay {jid[:8]}: job not found")
            bad += 1
            continue
        started = time.time()
        try:
            job = {**rows[0], "app": as_app} if as_app else rows[0]
            result = answer(job, e, rest, key, chain)
            print(json.dumps({"job": jid[:8], "secs": round(time.time() - started, 1), "question": rows[0]["prompt"][:200], **result}, ensure_ascii=False, indent=1), flush=True)
        except Exception as exc:
            bad += 1
            log(f"FAIL replay {jid[:8]} {type(exc).__name__}: {str(exc)[:300]}")
    return 1 if bad else 0


def doctor() -> int:
    e = load_env()
    report: dict[str, Any] = {"keys_file": askai.KEYS, "keys_file_exists": os.path.exists(askai.KEYS)}
    report["supabase_configured"] = bool((e.get("COCKPIT_SUPABASE_URL") or "").startswith("https://") and len(e.get("COCKPIT_SUPABASE_KEY") or "") >= 20)
    report["drive_configured"] = all(e.get(k) for k in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"))
    report["model_chain"] = [f"{p}/{m}" for p, m in model_chain()]
    try:
        sys.path.insert(0, HERMES_SRC)
        os.environ.setdefault("HERMES_HOME", HERMES_HOME)
        from agent.auxiliary_client import call_llm  # noqa: F401

        report["hermes_import"] = True
    except Exception as exc:
        report["hermes_import"] = f"no ({type(exc).__name__})"
    print(json.dumps(report, indent=1))
    return 0 if report["supabase_configured"] and report["model_chain"] and report["hermes_import"] is True else 1


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "doctor"
    if cmd == "doctor":
        return doctor()
    if cmd == "run":
        secs = int(argv[argv.index("--seconds") + 1]) if "--seconds" in argv else 55
        return run(max(5, min(secs, 600)), "--apply" in argv and "--dry-run" not in argv)
    if cmd == "replay":
        as_app = next((a.split("=", 1)[1] for a in argv if a.startswith("--as=")), None)
        return replay([a for a in argv[1:] if not a.startswith("-")], as_app)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
