#!/usr/bin/env python3
"""Cockpit guardian: watches every Mahara cockpit and its machinery.

    python3 guardian.py [--mode report-only|fix] [--dry-run] [--quiet] [--json] [--only ID,ID] <command>

    scan                     run every check; open, update or resolve incidents; post what is due; then the
                             dead-man heartbeat and, once a Kuwait day after 09:00, the summary
    fix                      re-check the open incidents that have a safe fix and apply it (fix mode only)
    run                      scan, then fix: what cron runs every 5 minutes
    report [--post]          the plain-English summary (--post sends it now, once a day; the scan does it at 09:00)
    doctor                   keys present by name, what answers, the guardian's own files and permissions
    checks                   every check: what it means, how it reads, its threshold, its safe fix
    ai-brief --incident ID   write a self-contained brief a Claude Code session can act on
    ai-fix --incident ID     run Claude Code headless on a fresh clone and open a pull request (never deploys)

--mode report-only (the default until the CEO says otherwise) never fixes anything, the AI fixer included.
--dry-run writes nothing to Supabase and posts nothing; without --state-dir it works on a scratch copy
of the state file, so the real one is never touched.
Off the VPS (GUARDIAN_SSH set) the VPS is only read, nothing is written to Supabase, and nothing is fixed.
Runs that change the state (scan, run, fix, report --post) take ~/.cockpit-guardian/state.lock, waiting
up to 120 s, so two runs never overwrite each other's state.

Standard library only. Keys are read by name and never printed.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

import checks as checks_mod  # noqa: E402
from guard import ai as ai_mod  # noqa: E402
from guard import alerts as alerts_mod  # noqa: E402
from guard import beat as beat_mod  # noqa: E402
from guard import config as config_mod  # noqa: E402
from guard import engine  # noqa: E402
from guard import report as report_mod  # noqa: E402
from guard.context import Context  # noqa: E402
from guard.db import DbError, open_db  # noqa: E402
from guard.host import MONITOR_ROOT, HostError, LocalHost, open_host, write_monitor_state  # noqa: E402
from guard.model import KUWAIT, STATUSES, Result, now_utc, parse_time  # noqa: E402
from guard.redact import clean  # noqa: E402
from guard.store import UNWRITABLE_MARKER, StateUnwritable, Store  # noqa: E402

LOCK_WAIT_S = 120
UNWRITABLE_EVERY_S = 6 * 3600
DAILY_HOUR_KUWAIT = 9


class StateLock:
    """One state-changing run at a time. A different file from cron's run.lock: cron's
    `flock -n run.lock` is held by the parent of this very process, so taking run.lock
    here would wait on itself."""

    def __init__(self, home: Path, wait_s: float = LOCK_WAIT_S):
        self.path = Path(home) / "state.lock"
        self.wait_s = wait_s
        self.fh = None

    def __enter__(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.path, "a")
        deadline = time.monotonic() + self.wait_s
        while True:
            try:
                fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except OSError:
                if time.monotonic() >= deadline:
                    return False
                time.sleep(1)

    def __exit__(self, *exc: Any) -> None:
        if self.fh:
            try:
                fcntl.flock(self.fh, fcntl.LOCK_UN)
            finally:
                self.fh.close()


class Log:
    def __init__(self, path: Optional[Path], quiet: bool):
        self.path = path
        self.quiet = quiet

    def __call__(self, line: str) -> None:
        text = f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {clean(line, 800)}"
        if self.path:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write(text + "\n")
            except OSError:
                pass
        if not self.quiet:
            print(text, file=sys.stderr)


def _setup(args: argparse.Namespace) -> tuple[Any, Any, Any, Store, Log]:
    """Config, doors and an UNLOADED store: callers load it under the state lock."""
    cfg = config_mod.load(mode=args.mode, dry_run=args.dry_run, quiet=args.quiet, state_dir=args.state_dir)
    if cfg.dry_run and not args.state_dir:
        # A dry run must never resolve, dequeue or rewrite the real state: work on a copy.
        real = cfg.state_file
        cfg.home = Path(tempfile.mkdtemp(prefix="guardian-dry-"))
        if real.exists():
            try:
                shutil.copy2(real, cfg.state_file)
            except OSError:
                pass
    log = Log(None if args.dry_run else cfg.home / "guardian.log", args.quiet)
    db = None
    try:
        db = open_db(cfg)
    except DbError as e:
        log(f"no database door: {e}")
    host = open_host(cfg)
    # Only the guardian's own run on the VPS writes incident rows: one writer, never two.
    store = Store(cfg.state_file, db, write_db=not cfg.dry_run and not cfg.remote)
    return cfg, db, host, store, log


def _unwritable(store: Store) -> Optional[str]:
    """Saving the state straight after loading it says whether this run can keep its
    throttles and backoff. A run that cannot must not post or fix (it would repeat)."""
    try:
        store.save()
        return None
    except OSError as e:
        return clean(e, 160)


def _say_unwritable(cfg: Any, err: str, log: "Log", now: Any) -> None:
    """The one message a run that cannot write may send, at most every 6 hours: throttled by
    the mtime of a marker made while there was room (os.utime needs no free block), or, if
    there is no marker, by the clock (the first 5 minutes of every sixth hour)."""
    log(f"the state folder cannot be written ({err}); this run only reads")
    if cfg.dry_run or cfg.remote:
        return
    marker = cfg.home / UNWRITABLE_MARKER
    try:
        due = time.time() - marker.stat().st_mtime >= UNWRITABLE_EVERY_S
        have_marker = True
    except OSError:
        due = now.hour % 6 == 0 and now.minute < 5
        have_marker = False
    if not due:
        return
    slack = alerts_mod.Slack(cfg.slack_token, cfg.slack_channel)
    if slack.send(alerts_mod.unwritable_text(str(cfg.home), err)) is None and have_marker:
        try:
            os.utime(marker, None)
        except OSError:
            pass


def _checks(args: argparse.Namespace) -> list:
    all_checks = checks_mod.all_checks()
    if args.only:
        want = {x.strip() for x in args.only.split(",") if x.strip()}
        unknown_ids = want - {c.id for c in all_checks}
        if unknown_ids:
            raise SystemExit(f"no such check: {', '.join(sorted(unknown_ids))}")
        return [c for c in all_checks if c.id in want]
    return all_checks


def _outbox(cfg: Any) -> alerts_mod.Outbox:
    slack = alerts_mod.Slack(cfg.slack_token, cfg.slack_channel) if not cfg.remote else None
    return alerts_mod.Outbox(slack, dry_run=cfg.dry_run or cfg.remote)


def _print_outcome(out: engine.Outcome, args: argparse.Namespace) -> None:
    if args.json:
        print(json.dumps({
            "results": [{"id": f.check.id, "area": f.check.area, "status": f.result.status, "summary": f.result.summary,
                         "caused_by": f.result.caused_by, "coverage_gap": f.result.coverage_gap, "seconds": f.seconds}
                        for f in out.findings],
            "opened": [i["check_id"] for i in out.opened],
            "resolved": [i["check_id"] for i in out.resolved if i],
            "posted": len(out.posted), "would_post": out.would_post, "fixes": out.fixes, "notes": out.notes,
        }, ensure_ascii=False, indent=1, default=str))
        return
    if args.quiet:
        return
    marks = {"ok": "ok  ", "warn": "WARN", "fail": "FAIL", "unknown": "??  ", "not_deployed": "n/d ", "paused": "pause"}
    for f in out.findings:
        extra = f" (part of {f.result.caused_by})" if f.result.caused_by else ""
        print(f"{marks[f.result.status]} {f.check.id:<28} {clean(f.result.summary, 400)}{extra}")
    print()
    print(f"opened {len(out.opened)}, resolved {len([i for i in out.resolved if i])}, posted {len(out.posted)}, "
          f"would post {len(out.would_post)}")
    for f in out.fixes:
        print(f"fix: {f}")
    for n in out.notes:
        print(f"note: {n}")


def _after_scan(cfg: Any, host: Any, store: Store, checks: list, args: argparse.Namespace, log: "Log", now: Any,
                unwritable: bool) -> None:
    """What only a full scan on the VPS does: the Hermes-shaped incident file, the
    09:00 summary, and the dead-man heartbeat (last, so it reports this run)."""
    if cfg.dry_run or cfg.remote or args.only:
        return
    by_id = {c.id: c for c in checks}
    export = cfg.keys.get("GUARDIAN_MONITOR_EXPORT") or f"{MONITOR_ROOT}/cockpit-guardian/state.json"
    if isinstance(host, LocalHost) and os.path.isdir(os.path.dirname(os.path.dirname(export))):
        try:
            write_monitor_state(export, engine.hermes_incidents(store, by_id), now.timestamp())
        except OSError as e:
            log(f"could not write the Hermes-shaped incident file: {e}")
    if not unwritable and report_mod.daily_due(store.state, now) and \
            now.astimezone(KUWAIT).hour >= DAILY_HOUR_KUWAIT:
        outbox = _outbox(cfg)
        if outbox.post(report_mod.build(store.state, checks_mod.by_id(), now, for_slack=True)):
            report_mod.mark_daily(store.state, now)
            log("daily summary posted")
        elif outbox.errors:
            log(f"daily summary not posted: {outbox.errors[-1]}")
    beat = beat_mod.send(cfg.keys, store.state, now)
    if beat.get("error"):
        log(f"heartbeat not sent: {beat['error']}")
    if not unwritable:
        try:
            store.save()
        except OSError as e:
            log(f"could not save the state after the heartbeat: {e}")


def cmd_scan(args: argparse.Namespace, *, fix: bool) -> int:
    cfg, db, host, store, log = _setup(args)
    with StateLock(cfg.home) as locked:
        if not locked:
            log(f"another guardian run has held the state lock for {LOCK_WAIT_S} s; this run stops")
            return 2
        store.load()
        ctx = Context(cfg, db, host, state=store.state)
        err = _unwritable(store)
        outbox = _outbox(cfg)
        if err:
            cfg.mode = "report-only"
            outbox = alerts_mod.Outbox(None, dry_run=True)
            _say_unwritable(cfg, err, log, ctx.now)
        checks = _checks(args)
        try:
            out = engine.scan(ctx, store, checks, outbox, fix=fix, log=log)
            if not err:
                store.checkpoint()
        except StateUnwritable as e:
            _say_unwritable(cfg, str(e), log, ctx.now)
            return 1
        _after_scan(cfg, host, store, checks, args, log, ctx.now, bool(err))
    for i in out.opened:
        log(f"opened {i['check_id']} ({i['id'][:8]}, {i['level']}): {i['detail']}")
    for i in out.resolved:
        if i:
            log(f"resolved {i['check_id']} ({i['id'][:8]}): {i['resolved_by']}")
    for f in out.fixes:
        log(f"fix: {f}")
    _print_outcome(out, args)
    return 1 if err else 0


def cmd_fix(args: argparse.Namespace) -> int:
    cfg, db, host, store, log = _setup(args)
    with StateLock(cfg.home) as locked:
        if not locked:
            log(f"another guardian run has held the state lock for {LOCK_WAIT_S} s; this run stops")
            return 2
        store.load()
        err = _unwritable(store)
        if err:
            _say_unwritable(cfg, err, log, now_utc())
            return 1
        ctx = Context(cfg, db, host, state=store.state)
        by_id = checks_mod.by_id()
        # Earlier readings stand in for the checks not re-run, so "someone else alerts" stays known.
        for cid, r in ((store.state.get("last_scan") or {}).get("results") or {}).items():
            if r.get("status") in STATUSES:
                ctx.results[cid] = Result(r["status"], r.get("summary") or "", caused_by=r.get("caused_by"),
                                          data=r.get("data") or {})
        targets = [by_id[cid] for cid in store.open if cid in by_id and by_id[cid].fix]
        out = engine.Outcome()
        try:
            out.findings = engine.run_checks(ctx, targets)
            engine.apply_findings(store, out.findings, ctx.now, cfg.mode, out)
            engine.run_fixes(ctx, store, by_id, ctx.now, out, log)
            engine.post_alerts(store, by_id, ctx.results, ctx.now, cfg.mode, _outbox(cfg), out)
            note = store.flush(ctx.now)
            if note:
                out.notes.append(note)
            store.checkpoint()
        except StateUnwritable as e:
            _say_unwritable(cfg, str(e), log, ctx.now)
            return 1
    for f in out.fixes:
        log(f"fix: {f}")
    _print_outcome(out, args)
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    cfg, db, host, store, log = _setup(args)
    now = now_utc()
    by_id = checks_mod.by_id()
    if not args.post:
        store.load()
        if args.json:
            print(json.dumps(report_mod.as_json(store.state), ensure_ascii=False, indent=1, default=str))
            return 0
        print(report_mod.build(store.state, by_id, now))
        return 0
    with StateLock(cfg.home) as locked:
        if not locked:
            print(f"another guardian run has held the state lock for {LOCK_WAIT_S} s; try again")
            return 2
        store.load()
        text = report_mod.build(store.state, by_id, now, for_slack=True)
        print(text)
        if not report_mod.daily_due(store.state, now) and not args.force:
            print("\n(the daily summary already went today; --force sends it again)")
            return 0
        outbox = _outbox(cfg)
        if outbox.post(text):
            report_mod.mark_daily(store.state, now)
            try:
                store.save()
            except OSError as e:
                log(f"the summary went but the state could not be saved: {e}")
            log("daily summary posted")
        elif outbox.dry_run:
            print("\n(dry run or off the VPS: not posted)")
        else:
            print(f"\nnot posted: {outbox.errors[-1] if outbox.errors else 'unknown reason'}")
            return 1
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    cfg = config_mod.load(mode=args.mode, dry_run=True, quiet=True, state_dir=args.state_dir)
    rows: list[tuple[Optional[bool], str, str]] = []

    def add(ok: Optional[bool], name: str, detail: str) -> None:
        rows.append((ok, name, detail))

    add(sys.version_info >= (3, 9), "python", sys.version.split()[0])
    add(True, "mode", f"{cfg.mode}{' (fixes off: report-only)' if cfg.mode != 'fix' else ''}")
    on_vps = not cfg.remote and cfg.db_door != "mgmt"
    if not on_vps:
        add(True, "where", "a read-only run off the VPS: the VPS over ssh, Supabase through the management API; "
                           "nothing is written, posted or fixed")
    for name, required in (("DESK_SUPABASE_URL", on_vps), ("DESK_SUPABASE_KEY", on_vps), ("SLACK_BOT_TOKEN", on_vps),
                           ("SLACK_HEALTH_CHANNEL", on_vps), ("SUPABASE_ACCESS_TOKEN", on_vps),
                           ("PORTAL_MONITOR_CF_TOKEN", on_vps), ("PORTAL_MONITOR_CF_ACCOUNT", on_vps),
                           ("PORTAL_MONITOR_CF_KV_NAMESPACE", on_vps), ("GITHUB_TOKEN", False),
                           ("META_ACCESS_TOKEN", False), ("DEEPSEEK_API_KEY", False), ("OPENAI_API_KEY", False)):
        alt = {"DESK_SUPABASE_URL": "GUARDIAN_SUPABASE_URL", "DESK_SUPABASE_KEY": "GUARDIAN_SUPABASE_KEY"}.get(name)
        have = cfg.keys.has(name) or bool(alt and cfg.keys.has(alt))
        if name == "SUPABASE_ACCESS_TOKEN":
            have = bool(cfg.mgmt_token)
        if not on_vps and name in ("DESK_SUPABASE_URL", "DESK_SUPABASE_KEY", "SLACK_BOT_TOKEN", "SLACK_HEALTH_CHANNEL",
                                   "META_ACCESS_TOKEN", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "PORTAL_MONITOR_CF_TOKEN",
                                   "PORTAL_MONITOR_CF_ACCOUNT", "PORTAL_MONITOR_CF_KV_NAMESPACE") and not have:
            add(None, name, "not needed off the VPS (probes that need it are coverage gaps here)")
            continue
        why = {"SUPABASE_ACCESS_TOKEN": "Edge Function status and Supabase service health are coverage gaps without it "
                                        "(it is in monitor.env on the VPS, read by name)",
               "PORTAL_MONITOR_CF_TOKEN": "no dead-man heartbeat, so nobody would notice the guardian stopping",
               "PORTAL_MONITOR_CF_ACCOUNT": "no dead-man heartbeat, so nobody would notice the guardian stopping",
               "PORTAL_MONITOR_CF_KV_NAMESPACE": "no dead-man heartbeat, so nobody would notice the guardian stopping",
               "GITHUB_TOKEN": "ai-fix cannot clone or push without it (add it only once port 3456 is closed)",
               "META_ACCESS_TOKEN": "the Meta ad account probe is skipped",
               "DEEPSEEK_API_KEY": "the DeepSeek balance probe is skipped",
               "OPENAI_API_KEY": "the OpenAI key probe is skipped"}.get(name, "the guardian cannot work without it")
        add(True if have else (False if required else None), name, "set" if have else f"not set: {why}")
    db = None
    try:
        db = open_db(cfg)
        secs = db.ping_seconds()
        add(True, "supabase", f"{db.name} door answers in {secs:.2f} s")
        try:
            have = db.exists(config_mod.INCIDENTS_TABLE)
            add(True if have else (False if on_vps else None), "incidents table", "present" if have else
                "missing: apply supabase/migrations/20261003e_guardian_incidents.sql; until then incidents live in the state file only")
        except Exception as e:  # noqa: BLE001
            add(None, "incidents table", f"could not be checked: {clean(e, 160)}")
        try:
            p = db.probe()
            add(True, "probe", f"pg_cron readable ({len(p.get('cron_jobs') or [])} jobs)")
        except Exception as e:  # noqa: BLE001
            add(False, "probe", clean(e, 200))
    except Exception as e:  # noqa: BLE001
        add(False, "supabase", clean(e, 200))
    host = open_host(cfg)
    try:
        from guard.host import snapshot_spec
        snap = host.snapshot(snapshot_spec(cfg.repo_on_vps))
        add(True, "vps snapshot", f"read as {snap.get('user')} ({'over ssh' if host.remote else 'locally'})")
        if snap.get("user") == "root":
            add(False, "user", "the guardian must run as hermes, not root")
    except (HostError, OSError) as e:
        add(False, "vps snapshot", clean(e, 200))
    if cfg.slack_token and cfg.slack_channel and not cfg.remote:
        try:
            from guard import http
            r = http.request("POST", "https://slack.com/api/auth.test",
                             headers={"Authorization": f"Bearer {cfg.slack_token}"}, timeout=15)
            okay = bool((r.json() or {}).get("ok"))
            add(okay, "slack", "the bot token is accepted" if okay else f"Slack refuses the token ({(r.json() or {}).get('error')})")
        except Exception as e:  # noqa: BLE001
            add(None, "slack", f"could not be checked: {clean(e, 120)}")
    home = cfg.home
    if home.exists():
        mode = oct(home.stat().st_mode & 0o777)[2:]
        add(True if mode == "700" else (False if on_vps else None), "state folder",
            f"{home} mode {mode}" + ("" if mode == "700" else ", should be 700 (the first scan sets it)"))
        sf = cfg.state_file
        if sf.exists():
            m = oct(sf.stat().st_mode & 0o777)[2:]
            add(m == "600", "state file", f"{sf} mode {m}")
        writable = os.access(home, os.W_OK)
        add(writable, "state writable", "yes" if writable else "the guardian cannot write its state folder")
    else:
        add(None, "state folder", f"{home} does not exist yet; the first scan creates it (mode 700)")
    manifest = checks_mod.vps_cron.jobs_mod.manifest_lines()
    add(bool(manifest), "crontab manifest", f"{len(manifest)} lines")
    fails = [r for r in rows if r[0] is False]
    for ok_, name, detail in rows:
        mark = {True: "OK ", False: "-- ", None: "?? "}[ok_]
        print(f"{mark} {name:<22} {detail}")
    print()
    print("blocked" if fails else "ready")
    return 1 if fails else 0


def cmd_checks(args: argparse.Namespace) -> int:
    for c in checks_mod.all_checks():
        if args.json:
            continue
        fix = f" Safe fix: {c.fix.describe}." if c.fix else ""
        hook = f" After it clears: {c.on_resolve.describe}." if c.on_resolve else ""
        print(f"{c.id} [{c.area}, {c.severity}{', ' + c.catalogue if c.catalogue else ''}]")
        print(f"  {c.means}")
        print(f"  Reads: {c.reads}. Threshold: {c.threshold}{fix}{hook}")
    if args.json:
        print(json.dumps([{"id": c.id, "area": c.area, "name": c.name, "means": c.means, "severity": c.severity,
                           "reads": c.reads, "threshold": c.threshold, "fix": c.fix.describe if c.fix else None,
                           "catalogue": c.catalogue, "owner": c.owner, "urgent": c.urgent}
                          for c in checks_mod.all_checks()], indent=1))
    return 0


def _incident(store: Store, ref: Optional[str]) -> dict:
    if not ref:
        raise SystemExit("--incident ID (an incident id, its first 8 characters, or a check id) is required")
    inc = store.get(ref)
    if not inc:
        raise SystemExit(f"no incident {ref}; guardian.py report lists the open ones")
    return inc


def cmd_ai_brief(args: argparse.Namespace) -> int:
    cfg, db, host, store, log = _setup(args)
    store.load()
    inc = _incident(store, args.incident)
    check = checks_mod.by_id().get(inc["check_id"])
    path = ai_mod.write_brief(cfg.home, inc, ai_mod.brief(inc, check))
    print(path)
    return 0


def cmd_ai_fix(args: argparse.Namespace) -> int:
    cfg, db, host, store, log = _setup(args)
    if cfg.remote:
        raise SystemExit("ai-fix runs on the machine that holds the clone, not over ssh")
    if cfg.mode != "fix" and not args.dry_run:
        raise SystemExit("ai-fix runs only in --mode fix: report-only never changes anything, the AI fixer included")
    store.load()
    inc = _incident(store, args.incident)
    check = checks_mod.by_id().get(inc["check_id"])
    tried = [a for a in inc.get("fix_attempts") or [] if a.get("fix") == "ai-fix"]
    last = parse_time(tried[-1]["at"]) if tried else None
    if last and (now_utc() - last).total_seconds() < 86400 and not args.force:
        print(f"ai-fix already ran for this incident at {tried[-1]['at']}; --force runs it again")
        return 0
    # Up to an hour of work, done without the state lock so the 5-minute scans go on.
    ok, detail = ai_mod.ai_fix(cfg, inc, check, dry_run=args.dry_run, github_token=cfg.keys.get("GITHUB_TOKEN"))
    print(detail)
    if not args.dry_run:
        with StateLock(cfg.home) as locked:
            if not locked:
                log(f"ai-fix on {inc['check_id']}: {detail} (not recorded: the state lock stayed taken)")
                return 0 if ok else 3
            store.load()              # what the scans wrote meanwhile, not the copy from an hour ago
            fresh = store.get(inc["id"])
            if fresh is not None:
                store.record_attempt(fresh, {"at": now_utc().isoformat(), "fix": "ai-fix", "ok": ok, "detail": detail})
                store.flush()
                try:
                    store.save()
                except OSError as e:
                    log(f"could not save the ai-fix attempt: {e}")
        log(f"ai-fix on {inc['check_id']} ({inc['id'][:8]}): {detail}")
    return 0 if ok else 3


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="guardian.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)

    def flags(p: argparse.ArgumentParser, sub: bool) -> None:
        d = (lambda v: argparse.SUPPRESS) if sub else (lambda v: v)
        p.add_argument("--mode", choices=config_mod.MODES, default=d(None), help="report-only (default) or fix")
        p.add_argument("--dry-run", action="store_true", default=d(False), help="no Supabase writes, no Slack")
        p.add_argument("--quiet", action="store_true", default=d(False))
        p.add_argument("--json", action="store_true", default=d(False))
        p.add_argument("--only", default=d(None), help="comma-separated check ids")
        p.add_argument("--state-dir", default=d(None), help="the guardian's folder (default ~/.cockpit-guardian)")

    flags(ap, False)
    common = argparse.ArgumentParser(add_help=False)
    flags(common, True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("scan", "fix", "run", "doctor", "checks"):
        sub.add_parser(name, parents=[common])
    rp = sub.add_parser("report", parents=[common])
    rp.add_argument("--post", action="store_true")
    rp.add_argument("--force", action="store_true")
    for name in ("ai-brief", "ai-fix"):
        p = sub.add_parser(name, parents=[common])
        p.add_argument("--incident", required=True)
        if name == "ai-fix":
            p.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    if not hasattr(args, "force"):
        args.force = False
    handlers = {
        "scan": lambda a: cmd_scan(a, fix=False),
        "run": lambda a: cmd_scan(a, fix=True),
        "fix": cmd_fix,
        "report": cmd_report,
        "doctor": cmd_doctor,
        "checks": cmd_checks,
        "ai-brief": cmd_ai_brief,
        "ai-fix": cmd_ai_fix,
    }
    return handlers[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
