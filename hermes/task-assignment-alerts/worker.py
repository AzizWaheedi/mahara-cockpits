#!/usr/bin/env python3
"""Main-task assignment alerts. One host, an OS lock, and a durable send ledger."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

ROUTES = {
    "901816723190": ("Operations / Tech", "C0AS2JLMJCB"),
    "901816723196": ("Marketing / ADs", "C0C8DLZGTMZ"),
    "901816723206": ("Call Center", "C09R83NNQV9"),
    "901816723211": ("Client Success", "C09RZ0GS0V9"),
    "901818016338": ("Media/Creative", "C0AE8G5MT7Y"),
    "901816720767": ("Video Pipeline", "C0BJF7RR09Y"),
}
VIDEO_LIST = "901816720767"
EDITOR_FIELD = "8e519279-da37-4ae2-93fa-78865ee187fc"
ROUTE_VERSION = hashlib.sha256(json.dumps(ROUTES, sort_keys=True).encode()).hexdigest()
MAX_PAGES = 100
OVERLAP_MS = 10 * 60 * 1000


def utc(ms=None):
    return dt.datetime.fromtimestamp((ms if ms is not None else time.time()*1000)/1000, dt.timezone.utc).isoformat()


def people(task):
    people = task.get("assignees")
    if not isinstance(people, list):
        raise ValueError("ClickUp assignees are missing.")
    people = list(people)
    if task.get("list", {}).get("id") == VIDEO_LIST:
        fields = task.get("custom_fields")
        if not isinstance(fields, list):
            raise ValueError("Video editor fields are missing.")
        editor = next((f for f in fields if f.get("id") == EDITOR_FIELD), None)
        if editor is None or editor.get("type") != "users":
            raise ValueError("The verified Assigned Editor field is missing or changed.")
        assigned = editor.get("value") or []
        if not isinstance(assigned, list):
            raise ValueError("The Assigned Editor value is incomplete.")
        people += assigned
    if any(not isinstance(p, dict) or not str(p.get("id", "")).isdigit() for p in people):
        raise ValueError("ClickUp assignees are incomplete.")
    return list({str(p["id"]): p for p in people}.values())


def ids(task):
    assigned = people(task)
    result = sorted({str(p["id"]) for p in assigned if str(p.get("id", "")).isdigit()})
    if len(result) != len(assigned):
        raise ValueError("ClickUp assignees are incomplete or duplicated.")
    return result


def eligible(task, lid):
    return (task.get("list", {}).get("id") == lid and "parent" in task
            and task["parent"] is None and not task.get("archived")
            and task.get("status", {}).get("type") not in (None, "closed", "done"))


def new_video_request(task):
    return str(task.get("status", {}).get("status", "")).strip().lower() == "new video request"


def escape(value):
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class ProviderError(Exception):
    def __init__(self, provider, code, retry=False, ambiguous=False, delay=60):
        super().__init__(f"{provider}: {code}")
        self.retry, self.ambiguous, self.delay = retry, ambiguous, delay


class API:
    def __init__(self, env, opener=urllib.request.urlopen):
        self.env, self.opener = env, opener
        self.last_post = 0.0

    def request(self, provider, path, body=None, extra=None):
        if provider == "ClickUp":
            url, key = "https://api.clickup.com/api/v2/"+path, self.env["CLICKUP_API_TOKEN"]
        elif provider == "Slack":
            url, key = "https://slack.com/api/"+path, "Bearer "+self.env["SLACK_BOT_TOKEN"]
        else:
            base = self.env["DESK_SUPABASE_URL"].rstrip("/")
            if base != "https://bldgtotkfmhoxmlzowdx.supabase.co":
                raise ValueError("Wrong health database.")
            url, key = base+"/rest/v1/"+path, "Bearer "+self.env["DESK_SUPABASE_KEY"]
        headers = {"Authorization": key, "Content-Type": "application/json", **(extra or {})}
        if provider == "Supabase":
            headers["apikey"] = self.env["DESK_SUPABASE_KEY"]
        outbound = provider == "Slack" and path == "chat.postMessage"
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
            with self.opener(req, timeout=25) as resp:
                raw = resp.read()
            result = json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as exc:
            raise ProviderError(provider, f"HTTP {exc.code}", retry=exc.code == 429 or (exc.code >= 500 and not outbound),
                                ambiguous=outbound and exc.code >= 500,
                                delay=max(60, min(3600, int(exc.headers.get("Retry-After", "60"))))) from None
        except (TimeoutError, OSError, ValueError):
            raise ProviderError(provider, "No valid response", retry=not outbound, ambiguous=outbound) from None
        if provider == "Slack" and (not isinstance(result, dict) or result.get("ok") is not True):
            code = result.get("error", "Missing result") if isinstance(result, dict) else "Missing result"
            # Only documented, explicit refusal can safely retry a send.
            raise ProviderError(provider, str(code)[:80], retry=code in ("ratelimited", "rate_limited"),
                                ambiguous=outbound and code in ("internal_error", "fatal_error", "request_timeout", "Missing result"))
        return result

    def tasks(self, lid, since=None):
        found = {}
        for page in range(MAX_PAGES):
            q = {"include_closed": "true", "subtasks": "false", "include_timl": "false", "page": page, "order_by": "updated"}
            if since is not None:
                q["date_updated_gt"] = max(0, since-OVERLAP_MS)
            result = self.request("ClickUp", "list/"+lid+"/task?"+urllib.parse.urlencode(q))
            if not isinstance(result, dict) or not isinstance(result.get("tasks"), list):
                raise ValueError("Incomplete ClickUp task page.")
            for task in result["tasks"]:
                if not re.fullmatch(r"[a-zA-Z0-9]+", str(task.get("id", ""))):
                    raise ValueError("Invalid ClickUp task identity.")
                found[task["id"]] = task
            if result.get("last_page") is True or ("last_page" not in result and len(result["tasks"]) < 100):
                return list(found.values())
        raise ValueError("ClickUp pagination did not complete. Cursor is unchanged.")

    def task(self, task_id):
        if not re.fullmatch(r"[a-zA-Z0-9]+", task_id):
            raise ValueError("Invalid task ID.")
        task = self.request("ClickUp", "task/"+task_id)
        if not isinstance(task, dict) or task.get("id") != task_id:
            raise ValueError("Task identity did not match.")
        return task

    def users(self):
        found, cursor = {}, ""
        for _ in range(20):
            result = self.request("Slack", "users.list?"+urllib.parse.urlencode({"limit": 200, "cursor": cursor}))
            if not isinstance(result.get("members"), list):
                raise ValueError("Slack user directory is incomplete.")
            for user in result["members"]:
                email = user.get("profile", {}).get("email", "").strip().lower()
                if email and not user.get("deleted") and not user.get("is_bot"):
                    found.setdefault(email, []).append(user["id"])
            cursor = result.get("response_metadata", {}).get("next_cursor", "")
            if not cursor:
                return {email: matches[0] for email, matches in found.items() if len(set(matches)) == 1}
        raise ValueError("Slack user pagination did not complete.")

    def find_receipt(self, channel, event_id, since):
        cursor = ""
        for _ in range(20):
            result = self.request("Slack", "conversations.history?"+urllib.parse.urlencode({
                "channel": channel, "oldest": max(0, since/1000-60), "limit": 100, "cursor": cursor}))
            for message in result.get("messages", []):
                if message.get("client_msg_id") == event_id or f"TA-{event_id}" in message.get("text", ""):
                    ts = message.get("ts")
                    if isinstance(ts, str) and re.fullmatch(r"\d+\.\d+", ts):
                        return ts
            cursor = result.get("response_metadata", {}).get("next_cursor", "")
            if not cursor:
                return None
        # Absence is never permission to replay an ambiguous send.
        return None

    def send(self, payload):
        time.sleep(max(0, 1.1-(time.monotonic()-self.last_post)))
        self.last_post = time.monotonic()
        result = self.request("Slack", "chat.postMessage", payload)
        ts = result.get("ts")
        if result.get("channel") != payload["channel"] or not isinstance(ts, str) or not re.fullmatch(r"\d+\.\d+", ts):
            raise ProviderError("Slack", "Missing matching receipt", ambiguous=True)
        return ts

    def heartbeat(self, report):
        stamp = utc()
        row = {"key": "task-assignment-alerts", "last_run_at": stamp, "updated_at": stamp,
               "ok": report["healthy"], "note": json.dumps(report, sort_keys=True), "rows_seen": report["tasks_seen"]}
        if report["healthy"]:
            row["last_ok_at"] = stamp
        self.request("Supabase", "cockpit_sync_state?on_conflict=key", row,
                     {"Prefer": "resolution=merge-duplicates,return=minimal"})


def open_db(path, bootstrap=False):
    path = Path(path)
    if not path.exists() and not bootstrap:
        raise RuntimeError("Assignment ledger is missing. Stop and restore it; do not recreate it automatically.")
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.executescript("""
      PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lists(id TEXT PRIMARY KEY,cursor_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,list_id TEXT NOT NULL,assignees TEXT NOT NULL,generation INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,list_id TEXT NOT NULL,
        assignees TEXT NOT NULL,state TEXT NOT NULL,created_ms INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'assignment',attempts INTEGER NOT NULL DEFAULT 0,
        next_ms INTEGER NOT NULL DEFAULT 0,sent_ms INTEGER,receipt TEXT,error TEXT,unmapped INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS pending ON deliveries(state,next_ms);
    """)
    os.chmod(path, 0o600)
    version = db.execute("select value from meta where key='routes'").fetchone()
    if version and version[0] != ROUTE_VERSION:
        raise RuntimeError("Route changes require a reviewed migration. Existing ledger was preserved.")
    return db


def observe(db, tasks, lid, stamp, baseline=False):
    with db:
        for task in tasks:
            if task.get("list", {}).get("id") != lid or "parent" not in task:
                raise ValueError("ClickUp list or parent identity is missing or different.")
            assigned = ids(task)
            previous = db.execute("select * from tasks where id=?", (task["id"],)).fetchone()
            old = json.loads(previous["assignees"]) if previous and previous["list_id"] == lid else []
            generation = (previous["generation"] if previous else 0) + int(old != assigned or not previous or previous["list_id"] != lid)
            added = sorted(set(assigned)-set(old))
            db.execute("insert into tasks values(?,?,?,?) on conflict(id) do update set list_id=excluded.list_id,assignees=excluded.assignees,generation=excluded.generation",
                       (task["id"], lid, json.dumps(assigned), generation))
            new_video = lid == VIDEO_LIST and previous is None and new_video_request(task)
            notify = new_video if lid == VIDEO_LIST else bool(added)
            if notify and not baseline and eligible(task, lid):
                event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"mahara:task-assignment:{lid}:{task['id']}:{generation}:{','.join(added)}"))
                pending = db.execute("select id,assignees from deliveries where task_id=? and list_id=? and state='queued' and attempts=0 order by created_ms limit 1", (task["id"], lid)).fetchone()
                if pending:
                    combined = sorted(set(json.loads(pending["assignees"])) | set(added))
                    db.execute("update deliveries set assignees=? where id=?", (json.dumps(combined), pending["id"]))
                else:
                    db.execute("insert or ignore into deliveries(id,task_id,list_id,assignees,state,created_ms,kind) values(?,?,?,?,'queued',?,?)",
                               (event_id, task["id"], lid, json.dumps(added), stamp, "video_created" if new_video else "assignment"))
        db.execute("insert into lists values(?,?) on conflict(id) do update set cursor_ms=excluded.cursor_ms", (lid, stamp))


def message(task, delivery, users):
    new_video = delivery["kind"] == "video_created"
    # Retire old queued assignment alerts, and recheck the request phase before
    # delivery. Do not change eligible(), which the review worker also uses.
    if delivery["list_id"] == VIDEO_LIST and (not new_video or not new_video_request(task)):
        return None, 0
    recipients = set(ids(task)) if new_video else set(json.loads(delivery["assignees"])) & set(ids(task))
    mentions, unmapped = [], 0
    for user in people(task):
        if str(user["id"]) not in recipients:
            continue
        slack = users.get(user.get("email", "").strip().lower())
        if slack and re.fullmatch(r"[UW][A-Z0-9]+", slack):
            mentions.append(f"<@{slack}>")
        else:
            mentions.append(escape(user.get("username") or "ClickUp user "+str(user["id"])))
            unmapped += 1
    if not mentions and not new_video:
        return None, 0
    name = str(task.get("name") or "Untitled task")[:400]
    due = "No due date"
    if task.get("due_date"):
        date = dt.datetime.fromtimestamp(int(task["due_date"])/1000, ZoneInfo("Asia/Kuwait"))
        due = date.strftime("%d %b %Y")
        if task.get("due_date_time"):
            due += date.strftime(" · %-I:%M %p")+" Kuwait time"
    url = "https://app.clickup.com/t/"+task["id"]
    details = (f"Assigned to {', '.join(mentions)}" if mentions else "Editor not assigned yet")+f"\nDue: {due}"
    if unmapped:
        details += "\nSlack mention unavailable for an assignee; check the ClickUp name."
    heading = "🎬 New video request" if new_video else "📌 New task assigned"
    return {"channel": ROUTES[delivery["list_id"]][1], "client_msg_id": delivery["id"],
            "text": f"{heading}: {escape(name)}\n{details}\n{url}\nTA-{delivery['id']}",
            "unfurl_links": False, "unfurl_media": False,
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": heading}},
                {"type": "section", "text": {"type": "plain_text", "text": name}},
                {"type": "section", "text": {"type": "mrkdwn", "text": details}},
                {"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Open in ClickUp"}, "url": url}]},
                {"type": "context", "elements": [{"type": "plain_text", "text": ROUTES[delivery["list_id"]][0]}]},
            ]}, unmapped


def dispatch(db, api, now):
    # The caller holds the OS lock, so a leftover sending state belongs to a stopped process.
    with db:
        db.execute("update deliveries set state='unknown',error='Worker stopped during delivery. Reconcile before retry.' where state='sending'")
    for row in db.execute("select * from deliveries where state='unknown' order by created_ms limit 10").fetchall():
        try:
            receipt = api.find_receipt(ROUTES[row["list_id"]][1], row["id"], row["sent_ms"] or row["created_ms"])
            if receipt:
                with db:
                    db.execute("update deliveries set state='accepted',receipt=?,error=null where id=?", (receipt, row["id"]))
        except (ProviderError, ValueError):
            pass
    queued = db.execute("select * from deliveries where state in ('queued','retry') and next_ms<=? order by created_ms,id limit 30", (now,)).fetchall()
    if not queued:
        return
    users = api.users()
    for row in queued:
        try:
            # An unresolved earlier send for this task also blocks a new assignment alert.
            if db.execute("select 1 from deliveries where task_id=? and state='unknown'", (row["task_id"],)).fetchone():
                continue
            task = api.task(row["task_id"])
            payload, unmapped = message(task, row, users) if eligible(task, row["list_id"]) else (None, 0)
            if payload is None:
                with db:
                    db.execute("update deliveries set state='skipped',error='Task or delivery no longer meets the channel notification rules.' where id=?", (row["id"],))
                continue
            with db:
                db.execute("update deliveries set state='sending',attempts=attempts+1,sent_ms=?,unmapped=? where id=?", (now, unmapped, row["id"]))
            receipt = api.send(payload)
            with db:
                db.execute("update deliveries set state='accepted',receipt=?,error=null where id=?", (receipt, row["id"]))
        except ProviderError as exc:
            current = db.execute("select attempts,state from deliveries where id=?", (row["id"],)).fetchone()
            state = "unknown" if exc.ambiguous else "retry" if exc.retry and current["attempts"] < 5 else "failed"
            with db:
                db.execute("update deliveries set state=?,error=?,next_ms=? where id=?", (state, str(exc), now+max(exc.delay, 60*2**current["attempts"])*1000, row["id"]))
        except Exception:
            # A programming error after the POST is also ambiguous, never replay it.
            with db:
                db.execute("update deliveries set state=case when state='sending' then 'unknown' else 'failed' end,error='Delivery needs operator review.' where id=?", (row["id"],))


def status(db):
    return {"states": dict(db.execute("select state,count(*) from deliveries group by state").fetchall()),
            "lists": dict(db.execute("select id,cursor_ms from lists").fetchall()),
            "tasks": db.execute("select count(*) from tasks").fetchone()[0],
            "unmapped": db.execute("select count(*) from deliveries where unmapped>0 and state='accepted'").fetchone()[0]}


def poll(db, api, bootstrap=False, apply=False, now=None):
    stamp = int(time.time()*1000) if now is None else now
    ready = db.execute("select value from meta where key='ready'").fetchone()
    if bootstrap and ready:
        raise RuntimeError("Ledger already initialized. Refusing to erase assignment history.")
    if not bootstrap and not ready:
        raise RuntimeError("Complete the explicit baseline before polling.")
    errors, seen = [], 0
    last_full = db.execute("select value from meta where key='last_full'").fetchone()
    full = bootstrap or not last_full or stamp-int(last_full[0]) >= 6*60*60*1000
    for lid in ROUTES:
        prior = db.execute("select cursor_ms from lists where id=?", (lid,)).fetchone()
        try:
            tasks = api.tasks(lid, None if full else prior[0] if prior else None)
            observe(db, tasks, lid, stamp, baseline=bootstrap)
            seen += len(tasks)
        except Exception as exc:
            errors.append({"list": lid, "error": str(exc) if isinstance(exc, (ProviderError, ValueError)) else "Source check failed"})
    if bootstrap and not errors:
        with db:
            db.execute("insert into meta values('ready',?)", (str(stamp),))
            db.execute("insert into meta values('routes',?)", (ROUTE_VERSION,))
    if full and not errors:
        with db:
            db.execute("insert into meta values('last_full',?) on conflict(key) do update set value=excluded.value", (str(stamp),))
    if apply and not bootstrap:
        try:
            dispatch(db, api, stamp)
        except Exception:
            errors.append({"error": "Delivery directory or reconciliation check failed"})
    snapshot = status(db)
    trouble = sum(snapshot["states"].get(s, 0) for s in ("unknown", "failed"))
    overdue = db.execute("select count(*) from deliveries where state in('queued','retry') and created_ms<?", (stamp-15*60000,)).fetchone()[0]
    report = {"at": utc(stamp), "healthy": not errors and not trouble and not overdue and snapshot["unmapped"] == 0,
              "apply": apply, "baseline": bootstrap, "tasks_seen": seen, "errors": errors, **snapshot}
    with db:
        db.execute("insert into meta values('health',?) on conflict(key) do update set value=excluded.value", (json.dumps(report),))
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--bootstrap", action="store_true")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    state = Path(args.state_dir)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state/"worker.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"busy": True})); return
        config = json.loads(Path(args.config).read_text())
        # Credentials stay in the existing private runtime. Only read the fields we use.
        credentials = json.loads(Path(config["credentials_file"]).read_text())
        api = API(credentials)
        db = open_db(state/"ledger.sqlite3", args.bootstrap)
        if args.status:
            print(json.dumps(status(db))); return
        report = poll(db, api, args.bootstrap, config.get("apply") is True)
        try:
            api.heartbeat(report)
        except Exception:
            report["health_mirror_error"] = True
            report["healthy"] = False
        # A daily consistent backup preserves the durable receipt ledger.
        backup = state/("ledger-"+dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")+".sqlite3")
        if not backup.exists():
            with sqlite3.connect(backup) as target:
                db.backup(target)
        for old in sorted(state.glob("ledger-20*.sqlite3"))[:-7]:
            old.unlink()
        print(json.dumps(report, sort_keys=True), flush=True)
        if not report["healthy"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
