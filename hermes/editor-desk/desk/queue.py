"""Work the cockpit asked for, carried out by the worker.

The browser holds the anon key and nothing else: no ClickUp key, no Google
token. So when an editor presses "send to client review", the cockpit writes a
row to `editor_requests` and this drains it, the same shape the ideation radar
already runs on.

Two rules make a retry harmless. A row is claimed before it is acted on, with
a conditional update that only one runner can win, so the same delivery is
never written twice. And a failure records its reason and its attempt count,
so a bad link stops after four tries instead of retrying every minute forever.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from . import checks as checks_mod
from . import http
from .clickup import ClickUp
from .config import Config
from .drive import Drive
from .supabase import Supabase, now_iso

KINDS = ("deliver", "check", "comment", "rescan", "ask")

# What an editor can be short of. The wording is what lands on the card, so
# it reads as a person asking a colleague rather than a system raising a
# ticket. "something else" carries only the note.
ASK_FOR = {
    "footage": "more footage",
    "brief": "a brief: what this video is meant to do",
    "script": "the script",
    "brand": "brand assets: logo files, fonts, colours",
    "music": "music, or permission to pick some",
    "access": "access to the footage folder",
    "approval": "a decision before this can go further",
    "other": "something else",
}
MAX_ATTEMPTS = 4


def _fail(sb: Supabase, request_id: str, message: str, attempts: int) -> None:
    sb.patch(
        "editor_requests",
        f"id=eq.{http.quote(request_id)}",
        {
            # Back in the queue while there are tries left; parked when there are not.
            "status": "queued" if attempts < MAX_ATTEMPTS else "failed",
            "error": message[:400],
            "attempts": attempts,
            "finished_at": now_iso() if attempts >= MAX_ATTEMPTS else None,
            "updated_at": now_iso(),
        },
    )


def _done(sb: Supabase, request_id: str, result: dict[str, Any]) -> None:
    sb.patch(
        "editor_requests",
        f"id=eq.{http.quote(request_id)}",
        {"status": "done", "result": result, "error": None,
         "finished_at": now_iso(), "updated_at": now_iso()},
    )


def run_deliver(cfg: Config, log: Callable[[str], None], sb: Supabase, cu: ClickUp,
                job: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    task_id = str(req.get("task_id") or "")
    url = str(req.get("input") or "").strip()
    if not url:
        raise ValueError("no link was given")
    cu.set_field(task_id, "edited_video", url)
    status = str((req.get("params") or {}).get("status") or "client review")
    try:
        cu.set_status(task_id, status)
    except http.HttpError as e:
        log(f"{task_id}: status not changed: {http.scrub(str(e))[:140]}")
        status = str(job.get("status") or "")
    sb.mark_job(task_id, edited_url=url, status=status, state="delivered")
    if cfg.clickup_writeback:
        who = req.get("requested_by_name") or req.get("requested_by") or "the editor"
        try:
            cu.comment(task_id, f"Delivered by {who}: {url}\n\nSent from the editor desk.")
        except http.HttpError:
            pass
    return {"edited_url": url, "status": status}


def run_check(cfg: Config, log: Callable[[str], None], sb: Supabase, cu: Optional[ClickUp],
              drive: Drive, job: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    task_id = str(req.get("task_id") or "")
    url = str(req.get("input") or "").strip()
    if not url:
        raise ValueError("no link was given")
    params = req.get("params") or {}
    row = checks_mod.check_version(
        cfg, log, sb, drive, job, url,
        by_email=str(req.get("requested_by") or ""),
        by_name=str(req.get("requested_by_name") or ""),
        want_ratio=str(params.get("ratio") or ""),
    )
    if cu is not None and cfg.clickup_writeback and params.get("post_to_card"):
        try:
            cu.comment(task_id, checks_mod.report_text(row))
        except http.HttpError as e:
            log(f"{task_id}: check comment failed: {http.scrub(str(e))[:140]}")
    return {"version": row.get("n"), "passed": row.get("passed"),
            "checks": row.get("checks"), "id": row.get("id")}


def run_ask(cfg: Config, log: Callable[[str], None], sb: Supabase, cu: ClickUp,
            job: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    """The editor is short of something. Say so on the card, where the person
    who can fix it is already looking, and remember that it was asked."""
    task_id = str(req.get("task_id") or "")
    topic = str((req.get("params") or {}).get("topic") or "other")
    note = str(req.get("input") or "").strip()
    if topic not in ASK_FOR:
        topic = "other"
    if topic == "other" and not note:
        raise ValueError("say what is needed")
    who = str(req.get("requested_by_name") or req.get("requested_by") or "the editor")
    wanted = ASK_FOR[topic]
    stamp = now_iso()

    if cfg.clickup_writeback:
        lines = [f"{who} needs {wanted} before this can move."]
        if note:
            lines += ["", note]
        lines += ["", "Asked from the editor desk. Reply on this card and the editor will see it."]
        cu.comment(task_id, "\n".join(lines))

    try:
        sb.store_notes([{
            "id": f"ask:{task_id}:{req.get('id')}",
            "task_id": task_id,
            "text": f"Asked for {wanted}." + (f" {note}" if note else ""),
            "by_email": req.get("requested_by"),
            "by_name": req.get("requested_by_name"),
            "source": "cockpit",
            "done": False,
            "at": stamp,
        }])
    except Exception as e:  # noqa: BLE001 - the card already carries it
        log(f"{task_id}: ask not stored as a note: {http.scrub(str(e))[:120]}")

    sb.mark_job(task_id, asked_for=wanted, asked_at=stamp,
                asked_by=str(req.get("requested_by_name") or req.get("requested_by") or ""))
    return {"asked_for": wanted, "posted": bool(cfg.clickup_writeback)}


def run_comment(cfg: Config, log: Callable[[str], None], cu: ClickUp, req: dict[str, Any]) -> dict[str, Any]:
    text = str(req.get("input") or "").strip()
    if not text:
        raise ValueError("there was no text to post")
    if not cfg.clickup_writeback:
        raise ValueError("posting to cards is switched off on this worker (DESK_CLICKUP_WRITEBACK)")
    who = req.get("requested_by_name") or req.get("requested_by") or "the editor"
    cu.comment(str(req.get("task_id")), f"{text}\n\n— {who}, from the editor desk.")
    return {"posted": True}


def run_requests(cfg: Config, log: Callable[[str], None], sb: Supabase, *, limit: int = 10) -> dict[str, Any]:
    """Drain the queue. Returns a small summary for the caller and the log."""
    rows = sb.select(
        "editor_requests",
        f"select=*&status=eq.queued&attempts=lt.{MAX_ATTEMPTS}&order=created_at.asc&limit={int(limit)}",
    )
    out = {"seen": len(rows), "done": 0, "failed": 0, "skipped": 0}
    if not rows:
        return out

    cu: Optional[ClickUp] = None
    drive: Optional[Drive] = None
    for req in rows:
        rid = str(req.get("id") or "")
        kind = str(req.get("kind") or "")
        task_id = str(req.get("task_id") or "")
        attempts = int(req.get("attempts") or 0) + 1

        if kind not in KINDS:
            _fail(sb, rid, f"{kind!r} is not something the desk knows how to do", MAX_ATTEMPTS)
            out["failed"] += 1
            continue

        # Claim it. Only the runner whose update still saw "queued" proceeds.
        claimed = sb.rest(
            "PATCH", f"editor_requests?id=eq.{http.quote(rid)}&status=eq.queued",
            json_body={"status": "running", "started_at": now_iso(),
                       "attempts": attempts, "updated_at": now_iso()},
            prefer="return=representation",
        )
        if not claimed:
            out["skipped"] += 1
            continue

        try:
            job = sb.job(task_id)
            if not job:
                raise ValueError("that job is not on the desk")
            if kind == "rescan":
                sb.mark_job(task_id, state="stale", attempts=0)
                result = {"state": "stale"}
            elif kind == "comment":
                cu = cu or ClickUp(cfg, log)
                result = run_comment(cfg, log, cu, req)
            elif kind == "ask":
                cu = cu or ClickUp(cfg, log)
                result = run_ask(cfg, log, sb, cu, job, req)
            elif kind == "deliver":
                cu = cu or ClickUp(cfg, log)
                result = run_deliver(cfg, log, sb, cu, job, req)
            else:
                drive = drive or Drive(cfg, log)
                if cfg.clickup_key:
                    cu = cu or ClickUp(cfg, log)
                result = run_check(cfg, log, sb, cu, drive, job, req)
            _done(sb, rid, result)
            out["done"] += 1
            log(f"{kind} {task_id}: done")
        except (http.HttpError, ValueError, OSError) as e:
            msg = http.scrub(str(e))[:300]
            _fail(sb, rid, msg, attempts)
            out["failed"] += 1
            log(f"{kind} {task_id}: {msg}")
    return out
