#!/usr/bin/env python3
"""Sales desk: proposals drafted from demo calls, and the calls indexed per rep.

    python3 desk.py doctor [--offline]      every key by name, each service, each blocker in a sentence
                    [--cron]                the hourly run: a one-token model probe, no render, quiet when ready
    python3 desk.py requests [--limit N]    draft (or rebuild) the proposals the cockpit asked for
    python3 desk.py recordings [--days N]   index Fathom's sales calls and match them to leads
    python3 desk.py calls-vault [--dry]     copy every sales call in the Obsidian vault in, transcripts too
                    [--fathom-days N]       (asks Fathom about calls whose note cannot say whether a lead joined)
    python3 desk.py maqsam-calls [--days N] [--dry-run] [--limit N]
                                            every answered phone call with a transcript, from Maqsam
    python3 desk.py calls-b2b-fathom --once [--dry-run] [--limit N]
                                            Ahmed's private Fathom calls that only B2B holds, copied once
    python3 desk.py reviews-import [--dry]  Vince's archived reviews into the cockpit
    python3 desk.py reviews [--limit N]     Vince reviews the newest unreviewed calls
    python3 desk.py research [--limit N]    research the leads a rep asked about (web search, sources kept)
    python3 desk.py followups               draft follow-ups for the leads who need one now, for approval
                    [--contact ID [--segment KIND]]
                                            the test path: one contact tagged cockpit-test, nothing else touched
    python3 desk.py waves [--pools]         backlog waves: enrol, write the day's openers, send approved ones paced
    python3 desk.py rooms [--for 57]        make the video rooms the cockpit asks for, polling every second,
                    [--once] [--check-hosts]  and send the Slack replies the door keeps (one tick by hand; or only
                                            the Zoom and Google check of every seat)
    python3 desk.py deploy-check            (or: deploy check) is this box ready for live calls and the
                                            follow-up agent, every switch still off? Changes nothing
    python3 desk.py status                  the queue, the last proposals, the last runs
    python3 desk.py offer-sync              offer.json into the cockpit's proposal form (requests does it too)
    python3 desk.py form-sync               the New Client Form's questions into the cockpit (requests does it too, every 10 minutes)

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
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from desk import b2b_fathom as b2b_fathom_mod  # noqa: E402
from desk import build as build_mod  # noqa: E402
from desk import calls_vault as calls_vault_mod  # noqa: E402
from desk import clientform as clientform_mod  # noqa: E402
from desk import deploycheck as deploycheck_mod  # noqa: E402
from desk import engine as engine_mod  # noqa: E402
from desk import fathom as fathom_mod  # noqa: E402
from desk import http  # noqa: E402
from desk import maqsam_calls as maqsam_mod  # noqa: E402
from desk import model as model_mod  # noqa: E402
from desk import notes as notes_mod  # noqa: E402
from desk import offer as offer_mod  # noqa: E402
from desk import prompt as prompt_mod  # noqa: E402
from desk import queue as queue_mod  # noqa: E402
from desk import recordings as recordings_mod  # noqa: E402
from desk import render as render_mod  # noqa: E402
from desk import followups as followups_mod  # noqa: E402
from desk import research as research_mod  # noqa: E402
from desk import waves as waves_mod  # noqa: E402
from desk import reviews as reviews_mod  # noqa: E402
from desk import rooms as rooms_mod  # noqa: E402
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


# The commands that call a model, each metered against the day's ceiling.
METERED = ("requests", "draft", "reviews", "followups", "notes", "digest", "research")
DAILY_TOKENS = 15_000_000


def _meter(cfg: Config, job: str, log: Logger) -> None:
    """Count and log every model call this run makes (cockpit_sales_ai_usage),
    and stop them past SALES_AI_DAILY_TOKENS for the Kuwait day, or while the
    day's spend cannot be read."""
    sb = _sb(cfg)
    try:
        cap = int(key("SALES_AI_DAILY_TOKENS", str(DAILY_TOKENS)).replace(",", "").strip() or DAILY_TOKENS)
    except ValueError:
        cap = DAILY_TOKENS
    now = datetime.now(timezone.utc)
    k = now + timedelta(hours=3)
    midnight = (k.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=3)).isoformat()

    def used_today() -> int:
        out = sb.rest("POST", "rpc/cockpit_sales_ai_tokens_since", json_body={"p_since": midnight})
        return int(out or 0)

    def record(row: dict[str, Any]) -> None:
        sb.rest("POST", "cockpit_sales_ai_usage", json_body=[row], prefer="return=minimal", retries=0)

    model_mod.meter(model_mod.Meter(job=job, cap=cap, used_today=used_today, record=record, warn=log.warn))


# How long the desk's model has not answered, kept on its status row: the
# watchdog's line says since when ("lapsed at {time}"), not only that.
MODEL_SINCE = re.compile(r"since (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC")


def model_probe(p: Any, timeout: float) -> tuple[bool, str, bool]:
    """One token through the desk's model: (answers, a sentence, an outage).
    The cheap check the hourly doctor and every follow-up run make, so a
    lapsed sign-in shows the hour it happens and not when a draft is next
    tried. An outage is the provider saying it will not answer (NotNow: the
    sign-in lapsed, the proxy gone, the plan's limit); anything else (a
    timeout, an answer that is not JSON) is one miss. It never raises: a
    probe that breaks is a sentence, never a dead doctor."""
    try:
        return True, p.ping(timeout=timeout), False
    except NotNow as e:
        return False, str(e), True
    except Exception as e:  # noqa: BLE001 - a 200 with an HTML body, a timeout: one miss, said
        return False, f"The model did not answer a one-token call: {http.scrub(str(e))[:200]}", False


# Said on the model's row after one call that did not answer, and read
# back: a second one in a row is an outage (the row turns false), one alone
# is not (the watchdog's Slack line would blame a lapsed sign-in).
ONE_MISS = "one miss is not an outage"


def _model_status(cfg: Config, log: Logger, ok: bool, detail: str, now: Optional[datetime] = None,
                  outage: bool = True) -> None:
    """The (sales-desk, model) status row. While it stays down, the time it
    first went down is kept. A probe that only missed (outage=False) keeps
    the row as it was the first time and says so; two in a row are down."""
    now = now or datetime.now(timezone.utc)
    try:
        sb = _sb(cfg)
        if ok:
            sb.worker_status(WORKER, "model", True, detail)
            return
        prev = sb.select("cockpit_sales_worker_status", f"select=ok,detail&worker=eq.{WORKER}&job=eq.model&limit=1")
        was_down = bool(prev and prev[0].get("ok") is False)
        if not outage and not was_down and ONE_MISS not in str((prev[0] if prev else {}).get("detail") or ""):
            sb.worker_status(WORKER, "model", True, f"{detail.rstrip('.')}; {ONE_MISS}, so drafting goes on")
            return
        m = MODEL_SINCE.search(str(prev[0].get("detail") or "")) if was_down else None
        since = m.group(1) if m else now.strftime("%Y-%m-%d %H:%M")
        sb.worker_status(WORKER, "model", False, f"{detail.rstrip('.')}. Not answering since {since} UTC")
    except (SupabaseError, http.HttpError) as e:
        log.warn(f"model status not written: {http.scrub(str(e))[:200]}")


def cmd_doctor(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Every key by name, each service, each blocker in a sentence. With
    --cron (hourly): the model is asked one token and nothing more, nothing
    is rendered, every check that breaks is a row rather than a crash, the
    status rows are written whatever happens, and a ready run prints nothing
    with --quiet."""
    cron = bool(getattr(args, "cron", False))
    rows: list[dict[str, Any]] = []

    def add(name: str, ok: Optional[bool], detail: str, required: bool = False) -> None:
        rows.append({"check": name, "ok": ok, "detail": detail, "required": required})

    def guarded(name: str, required: bool, fn: Callable[[], None]) -> None:
        try:
            fn()
        except Exception as e:  # noqa: BLE001 - a check that breaks is a row, never a dead doctor
            add(name, False if required else None, f"the check itself failed: {http.scrub(str(e))[:200]}", required)

    add("python", sys.version_info >= (3, 9), sys.version.split()[0], True)
    for label, path in (("SKILL.md", prompt_mod.SKILL_FILE), ("PATTERNS.md", prompt_mod.PATTERNS_FILE),
                        ("template", build_mod.TEMPLATE), ("logo", build_mod.ASSETS / "mahara-logo.png")):
        add(label, path.is_file(), "present" if path.is_file() else f"missing: {path} is not in the clone", True)
    if build_mod.TEMPLATE.is_file() and not build_mod.DATA_BLOCK.search(build_mod.TEMPLATE.read_text(encoding="utf-8")):
        add("template", False, "the @data-start / @data-end markers are gone, so no deal can be put into it", True)

    def offer_check() -> None:
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
    guarded("offer.json", True, offer_check)

    # By name only. A value is never printed, not even its length.
    for name in ("DESK_SUPABASE_URL", "DESK_SUPABASE_KEY", "FATHOM_API_KEY",
                 "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
                 "MAQSAM_ACCESS_KEY", "MAQSAM_SECRET"):
        add(name, bool(key(name)) or None, "set" if key(name) else "not set")
    # Only the New Client Form's question list needs it; without it the
    # cockpit keeps its last copy.
    add("TYPEFORM_API_TOKEN", True if key("TYPEFORM_API_TOKEN") else None,
        "set" if key("TYPEFORM_API_TOKEN") else "not set: the cockpit's New Client Form list stops following Typeform")
    # Only the Slack poster needs it (App Home replies, inside the rooms
    # run), and only once live.slack is switched on.
    add("SLACK_SALES_BOT_TOKEN", True if key("SLACK_SALES_BOT_TOKEN") else None,
        "set" if key("SLACK_SALES_BOT_TOKEN") else "not set: Slack replies to App Home presses wait (set it before "
        "live.slack is switched on)")
    # Only calls-b2b-fathom needs it, once; its absence blocks nothing else.
    add("SALES_B2B_MGMT_TOKEN", True if key("SALES_B2B_MGMT_TOKEN") else None,
        "set" if key("SALES_B2B_MGMT_TOKEN") else "not set: only the one-off calls-b2b-fathom needs it")
    # The room worker's keys, checked live unless --offline: keys that are
    # present can still be refused, or (Google) carry no Calendar permission.
    # Without them the worker's own status row says which video service
    # cannot be made; nothing else waits on them.
    # Guarded like every other check: a room check that breaks is a row, never
    # a dead doctor (the hourly --cron run still writes its status rows).
    def room_keys() -> None:
        for name, ok, detail in rooms_mod.doctor_lines(offline=args.offline):
            add(name, ok, detail)
    guarded("rooms", False, room_keys)
    add("model", True, f"SALES_MODEL_PROVIDER={cfg.provider}, SALES_PROPOSAL_MODEL={cfg.model}"
                       + ("" if cfg.model != DEFAULT_MODELS.get(cfg.provider) else " (the default)"))

    probed: Optional[tuple[bool, str, bool]] = None
    p = None
    try:
        p = model_mod.provider(cfg, log.info)
        add("model key", True, "none needed: the Claude proxy on the VPS" if cfg.provider == "vps"
            else f"{model_mod.KEY_NAMES[cfg.provider]} set for {cfg.provider}", True)
    except NotNow as e:
        add("model key", False, str(e), True)
        # No model can be asked at all: the model's row says so, never an
        # old "opus answered" left green.
        probed = (False, str(e), True)

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

            def tables() -> None:
                bad = []
                for table in TABLES:
                    try:
                        sb.select(table, "select=*&limit=1")
                    except (http.HttpError, SupabaseError) as e:
                        bad.append(f"{table} ({http.scrub(str(e))[:80]})")
                add("supabase tables", not bad, f"all {len(TABLES)} answer" if not bad else
                    "these do not answer, so the migration 20260924a_sales_cockpit.sql is not applied: " + "; ".join(bad), True)
            guarded("supabase tables", True, tables)

            def db_clock() -> None:
                # The SQL sweep owns every room timer and compares with the
                # database's clock; the room worker writes on this one.
                off = sb.clock_offset
                if off is None:
                    add("database clock", None, "not compared: the database's answer carried no Date header")
                    return
                n = int(round(abs(off)))
                way = "behind" if off > 0 else "ahead of"
                if n > 60:
                    add("database clock", False, f"this VPS's clock is {n} seconds {way} the database's: the room worker "
                                                 "makes no room until it is fixed (timedatectl, or chrony)", True)
                elif n > 10:
                    # A fault, not a warning: the waves job paces its sends and
                    # counts the sender ceiling against the database's times,
                    # and the rooms' times are on that clock too.
                    add("database clock", False, f"this VPS's clock is {n} seconds {way} the database's: the waves "
                                                 "job's paced sends and the rooms' times go wrong; fix it "
                                                 "(timedatectl, or chrony)", True)
                else:
                    add("database clock", True, f"within {max(n, 1)} second{'s' if n > 1 else ''} of the database's")
            guarded("database clock", False, db_clock)

            def bucket() -> None:
                try:
                    b = sb.bucket_info()
                    private = b.get("public") is False
                    add("bucket", True if private else None,
                        f"{cfg.bucket} exists and is private" if private else
                        f"{cfg.bucket} exists but is PUBLIC: a proposal carries a client's numbers; make it private")
                except http.HttpError as e:
                    add("bucket", False, f"the {cfg.bucket} bucket does not answer ({e.status}), so no file can be "
                                         "stored: apply 20260924b_sales_proposal_files.sql", True)
            guarded("bucket", True, bucket)

            def fathom_seats() -> None:
                with_fathom = [x for x in sb.people() if x.get("fathom_email")]
                add("reps in Fathom", True if with_fathom else None,
                    f"{len(with_fathom)} seat(s) carry a fathom_email and are asked for by name" if with_fathom else
                    "no seat carries a fathom_email yet, so only the key owner's own calls are indexed")
            guarded("reps in Fathom", False, fathom_seats)
            guarded("follow-up agent", False, lambda: _agent_checks(sb, add))
        else:
            add("supabase", False, "DESK_SUPABASE_URL and DESK_SUPABASE_KEY are not set, so nothing can be read "
                                   "or written; source ~/.editor-desk/env", True)

        if p is not None:
            probed = model_probe(p, 30 if cron else 60)
            # One miss is not known, not a blocker: an outage blocks.
            add("model answers", True if probed[0] else (False if probed[2] else None), probed[1], True)
            if not cron:
                def listed() -> None:
                    try:
                        ids = p.models()
                        if cfg.model in ids:
                            add("model listed", True, f"{cfg.model} is one of the {len(ids)} models this key can use")
                        else:
                            usable = [i for i in ids if model_mod.model_allowed(i)]
                            add("model listed", False, f"{cfg.model} is not among the models this key can use. Set "
                                                       "SALES_PROPOSAL_MODEL to one of: " + ", ".join(usable[:20] or ids[:20]), True)
                    except (NotNow, model_mod.ModelError) as e:
                        add("model listed", None, f"the model list could not be read: {e}")
                guarded("model listed", False, listed)
                if getattr(p, "name", "") == "openai":
                    streams = p.stream_check()
                    if streams is False:
                        add("model streams", None, "OpenAI will not stream this model to this organisation; drafts ask "
                                                   "without streaming and wait for the whole answer instead")
                    elif streams:
                        add("model streams", True, "streaming works, so a long draft is timed by its silences")

        def fathom_check() -> None:
            if cfg.fathom_key:
                try:
                    f = fathom_mod.Fathom(cfg.fathom_key, pace=cfg.fathom_pace, log=log.info)
                    d = f.get("/meetings", [("created_after", (datetime.now(timezone.utc) - timedelta(days=7))
                                             .replace(microsecond=0).isoformat().replace("+00:00", "Z"))])
                    add("fathom", True, f"answers: {len(d.get('items') or [])} calls in the last week on the first page", True)
                except fathom_mod.FathomError as e:
                    add("fathom", False, f"Fathom did not answer: {e}", True)
            else:
                add("fathom", False, "FATHOM_API_KEY is not set, so no call can be read and nothing can be drafted", True)
        guarded("fathom", True, fathom_check)

        def maqsam_check() -> None:
            try:
                mq = maqsam_mod.Maqsam(key("MAQSAM_ACCESS_KEY"), key("MAQSAM_SECRET"))
                seats = maqsam_mod.seats(_sb(cfg)) if cfg.supabase_configured else []
                if seats:
                    end = datetime.now(timezone.utc)
                    page = mq.get("/v3/calls", {"email": seats[0], "start_time": int((end - timedelta(days=1)).timestamp()),
                                                "end_time": int(end.timestamp()), "page": 1})
                    n = len(page.get("message") or []) if isinstance(page, dict) else 0
                    add("maqsam", True, f"answers: {n} of one seat's calls in the last day on the first page; "
                                        f"{len(seats)} seat(s) carry a Maqsam address")
                else:
                    add("maqsam", None, "no rep or seat carries a maqsam_email, so no phone call is copied")
            except (maqsam_mod.MaqsamError, http.HttpError, SupabaseError) as e:
                add("maqsam", None, f"phone calls cannot be copied: {http.scrub(str(e))[:200]}")
        guarded("maqsam", False, maqsam_check)

        def highlevel_check() -> None:
            ghl_token = key("GHL_B2B_API_KEY") or key("SALES_GHL_TOKEN")
            if ghl_token:
                try:
                    followups_mod.ghl_probe(ghl_token)
                    add("highlevel", True, "answers: the sales sub-account's conversations can be read, as the follow-up "
                                           "agent and the template check need", True)
                except http.HttpError as e:
                    add("highlevel", False, f"HighLevel refused the desk's key ({e.status}): set GHL_B2B_API_KEY in "
                                            "/opt/data/bibi/api-keys.env. Until then follow-ups wait", True)
            else:
                add("highlevel", False, "GHL_B2B_API_KEY is not set, so the follow-up agent cannot read a conversation "
                                        "and writes nothing", True)
        guarded("highlevel", True, highlevel_check)

        if engine == "playwright" and not cron:
            def render_check() -> None:
                with tempfile.TemporaryDirectory() as tmp:
                    page = Path(tmp) / "probe.html"
                    page.write_text("<!doctype html><title>probe</title><p>ok</p>", encoding="utf-8")
                    ok = bool(render_mod.dom(page))
                    add("render", ok or None, "Chrome renders a page through Playwright" if ok else
                        "Playwright is installed but could not render a page: run python3 -m playwright install "
                        "chromium, or set CHROME_PATH to a Chrome this user can run")
            guarded("render", False, render_check)

    blockers = [r for r in rows if r["required"] and r["ok"] is False]
    unknown = [r for r in rows if r["required"] and r["ok"] is None]
    if args.json:
        _print({"checks": rows, "blockers": [b["detail"] for b in blockers]}, True)
    elif not (cron and args.quiet and not blockers):
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
        # Missing is never zero: a check that could not say is named, not
        # counted as passed.
        detail = ("ready" if not blockers else "blocked: " + " | ".join(b["detail"] for b in blockers)) + \
            ("; not known: " + " | ".join(f"{u['check']} ({u['detail']})" for u in unknown) if unknown else "")
        _status(cfg, log, "doctor", not blockers, detail)
        if probed is not None:
            _model_status(cfg, log, probed[0], probed[1], outage=probed[2])
    return 1 if blockers else 0


def _agent_checks(sb: Supabase, add: Callable[..., None]) -> None:
    """What the follow-up agent and the waves need beyond the desk's own
    tables, said plainly; none of it blocks the other jobs."""
    missing = []
    for table in (followups_mod.STOPS, waves_mod.WAVES, waves_mod.MEMBERS, waves_mod.META):
        try:
            sb.select(table, "select=*&limit=1")
        except (http.HttpError, SupabaseError):
            missing.append(table)
    add("agent tables", None if missing else True,
        "not there yet (migration 20261003c): " + ", ".join(missing) + ". Stop words still leave leads alone, but "
        "no rep is asked about them, and no wave can run" if missing else "stops, waves, members and meta answer")
    try:
        gate = followups_mod.wa_gate(sb.setting("whatsapp_guard"))
    except (http.HttpError, SupabaseError):
        gate = followups_mod.GATE_CLOSED
    add("whatsapp gate", None if gate else True, gate.rstrip(".") if gate else
        "open: the WA Connector is off and the single-copy test passed")
    # The database's kind check must allow `reactivate` (migration 20261003b)
    # or it refuses every opener. Nothing is written to find out: an opener
    # already there proves it, and none yet is said as not known.
    try:
        seen = sb.select("cockpit_sales_followups", "select=id&segment=eq.reactivate&limit=1")
        add("reactivate kind", True if seen else None,
            "accepted: openers are in the database" if seen else
            "not known yet: no opener has been written. Until migration 20261003b lands, the database refuses "
            "every opener and the waves row says so")
    except (http.HttpError, SupabaseError) as e:
        add("reactivate kind", None, f"could not be read: {http.scrub(str(e))[:120]}")
    routes = waves_mod._routes(sb)
    add("opener templates", True if len(routes) == 2 else None,
        "opener_ar and opener_en are set up" if len(routes) == 2 else
        "not set up: " + ", ".join(k for lang, k in waves_mod.OPENERS.items() if lang not in routes)
        + ". Waves write no opener without them")


def _resync_stuck(cfg: Config, log: Logger) -> str:
    """Dialer saves HighLevel has not taken, sent again by sales-api (the call
    centre's durable-worker lesson). Best effort: a failure here is a warning,
    never the requests job's own failure. Empty when nothing was stuck."""
    try:
        _, _, raw = http.request(
            "POST", f"{cfg.supabase_url.rstrip('/')}/functions/v1/sales-api",
            headers={"Authorization": f"Bearer {cfg.supabase_key}", "Content-Type": "application/json",
                     "x-region": "eu-west-1"},
            data=json.dumps({"action": "dial.resync_stuck"}).encode(),
            timeout=60, retries=0,
        )
        out = json.loads(raw.decode("utf-8") or "{}")
    except Exception as e:  # noqa: BLE001 - the resend is a courtesy to the requests job
        log.warn(f"requests: stuck dialer saves could not be sent again: {http.scrub(str(e))[:160]}")
        return ""
    tried = int(out.get("tried") or 0)
    if not tried:
        return ""
    return f"{int(out.get('written') or 0)} of {tried} stuck dialer saves sent to HighLevel again"


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
    resent = _resync_stuck(cfg, log)
    if resent:
        detail += f"; {resent}"
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
    fathom_days = args.fathom_days
    if fathom_days is None:
        try:
            fathom_days = int(key("SALES_VAULT_FATHOM_DAYS", "14"))
        except ValueError:
            fathom_days = 14

    def outsiders(since: datetime) -> set[str]:
        """The recordings since then that Fathom says someone from outside was
        on: one list read, only the meetings it flags (ten a page)."""
        f = queue_mod.fathom_client(cfg, log.info)
        return {str(m.get("recording_id")) for m in f.meetings(since=since, domains_type="one_or_more_external",
                                                               max_pages=400) if m.get("recording_id") is not None}

    try:
        out = calls_vault_mod.run(
            sb, vault, log.info, dry=args.dry, fathom_outsiders=outsiders, fathom_days=max(0, fathom_days),
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
                  f"{out['by_appointment']} by appointment, {out['unmatched']} unmatched "
                  f"({out['outsider_joined']} with no lead on the invite but someone from outside on the call), "
                  f"{out['lead_calls']} from notes the vault could not place whose invitee is a lead, "
                  f"{out['transcripts_uploaded']} transcripts uploaded, "
                  f"{out.get('filled_fathom_rows', 0)} of the Fathom step's calls filled in"
                  + (f"; Fathom {out['fathom']}" if str(out.get("fathom")).startswith("could not") else ""))
    if not args.dry:
        _status(cfg, log, "calls-vault", bool(out.get("notes")), detail)
    _print(out if args.json else detail, args.json)
    return 0


def cmd_maqsam_calls(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Every answered phone call with a transcript, from Maqsam into the cockpit."""
    sb = _sb(cfg)
    try:
        mq = maqsam_mod.Maqsam(key("MAQSAM_ACCESS_KEY"), key("MAQSAM_SECRET"))
        out = maqsam_mod.run(
            sb, mq, log.info, days=args.days, dry=args.dry, limit=args.limit,
            upload=lambda path, blob: sb.upload_to(calls_vault_mod.TRANSCRIPT_BUCKET, path, blob,
                                                   "text/markdown; charset=utf-8"),
        )
    except maqsam_mod.MaqsamError as e:
        if not args.dry:
            _status(cfg, log, "maqsam-calls", False, str(e))
        log.error(str(e))
        return 1
    if not out["seats"]:
        detail = "no rep or seat carries a Maqsam address, so no phone call was copied"
    else:
        detail = (f"{out['rows']} answered phone calls with a transcript "
                  + (f"(a first try that stopped at {args.limit}) " if args.limit is not None
                     else f"from {out['seats']} seats ")
                  + f"({out['first'] or '?'} to {out['last'] or '?'}), {out['by_phone']} matched to a lead by phone, "
                  f"{out['unmatched']} unmatched, {out['uploaded']} transcripts uploaded"
                  + (f"; could not read {', '.join(out['seats_unread'])}" if out["seats_unread"] else "")
                  + f"; {out['dials_said']}")
    if not args.dry:
        _status(cfg, log, "maqsam-calls", bool(out["seats"]) and not out["seats_unread"]
                and not out["dials"]["errors"], detail)
    _print(out if args.json else detail, args.json)
    return 1 if out["seats_unread"] and not out["rows"] else 0


def cmd_calls_b2b_fathom(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Ahmed's private Fathom calls that only B2B holds, copied once."""
    if not args.once:
        log.error("calls-b2b-fathom copies B2B's calls once and is not a cron job; run it with --once "
                  "(and --dry-run first)")
        return 2
    sb = _sb(cfg)
    vault = Path(args.vault or key("SALES_VAULT", "/opt/data/obsidian-sync-vault")).expanduser()
    if not (vault / "Calls").is_dir():
        log.warn(f"no vault at {vault}: calls the vault holds cannot be told apart, so only what is in "
                 "the cockpit is skipped")
    try:
        b2b = b2b_fathom_mod.B2B(key("SALES_B2B_MGMT_TOKEN"))
        out = b2b_fathom_mod.run(
            sb, b2b, log.info, emails=args.email or [b2b_fathom_mod.AHMED], vault=vault, dry=args.dry,
            limit=args.limit,
            upload=lambda path, blob: sb.upload_to(calls_vault_mod.TRANSCRIPT_BUCKET, path, blob,
                                                   "text/markdown; charset=utf-8"),
        )
    except b2b_fathom_mod.B2BError as e:
        log.error(str(e))
        return 1
    detail = (f"{out['rows']} of {out['in_b2b']} calls copied from B2B ({out['first'] or '?'} to "
              f"{out['last'] or '?'}): {out['in_cockpit']} were in the cockpit, {out['in_vault']} are the "
              f"vault's, {out['client_service']} client-service, {out['team']} team; {out['with_transcript']} "
              f"with a transcript, {out['by_email'] + out['by_appointment'] + out['by_b2b']} matched to a lead")
    _print(out if args.json else detail, args.json)
    return 0


def cmd_reviews_import(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Vince's archived reviews into the cockpit, joined to their calls."""
    sb = _sb(cfg)
    folder = Path(args.folder or (cfg.home / "vince")).expanduser()
    try:
        out = reviews_mod.import_archive(sb, folder, log.info, dry=args.dry)
    except FileNotFoundError as e:
        log.error(str(e))
        return 1
    _print(out, True)
    return 0


def review_provider(cfg: Config, log: Logger) -> Any:
    """The model Vince writes with: the desk's own provider and key (the VPS
    keys), SALES_REVIEW_MODEL when set, and plain text rather than JSON;
    metered like every other job's."""
    model = key("SALES_REVIEW_MODEL", "").strip() or cfg.model
    model_mod.check_model(model, setting="SALES_REVIEW_MODEL")
    if (cfg.provider or "vps") == "openai":
        if not cfg.openai_key:
            raise model_mod.ModelUnreachable("OPENAI_API_KEY is not set, so Vince cannot review calls.")
        return model_mod.metered(model_mod.OpenAIShaped("openai", model_mod.OPENAI_URL, cfg.openai_key, model,
                                                        max_tokens=cfg.max_tokens, reasoning_effort=cfg.reasoning_effort,
                                                        json_mode=False, log=log.info))
    cfg.model = model
    return model_mod.provider(cfg, log.info)


def cmd_reviews(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Vince reviews the newest sales calls nobody has reviewed yet."""
    sb = _sb(cfg)
    knowledge = Path(key("SALES_VINCE_DIR", str(cfg.home / "vince"))).expanduser()
    missing = [f for f in ("coaching-log-template.md", "sales-framework.md",
                           "intro-coaching-log-template.md", "intro-call-framework.md")
               if not (knowledge / f).is_file()]
    if missing:
        detail = f"Vince's knowledge files are missing from {knowledge}: {', '.join(missing)}"
        _status(cfg, log, "reviews", False, detail)
        log.error(detail)
        return 1
    since_text = key("SALES_REVIEW_SINCE", "2026-08-24").strip()
    since = datetime.fromisoformat(since_text).replace(tzinfo=timezone.utc) if args.days is None else (
        datetime.now(timezone.utc) - timedelta(days=args.days))
    # What reps asked for goes first, every run; with --asked, only that
    # (the two-minute cron), so an ask is answered in minutes.
    try:
        p = review_provider(cfg, log)
        asked = reviews_mod.review_asked(sb, p, log.info, knowledge=knowledge, limit=args.limit or 3,
                                         timeout=cfg.model_timeout, warn=log.warn)
        out = {"due": 0, "reviewed": 0, "failed": 0, "set_aside": 0, "errors": []} if args.asked else \
            reviews_mod.review_new(sb, p, log.info, knowledge=knowledge, since=since, limit=args.limit or 2,
                                   min_chars=cfg.min_transcript_chars, timeout=cfg.model_timeout, warn=log.warn)
    except model_mod.ModelUnreachable as e:
        _status(cfg, log, "reviews", False, str(e))
        log.error(str(e))
        return 1
    parts = []
    if asked["asked"]:
        parts.append(f"{asked['reviewed']} asked-for reviewed, {asked['failed']} failed of {asked['asked']} asked"
                     + (f": {asked['errors'][0]}" if asked["errors"] else ""))
    if asked.get("freed"):
        parts.append(f"{asked['freed']} asks a stopped run had left half-done freed")
    if out["due"]:
        parts.append(f"{out['reviewed']} reviewed, {out['failed']} failed of {out['due']} due"
                     + (f": {out['errors'][0]}" if out["errors"] else ""))
    if out.get("set_aside"):
        parts.append(f"{out['set_aside']} set aside for a day after failing twice")
    detail = "; ".join(parts) or "nothing to review"
    failed, done = asked["failed"] + out["failed"], asked["reviewed"] + out["reviewed"]
    # The two-minute run reports only when it had work, so the half-hourly
    # line is not overwritten by "nothing" every two minutes.
    if not args.asked or asked["asked"] or asked.get("freed"):
        _status(cfg, log, "reviews", not failed, detail)
    if asked["asked"] or asked.get("freed") or out["due"] or args.json:
        _print({"asked": asked, "new": out} if args.json else detail, args.json)
    return 1 if failed and not done else 0


def cmd_research(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Research the leads the cockpit asked about. Quiet when nothing is queued."""
    sb = _sb(cfg)
    if not cfg.openai_key:
        _status(cfg, log, "research", False, "OPENAI_API_KEY is not set, so the researcher cannot search.")
        return 1
    model = key("SALES_RESEARCH_MODEL", "").strip() or "gpt-5"
    try:
        model_mod.check_model(model, setting="SALES_RESEARCH_MODEL")
    except model_mod.ModelUnreachable as e:
        _status(cfg, log, "research", False, str(e))
        log.error(str(e))
        return 1
    apify = key("APIFY_API_KEY") or key("APIFY_TOKEN")
    out = research_mod.run(sb, cfg, log.info, host=WORKER, limit=args.limit or 3, model=model, apify_key=apify,
                           warn=log.warn)
    if out["seen"] or out.get("reaped") or args.json:
        detail = (f"{out['done']} researched, {out['failed']} failed" + ("" if apify else " (no Apify key: web search only)")
                  + (f"; {out['reaped']} a stopped run had left half-done freed" if out.get("reaped") else ""))
        _status(cfg, log, "research", not out["failed"], detail)
        _print(out if args.json else detail, args.json)
    return 0


def desk_api(cfg: Config, timeout: float = 90) -> Callable[[str, dict[str, Any]], tuple[int, dict[str, Any]]]:
    """The cockpit's own door, asked by the desk with its service key: the
    answer's status with its body, a refusal included (409, 429 ...)."""
    def call(action: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        status, _, raw = http.request(
            "POST", f"{cfg.supabase_url.rstrip('/')}/functions/v1/sales-api",
            headers={"Authorization": f"Bearer {cfg.supabase_key}", "Content-Type": "application/json",
                     "x-region": "eu-west-1"},
            data=json.dumps({"action": action, **payload}).encode(),
            timeout=timeout, retries=0, ok_statuses=(200, 400, 403, 404, 409, 429, 500, 502, 503),
        )
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            body = {"error": raw.decode("utf-8", "replace")[:300]}
        return status, body if isinstance(body, dict) else {"result": body}
    return call


def followups_words(out: dict[str, Any]) -> str:
    """The follow-ups job's status line from a run's counts."""
    if "skipped" in out:
        return str(out["skipped"])
    if out.get("model_down"):
        due = out.get("picked")
        return (f"No drafts can be written: {str(out['model_down']).rstrip('.')}. "
                + (f"{due} leads are due and wait" if due else "No lead is due right now")
                + (f"; {out['went_stale']} stale drafts closed" if out.get("went_stale") else ""))
    words = {"whatsapp": "WhatsApp", "whatsapp_template": "WhatsApp template", "email": "email"}
    channels = ", ".join(f"{n} {words.get(k, k)}" for k, n in (out.get("by_channel") or {}).items())
    settled = out.get("settled") or {}
    return (f"{out['written']} drafts written of {out['picked']} leads due"
            + (f" ({channels})" if channels else "")
            + (f", {out['sent_by_itself']} sent by themselves" if out.get("sent_by_itself") else "")
            + (f", {out['kept_for_a_person']} kept for a person to send" if out.get("kept_for_a_person") else "")
            + (f", {out['held_for_automation']} waiting while a HighLevel automation messages them"
               if out.get("held_for_automation") else "")
            + (f", {out['in_a_conversation']} already talking with a rep" if out.get("in_a_conversation") else "")
            + (f", {out['already_answered']} already answered" if out.get("already_answered") else "")
            + (f", {out['asked_to_stop']} asked to stop (a rep confirms)" if out.get("asked_to_stop") else "")
            + (f", {out['paused']} paused for 30 days after a stop word" if out.get("paused") else "")
            + (", stop words not kept for a rep: the stops table cannot be read" if out.get("stops_unread") else "")
            + (f", {out['conversation_unreadable']} waiting because HighLevel could not be read"
               if out.get("conversation_unreadable") else "")
            + (f", {out['no_open_channel']} with no open channel" if out.get("no_open_channel") else "")
            + (f", {out['not_sales_leads']} not sales leads (clients, or no pipeline)" if out.get("not_sales_leads") else "")
            + (f", {out['set_aside']} set aside for a day after failing twice" if out.get("set_aside") else "")
            + (f", {out['raced']} written meanwhile by another run" if out.get("raced") else "")
            + (f", {out['replies_marked']} replies to earlier messages" if out.get("replies_marked") else "")
            + (f", {out['went_stale']} stale drafts closed" if out.get("went_stale") else "")
            + (f", {out['reason_gone']} drafts closed because their reason is gone" if out.get("reason_gone") else "")
            + (f", {out['stuck_freed']} sends that stopped halfway freed" if out.get("stuck_freed") else "")
            + (f", {settled.get('gone', 0) + settled.get('failed', 0)} sends settled"
               + (f" ({settled['failed']} failed at HighLevel)" if settled.get("failed") else "")
               if settled.get("gone") or settled.get("failed") else "")
            + (f", {out['failed']} failed" if out.get("failed") else ""))


def cmd_followups(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Write follow-up drafts for the leads who need one now, for their reps to approve.

    With --contact, the test path: one contact tagged cockpit-test, no other
    lead's rows touched, nothing sent by itself, no status row written (a
    test run is no sign the cron is alive)."""
    test = bool(getattr(args, "contact", None))
    if getattr(args, "segment", None) and not test:
        log.error("--segment drafts a kind for a test contact only: give --contact as well.")
        return 2
    ghl_token = key("GHL_B2B_API_KEY") or key("SALES_GHL_TOKEN")
    if not ghl_token:
        # Without it every conversation reads as empty: no automation's
        # message, no stop, no window. Nothing is written instead.
        detail = ("GHL_B2B_API_KEY is not set, so the follow-up agent cannot read a conversation and writes nothing. "
                  "Set it in /opt/data/bibi/api-keys.env.")
        if not test:
            _status(cfg, log, "followups", False, detail)
        log.error(detail)
        return 1
    sb = _sb(cfg)
    settings = sb.setting("followups") or {}
    try:
        model = key("SALES_FOLLOWUP_MODEL", "").strip()
        if model:
            model_mod.check_model(model, setting="SALES_FOLLOWUP_MODEL")
            cfg.model = model
        p = model_mod.provider(cfg, log.info)
    except model_mod.ModelUnreachable as e:
        if not test:
            _status(cfg, log, "followups", False, str(e))
            _model_status(cfg, log, False, str(e))  # no model at all: never an old "answered" left green
        log.error(str(e))
        return 1
    # One token first: a lapsed sign-in is said on the status row every run,
    # not only when a draft happens to be tried (it hid for days behind
    # "0 drafts written").
    # Only an outage (the sign-in, the proxy gone, the plan's limit) stops
    # the drafting; a probe that merely timed out is said, and drafting is
    # still tried, each draft with its own retries.
    model_down = None
    if getattr(args, "segment", None) != "reactivate":
        ok, said, outage = model_probe(p, 30)
        if outage:
            model_down = said
        elif not ok:
            log.warn(f"followups: {said}; drafting is tried all the same")
        if not test:
            _model_status(cfg, log, ok, said, outage=outage)
    try:
        guard = sb.setting("whatsapp_guard")
    except (SupabaseError, http.HttpError):
        guard = None  # unreadable: the gate stays shut

    def sales_api(action: str, followup_id: str) -> dict:
        _, body = desk_api(cfg, timeout=60)(action, {"id": followup_id})
        return body

    out = followups_mod.run(sb, p, log.info, settings=settings, ghl_token=ghl_token, warn=log.warn,
                            autosend=lambda i: sales_api("followup.autosend", i),
                            settle=lambda i: sales_api("followup.settle", i),
                            only_contact=getattr(args, "contact", None), force_segment=getattr(args, "segment", None),
                            model_down=model_down, guard=guard if isinstance(guard, dict) else {})
    detail = followups_words(out)
    if test:
        _print(out if args.json else ("Test run: " + detail), args.json)
        return 0 if out.get("written") else 1
    _status(cfg, log, "followups", not out.get("failed") and not out.get("model_down"), detail)
    if out.get("written") or out.get("failed") or out.get("model_down") or args.json:
        _print(out if args.json else detail, args.json)
    return 1 if out.get("model_down") else 0


def cmd_waves(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Backlog waves: enrol, keep members in step, write the day's openers,
    send what a person approved, paced. --pools only counts the pools."""
    sb = _sb(cfg)
    settings = sb.setting("followups") or {}
    if getattr(args, "pools", False):
        summary = waves_mod.pools_summary(sb, datetime.now(timezone.utc), waves_mod.settings_of(settings))
        _print(summary if args.json else "\n".join(
            f"{waves_mod.POOL_WORDS[k]}: {v['leads']} leads, {v['held_back']} held back, {v['to_message']} to message"
            for k, v in summary.items()), args.json)
        return 0
    try:
        guard = sb.setting("whatsapp_guard")
    except (SupabaseError, http.HttpError):
        guard = None
    try:
        out = waves_mod.run(sb, desk_api(cfg), settings=settings, guard=guard if isinstance(guard, dict) else {},
                            ghl_token=key("GHL_B2B_API_KEY") or key("SALES_GHL_TOKEN"), log=log.info, warn=log.warn,
                            budget_s=float(getattr(args, "budget", None) or 270))
    except Exception as e:  # noqa: BLE001 - said on the status row, never a silent death
        detail = f"The waves job stopped: {http.scrub(str(e))[:300]}"
        _status(cfg, log, "waves", False, detail)
        log.error(detail)
        return 1
    ok, detail = waves_mod.words(out)
    _status(cfg, log, "waves", ok, detail)
    busy = (out.get("enrolled") or (out.get("drafted") or {}).get("drafted") or (out.get("sent") or {}).get("sent")
            or (out.get("sent") or {}).get("stopped"))
    if busy or args.json:
        _print(out if args.json else detail, args.json)
    return 0 if ok else 1


def cmd_rooms(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Make the video rooms the cockpit asks for: about a minute a run, a tick
    every second, under a cron line every minute (README, Video rooms)."""
    sb = rooms_mod.supabase(cfg.supabase_url, cfg.supabase_key)
    worker = rooms_mod.Worker.from_env(sb, cfg.supabase_url, cfg.supabase_key, log)
    if args.check_hosts:
        # Its own cron line every 10 minutes (README), so it never holds a
        # new room up; its status row is room-hosts.
        try:
            out = worker.check_hosts()
        except (SupabaseError, http.HttpError, rooms_mod.TablesMissing) as e:
            reason = rooms_mod.db_reason(e) if isinstance(e, http.HttpError) else http.scrub(str(e))[:300]
            log.error(f"rooms: the host check stopped: {reason}")
            _status(cfg, log, rooms_mod.HOSTS_JOB, False, f"The host check stopped: {reason}")
            return 1
        if args.json or not out["ok"] or not args.quiet:
            _print(out if args.json else "\n".join(out["lines"]), args.json)
        return 0 if out["ok"] else 1
    seconds = 0.0 if args.once else max(0.0, args.for_s)
    out = worker.run(seconds=seconds, every=max(0.2, args.every), max_claims=max(1, args.max_claims))
    if args.json or out["made"] or out["failed"] or out.get("blocked"):
        _print(out, True)
    return 1 if out.get("blocked") else 0


def cmd_deploy_check(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Is this box ready for live calls and the follow-up agent with every
    switch still off? Keys by name, the tables, columns, function and
    settings the code needs, the switches, the status rows and the crontab.
    It changes nothing: GETs only, no status row, no file."""
    sb = None
    if cfg.supabase_configured:
        sb = Supabase(cfg.supabase_url, cfg.supabase_key, timeout=10)
    report = deploycheck_mod.run(sb)
    if args.json:
        _print({"checks": report.rows, "blockers": [b["detail"] for b in report.blockers]}, True)
    else:
        print(deploycheck_mod.words(report))
    return 1 if report.blockers else 0


def notes_provider(cfg: Config, log: Logger) -> Any:
    """The model the call notes and digests are written with: the desk's own
    provider on the VPS key, SALES_NOTES_MODEL when set; never DeepSeek."""
    model = key("SALES_NOTES_MODEL", "").strip()
    if model:
        model_mod.check_model(model, setting="SALES_NOTES_MODEL")
        cfg.model = model
    return model_mod.provider(cfg, log.info)


def cmd_notes(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Notes after every recorded sales call: what was said, the objections, what the closer needs, a verdict."""
    sb = _sb(cfg)
    since = datetime.now(timezone.utc) - timedelta(days=args.days or 60)
    try:
        p = notes_provider(cfg, log)
        out = notes_mod.run_notes(sb, p, log.info, since=since, limit=args.limit or 4,
                                  min_chars=cfg.min_transcript_chars, timeout=cfg.model_timeout, warn=log.warn)
    except model_mod.ModelUnreachable as e:
        _status(cfg, log, "notes", False, str(e))
        log.error(str(e))
        return 1
    detail = ((f"{out['written']} written, {out['failed']} failed of {out['due']} due"
               + (f": {out['errors'][0]}" if out["errors"] else "")) if out["due"] else
              "no other call is due" if out.get("set_aside") else "every call has its notes")
    detail += f"; {out['set_aside']} set aside for a day after failing twice" if out.get("set_aside") else ""
    _status(cfg, log, "notes", not out["failed"], detail)
    if out["due"] or out.get("set_aside") or args.json:
        _print(out if args.json else detail, args.json)
    return 1 if out["failed"] and not out["written"] else 0


def digest_words(o: dict[str, Any]) -> str:
    """One digest's line: from how many of the window's calls, and the past calls nobody has marked."""
    calls = f"{o['calls']} of {o['of']} calls (partial)" if o.get("partial") else f"{o['calls']} calls"
    return (f"{o['days']} days from {calls}"
            + (f", {o['unmarked']} past calls nobody has marked yet" if o.get("unmarked") else ""))


def cmd_digest(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """What prospects keep saying over the last 7 and 30 days, from the call notes."""
    sb = _sb(cfg)
    try:
        p = notes_provider(cfg, log)
        outs = [notes_mod.run_digest(sb, p, log.info, days=d, timeout=cfg.model_timeout,
                                     min_chars=cfg.min_transcript_chars)
                for d in ([args.days] if args.days else [7, 30])]
    except model_mod.ModelUnreachable as e:
        _status(cfg, log, "digest", False, str(e))
        log.error(str(e))
        return 1
    except model_mod.ModelError as e:
        _status(cfg, log, "digest", False, str(e))
        log.error(str(e))
        return 1
    detail = "; ".join(digest_words(o) for o in outs)
    _status(cfg, log, "digest", True, detail)
    _print(outs if args.json else detail, args.json)
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


def cmd_form_sync(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """The New Client Form's questions into the `client_form` setting now,
    for the list the cockpit shows beside the embedded form."""
    sb = _sb(cfg)
    clientform_mod.sync_client_form(sb, cfg.typeform_key, log.info, force=True)
    value = sb.setting(clientform_mod.SETTING_KEY) or {}
    count = sum(len(s.get("questions") or []) for s in value.get("screens") or [])
    detail = f"{count} questions on {len(value.get('screens') or [])} screens, form changed {value.get('form_updated_at')}"
    _status(cfg, log, "form-sync", True, detail)
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
    d.add_argument("--cron", action="store_true", help="the hourly run: one-token model probe, no render, quiet when ready")
    rq = sub.add_parser("requests"); rq.add_argument("--limit", type=int)
    rc = sub.add_parser("recordings"); rc.add_argument("--days", type=int)
    cv = sub.add_parser("calls-vault"); cv.add_argument("--vault")
    cv.add_argument("--dry", "--dry-run", dest="dry", action="store_true")
    cv.add_argument("--fathom-days", type=int,
                    help="ask Fathom about the sales calls of the last N days whose note cannot say whether "
                         "someone from outside joined (default 14 or SALES_VAULT_FATHOM_DAYS; 0: never; "
                         "a long N once fills the history)")
    mq = sub.add_parser("maqsam-calls"); mq.add_argument("--days", type=int)
    mq.add_argument("--dry", "--dry-run", dest="dry", action="store_true")
    mq.add_argument("--limit", type=int, help="stop after N calls (a first try by hand); the mark is not moved")
    bf = sub.add_parser("calls-b2b-fathom"); bf.add_argument("--once", action="store_true")
    bf.add_argument("--dry", "--dry-run", dest="dry", action="store_true")
    bf.add_argument("--limit", type=int); bf.add_argument("--vault")
    bf.add_argument("--email", action="append", help="whose calls to copy (default Ahmed's); repeatable")
    ri = sub.add_parser("reviews-import"); ri.add_argument("--folder"); ri.add_argument("--dry", action="store_true")
    rv = sub.add_parser("reviews"); rv.add_argument("--limit", type=int); rv.add_argument("--days", type=int)
    rv.add_argument("--asked", action="store_true", help="only the calls reps asked to have reviewed")
    rs = sub.add_parser("research"); rs.add_argument("--limit", type=int)
    fo = sub.add_parser("followups")
    fo.add_argument("--contact", help="draft only for this contact, which must be tagged cockpit-test (the test path)")
    fo.add_argument("--segment", choices=list(followups_mod.SEGMENTS),
                    help="with --contact: draft this kind's first message whether or not it is due")
    wv = sub.add_parser("waves"); wv.add_argument("--pools", action="store_true",
                                                  help="count each backlog pool and its holdout; writes nothing")
    wv.add_argument("--budget", type=float, help="seconds this run may take (default 270, for a cron every 5 minutes)")
    ro = sub.add_parser("rooms")
    ro.add_argument("--for", dest="for_s", type=float, default=rooms_mod.RUN_SECONDS,
                    help="seconds this run polls for (57 under the every-minute cron line)")
    ro.add_argument("--every", type=float, default=rooms_mod.EVERY, help="seconds between ticks")
    ro.add_argument("--max-claims", type=int, default=rooms_mod.MAX_CLAIMS, help="rooms claimed per tick")
    ro.add_argument("--once", action="store_true", help="one tick, by hand")
    ro.add_argument("--check-hosts", action="store_true",
                    help="check every seat's Zoom user and the Google sign-in now, write room_hosts, and stop")
    sub.add_parser("deploy-check", help="is this box ready, every switch still off? changes nothing")
    dp = sub.add_parser("deploy", help="deploy check: the same as deploy-check")
    dp.add_argument("what", choices=["check"])
    nt = sub.add_parser("notes"); nt.add_argument("--limit", type=int); nt.add_argument("--days", type=int)
    dg = sub.add_parser("digest"); dg.add_argument("--days", type=int, choices=(7, 30))
    sub.add_parser("status")
    sub.add_parser("offer-sync")
    sub.add_parser("form-sync")
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
    if args.cmd in ("deploy", "deploy-check"):
        args.cmd = "deploy-check"  # changes nothing, not even the desk's own folders
    else:
        cfg.ensure_dirs()
    log = Logger(quiet=args.quiet)
    handlers: dict[str, Callable[[Config, argparse.Namespace, Logger], int]] = {
        "doctor": cmd_doctor, "requests": cmd_requests, "recordings": cmd_recordings, "status": cmd_status,
        "calls-vault": cmd_calls_vault, "reviews-import": cmd_reviews_import, "reviews": cmd_reviews,
        "maqsam-calls": cmd_maqsam_calls, "calls-b2b-fathom": cmd_calls_b2b_fathom,
        "research": cmd_research, "followups": cmd_followups, "waves": cmd_waves, "notes": cmd_notes,
        "digest": cmd_digest, "rooms": cmd_rooms, "deploy-check": cmd_deploy_check,
        "validate": cmd_validate, "build": cmd_build, "draft": cmd_draft, "offer-sync": cmd_offer_sync, "form-sync": cmd_form_sync,
    }
    if args.cmd in METERED and cfg.supabase_configured:
        _meter(cfg, args.cmd, log)
    try:
        return handlers[args.cmd](cfg, args, log)
    except (SupabaseError, http.HttpError, NotNow, Refused) as e:
        log.error(http.scrub(str(e))[:400])
        # A dry run and a test run (followups --contact) say nothing on the
        # status rows: neither is the cron's own run.
        if args.cmd in ("requests", "recordings", "status", "offer-sync", "form-sync", "calls-vault", "reviews", "research",
                        "followups", "waves", "maqsam-calls", "notes", "digest", "doctor", "rooms") \
                and not getattr(args, "dry", False) and not getattr(args, "contact", None) \
                and not getattr(args, "offline", False) and not getattr(args, "pools", False):
            _status(cfg, log, args.cmd, False, http.scrub(str(e))[:400])
        return 1
    except KeyboardInterrupt:
        return 130
    finally:
        # A meter counts one command's calls, under that command's name.
        model_mod.meter(None)


if __name__ == "__main__":
    sys.exit(main())
