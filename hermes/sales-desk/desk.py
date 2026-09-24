#!/usr/bin/env python3
"""Sales desk: proposals drafted from demo calls, and the calls indexed per rep.

    python3 desk.py doctor [--offline]      every key by name, each service, each blocker in a sentence
    python3 desk.py requests [--limit N]    draft (or rebuild) the proposals the cockpit asked for
    python3 desk.py recordings [--days N]   index Fathom's sales calls and match them to leads
    python3 desk.py calls-vault [--dry]     copy every sales call in the Obsidian vault in, transcripts too
    python3 desk.py status                  the queue, the last proposals, the last runs
    python3 desk.py offer-sync              offer.json into the cockpit's proposal form (requests does it too)

and three that write nothing to the database, for trying the engine by hand:

    python3 desk.py validate DEAL.json [--transcript CALL.txt] [--send] [--skip-render]
    python3 desk.py build DEAL.json [--out DIR] [--pdf]
    python3 desk.py draft (--transcript CALL.txt | --recording ID) [--lang ar] [--company NAME]
                          [--offer '{"payment": "two_payments", "guarantee": false}'] [--out DIR]

Standard library, plus Playwright for the PDF when it is installed. Keys are
read by name and never printed. The engine is Mahara-B2B's proposals/ brought
into this repo and run under our own keys (Aziz, 2026-09-24).
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from desk import build as build_mod  # noqa: E402
from desk import calls_vault as calls_vault_mod  # noqa: E402
from desk import engine as engine_mod  # noqa: E402
from desk import fathom as fathom_mod  # noqa: E402
from desk import http  # noqa: E402
from desk import model as model_mod  # noqa: E402
from desk import offer as offer_mod  # noqa: E402
from desk import prompt as prompt_mod  # noqa: E402
from desk import queue as queue_mod  # noqa: E402
from desk import recordings as recordings_mod  # noqa: E402
from desk import render as render_mod  # noqa: E402
from desk import validate as validate_mod  # noqa: E402
from desk.config import DEFAULT_MODELS, WORKER, Config, key  # noqa: E402
from desk.errors import NotNow, Refused  # noqa: E402
from desk.log import Logger  # noqa: E402
from desk.supabase import TABLES, Supabase, SupabaseError  # noqa: E402


def _print(obj: Any, as_json: bool) -> None:
    if as_json or not isinstance(obj, str):
        print(json.dumps(obj, ensure_ascii=False, indent=1, default=str))
    else:
        print(obj)


def _sb(cfg: Config) -> Supabase:
    if not cfg.supabase_configured:
        raise SupabaseError("DESK_SUPABASE_URL and DESK_SUPABASE_KEY are not set (~/.editor-desk/env)")
    return Supabase(cfg.supabase_url, cfg.supabase_key, bucket=cfg.bucket)


def _status(cfg: Config, log: Logger, job: str, ok: bool, detail: str) -> None:
    """Every run says how it went, where the cockpit can see it."""
    try:
        _sb(cfg).worker_status(WORKER, job, ok, detail)
    except (SupabaseError, http.HttpError) as e:
        log.warn(f"worker status not written: {http.scrub(str(e))[:200]}")


# ---------------------------------------------------------------------------


def cmd_doctor(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    rows: list[dict[str, Any]] = []

    def add(name: str, ok: Optional[bool], detail: str, required: bool = False) -> None:
        rows.append({"check": name, "ok": ok, "detail": detail, "required": required})

    add("python", sys.version_info >= (3, 9), sys.version.split()[0], True)
    for label, path in (("SKILL.md", prompt_mod.SKILL_FILE), ("PATTERNS.md", prompt_mod.PATTERNS_FILE),
                        ("template", build_mod.TEMPLATE), ("logo", build_mod.ASSETS / "mahara-logo.png")):
        add(label, path.is_file(), "present" if path.is_file() else f"missing: {path} is not in the clone", True)
    if build_mod.TEMPLATE.is_file() and not build_mod.DATA_BLOCK.search(build_mod.TEMPLATE.read_text(encoding="utf-8")):
        add("template", False, "the @data-start / @data-end markers are gone, so no deal can be put into it", True)

    offer = None
    try:
        offer = offer_mod.load()
        options = list((offer.get("payment") or {}).get("options") or {})
        for option in options:
            offer_mod.resolve(offer, {"payment": option})
        r = offer_mod.resolve(offer, {})
        add("offer.json", True, f"{offer_mod.money(r['price'])} over {offer_mod.months_words(r['months'])}, "
                                f"payment options {', '.join(options)}, guarantee "
                                f"{'on' if r['guarantee'] else 'off'} unless the closer says otherwise", True)
    except Refused as e:
        add("offer.json", False, str(e), True)

    # By name only. A value is never printed, not even its length.
    for name in ("DESK_SUPABASE_URL", "DESK_SUPABASE_KEY", "FATHOM_API_KEY",
                 "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"):
        add(name, bool(key(name)) or None, "set" if key(name) else "not set")
    add("model", True, f"SALES_MODEL_PROVIDER={cfg.provider}, SALES_PROPOSAL_MODEL={cfg.model}"
                       + ("" if cfg.model != DEFAULT_MODELS.get(cfg.provider) else " (the default)"))

    p = None
    try:
        p = model_mod.provider(cfg, log.info)
        add("model key", True, f"{model_mod.KEY_NAMES[cfg.provider]} set for {cfg.provider}", True)
    except NotNow as e:
        add("model key", False, str(e), True)

    refs = sorted(cfg.reference_dir.glob("*.json")) if cfg.reference_dir.is_dir() else []
    if refs:
        kinds = []
        for f in refs:
            try:
                kinds.append(f"{f.name} ({prompt_mod.variant_of(json.loads(f.read_text(encoding='utf-8')))})")
            except (OSError, ValueError):
                kinds.append(f"{f.name} (unreadable)")
        add("reference deals", True, ", ".join(kinds))
    else:
        add("reference deals", None, f"none in {cfg.reference_dir}: the drafter works from the rules and the "
                                     "template's outline, and every proposal's notes say so. extract_reference.py "
                                     "makes one from a finished proposal")

    engine = render_mod.engine()
    if engine == "playwright":
        add("playwright", True, "installed: PDFs are printed and every draft is measured for overflow")
    elif engine == "chrome one-shot":
        add("playwright", None, "not installed, so Chrome's one-shot flags are used: they work on a laptop and hang "
                                "on the VPS (render.py). On the VPS: pip install --user playwright")
    else:
        add("playwright", None, "no browser at all: the HTML is still made, but the PDF is skipped and overflow is "
                                "not measured, so nothing is tightened. Install Playwright and Chrome")

    try:
        cfg.ensure_dirs()
        probe = cfg.out_dir / ".probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        add("working files", True, str(cfg.out_dir))
    except OSError as e:
        add("working files", False, f"{cfg.out_dir} cannot be written: {e}", True)

    if not args.offline:
        if cfg.supabase_configured:
            sb = _sb(cfg)
            bad = []
            for table in TABLES:
                try:
                    sb.select(table, "select=*&limit=1")
                except (http.HttpError, SupabaseError) as e:
                    bad.append(f"{table} ({http.scrub(str(e))[:80]})")
            add("supabase tables", not bad, f"all {len(TABLES)} answer" if not bad else
                "these do not answer, so the migration 20260924a_sales_cockpit.sql is not applied: " + "; ".join(bad), True)
            try:
                b = sb.bucket_info()
                private = b.get("public") is False
                add("bucket", True if private else None,
                    f"{cfg.bucket} exists and is private" if private else
                    f"{cfg.bucket} exists but is PUBLIC: a proposal carries a client's numbers; make it private")
            except http.HttpError as e:
                add("bucket", False, f"the {cfg.bucket} bucket does not answer ({e.status}), so no file can be "
                                     "stored: apply 20260924b_sales_proposal_files.sql", True)
            try:
                with_fathom = [x for x in sb.people() if x.get("fathom_email")]
                add("reps in Fathom", True if with_fathom else None,
                    f"{len(with_fathom)} seat(s) carry a fathom_email and are asked for by name" if with_fathom else
                    "no seat carries a fathom_email yet, so only the key owner's own calls are indexed")
            except (http.HttpError, SupabaseError):
                pass
        else:
            add("supabase", False, "DESK_SUPABASE_URL and DESK_SUPABASE_KEY are not set, so nothing can be read "
                                   "or written; source ~/.editor-desk/env", True)

        if p is not None:
            try:
                add("model answers", True, p.ping(), True)
            except NotNow as e:
                add("model answers", False, str(e), True)
            except model_mod.ModelError as e:
                add("model answers", False, f"{cfg.provider} did not answer a one-token call: {e}", True)
            try:
                ids = p.models()
                if cfg.model in ids:
                    add("model listed", True, f"{cfg.model} is one of the {len(ids)} models this key can use")
                else:
                    usable = [i for i in ids if i.startswith(("gpt-4.1", "gpt-5", "o3", "o4", "claude-", "openai/gpt-5"))]
                    add("model listed", False, f"{cfg.model} is not among the models this key can use. Set "
                                               "SALES_PROPOSAL_MODEL to one of: " + ", ".join(usable[:20] or ids[:20]), True)
            except (NotNow, model_mod.ModelError) as e:
                add("model listed", None, f"the model list could not be read: {e}")
            if getattr(p, "name", "") == "openai":
                streams = p.stream_check()
                if streams is False:
                    add("model streams", None, "OpenAI will not stream this model to this organisation; drafts ask "
                                               "without streaming and wait for the whole answer instead")
                elif streams:
                    add("model streams", True, "streaming works, so a long draft is timed by its silences")

        if cfg.fathom_key:
            try:
                from datetime import datetime, timedelta, timezone
                f = fathom_mod.Fathom(cfg.fathom_key, pace=cfg.fathom_pace, log=log.info)
                d = f.get("/meetings", [("created_after", (datetime.now(timezone.utc) - timedelta(days=7))
                                         .replace(microsecond=0).isoformat().replace("+00:00", "Z"))])
                add("fathom", True, f"answers: {len(d.get('items') or [])} calls in the last week on the first page", True)
            except fathom_mod.FathomError as e:
                add("fathom", False, f"Fathom did not answer: {e}", True)
        else:
            add("fathom", False, "FATHOM_API_KEY is not set, so no call can be read and nothing can be drafted", True)

        if engine == "playwright":
            with tempfile.TemporaryDirectory() as tmp:
                page = Path(tmp) / "probe.html"
                page.write_text("<!doctype html><title>probe</title><p>ok</p>", encoding="utf-8")
                ok = bool(render_mod.dom(page))
                add("render", ok or None, "Chrome renders a page through Playwright" if ok else
                    "Playwright is installed but could not render a page: run python3 -m playwright install "
                    "chromium, or set CHROME_PATH to a Chrome this user can run")

    blockers = [r for r in rows if r["required"] and r["ok"] is False]
    if args.json:
        _print({"checks": rows, "blockers": [b["detail"] for b in blockers]}, True)
    else:
        for r in rows:
            mark = {True: "OK ", False: "-- ", None: "?? "}[r["ok"]]
            print(f"{mark} {r['check']:<18} {r['detail']}")
        print()
        if blockers:
            print("blocked:")
            for b in blockers:
                print(f"  {b['detail']}")
        else:
            print("ready")
    if not args.offline:
        _status(cfg, log, "doctor", not blockers,
                "ready" if not blockers else "blocked: " + " | ".join(b["detail"] for b in blockers))
    return 1 if blockers else 0


def cmd_requests(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Carry out what the cockpit asked for. Quiet when nothing is queued."""
    sb = _sb(cfg)
    render_mod.set_timeout(cfg.render_timeout)
    try:
        out = queue_mod.run_requests(cfg, log.info, sb, limit=args.limit, warn=log.warn)
    except Refused as e:  # offer.json itself could not be read
        _status(cfg, log, "requests", False, str(e))
        log.error(str(e))
        return 1
    busy = out["seen"] or out["reaped"]
    if out.get("blocked"):
        detail = f"waiting: {out['blocked']}"
    elif not busy:
        detail = "nothing queued"
    else:
        done = ", ".join(f"{n} {s.replace('_', ' ')}" for s, n in sorted(out["statuses"].items()))
        detail = (f"{out['done']} done ({done or 'none'}), {out['retry']} to try again, {out['failed']} failed"
                  + (f", {out['reaped']} reaped" if out["reaped"] else ""))
    _status(cfg, log, "requests", not out.get("blocked") and not out["failed"], detail)
    if busy or args.json:
        log.info(f"requests: {detail}")
        _print(out, args.json)
    return 1 if out.get("blocked") else 0


def cmd_recordings(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    sb = _sb(cfg)
    try:
        fathom = queue_mod.fathom_client(cfg, log.info)
        out = recordings_mod.index(sb, fathom, log.info, days=args.days or cfg.recordings_days)
    except (NotNow, fathom_mod.FathomError) as e:
        _status(cfg, log, "recordings", False, str(e))
        log.error(str(e))
        return 1
    detail = (f"{out['indexed']} sales calls in the last {out['days']} days, {out['by_email']} matched by email, "
              f"{out['by_appointment']} by appointment, {out['unmatched']} unmatched"
              + (f"; could not read {', '.join(out['reps_unread'])}" if out["reps_unread"] else ""))
    _status(cfg, log, "recordings", not out["reps_unread"], detail)
    _print(out if args.json else detail, args.json)
    return 0


def cmd_calls_vault(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Copy every sales call in the Obsidian vault into the cockpit."""
    sb = _sb(cfg)
    vault = Path(args.vault or key("SALES_VAULT", "/opt/data/obsidian-sync-vault")).expanduser()
    try:
        out = calls_vault_mod.run(
            sb, vault, log.info, dry=args.dry,
            upload=lambda path, blob: sb.upload_to(calls_vault_mod.TRANSCRIPT_BUCKET, path, blob,
                                                   "text/markdown; charset=utf-8"),
        )
    except FileNotFoundError as e:
        _status(cfg, log, "calls-vault", False, str(e))
        log.error(str(e))
        return 1
    if not out.get("notes"):
        detail = "the vault has no sales notes"
    else:
        detail = (f"{out['rows']} sales calls from the vault ({out['first'] or '?'}"
                  f" to {out['last'] or '?'}), {out['by_email']} matched by email, "
                  f"{out['by_appointment']} by appointment, {out['unmatched']} unmatched, "
                  f"{out['transcripts_uploaded']} transcripts uploaded")
    if not args.dry:
        _status(cfg, log, "calls-vault", bool(out.get("notes")), detail)
    _print(out if args.json else detail, args.json)
    return 0


def cmd_status(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    sb = _sb(cfg)
    queue = sb.select("cockpit_sales_requests", "select=id,kind,contact_id,params,status,requested_by,requested_at,"
                                                "claimed_at,claimed_by,attempts,error"
                                                "&kind=eq.proposal&status=in.(queued,running)&order=requested_at.asc&limit=50")
    recent = sb.select("cockpit_sales_proposals", "select=id,contact_id,status,variant,fill_count,model,lang,"
                                                  "updated_at,error&order=updated_at.desc&limit=10")
    runs = sb.select("cockpit_sales_worker_status", f"select=job,ok,detail,at&worker=eq.{WORKER}&order=job.asc")
    if args.json:
        _print({"queue": queue, "proposals": recent, "runs": runs}, True)
    else:
        print(f"Queue: {sum(1 for r in queue if r['status'] == 'queued')} queued, "
              f"{sum(1 for r in queue if r['status'] == 'running')} running")
        for r in queue:
            kind = "rebuild" if (r.get("params") or {}).get("rebuild") else "draft"
            print(f"  {str(r['id'])[:8]}  {r['status']:<8} {kind:<8} contact {r.get('contact_id') or '-':<22} "
                  f"asked {str(r.get('requested_at') or '')[:16]}  try {r.get('attempts') or 0}"
                  + (f"  {str(r['error'])[:90]}" if r.get("error") else ""))
        print("Last proposals:")
        for r in recent:
            print(f"  {str(r['id'])[:8]}  {r['status']:<12} {str(r.get('variant') or '-'):<9} "
                  f"{r.get('fill_count') if r.get('fill_count') is not None else '-':>3} to fill  "
                  f"{str(r.get('model') or '-'):<22} {str(r.get('updated_at') or '')[:16]}"
                  + (f"  {str(r['error'])[:90]}" if r.get("error") else ""))
        print("Last runs:")
        for r in runs:
            print(f"  {r['job']:<11} {'ok' if r.get('ok') else 'NOT OK':<7} {str(r.get('at') or '')[:16]}  {r.get('detail') or ''}")
    _status(cfg, log, "status", True, f"{len(queue)} request(s) open")
    return 0


def cmd_offer_sync(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """The cockpit's proposal form reads its choices from the `offer` setting;
    this writes it from offer.json, so the file stays the one source."""
    sb = _sb(cfg)
    current = offer_mod.load()
    wrote = queue_mod.sync_offer(sb, current, log.info)
    value = offer_mod.cockpit_setting(current)
    detail = ("written: " if wrote else "already current: ") + ", ".join(p["key"] for p in value["payments"])
    _status(cfg, log, "offer-sync", True, detail)
    _print(value if args.json else detail, args.json)
    return 0


# ---- the local tools: nothing is written to the database -------------------


def _render_and_check(deal: dict[str, Any], transcript: Optional[str], out_dir: Path, *, skip_render: bool,
                      name: str = "proposal.html") -> tuple[validate_mod.Result, Path]:
    html_path = build_mod.build(deal, out_dir / name)
    dom = None if skip_render else render_mod.dom(html_path)
    result = validate_mod.validate(deal, transcript, dom=dom, engine="skipped" if skip_render else render_mod.engine())
    return result, html_path


def cmd_validate(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    deal = json.loads(Path(args.deal).read_text(encoding="utf-8"))
    transcript = Path(args.transcript).read_text(encoding="utf-8", errors="replace") if args.transcript else None
    with tempfile.TemporaryDirectory() as tmp:
        result, _html = _render_and_check(deal, transcript, Path(tmp), skip_render=args.skip_render)
    where = "no call" if deal.get("variant") == "blind" else (args.transcript or "no transcript given")
    print(f"{Path(args.deal).name}   evidence: {where}   variant: {deal.get('variant') or 'specific'}\n")
    print(result.text(send=args.send))
    print()
    failed = result.failed(send=args.send)
    print("Not ready to send." if failed else ("Ready to send." if args.send else "Ready for the closer to review."))
    return 1 if failed else 0


def cmd_build(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    deal = json.loads(Path(args.deal).read_text(encoding="utf-8"))
    out_dir = Path(args.out or Path(args.deal).resolve().parent)
    html_path = build_mod.build(deal, out_dir / (Path(args.deal).stem + ".html"))
    print("wrote", html_path)
    if args.pdf:
        pdf_path = html_path.with_suffix(".pdf")
        if render_mod.pdf(html_path, pdf_path):
            print("wrote", pdf_path)
        else:
            print(f"The PDF was skipped: no browser here could print it ({render_mod.engine()}). "
                  "Open the HTML and print it, or install Playwright.")
            return 1
    return 0


def cmd_draft(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """The whole engine on one call, by hand. Reads Fathom when given a
    recording id; writes only into --out."""
    offer = offer_mod.load()
    resolved = offer_mod.resolve(offer, json.loads(args.offer) if args.offer else None)
    if args.transcript:
        text = Path(args.transcript).read_text(encoding="utf-8", errors="replace")
    else:
        fathom = queue_mod.fathom_client(cfg, log.info)
        text = fathom_mod.flatten(fathom.transcript(args.recording))
    call = engine_mod.Call(transcript_text=text, recording_id=args.recording or "", closer=args.closer or "",
                           client_name=args.name, client_company=args.company, client_country=args.country)
    out_dir = Path(args.out or (cfg.out_dir / "by-hand"))
    render_mod.set_timeout(cfg.render_timeout)
    outcome = engine_mod.run(call, lang=args.lang, resolved=resolved, offer=offer, p=model_mod.provider(cfg, log.info),
                             cfg=cfg, log=log.info, workdir=out_dir, variant=args.variant)
    final = out_dir / "proposal.html"
    build_mod.build(outcome.deal, final)
    print(f"variant {outcome.variant} ({outcome.why}); {outcome.model}; {outcome.seconds:.0f}s; "
          f"{outcome.rounds} tightening round(s)")
    for note in outcome.notes:
        print("note:", note)
    print(outcome.result.text())
    print(f"\n{outcome.result.status()}: {out_dir / 'deal.json'} and {final}")
    return 0 if outcome.result.ok else 1


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="desk.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="machine readable output")
    ap.add_argument("--quiet", action="store_true", help="only warnings and errors on stderr")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("doctor"); d.add_argument("--offline", action="store_true")
    rq = sub.add_parser("requests"); rq.add_argument("--limit", type=int)
    rc = sub.add_parser("recordings"); rc.add_argument("--days", type=int)
    cv = sub.add_parser("calls-vault"); cv.add_argument("--vault"); cv.add_argument("--dry", action="store_true")
    sub.add_parser("status")
    sub.add_parser("offer-sync")
    v = sub.add_parser("validate"); v.add_argument("deal"); v.add_argument("--transcript")
    v.add_argument("--send", action="store_true"); v.add_argument("--skip-render", action="store_true")
    b = sub.add_parser("build"); b.add_argument("deal"); b.add_argument("--out"); b.add_argument("--pdf", action="store_true")
    dr = sub.add_parser("draft")
    src = dr.add_mutually_exclusive_group(required=True)
    src.add_argument("--transcript"); src.add_argument("--recording")
    dr.add_argument("--lang", choices=["ar", "en"], default="ar")
    dr.add_argument("--company"); dr.add_argument("--name"); dr.add_argument("--country"); dr.add_argument("--closer")
    dr.add_argument("--offer", help="the closer's choice as JSON, e.g. '{\"payment\": \"pif\", \"guarantee\": true}'")
    dr.add_argument("--variant", choices=["specific", "general", "blind"], help="skip the gate and force one")
    dr.add_argument("--out")

    args = ap.parse_args(argv)
    cfg = Config.from_env()
    cfg.ensure_dirs()
    log = Logger(quiet=args.quiet)
    handlers: dict[str, Callable[[Config, argparse.Namespace, Logger], int]] = {
        "doctor": cmd_doctor, "requests": cmd_requests, "recordings": cmd_recordings, "status": cmd_status,
        "calls-vault": cmd_calls_vault,
        "validate": cmd_validate, "build": cmd_build, "draft": cmd_draft, "offer-sync": cmd_offer_sync,
    }
    try:
        return handlers[args.cmd](cfg, args, log)
    except (SupabaseError, http.HttpError, NotNow, Refused) as e:
        log.error(http.scrub(str(e))[:400])
        if args.cmd in ("requests", "recordings", "status", "offer-sync", "calls-vault"):
            _status(cfg, log, args.cmd, False, http.scrub(str(e))[:400])
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
