"""The safe automatic fixes, and nothing else (the failure catalogue's list).

Each one can be repeated without harm, can be undone, touches no lead or
client data, sends nothing and spends nothing. Each runs only on the VPS
itself (LocalHost), only in --mode fix, and the engine allows it at most
once per incident per hour, backing off after that.

1. catch_up(job)      one catch-up run of a copy-only job, with the exact
                      command the live crontab runs (same flock, same log)
2. stop_hung          SIGTERM, then SIGKILL after 30 s, for a copy-only run
                      past its hard age
3. rotate_logs        gzip hermes's own logs over 50 MB while the disk is
                      over 80% full; keeps every line, at most 5 copies
4. tighten_env        chmod 600 on hermes-owned env files that are looser
5. radar_resend       radar.py resend once after a Creative Triage outage
6. editor_stills      create the private editor-stills bucket
7. sales_doctor       desk.py doctor, only while the desk drafts through the
                      VPS proxy (its one-token ping then costs no money)
8. crontab_proposal   back up the crontab and write the proposed restore and
                      its diff; never installs it
"""
from __future__ import annotations

import difflib
import gzip
import os
import shutil
import signal
import stat
import time
from pathlib import Path
from typing import Any

from . import jobs as jobs_mod
from .model import Fix, FixOutcome, Result
from .redact import clean

ROTATE_OVER_BYTES = 50 * 1024 * 1024
ROTATE_KEEP = 5
ROTATE_DISK_PCT = 80.0
HUNG_GRACE_S = 30


def _local(ctx: Any) -> None:
    if ctx.host is None or ctx.host.remote:
        raise RuntimeError("fixes run only on the VPS itself")


# ---- 1. catch-up run ----------------------------------------------------------

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
        pid = ctx.host.spawn(command)
        return FixOutcome(True, f"started one catch-up run of {job_name} with its own cron command (pid {pid}); "
                                "if a run already holds the lock, this one exits at once")

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


def _stop_hung(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    procs = (ctx.snap_part("procs") or {}).get("jobs") or []
    targets = [p for p in hung_runs(procs) if p["kind"] == "copy" and p.get("mine")]
    if not targets:
        return FixOutcome(False, "no hung copy-only run of hermes's own to stop (runs that send or call a model are "
                                 "left for a person)")
    done = []
    for p in targets:
        pid = int(p["pid"])
        try:
            ctx.host.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            done.append(f"{p['job']} (pid {pid}) had already ended")
            continue
        deadline = time.monotonic() + HUNG_GRACE_S
        while time.monotonic() < deadline and ctx.host.alive(pid):
            time.sleep(1)
        if ctx.host.alive(pid):
            try:
                ctx.host.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            done.append(f"{p['job']} (pid {pid}, {int(p['etimes']) // 60} min) stopped with SIGKILL after 30 s")
        else:
            done.append(f"{p['job']} (pid {pid}, {int(p['etimes']) // 60} min) stopped with SIGTERM")
    return FixOutcome(True, "; ".join(done) + ". The next cron run resumes; writes are upserts.")


STOP_HUNG = Fix(name="stop-hung", describe="stop the hung copy-only run (SIGTERM, then SIGKILL after 30 s)",
                apply=_stop_hung)


# ---- 3. rotate logs ---------------------------------------------------------------

def rotate_file(path: Path, stamp: str, keep: int = ROTATE_KEEP) -> str:
    """gzip a copy, then empty the live file in place (cron keeps appending to
    the same inode). Every line is kept in the .gz; nothing is deleted."""
    copies = sorted(path.parent.glob(path.name + ".*.gz"))
    if len(copies) >= keep:
        return f"{path.name} already has {len(copies)} rotated copies; left as it is"
    target = path.parent / f"{path.name}.{stamp}.gz"
    with open(path, "rb") as src, gzip.open(target, "wb") as dst:
        shutil.copyfileobj(src, dst)
        copied = src.tell()
    os.chmod(target, 0o600)
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
    return FixOutcome(True, "; ".join(notes))


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


def _radar_resend(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    cmd = _derived_command(ctx, "radar-scan", "radar.py --quiet scan", "radar.py --quiet resend",
                           "$HOME/.ideation-radar/scan.lock")
    if not cmd:
        return FixOutcome(False, "the radar's scan line is not in the crontab, so resend has no environment to run in")
    pid = ctx.host.spawn(cmd)
    return FixOutcome(True, f"started radar.py resend once (pid {pid}): the last scan and captured ideas are sent "
                            "again as upserts from local files; it costs nothing", done=True)


RADAR_RESEND = Fix(name="radar-resend", describe="run radar.py resend once now that Creative Triage answers again",
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


# ---- 7. sales desk doctor ------------------------------------------------------------------

def _sales_doctor(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    provider = (ctx.snap_part("settings") or {}).get("SALES_MODEL_PROVIDER", "")
    if provider != "vps":
        return FixOutcome(False, f"the sales desk drafts through {provider or 'an unknown provider'}, so doctor's "
                                 "one-token ping could cost money; left for a person")
    cmd = _derived_command(ctx, "desk-recordings", "desk.py --quiet recordings", "desk.py --quiet doctor",
                           "$HOME/.sales-desk/doctor.lock")
    if not cmd:
        return FixOutcome(False, "the sales desk's recordings line is not in the crontab, so doctor has no environment")
    pid = ctx.host.spawn(cmd)
    return FixOutcome(True, f"started desk.py doctor (pid {pid}); it writes only its own status row")


SALES_DOCTOR = Fix(name="sales-doctor", describe="run desk.py doctor so its status row is current", apply=_sales_doctor)


# ---- 8. crontab restore, prepared only ------------------------------------------------------

def proposal(live: list[str], manifest: list[str]) -> tuple[list[str], list[str]]:
    """The live crontab plus every manifest line whose job is missing, and those lines."""
    have = {jobs_mod.job_for_line(l) for l in live}
    missing = [l for l in manifest if jobs_mod.job_for_line(l) not in have]
    return live + missing, missing


def _crontab_proposal(ctx: Any, result: Result) -> FixOutcome:
    _local(ctx)
    live = (ctx.snap_part("crontab") or {}).get("lines") or []
    proposed, missing = proposal(live, jobs_mod.manifest_lines())
    if not missing:
        return FixOutcome(False, "no manifest line is missing from the crontab")
    home = ctx.cfg.home
    home.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
    rc, out, _ = ctx.host.run(["crontab", "-l"])
    backup = home / f"crontab.backup.{stamp}"
    backup.write_text(out if rc == 0 else "", encoding="utf-8")
    (home / "crontab.proposed").write_text("\n".join(proposed) + "\n", encoding="utf-8")
    diff = difflib.unified_diff(live, proposed, "crontab (live)", "crontab.proposed", lineterm="")
    (home / "crontab.diff").write_text("\n".join(diff) + "\n", encoding="utf-8")
    for p in (backup, home / "crontab.proposed", home / "crontab.diff"):
        os.chmod(p, 0o600)
    return FixOutcome(True, f"wrote {home}/crontab.proposed and crontab.diff ({len(missing)} line(s) to restore) and "
                            f"backed up the live crontab to {backup.name}; nothing was installed")


CRONTAB_PROPOSAL = Fix(name="crontab-proposal", describe="back up the crontab and write the proposed restore (not installed)",
                       apply=_crontab_proposal, max_attempts=3)

