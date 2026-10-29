"""The WhatsApp recap sender (hermes/client-messages, docs/forms/STAGE2B-CONTRACT.md 4.3, 3.11 and section 6).

The sender runs every minute on the VPS and writes one cockpit_sync_state row, client-messages, with
detail {mode, kinds, onlyCards, approved, sent, refused, failed, unknown, unread, held, receiptsMissing, envFrom};
mode is exactly dry or apply, and a run is limited when onlyCards is not empty. receiptsMissing counts the run's
provider calls that left but whose answer the health ledger could not save (they are never repeated). Its G5 run
(the WhatsApp phone check) writes client-messages-g5. Report-only: the guardian never touches a message, because a
retried send is a second message in a client's group; it says what is late and what a person does.

Before deploy step D14 the cron is not installed and there is no row: that reads ok, never as zero sends.
"""
from __future__ import annotations

from datetime import timedelta

from guard.context import Context
from guard.model import Check, Result, age_min, ago, fail, kuwait, ok, parse_time, warn
from guard.redact import brief_error, clean

KEY = "client-messages"
G5_KEY = "client-messages-g5"
STALE_MIN = 10
READ_BACK_MIN = 60
RUNBOOK = "hermes/client-messages/RUNBOOK.md"


def _row(ctx: Context, key: str) -> dict | None:
    rows = ctx.rows("cockpit_sync_state", "key,ok,note,detail,last_run_at,last_ok_at", where=[("key", "eq", key)], limit=1)
    return rows[0] if rows else None


def run_sender(ctx: Context) -> Result:
    r = _row(ctx, KEY)
    if r is None:
        return ok("Not installed yet: the client messages cron starts at deploy D14.", evidence={"installed": False})
    detail = r.get("detail") if isinstance(r.get("detail"), dict) else {}
    mode = detail.get("mode")
    cards = detail.get("onlyCards") if isinstance(detail.get("onlyCards"), list) else []
    ev = {"installed": True, "ok": r.get("ok"), "mode": mode, "limited": bool(cards),
          **{k: detail.get(k) for k in ("approved", "sent", "refused", "failed", "unknown", "unread", "held",
                                        "receiptsMissing") if k in detail},
          "note": clean(r.get("note"), 160)}
    age = age_min(r.get("last_run_at"), ctx.now)
    if age is None or age > STALE_MIN:
        return fail(f"The client messages sender has not run for {ago(age)} (limit {ago(STALE_MIN)}).",
                    since=parse_time(r.get("last_run_at")), evidence=ev,
                    action=f"Read ~/.client-messages/cron.log on the VPS and run the doctor ({RUNBOOK}).")
    # A hold (an old sender on or unread, Client Data's column moved) stops every approved recap on purpose. The
    # sender writes it ok false with the sentence in detail.held, in either mode: it is read as a hold, never as a
    # failed run.
    held = detail.get("held")
    if held:
        approved = detail.get("approved") if isinstance(detail.get("approved"), int) else None
        why = brief_error(held if isinstance(held, str) and held.strip() else r.get("note"), 160)
        what = (f"{approved} approved recap{'' if approved == 1 else 's'} held" if approved
                else "The approved recaps are held")
        return warn(f"{what}: {why}", since=parse_time(r.get("last_ok_at")), evidence=ev,
                    action=f"Read why in the row's note; {RUNBOOK} says what each hold means. Nothing is sent until "
                           "it clears.")
    if r.get("ok") is False:
        return fail(f"The client messages sender failed its last run: {brief_error(r.get('note'), 160)}",
                    since=parse_time(r.get("last_ok_at")), evidence=ev,
                    action=f"Run the client-messages doctor on the VPS ({RUNBOOK}).")
    # A provider call left but the health ledger lost its answer. The sender keeps the run ok (the call is never
    # repeated) and says it in the note, so without this the row would read ok. The row is rewritten every minute:
    # this reads the last run, and a database that stops taking receipts keeps it up run after run. A count that is
    # not a whole number (or no count, from a sender before receiptsMissing) is not read, never taken as 0 or as lost.
    lost = detail.get("receiptsMissing")
    if isinstance(lost, int) and not isinstance(lost, bool) and lost > 0:
        one = lost == 1
        return warn(f"{lost} provider call{'' if one else 's'} left without {'its answer' if one else 'their answers'} "
                    "saved in the health ledger.", evidence=ev,
                    action=f"Check that the database takes provider receipts, then run the client-messages doctor "
                           f"({RUNBOOK}).")
    if mode == "dry":
        return ok("Dry: sending is off until the switch-over.", evidence=ev)
    if mode != "apply":
        return warn(f"The client messages sender reports mode {clean(mode, 20) or 'none'}, not dry or apply.", evidence=ev,
                    action=f"Run the client-messages doctor on the VPS ({RUNBOOK}).")
    if cards:
        return ok("Sending is open only for the test card.", evidence=ev)
    return ok("Sending is open for every client.", evidence=ev)


def run_read_back(ctx: Context) -> Result:
    """A sent recap is read back by its message id, else by its text's fingerprint, for 24 hours."""
    cutoff = (ctx.now - timedelta(minutes=READ_BACK_MIN)).isoformat()
    rows = ctx.rows("cockpit_client_messages", "id,state,sent_at,read_back_at",
                    where=[("state", "eq", "sent"), ("read_back_at", "is", None), ("sent_at", "lt", cutoff)],
                    order="sent_at.asc", limit=50)
    if not rows:
        return ok(f"Every recap sent over {ago(READ_BACK_MIN)} ago was read back in its group.", evidence={"unread": 0})
    oldest = parse_time(rows[0].get("sent_at"))
    return warn(f"{len(rows)} sent recap{'' if len(rows) == 1 else 's'} not read back after {ago(READ_BACK_MIN)}; the oldest "
                f"was sent {kuwait(oldest)}.", since=oldest, evidence={"unread": len(rows)},
                items=[clean(r.get("id"), 40) for r in rows[:10]],
                action="Look in the client's WhatsApp group for the recap; the sender keeps reading back for 24 hours and "
                       f"never sends it again ({RUNBOOK}).")


def run_g5(ctx: Context) -> Result:
    """G5: the token the sender uses reads Make 07's own recap as sent from this number (Z29)."""
    r = _row(ctx, G5_KEY)
    if r is None:
        return warn("The WhatsApp phone check (G5) has not run: it runs at deploy D16, before any recap is sent.",
                    evidence={"ran": False})
    note = str(r.get("note") or "")
    if r.get("ok") is True and note == "same number":
        return ok("G5: the sender's WhatsApp number is the one Make sends recaps from (same number).",
                  evidence={"ran": True, "note": note})
    return warn(f"G5 does not read same number: {brief_error(note, 160) or 'no note'}.", evidence={"ran": True, "note": clean(note, 160)},
                action="The CEO decides which number the cockpit sends from (B5), with both last 4 values; nothing is sent "
                       "until then.")


CHECKS = [
    Check(id="client-messages", area="workers", name="WhatsApp recap sender",
          means="The WhatsApp recap sender runs every minute on the VPS, in the mode the switch-over set.",
          severity="medium",
          reads=f"cockpit_sync_state {KEY}: last_run_at, ok, note, detail.mode, detail.onlyCards, detail.held and "
                "detail.receiptsMissing",
          threshold=f"No run for {STALE_MIN} min once the row exists, or ok false without a hold: fail; approved "
                    "recaps held (detail.held, either mode), provider calls whose answer the health ledger lost "
                    "(detail.receiptsMissing above 0, either mode) or a mode other than dry or apply: warn. No row "
                    "(before deploy D14): ok.",
          run=run_sender, owner="the tech lead", confirm=2,
          action=f"Read ~/.client-messages/cron.log on the VPS and run the doctor ({RUNBOOK})."),
    Check(id="client-messages-read-back", area="workers", name="Sent recaps read back",
          means="Every WhatsApp recap the cockpit sent is found again in the client's group.", severity="medium",
          reads="cockpit_client_messages: id, state, sent_at, read_back_at (never the text)",
          threshold=f"A sent recap with no read-back after {READ_BACK_MIN} min: warn.", run=run_read_back,
          owner="the tech lead", action="Look in the client's WhatsApp group for the recap; it is never sent twice."),
    Check(id="client-messages-g5", area="workers", name="WhatsApp phone check (G5)",
          means="The number the cockpit would send recaps from is the one Make sends them from today.", severity="low",
          reads=f"cockpit_sync_state {G5_KEY}: ok and note", threshold="Anything but ok with the note same number: warn.",
          run=run_g5, owner="the tech lead", alert=False,
          action="Run G5 (hermes/client-messages run.sh g5); if it does not read same number, B5 goes to the CEO."),
]
