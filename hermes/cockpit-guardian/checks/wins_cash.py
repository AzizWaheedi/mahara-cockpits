"""Waves 5 and 6 (docs/forms/WAVE56-CONTRACT.md 6.2): the daily LTV writer and its two second sources, the billing
agent's own login, the wins ledger's ties and pay proposals, client transfer receipts waiting on a check, the C9 retire
list, and Stage 4's kickoff and onboarding (legacy answers, effects, the relay). Report-only: each reading names the gap
and who closes it; nothing here writes.

Every read is a table or a view over REST with the service key (the browser RPCs are seat-gated, and the owner-only
functions such as cockpit_ltv_plan and cockpit_win_pay_rows are not granted to it), so the second sources are worked out
here from the tables themselves. Before the deploy each check reads "not set up yet" as ok, never as zero: a table, a
view or a setting that is not there yet is a sentence, not a count.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, warn
from guard.redact import clean

RUNBOOK = "RUNBOOK.md, Wins, cash and the client tail (waves 5 and 6)"
KUWAIT = timezone(timedelta(hours=3))
DAILY_KEY = "billing-daily"
LTV_KEY = "billing-ltv"
DAILY_MAX_MIN = 26 * 60
HELD_DAYS = 3
DRIFT_DAYS = 2
FLOOR_TOLERANCE_USD = 1.0
TIE_OPEN_DAYS = 3
ACCEPTED_DAYS = 45
RECEIPT_BUSINESS_DAYS = 2
REFUSED_PER_HOUR = 10
AGENT_QUIET_HOURS = 48
LEGACY_HOURS = 24
EFFECTS_GRACE_MIN = 30
RELAY_CLAIM_MIN = 15
STAGE4_FORMS = ("kickoff", "onboarding")
# 4.9: the part each flat-amount win proposes, by kind (upsells and referrals wait on money, so their month is the
# payment's; the Team & payroll card shows them).
FLAT_PARTS = {"review": "google_reviews", "video_testimonial": "video_testimonials", "podcast": "podcasts"}
RENEWAL_PARTS = {"renewal": "renewals", "reactivation": "reactivations"}

# A table, view or column a later migration adds: the read says so instead of failing the scan.
_NOT_THERE = re.compile(r"PGRST20[45]|42P01|42703|does not exist|Could not find|404", re.I)


def _maybe(ctx: Context, table: str, select: str = "*", where=(), order: Optional[str] = None,
           limit: Optional[int] = None) -> Optional[list[dict[str, Any]]]:
    """Rows, or None when the object is not there yet. Any other failure is the scan's 'could not be checked'."""
    try:
        return ctx.rows(table, select, where=where, order=order, limit=limit)
    except SourceError as e:
        if _NOT_THERE.search(str(e)):
            return None
        raise


def _setting(ctx: Context, key: str) -> Optional[dict[str, Any]]:
    rows = _maybe(ctx, "cockpit_settings", "key,value,updated_at", where=[("key", "eq", key)], limit=1)
    if not rows:
        return None
    v = rows[0].get("value")
    return v if isinstance(v, dict) else None


def _setting_row(ctx: Context, key: str) -> Optional[dict[str, Any]]:
    rows = _maybe(ctx, "cockpit_settings", "key,value,updated_at", where=[("key", "eq", key)], limit=1)
    return rows[0] if rows else None


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _day(v: Any) -> Optional[date]:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}", v):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat()


def _kuwait_day(t: datetime) -> date:
    return t.astimezone(KUWAIT).date()


def _business_days(start: datetime, end: datetime) -> int:
    """Whole Kuwait working days between two times (Friday and Saturday are the weekend)."""
    d, last, n = _kuwait_day(start), _kuwait_day(end), 0
    while d < last:
        d += timedelta(days=1)
        if d.weekday() not in (4, 5):
            n += 1
    return n


def _usd(v: float) -> str:
    return f"${v:,.2f}"


# ---- ltv-daily -----------------------------------------------------------------------------------------------

def _ltv_writer(ctx: Context, setting_row: Optional[dict[str, Any]]) -> Optional[Result]:
    """The writer's own row (billing-ltv). The morning run catches an LTV error or refusal, writes it here with ok=false
    and still reports billing-daily ok, so this row, not billing-daily, says whether lifetime value was written. A
    missing or old row is not yet a failure while billing.ltv was turned on less than DAILY_MAX_MIN ago (the first run
    is still due); ok=false always is. None when the writer is fine."""
    rows = _maybe(ctx, "cockpit_sync_state", "key,ok,note,last_run_at", where=[("key", "eq", LTV_KEY)], limit=1)
    row = rows[0] if rows else None
    note = clean((row or {}).get("note"), 300)
    ev = {"billing_ltv_last_run_at": (row or {}).get("last_run_at"), "billing_ltv_ok": (row or {}).get("ok")}
    if row is not None and row.get("ok") is not True:
        return fail(f"The lifetime value writer did not write this morning (billing-ltv): {note}", evidence=ev,
                    since=parse_time(row.get("last_run_at")))
    age = age_min(row.get("last_run_at"), ctx.now) if row else None
    if row is not None and row.get("ok") is True and age is not None and age <= DAILY_MAX_MIN:
        return None
    turned_on = age_min((setting_row or {}).get("updated_at"), ctx.now)
    if turned_on is not None and turned_on <= DAILY_MAX_MIN:
        return ok(f"The lifetime value writer was turned on {ago(turned_on)} ago; its first morning run is still due "
                  "(pg_cron mahara-billing-daily, 05:10 UTC).", evidence=ev)
    if row is None:
        return fail("The lifetime value writer is on but has never reported (billing-ltv): the morning billing run "
                    "(pg_cron mahara-billing-daily) has not reached it.", evidence=ev)
    return fail(f"The lifetime value writer has not reported for {ago(age)} (billing-ltv, limit {ago(DAILY_MAX_MIN)}): "
                f"{note}", evidence=ev, since=parse_time(row.get("last_run_at")))


def run_ltv_daily(ctx: Context) -> Result:
    setting_row = _setting_row(ctx, "billing.ltv")
    setting = setting_row.get("value") if setting_row and isinstance(setting_row.get("value"), dict) else None
    if setting is None:
        return ok("Not set up yet: billing.ltv is not seeded (20261102g).")
    if setting.get("on") is not True:
        return ok("The daily lifetime value writer is off (billing.ltv); it turns on at D-LTV. The CEO's Apply is the one "
                  "writer until then.")
    rows = _maybe(ctx, "cockpit_sync_state", "key,ok,note,last_run_at", where=[("key", "eq", DAILY_KEY)], limit=1)
    if rows is None:
        return ok("Not set up yet: the sync state table is not there.")
    if not rows:
        return fail("The lifetime value writer is on but the morning billing run has never reported (pg_cron "
                    "mahara-billing-daily).")
    row = rows[0]
    age = age_min(row.get("last_run_at"), ctx.now)
    ev = {"last_run_at": row.get("last_run_at")}
    if age is None or age > DAILY_MAX_MIN:
        return fail(f"The morning billing run, which writes lifetime value, has not run for {ago(age)} (limit "
                    f"{ago(DAILY_MAX_MIN)}).", evidence=ev, since=parse_time(row.get("last_run_at")))
    writer = _ltv_writer(ctx, setting_row)
    if writer is not None and writer.status == "fail":
        return writer
    held = _maybe(ctx, "cockpit_ltv_held", "id,task_id,first_held_on,released_at", where=[("released_at", "is", None)])
    if held is None:
        return ok("Not set up yet: the held lifetime value table is not there (20261102g).")
    cutoff = _kuwait_day(ctx.now) - timedelta(days=HELD_DAYS)
    old = [h for h in held if (_day(h.get("first_held_on")) or cutoff) < cutoff]
    if old:
        return warn(f"{_plural(len(old), 'lifetime value jump')} over the cap {'waits' if len(old) == 1 else 'wait'} for "
                    f"the CEO for more than {HELD_DAYS} days. Release or leave each one on the Billing tab's Lifetime "
                    "value card.", items=[str(h.get("task_id")) for h in old][:20], evidence=ev)
    if writer is not None:
        return writer
    return ok(f"The morning billing run ran {ago(age)} ago: {clean(row.get('note'), 200)}", evidence=ev)


# ---- ltv-drift -----------------------------------------------------------------------------------------------

def _last_ltv_events(ctx: Context) -> Optional[dict[str, dict[str, Any]]]:
    """The newest system ltv event per card that the cockpit's writer made (its detail carries checked_usd)."""
    rows = _maybe(ctx, "cockpit_billing_events", "id,clickup_task_id,kind,source,to_value,detail,at",
                  where=[("kind", "eq", "ltv"), ("source", "eq", "system")], order="at.desc")
    if rows is None:
        return None
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        d = r.get("detail") if isinstance(r.get("detail"), dict) else {}
        if "checked_usd" not in d:
            continue
        task = r.get("clickup_task_id")
        if task and task not in out:
            out[task] = r
    return out


def run_ltv_drift(ctx: Context) -> Result:
    events = _last_ltv_events(ctx)
    if events is None:
        return ok("Not set up yet: the billing log is not there.")
    if not events:
        return ok("The cockpit has not written a lifetime value yet (D-LTV), so there is nothing to read back.")
    queue = _maybe(ctx, "cockpit_clickup_writeback_queue", "dedupe_key,state,delivered_at",
                   where=[("dedupe_key", "in", [f"billing:{e.get('id')}" for e in events.values()])]) or []
    delivered = {q.get("dedupe_key"): q for q in queue if q.get("state") == "delivered"}
    accounts = _maybe(ctx, "cockpit_billing_accounts", "clickup_task_id,client_name,ltv_field_usd") or []
    card = {a.get("clickup_task_id"): a for a in accounts}
    differ: list[str] = []
    for task, e in events.items():
        q = delivered.get(f"billing:{e.get('id')}")
        at = parse_time(q.get("delivered_at")) if q else None
        if at is None or ctx.now - at < timedelta(days=DRIFT_DAYS):
            continue
        target, shown = _num(e.get("to_value")), _num((card.get(task) or {}).get("ltv_field_usd"))
        if target is None or shown is None or abs(target - shown) > 0.5:
            differ.append(task)
    if differ:
        return warn(f"{_plural(len(differ), 'card')} {'shows' if len(differ) == 1 else 'show'} a different LTV than the "
                    "cockpit wrote. Someone edited the field by hand, or the write did not hold; read the card and the "
                    "Lifetime value card.", items=differ[:20])
    return ok(f"Every lifetime value the cockpit wrote more than {DRIFT_DAYS} days ago still shows on its card "
              f"({_plural(len(events), 'card')}).")


# ---- ltv-second-source ---------------------------------------------------------------------------------------

def run_ltv_second_source(ctx: Context) -> Result:
    """A floor straight from the money tables: checked manual payments on the card plus rail payments with a live tie
    to it, since the baseline day and up to the write's day. The cockpit's sum must be at least that."""
    events = _last_ltv_events(ctx)
    if events is None:
        return ok("Not set up yet: the billing log is not there.")
    if not events:
        return ok("The cockpit has not written a lifetime value yet (D-LTV), so there is no sum to check.")
    manual = _maybe(ctx, "cockpit_manual_payments", "id,clickup_task_id,day,amount_usd,check_state,deleted_at,kind",
                    where=[("check_state", "eq", "checked"), ("deleted_at", "is", None)])
    ties = _maybe(ctx, "cockpit_payment_ties", "payment_id,clickup_task_id,cleared_at", where=[("cleared_at", "is", None)])
    rails = _maybe(ctx, "cockpit_client_payments", "payment_id,day,usd,rail,active,checked")
    if manual is None or ties is None or rails is None:
        return ok("Not set up yet: a money table is not there.")
    tied = {t.get("payment_id"): t.get("clickup_task_id") for t in ties if t.get("payment_id") and t.get("clickup_task_id")}
    over: list[str] = []
    worst = 0.0
    for task, e in events.items():
        d = e.get("detail") if isinstance(e.get("detail"), dict) else {}
        start = _day(d.get("baseline_day"))
        until = _day(d.get("as_of")) or _day(e.get("at"))
        checked = _num(d.get("checked_usd"))
        if start is None or checked is None:
            continue
        floor = 0.0
        for m in manual:
            day = _day(m.get("day"))
            if m.get("clickup_task_id") == task and m.get("kind", "payment") == "payment" and day and day >= start \
                    and (until is None or day <= until):
                floor += _num(m.get("amount_usd")) or 0.0
        for p in rails:
            pid = str(p.get("payment_id") or "")
            day = _day(p.get("day"))
            if pid.startswith("manual:") or tied.get(pid) != task or p.get("active") is False or p.get("checked") is not True:
                continue
            if day and day >= start and (until is None or day <= until):
                floor += _num(p.get("usd")) or 0.0
        if floor - checked > FLOOR_TOLERANCE_USD:
            over.append(task)
            worst = max(worst, floor - checked)
    if over:
        return warn(f"{_plural(len(over), 'card')}: payments tied straight to the card exceed the cockpit's LTV sum "
                    f"(the largest gap is {_usd(worst)}). Refresh Money, then read the Lifetime value card's rows.",
                    items=over[:20])
    return ok(f"For {_plural(len(events), 'card')} the cockpit's lifetime value sum is at least what the payment and tie "
              "tables hold.")


# ---- agent-separation ----------------------------------------------------------------------------------------

def run_agent_separation(ctx: Context) -> Result:
    setting = _setting(ctx, "billing.agent")
    keys = _maybe(ctx, "cockpit_agent_keys", "id,agent,revoked_at", where=[("revoked_at", "is", None)])
    if setting is None or keys is None:
        return ok("Not set up yet: the billing agent's login is not deployed (20261102g).")
    if not keys:
        return ok("The billing agent has no login of its own yet (D-AG); it still uses the old key.")
    if setting.get("separated") is not True:
        return warn("The billing agent can still read the old key on the server. Give it a Unix user of its own and "
                    "move the shared key file out of its reach (D-AG0), then set billing.agent.separated.")
    return ok("The billing agent writes only through its own door and cannot read the old key.")


# ---- win-ties-open -------------------------------------------------------------------------------------------

def run_win_ties(ctx: Context) -> Result:
    rows = _maybe(ctx, "cockpit_win_tie_proposals", "id,win_id,state,proposed_at", where=[("state", "eq", "open")])
    if rows is None:
        return ok("Not set up yet: the win tie proposals are not there (20261102h).")
    old = [r for r in rows if (age_min(r.get("proposed_at"), ctx.now) or 0) > TIE_OPEN_DAYS * 24 * 60]
    if old:
        return warn(f"{_plural(len(old), 'upsell payment')} {'waits' if len(old) == 1 else 'wait'} for the CEO's confirm "
                    f"for more than {TIE_OPEN_DAYS} days. Confirm or decline each one on Money.",
                    items=[str(r.get("id")) for r in old][:20])
    return ok(f"{_plural(len(rows), 'upsell payment')} {'waits' if len(rows) == 1 else 'wait'} for the CEO's confirm, "
              f"none for more than {TIE_OPEN_DAYS} days.")


# ---- win-unpaid-accepted -------------------------------------------------------------------------------------

def run_win_unpaid(ctx: Context) -> Result:
    wins = _maybe(ctx, "cockpit_csm_wins", "id,task_id,stage", where=[("stage", "eq", "signed")])
    events = _maybe(ctx, "cockpit_csm_win_events", "win_id,event,at", where=[("event", "eq", "accepted")])
    if wins is None or events is None:
        return ok("Not set up yet: the wins ledger is not there (20261102h).")
    accepted: dict[str, datetime] = {}
    for e in events:
        at = parse_time(e.get("at"))
        if at and (e.get("win_id") not in accepted or at < accepted[e.get("win_id")]):
            accepted[e.get("win_id")] = at
    old = [w for w in wins if w.get("id") in accepted and ctx.now - accepted[w.get("id")] > timedelta(days=ACCEPTED_DAYS)]
    if old:
        return warn(f"{_plural(len(old), 'accepted upsell')} {'has' if len(old) == 1 else 'have'} no payment tied after "
                    f"{ACCEPTED_DAYS} days. Invoice it, tie the payment, or void it with a reason.",
                    items=[str(w.get("id")) for w in old][:20])
    return ok(f"No accepted upsell has waited more than {ACCEPTED_DAYS} days for its payment.")


# ---- pay-proposals -------------------------------------------------------------------------------------------

def run_pay_proposals(ctx: Context) -> Result:
    setting = _setting(ctx, "pay.proposals")
    if setting is None:
        return ok("Not set up yet: pay.proposals is not seeded (20261102h).")
    if setting.get("on") is not True:
        return ok("Pay proposals are off (pay.proposals); they turn on at D-W.")
    today = _kuwait_day(ctx.now)
    if not 3 <= today.day <= 10:
        return ok("Pay proposals are read from the 3rd to the 10th, when last month is being approved.")
    first = today.replace(day=1)
    prev = (first - timedelta(days=1)).replace(day=1)
    month = prev.strftime("%Y-%m")
    wins = _maybe(ctx, "cockpit_csm_wins", "id,kind,stage,won_on,agreement_url,csm_person_id")
    decisions = _maybe(ctx, "cockpit_pay_proposal_decisions", "key,decision")
    if wins is None or decisions is None:
        return ok("Not set up yet: the wins ledger or the proposal decisions are not there (20261102h).")
    decided = {d.get("key") for d in decisions}
    waiting: list[str] = []
    for w in wins:
        won = _day(w.get("won_on"))
        if w.get("stage") == "void" or won is None or won.strftime("%Y-%m") != month:
            continue
        part = FLAT_PARTS.get(w.get("kind"))
        if part is None and w.get("kind") in RENEWAL_PARTS and w.get("agreement_url"):
            part = RENEWAL_PARTS[w.get("kind")]
        if part and f"win:{w.get('id')}:{part}:{month}" not in decided:
            waiting.append(str(w.get("id")))
    if waiting:
        return warn(f"{_plural(len(waiting), 'pay proposal')} for {month} {'is' if len(waiting) == 1 else 'are'} neither "
                    "confirmed nor declined. The CEO decides each one on Team & payroll before approving the month "
                    "(upsells and referrals are counted there too).", items=waiting[:20])
    return ok(f"Every flat-amount win of {month} has its pay proposal confirmed or declined.")


# ---- receipts-unchecked --------------------------------------------------------------------------------------

def run_receipts(ctx: Context) -> Result:
    receipts = _maybe(ctx, "cockpit_payment_receipts", "manual_payment_id,added_at")
    inbox = _maybe(ctx, "cockpit_billing_inbox", "id,source,response_id,ledger_id,status,logged_at",
                   where=[("source", "eq", "portal")])
    if receipts is None or inbox is None:
        return ok("Not set up yet: the payment receipts are not there (20261102i).")
    payments = _maybe(ctx, "cockpit_manual_payments", "id,check_state,deleted_at,added_at",
                      where=[("check_state", "eq", "logged"), ("deleted_at", "is", None)]) or []
    logged = {p.get("id"): p for p in payments}
    since: dict[str, datetime] = {}
    for r in receipts:
        at = parse_time(r.get("added_at"))
        if r.get("manual_payment_id") in logged and at:
            since[r.get("manual_payment_id")] = min(at, since.get(r.get("manual_payment_id"), at))
    for i in inbox:
        at = parse_time(i.get("logged_at"))
        if i.get("response_id") and i.get("ledger_id") in logged and at:
            since[i.get("ledger_id")] = min(at, since.get(i.get("ledger_id"), at))
    late = [pid for pid, at in since.items() if _business_days(at, ctx.now) > RECEIPT_BUSINESS_DAYS]
    if late:
        return warn(f"{_plural(len(late), 'transfer')} with the client's receipt {'waits' if len(late) == 1 else 'wait'} "
                    f"for a check for more than {RECEIPT_BUSINESS_DAYS} working days. Finance or the CEO checks it in "
                    "Checks waiting.", items=late[:20])
    return ok(f"{_plural(len(since), 'transfer')} with a client receipt {'waits' if len(since) == 1 else 'wait'} for a "
              f"check, none for more than {RECEIPT_BUSINESS_DAYS} working days.")


# ---- agent-door ----------------------------------------------------------------------------------------------

def run_agent_door(ctx: Context) -> Result:
    keys = _maybe(ctx, "cockpit_agent_keys", "id,revoked_at", where=[("revoked_at", "is", None)])
    calls = _maybe(ctx, "cockpit_agent_calls", "id,at,outcome", where=[("at", "gte", _iso(ctx.now - timedelta(hours=AGENT_QUIET_HOURS)))])
    if keys is None or calls is None:
        return ok("Not set up yet: the billing agent's door is not deployed (20261102g).")
    hour = ctx.now - timedelta(hours=1)
    refused = [c for c in calls if c.get("outcome") == "refused" and (parse_time(c.get("at")) or hour) > hour]
    if len(refused) > REFUSED_PER_HOUR:
        return fail(f"The billing agent's door refused {len(refused)} calls in the last hour (limit {REFUSED_PER_HOUR}). "
                    "Its key may be wrong or revoked, or something is guessing; read cockpit_agent_calls.")
    if not keys:
        return ok("The billing agent has no key yet (D-AG), so its door refuses everything, as it should.")
    if not calls:
        return warn(f"The billing agent has not called its door in {AGENT_QUIET_HOURS} hours. Run "
                    "python3 cockpit_agent.py doctor on the server.")
    return ok(f"The billing agent called its door {_plural(len(calls), 'time')} in {AGENT_QUIET_HOURS} hours; "
              f"{_plural(len(refused), 'refusal')} in the last hour.")


# ---- retire-quiet --------------------------------------------------------------------------------------------

def run_retire(ctx: Context) -> Result:
    items = _maybe(ctx, "cockpit_retire_items_v", "id,kind,external_id,name,state,quiet_since,archive_from,ready")
    if items is None:
        return ok("Not set up yet: the retire list is not there (20261102i).")
    since = _iso(ctx.now - timedelta(hours=LEGACY_HOURS))
    legacy = _maybe(ctx, "cockpit_form_responses", "id,form_key,state,submitted_at",
                    where=[("state", "eq", "legacy"), ("submitted_at", "gte", since)]) or []
    forms = _maybe(ctx, "cockpit_forms", "key,typeform_id") or []
    typeform_of = {f.get("key"): f.get("typeform_id") for f in forms if f.get("typeform_id")}
    quiet_off = {i.get("external_id") for i in items if i.get("kind") == "typeform" and i.get("state") in ("off", "closed", "archived")}
    noisy = sorted({typeform_of.get(r.get("form_key")) for r in legacy if typeform_of.get(r.get("form_key")) in quiet_off})
    if noisy:
        return warn(f"{_plural(len(noisy), 'retired Typeform')} took an answer through its old link in the last "
                    f"{LEGACY_HOURS} hours, so its quiet days start again. Move its quiet_since forward before archiving.",
                    items=[f"typeform:{n}" for n in noisy])
    ready = [i for i in items if i.get("ready") is True]
    if ready:
        return ok(f"{_plural(len(ready), 'item')} on the retire list {'is' if len(ready) == 1 else 'are'} off and quiet for "
                  "14 days, ready to archive at the next deploy (re-read each one's last run first).",
                  items=[str(i.get("id")) for i in ready][:40])
    return ok(f"Nothing on the retire list is ready to archive yet ({_plural(len(items), 'item')} listed).")


# ---- stage4-legacy -------------------------------------------------------------------------------------------

def _stage4(ctx: Context) -> tuple[Optional[dict[str, Any]], Optional[datetime]]:
    row = _setting_row(ctx, "forms.stage4")
    if row is None or not isinstance(row.get("value"), dict):
        return None, None
    return row.get("value"), parse_time(row.get("updated_at"))


def run_stage4_legacy(ctx: Context) -> Result:
    setting, since = _stage4(ctx)
    if setting is None:
        return ok("Not set up yet: forms.stage4 is not seeded (20261102j).")
    live = [k for k in STAGE4_FORMS if setting.get(k) is True]
    if not live:
        return ok("Neither the kickoff nor the onboarding form is native yet (forms.stage4).")
    rows = _maybe(ctx, "cockpit_form_responses", "id,form_key,state,created_at",
                  where=[("state", "eq", "legacy"), ("form_key", "in", live)]) or []
    after = [r for r in rows if since is None or (parse_time(r.get("created_at")) or since) >= since]
    if after:
        return warn(f"{_plural(len(after), 'answer')} came through the old {' or '.join(live)} Typeform after the switch to "
                    "the cockpit. Each is kept as legacy; read it and close the old link if it should be closed.",
                    items=[str(r.get("id")) for r in after][:20])
    return ok(f"No legacy {' or '.join(live)} answer since the switch to the cockpit.")


# ---- stage4-effects ------------------------------------------------------------------------------------------

def run_stage4_effects(ctx: Context) -> Result:
    setting, _ = _stage4(ctx)
    if setting is None:
        return ok("Not set up yet: forms.stage4 is not seeded (20261102j).")
    effects = _maybe(ctx, "cockpit_form_effects", "id,response_id,form_key,effect_key,state",
                     where=[("form_key", "in", list(STAGE4_FORMS))])
    responses = _maybe(ctx, "cockpit_form_responses", "id,form_key,form_version,state,source,submitted_at",
                       where=[("form_key", "in", list(STAGE4_FORMS)), ("state", "in", ["submitted", "confirmed"])])
    if effects is None or responses is None:
        return ok("Not set up yet: the form effects are not there.")
    bad = [e for e in effects if e.get("state") in ("failed", "unknown")]
    with_effects = {e.get("response_id") for e in effects}
    grace = ctx.now - timedelta(minutes=EFFECTS_GRACE_MIN)
    bare = [r for r in responses
            if setting.get(r.get("form_key")) is True and (r.get("form_version") or 1) >= 2
            and r.get("id") not in with_effects and (parse_time(r.get("submitted_at")) or ctx.now) < grace]
    if bare:
        return fail(f"{_plural(len(bare), 'native kickoff or onboarding answer')} {'has' if len(bare) == 1 else 'have'} "
                    f"no effect rows {EFFECTS_GRACE_MIN} minutes after it was sent, so nothing reached the card or the "
                    "team. Run the planner for it (RUNBOOK, Stage 4).", items=[str(r.get("id")) for r in bare][:20])
    if bad:
        return warn(f"{_plural(len(bad), 'kickoff or onboarding step')} failed or is unknown. Read each one on the "
                    "client's Forms page before retrying.", items=[str(e.get("id")) for e in bad][:20])
    return ok("Every kickoff and onboarding step settled.")


# ---- relay ---------------------------------------------------------------------------------------------------

def run_relay(ctx: Context) -> Result:
    rows = _maybe(ctx, "cockpit_form_relay_outbox", "id,state,claim_until,updated_at",
                  where=[("state", "in", ["claimed", "unknown"])])
    if rows is None:
        return ok("Not set up yet: the forms relay is not there (20261102j).")
    unknown = [r for r in rows if r.get("state") == "unknown"]
    stuck = [r for r in rows if r.get("state") == "claimed" and (age_min(r.get("updated_at"), ctx.now) or 0) > RELAY_CLAIM_MIN]
    if unknown:
        return warn(f"{_plural(len(unknown), 'relay row')} may or may not have reached the Client Data sheet or GitHub "
                    "(unknown). Read the sheet before anything else; never retry an unknown.",
                    items=[str(r.get("id")) for r in unknown][:20])
    if stuck:
        return warn(f"{_plural(len(stuck), 'relay row')} {'has' if len(stuck) == 1 else 'have'} been claimed for over "
                    f"{RELAY_CLAIM_MIN} minutes. Check hermes/forms-relay's last run.", items=[str(r.get("id")) for r in stuck][:20])
    return ok("The forms relay has nothing stuck or unknown.")


CHECKS = (
    Check("ltv-daily", "workers", "Daily lifetime value writer",
          "The morning billing run writes each card's lifetime value from checked money.", "medium",
          "cockpit_settings billing.ltv, cockpit_sync_state billing-daily and cockpit_ltv_held.",
          f"Fail: no morning run in 26 hours while the writer is on. Warn: a held jump older than {HELD_DAYS} days.",
          run_ltv_daily, owner="the systems manager",
          action=f"Check pg_cron mahara-billing-daily; the CEO releases a held jump ({RUNBOOK}).", confirm=1, clear=1),
    Check("ltv-drift", "data", "Lifetime value read-back",
          "The LTV the cockpit wrote is still what the card shows.", "medium",
          "The newest system ltv event per card, its delivered card write, and cockpit_billing_accounts.ltv_field_usd.",
          f"Warn: a card differs {DRIFT_DAYS} days after delivery.", run_ltv_drift, owner="the systems manager",
          action="Read the card and the Lifetime value card; a hand edit is overwritten the next morning.", confirm=1, clear=1,
          alert=False),
    Check("ltv-second-source", "data", "Lifetime value against the money tables",
          "The cockpit's lifetime value sum is at least what the payment and tie tables hold.", "medium",
          "Checked cockpit_manual_payments on the card plus checked cockpit_client_payments with a live cockpit_payment_ties "
          "tie to the card, since the write's baseline day, against the write's checked_usd.",
          f"Warn: the floor exceeds the sum by more than ${FLOOR_TOLERANCE_USD:.0f} on any card.", run_ltv_second_source,
          owner="the systems manager", action="Refresh Money, then read the Lifetime value card's rows.", confirm=1, clear=1,
          alert=False),
    Check("agent-separation", "keys", "Billing agent cut off from the old key",
          "The billing agent can write only through its own door.", "high",
          "cockpit_settings billing.agent.separated and an unrevoked cockpit_agent_keys row.",
          "Warn: the agent has its login but can still read the old key.", run_agent_separation,
          owner="the systems manager", action=f"D-AG0: a Unix user of its own for the agent ({RUNBOOK}).", confirm=1, clear=1),
    Check("win-ties-open", "data", "Upsell payments waiting for the CEO",
          "A CSM's proposed upsell payment tie is confirmed or declined quickly.", "low",
          "cockpit_win_tie_proposals state open.", f"Warn: one open for more than {TIE_OPEN_DAYS} days.", run_win_ties,
          owner="the CEO", action="Confirm or decline it on Money.", confirm=1, clear=1, alert=False),
    Check("win-unpaid-accepted", "data", "Accepted upsells with no payment",
          "An accepted upsell gets its payment tied.", "low",
          "cockpit_csm_wins stage signed and their accepted event in cockpit_csm_win_events.",
          f"Warn: accepted more than {ACCEPTED_DAYS} days ago with no tie.", run_win_unpaid, owner="the CSM lead",
          action="Invoice it, tie the payment, or void it with a reason.", confirm=1, clear=1, alert=False),
    Check("pay-proposals", "data", "Pay proposals before the month is approved",
          "Every win-backed pay part of last month is confirmed or declined before approval.", "medium",
          "cockpit_settings pay.proposals, cockpit_csm_wins and cockpit_pay_proposal_decisions, 3rd to 10th.",
          "Warn: a flat-amount win of last month with no decision.", run_pay_proposals, owner="the CEO",
          action="Decide each proposal on Team & payroll.", confirm=1, clear=1),
    Check("receipts-unchecked", "data", "Client receipts waiting for a check",
          "A transfer the client sent a receipt for is checked against the bank.", "medium",
          "cockpit_payment_receipts and portal rows of cockpit_billing_inbox on logged cockpit_manual_payments.",
          f"Warn: one waits more than {RECEIPT_BUSINESS_DAYS} working days.", run_receipts, owner="finance or the CEO",
          action="Check it in Checks waiting.", confirm=1, clear=1),
    Check("agent-door", "workers", "Billing agent's door",
          "The billing agent reaches the cockpit through its own door.", "high", "cockpit_agent_calls and cockpit_agent_keys.",
          f"Fail: more than {REFUSED_PER_HOUR} refusals in an hour. Warn: no call in {AGENT_QUIET_HOURS} hours after D-AG.",
          run_agent_door, owner="the systems manager", action="Run cockpit_agent.py doctor on the server.", confirm=1, clear=1),
    Check("retire-quiet", "data", "The retire list",
          "Old scenarios and forms are archived only after 14 quiet days.", "low",
          "cockpit_retire_items_v and legacy answers of retired Typeforms in 24 hours.",
          "Warn: a retired Typeform took an answer in 24 hours. Lists the items ready to archive.", run_retire,
          owner="the systems manager", action=f"Archive the ready items at the next deploy ({RUNBOOK}).", confirm=1, clear=1,
          alert=False),
    Check("stage4-legacy", "data", "Old kickoff and onboarding links after the switch",
          "After Stage 4 the kickoff and onboarding answers come through the cockpit.", "low",
          "cockpit_settings forms.stage4 and legacy kickoff or onboarding responses after it changed.", "Warn: any.",
          run_stage4_legacy, owner="the systems manager", action="Read the answer; close the old link if it should be closed.",
          confirm=1, clear=1, alert=False),
    Check("stage4-effects", "workers", "Kickoff and onboarding steps",
          "Every native kickoff and onboarding answer runs its steps.", "high",
          "cockpit_form_effects and cockpit_form_responses of kickoff and onboarding.",
          f"Warn: a step failed or unknown. Fail: a native answer with no steps after {EFFECTS_GRACE_MIN} minutes.",
          run_stage4_effects, owner="the tech lead", action=f"Run the planner for the answer ({RUNBOOK}).", confirm=1, clear=1),
    Check("relay", "workers", "Forms relay",
          "The Client Data row and the GitHub dispatch of a native onboarding are sent once.", "medium",
          "cockpit_form_relay_outbox claimed or unknown.",
          f"Warn: claimed for over {RELAY_CLAIM_MIN} minutes, or any unknown.", run_relay, owner="the tech lead",
          action="Read the sheet before anything; never retry an unknown.", confirm=1, clear=1),
)
