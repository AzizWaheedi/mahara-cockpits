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

import json
from typing import Any, Callable, Optional

from . import checks as checks_mod
from . import http
from .clickup import ClickUp
from .config import Config
from .drive import Drive
from .supabase import Supabase, now_iso

KINDS = ("deliver", "check", "comment", "rescan", "ask", "status", "eod", "dosdonts", "toideation")

# Where an editor may move a card from the cockpit. Aziz, 2026-09-19: pressing
# "started" should move it to In progress, and a round of comments should move
# it to Update required.
#
# "complete" and "cancelled" are deliberately not here. Finishing a job is a
# decision somebody else makes on the board, and a button that could close a
# client's video by mistake is not worth the two seconds it saves. Client
# review has its own action, because it writes the link as well.
MOVE_TO = {
    "in progress": "In progress",
    "update required": "Update required",
    "new video request": "New video request",
}

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


def run_status(cfg: Config, log: Callable[[str], None], sb: Supabase, cu: ClickUp,
               job: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    """Move the card on the board, from the cockpit."""
    task_id = str(req.get("task_id") or "")
    want = str((req.get("params") or {}).get("to") or "").strip().lower()
    if want not in MOVE_TO:
        raise ValueError(f"{want!r} is not a status the cockpit may set")
    was = str(job.get("status") or "")
    if was.strip().lower() == want:
        return {"status": want, "note": "already there"}
    cu.set_status(task_id, want)
    sb.mark_job(task_id, status=want)
    if cfg.clickup_writeback:
        who = req.get("requested_by_name") or req.get("requested_by") or "the editor"
        note = str(req.get("input") or "").strip()
        line = f"{who} moved this to {MOVE_TO[want]}" + (f": {note}" if note else ".")
        try:
            cu.comment(task_id, f"{line}\n\nMoved from the editor desk.")
        except http.HttpError:
            pass
    log(f"{task_id}: {was or 'no status'} -> {want}")
    return {"status": want, "was": was}


def run_eod(cfg: Config, log: Callable[[str], None], req: dict[str, Any]) -> dict[str, Any]:
    """File an end of day onto the Video Editors tab of the EOD sheet.

    The cockpit sends the answers; everything the sheet needs and the person
    cannot type is filled here, so a filing from the cockpit sits next to a
    filing from the Typeform and reads the same.
    """
    from . import sheets
    from .drive import Drive

    try:
        answers = json.loads(str(req.get("input") or "{}"))
    except ValueError:
        raise ValueError("the end of day could not be read")
    if not isinstance(answers, dict):
        raise ValueError("the end of day could not be read")

    day = str((req.get("params") or {}).get("day") or "")[:10]
    if not day:
        raise ValueError("no day on this filing")
    y, m, d = (day.split("-") + ["", "", ""])[:3]
    answers["_date_for"] = f"{d}-{m}-{y}"
    answers["_submitted_at"] = now_iso().replace("T", " ").replace("Z", "")
    # The Typeform's own rows carry its response id; a cockpit filing says so.
    answers["_response_id"] = f"cockpit-{day}"
    answers.setdefault("name", req.get("requested_by_name") or req.get("requested_by") or "")

    token = Drive(cfg, log).token()
    return sheets.file_eod(token, answers, log)


def run_dosdonts(cfg: Config, log: Callable[[str], None], sb: Supabase, cu: ClickUp,
                 req: dict[str, Any]) -> dict[str, Any]:
    """Add one line to a client's Do's & Don'ts, on the client card itself.

    Appends. The field is the one list every cockpit reads and it was written
    from onboarding calls over months, so an editor adds to it and can never
    paste over it.
    """
    from . import brand
    from .config import CLIENT_FIELD

    client_id = str(req.get("task_id") or "").replace("client:", "")
    params = req.get("params") or {}
    kind = str(params.get("kind") or "").upper().replace("DONT", "DON'T")
    text = str(req.get("input") or "").strip()
    if not client_id:
        raise ValueError("no client on this request")
    if kind not in (brand.DO, brand.DONT):
        raise ValueError("say whether it is a do or a don't")
    if not text:
        raise ValueError("there is nothing to add")

    row = sb.client(client_id)
    if not row:
        raise ValueError("that client is not on the desk")
    current = str(row.get("dos_donts") or "")
    if brand.already_there(current, text):
        return {"added": False, "note": "that line is already on the card"}

    who = str(req.get("requested_by_name") or req.get("requested_by") or "").split("@")[0]
    day = now_iso()[:10]
    updated = brand.add(current, text, kind=kind, who=who, day=day)
    cu.set_field_by_id(client_id, CLIENT_FIELD["dos_donts"], updated)
    # And straight into the desk's own copy, so the cockpit shows it now
    # rather than at the next sync.
    sb.store_clients([{"task_id": client_id, "dos_donts": updated}])
    log(f"{row.get('name')}: a {kind} added by {who}")
    return {"added": True, "kind": kind, "client": row.get("name")}


def run_to_ideation(cfg: Config, log: Callable[[str], None], sb: Supabase,
                    req: dict[str, Any]) -> dict[str, Any]:
    """Put a saved Foreplay ad on the shared ideation board.

    Sabry works from that board, so an ad the editor or the media buyer saved
    on their phone reaches him without anybody forwarding a link. It is
    marked `origin=foreplay` so a hand-saved ad is never mistaken for
    something the radar scored.
    """
    from . import foreplay as fp

    ad_id = str(req.get("input") or "").strip()
    if not ad_id:
        raise ValueError("no ad was named")
    rows = sb.select("foreplay_ads", f"select=*&id=eq.{http.quote(ad_id)}&limit=1")
    if not rows:
        raise ValueError("that ad is not in our copy of the swipe file yet")
    note = str((req.get("params") or {}).get("note") or "")
    row = fp.as_idea(
        rows[0],
        by=str(req.get("requested_by") or ""),
        by_name=str(req.get("requested_by_name") or ""),
        note=note,
    )
    row["saved_at"] = now_iso()
    row["pasted_at"] = now_iso()
    sb.upsert("ideation_posts", [row], "key")
    log(f"ideation: {row['key']} saved by {row.get('saved_by_name')}")
    return {"key": row["key"], "board": "ideation"}


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
            # These belong to a person or a client, not to a job.
            if kind == "toideation":
                _done(sb, rid, run_to_ideation(cfg, log, sb, req))
                out["done"] += 1
                continue
            if kind == "dosdonts":
                cu = cu or ClickUp(cfg, log)
                _done(sb, rid, run_dosdonts(cfg, log, sb, cu, req))
                out["done"] += 1
                continue
            # An end of day belongs to a person and a date, not to a job.
            if kind == "eod":
                _done(sb, rid, run_eod(cfg, log, req))
                out["done"] += 1
                log(f"eod {task_id}: filed")
                continue
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
            elif kind == "status":
                cu = cu or ClickUp(cfg, log)
                result = run_status(cfg, log, sb, cu, job, req)
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
