#!/usr/bin/env python3
"""Sales desk: proposals drafted from demo calls, and the calls indexed per rep.

    python3 desk.py doctor [--offline]      every key by name, each service, each blocker in a sentence
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
from desk import references as references_mod  # noqa: E402
from desk import render as render_mod  # noqa: E402
from desk import followups as followups_mod  # noqa: E402
from desk import research as research_mod  # noqa: E402
from desk import reviews as reviews_mod  # noqa: E402
from desk import validate as validate_mod  # noqa: E402
from desk.config import DEFAULT_MODELS, FALLBACK_JOBS, WORKER, Config, key  # noqa: E402
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

    model_mod.meter(model_mod.Meter(job=job, cap=cap, used_today=used_today, record=usage_recorder(sb, log.warn),
                                    warn=log.warn))


USAGE_PROVIDER_MIGRATION = "supabase/migrations/20261004p_sales_ai_usage_provider.sql"


def usage_recorder(sb: Supabase, warn: Callable[[str], None]) -> Callable[[dict[str, Any]], None]:
    """One cockpit_sales_ai_usage row per model call, naming the provider that
    answered. Until the provider column exists (USAGE_PROVIDER_MIGRATION), the
    row is written without it and the provider goes into the model instead
    ("openrouter:anthropic/claude-opus-4.8"), so no call goes uncounted."""
    state = {"column": True}

    def write(row: dict[str, Any]) -> None:
        sb.rest("POST", "cockpit_sales_ai_usage", json_body=[row], prefer="return=minimal", retries=0)

    def record(row: dict[str, Any]) -> None:
        if state["column"] or "provider" not in row:
            try:
                write(row)
                return
            except http.HttpError as e:
                body = e.body.decode("utf-8", "replace") if isinstance(e.body, (bytes, bytearray)) else str(e.body)
                if "provider" not in row or "provider" not in body or e.status not in (400, 404):
                    raise
                state["column"] = False
                warn("the AI usage table has no provider column yet, so each row names its provider inside the "
                     f"model (openrouter:anthropic/claude-opus-4.8) until {USAGE_PROVIDER_MIGRATION} is applied")
        row = dict(row)
        name = row.pop("provider", None)
        if name and row.get("model") and not str(row["model"]).startswith(f"{name}:"):
            row["model"] = f"{name}:{row['model']}"
        write(row)

    return record


def model_rows(cfg: Config, log: Logger, *, online: bool, primary: Callable[..., Any] = model_mod.provider,
               fallback: Callable[..., Any] = model_mod.fallback_provider) -> list[dict[str, Any]]:
    """The doctor's lines for the model: the primary, the fallback, and whether
    anything can draft. With a fallback for proposals, a primary that cannot
    answer is a warning and the doctor is blocked only when neither can."""
    rows: list[dict[str, Any]] = []

    def add(name: str, ok: Optional[bool], detail: str, required: bool = False) -> None:
        rows.append({"check": name, "ok": ok, "detail": detail, "required": required})

    fb_on = model_mod.fallback_for(cfg, "proposal")
    fname = (cfg.fallback or "none").strip().lower()
    fb_any = fname not in ("", "none") and fname != cfg.provider and bool(cfg.fallback_jobs)
    plabel = f"{cfg.provider} ({cfg.model})"
    add("model", True, f"SALES_MODEL_PROVIDER={cfg.provider}, SALES_PROPOSAL_MODEL={cfg.model}"
                       + ("" if cfg.model != DEFAULT_MODELS.get(cfg.provider) else " (the default)"))
    p, p_err = None, None
    try:
        p = primary(cfg, log.info)
        add("model key", True, "none needed: the Claude proxy on the VPS" if cfg.provider == "vps"
            else f"{model_mod.KEY_NAMES[cfg.provider]} set for {cfg.provider}", not fb_on)
    except NotNow as e:
        p_err = e if isinstance(e, model_mod.ModelUnreachable) else model_mod.ModelUnreachable(str(e))
        add("model key", False, str(e), not fb_on)

    f, f_err, fmodel = None, None, ""
    if not fb_any:
        why = ("the same as SALES_MODEL_PROVIDER, so it is no fallback" if fname == cfg.provider
               else "no job named in SALES_FALLBACK_JOBS" if fname not in ("", "none") else "off")
        add("fallback", None, f"SALES_MODEL_FALLBACK={fname}: {why}. When {cfg.provider} cannot answer, nothing is "
                              "drafted until it can; set SALES_MODEL_FALLBACK=openai in ~/.sales-desk/env (its key "
                              "is already on the VPS) for a second way")
    else:
        fmodel = model_mod.fallback_model(cfg)
        unknown = [j for j in cfg.fallback_jobs if j not in FALLBACK_JOBS]
        add("fallback", True if not unknown else None,
            f"SALES_MODEL_FALLBACK={fname}, model {fmodel} ("
            + ("SALES_FALLBACK_MODEL" if cfg.fallback_model else f"the closest to {cfg.model}")
            + f"), for {', '.join(cfg.fallback_jobs)} when {cfg.provider} cannot answer"
            + (f"; not jobs: {', '.join(unknown)} (the jobs are {', '.join(FALLBACK_JOBS)})" if unknown else ""))
        try:
            f = fallback(cfg, log.info)
            add("fallback key", True, "none needed: the Claude proxy on the VPS" if fname == "vps"
                else f"{model_mod.KEY_NAMES.get(fname, fname)} set for {fname}")
        except NotNow as e:
            f_err = e if isinstance(e, model_mod.ModelUnreachable) else model_mod.ModelUnreachable(str(e))
            add("fallback key", False, str(e))
    flabel = f"{fname} ({fmodel})"
    primary_ok, fallback_ok = p is not None, f is not None

    if online and p is not None:
        try:
            add("model answers", True, p.ping(), not fb_on)
        except NotNow as e:
            primary_ok = False
            p_err = e if isinstance(e, model_mod.ModelUnreachable) else model_mod.ModelUnreachable(str(e))
            add("model answers", False, str(e), not fb_on)
        except model_mod.ModelError as e:
            primary_ok = False
            p_err = model_mod.ModelUnreachable(f"{cfg.provider} did not answer a one-token call: {e}",
                                               cause=f"{cfg.provider} did not answer a one-token call")
            add("model answers", False, str(p_err), not fb_on)
        try:
            ids = p.models()
            if cfg.model in ids:
                add("model listed", True, f"{cfg.model} is one of the {len(ids)} models this key can use")
            else:
                usable = [i for i in ids if model_mod.model_allowed(i)]
                add("model listed", False, f"{cfg.model} is not among the models this key can use. Set "
                                           "SALES_PROPOSAL_MODEL to one of: " + ", ".join(usable[:20] or ids[:20]),
                    not fb_on)
        except (NotNow, model_mod.ModelError) as e:
            add("model listed", None, f"the model list could not be read: {e}")
        if getattr(p, "name", "") == "openai":
            streams = p.stream_check()
            if streams is False:
                add("model streams", None, "OpenAI will not stream this model to this organisation; drafts ask "
                                           "without streaming and wait for the whole answer instead")
            elif streams:
                add("model streams", True, "streaming works, so a long draft is timed by its silences")

    if online and f is not None:
        try:
            add("fallback answers", True, f.ping())
        except NotNow as e:
            fallback_ok = False
            f_err = e if isinstance(e, model_mod.ModelUnreachable) else model_mod.ModelUnreachable(str(e))
            add("fallback answers", False, str(e))
        except model_mod.ModelError as e:
            fallback_ok = False
            f_err = model_mod.ModelUnreachable(f"{fname} did not answer a one-token call: {e}",
                                               cause=f"{fname} did not answer a one-token call")
            add("fallback answers", False, str(f_err))
        try:
            ids = f.models()
            if fmodel in ids:
                add("fallback listed", True, f"{fmodel} is one of the {len(ids)} models {fname} lists")
            else:
                usable = [i for i in ids if model_mod.model_allowed(i) and "claude-" in i] or \
                         [i for i in ids if model_mod.model_allowed(i)]
                add("fallback listed", False, f"{fmodel} is not among the models {fname} lists. Set "
                                              "SALES_FALLBACK_MODEL to one of: " + ", ".join(usable[:12]))
        except (NotNow, model_mod.ModelError) as e:
            add("fallback listed", None, f"the model list could not be read: {e}")
        if fname == "openai" and callable(getattr(f, "stream_check", None)):
            streams = f.stream_check()
            if streams is False:
                add("fallback streams", None, f"OpenAI will not stream {fmodel} to this organisation; fallback "
                                              "drafts ask without streaming and wait for the whole answer instead")
            elif streams:
                add("fallback streams", True, "streaming works, so a long draft is timed by its silences")
        credit = f.credit() if fname == "openrouter" and callable(getattr(f, "credit", None)) else None
        if credit is not None:
            if credit > 0:
                add("fallback credit", True, f"${credit:,.2f} left on the OpenRouter account")
            else:
                fallback_ok = False
                f_err = model_mod.ModelUnreachable(
                    f"The OpenRouter account has ${credit:,.2f} left (credit bought less used), and OpenRouter refuses "
                    "paid calls once it is spent, whatever the key's own limit says. Top it up at "
                    "openrouter.ai/settings/credits, or set SALES_MODEL_FALLBACK=openai in ~/.sales-desk/env; "
                    "either works at once.",
                    cause="the openrouter account is out of credit")
                add("fallback credit", False, str(f_err))

    if fb_on:
        jobs = [j for j in cfg.fallback_jobs if j in FALLBACK_JOBS]
        if primary_ok:
            add("drafting", True, f"{plabel} {'answers' if online else 'is set up (not asked: --offline)'}; {flabel} "
                                  f"takes over for {', '.join(jobs)} if it cannot", True)
        elif fallback_ok:
            others = [j for j in FALLBACK_JOBS if j not in jobs]
            add("drafting", None, f"proposals draft through {flabel} while {plabel} cannot answer ("
                                  f"{p_err.cause if p_err else 'it did not answer'})"
                                  + (f"; so do {', '.join(j for j in jobs if j != 'proposal')}" if len(jobs) > 1 else "")
                                  + (f". {', '.join(others)} wait for {cfg.provider}" if others else ""), True)
        else:
            pc = p_err.cause if p_err else f"{cfg.provider} did not answer"
            fc = f_err.cause if f_err else f"{fname} did not answer"
            add("drafting", False, f"Neither {plabel} nor {flabel} can answer, so nothing can be drafted: {pc}, and "
                                   f"{fc}. Fixing either is enough. {p_err or ''} {f_err or ''}".strip(), True)
    return rows


HEADLESS_SHELL_HINT = ("set CHROME_PATH in ~/.sales-desk/env to Playwright's headless shell "
                       "(~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell)")
# The browser paths as the doctor names them (render.engine()'s words are for the log).
ENGINE_NAMES = {"playwright": "Playwright", "chrome one-shot": "Chrome's one-shot flags"}


def _browser_row(engine: str, chrome: Optional[str]) -> tuple[str, Optional[bool], str]:
    """Which browser path this machine takes. Whether it works is the render
    line's to say, from a real page (online doctor only)."""
    if engine == "playwright":
        return "browser", True, "Playwright, driving " + (chrome or "its own Chromium")
    if engine == "chrome one-shot":
        return "browser", True, (f"Chrome's one-shot flags on {chrome}; Playwright is not installed and is not "
                                 "needed while the render line passes")
    return "browser", None, ("no browser at all: the HTML is still made, but the PDF is skipped and overflow is not "
                             "measured, so nothing is tightened; " + HEADLESS_SHELL_HINT)


def _render_row(found: dict[str, Any]) -> tuple[str, Optional[bool], str]:
    """render.probe()'s answer as one sentence."""
    engine = found.get("engine") or ""
    how, took = ENGINE_NAMES.get(engine, engine or "the browser"), found.get("seconds") or 0
    if found.get("dom") and found.get("pdf"):
        return "render", True, f"{how} rendered a page and printed a PDF in {took:g}s"
    if found.get("dom"):
        return "render", None, (f"{how} rendered a page but printed no PDF, so drafts are measured and the PDF is "
                                "skipped; " + HEADLESS_SHELL_HINT)
    return "render", None, (f"{how} could not render a page, so overflow is not measured, nothing is tightened and "
                            "the PDF is skipped; " + HEADLESS_SHELL_HINT)


def _reference_dom(deal: dict[str, Any]) -> Optional[str]:
    """A reference deal built and rendered the way validate --send renders a draft."""
    with tempfile.TemporaryDirectory(prefix="reference-") as tmp:
        return render_mod.dom(build_mod.build(deal, Path(tmp) / "reference.html"))


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
                 "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
                 "MAQSAM_ACCESS_KEY", "MAQSAM_SECRET"):
        add(name, bool(key(name)) or None, "set" if key(name) else "not set")
    # Only the New Client Form's question list needs it; without it the
    # cockpit keeps its last copy.
    add("TYPEFORM_API_TOKEN", True if key("TYPEFORM_API_TOKEN") else None,
        "set" if key("TYPEFORM_API_TOKEN") else "not set: the cockpit's New Client Form list stops following Typeform")
    # Only calls-b2b-fathom needs it, once; its absence blocks nothing else.
    add("SALES_B2B_MGMT_TOKEN", True if key("SALES_B2B_MGMT_TOKEN") else None,
        "set" if key("SALES_B2B_MGMT_TOKEN") else "not set: only the one-off calls-b2b-fathom needs it")
    # The primary, the fallback, and whether anything can draft (model_rows).
    rows.extend(model_rows(cfg, log, online=not args.offline))

    engine = render_mod.engine()
    add(*_browser_row(engine, render_mod.find_chrome()))
    renders = False
    if engine != "none" and not args.offline:
        # Measured, never assumed: the browser line only says what was found.
        found = render_mod.probe()
        add(*_render_row(found))
        renders = bool(found.get("dom"))

    # Each one through the validator against today's offer.json, because the
    # drafter copies its faults as faithfully as its shape (references.py);
    # rendered too when the browser just did, as validate --send would.
    if offer is None:
        add("reference deals", None, "not checked: offer.json does not read, and the references are checked "
                                     "against it. Fix offer.json first")
    else:
        try:
            add("reference deals", *references_mod.doctor_row(cfg.reference_dir, offer,
                                                              _reference_dom if renders else None))
        except Refused as e:
            add("reference deals", None, f"not checked, because offer.json gives no default offer: {e}")

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

        try:
            # The Fathom check above imports these inside this function, which
            # makes them local names here too; import them for this branch.
            from datetime import datetime, timedelta, timezone
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
    done = ", ".join(f"{n} {s.replace('_', ' ')}" for s, n in sorted(out["statuses"].items()))
    if out.get("blocked"):
        detail = f"waiting: {out['blocked']}"
        if out["done"]:
            # A rebuild asks no model, so it goes ahead while drafts wait.
            detail += f"; meanwhile {out['done']} done ({done})"
    elif not busy:
        detail = "nothing queued"
    else:
        detail = (f"{out['done']} done ({done or 'none'}), {out['retry']} to try again, {out['failed']} failed"
                  + (f", {out['cancelled']} cancelled (archived first)" if out.get("cancelled") else "")
                  + (f", {out['reaped']} reaped" if out["reaped"] else ""))
    fell = out.get("fallback") or {}
    if fell.get("drafts"):
        # Never silent: a paid fallback drafting while the primary is down.
        said = f"{fell['drafts']} drafted through the fallback: {fell.get('note') or 'the primary could not answer'}"
        detail = f"{said.rstrip('.')}; {detail}"
        log.warn(f"requests: {said}")
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

    def primary() -> Any:
        if (cfg.provider or "vps") == "openai":
            if not cfg.openai_key:
                raise model_mod.ModelUnreachable("OPENAI_API_KEY is not set, so Vince cannot review calls.")
            return model_mod.metered(model_mod.OpenAIShaped("openai", model_mod.OPENAI_URL, cfg.openai_key, model,
                                                            max_tokens=cfg.max_tokens,
                                                            reasoning_effort=cfg.reasoning_effort,
                                                            json_mode=False, log=log.info))
        return model_mod.provider(cfg, log.info)

    cfg.model = model
    # Through the fallback only when SALES_FALLBACK_JOBS names reviews.
    return model_mod.for_job(cfg, "reviews", log.info, primary=primary, plain_text=True, warn=log.warn)


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


def cmd_followups(cfg: Config, args: argparse.Namespace, log: Logger) -> int:
    """Write follow-up drafts for the leads who need one now, for their reps to approve."""
    ghl_token = key("GHL_B2B_API_KEY") or key("SALES_GHL_TOKEN")
    if not ghl_token:
        # Without it every conversation reads as empty: no automation's
        # message, no stop, no window. Nothing is written instead.
        detail = ("GHL_B2B_API_KEY is not set, so the follow-up agent cannot read a conversation and writes nothing. "
                  "Set it in /opt/data/bibi/api-keys.env.")
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
        p = model_mod.for_job(cfg, "followups", log.info, warn=log.warn)
    except model_mod.ModelUnreachable as e:
        _status(cfg, log, "followups", False, str(e))
        log.error(str(e))
        return 1

    def sales_api(action: str, followup_id: str) -> dict:
        """The cockpit's own door, asked by the desk with its service key."""
        _, _, raw = http.request(
            "POST", f"{cfg.supabase_url.rstrip('/')}/functions/v1/sales-api",
            headers={"Authorization": f"Bearer {cfg.supabase_key}", "Content-Type": "application/json"},
            data=json.dumps({"action": action, "id": followup_id}).encode(),
            timeout=60, retries=0, ok_statuses=(200, 400, 403, 404, 409, 500, 502),
        )
        return json.loads(raw.decode("utf-8") or "{}")

    out = followups_mod.run(sb, p, log.info, settings=settings, ghl_token=ghl_token, warn=log.warn,
                            autosend=lambda i: sales_api("followup.autosend", i),
                            settle=lambda i: sales_api("followup.settle", i))
    if "skipped" in out:
        detail = out["skipped"]
    else:
        words = {"whatsapp": "WhatsApp", "whatsapp_template": "WhatsApp template", "email": "email"}
        channels = ", ".join(f"{n} {words.get(k, k)}" for k, n in (out.get("by_channel") or {}).items())
        settled = out.get("settled") or {}
        detail = (f"{out['written']} drafts written of {out['picked']} leads due"
                  + (f" ({channels})" if channels else "")
                  + (f", {out['sent_by_itself']} sent by themselves" if out.get("sent_by_itself") else "")
                  + (f", {out['held_for_automation']} waiting while a HighLevel automation messages them"
                     if out.get("held_for_automation") else "")
                  + (f", {out['in_a_conversation']} already talking with a rep" if out.get("in_a_conversation") else "")
                  + (f", {out['already_answered']} already answered" if out.get("already_answered") else "")
                  + (f", {out['asked_to_stop']} asked not to be messaged" if out.get("asked_to_stop") else "")
                  + (f", {out['conversation_unreadable']} waiting because HighLevel could not be read"
                     if out.get("conversation_unreadable") else "")
                  + (f", {out['no_open_channel']} with no open channel" if out["no_open_channel"] else "")
                  + (f", {out['not_sales_leads']} not sales leads (clients, or no pipeline)" if out.get("not_sales_leads") else "")
                  + (f", {out['set_aside']} set aside for a day after failing twice" if out.get("set_aside") else "")
                  + (f", {out['replies_marked']} replies to earlier messages" if out.get("replies_marked") else "")
                  + (f", {out['went_stale']} stale drafts closed" if out.get("went_stale") else "")
                  + (f", {out['reason_gone']} drafts closed because their reason is gone" if out.get("reason_gone") else "")
                  + (f", {out['stuck_freed']} sends that stopped halfway freed" if out.get("stuck_freed") else "")
                  + (f", {settled.get('gone', 0) + settled.get('failed', 0)} sends settled"
                     + (f" ({settled['failed']} failed at HighLevel)" if settled.get("failed") else "")
                     if settled.get("gone") or settled.get("failed") else "")
                  + (f", {out['failed']} failed" if out["failed"] else ""))
    _status(cfg, log, "followups", not out.get("failed"), detail)
    if out.get("written") or out.get("failed") or args.json:
        _print(out if args.json else detail, args.json)
    return 0


def notes_provider(cfg: Config, log: Logger, job: str = "notes") -> Any:
    """The model the call notes and digests are written with: the desk's own
    provider on the VPS key, SALES_NOTES_MODEL when set; never DeepSeek. The
    fallback only when SALES_FALLBACK_JOBS names the job (notes, digest)."""
    model = key("SALES_NOTES_MODEL", "").strip()
    if model:
        model_mod.check_model(model, setting="SALES_NOTES_MODEL")
        cfg.model = model
    return model_mod.for_job(cfg, job, log.info, warn=log.warn)


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
        p = notes_provider(cfg, log, job="digest")
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
                  "Open the HTML and print it, or set CHROME_PATH (doctor's browser line).")
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
    outcome = engine_mod.run(call, lang=args.lang, resolved=resolved, offer=offer,
                             p=model_mod.for_job(cfg, "proposal", log.info, warn=log.warn), cfg=cfg, log=log.info,
                             workdir=out_dir, variant=args.variant)
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
    sub.add_parser("followups")
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
    cfg.ensure_dirs()
    log = Logger(quiet=args.quiet)
    handlers: dict[str, Callable[[Config, argparse.Namespace, Logger], int]] = {
        "doctor": cmd_doctor, "requests": cmd_requests, "recordings": cmd_recordings, "status": cmd_status,
        "calls-vault": cmd_calls_vault, "reviews-import": cmd_reviews_import, "reviews": cmd_reviews,
        "maqsam-calls": cmd_maqsam_calls, "calls-b2b-fathom": cmd_calls_b2b_fathom,
        "research": cmd_research, "followups": cmd_followups, "notes": cmd_notes, "digest": cmd_digest,
        "validate": cmd_validate, "build": cmd_build, "draft": cmd_draft, "offer-sync": cmd_offer_sync, "form-sync": cmd_form_sync,
    }
    if args.cmd in METERED and cfg.supabase_configured:
        _meter(cfg, args.cmd, log)
    try:
        return handlers[args.cmd](cfg, args, log)
    except (SupabaseError, http.HttpError, NotNow, Refused) as e:
        log.error(http.scrub(str(e))[:400])
        if args.cmd in ("requests", "recordings", "status", "offer-sync", "form-sync", "calls-vault", "reviews", "research",
                        "followups", "maqsam-calls", "notes", "digest") and not getattr(args, "dry", False):
            _status(cfg, log, args.cmd, False, http.scrub(str(e))[:400])
        return 1
    except KeyboardInterrupt:
        return 130
    finally:
        # A meter counts one command's calls, under that command's name.
        model_mod.meter(None)


if __name__ == "__main__":
    sys.exit(main())
