"""The safe automatic fixes, and nothing else (the failure catalogue's list).

Each one can be repeated without harm, can be undone, touches no lead or
client data, sends nothing and spends nothing. Each runs only on the VPS
itself (LocalHost), only in --mode fix, and the engine allows it at most
once per incident per hour, backing off after that.

1. catch_up(job)      one catch-up run of a copy-only job, with the exact
                      command the live crontab runs (same flock, same log,
                      cron's bare environment)
2. stop_hung          SIGTERM, then SIGKILL after 30 s, for a copy-only cron
                      run past its hard age whose CPU time has not moved for
                      15 minutes; at most once per job a day
3. rotate_logs        gzip hermes's own logs over 50 MB while the disk is
                      over 80% full; keeps every line, at most 5 copies
4. tighten_env        chmod 600 on hermes-owned env files that are looser
5. radar_resend       radar.py resend once after a Creative Triage outage,
                      only the ideas captured during it
6. editor_stills      create the private editor-stills bucket
7. crontab_proposal   back up the crontab and write the proposed restore and
                      its diff; never installs it

(desk.py doctor was a fix here once; it is not: re-running it every time its
row went stale launched Chrome and read Maqsam and HighLevel 18 times a day
while the real cause, no cron line for doctor, never changed.)
"""
from __future__ import annotations

import difflib
import gzip
import json
import os
import shlex
import shutil
import signal
import stat
import time
from datetime import timedelta
from pathlib import Path
from typing import Any

from . import jobs as jobs_mod
from .model import FAIL, Fix, FixOutcome, Result, iso, kuwait, parse_time
from .redact import clean

ROTATE_OVER_BYTES = 50 * 1024 * 1024
ROTATE_KEEP = 5
ROTATE_DISK_PCT = 80.0
HUNG_GRACE_S = 30
HUNG_STILL = timedelta(minutes=15)       # CPU time unchanged this long: stuck, not slow
KILL_ONCE_A_DAY = timedelta(hours=24)


def _local(ctx: Any) -> None:
    if ctx.host is None or ctx.host.remote:
        raise RuntimeError("fixes run only on the VPS itself")


# ---- 1. catch-up run ----------------------------------------------------------

def started(job_name: str, pid: int, rc: Any) -> FixOutcome:
    """What a spawn watched for 2 s says. `flock -n` exits 1 at once when another
    run holds the lock: then nothing new ran, and the guardian takes no credit."""
    if rc is None:
        return FixOutcome(True, f"started one run of {job_name} with its own cron command (pid {pid}); it is running "
                                "under the job's own lock")
    if rc == 0:
        return FixOutcome(True, f"ran one run of {job_name} with its own cron command; it finished at once (exit 0)")
    if rc == 1:
        return FixOutcome(False, f"started {job_name} but it exited at once with 1: another run holds its lock "
                                 "(flock -n), or it failed at start; nothing new ran")
    return FixOutcome(False, f"started {job_name} but it exited at once with {rc}; read the job's log")


def catch_up(job_name: str) -> Fix:
    job = jobs_mod.BY_NAME[job_name]
    if job.kind != "copy":
        raise ValueError(f"{job_name} is not a copy-only job; the guardian never re-runs it")

    def apply(ctx: Any, result: Result) -> FixOutcome:
        _local(ctx)
        if not result.data.get("stale"):
            return FixOutcome(False, f"{job_name} is failing, not late; another run would fail the same way")
        lines = (ctx.snap_part("crontab") or {}).get("lines") or []
        command = jobs_mod.command_for(job, lines)
        if not command:
            return FixOutcome(False, f"the crontab has no flock line for {job_name}, so there is nothing to re-run "
                                     "(a missing line is the crontab check's to report)")
        pid, rc = ctx.host.spawn(command)
        return started(job_name, pid, rc)

    return Fix(name=f"catch-up:{job_name}", describe=f"start one catch-up run of {job_name} under its own lock",
               apply=apply)


# ---- 2. stop a hung run ------------------------------------------------------------

def hung_runs(procs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Runs past max(4 x interval, 60 min)."""
    out = []
    for p in procs:
        job = jobs_mod.BY_NAME.get(p.get("job", ""))
        if not job:
            continue
        hard = max(4 * job.every_min, 60) * 60
        if int(p.get("etimes") or 0) > hard:
            out.append({**p, "hard_s": hard, "kind": job.kind})
    return out


def proc_key(p: dict[str, Any]) -> str:
    return f"{p.get('pid')}:{p.get('start')}"


def track_cpu(state: dict[str, Any], hung: list[dict[str, Any]], now: Any) -> list[str]:
    """Remember each hung run's CPU time; returns the keys of runs whose CPU time has not
    moved for 15 minutes (stuck). A run still using CPU is slow, not hung."""
    seen = state.setdefault("hung_cpu", {})
    live = set()
    stuck = []
    for p in hung:
        key = proc_key(p)
        live.add(key)
        rec = seen.get(key)
        if rec is None or rec.get("cpu") != p.get("cpu"):
            seen[key] = {"since": iso(now), "cpu": p.get("cpu"), "job": p.get("job")}
            continue
        since = parse_time(rec.get("since"))
        if since is not None and now - since >= HUNG_STILL:
            stuck.append(key)
    for key in list(seen):
        if key not in live:
            seen.pop(key, None)
    return stuck


def _stop_hung(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    procs = (ctx.snap_part("procs") or {}).get("jobs") or []
    stuck = set(result.data.get("stuck") or [])
    killed = ctx.state.setdefault("killed", {})
    rec = ctx.state.get("hung_cpu") or {}
    candidates = [p for p in hung_runs(procs) if p["kind"] == "copy" and p.get("mine") and p.get("flock")]
    if not candidates:
        return FixOutcome(False, "no hung copy-only cron run of hermes's own (one started by cron under its flock) to "
                                 "stop; runs that send or call a model, and manual runs, are left for a person")
    done, left = [], []
    for p in candidates:
        pid, job, key = int(p["pid"]), p["job"], proc_key(p)
        last = parse_time(killed.get(job))
        if last and ctx.now - last < KILL_ONCE_A_DAY:
            left.append(f"{job} was already stopped once at {kuwait(last)}; a second stop in a day is a person's call")
            continue
        if key not in stuck or (rec.get(key) or {}).get("cpu") != p.get("cpu"):
            left.append(f"{job} (pid {pid}) is past its hard age but still using CPU, so it was left running")
            continue
        # The pid is from a look a moment ago: make sure it is still the same process.
        now_stat = ctx.host.proc_stat(pid)
        if now_stat is None:
            done.append(f"{job} (pid {pid}) had already ended")
            continue
        if now_stat[0] != p.get("start") or now_stat[1] != p.get("cpu"):
            left.append(f"{job} (pid {pid}) changed since the look (another process, or it moved again); nothing stopped")
            continue
        try:
            ctx.host.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            done.append(f"{job} (pid {pid}) had already ended")
            continue
        killed[job] = iso(ctx.now)
        deadline = time.monotonic() + HUNG_GRACE_S
        while time.monotonic() < deadline and ctx.host.alive(pid):
            time.sleep(1)
        if ctx.host.alive(pid):
            try:
                ctx.host.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            done.append(f"{job} (pid {pid}, {int(p['etimes']) // 60} min, no CPU for 15 min) stopped with SIGKILL after 30 s")
        else:
            done.append(f"{job} (pid {pid}, {int(p['etimes']) // 60} min, no CPU for 15 min) stopped with SIGTERM")
    if not done:
        return FixOutcome(False, "; ".join(left))
    return FixOutcome(True, "; ".join(done + left) + ". The next cron run resumes; writes are upserts.")


STOP_HUNG = Fix(name="stop-hung", describe="stop the hung copy-only cron run once its CPU time has stopped moving "
                                           "(SIGTERM, then SIGKILL after 30 s)", apply=_stop_hung)


# ---- 3. rotate logs ---------------------------------------------------------------

def rotate_file(path: Path, stamp: str, keep: int = ROTATE_KEEP) -> str:
    """gzip a copy, then empty the live file in place (cron keeps appending to
    the same inode). Every line is kept in the .gz; nothing is deleted. The copy
    is written as .gz.part and renamed only when whole, so a full disk never
    leaves a broken copy that counts toward the five."""
    copies = sorted(path.parent.glob(path.name + ".*.gz"))
    if len(copies) >= keep:
        return f"{path.name} already has {len(copies)} rotated copies; left as it is"
    size = path.stat().st_size
    free = shutil.disk_usage(str(path.parent)).free
    if free < size // 3:
        return (f"{path.name} not rotated: {free // (1024 * 1024)} MB free is under a third of its "
                f"{size // (1024 * 1024)} MB, so the copy might not fit")
    target = path.parent / f"{path.name}.{stamp}.gz"
    part = path.parent / f"{target.name}.part"
    try:
        with open(path, "rb") as src, gzip.open(part, "wb") as dst:
            shutil.copyfileobj(src, dst)
            copied = src.tell()
        os.chmod(part, 0o600)
        os.replace(part, target)
    except BaseException:
        try:
            part.unlink()
        except OSError:
            pass
        raise
    with open(path, "r+b") as fh:
        fh.seek(copied)
        tail = fh.read()          # lines written while the copy was made
        fh.seek(0)
        fh.truncate()
        fh.write(tail)
    return f"{path.name} rotated to {target.name}"


def _rotate(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    disk = ctx.snap_part("disk")
    if float(disk.get("pct") or 0) < ROTATE_DISK_PCT:
        return FixOutcome(False, f"the disk is {disk.get('pct')}% full, under {ROTATE_DISK_PCT:.0f}%, so no log is rotated")
    files = ctx.snap_part("files") or {}
    home = ctx.host.home
    stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
    notes = []
    for log in jobs_mod.HERMES_LOGS:
        info = files.get(log)
        if not info or int(info.get("size") or 0) < ROTATE_OVER_BYTES or info.get("owner") != ctx.snapshot().get("user"):
            continue
        notes.append(rotate_file(Path(jobs_mod.expand(log, home)), stamp))
    if not notes:
        return FixOutcome(False, "no hermes log is over 50 MB")
    return FixOutcome(any("rotated to" in n for n in notes), "; ".join(notes))


ROTATE_LOGS = Fix(name="rotate-logs", describe="gzip hermes's own logs over 50 MB (every line kept)", apply=_rotate)


# ---- 4. env file permissions --------------------------------------------------------

def _tighten(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    files = ctx.snap_part("files") or {}
    me = ctx.snapshot().get("user")
    changed = []
    for path, info in files.items():
        if not info or not (path.endswith("/env") or path.endswith(".env")):
            continue
        if info.get("owner") != me or int(info.get("mode") or "600", 8) & 0o077 == 0:
            continue
        fp = jobs_mod.expand(path, ctx.host.home)
        os.chmod(fp, stat.S_IRUSR | stat.S_IWUSR)
        changed.append(f"{path} {info.get('mode')} -> 600")
    if not changed:
        return FixOutcome(False, "no hermes-owned env file is looser than 600")
    return FixOutcome(True, "; ".join(changed))


TIGHTEN_ENV = Fix(name="chmod-env", describe="set hermes-owned env files to mode 600", apply=_tighten)


# ---- 5. radar resend ------------------------------------------------------------------

def _derived_command(ctx: Any, job_name: str, old: str, new: str, lock: str) -> str:
    """A command built from a live crontab line: same env files and folder,
    another subcommand, another lock."""
    lines = (ctx.snap_part("crontab") or {}).get("lines") or []
    command = jobs_mod.command_for(jobs_mod.BY_NAME[job_name], lines)
    if not command or old not in command:
        return ""
    command = command.replace(old, new)
    first = command.split()[2]  # flock -n <lock> ...
    return command.replace(first, lock, 1)


def _ideas_since(src: Path, since: Any) -> list[str]:
    out = []
    try:
        text = src.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in text.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        t = parse_time(row.get("captured_at"))
        if t is not None and since is not None and t >= since:
            out.append(line)
    return out


def _radar_resend(ctx: Any, result: Result) -> FixOutcome:
    """Only what the outage may have lost: ideas captured since the incident began,
    and the weekly scan only if it ran during it. Resending the whole history would
    bring back ideas a person deleted and reorder the board."""
    _local(ctx)
    inc = (result.data or {}).get("incident") or {}
    if inc and inc.get("level") != FAIL:
        return FixOutcome(False, "not needed: Creative Triage was only slow (a warning), so no write was lost", done=True)
    since = parse_time(inc.get("first_seen_at"))
    if since is None:
        return FixOutcome(False, "the outage has no start time, so what to send again is unknown; left for a person")
    out_dir = Path(jobs_mod.expand("~/.ideation-radar/out", ctx.host.home))
    lines = _ideas_since(out_dir / "ideas.jsonl", since)
    latest = out_dir / "latest.json"
    scan_ran = latest.exists() and latest.stat().st_mtime >= since.timestamp()
    if not lines and not scan_ran:
        return FixOutcome(True, "nothing to send again: no idea was captured and no scan ran during the outage", done=True)
    home = ctx.cfg.home
    home.mkdir(parents=True, exist_ok=True)
    ideas = home / "radar-resend-ideas.jsonl"
    ideas.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    os.chmod(ideas, 0o600)
    scan = latest if scan_ran else home / "radar-resend-no-scan.json"   # a path that does not exist: no proposals
    cmd = _derived_command(ctx, "radar-scan", "radar.py --quiet scan",
                           f"radar.py --quiet resend --ideas {shlex.quote(str(ideas))} --scan {shlex.quote(str(scan))}",
                           "$HOME/.ideation-radar/scan.lock")
    if not cmd:
        return FixOutcome(False, "the radar's scan line is not in the crontab, so resend has no environment to run in")
    pid, rc = ctx.host.spawn(cmd)
    if rc not in (None, 0):
        return FixOutcome(False, f"radar.py resend exited at once with {rc} (the weekly scan may hold its lock); "
                                 "it is tried again on a later run")
    what = f"{len(lines)} idea(s) captured since {kuwait(since)}" + (" and the scan that ran during it" if scan_ran else "")
    return FixOutcome(True, f"started radar.py resend once (pid {pid}) for {what}; upserts from local files, no cost",
                      done=True)


RADAR_RESEND = Fix(name="radar-resend", describe="send again, once, the radar ideas captured while Creative Triage was down",
                   apply=_radar_resend, max_attempts=1)


# ---- 6. editor-stills bucket -------------------------------------------------------------

def _editor_stills(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    db = ctx.need_db()
    if not hasattr(db, "storage"):
        return FixOutcome(False, "this database door cannot reach Storage")
    r = db.storage("GET", "bucket/editor-stills")
    if r.status == 200:
        return FixOutcome(True, "the editor-stills bucket already exists", done=True)
    r = db.storage("POST", "bucket", {"id": "editor-stills", "name": "editor-stills", "public": False})
    if r.status in (200, 201):
        return FixOutcome(True, "created the private editor-stills bucket (empty; it can be removed)", done=True)
    return FixOutcome(False, f"Storage answered {r.status}: {clean(r.text(200), 160)}")


EDITOR_STILLS = Fix(name="editor-stills-bucket", describe="create the private editor-stills bucket", apply=_editor_stills,
                    max_attempts=2)


# ---- 7. crontab restore, prepared only ------------------------------------------------------

def _commented_jobs(raw: list[str]) -> set[str]:
    out = set()
    for line in raw:
        body = line.strip()
        if not body.startswith("#"):
            continue
        j = jobs_mod.job_for_line(body.lstrip("#").strip())
        if j:
            out.add(j.name)
    return out


def proposal(raw: list[str], manifest: list[str]) -> tuple[list[str], list[str], list[str]]:
    """The live crontab exactly as `crontab -l` printed it (comments kept) plus every
    manifest line whose job is missing. A job commented out on purpose is paused,
    not missing: it is listed, never put back."""
    live = [l for l in raw if l.strip() and not l.strip().startswith("#")]
    have = {jobs_mod.job_for_line(l).name for l in live if jobs_mod.job_for_line(l)}
    paused = sorted(_commented_jobs(raw) - have)
    missing = [l for l in manifest if jobs_mod.job_for_line(l) and jobs_mod.job_for_line(l).name not in have
               and jobs_mod.job_for_line(l).name not in paused]
    return list(raw) + missing, missing, paused


def _crontab_proposal(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    rc, out, err = ctx.host.run(["crontab", "-l"])
    if rc != 0 and "no crontab" not in (err or "").lower():
        return FixOutcome(False, f"crontab -l failed ({clean(err, 120)}), so no restore was prepared")
    raw = out.splitlines() if rc == 0 else []
    proposed, missing, paused = proposal(raw, jobs_mod.manifest_lines())
    if not missing:
        tail = f" ({', '.join(paused)} commented out on purpose)" if paused else ""
        return FixOutcome(False, f"no manifest line is missing from the crontab{tail}")
    home = ctx.cfg.home
    home.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
    backup = home / f"crontab.backup.{stamp}"
    backup.write_text(out if rc == 0 else "", encoding="utf-8")
    (home / "crontab.proposed").write_text("\n".join(proposed) + "\n", encoding="utf-8")
    diff = difflib.unified_diff(raw, proposed, "crontab (live)", "crontab.proposed", lineterm="")
    (home / "crontab.diff").write_text("\n".join(diff) + "\n", encoding="utf-8")
    for p in (backup, home / "crontab.proposed", home / "crontab.diff"):
        os.chmod(p, 0o600)
    tail = f"; left out, commented out on purpose: {', '.join(paused)}" if paused else ""
    return FixOutcome(True, f"wrote {home}/crontab.proposed and crontab.diff ({len(missing)} line(s) to restore, the live "
                            f"crontab's own lines and comments kept) and backed up the live crontab to {backup.name}; "
                            f"nothing was installed{tail}")


CRONTAB_PROPOSAL = Fix(name="crontab-proposal", describe="back up the crontab and write the proposed restore (not installed)",
                       apply=_crontab_proposal, max_attempts=3)
