#!/usr/bin/env python3
"""Ideation radar: outlier scans and link captures for the creative director.

    python3 radar.py doctor                     check keys, binaries, services
    python3 radar.py scan [--dry-run] [--platform tiktok] [--only handle]
    python3 radar.py capture <url> [<url>...] [--by email] [--note ...] [--industry ours|other]
    python3 radar.py pending [--limit 10]       capture links pasted in the cockpit
    python3 radar.py watchlist list|add|remove  manage the accounts and hashtags
    python3 radar.py digest                     print the last scan's digest
    python3 radar.py resend                     after an outage: push the last scan and every captured idea again
    python3 radar.py requests [--limit 3]       run the scrapes the cockpit asked for (pages and ad libraries); pending runs them too
    python3 radar.py trends                     describe, embed and cluster the recent rows into trends (the scan does this too)
    python3 radar.py speechtest <url> [<url>...] compare ElevenLabs Scribe, Whisper and Gemini on real clips (Arabic dialects)

Standard library only. Keys are read by name from the environment or the
Hermes key files; nothing is ever printed. Exit code is non-zero when a
scan failed every target, a capture failed, or doctor found a blocker.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from radar import http  # noqa: E402
from radar.apify import Apify, ApifyError  # noqa: E402
from radar.capture import CaptureError, capture_pending, capture_url  # noqa: E402
from radar.config import Config  # noqa: E402
from radar.log import Logger  # noqa: E402
from radar.scan import digest_text, run_scan  # noqa: E402
from radar.sinks import BridgeSink, SinkError, SlackSink  # noqa: E402
from radar.supabase import Supabase, SupabaseError  # noqa: E402
from radar.state import State  # noqa: E402
from radar import watchlist as wl  # noqa: E402


def _print(obj: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(obj, ensure_ascii=False, indent=1))
    elif isinstance(obj, str):
        print(obj)
    else:
        print(json.dumps(obj, ensure_ascii=False, indent=1))


def cmd_doctor(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str, required: bool = False) -> None:
        checks.append({"check": name, "ok": ok, "detail": detail, "required": required})

    add("python", sys.version_info >= (3, 9), sys.version.split()[0], True)
    add("ffmpeg", shutil.which("ffmpeg") is not None, shutil.which("ffmpeg") or "missing: frames and audio extraction disabled")
    add("ffprobe", shutil.which("ffprobe") is not None, shutil.which("ffprobe") or "missing: durations unknown")
    add("home", True, str(cfg.home))
    add("watchlist", cfg.watchlist_path.exists(), f"{cfg.watchlist_path} ({len(wl.load(cfg.watchlist_path))} targets)")
    # Keys by name only.
    add("APIFY_API_KEY", bool(cfg.apify_token), "set" if cfg.apify_token else "missing: scans and captures cannot run", True)
    add("GOOGLE_AI_API_KEY", bool(cfg.gemini_key), "set (video understanding)" if cfg.gemini_key else "missing: falls back to Whisper plus frames")
    add("ELEVENLABS_API_KEY", bool(cfg.elevenlabs_key), f"set (speech first: {cfg.elevenlabs_stt_model})" if cfg.elevenlabs_key else "missing: Arabic speech goes to Whisper")
    add("GROQ_API_KEY", bool(cfg.groq_key), "set (speech fallback)" if cfg.groq_key else "missing")
    add("OPENAI_API_KEY", bool(cfg.openai_key), "set (frame vision fallback)" if cfg.openai_key else "missing")
    add("DEEPSEEK_API_KEY", bool(cfg.deepseek_key), "set (text fallback)" if cfg.deepseek_key else "missing")
    add("SCRAPECREATORS_API_KEY", bool(cfg.scrapecreators_key), "set (pages and ad libraries on demand)" if cfg.scrapecreators_key else "missing: the cockpit's scrape requests will fail")
    add("store", cfg.effective_sink in ("supabase", "cockpit", "both"), f"{cfg.effective_sink} (RADAR_SINK={cfg.sink_mode})", True)
    add("supabase", cfg.use_supabase_sink, "the ideation home" if cfg.use_supabase_sink else "not configured (RADAR_SUPABASE_URL and RADAR_SUPABASE_KEY)")
    add("watchlist source", True, "Supabase ideation_watchlist" if cfg.watchlist_from_supabase else str(cfg.watchlist_path))
    add("cockpit door", cfg.use_cockpit_sink, "mirror configured" if cfg.use_cockpit_sink else "off")
    add("slack", bool(cfg.slack_token and cfg.slack_channel), "configured" if cfg.slack_token and cfg.slack_channel else "not configured (RADAR_SLACK_CHANNEL)")
    if not args.offline:
        if cfg.apify_token:
            try:
                ap = Apify(cfg.apify_token, base=cfg.apify_base)
                me = ap.me()
                plan = me.get("plan") or {}
                add("apify api", True, f"user {me.get('username')} plan {plan.get('id') or '?'}", True)
                try:
                    usage = http.get_json(ap._url("users/me/usage/monthly"), timeout=30).get("data", {})
                    used = usage.get("totalUsageCreditsUsdAfterVolumeDiscount", usage.get("totalUsageCreditsUsdBeforeVolumeDiscount"))
                    credit = plan.get("monthlyUsageCreditsUsd")
                    low = isinstance(used, (int, float)) and isinstance(credit, (int, float)) and credit > 0 and used > 0.85 * credit
                    add("apify credit", not low, f"USD {float(used or 0):.2f} used of {credit} this month" + (" (nearly used up: scans will start failing with 402)" if low else ""))
                except (http.HttpError, AttributeError, TypeError):
                    add("apify credit", True, "usage not readable")
            except (http.HttpError, ApifyError, KeyError) as e:
                add("apify api", False, f"{e}", True)
        if cfg.gemini_key:
            # A listed model can still refuse a key ("no longer available to new users"), so ask it one word.
            from radar.understand import gemini_generate
            try:
                out, usage = gemini_generate(cfg, cfg.gemini_model, [{"text": 'Reply with the JSON {"ok": true}.'}], {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}, temperature=0)
                add("gemini model", bool(out.get("ok")), f"{cfg.gemini_model} answered ({usage.get('totalTokenCount', '?')} tokens)")
            except (http.HttpError, ValueError, KeyError) as e:
                msg = http.scrub(str(e))
                hint = " (set RADAR_GEMINI_MODEL to the model Google names in this message)" if "no longer available" in msg else ""
                add("gemini model", False, f"{cfg.gemini_model}: {msg[:220]}{hint}")
        if cfg.groq_key:
            try:
                http.get_json("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {cfg.groq_key}"}, timeout=30)
                add("groq api", True, "ok")
            except http.HttpError as e:
                add("groq api", False, str(e))
        if cfg.scrapecreators_key:
            from radar.sources.scrapecreators import ScrapeCreators
            try:
                left = ScrapeCreators(cfg.scrapecreators_key).credit_balance()
                add("scrapecreators credits", left >= 20, f"{left} credits left" + (" (top up at app.scrapecreators.com: a page scrape costs about 5, an ad pull about 3)" if left < 20 else ""))
            except http.HttpError as e:
                add("scrapecreators credits", False, http.scrub(str(e))[:200])
        if cfg.elevenlabs_key:
            try:
                sub_ = http.get_json("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": cfg.elevenlabs_key}, timeout=30)
                tier = str(sub_.get("tier") or sub_.get("status") or "?")
                add("elevenlabs api", True, f"plan {tier}; speech to text is metered separately from the character quota")
            except http.HttpError as e:
                add("elevenlabs api", False, http.scrub(str(e))[:200])
        if cfg.gemini_key or cfg.openai_key:
            from radar.trends import embed
            try:
                vec = embed(cfg, ["ok"])
                provider = {1.0: cfg.embed_model, 2.0: cfg.openai_embed_model}.get(vec[0][0] if vec and vec[0] else 0.0, "?")
                add("embeddings", bool(vec and vec[0]), f"{provider}: {len(vec[0]) - 1 if vec and vec[0] else 0} dims (trends)")
            except (http.HttpError, ValueError, KeyError) as e:
                add("embeddings", False, f"{http.scrub(str(e))[:200]} (trends will not be flagged)")
        if cfg.bridge_url and cfg.bridge_token:
            try:
                BridgeSink(cfg.bridge_url, cfg.bridge_token).ping()
                add("cockpit ping", True, "ok")
            except (SinkError, http.HttpError) as e:
                add("cockpit ping", False, str(e))
        if cfg.use_supabase_sink:
            try:
                sb = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket)
                sb.ping()
                n = len(sb.load_watchlist())
                add("supabase tables", True, f"{cfg.supabase_table} reachable, {n} active watchlist targets", True)
            except (http.HttpError, SupabaseError) as e:
                add("supabase tables", False, f"{e} (see README for the DDL)", True)
        if cfg.slack_token and cfg.slack_channel:
            try:
                out = http.post_json("https://slack.com/api/auth.test", {}, headers={"Authorization": f"Bearer {cfg.slack_token}"}, timeout=30, retries=0)
                add("slack auth", bool(out and out.get("ok")), str((out or {}).get("user") or (out or {}).get("error")))
            except http.HttpError as e:
                add("slack auth", False, str(e))
    blockers = [c for c in checks if c["required"] and not c["ok"]]
    if args.json:
        _print({"ok": not blockers, "checks": checks}, True)
    else:
        for c in checks:
            mark = "OK " if c["ok"] else ("!! " if c["required"] else "-- ")
            print(f"{mark} {c['check']:18s} {c['detail']}")
        print("blockers: " + (", ".join(c["check"] for c in blockers) if blockers else "none"))
    return 1 if blockers else 0


def cmd_scan(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    report = run_scan(cfg, log.info, dry_run=args.dry_run, platforms=args.platform or None, only=args.only or None)
    if args.json:
        _print(report.to_dict(), True)
    else:
        print(digest_text(report))
        if args.verbose:
            for row in report.per_target:
                print(" ", json.dumps(row, ensure_ascii=False))
            for w in report.warnings:
                print("  warn:", w)
    return 1 if (report.targets and report.scanned == 0) else 0


def cmd_capture(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    rc = 0
    ideas = []
    for url in args.url:
        idea = capture_url(cfg, log.info, url, saved_by=args.by or "", note=args.note or "", industry=args.industry, tags=[t for t in (args.tags or "").split(",") if t], dry_run=args.dry_run, force=args.force, keep_media=args.keep_media)
        ideas.append(idea.to_dict())
        if idea.status != "captured":
            rc = 1
            log.warn(f"capture failed for {url}: {idea.error}")
    if args.json:
        _print(ideas if len(ideas) > 1 else ideas[0], True)
    else:
        for i in ideas:
            print(f"{i['status']}: {i['url']}")
            if i["status"] == "captured":
                print(f"  {i.get('format')} | {i.get('voice')} | {i.get('language')} {i.get('dialect') or ''} | hook: {(i.get('hook') or {}).get('text','')[:120]}")
                print(f"  why: {i.get('why_it_works','')[:300]}")
                for a in i.get("adaptations", [])[:5]:
                    print(f"  - {a}")
            else:
                print(f"  error: {i.get('error')}")
            for w in i.get("warnings", [])[:5]:
                print(f"  warn: {w}")
    return rc


def cmd_pending(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    try:
        ideas = capture_pending(cfg, log.info, limit=args.limit, dry_run=args.dry_run)
    except (CaptureError, SinkError, http.HttpError) as e:
        log.error(str(e))
        return 1
    failed = [i for i in ideas if i.status != "captured"]
    summary: dict[str, Any] = {"captured": len(ideas) - len(failed), "failed": len(failed), "keys": [i.key for i in ideas]}
    if cfg.use_supabase_sink:
        # The cockpit's scrape requests ride the same cron.
        from radar.requests import run_requests
        try:
            done = run_requests(cfg, log.info, limit=3, dry_run=args.dry_run)
            summary["requests"] = [{k: d.get(k) for k in ("id", "kind", "input", "status", "error")} for d in done]
        except (SupabaseError, http.HttpError) as e:
            log.error(f"requests: {e}")
            summary["requests_error"] = str(e)[:200]
    _print(summary, args.json)
    return 1 if failed and not ideas else 0


def cmd_requests(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    from radar.requests import run_requests
    try:
        done = run_requests(cfg, log.info, limit=args.limit, dry_run=args.dry_run)
    except (SupabaseError, http.HttpError) as e:
        log.error(str(e))
        return 1
    if args.json:
        _print(done, True)
    else:
        for d in done:
            r = d.get("result") or {}
            print(f"{d.get('status')}: {d.get('kind')} {d.get('input')} " + (f"-> {r.get('proposals')} proposals, {r.get('ads', '')} ads, credits {r.get('credits')}" if r else f"({d.get('error')})"))
        if not done:
            print("nothing queued")
    return 1 if any(d.get("status") == "failed" for d in done) else 0


def cmd_watchlist(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    sb = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket) if cfg.watchlist_from_supabase else None
    if sb is not None and args.action == "list":
        rows = [t.to_dict() for t in sb.load_watchlist()]
        if args.json:
            _print(rows, True)
        else:
            for r in rows:
                print(f"{r['platform']:9s} {r['kind']:7s} {r['value']:30s} {r['industry']:6s} {','.join(r['tags'])}")
            print(f"{len(rows)} active targets in Supabase ideation_watchlist")
        return 0
    if sb is not None and args.action == "add":
        from radar.models import Target
        kind = args.kind or ("hashtag" if args.value.startswith("#") else "account")
        if kind == "search" and args.platform.lower() != "instagram":
            log.error("keyword search targets are Instagram only for now")
            return 2
        t = Target(platform=args.platform.lower(), kind=kind, value=args.value.lstrip("@#") if kind != "search" else args.value.strip(), industry=args.industry, tags=[x for x in (args.tags or "").split(",") if x], note=args.note or "")
        sb.upsert_watchlist([t], added_by="cli")
        _print(t.to_dict(), args.json)
        return 0
    if sb is not None and args.action == "remove":
        kind = args.kind or ("hashtag" if args.value.startswith("#") else "account")
        sb.mark_target(f"{args.platform.lower()}:{kind}:{(args.value.lstrip('@#') if kind != 'search' else args.value.strip()).lower()}", active=False)
        _print({"deactivated": True}, args.json)
        return 0
    if sb is not None and args.action == "push":
        targets = wl.load(cfg.watchlist_path)
        n = sb.upsert_watchlist(targets, added_by="file")
        _print({"pushed": n, "from": str(cfg.watchlist_path)}, args.json)
        return 0
    if args.action == "list":
        rows = wl.as_rows(wl.load(cfg.watchlist_path))
        if args.json:
            _print(rows, True)
        else:
            for r in rows:
                flag = "" if r["active"] else " (inactive)"
                print(f"{r['platform']:9s} {r['kind']:7s} {r['value']:30s} {r['industry']:6s} {','.join(r['tags'])}{flag}")
            print(f"{len(rows)} targets in {cfg.watchlist_path}")
        return 0
    if args.action == "add":
        t = wl.add(cfg.watchlist_path, args.platform, args.value, industry=args.industry, tags=[x for x in (args.tags or "").split(",") if x], note=args.note or "")
        _print(t.to_dict(), args.json)
        return 0
    if args.action == "remove":
        ok = wl.remove(cfg.watchlist_path, args.platform, args.value)
        _print({"removed": ok}, args.json)
        return 0 if ok else 1
    return 2


def cmd_resend(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """After a Supabase outage: push the last scan's proposals and the captured ideas again."""
    if not cfg.use_supabase_sink:
        log.error("Supabase is not configured (RADAR_SUPABASE_URL, RADAR_SUPABASE_KEY)")
        return 1
    sb = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket)
    out: dict[str, Any] = {}
    latest = Path(args.scan) if args.scan else cfg.out_dir / "latest.json"
    if latest.exists():
        rep = json.loads(latest.read_text(encoding="utf-8")).get("scan", {})
        rows = rep.get("new_candidates", [])
        out["proposals"] = sb.store_candidates(rows) if rows else {"inserted": 0}
    ideas = Path(args.ideas) if args.ideas else cfg.out_dir / "ideas.jsonl"
    sent = skipped = 0
    if ideas.exists():
        for line in ideas.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("status") != "captured":
                skipped += 1
                continue
            try:
                sb.store_idea(row, origin_key=row.get("cockpit_id") or None)
                sent += 1
            except (SupabaseError, http.HttpError) as e:
                log.warn(f"idea {row.get('key')}: {e}")
                skipped += 1
    out["ideas"] = {"sent": sent, "skipped": skipped}
    _print(out, args.json)
    return 0


def cmd_digest(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    st = State.load(cfg.state_path)
    last = st.last_scan()
    if not last:
        print("no scan recorded yet")
        return 1
    _print(last, args.json)
    return 0


def cmd_trends(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    if not cfg.use_supabase_sink:
        log.error("trends need the Supabase home (RADAR_SUPABASE_URL and RADAR_SUPABASE_KEY)")
        return 2
    from radar.trends import detect, digest_lines
    sb = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket)
    summary = detect(cfg, sb, log.info)
    if args.json:
        _print(summary, True)
    else:
        print(f"{summary['rows']} rows in the last {cfg.trend_window_days} days, {summary['described']} described, {summary['embedded']} embedded, {len(summary['trends'])} trends")
        for line in digest_lines(summary):
            print(line)
        for e in summary.get("errors", [])[:10]:
            print(f"  error: {e}")
    return 0


def cmd_speechtest(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Ten clips, three ears: which one reads Gulf Arabic best. Prints the transcripts and a model's verdict."""
    import base64
    import tempfile

    from radar import media
    from radar.capture import fetch_post, resolve_link
    from radar.speech import elevenlabs_transcribe, groq_transcribe
    from radar.understand import gemini_generate

    apify = Apify(cfg.apify_token, base=cfg.apify_base, timeout_sec=cfg.apify_timeout_sec, max_runs=cfg.apify_max_runs_per_scan, log=log.info) if cfg.apify_token else None
    rows: list[dict[str, Any]] = []
    for url in args.url:
        row: dict[str, Any] = {"url": url, "transcripts": {}, "errors": {}}
        rows.append(row)
        try:
            link = resolve_link(url)
            post, _w = fetch_post(cfg, apify, link, log.info)
            if post is None or not post.media_url:
                row["errors"]["fetch"] = "no media URL"
                continue
            row["author"] = post.author_handle
            with tempfile.TemporaryDirectory(prefix="radar-speech-") as tmp:
                work = Path(tmp)
                video = work / "video.mp4"
                media.download_video(post.media_url, video, max_bytes=cfg.max_video_bytes)
                audio = media.extract_audio(video, work / "audio.mp3") or video
                row["seconds"] = media.probe(video).get("duration_sec")
                if cfg.elevenlabs_key:
                    try:
                        tr = elevenlabs_transcribe(cfg, audio)
                        row["transcripts"]["elevenlabs"] = tr["text"]
                        row["elevenlabs_language"] = f"{tr.get('language')} ({tr.get('language_probability')})"
                    except (http.HttpError, ValueError, KeyError) as e:
                        row["errors"]["elevenlabs"] = http.scrub(str(e))[:200]
                if cfg.groq_key:
                    try:
                        row["transcripts"]["groq"] = groq_transcribe(cfg, audio)["text"]
                    except (http.HttpError, ValueError, KeyError) as e:
                        row["errors"]["groq"] = http.scrub(str(e))[:200]
                if cfg.gemini_key:
                    try:
                        blob = base64.b64encode(audio.read_bytes()).decode("ascii")
                        out, _u = gemini_generate(
                            cfg, cfg.gemini_model,
                            [{"inline_data": {"mime_type": "audio/mpeg" if audio.suffix == ".mp3" else "video/mp4", "data": blob}}, {"text": "Transcribe the speech verbatim in its original language and dialect. Never translate, never summarise. Return ONLY JSON {\"transcript\": string, \"language\": string, \"dialect\": string or null}."}],
                            {"type": "object", "properties": {"transcript": {"type": "string"}, "language": {"type": "string"}, "dialect": {"type": "string", "nullable": True}}, "required": ["transcript", "language"]},
                            temperature=0,
                        )
                        row["transcripts"]["gemini"] = str(out.get("transcript") or "")
                        row["gemini_dialect"] = out.get("dialect")
                    except (http.HttpError, ValueError, KeyError) as e:
                        row["errors"]["gemini"] = http.scrub(str(e))[:200]
            if cfg.gemini_key and len(row["transcripts"]) >= 2:
                listing = "\n\n".join(f"[{name}]\n{text or '(empty)'}" for name, text in row["transcripts"].items())
                try:
                    verdict, _u = gemini_generate(
                        cfg, cfg.gemini_text_model,
                        [{"text": f"Three speech-to-text systems transcribed the same short Gulf Arabic social video (it may mix dialect, English words and music). Judge each transcript on: dialect fidelity (keeps the spoken dialect rather than normalising to MSA), completeness, and garbling (invented or broken words). Score 1 to 5 each and name the best. Return ONLY JSON {{\"scores\": {{\"<name>\": {{\"dialect\": n, \"completeness\": n, \"garbling\": n, \"note\": string}}}}, \"best\": \"<name>\", \"reason\": string}}. No em dashes.\n\n{listing}"}],
                        None, temperature=0,
                    )
                    row["verdict"] = verdict
                except (http.HttpError, ValueError, KeyError) as e:
                    row["errors"]["judge"] = http.scrub(str(e))[:200]
        except Exception as e:  # noqa: BLE001 - one clip must not stop the comparison
            row["errors"]["clip"] = http.scrub(str(e))[:200]
    if args.json:
        _print(rows, True)
        return 0
    wins: dict[str, int] = {}
    for r in rows:
        print(f"\n== {r.get('author', '?')} {r['url']} ({r.get('seconds') or '?'}s)")
        for name, text in r["transcripts"].items():
            print(f"  [{name}] {len(text)} chars: {text[:220]}")
        for name, err in r["errors"].items():
            print(f"  [{name}] ERROR {err}")
        v = r.get("verdict") or {}
        if v:
            best = str(v.get("best") or "")
            wins[best] = wins.get(best, 0) + 1
            print(f"  judge: best={best} ({str(v.get('reason') or '')[:200]})")
            for name, sc in (v.get("scores") or {}).items():
                if isinstance(sc, dict):
                    print(f"    {name}: dialect {sc.get('dialect')} completeness {sc.get('completeness')} garbling {sc.get('garbling')} {str(sc.get('note') or '')[:120]}")
    if wins:
        print("\nJudge's wins: " + ", ".join(f"{k} {v}" for k, v in sorted(wins.items(), key=lambda kv: -kv[1])))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="radar.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="machine readable output")
    ap.add_argument("--quiet", action="store_true", help="only warnings and errors on stderr")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("doctor"); d.add_argument("--offline", action="store_true")
    s = sub.add_parser("scan"); s.add_argument("--dry-run", action="store_true"); s.add_argument("--platform", action="append"); s.add_argument("--only", action="append"); s.add_argument("--verbose", action="store_true")
    c = sub.add_parser("capture"); c.add_argument("url", nargs="+"); c.add_argument("--by"); c.add_argument("--note"); c.add_argument("--industry", default="other", choices=["ours", "other", "mahara"]); c.add_argument("--tags"); c.add_argument("--dry-run", action="store_true"); c.add_argument("--force", action="store_true"); c.add_argument("--keep-media", action="store_true")
    p = sub.add_parser("pending"); p.add_argument("--limit", type=int, default=10); p.add_argument("--dry-run", action="store_true")
    w = sub.add_parser("watchlist"); w.add_argument("action", choices=["list", "add", "remove", "push"]); w.add_argument("platform", nargs="?"); w.add_argument("value", nargs="?"); w.add_argument("--industry", default="other", choices=["ours", "other", "mahara"]); w.add_argument("--tags"); w.add_argument("--note"); w.add_argument("--kind", choices=["account", "hashtag", "search"], help="search: an Instagram keyword such as 'ديكور الكويت'")
    sub.add_parser("digest")
    sub.add_parser("trends")
    rq = sub.add_parser("requests"); rq.add_argument("--limit", type=int, default=3); rq.add_argument("--dry-run", action="store_true")
    st = sub.add_parser("speechtest"); st.add_argument("url", nargs="+")
    rs = sub.add_parser("resend"); rs.add_argument("--scan", help="a latest.json to re-send (default out/latest.json)"); rs.add_argument("--ideas", help="an ideas.jsonl to re-send (default out/ideas.jsonl)")
    args = ap.parse_args(argv)
    cfg = Config.from_env()
    cfg.ensure_dirs()
    log = Logger(cfg.out_dir / "radar.log", quiet=args.quiet)
    if args.cmd in ("add", "remove") or (args.cmd == "watchlist" and args.action in ("add", "remove") and not (args.platform and args.value)):
        ap.error("watchlist add/remove need <platform> <value>")
    handlers = {"doctor": cmd_doctor, "scan": cmd_scan, "capture": cmd_capture, "pending": cmd_pending, "watchlist": cmd_watchlist, "digest": cmd_digest, "resend": cmd_resend, "trends": cmd_trends, "speechtest": cmd_speechtest, "requests": cmd_requests}
    try:
        return handlers[args.cmd](cfg, args, log)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
