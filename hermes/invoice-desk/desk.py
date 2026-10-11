#!/usr/bin/env python3
"""Invoice desk: turns invoices asked for in the client success cockpit into
numbered, locked PDFs in the client's Drive folder and rows on the register.

  python3 desk.py doctor            check every key, table, account and the printer; changes nothing
  python3 desk.py run [--limit N]   the cron job: issue up to N waiting invoices (default 5)
  python3 desk.py preview --id ID --out FILE.pdf
                                    print one invoice as it would be issued; writes nothing anywhere
  python3 desk.py golden [--write]  check (or rewrite) tests/golden/cases.json against the template

Cron (as hermes, see README.md):
  * * * * * cd ~/mahara-cockpits/hermes/invoice-desk && flock -n /tmp/invoice-desk.lock python3 desk.py run >> ~/.invoice-desk/run.log 2>&1
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from desk import build, http, render
from desk.config import Config
from desk.google import Google, service_token
from desk.supa import Supa
from desk.worker import VERSION, Desk, Ledger, print_pdf

HERE = Path(__file__).resolve().parent
GOLDEN = HERE / "tests" / "golden" / "cases.json"
REGISTER_HEADER = ["Invoice #", "Client", "ClickUp Task ID", "Amount (USD)", "Issued", "Due Date",
                   "PDF Link", "Status", "Last Reminder", "Notes"]


def line(ok: bool, text: str) -> bool:
    print(("ok " if ok else "-- ") + text)
    return ok


def doctor() -> int:
    cfg = Config.load()
    good = True
    for sentence in cfg.missing():
        good = line(False, sentence)
    try:
        import google.oauth2.service_account  # noqa: F401
        import google.auth.transport.requests  # noqa: F401
        line(True, "google-auth is installed")
    except ImportError:
        good = line(False, "google-auth is not installed: python3 -m pip install --user google-auth requests")
    if cfg.supabase_url and cfg.supabase_key:
        supa = Supa(cfg.supabase_url, cfg.supabase_key)
        try:
            supa.select("cockpit_invoice_desk_status", "select=beat_at,ok,detail")
            waiting = supa.select("cockpit_invoices", "status=in.(queued,rendering)&select=id")
            line(True, f"invoice tables are there; {len(waiting)} invoice(s) waiting")
        except http.HttpError as e:
            good = line(False, f"the invoice tables are not reachable ({e}). Apply supabase/migrations/20261011v_cockpit_invoices.sql")
    if cfg.google_key_file and Path(cfg.google_key_file).is_file():
        try:
            g = Google(service_token(cfg.google_key_file))
            email = json.loads(Path(cfg.google_key_file).read_text(encoding="utf-8")).get("client_email", "?")
            line(True, f"signed in to Google as {email}")
            header = g.header(cfg.register_sheet, cfg.register_tab)
            if header[:10] != REGISTER_HEADER:
                good = line(False, f"the register's header is not what the desk writes: {header[:10]}")
            else:
                numbers = [n for n in g.column_a(cfg.register_sheet, cfg.register_tab) if n.startswith("INV-")]
                line(True, f"register readable: {len(numbers)} invoices, last {numbers[-1] if numbers else 'none'}")
        except Exception as e:  # noqa: BLE001
            good = line(False, f"Google: {http.scrub(e)}")
    probe = render.probe()
    good = line(bool(probe["pdf"]), f"printer: {probe['engine']} at {probe['chrome']} ({probe['seconds']}s)") and good
    if probe["pdf"]:
        case = json.loads(GOLDEN.read_text(encoding="utf-8"))[0]
        try:
            pdf = print_pdf(build.fill(case["invoice"], case["invoiceNo"], build.TEMPLATE.read_text(encoding="utf-8")))
            problems = build.pdf_problems(pdf)
            good = line(not problems, "a sample invoice prints on one page with its fonts" if not problems else " ".join(problems)) and good
        except Exception as e:  # noqa: BLE001
            good = line(False, f"the sample invoice did not print: {http.scrub(e)}")
    print("ready" if good else "not ready: fix the -- lines above")
    return 0 if good else 1


def run(limit: int) -> int:
    cfg = Config.load()
    if not cfg.supabase_url or not cfg.supabase_key:
        print("-- " + cfg.missing()[0])
        return 1
    supa = Supa(cfg.supabase_url, cfg.supabase_key)
    missing = cfg.missing()
    if missing:
        supa.beat(False, missing[0], VERSION)
        print("-- " + missing[0])
        return 1
    if not render.find_chrome():
        sentence = "The invoice worker has no Chrome to print with. Tell Muhammed."
        supa.beat(False, sentence, VERSION)
        print("-- " + sentence)
        return 1
    try:
        token = service_token(cfg.google_key_file)
    except Exception as e:  # noqa: BLE001
        sentence = "The invoice worker could not sign in to Google with its service account. Tell Muhammed."
        supa.beat(False, sentence, VERSION)
        print("-- " + sentence, http.scrub(e))
        return 1
    ledger = Ledger()
    http.ledger = ledger
    desk = Desk(supa=supa, google=Google(token), cfg=cfg, template=build.TEMPLATE.read_text(encoding="utf-8"))
    results: dict[str, int] = {}
    try:
        for _ in range(limit):
            invoice = supa.claim()
            if not invoice:
                break
            outcome = desk.process(invoice)
            results[outcome] = results.get(outcome, 0) + 1
    finally:
        http.ledger = lambda *a: None
        try:
            supa.health(ledger.rows)
        except Exception as e:  # noqa: BLE001
            print("-- the health ledger was not written:", http.scrub(e))
        supa.beat(True, None, VERSION)
    if results:
        print(json.dumps(results))
    return 0


def preview(invoice_id: str, out: str) -> int:
    cfg = Config.load()
    invoice = Supa(cfg.supabase_url, cfg.supabase_key).invoice(invoice_id)
    if not invoice:
        print(f"-- no invoice {invoice_id}")
        return 1
    pdf = print_pdf(build.fill(invoice, invoice.get("invoice_no") or "INV-PREVIEW", build.TEMPLATE.read_text(encoding="utf-8")))
    Path(out).write_bytes(pdf)
    problems = build.pdf_problems(pdf)
    print(f"wrote {out}" + ("" if not problems else " -- " + " ".join(problems)))
    return 0 if not problems else 1


def golden(write: bool) -> int:
    cases: list[dict[str, Any]] = json.loads(GOLDEN.read_text(encoding="utf-8"))
    template = build.TEMPLATE.read_text(encoding="utf-8")
    bad = 0
    for case in cases:
        digest = hashlib.sha256(build.fill(case["invoice"], case["invoiceNo"], template).encode("utf-8")).hexdigest()
        if write:
            case["sha256"] = digest
        elif digest != case.get("sha256"):
            bad += 1
            print(f"-- {case['name']}: {digest} differs from the golden {case.get('sha256')}")
    if write:
        GOLDEN.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {len(cases)} golden hashes")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="desk.py")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor")
    r = sub.add_parser("run")
    r.add_argument("--limit", type=int, default=5)
    p = sub.add_parser("preview")
    p.add_argument("--id", required=True)
    p.add_argument("--out", required=True)
    g = sub.add_parser("golden")
    g.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    if args.cmd == "doctor":
        return doctor()
    if args.cmd == "run":
        return run(max(1, min(args.limit, 20)))
    if args.cmd == "preview":
        return preview(args.id, args.out)
    return golden(args.write)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
