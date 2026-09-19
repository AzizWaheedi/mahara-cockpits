#!/usr/bin/env python3
"""Editor desk: everything around the edit, nothing inside it.

    python3 desk.py doctor                     check keys, binaries and services
    python3 desk.py sync                       read the ClickUp Video Pipeline into the desk
    python3 desk.py prepare [--task ID] [--limit N] [--force]
                                               find the footage, transcribe it, map the shots
    python3 desk.py check --task ID --url LINK [--ratio 9:16]
                                               read a cut the editor uploaded and report on it
    python3 desk.py deliver --task ID --url LINK [--status "client review"]
                                               write the edited link and move the card
    python3 desk.py requests [--limit N]        carry out what the cockpit asked for
    python3 desk.py meetings [--days N]        team meetings from Fathom
    python3 desk.py foreplay [--limit N]       the Foreplay swipe file into our own store
    python3 desk.py archive [--limit N]        keep our own copy of the ads we ran
    python3 desk.py notes [--task ID]          pull ClickUp comments in as timestamped notes
    python3 desk.py jobs [--mine EMAIL]        what is open, and what is blocking it

Standard library plus ffmpeg. Keys are read by name and never printed. The
desk builds no timeline, generates no clip and burns in no caption: the cut
and the generation belong to the editor (Aziz, 2026-09-18).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from desk import checks as checks_mod  # noqa: E402
from desk import drive as drive_mod  # noqa: E402
from desk import http, prepare  # noqa: E402
from desk import clients as clients_mod  # noqa: E402
from desk import queue as queue_mod  # noqa: E402
from desk.clickup import ClickUp, fields_of, is_open, job_row  # noqa: E402
from desk.config import Config  # noqa: E402
from desk.drive import Drive  # noqa: E402
from desk.log import Logger  # noqa: E402
from desk.supabase import Supabase, SupabaseError, now_iso  # noqa: E402

DOC_RE = re.compile(r"https://docs\.google\.com/document/d/[A-Za-z0-9_-]+")


def _print(obj: Any, as_json: bool) -> None:
    if as_json or not isinstance(obj, str):
        print(json.dumps(obj, ensure_ascii=False, indent=1, default=str))
    else:
        print(obj)


def _sb(cfg: Config) -> Supabase:
    if not cfg.supabase_configured:
        raise SupabaseError("DESK_SUPABASE_URL and DESK_SUPABASE_KEY are required (the radar's RADAR_ pair also works)")
    return Supabase(cfg.supabase_url, cfg.supabase_key, bucket=cfg.supabase_bucket)


# ---------------------------------------------------------------------------


def cmd_doctor(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    rows: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str, required: bool = False) -> None:
        rows.append({"check": name, "ok": ok, "detail": detail, "required": required})

    add("python", sys.version_info >= (3, 9), sys.version.split()[0], True)
    for b in ("ffmpeg", "ffprobe"):
        add(b, shutil.which(b) is not None, shutil.which(b) or "missing: the desk cannot read video without it", True)
    add("home", True, str(cfg.home))
    free = 0
    try:
        from desk import media
        free = media.free_bytes(cfg.scratch if cfg.scratch.exists() else cfg.home)
    except Exception:  # noqa: BLE001
        pass
    add("disk", free > 12 * 1024**3, f"{round(free / 1024**3, 1)} GB free for scratch", True)
    add("CLICKUP_API_KEY", bool(cfg.clickup_key), "set" if cfg.clickup_key else "missing: the board cannot be read", True)
    add("google oauth", cfg.google_configured, "client id, secret and refresh token set" if cfg.google_configured else "missing: Drive cannot be read", True)
    add("ELEVENLABS_API_KEY", bool(cfg.elevenlabs_key), "set (speech first)" if cfg.elevenlabs_key else "missing: transcripts fall back to Whisper")
    add("GROQ_API_KEY", bool(cfg.groq_key), "set (speech fallback)" if cfg.groq_key else "missing")
    have_fp = bool(cfg.foreplay_key or cfg.composio_key)
    add("foreplay", have_fp,
        ("FOREPLAY_API_KEY set" if cfg.foreplay_key
         else "through Composio (COMPOSIO_API_KEY set)") if have_fp
        else "neither FOREPLAY_API_KEY nor COMPOSIO_API_KEY: the swipe file page stays empty")
    add("frameio", cfg.frameio_configured,
        "client id and secret set" if cfg.frameio_configured
        else "not set: review comments stay in Frame.io (optional)")
    add("supabase", cfg.supabase_configured, "configured" if cfg.supabase_configured else "missing DESK_SUPABASE_URL and DESK_SUPABASE_KEY", True)
    add("clickup writeback", cfg.clickup_writeback, "on: the desk comments on cards" if cfg.clickup_writeback else "off")

    if not args.offline:
        if cfg.clickup_key:
            try:
                cu = ClickUp(cfg, log.info)
                tasks = cu.tasks()
                add("clickup board", True, f"{len(tasks)} open task(s) on the Video Pipeline", True)
            except http.HttpError as e:
                add("clickup board", False, http.scrub(str(e))[:200], True)
        if cfg.google_configured:
            try:
                d = Drive(cfg, log.info)
                d.token()
                add("google token", True, "the refresh token still mints an access token", True)
            except http.HttpError as e:
                add("google token", False, http.scrub(str(e))[:200], True)
        if cfg.supabase_configured:
            try:
                sb = _sb(cfg)
                sb.ping()
                n = len(sb.select("editor_jobs", "select=task_id&limit=200"))
                add("supabase tables", True, f"editor_jobs reachable, {n} job(s) stored", True)
            except (http.HttpError, SupabaseError) as e:
                add("supabase tables", False, f"{http.scrub(str(e))[:180]} (see README for the DDL)", True)
        if cfg.elevenlabs_key:
            try:
                out = http.get_json("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": cfg.elevenlabs_key}, timeout=30)
                add("elevenlabs", True, f"plan {out.get('tier') or out.get('status') or '?'}; speech to text is metered separately")
            except http.HttpError as e:
                add("elevenlabs", False, http.scrub(str(e))[:180])

    blockers = [r for r in rows if r["required"] and not r["ok"]]
    if args.json:
        _print({"checks": rows, "blockers": [b["check"] for b in blockers]}, True)
    else:
        for r in rows:
            print(f"{'OK ' if r['ok'] else '-- '} {r['check']:<20} {r['detail']}")
        print("blockers:", ", ".join(b["check"] for b in blockers) if blockers else "none")
    return 1 if blockers else 0


def cmd_sync(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """The board is the source of truth for jobs; this brings it in.

    Two boards, not one. The Video Pipeline says what is owed, and Clients -
    Mahara says who it is for and what the brand rules are, joined by the tag
    on the card (Aziz, 2026-09-18).
    """
    sb = _sb(cfg)
    cu = ClickUp(cfg, log.info)
    stamp = now_iso()
    # Everything on the board, closed included, so a card that has merely
    # been completed is not mistaken for one that was deleted.
    every = cu.tasks(include_closed=True)
    tasks = every if args.closed else [t for t in every if is_open(str((t.get("status") or {}).get("status") or ""))]
    rows = [job_row(t, now_iso=stamp) for t in tasks]
    keep = [(r, t) for r, t in zip(rows, tasks) if r["task_id"] and (args.closed or is_open(r["status"]))]
    rows = [r for r, _ in keep]

    # The client card carries the brand work. Resolve it here so a job always
    # knows who it is for, even when nobody filled the video card in.
    people: list[dict[str, Any]] = []
    try:
        people = clients_mod.roster(cfg, log.info)
    except http.HttpError as e:
        log.warn(f"client roster not read: {http.scrub(str(e))[:160]}")
    matched = 0
    by_job: dict[str, dict[str, Any]] = {}
    if people:
        for r in rows:
            hit = clients_mod.match(r.get("clients") or [], people)
            if hit:
                r["client_task_id"] = hit["task_id"]
                by_job[r["task_id"]] = hit
                matched += 1
        sb.store_clients([{**c, "synced_at": stamp} for c in people])

    # Documents: read once per company, and only for companies with live work.
    docs_read = 0
    drive: Optional[Drive] = None
    if cfg.google_configured and not args.no_docs:
        try:
            drive = Drive(cfg, log.info)
        except http.HttpError as e:
            log.warn(f"Drive not available: {http.scrub(str(e))[:160]}")
    if drive is not None and by_job:
        wanted = {c["task_id"]: c for c in by_job.values()}
        have = {c["task_id"]: c for c in sb.clients(wanted.keys())}
        fresh: list[dict[str, Any]] = []
        for tid, c in wanted.items():
            was = have.get(tid) or {}
            # A brand document is edited in place, so the link does not change
            # when the rules do. Ask Drive what each document's revision is and
            # compare that; one cheap metadata call keeps the brand current.
            now_rev = clients_mod.revisions(drive, c)
            same_links = (was.get("brand_dna_url") or "") == (c.get("brand_dna_url") or "") and (
                was.get("offer_url") or ""
            ) == (c.get("offer_url") or "")
            same_revs = all(
                (was.get(k) or "") == (v or "") for k, v in now_rev.items() if v is not None
            )
            have_text = bool(was.get("brand_dna") or was.get("offer"))
            if same_links and same_revs and have_text and not args.force_docs:
                for key in ("brand_dna", "offer", "brand_dna_rev", "offer_rev"):
                    c[key] = was.get(key)
                continue
            row = clients_mod.read_docs(drive, dict(c), log.info)
            row["docs_read_at"] = stamp
            fresh.append(row)
            for key in ("brand_dna", "offer", "brand_dna_rev", "offer_rev"):
                c[key] = row.get(key)
            docs_read += 1
            if have_text:
                log.info(f"  {c.get('name')}: a brand document changed, read again")
        if fresh:
            sb.store_clients(fresh)

    # The script often lives in a Google Doc linked from the card's References field.
    if drive is not None:
        for r, t in keep:
            refs = str(fields_of(t).get("references") or "")
            m = DOC_RE.search(refs)
            if not m:
                continue
            doc_id = drive_mod.parse_id(m.group(0))
            if not doc_id:
                continue
            try:
                text = drive.doc_text(doc_id)
            except http.HttpError as e:
                log.warn(f"{r['task_id']}: script doc not read: {http.scrub(str(e))[:120]}")
                continue
            if text:
                r["script"] = text[:40000]
                r["script_task_id"] = doc_id

    # Whoever the board says is editing gets a seat in the cockpit, so adding
    # someone on ClickUp is enough (Aziz, 2026-09-19). Only our own domain,
    # and only ever as an editor: admin is the portal's to give.
    seats = {"granted": 0, "revoked": 0}
    try:
        seats = sb.seats_from_board(clients_mod.seat_people([t for _, t in keep]), stamp)
    except Exception as e:  # noqa: BLE001 - a seat is not worth losing the sync over
        log.warn(f"seats not updated: {http.scrub(str(e))[:160]}")

    # A card deleted in ClickUp leaves a job here that nobody can act on.
    retired = {"retired": 0}
    try:
        retired = sb.retire_missing([str(t.get("id") or "") for t in every], stamp)
        if retired.get("refused"):
            log.warn(f"not retiring anything: {retired['refused']}")
    except Exception as e:  # noqa: BLE001
        log.warn(f"jobs not retired: {http.scrub(str(e))[:160]}")

    out = sb.store_jobs(rows)
    # A job whose board fields changed after preparation is read again.
    stale = 0
    for r in rows:
        job = sb.job(r["task_id"])
        if not job or job.get("state") != "ready":
            continue
        if (job.get("footage_url") or "") != (r.get("footage_url") or ""):
            sb.mark_job(r["task_id"], state="stale", attempts=0)
            stale += 1
    summary = {
        "tasks": len(rows), **out, "stale": stale,
        "clients": len(people), "matched": matched, "docs_read": docs_read,
        "seats": seats, "retired": retired.get("retired", 0),
    }
    log.info(f"sync: {summary}")
    _print(summary, args.json)
    return 0


def cmd_prepare(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    sb = _sb(cfg)
    drive = Drive(cfg, log.info)
    cu = ClickUp(cfg, log.info) if cfg.clickup_key and cfg.clickup_writeback else None
    if args.task:
        job = sb.job(args.task)
        if not job:
            log.error(f"{args.task} is not in the desk; run sync first")
            return 2
        jobs = [job]
    else:
        jobs = sb.jobs_to_prepare(args.limit or cfg.max_jobs_per_run)
    if not jobs:
        _print({"prepared": 0, "note": "nothing waiting"}, args.json)
        return 0
    # One read of the client cards these jobs belong to, so the brand rules
    # travel with the job instead of being looked up per file.
    by_client = {c["task_id"]: c for c in sb.clients([j.get("client_task_id") for j in jobs])}
    out = []
    for job in jobs:
        try:
            out.append(prepare.prepare_job(
                cfg, log.info, sb, drive, job, clickup=cu, force=args.force,
                client=by_client.get(str(job.get("client_task_id") or "")),
            ))
        except (http.HttpError, SupabaseError, OSError) as e:
            msg = http.scrub(str(e))[:300]
            log.error(f"{job.get('task_id')}: {msg}")
            sb.mark_job(str(job.get("task_id")), state="stale", attempts=int(job.get("attempts") or 0) + 1, error=msg)
            out.append({"task_id": job.get("task_id"), "error": msg})
    if args.json:
        _print(out, True)
    else:
        for s in out:
            if s.get("error"):
                print(f"{s['task_id']}: failed, {s['error']}")
            else:
                print(f"{s['task_id']}: {s.get('state')}, {s.get('read')} read, {s.get('skipped')} skipped, {round(float(s.get('seconds') or 0)/60,1)} min, {s.get('transcript_chars')} characters")
                for m in s.get("missing") or []:
                    print(f"   blocked: {m}")
    return 1 if all(s.get("error") for s in out) else 0


def cmd_check(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    sb = _sb(cfg)
    drive = Drive(cfg, log.info)
    job = sb.job(args.task)
    if not job:
        log.error(f"{args.task} is not in the desk; run sync first")
        return 2
    row = checks_mod.check_version(
        cfg, log.info, sb, drive, job, args.url, n=args.n,
        by_email=args.by or "", by_name=args.by_name or "", want_ratio=args.ratio or "",
    )
    if cfg.clickup_writeback and cfg.clickup_key and not args.quiet_board:
        try:
            ClickUp(cfg, log.info).comment(args.task, checks_mod.report_text(row))
        except http.HttpError as e:
            log.warn(f"ClickUp comment failed: {http.scrub(str(e))[:140]}")
    if args.json:
        _print(row, True)
    else:
        print(checks_mod.report_text(row))
    return 0 if row.get("passed") else 1


def cmd_deliver(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Write the edited link and move the card. The only two things the desk writes back."""
    sb = _sb(cfg)
    cu = ClickUp(cfg, log.info)
    job = sb.job(args.task)
    if not job:
        log.error(f"{args.task} is not in the desk; run sync first")
        return 2
    cu.set_field(args.task, "edited_video", args.url)
    status = args.status or "client review"
    try:
        cu.set_status(args.task, status)
    except http.HttpError as e:
        log.warn(f"status not changed: {http.scrub(str(e))[:140]}")
        status = job.get("status")
    sb.mark_job(args.task, edited_url=args.url, status=status, state="delivered")
    if cfg.clickup_writeback:
        try:
            cu.comment(args.task, f"Delivered: {args.url}\n\nPosted by the editor desk.")
        except http.HttpError:
            pass
    _print({"task_id": args.task, "edited_url": args.url, "status": status}, args.json)
    return 0


def cmd_meetings(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Team meetings from Fathom, for everyone who was on the invite."""
    from desk import meetings as meetings_mod

    sb = _sb(cfg)
    out = meetings_mod.sync(cfg, log.info, sb, days=args.days or 45)
    log.info(f"meetings: {out}")
    _print(out, args.json)
    return 0


def cmd_archive(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Keep our own copy of the ads we ran."""
    from desk import ads as ads_mod

    sb = _sb(cfg)
    out = ads_mod.archive(cfg, log.info, sb, limit=args.limit or 25, retry_failed=args.retry)
    log.info(f"archive: {out}")
    _print(out, args.json)
    return 0


def cmd_frameio(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Review comments out of Frame.io and into the notes on the job.

    Runs as a sweep over the open jobs that have a cut there. A webhook, if
    the account can make one, only makes this prompt -- it is not needed
    for the thing to work.
    """
    from desk import frameio as fio

    sb = _sb(cfg)
    if not cfg.frameio_configured:
        log.warn("FRAMEIO_CLIENT_ID and FRAMEIO_CLIENT_SECRET are not set")
        return 2
    fp = fio.Frameio(cfg, sb, log.info)
    out = fio.sync(
        fp, sb, log=log.info,
        unit=args.unit or cfg.frameio_timestamp_unit,
        limit=args.limit or 40,
    )
    _print(out, args.json)
    return 0


def cmd_foreplay(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """The Foreplay swipe file into our own store."""
    from desk import foreplay as fp_mod

    sb = _sb(cfg)
    out = fp_mod.sync(
        cfg, log.info, sb, max_ads=args.limit or 250, full=args.full,
        drop_box=args.board or cfg.foreplay_drop_box,
        mahara_box=cfg.foreplay_mahara_box,
    )
    _print(out, args.json)
    return 0


def cmd_requests(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Carry out what the cockpit asked for. The browser holds no keys."""
    sb = _sb(cfg)
    out = queue_mod.run_requests(cfg, log.info, sb, limit=args.limit or 10)
    log.info(f"requests: {out}")
    _print(out, args.json)
    return 0


def cmd_notes(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """ClickUp comments in as notes, with the timestamp an editor wrote inside them."""
    sb = _sb(cfg)
    cu = ClickUp(cfg, log.info)
    jobs = [sb.job(args.task)] if args.task else sb.select("editor_jobs", "select=task_id,status&order=synced_at.desc&limit=40")
    jobs = [j for j in jobs if j]
    stamp_re = re.compile(r"\b(\d{1,2}):(\d{2})\b")
    total = 0
    for job in jobs:
        tid = str(job.get("task_id"))
        try:
            comments = cu.comments(tid)
        except http.HttpError as e:
            log.warn(f"{tid}: {http.scrub(str(e))[:120]}")
            continue
        rows = []
        for c in comments:
            text = str(c.get("comment_text") or "").strip()
            if not text or text.startswith(("Footage read:", "Version ", "Delivered:")):
                continue  # the desk's own comments are not feedback
            who = (c.get("user") or {}) if isinstance(c.get("user"), dict) else {}
            m = stamp_re.search(text)
            at_sec = (int(m.group(1)) * 60 + int(m.group(2))) if m else None
            rows.append({
                "id": f"{tid}:c{c.get('id')}",
                "task_id": tid,
                "at_sec": at_sec,
                "text": text[:4000],
                "by_email": str(who.get("email") or "").lower() or None,
                "by_name": who.get("username"),
                "source": "clickup",
            })
        if rows:
            sb.store_notes(rows)
            total += len(rows)
    _print({"notes": total, "jobs": len(jobs)}, args.json)
    return 0


def cmd_jobs(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    sb = _sb(cfg)
    rows = sb.select("editor_jobs", "select=*&order=due_at.asc&limit=200")
    if args.mine:
        needle = args.mine.lower()
        rows = [r for r in rows if needle in json.dumps(r.get("editors") or [], ensure_ascii=False).lower() or needle in str(r.get("editor") or "").lower()]
    rows = [r for r in rows if args.closed or is_open(str(r.get("status") or ""))]
    if args.json:
        _print(rows, True)
    else:
        for r in rows:
            mark = "ready" if r.get("ready") else str(r.get("state") or "")
            print(f"{r.get('task_id')} | {str(r.get('client') or '?'):<22} | {str(r.get('status') or ''):<18} | {str(r.get('editor') or 'unassigned'):<20} | {mark}")
            for m in r.get("missing") or []:
                print(f"    {m}")
        print(f"{len(rows)} job(s)")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="desk.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="machine readable output")
    ap.add_argument("--quiet", action="store_true", help="only warnings and errors on stderr")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("doctor"); d.add_argument("--offline", action="store_true")
    ar = sub.add_parser("archive"); ar.add_argument("--limit", type=int, default=25); ar.add_argument("--retry", action="store_true")
    fi = sub.add_parser("frameio")
    fi.add_argument("--limit", type=int, default=40)
    fi.add_argument("--unit", default="", choices=["", "frames", "seconds", "unknown"])
    fp = sub.add_parser("foreplay"); fp.add_argument("--limit", type=int, default=250); fp.add_argument("--full", action="store_true"); fp.add_argument("--board", default="")
    mt = sub.add_parser("meetings"); mt.add_argument("--days", type=int, default=45)
    rq = sub.add_parser("requests"); rq.add_argument("--limit", type=int, default=10)
    sy = sub.add_parser("sync"); sy.add_argument("--closed", action="store_true"); sy.add_argument("--no-docs", action="store_true"); sy.add_argument("--force-docs", action="store_true")
    pr = sub.add_parser("prepare"); pr.add_argument("--task"); pr.add_argument("--limit", type=int); pr.add_argument("--force", action="store_true")
    ck = sub.add_parser("check")
    ck.add_argument("--task", required=True); ck.add_argument("--url", required=True)
    ck.add_argument("--n", type=int); ck.add_argument("--ratio"); ck.add_argument("--by"); ck.add_argument("--by-name")
    ck.add_argument("--quiet-board", action="store_true")
    dl = sub.add_parser("deliver"); dl.add_argument("--task", required=True); dl.add_argument("--url", required=True); dl.add_argument("--status")
    nt = sub.add_parser("notes"); nt.add_argument("--task")
    jb = sub.add_parser("jobs"); jb.add_argument("--mine"); jb.add_argument("--closed", action="store_true")

    args = ap.parse_args(argv)
    cfg = Config.from_env()
    cfg.ensure_dirs()
    log = Logger(cfg.out_dir / "desk.log", quiet=args.quiet)
    handlers = {
        "doctor": cmd_doctor, "sync": cmd_sync, "prepare": cmd_prepare,
        "check": cmd_check, "deliver": cmd_deliver, "notes": cmd_notes, "jobs": cmd_jobs,
        "requests": cmd_requests, "meetings": cmd_meetings, "foreplay": cmd_foreplay, "frameio": cmd_frameio, "archive": cmd_archive,
    }
    try:
        return handlers[args.cmd](cfg, args, log)
    except (SupabaseError, http.HttpError) as e:
        log.error(http.scrub(str(e))[:400])
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
