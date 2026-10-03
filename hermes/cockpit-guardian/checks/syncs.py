"""Syncs into Creative Triage: the sales mirror, CRM sub-accounts, Meta, B2B
(catalogue S4, S5, S6, M7, W5). None of these has a safe automatic fix: they
need a secret, a provider or B2B, which is the systems manager's."""
from __future__ import annotations

import json
import re

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, unknown, warn
from guard.redact import brief_error, clean

BLOCKED = re.compile(r"(?i)API access blocked|OAuthException")


def run_mirror(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_sales_mirror_runs", "id,started_at,finished_at,ok,error", order="id.desc", limit=10)
    if not rows:
        return unknown("cockpit_sales_mirror_runs is empty.")
    age = age_min(rows[0].get("started_at"), ctx.now)
    streak = 0
    for r in rows:
        if r.get("ok") is False:
            streak += 1
        else:
            break
    last_err = brief_error(next((r.get("error") for r in rows if r.get("error")), ""), 220)
    ev = {"newest_age_min": round(age or 0, 1), "failed_in_a_row": streak, "last_error": last_err}
    if age is None or age > 15:
        return fail(f"The sales cockpit's CRM copy has not run for {ago(age)} (every 3 min).",
                    since=parse_time(rows[0].get("started_at")), evidence=ev)
    if streak >= 3:
        first_bad = rows[streak - 1]
        return fail(f"The sales mirror failed {streak} runs in a row: {last_err}", since=parse_time(first_bad.get("started_at")),
                    evidence=ev)
    return ok(f"The sales mirror ran {ago(age)} ago" + (f" (the last failure: {last_err})" if streak else "") + ".", evidence=ev)


def run_mirror_drop(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_sales_mirror_runs", "id,started_at,ok,error", order="id.desc", limit=20)
    refused = [r for r in rows if "nothing was dropped" in str(r.get("error") or "")]
    if refused and refused[0] is rows[0]:
        return fail(f"B2B answered with fewer leads than the cockpit holds and the mirror refused to drop them: "
                    f"{clean(refused[0].get('error'), 220)}", since=parse_time(refused[-1].get("started_at")),
                    evidence={"refused_runs": len(refused)})
    return ok("The sales mirror has not refused a large drop in its last 20 runs.")


def run_locks(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_sales_locks", "name,holder,held_until")
    stuck = []
    for r in rows:
        until = parse_time(r.get("held_until"))
        if until is None:
            continue
        ahead = (until - ctx.now).total_seconds() / 60
        if ahead > 15:
            stuck.append(f"{r.get('name')} (held {int(ahead)} min ahead)")
    if stuck:
        return warn(f"A sales lock is held far ahead: {', '.join(stuck)}. The mirror's lease is 5 minutes.",
                    evidence={"stuck": stuck})
    return ok(f"No sales lock is held past its lease ({len(rows)} lock row(s)).")


def run_crm(ctx: Context) -> Result:
    bad = []
    seen = 0
    for table, label in (("appointment_sync_state", "appointments"), ("lead_sync_state", "leads"),
                         ("pipeline_sync_state", "pipelines")):
        rows = ctx.rows(table, "location_id,last_synced_at,last_status")
        seen += len(rows)
        for r in rows:
            status = str(r.get("last_status") or "")
            age = age_min(r.get("last_synced_at"), ctx.now)
            if status and status.lower() not in ("ok", "success", "succeeded", "done"):
                bad.append(f"{r['location_id']} {label} ({status[:40]})")
            elif age is not None and age > 26 * 60:
                bad.append(f"{r['location_id']} {label} ({ago(age)} old)")
    if not seen:
        return unknown("No CRM sync state rows could be read.")
    if bad:
        return warn(f"{len(bad)} CRM sub-account sync(s) are failing or old: {', '.join(bad[:6])}.",
                    evidence={"failing": bad[:20]})
    return ok(f"Every CRM sub-account sync is current ({seen} rows).")


def run_panels(ctx: Context) -> Result:
    rows = ctx.rows("panel_provisioning_runs", "ran_at,ok,needs_human", order="ran_at.desc", limit=1)
    if not rows:
        return unknown("panel_provisioning_runs is empty.")
    age = age_min(rows[0].get("ran_at"), ctx.now)
    if rows[0].get("ok") is False or age is None or age > 26 * 60:
        return fail(f"Client panel provisioning last ran {ago(age)} ago, ok={rows[0].get('ok')}.", evidence=rows[0])
    return ok(f"Client panel provisioning ran {ago(age)} ago.")


def run_meta(ctx: Context) -> Result:
    signals, since = [], None
    read_any = False
    try:
        feeds = (ctx.section("machine").get("payload") or {}).get("feeds") or []
        read_any = True
        for f in feeds:
            if "meta" in str(f.get("name", "")).lower() and not f.get("ok"):
                signals.append(f"B2B's Meta ads feed ({brief_error(f.get('error'), 120)})")
                since = parse_time(f.get("lastSuccessAt"))
    except SourceError:
        pass
    try:
        rows = ctx.rows("sync_jobs", "client_id,last_sync_status,last_error")
        read_any = True
        blocked = [r for r in rows if BLOCKED.search(str(r.get("last_error") or ""))]
        if blocked:
            signals.append(f"the creative dashboard's Meta sync for {len(blocked)} of {len(rows)} clients")
    except SourceError:
        pass
    token, account = ctx.key("META_ACCESS_TOKEN"), ctx.key("META_AD_ACCOUNT_ID")
    status = None
    if token and account:
        acct = account if account.startswith("act_") else f"act_{account}"
        try:
            r = ctx.http_get(f"https://graph.facebook.com/v21.0/{acct}?fields=account_status",
                             headers={"Authorization": f"Bearer {token}"}, timeout=15)
            body = r.json() or {}
            read_any = True
            status = body.get("account_status")
            if r.status != 200:
                signals.append(f"Meta answers {r.status} for the ad account: {brief_error(json.dumps(body), 100)}")
            elif status != 1:
                signals.append(f"the ad account's status is {status} (1 is active)")
        except Exception:  # noqa: BLE001 - a probe that fails is a missing reading, not a Meta fault
            pass
    if not read_any:
        return unknown("Neither the machine section, sync_jobs nor Meta itself could be read.")
    if signals:
        return fail("Meta blocks Mahara's access: " + "; ".join(signals) + ".", since=since,
                    evidence={"signals": signals, "account_status": status})
    return ok("Meta answers the B2B sync and the creative dashboard sync.")


B2B_LIMIT_MIN = {"assets_social_ig_mahara": 8 * 1440, "assets_social_youtube_mahara": 8 * 1440, "assets_web": 8 * 1440,
                 "assets_wistia": 3 * 1440}


def run_b2b(ctx: Context) -> Result:
    v = ctx.setting("b2b_sources")
    if not isinstance(v, dict) or not v.get("sources"):
        return unknown("The b2b_sources setting is missing, so B2B's own syncs cannot be read.")
    read_age = age_min(v.get("read_at"), ctx.now)
    bad = []
    for s in v["sources"]:
        name = str(s.get("source"))
        status = str(s.get("last_sync_status") or "")
        age = age_min(s.get("last_synced_at"), ctx.now)
        if status == "running" and age is None:
            continue  # the old rows stuck at running with no time
        if status and status not in ("success", "ok"):
            bad.append(f"{name} ({status}: {brief_error(s.get('last_error'), 90)})")
        elif age is not None and age > B2B_LIMIT_MIN.get(name, 2 * 1440):
            bad.append(f"{name} ({ago(age)} old)")
    ev = {"read_age_min": read_age, "failing": bad}
    if read_age is None or read_age > 30:
        return warn(f"The copy of B2B's sync states is {ago(read_age)} old (the mirror refreshes it every run).", evidence=ev)
    if bad:
        return warn(f"B2B's own syncs: {', '.join(bad[:5])}. What they bring is missing from the cockpits until then.",
                    evidence=ev)
    return ok(f"B2B's {len(v['sources'])} syncs are current.", evidence=ev)


CHECKS = [
    Check(
        id="sales-mirror", area="supabase", name="Sales mirror", catalogue="S4",
        means="The sales cockpit's copy of the CRM refreshes every 3 minutes.",
        severity="high", reads="cockpit_sales_mirror_runs (newest 10)",
        threshold="Newest run older than 15 min, or 3 failures in a row: fail.", run=run_mirror,
        quiet_because="convex", owner="Hermes",
        action="Read the failing step in the run's error; a 401 means a secret changed (B2B, HighLevel or the vault).",
    ),
    Check(
        id="sales-mirror-drop", area="supabase", name="Sales mirror refused a drop", catalogue="S5",
        means="B2B and the cockpit agree on how many leads exist.",
        severity="medium", reads="cockpit_sales_mirror_runs.error containing 'nothing was dropped'",
        threshold="The newest run refused a drop: fail.", run=run_mirror_drop, owner="Hermes",
        action="Check B2B before deleting anything by hand. Never delete leads to make the warning go away.",
    ),
    Check(
        id="sales-locks", area="supabase", name="Sales locks", catalogue="S6",
        means="No sales lock is held far past its 5-minute lease.", severity="low",
        reads="cockpit_sales_locks.held_until", threshold="Held more than 15 min ahead: warn.", run=run_locks,
        owner="Hermes", action="Find the holder in the row; a lease that long is a bug in whoever took it.",
    ),
    Check(
        id="crm-syncs", area="supabase", name="CRM sub-account syncs",
        means="Appointments, leads and pipelines sync for every sub-account.", severity="low",
        reads="appointment_sync_state, lead_sync_state, pipeline_sync_state",
        threshold="Any last_status that is not ok, or older than 26 h: warn.", run=run_crm, owner="the systems manager",
        action="429 clears by itself; an error that stays means that sub-account's token or permissions changed.",
    ),
    Check(
        id="client-panels", area="supabase", name="Client panel provisioning",
        means="Client panels are provisioned daily.", severity="low", reads="panel_provisioning_runs (newest)",
        threshold="Not ok, or older than 26 h: fail.", run=run_panels, owner="Hermes",
        action="Read the provision-client-panels function log in Supabase.",
    ),
    Check(
        id="meta-access", area="providers", name="Meta access", catalogue="M7",
        means="Meta lets Mahara's syncs and ad account work.", severity="high",
        reads="machine.feeds (B2B Meta ads), sync_jobs errors, and on the VPS act_<id>?fields=account_status",
        threshold="'API access blocked', an OAuthException, or an account status other than 1: fail.", run=run_meta,
        action="Settle the balance in Ads Manager or check Business Settings; the systems manager owns the B2B sync.",
    ),
    Check(
        id="b2b-sources", area="providers", name="B2B's own syncs", catalogue="W5",
        means="B2B reads its sources (Fathom, Maqsam, HighLevel, Wistia, assets) on time.", severity="low",
        reads="cockpit_sales_settings b2b_sources (copied each mirror run)",
        threshold="A status that is not success, or older than its cadence: warn.", run=run_b2b,
        owner="the systems manager", action="B2B is the systems manager's to fix; B2B is read-only for us.",
    ),
]
