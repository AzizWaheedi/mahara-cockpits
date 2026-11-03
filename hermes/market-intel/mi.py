#!/usr/bin/env python3
"""Market research for new clients (hermes/market-intel). MI-1: dark, shadow only.

  python3 mi.py doctor                      every key by name, Supabase, Apify, ScrapeCreators, the engine
  python3 mi.py pending [--dry-run]         the cron: scan for new answers, claim one run, research it
  python3 mi.py scan                        enqueue shadow runs for onboarding answers stored since install
  python3 mi.py run --task <id> --dry-run   the pull plan and its estimated cost; pulls nothing
  python3 mi.py shadow                      this month's runs, spend and outcomes (read only)
  python3 mi.py resend --run <id>           render a finished run again into its folder; no pulls, nothing sent
  python3 mi.py backfill --task <id> --note "<10 to 300 characters>"   queue a run for an older answer
  python3 mi.py prune [--days 180]          raw evidence bodies and run folders older than the days given

Keys are read by name (mi/config.py); nothing here prints a value. Nothing here publishes: no Doc, no card
field, no comment (MI-3 and MI-1b add those, behind the setting and MARKET_INTEL_APPLY).
"""
from __future__ import annotations

import argparse
import os
import shutil
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mi import config as config_mod  # noqa: E402
from mi import model, pipeline, plan, render  # noqa: E402
from mi.apify import Apify  # noqa: E402
from mi.config import Config  # noqa: E402
from mi.evidence import Pack  # noqa: E402
from mi.ledger import Ledger  # noqa: E402
from mi.meter import Meter  # noqa: E402
from mi.scrapecreators import ScrapeCreators  # noqa: E402
from mi.sources import web  # noqa: E402
from mi.store import RunFolder, prune_folders  # noqa: E402
from mi.supabase import Home, Supabase, SupabaseError  # noqa: E402

QUIET = False


def say(msg: str) -> None:
    if not QUIET:
        print(msg, flush=True)


def home_of(cfg: Config) -> Home:
    return Home(Supabase(cfg.keys.get(config_mod.SUPABASE_URL), cfg.keys.get(config_mod.SUPABASE_KEY)))


def ledger_for(home: Home, run_key: str) -> Ledger:
    return Ledger(home.ledger_row, run_key)


def deps_for(cfg: Config, home: Home, run_key: str) -> pipeline.Deps:
    ledger = ledger_for(home, run_key)
    _, apify_key = cfg.keys.first(config_mod.APIFY_KEYS)
    sc_key = cfg.keys.get(config_mod.SCRAPECREATORS_KEY)

    def make_apify(meter: Meter, known: dict[str, str], on_started: Callable[[str, str], None], started: int) -> Apify:
        return Apify(apify_key, ledger, meter, max_runs=cfg.apify_max_runs, concurrency=cfg.apify_concurrency,
                     timeout_sec=cfg.apify_timeout_sec, poll_sec=cfg.apify_poll_sec, known_runs=known,
                     on_started=on_started, runs_started=started)

    def make_sc(meter: Meter) -> Optional[ScrapeCreators]:
        return ScrapeCreators(sc_key, ledger, meter) if sc_key else None

    return pipeline.Deps(home=home, ledger=ledger, engine=model.engine(cfg, ledger), fetcher=web.Fetcher(ledger),
                         make_apify=make_apify, make_sc=make_sc)


# ---- doctor ------------------------------------------------------------------------------------------------------

def doctor(cfg: Config, home: Optional[Home] = None, deps: Optional[pipeline.Deps] = None) -> int:
    blockers, lines = 0, []

    def line(level: str, text: str) -> None:
        nonlocal blockers
        if level == "BLOCKER":
            blockers += 1
        lines.append(f"{level:8} {text}")

    k = cfg.keys
    for name in (config_mod.SUPABASE_URL, config_mod.SUPABASE_KEY):
        line("ok" if k.has(name) else "BLOCKER", f"{name} {'is set' if k.has(name) else 'is not set'}")
    apify_name, apify_key = k.first(config_mod.APIFY_KEYS)
    line("ok" if apify_key else "BLOCKER", f"{apify_name} {'is set' if apify_key else 'is not set (MARKET_INTEL_APIFY_KEY, else APIFY_API_KEY)'}")
    if apify_name == "APIFY_API_KEY" and apify_key:
        line("warn", "Research uses the radar's Apify key (APIFY_API_KEY); its Starter credit is shared. Set "
                     "MARKET_INTEL_APIFY_KEY for a key of its own.")
    line("ok" if k.has(config_mod.SCRAPECREATORS_KEY) else "warn",
         f"{config_mod.SCRAPECREATORS_KEY} " + ("is set" if k.has(config_mod.SCRAPECREATORS_KEY) else
                                               "is not set: Meta ads fall back to Apify and followers have one source"))
    line("info", f"{config_mod.GOOGLE_KEY_FILE} and {config_mod.TEMPLATE_DOC}: needed when publishing starts (MI-3), "
                 "not in shadow")
    line("info", f"{config_mod.FOREPLAY_KEY}: optional, not used in this release")
    env_file = cfg.home / "env"
    if env_file.exists():
        mode = stat.S_IMODE(env_file.stat().st_mode)
        line("ok" if mode & 0o077 == 0 else "warn", f"{env_file} has mode {oct(mode)}" + ("" if mode & 0o077 == 0 else "; set it to 600"))
    else:
        line("warn", f"{env_file} does not exist; keys come from the environment and the Hermes key files")
    try:
        cfg.runs_dir.mkdir(parents=True, exist_ok=True)
        line("ok", f"the run folder {cfg.runs_dir} is writable")
    except OSError as e:
        line("BLOCKER", f"the run folder {cfg.runs_dir} cannot be made: {e.strerror}")

    if k.has(config_mod.SUPABASE_URL) and k.has(config_mod.SUPABASE_KEY):
        try:
            home = home or home_of(cfg)
            s = home.settings()
            line("ok", f"Supabase answers; market_intel is {'on' if s.get('on') else 'off'}, mode {s.get('mode')}, caps "
                       f"USD {s.get('usd_cap_run')} a run and USD {s.get('usd_cap_month')} a month (this worker's own: "
                       f"{cfg.usd_cap_run} and {cfg.usd_cap_month}; the lower wins)")
            m = home.month_usd()
            line("ok" if m is not None else "BLOCKER",
                 f"this month's research spend: USD {m:.2f}" if m is not None else "this month's spend cannot be read")
        except SupabaseError as e:
            line("BLOCKER", f"Supabase: {e} (is 20261103i applied?)")
    if deps is None and home is not None:
        try:
            deps = deps_for(cfg, home, "market-intel:doctor")
        except model.ModelUnreachable as e:
            line("BLOCKER", e.sentence)
    if apify_key and deps is not None:
        try:
            meter = Meter(cap_run=0, cap_month=0, month_before=0)
            a = deps.make_apify(meter, {}, lambda *_: None, 0)
            me = a.me()
            lim = a.limits()
            used = float(((lim.get("current") or {}).get("monthlyUsageUsd")) or 0)
            cap = float(((lim.get("limits") or {}).get("maxMonthlyUsageUsd")) or 0)
            share = used / cap if cap else None
            line("ok" if share is None or share < 0.8 else "warn",
                 f"Apify answers (plan {((me.get('plan') or {}).get('id')) or 'unknown'}); this month USD {used:.2f}"
                 + (f" of USD {cap:.2f}" if cap else ""))
        except Exception as e:  # noqa: BLE001
            line("BLOCKER", f"Apify refused the key or did not answer: {str(e)[:120]}")
    if k.has(config_mod.SCRAPECREATORS_KEY) and deps is not None:
        try:
            sc = deps.make_sc(Meter(cap_run=1, cap_month=1, month_before=0))
            bal = sc.credit_balance() if sc else None
            line("ok" if bal is None or bal >= 500 else "warn", f"ScrapeCreators answers; {bal if bal is not None else 'unknown'} credits left")
        except Exception as e:  # noqa: BLE001
            line("warn", f"ScrapeCreators did not answer: {str(e)[:120]}")
    if cfg.provider == "cli":
        found = shutil.which(cfg.claude_bin) or (cfg.claude_bin if os.path.exists(cfg.claude_bin) else None)
        line("ok" if found else "BLOCKER", f"the Claude CLI {'is at ' + found if found else '(' + cfg.claude_bin + ') is not installed'}")
        line("ok" if k.has(config_mod.CLAUDE_TOKEN) else "BLOCKER",
             f"{config_mod.CLAUDE_TOKEN} {'is set' if k.has(config_mod.CLAUDE_TOKEN) else 'is not set (the cli engine needs it)'}")
    try:
        eng = deps.engine if deps is not None else model.engine(cfg, Ledger(lambda r: None, "market-intel:doctor"))
        if eng is None:
            raise model.ModelUnreachable("No engine is configured.")
        said = eng.ping(cfg.model_pick)
        line("ok", f"the {cfg.provider} engine answers ({cfg.model_pick}): {said!r}")
    except model.ModelUnreachable as e:
        line("BLOCKER", e.sentence)
    except Exception as e:  # noqa: BLE001
        line("BLOCKER", f"the {cfg.provider} engine did not answer: {str(e)[:160]}")
    for l in lines:
        print(l)
    print(f"{blockers} blocker(s)." if blockers else "No blocker.")
    return 1 if blockers else 0


# ---- the cron ------------------------------------------------------------------------------------------------------

def pending(cfg: Config, home: Home, dry_run: bool = False,
            deps_factory: Optional[Callable[[str], pipeline.Deps]] = None) -> int:
    if dry_run:
        s = home.settings()
        queued = home.runs("select=id,task_id,reason,state,requested_at&state=in.(queued,claimed,pulling,picking,writing,checking,publishing)&order=requested_at&limit=10")
        print(f"market_intel is {'on' if s.get('on') else 'off'} (mode {s.get('mode')}).")
        print(f"{len(queued)} open run(s)." + "".join(f"\n  {r['id']} {r['task_id']} {r['reason']} {r['state']}" for r in queued))
        print("Dry run: nothing was claimed, pulled or written.")
        return 0
    try:
        scanned = home.scan(20)
        claim = home.claim(cfg.worker)
    except SupabaseError as e:
        say(f"Supabase did not answer: {e}")
        return 1
    if claim.get("off"):
        home.health(True, "Market research is off.", {"state": "off"})
        say(claim.get("sentence") or "Market research is off.")
        return 0
    if claim.get("busy") or claim.get("idle"):
        note = "A run is in progress." if claim.get("busy") else "Nothing to research."
        home.health(True, note, {"state": "busy" if claim.get("busy") else "idle", "enqueued": scanned.get("enqueued", 0)})
        say(note)
        return 0
    run_id = str(claim["runId"])
    try:
        deps = (deps_factory or (lambda key: deps_for(cfg, home, key)))(f"market-intel:{run_id}")
    except model.ModelUnreachable as e:
        home.release(run_id, str(claim["claim"]), e.sentence, pipeline.RETRY_MINUTES["model"], "outage")
        home.health(False, e.sentence, {"runId": run_id, "state": "released"})
        say(e.sentence)
        return 1
    started = datetime.now(timezone.utc)
    outcome = pipeline.run_once(cfg, deps, claim)
    ok = outcome.state in ("done", "lost")
    home.health(ok, outcome.sentence, {"runId": run_id, "state": outcome.state, "reason": claim.get("reason"),
                                       "mode": claim.get("mode"), "minutes": round((datetime.now(timezone.utc) - started).total_seconds() / 60, 1),
                                       **outcome.summary}, rows_seen=int(outcome.summary.get("sourcesN") or 0))
    say(outcome.sentence)
    return 0 if outcome.state in ("done", "lost", "released", "needs_person") else 1


def dry_run(cfg: Config, home: Home, task: str) -> int:
    try:
        inp = home.preview(task)
    except SupabaseError as e:
        print(str(e))
        return 1
    s = home.settings()
    est = plan.estimate(cfg, inp)
    cap_run = min(cfg.usd_cap_run, float(s.get("usd_cap_run") or cfg.usd_cap_run))
    cap_month = min(cfg.usd_cap_month, float(s.get("usd_cap_month") or cfg.usd_cap_month))
    for l in plan.lines(est, cap_run, cap_month, home.month_usd()):
        print(l)
    return 0


def shadow(cfg: Config, home: Home) -> int:
    now = datetime.now(timezone.utc)
    since = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")
    runs = home.runs(f"select=id,task_id,reason,mode,state,usd_apify,usd_scrapecreators,sources_n,competitors_n,"
                     f"sentence,requested_at,finished_at&requested_at=gte.{since}&order=requested_at.desc&limit=200")
    s = home.settings()
    by: dict[str, int] = {}
    for r in runs:
        by[r["state"]] = by.get(r["state"], 0) + 1
    spent = sum(float(r.get("usd_apify") or 0) + float(r.get("usd_scrapecreators") or 0) for r in runs)
    print(f"market_intel is {'on' if s.get('on') else 'off'}, mode {s.get('mode')}.")
    print(f"This month: {len(runs)} run(s)" + (f" ({', '.join(f'{v} {k}' for k, v in sorted(by.items()))})" if by else "")
          + f"; USD {spent:.2f} of USD {float(s.get('usd_cap_month') or 25):.2f} spent on scraping.")
    for r in runs[:5]:
        usd = float(r.get("usd_apify") or 0) + float(r.get("usd_scrapecreators") or 0)
        print(f"  {str(r['requested_at'])[:16]} {r['task_id']} {r['reason']} {r['state']}: "
              f"{r.get('competitors_n') if r.get('competitors_n') is not None else '[ ]'} competitors, "
              f"{r.get('sources_n') if r.get('sources_n') is not None else '[ ]'} sources, USD {usd:.2f}. {r.get('sentence') or ''}")
    return 0


def resend(cfg: Config, home: Home, run_id: str) -> int:
    """A finished run rendered again from its stored rows: no pulls, no model call, nothing sent."""
    rows = home.runs(f"select=id,task_id,mode,state&id=eq.{run_id}")
    if not rows:
        print("There is no research run with that ID.")
        return 1
    run = rows[0]
    found = {f["lang"]: f["findings"] for f in home.findings(run_id)}
    if "en" not in found or "ar" not in found:
        print("This run has no findings that passed the checks, so there is nothing to render. Run research again.")
        return 1
    pack = Pack([{"eid": e["eid"], "kind": e["kind"], "subject": e["subject"], "url": e.get("url"),
                  "retrievedAt": e.get("retrieved_at"), "source": e["source"], "usd": e.get("usd") or 0,
                  "body": e.get("body") or {}, "sha256": e["sha256"]} for e in home.evidence(run_id)])
    comps = [{"cid": c["cid"], "reserve": c["reserve"], "evidence": c.get("evidence") or [], "placeUrl": c.get("place_url")}
             for c in home.competitors(run_id)]
    facts = pipeline.compute_facts(pack, comps)
    inp = home.input(run_id)
    folder = RunFolder(cfg.runs_dir, run_id)
    presence = folder.read_json("presence.json") or {}
    not_checked = folder.read_json("not_checked.json") or []
    name = str((inp.get("answers") or {}).get("businessName") or (inp.get("card") or {}).get("name") or run["task_id"])
    common = dict(facts=facts, pack=pack, form_date=str(inp.get("formDate") or ""), presence=presence,
                  not_checked=not_checked, client_name=name)
    tabs = {"t.0": render.blocks(found["ar"], lang="ar", **common), "t.en": render.blocks(found["en"], lang="en", **common),
            "t.answers": render.answers_blocks(inp.get("tab") or [], str(inp.get("formDate") or ""), name)}
    folder.write_text("report.ar.md", render.text_of(tabs["t.0"]))
    folder.write_text("report.en.md", render.text_of(tabs["t.en"]))
    folder.write_text("report.answers.md", render.text_of(tabs["t.answers"]))
    folder.write_json("docs-requests.json", {t: render.docs_requests(t, bl, rtl=t == "t.0") for t, bl in tabs.items()})
    print(f"Rendered again into {folder.path}. Nothing was sent: publishing comes with MI-3.")
    return 0


def backfill(cfg: Config, home: Home, task: str, note: str) -> int:
    response = home.latest_response(task)
    if not response:
        print("This client has no onboarding answer to research yet.")
        return 1
    who = f"mi.py backfill ({os.environ.get('USER') or 'operator'})"
    out = home.enqueue(task, response, "backfill", who, note)
    print(f"Queued run {out['runId']}. It runs when market research is on." if out.get("ok") and not out.get("reused")
          else (out.get("sentence") or "Already queued."))
    return 0 if out.get("ok") else 1


def prune(cfg: Config, home: Home, days: int) -> int:
    out = home.prune(days)
    n = prune_folders(cfg.runs_dir, days)
    print(f"Pruned {out.get('pruned', 0)} evidence bodies and {n} run folder(s) older than {out.get('days', days)} days.")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    global QUIET
    ap = argparse.ArgumentParser(prog="mi.py", description="Market research for new clients (MI-1, shadow).")
    ap.add_argument("--quiet", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor")
    p = sub.add_parser("pending")
    p.add_argument("--dry-run", action="store_true")
    sub.add_parser("scan")
    p = sub.add_parser("run")
    p.add_argument("--task", required=True)
    p.add_argument("--dry-run", action="store_true")
    sub.add_parser("shadow")
    p = sub.add_parser("resend")
    p.add_argument("--run", required=True)
    p = sub.add_parser("backfill")
    p.add_argument("--task", required=True)
    p.add_argument("--note", required=True)
    p = sub.add_parser("prune")
    p.add_argument("--days", type=int, default=180)
    args = ap.parse_args(argv)
    QUIET = args.quiet
    cfg = config_mod.load()
    if args.cmd == "doctor":
        return doctor(cfg)
    if args.cmd == "run" and not args.dry_run:
        print("A real run starts from the queue: use backfill --task <id> --note \"...\", then pending runs it. "
              "Add --dry-run to see the plan and its cost.")
        return 2
    try:
        home = home_of(cfg)
    except SupabaseError as e:
        print(str(e))
        return 1
    if args.cmd == "pending":
        return pending(cfg, home, args.dry_run)
    if args.cmd == "scan":
        out = home.scan(20)
        print(out.get("sentence") or f"{out.get('enqueued', 0)} run(s) queued, {out.get('waiting', 0)} waiting for an open run to end.")
        return 0
    if args.cmd == "run":
        return dry_run(cfg, home, args.task)
    if args.cmd == "shadow":
        return shadow(cfg, home)
    if args.cmd == "resend":
        return resend(cfg, home, args.run)
    if args.cmd == "backfill":
        return backfill(cfg, home, args.task, args.note)
    if args.cmd == "prune":
        return prune(cfg, home, args.days)
    return 2


if __name__ == "__main__":
    sys.exit(main())
