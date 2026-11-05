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
# The chat model, ahead of the cron job's model (gpt-6-astra, kept as the first
# backup). On 4 Nov 2026 gpt-6-sol answered the 30 how-to test questions as
# well as astra in 4.1 s on average instead of 6.7 s, with shorter answers.
# gpt-6-terra is not offered on the ChatGPT Codex login.
CHAT_MODEL: tuple[str, str] | None = ("openai-codex", "gpt-6-sol")
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
    """CHAT_MODEL first, then the Ask AI cron job's model, then Hermes' fallback order. Read fresh each cycle."""
    chain: list[tuple[str, str]] = [CHAT_MODEL] if CHAT_MODEL else []
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


def get_url(rest: str, table: str, query: dict[str, str]) -> str:
    """The read's URL. The filter syntax stays raw; names and Arabic text are escaped."""
    return f"{rest}/{table}?{urllib.parse.urlencode(query, safe='(),.*:\'')}"


def get(rest: str, key: str, table: str, query: dict[str, str]) -> list[dict[str, Any]] | None:
    """One PostgREST read. None means the source could not be read (never treat it as zero)."""
    out = askai.call(get_url(rest, table, query), key)
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
    "sales": ("Ace", """You are Ace, the sales team's assistant.
Lead with the person's pipeline: call prep for a lead, today's calls, follow-ups due, leads waiting for a reply, and their numbers. You may draft WhatsApp or email follow-ups in natural Gulf Arabic or English; the person sends them.
Ads belong to Signal in the media buyer cockpit and client accounts to Anchor in the client success cockpit: answer what the DATA shows, then say who covers the rest."""),
    "editor": ("Frame", """You are Frame, the video editors' assistant.
Lead with the editor's own jobs: what is due, what needs changes, and the review notes on each version.
Creative direction belongs to Lens in the creative cockpit: answer what the DATA shows, then say who covers the rest."""),
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
- For a how-to question, answer from the COCKPIT GUIDE: name the menu item, the page and the exact button text. If the guide does not cover it, say it is not in your guide yet and suggest Ask a team. Never invent a page, a button or a step.
- RECENT CHANGES are developer notes. Use them to answer what is new or what changed, in plain words. Never quote them word for word and never mention commit, file or ticket numbers.
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
# the buttons people ask about. These are the built-in fallback used only when
# GitHub cannot be read; the live guide in apps/<app>/assistant-guide.md wins.
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
    "sales": """Sales cockpit menu:
- Today
- Calendar
- Leads
- Dialer
- Pipeline
- Intelligence
- Proposals
- Contracts
- Invoices
- Numbers
- Goals
- End of day
- Follow-ups
- Recordings
- Links
- Pitch deck
""" + SHARED_GUIDE,
    "editor": """Video editor cockpit menu:
- Jobs
- Footage
- Send for review
- Library
- Meetings
- End of day: the button on the Jobs page.
- How to use this desk
""" + SHARED_GUIDE,
}

# The guide files and each cockpit's last month of commit subjects live on
# GitHub main, so an answer describes the code that is actually deployed and
# not a copy that drifted. A ten-minute cache keeps one GitHub read per app per
# cycle without a call on every question.
GUIDE_REPO = "AzizWaheedi/mahara-cockpits"
GUIDE_DIRS = {
    "media-buyer": "apps/media-buyer-cockpit",
    "client-success": "apps/client-success-cockpit",
    "creative": "apps/creative-director-cockpit",
    "sales": "apps/sales-cockpit",
    "editor": "apps/video-editor-cockpit",
}
GUIDE_TTL_SECONDS = 600
GUIDE_MAX_CHARS = 40000
CHANGES_DAYS = 30
CHANGES_MAX = 60


def github_get(e: dict[str, str], url: str, raw: bool = False) -> Any | None:
    """One read from the GitHub API. None means no token or an unreadable answer."""
    token = (e.get("GITHUB_TOKEN") or "").strip()
    if not token:
        return None
    headers = {
        "Authorization": "Bearer " + token,
        "User-Agent": "cockpit-ask-ai",
        "Accept": "application/vnd.github.raw" if raw else "application/vnd.github+json",
    }
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as r:
            body = r.read()
        text = body.decode("utf-8", "replace")
        return text if raw else json.loads(text)
    except Exception:
        return None


def recent_changes(commits: list) -> str:
    """Developer notes from the commits API, one plain line each, newest first."""
    lines: list[str] = []
    for c in commits or []:
        if len(c.get("parents") or []) > 1:
            continue
        commit = c.get("commit") or {}
        subject = (commit.get("message") or "").split("\n", 1)[0].strip()
        if subject.startswith("Merge"):
            continue
        subject = re.sub(r"\s*\(#\d+\)$", "", subject).strip()
        day = str((commit.get("committer") or {}).get("date") or "")[:10]
        if subject:
            lines.append(f"- {day}: {subject[:160]}")
        if len(lines) >= CHANGES_MAX:
            break
    return "\n".join(lines)


def live_guide(e: dict[str, str], app: str) -> tuple[str, str, str]:
    """The cockpit's guide and recent changes, from a ten-minute cache or GitHub.

    The cache stores exactly what GitHub returned, so an expired copy is still
    useful when GitHub is down. A corrupt cache counts as no cache.
    """
    if app not in GUIDE_DIRS:
        return SHARED_GUIDE, "", "built-in"
    directory = GUIDE_DIRS[app]
    path = os.path.join(STATE_DIR, "guides", f"{app}.json")
    cache: dict[str, Any] | None = None
    try:
        with open(path, encoding="utf-8") as f:
            cached = json.load(f)
        if isinstance(cached, dict) and isinstance(cached.get("fetched_at"), (int, float)):
            cache = cached
    except Exception:
        cache = None
    if cache and time.time() - cache["fetched_at"] < GUIDE_TTL_SECONDS:
        return str(cache.get("guide") or ""), str(cache.get("changes") or ""), "cache"
    since = (datetime.now(timezone.utc) - timedelta(days=CHANGES_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    guide = github_get(e, f"https://api.github.com/repos/{GUIDE_REPO}/contents/{directory}/assistant-guide.md?ref=main", raw=True)
    if isinstance(guide, str) and guide.strip():
        guide = guide[:GUIDE_MAX_CHARS]
        commits = github_get(e, f"https://api.github.com/repos/{GUIDE_REPO}/commits?sha=main&path={directory}/src&since={since}&per_page=100")
        changes = recent_changes(commits if isinstance(commits, list) else [])
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"fetched_at": time.time(), "guide": guide, "changes": changes}, f)
            os.replace(tmp, path)
        except Exception as exc:
            log(f"WARN guide app={app} cache not written ({type(exc).__name__})")
        return guide, changes, "github"
    if cache:
        try:
            when = datetime.fromtimestamp(cache["fetched_at"], timezone.utc).astimezone(KUWAIT).strftime("%Y-%m-%d %H:%M")
        except Exception:
            when = str(cache["fetched_at"])
        log(f"WARN guide app={app} GitHub unreadable, using the copy from {when}")
        return str(cache.get("guide") or ""), str(cache.get("changes") or ""), "stale cache"
    log(f"WARN guide app={app} GitHub unreadable and no saved copy, using the built-in guide")
    return COCKPIT_GUIDE[app], "", "built-in"


def build_messages(job: dict[str, Any], data: str, images: list[dict[str, Any]], page: str | None, guide: str | None = None, changes: str = "") -> list[dict[str, Any]]:
    # The data goes with the rules, so the chat reads in order and a short reply
    # ("yes", "do it") lands right after the answer it refers to.
    ctx = job.get("context") or {}
    now = datetime.now(KUWAIT).strftime("%Y-%m-%d %H:%M")
    data_block = f"DATA (read {now} Kuwait time; cockpit {job.get('app')}; the person's role {job.get('role')}; page {page or 'unknown'})\n{data}"
    guide = COCKPIT_GUIDE.get(str(job.get("app")), SHARED_GUIDE) if guide is None else guide
    _, identity = assistant_for(job.get("app"))
    msgs: list[dict[str, Any]] = [{"role": "system", "content": f"{identity}\n{SYSTEM}\n\nCOCKPIT GUIDE (how this cockpit works today, read from the code on main)\n{guide}\n\nRECENT CHANGES (developer notes from the last 30 days, newest first)\n{changes or 'None read.'}\n\n{data_block}"}]
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


# ---------------------------------------------------------------- sales and editor


def kuwait_day_bounds(day: Any) -> tuple[str, str]:
    """Kuwait midnight to the next Kuwait midnight, as UTC ISO strings."""
    start = datetime(day.year, day.month, day.day, tzinfo=KUWAIT)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()


def kuwait_clock(ts: Any) -> str:
    return kuwait_time(ts)[11:16]


def in_list(values: list[Any]) -> str:
    return "in.(" + ",".join(f'"{v}"' for v in values) + ")"


def who_is(rest: str, key: str, uid: str | None, app: str = "sales") -> dict[str, Any]:
    """The asker's seat in the sales or editor cockpit. Missing rows give empty strings."""
    out: dict[str, Any] = {"email": "", "roles": [], "name": "", "role": "", "ghl": "", "b2b": "", "maqsam": "", "manager": False}
    member = get(rest, key, "cockpit_members", {"auth_user_id": f"eq.{uid}", "active": "is.true", "select": "email,roles"}) if uid else None
    if not member:
        return out
    m = member[0]
    email = str(m.get("email") or "").strip()
    roles = [str(r) for r in (m.get("roles") or [])]
    out.update(email=email, roles=roles)
    if not email:
        return out
    if app == "editor":
        person = get(rest, key, "editor_people", {"email": f"eq.{email}", "select": "name,role"})
        if person:
            p = person[0]
            out.update(name=str(p.get("name") or ""), role=str(p.get("role") or ""))
        out["manager"] = out["role"] == "admin" or "admin" in roles or email.lower() in CEO_EMAILS
    else:
        person = get(rest, key, "cockpit_sales_people", {"email": f"eq.{email}", "select": "name,role,ghl_user_id,b2b_rep_id,maqsam_email,active"})
        if person:
            p = person[0]
            out.update(
                name=str(p.get("name") or ""),
                role=str(p.get("role") or ""),
                ghl=str(p.get("ghl_user_id") or ""),
                b2b=str(p.get("b2b_rep_id") or ""),
                maqsam=str(p.get("maqsam_email") or ""),
            )
        out["manager"] = out["role"] == "manager" or "admin" in roles or email.lower() in CEO_EMAILS
    return out


def sales_lead(rest: str, key: str, job: dict[str, Any], page: str | None, chain: list[tuple[str, str]]) -> tuple[str | None, str]:
    """The lead this chat is about: the page id, a phone number, or the model's pick."""
    found = re.match(r"^/(?:lead|call)/([A-Za-z0-9]+)", page or "")
    if found:
        return found.group(1), ""
    prompt = job.get("prompt") or ""
    numbers = re.findall(r"\d{8,}", prompt)
    if numbers:
        eight = numbers[-1][-8:]
        rows = get(rest, key, "cockpit_sales_leads", {"phone8": f"eq.{eight}", "select": "contact_id,name,company", "limit": "5"})
        return (str(rows[0].get("contact_id")), "") if rows else (None, "")
    history = [h.get("prompt") or "" for h in reversed((job.get("context") or {}).get("history", [])[:3])]
    said = "\n".join(f"- {t[:300]}" for t in [*history, prompt] if t.strip())
    msgs = [
        {"role": "system", "content": "You read a sales rep's chat. Reply with the lead's person name or company name exactly as written in the chat, or NONE when no lead is named."},
        {"role": "user", "content": f"The chat, oldest first:\n{said}"},
    ]
    fast = [c for c in chain if "haiku" in c[1]] + [c for c in chain if "haiku" not in c[1]]
    try:
        text, _ = ask_model(msgs, fast)
    except RuntimeError:
        return None, ""
    picked = text.strip().strip('"').strip()
    if not picked or picked.upper() == "NONE":
        return None, ""
    name = " ".join(re.sub(r"[^\w\s]|_", " ", picked).split())[:60]
    if len(name) < 2:
        return None, ""
    rows = get(rest, key, "cockpit_sales_leads", {
        "or": f"(name.ilike.*{name}*,company.ilike.*{name}*)",
        "select": "contact_id,name,company", "order": "lead_updated_at.desc", "limit": "6",
    })
    if not rows:
        return None, f'No lead matches "{name}".'
    if len(rows) == 1:
        return str(rows[0].get("contact_id")), ""
    shown = [f"{r.get('name') or 'no name'}" + (f" ({r['company']})" if r.get("company") else "") for r in rows[:5]]
    return None, f'Several leads match "{name}": ' + ", ".join(shown) + "."


def lead_pack(rest: str, key: str, contact_id: str) -> tuple[str, list[str]]:
    """Everything the cockpit knows about one sales lead, read only."""
    lines: list[str] = []
    sources: list[str] = []
    lead = get(rest, key, "cockpit_sales_leads", {
        "contact_id": f"eq.{contact_id}", "limit": "1",
        "select": "name,company,country,source,lead_class,stage_name,pipeline_name,opp_status,monetary_value,readiness,revenue,revenue_goal,decision_maker,challenge,services,grade,setter_name,lead_created_at,ad_name,campaign_name,assigned_to",
    })
    if lead is None:
        lines.append("Lead: could not be read.")
    elif lead:
        sources.append("sales lead")
        row = lead[0]
        owner = ""
        if row.get("assigned_to"):
            people = get(rest, key, "cockpit_sales_people", {"ghl_user_id": f"eq.{row['assigned_to']}", "select": "name"})
            if people:
                owner = str(people[0].get("name") or "")
        bits = [str(row.get("name") or "no name") + (f" ({row['company']})" if row.get("company") else "")]
        for field, label in (
            ("country", "country"), ("source", "source"), ("lead_class", "class"), ("stage_name", "stage"),
            ("pipeline_name", "pipeline"), ("opp_status", "opportunity status"), ("readiness", "readiness"),
            ("revenue", "revenue"), ("revenue_goal", "revenue goal"), ("decision_maker", "decision maker"),
            ("challenge", "challenge"), ("services", "services"), ("grade", "grade"), ("setter_name", "setter"),
            ("ad_name", "ad"), ("campaign_name", "campaign"),
        ):
            if row.get(field):
                bits.append(f"{label} {row[field]}")
        if row.get("monetary_value") is not None:
            bits.append("value " + money(num(row["monetary_value"])))
        if row.get("lead_created_at"):
            bits.append("created " + kuwait_time(row["lead_created_at"]))
        if owner:
            bits.append("owner " + owner)
        lines.append("Lead: " + "; ".join(bits) + ".")

    appts = get(rest, key, "cockpit_sales_appointments", {
        "contact_id": f"eq.{contact_id}", "order": "start_at.desc", "limit": "6",
        "select": "start_at,call_type,status,assigned_user_name",
    })
    if appts is None:
        lines.append("Calls on the calendar: could not be read.")
    elif appts:
        sources.append("sales appointments")
        lines.append("Calls on the calendar, newest first:")
        for a in appts:
            rep = f", rep {a['assigned_user_name']}" if a.get("assigned_user_name") else ""
            lines.append(f"- {kuwait_time(a.get('start_at'))} {a.get('call_type') or 'call'}: {a.get('status') or 'no status'}{rep}")

    call_notes = get(rest, key, "cockpit_sales_call_notes", {
        "contact_id": f"eq.{contact_id}", "order": "call_at.desc", "limit": "3",
        "select": "call_type,call_at,rep,notes,verdict,verdict_why",
    })
    if call_notes is None:
        lines.append("Call notes: could not be read.")
    elif call_notes:
        sources.append("call notes")
        lines.append("Call notes, newest first:")
        for n in call_notes:
            note = n.get("notes")
            note_text = note if isinstance(note, str) else json.dumps(note or {}, ensure_ascii=False)
            lines.append(
                f"- {kuwait_time(n.get('call_at'))} {n.get('call_type') or 'call'} by {n.get('rep') or 'unknown'}:"
                f" {note_text[:1200]} (verdict {n.get('verdict') or 'none'}: {(n.get('verdict_why') or '')[:300]})"
            )

    recordings = get(rest, key, "cockpit_sales_recordings", {
        "contact_id": f"eq.{contact_id}", "hidden_reason": "is.null", "duplicate_of": "is.null",
        "order": "started_at.desc", "limit": "3", "select": "title,started_at,summary,action_items",
    })
    if recordings is None:
        lines.append("Recorded calls: could not be read.")
    elif recordings:
        sources.append("recorded calls")
        lines.append("Recorded calls, newest first:")
        for r in recordings:
            lines.append(f"- {kuwait_time(r.get('started_at'))} {r.get('title') or 'call'}: {(r.get('summary') or '')[:1500]}".rstrip())
            if r.get("action_items"):
                lines.append(f"  Action items: {str(r['action_items'])[:600]}")

    dials = get(rest, key, "cockpit_sales_dials", {
        "contact_id": f"eq.{contact_id}", "order": "occurred_at.desc", "limit": "5",
        "select": "occurred_at,agent_name,direction,state,duration_s,summary_en",
    })
    if dials is None:
        lines.append("Dialer calls: could not be read.")
    elif dials:
        sources.append("dialer calls")
        lines.append("Dialer calls, newest first:")
        for d in dials:
            lines.append(
                f"- {kuwait_time(d.get('occurred_at'))} {d.get('agent_name') or 'someone'} {d.get('direction') or ''}"
                f" {d.get('state') or 'unknown'}, {int(num(d.get('duration_s')))} s: {(d.get('summary_en') or '')[:400]}"
            )

    messages = get(rest, key, "cockpit_sales_conversation_messages", {
        "contact_id": f"eq.{contact_id}", "order": "at.desc", "limit": "15",
        "select": "at,direction,channel,body,automated",
    })
    if messages is None:
        lines.append("Messages: could not be read.")
    elif messages:
        sources.append("messages")
        lines.append("Messages, oldest first:")
        for m in reversed(messages):
            auto = " (automated)" if m.get("automated") else ""
            lines.append(f"- {kuwait_time(m.get('at'))} {m.get('direction') or ''} via {m.get('channel') or ''}{auto}: {(m.get('body') or '')[:400]}")

    followups = get(rest, key, "cockpit_sales_followups", {
        "contact_id": f"eq.{contact_id}", "order": "created_at.desc", "limit": "3",
        "select": "status,channel,created_at,final_body,body",
    })
    if followups is None:
        lines.append("Follow-ups: could not be read.")
    elif followups:
        sources.append("follow-up drafts")
        lines.append("Follow-up drafts, newest first:")
        for f in followups:
            body = f.get("final_body") or f.get("body") or ""
            lines.append(f"- {kuwait_time(f.get('created_at'))} {f.get('status') or 'draft'} {f.get('channel') or ''}: {str(body)[:400]}")

    hot = get(rest, key, "cockpit_sales_hot", {
        "contact_id": f"eq.{contact_id}", "removed_at": "is.null",
        "select": "heat,status,next_at,next_how,last_objection,note,amount,amount_currency",
    })
    if hot is None:
        lines.append("Hot list: could not be read.")
    elif hot:
        sources.append("hot list")
        lines.append("Hot list:")
        for h in hot:
            amount = f"{num(h.get('amount')):,.0f} {h.get('amount_currency') or 'USD'}" if h.get("amount") is not None else "not said"
            lines.append(
                f"- {h.get('heat') or 'hot'} {h.get('status') or 'nurturing'}: next {kuwait_time(h.get('next_at'))} by {h.get('next_how') or 'no plan'};"
                f" objection: {(h.get('last_objection') or 'none')[:300]}; note: {(h.get('note') or '')[:300]}; worth {amount}"
            )

    deals = get(rest, key, "cockpit_sales_deals", {
        "contact_id": f"eq.{contact_id}", "voided": "not.is.true", "order": "submitted_at.desc", "limit": "5",
        "select": "submitted_at,closer,setter,cash_collected,contracted_revenue,new_mrr,agreement_type,payment_structure",
    })
    if deals is None:
        lines.append("Deals: could not be read.")
    elif deals:
        sources.append("deals")
        lines.append("Deals:")
        for d in deals:
            lines.append(
                f"- {kuwait_time(d.get('submitted_at'))} closer {d.get('closer') or 'none'}, setter {d.get('setter') or 'none'}:"
                f" cash {money(num(d.get('cash_collected')))}, contracted {money(num(d.get('contracted_revenue')))},"
                f" new MRR {money(num(d.get('new_mrr')))}, {d.get('agreement_type') or 'agreement'}, {d.get('payment_structure') or 'no payment structure'}"
            )

    proposals = get(rest, key, "cockpit_sales_proposals", {
        "contact_id": f"eq.{contact_id}", "order": "created_at.desc", "limit": "5",
        "select": "status,variant,created_at,sent_at",
    })
    if proposals is None:
        lines.append("Proposals: could not be read.")
    elif proposals:
        sources.append("proposals")
        lines.append("Proposals, newest first:")
        for p in proposals:
            lines.append(f"- {kuwait_time(p.get('created_at'))} {p.get('status') or 'drafting'}, variant {p.get('variant') or 'none'}, sent {kuwait_time(p.get('sent_at')) if p.get('sent_at') else 'not sent'}")

    contracts = get(rest, key, "cockpit_sales_contracts", {
        "contact_id": f"eq.{contact_id}", "order": "created_at.desc", "limit": "5",
        "select": "template_name,status,sent_at,viewed_at,signed_at",
    })
    if contracts is None:
        lines.append("Contracts: could not be read.")
    elif contracts:
        sources.append("contracts")
        lines.append("Contracts, newest first:")
        for c in contracts:
            lines.append(
                f"- {c.get('template_name') or 'contract'}: {c.get('status') or 'draft'},"
                f" sent {kuwait_time(c.get('sent_at')) if c.get('sent_at') else 'not sent'},"
                f" viewed {kuwait_time(c.get('viewed_at')) if c.get('viewed_at') else 'not viewed'},"
                f" signed {kuwait_time(c.get('signed_at')) if c.get('signed_at') else 'not signed'}"
            )

    research = get(rest, key, "cockpit_sales_research", {
        "contact_id": f"eq.{contact_id}", "brief": "not.is.null", "order": "requested_at.desc", "limit": "1",
        "select": "brief,status,requested_at",
    })
    if research is None:
        lines.append("Research: could not be read.")
    elif research:
        sources.append("research brief")
        brief = research[0].get("brief")
        text = brief if isinstance(brief, str) else json.dumps(brief or {}, ensure_ascii=False)
        lines.append(f"Research brief ({research[0].get('status') or 'unknown'}, requested {kuwait_time(research[0].get('requested_at'))}): {text[:2000]}")
    return "\n".join(lines), sources


def sales_day(rest: str, key: str, who: dict[str, Any]) -> tuple[str, list[str]]:
    """The rep's day in Kuwait: calls, drafts, hot leads, replies owed and new leads."""
    lines: list[str] = []
    sources: list[str] = []
    start, end = kuwait_day_bounds(datetime.now(KUWAIT).date())
    now = datetime.now(timezone.utc).isoformat()
    manager = bool(who.get("manager"))
    email = str(who.get("email") or "")
    ghl = str(who.get("ghl") or "")

    if not manager and not ghl:
        lines.append("Your seat has no HighLevel user, so your calendar cannot be read.")
    else:
        query = {
            "and": f"(start_at.gte.{start},start_at.lt.{end})", "status": "not.in.(cancelled,invalid)",
            "select": "start_at,call_type,contact_name,status,assigned_user_name", "order": "start_at.asc", "limit": "200",
        }
        if not manager:
            query["assigned_user_id"] = f"eq.{ghl}"
        calls = get(rest, key, "cockpit_sales_calendar", query)
        if calls is None:
            lines.append("Calls today: could not be read.")
        elif calls:
            sources.append("calendar")
            lines.append("Calls today, Kuwait time:")
            for c in calls:
                rep = f" [rep {c['assigned_user_name']}]" if manager and c.get("assigned_user_name") else ""
                lines.append(f"- {kuwait_clock(c.get('start_at'))} {c.get('call_type') or 'call'} with {c.get('contact_name') or 'a lead'} ({c.get('status') or 'no status'}){rep}")

    query = {"status": "eq.draft", "expires_at": f"gt.{now}", "select": "contact_id,channel,created_at,owner_email", "order": "created_at.desc", "limit": "200"}
    if not manager:
        query["owner_email"] = f"eq.{email}"
    drafts = get(rest, key, "cockpit_sales_followups", query)
    if drafts is None:
        lines.append("Follow-up drafts: could not be read.")
    elif drafts:
        sources.append("follow-up drafts")
        lines.append(f"Follow-up drafts waiting: {len(drafts)}.")
        first = drafts[:5]
        ids = [str(d.get("contact_id")) for d in first if d.get("contact_id")]
        names: dict[str, str] = {}
        if ids:
            leads = get(rest, key, "cockpit_sales_leads", {"contact_id": in_list(ids), "select": "contact_id,name"})
            names = {str(l.get("contact_id")): str(l.get("name") or "a lead") for l in (leads or [])}
        for d in first:
            rep = f" [rep {d['owner_email']}]" if manager and d.get("owner_email") else ""
            lines.append(f"- {names.get(str(d.get('contact_id')), 'a lead')} ({d.get('channel') or 'message'}){rep}")

    query = {
        "removed_at": "is.null", "status": "eq.nurturing", "next_at": f"lt.{end}",
        "select": "contact_id,next_at,next_how,last_objection,heat,owner_email", "order": "next_at.asc", "limit": "50",
    }
    if not manager:
        query["owner_email"] = f"eq.{email}"
    hot = get(rest, key, "cockpit_sales_hot", query)
    if hot is None:
        lines.append("Hot list: could not be read.")
    elif hot:
        sources.append("hot list")
        lines.append("Hot list due:")
        ids = [str(h.get("contact_id")) for h in hot if h.get("contact_id")]
        names = {}
        if ids:
            leads = get(rest, key, "cockpit_sales_leads", {"contact_id": in_list(ids), "select": "contact_id,name"})
            names = {str(l.get("contact_id")): str(l.get("name") or "a lead") for l in (leads or [])}
        for h in hot:
            rep = f" [rep {h['owner_email']}]" if manager and h.get("owner_email") else ""
            lines.append(f"- {names.get(str(h.get('contact_id')), 'a lead')}: next {kuwait_clock(h.get('next_at'))} by {h.get('next_how') or 'no plan'}; last objection: {(h.get('last_objection') or 'none')[:200]}{rep}")

    query = {
        "needs_reply": "is.true", "select": "contact_id,contact_name,last_in_at,last_in_channel,last_in_body,assigned_to",
        "order": "last_in_at.asc", "limit": "200",
    }
    if not manager:
        query["assigned_to"] = f"eq.{ghl}"
    waiting = get(rest, key, "cockpit_sales_conversations", query)
    if waiting is None:
        lines.append("Waiting for a reply: could not be read.")
    elif waiting:
        sources.append("messages")
        lines.append(f"Waiting for a reply: {len(waiting)}.")
        for w in waiting[:10]:
            rep = f" [rep {w['assigned_to']}]" if manager and w.get("assigned_to") else ""
            lines.append(
                f"- {w.get('contact_name') or 'a lead'} on {w.get('last_in_channel') or 'a channel'},"
                f" waiting since {kuwait_time(w.get('last_in_at'))}: {(w.get('last_in_body') or '')[:160]}{rep}"
            )

    since = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    query = {"is_lead": "is.true", "lead_created_at": f"gte.{since}", "select": "contact_id,name,lead_created_at,assigned_to", "order": "lead_created_at.desc", "limit": "50"}
    if not manager:
        query["assigned_to"] = f"eq.{ghl}"
    new_leads = get(rest, key, "cockpit_sales_leads", query)
    if new_leads is None:
        lines.append("New leads: could not be read.")
    elif new_leads:
        ids = [str(l.get("contact_id")) for l in new_leads if l.get("contact_id")]
        called = get(rest, key, "cockpit_sales_dials", {"contact_id": in_list(ids), "select": "contact_id"}) if ids else []
        if called is None:
            lines.append("New leads: could not check which ones have been called.")
        else:
            done = {str(d.get("contact_id")) for d in called}
            fresh = [l for l in new_leads if str(l.get("contact_id")) not in done]
            if fresh:
                sources.append("leads")
                lines.append(f"New leads not called yet: {len(fresh)}.")
                for l in fresh:
                    rep = f" [rep {l['assigned_to']}]" if manager and l.get("assigned_to") else ""
                    lines.append(f"- {l.get('name') or 'a lead'}, created {kuwait_time(l.get('lead_created_at'))}{rep}")
    return "\n".join(lines), sources


def person_numbers(rest: str, key: str, name: str, role: str, b2b: str, maqsam: str, start: str, end: str, month_first: Any) -> tuple[str, list[str]]:
    """One seat's month so far, counted the way the sales cockpit's end of day counts it."""
    lines: list[str] = [f"{name}:"]
    sources: list[str] = []
    rep = get(rest, key, "cockpit_sales_reps", {"id": f"eq.{b2b}", "select": "display_name,closer_aliases"})
    if rep is None:
        return f"{name}: numbers could not be read.", []
    names = [str(n).strip().lower() for n in ([rep[0].get("display_name")] + list(rep[0].get("closer_aliases") or []) if rep else []) if str(n or "").strip()]
    if not names:
        return f"{name}: the rep roster has no row for this seat, so numbers cannot be counted.", []

    deals = get(rest, key, "cockpit_sales_deals", {
        "and": f"(submitted_at.gte.{start},submitted_at.lt.{end})", "voided": "not.is.true",
        "select": "closer,setter,cash_collected,contracted_revenue",
    })
    count: int | None = None
    cash: float | None = None
    if deals is None:
        lines.append("Deals: could not be read.")
    else:
        field = "setter" if role == "setter" else "closer"
        mine = [d for d in deals if not d.get("voided") and str(d.get(field) or "").strip().lower() in names]
        count = len(mine)
        cash = sum(num(d.get("cash_collected")) for d in mine)
        contracted = sum(num(d.get("contracted_revenue")) for d in mine)
        rule = "New Client Forms naming you as the setter, voided ones out" if role == "setter" else "New Client Forms naming you as the closer, voided ones out"
        lines.append(f"Deals: {count}, cash {money(cash)}, contracted {money(contracted)}, this month so far ({rule}).")
        sources.append("deals")

    dials_count: int | None = None
    if role == "setter":
        maqsam = str(maqsam or "").strip()
        if maqsam:
            dials = get(rest, key, "cockpit_sales_dials", {
                "agent_email": f"eq.{maqsam}", "direction": "eq.outbound",
                "and": f"(occurred_at.gte.{start},occurred_at.lt.{end})", "select": "state,duration_s", "limit": "5000",
            })
            if dials is None:
                lines.append("Dials: could not be read.")
            else:
                answered = [d for d in dials if d.get("state") == "completed"]
                conversations = [d for d in answered if num(d.get("duration_s")) >= 60]
                dials_count = len(dials)
                lines.append(f"Dials: {dials_count}, this month so far (outbound calls from your Maqsam line).")
                lines.append(f"Answered: {len(answered)}, this month so far (of those dials, the ones someone answered).")
                lines.append(f"Conversations: {len(conversations)}, this month so far (answered, a minute or longer).")
                sources.append("dialer calls")
        else:
            lines.append("Dials: this seat has no Maqsam address, so calls cannot be counted.")

    goals = get(rest, key, "cockpit_sales_goals", {"person_key": f"eq.{b2b}", "month": f"eq.{month_first.isoformat()}", "select": "metric,goal,forecast"})
    if goals is None:
        lines.append("Goals: could not be read.")
    elif goals:
        sources.append("goals")
        actual: dict[str, Any] = {"cash": cash, "closes": count, "dials": dials_count}
        for g in goals:
            metric = str(g.get("metric") or "")
            if g.get("goal") is not None:
                label, target = "Goal", num(g.get("goal"))
            elif g.get("forecast") is not None:
                # The manager has not set a goal yet; the rep's own forecast is the target on the Goals page.
                label, target = "No goal set yet; the rep's own forecast", num(g.get("forecast"))
            else:
                continue
            got = actual.get(metric)
            goal_text = money(target) if metric == "cash" else f"{int(target)}"
            if got is None:
                lines.append(f"{label} for {metric}: {goal_text}; the cockpit does not count {metric} here.")
            else:
                got_text = money(num(got)) if metric == "cash" else f"{int(num(got))}"
                lines.append(f"{label} for {metric}: {goal_text} against {got_text} this month so far.")
    return "\n".join(lines), sources


def sales_numbers(rest: str, key: str, who: dict[str, Any]) -> tuple[str, list[str]]:
    """This month so far in Kuwait, for one rep or the whole team."""
    now = datetime.now(KUWAIT)
    month_first = now.date().replace(day=1)
    start = datetime(month_first.year, month_first.month, month_first.day, tzinfo=KUWAIT).astimezone(timezone.utc).isoformat()
    end = now.astimezone(timezone.utc).isoformat()
    if who.get("manager"):
        team = get(rest, key, "cockpit_sales_people", {
            "active": "is.true", "b2b_rep_id": "not.is.null",
            "select": "email,name,role,b2b_rep_id,maqsam_email", "order": "name.asc",
        })
        if team is None:
            return "Team numbers: could not be read.", []
        if not team:
            return "Numbers: no active sales seat is linked to a sales rep.", []
        blocks: list[str] = []
        sources: list[str] = []
        for p in team:
            text, src = person_numbers(
                rest, key, str(p.get("name") or p.get("email") or "someone"), str(p.get("role") or ""),
                str(p.get("b2b_rep_id") or ""), str(p.get("maqsam_email") or ""), start, end, month_first,
            )
            blocks.append(text)
            sources += [s for s in src if s not in sources]
        return "\n\n".join(blocks), sources
    b2b = str(who.get("b2b") or "")
    if not b2b:
        return "Numbers: this seat is not linked to a sales rep, so numbers cannot be counted.", []
    return person_numbers(
        rest, key, str(who.get("name") or who.get("email") or "you"), str(who.get("role") or ""),
        b2b, str(who.get("maqsam") or ""), start, end, month_first,
    )


def sales_data(rest: str, key: str, who: dict[str, Any], job: dict[str, Any], page: str | None, chain: list[tuple[str, str]]) -> tuple[str, list[str]]:
    parts: list[str] = [f"Person: {who.get('name') or who.get('email') or 'someone'} ({who.get('role') or 'none'}), manager: {'yes' if who.get('manager') else 'no'}."]
    sources: list[str] = []
    try:
        lead_id, note = sales_lead(rest, key, job, page, chain)
    except Exception:
        lead_id, note = None, ""
    if note:
        parts.append(note)
    if lead_id:
        try:
            text, src = lead_pack(rest, key, lead_id)
            parts.append(text)
            sources += src
        except Exception:
            parts.append("Lead: could not be read.")
    try:
        text, src = sales_day(rest, key, who)
        parts.append(text)
        sources += src
    except Exception:
        parts.append("Today: could not be read.")
    try:
        text, src = sales_numbers(rest, key, who)
        parts.append(text)
        sources += src
    except Exception:
        parts.append("Numbers: could not be read.")
    return "\n\n".join(p for p in parts if p), sources


def editor_pack(rest: str, key: str, who: dict[str, Any], page: str | None) -> tuple[str, list[str]]:
    """The editor's jobs, the review notes on the next few, and the open job's versions."""
    lines: list[str] = []
    sources: list[str] = []
    editor_filter = ""
    if not who.get("manager"):
        editor_filter = 'cs.[{"email":"' + str(who.get("email") or "") + '"}]'
    query = {"state": "neq.gone", "select": "task_id,name,client,status,due_at,state,missing,url", "order": "due_at.asc.nullslast", "limit": "40"}
    if editor_filter:
        query["editors"] = editor_filter
    jobs = get(rest, key, "editor_jobs", query)
    if jobs is None:
        lines.append("Jobs: could not be read.")
        jobs = []
    else:
        jobs = [j for j in jobs if not str(j.get("status") or "").strip().lower().startswith(("cancelled", "live"))]
    jobs.sort(key=lambda j: (j.get("due_at") is None, str(j.get("due_at") or "")))

    found = re.match(r"^/job/([A-Za-z0-9]+)", page or "")
    page_id = found.group(1) if found else None
    page_job = None
    if page_id:
        page_job = next((j for j in jobs if str(j.get("task_id")) == page_id), None)
        if page_job is None:
            pq = {"task_id": f"eq.{page_id}", "select": "task_id,name,client,status,due_at,state,missing,url", "limit": "1"}
            if editor_filter:
                pq["editors"] = editor_filter
            rows = get(rest, key, "editor_jobs", pq)
            candidate = rows[0] if rows else None
            if candidate and not str(candidate.get("status") or "").strip().lower().startswith(("cancelled", "live")):
                page_job = candidate
                jobs = [page_job] + jobs
    if page_job:
        jobs = [page_job] + [j for j in jobs if str(j.get("task_id")) != page_id]

    if jobs:
        sources.append("editor jobs")
        lines.append("Jobs, most urgent first:")
        now = datetime.now(timezone.utc)
        for j in jobs:
            due = "no due date"
            if j.get("due_at"):
                due = kuwait_time(j["due_at"])
                try:
                    if datetime.fromisoformat(str(j["due_at"]).replace("Z", "+00:00")) < now:
                        due += " (overdue)"
                except ValueError:
                    pass
            bits = [str(j.get("name") or "untitled job")]
            if j.get("client"):
                bits.append(f"client {j['client']}")
            bits.append(f"status {j.get('status') or 'none'}")
            bits.append(f"due {due}")
            if j.get("state"):
                bits.append(f"state {j['state']}")
            if j.get("missing"):
                missing = j["missing"] if isinstance(j["missing"], list) else [j["missing"]]
                bits.append("missing " + ", ".join(str(x) for x in missing))
            if j.get("url"):
                bits.append(str(j["url"]))
            lines.append("- " + "; ".join(bits))

    urgent = [str(j.get("task_id")) for j in jobs[:10] if j.get("task_id")]
    if urgent:
        notes = get(rest, key, "editor_notes", {
            "task_id": in_list(urgent), "done": "is.false", "order": "at.desc", "limit": "60",
            "select": "task_id,version,by_name,text,at",
        })
        if notes is None:
            lines.append("Review notes: could not be read.")
        elif notes:
            grouped: dict[str, list[dict[str, Any]]] = {}
            for n in notes:
                group = grouped.setdefault(str(n.get("task_id")), [])
                if len(group) < 5:
                    group.append(n)
            worth = {tid: group for tid, group in grouped.items() if tid != page_id}
            if worth:
                sources.append("review notes")
                lines.append("Review notes on those jobs (up to 5 each):")
                for j in jobs[:10]:
                    tid = str(j.get("task_id"))
                    if tid in worth:
                        lines.append(f"- {j.get('name') or tid}:")
                        for n in worth[tid]:
                            version = f"v{n['version']} " if n.get("version") is not None else ""
                            lines.append(f"  - {version}{n.get('by_name') or 'someone'}: {(n.get('text') or '')[:300]}")

    if page_job:
        lines.append(f"Open page job: {page_job.get('name') or page_id} ({page_job.get('status') or 'no status'}).")
        page_notes = get(rest, key, "editor_notes", {
            "task_id": f"eq.{page_id}", "done": "is.false", "order": "at.desc", "limit": "60",
            "select": "version,by_name,text,at",
        })
        if page_notes is None:
            lines.append("Open notes on this job: could not be read.")
        elif page_notes:
            sources.append("page job notes")
            lines.append("All open notes on this job:")
            for n in page_notes:
                version = f"v{n['version']} " if n.get("version") is not None else ""
                lines.append(f"- {version}{n.get('by_name') or 'someone'}: {(n.get('text') or '')[:300]}")
        versions = get(rest, key, "editor_versions", {
            "task_id": f"eq.{page_id}", "order": "n.desc", "limit": "3", "select": "n,name,seconds,passed,at",
        })
        if versions is None:
            lines.append("Versions: could not be read.")
        elif versions:
            sources.append("versions")
            lines.append("Latest versions:")
            for v in versions:
                lines.append(f"- v{v.get('n') if v.get('n') is not None else '?'} {v.get('name') or ''}: {v.get('seconds') if v.get('seconds') is not None else '?'} s, {'passed' if v.get('passed') else 'not passed'}, {kuwait_time(v.get('at'))}")
    return "\n".join(lines), sources


def editor_data(rest: str, key: str, who: dict[str, Any], page: str | None) -> tuple[str, list[str]]:
    parts: list[str] = [f"Person: {who.get('name') or who.get('email') or 'someone'} ({who.get('role') or 'none'}), manager: {'yes' if who.get('manager') else 'no'}."]
    sources: list[str] = []
    try:
        text, src = editor_pack(rest, key, who, page)
        parts.append(text)
        sources += src
    except Exception:
        parts.append("Jobs: could not be read.")
    return "\n\n".join(p for p in parts if p), sources


def prepare(job: dict[str, Any], e: dict[str, str], rest: str, key: str, chain: list[tuple[str, str]]) -> tuple[list[dict[str, Any]], list[str], str | None]:
    ctx = job.get("context") or {}
    profiles = ctx.get("profiles") or []
    meta = get(rest, key, "cockpit_ask_ai_jobs", {"id": f"eq.{job['id']}", "select": "auth_user_id,page:metadata->request->context->>page"})
    page = (meta[0].get("page") if meta else None) or None
    uid = meta[0].get("auth_user_id") if meta else None
    app = str(job.get("app") or "")
    if app in ("sales", "editor"):
        who = who_is(rest, key, uid, app)
        sources: list[str] = []
        if app == "sales":
            data, src = sales_data(rest, key, who, job, page, chain)
        else:
            data, src = editor_data(rest, key, who, page)
        sources += src
        guide, changes, source = live_guide(e, app)
        sources.append(f"cockpit guide ({source})")
        return build_messages(job, data, [], page, guide=guide, changes=changes), sources, None
    names = visible_clients(rest, key, uid, [p.get("client_name") for p in profiles if p.get("client_name")])
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
    guide, changes, source = live_guide(e, str(job.get("app")))
    sources.append(f"cockpit guide ({source})")
    return build_messages(job, "\n\n".join(parts), images, page, guide=guide, changes=changes), sources, client


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
    guide_source = next((s[len("cockpit guide ("):-1] for s in sources if s.startswith("cockpit guide (") and s.endswith(")")), None)
    return {"reply": text, "model": used, "sources": sources, "client": client, "guide_source": guide_source, "engine": "responder-v2"}


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
                    state.setdefault("guides", {})[str(job.get("app"))] = {"source": result.get("guide_source"), "at": datetime.now(timezone.utc).isoformat()}
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
    report["github_configured"] = bool(e.get("GITHUB_TOKEN"))
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
