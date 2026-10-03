#!/usr/bin/env python3
"""Prove the live-calls migrations on Creative Triage without leaving anything behind.

    python3 supabase/migrations/tests/run_checks.py            # apply a, b, c + all checks, then roll back
    python3 supabase/migrations/tests/run_checks.py --twice    # apply each migration twice (idempotent), all checks, roll back
    python3 supabase/migrations/tests/run_checks.py --applied  # the migrations are live: catalog checks only, rolled back

What it does
  1. Reads 20261003a/b/c, takes off each file's own `begin;` and `commit;`,
     and joins them with tests/20261003_rooms_catalog.sql and
     tests/20261003_rooms_checks.sql into ONE transaction that ends in
     `rollback;`. It refuses to run if any other top-level transaction
     statement (commit, end, rollback, begin, abort, savepoint release) is
     left in the text, so nothing can be committed by mistake.
     --applied runs the catalog checks alone: they read the catalog and write
     only this run's temp table, so they lock no real row (no event, alert,
     setting, status row or room) and compare no setting value; a switch
     turned on after launch is not a failure. The behaviour checks move rows
     and run the sweep, so they only ever run on tables this run made.
  2. Sends it to the Supabase management API (database/query) for project
     bldgtotkfmhoxmlzowdx. The checks' last statement returns one row per
     check: name, ok, detail.
  3. Unless --applied, reads the catalog afterwards (read only) to prove that
     no table, view, function, cron job, setting, audit row, status row or
     vault secret from the run was left behind.

The management token is read from SUPABASE_ACCESS_TOKEN or
~/.config/mahara/sb_mgmt_token and is never printed. Exit code 0 only when every
check passed and (unless --applied) nothing persisted.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

REF = "bldgtotkfmhoxmlzowdx"
HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = os.path.dirname(HERE)
FILES = ["20261003a_sales_rooms.sql", "20261003b_sales_hooks.sql", "20261003c_sales_followup_agent.sql"]
CATALOG = os.path.join(HERE, "20261003_rooms_catalog.sql")
CHECKS = os.path.join(HERE, "20261003_rooms_checks.sql")
FINAL = "select name, ok, detail from pg_temp.lc_checks order by n;"


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if t:
        return t
    path = os.path.expanduser("~/.config/mahara/sb_mgmt_token")
    if not os.path.exists(path):
        sys.exit("No management token: set SUPABASE_ACCESS_TOKEN or write it to ~/.config/mahara/sb_mgmt_token.")
    return open(path).read().strip()


def query(sql: str, write: bool):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql, "read_only": not write}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json",
                 "User-Agent": "mahara-sales/1"},
        method="POST",
    )
    # A read is tried again on any network error (3 tries). The write run is
    # tried again only when the connection was refused or reset before an
    # answer, never after a timeout: a run that may still be going on the
    # server must not be joined by a second one waiting on its locks.
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            raise SystemExit(f"The database refused the run (HTTP {e.code}): {e.read().decode()[:2000]}")
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
            reason = getattr(e, "reason", e)
            early = isinstance(reason, (ConnectionResetError, ConnectionRefusedError))
            if attempt == 2 or (write and not early):
                raise SystemExit(f"Could not finish the call to the management API: {reason}. "
                                 "Nothing was committed (the run always rolls back); check the leftovers query and run again.")
            time.sleep(3 * (attempt + 1))


def top_level_statements(sql: str):
    """Split SQL into top-level statements, skipping comments, quotes and dollar-quoted bodies."""
    out, cur, i, n = [], [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
            cur.append(" ")
            continue
        if sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            cur.append(" ")
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and j + 1 < n and sql[j + 1] == "'":
                    j += 2
                    continue
                if sql[j] == "'":
                    break
                j += 1
            cur.append("''")
            i = j + 1
            continue
        if c == '"':
            j = sql.find('"', i + 1)
            cur.append('""')
            i = n if j < 0 else j + 1
            continue
        if c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:])
            if m:
                tag = m.group(0)
                j = sql.find(tag, i + len(tag))
                if j < 0:
                    raise SystemExit(f"Unclosed dollar quote {tag}.")
                cur.append(" $body$ ")
                i = j + len(tag)
                continue
        if c == ";":
            out.append("".join(cur).strip())
            cur = []
            i += 1
            continue
        cur.append(c)
        i += 1
    tail = "".join(cur).strip()
    if tail:
        out.append(tail)
    return [s for s in out if s]


TX = re.compile(r"^(begin|commit|end|rollback|abort|start\s+transaction|release|prepare\s+transaction|commit\s+prepared)\b",
                re.I)


def strip_transaction(name: str, sql: str) -> str:
    stmts = [s for s in top_level_statements(sql) if TX.match(s)]
    if [s.lower() for s in stmts] != ["begin", "commit"]:
        raise SystemExit(f"{name}: expected exactly one top-level begin; and one commit;, found {stmts}.")
    sql = re.sub(r"(?im)^begin;\s*$", "", sql, count=1)
    sql = re.sub(r"(?im)^commit;\s*$", "", sql, count=1)
    left = [s for s in top_level_statements(sql) if TX.match(s)]
    if left:
        raise SystemExit(f"{name}: transaction statements left after stripping: {left}.")
    return sql


def compose(applied: bool, twice: bool = False, files=None, final: bool = True) -> str:
    """One transaction: the migrations (unless applied), the check files, the
    final select of pg_temp.lc_checks (unless a check file has its own), and
    rollback. With applied, only the catalog checks run."""
    # Never queue behind live traffic for long: a lock that is not free in 5 s
    # fails the run instead of making the cockpit wait behind it.
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '100s';"]
    if not applied:
        for f in FILES:
            body = strip_transaction(f, open(os.path.join(MIGRATIONS, f)).read())
            for n in range(2 if twice else 1):
                parts.append(f"-- ===== {f} (pass {n + 1}) =====")
                parts.append(body)
    if files is None:
        files = [CATALOG] if applied else [CATALOG, CHECKS]
    if applied and any(os.path.abspath(f) != os.path.abspath(CATALOG) for f in files):
        raise SystemExit("Refusing to run: against live data only the catalog checks run (--applied).")
    for path in files:
        checks = open(path).read()
        if [s for s in top_level_statements(checks) if TX.match(s)]:
            raise SystemExit(f"{os.path.basename(path)} must not contain transaction statements.")
        parts += [f"-- ===== {os.path.basename(path)} =====", checks]
    if final:
        parts.append(FINAL)
    parts.append("rollback;")
    sql = "\n".join(parts)
    tx = [s.lower() for s in top_level_statements(sql) if TX.match(s)]
    if tx != ["begin", "rollback"]:
        raise SystemExit(f"Refusing to run: the composed SQL has transaction statements {tx}.")
    return sql


LEFTOVERS = r"""
select 'table ' || table_name as what from information_schema.tables
 where table_schema = 'public' and table_name in (
   'cockpit_sales_rooms', 'cockpit_sales_room_secrets', 'cockpit_sales_room_events', 'cockpit_sales_room_hosts',
   'cockpit_sales_availability', 'cockpit_sales_live', 'cockpit_sales_alerts', 'cockpit_sales_presence',
   'cockpit_sales_followup_levels', 'cockpit_sales_followup_waves', 'cockpit_sales_followup_wave_members',
   'cockpit_sales_followup_meta', 'cockpit_sales_followup_stops')
union all
select 'function ' || p.proname from pg_proc as p
 where p.pronamespace = 'public'::regnamespace and p.proname in (
   'cockpit_sales_setting_int', 'cockpit_sales_room_code', 'cockpit_sales_rooms_guard', 'cockpit_sales_live_guard',
   'cockpit_sales_rooms_link_replaced', 'cockpit_sales_room_event_lease', 'cockpit_sales_rooms_tick',
   'cockpit_sales_touch_version', 'cockpit_sales_touch_updated', 'cockpit_sales_live_claim',
   'cockpit_sales_rooms_close', 'cockpit_sales_live_move', 'cockpit_sales_rooms_sweep', 'cockpit_sales_alert_hours',
   'cockpit_sales_alert_words', 'cockpit_sales_alert_set', 'cockpit_sales_watchdog',
   'cockpit_sales_jsonb_add_missing', 'cockpit_sales_settings_add_missing', 'cockpit_sales_kind_key_ok',
   'cockpit_sales_followup_levels_guard', 'cockpit_sales_followup_waves_guard',
   'cockpit_sales_followup_waves_close_members', 'cockpit_sales_followup_wave_members_touch',
   'cockpit_sales_followup_meta_touch', 'cockpit_sales_followup_stops_touch')
union all
select 'column cockpit_sales_wa_templates.button_variable' from information_schema.columns
 where table_schema = 'public' and table_name = 'cockpit_sales_wa_templates' and column_name = 'button_variable'
union all
select 'template ' || key from public.cockpit_sales_wa_templates
 where key in ('call_link_en', 'call_link_ar', 'demo_host_en', 'demo_host_ar', 'opener_en', 'opener_ar')
union all
select 'setting key ' || s.key || '.' || k.k from public.cockpit_sales_settings as s
 cross join lateral (values ('connector_off'), ('single_copy_ok_at'), ('dup_window_s'), ('template_budget_usd_month'),
                            ('health'), ('first_hours'), ('waves'), ('untagged_every_days'), ('graduation'),
                            ('reply_alerts'), ('stop_pause_days'), ('join'), ('when')) as k(k)
 where s.key in ('whatsapp_guard', 'followups', 'wa_fields') and s.value ? k.k
union all
select 'setting key followups.cadence.good_intro' from public.cockpit_sales_settings
 where key = 'followups' and value #> '{cadence,good_intro}' is not null
union all
select 'cron ' || jobname from cron.job where jobname in ('mahara-sales-rooms-sweep', 'mahara-sales-watchdog')
union all
select 'setting ' || key from public.cockpit_sales_settings where key in ('rooms', 'live')
union all
select 'audit ' || action from public.cockpit_audit_log
 where action in ('room.sweep', 'live.sweep', 'availability.sweep', 'live.claim', 'room.replace', 'room.create')
    or (action in ('settings.create', 'settings.update', 'wa.template.seed') and metadata ->> 'by' like 'migration 20261003%')
union all
select 'status ' || worker || '/' || job from public.cockpit_sales_worker_status where worker = 'sales-api'
union all
select 'vault ' || name from vault.secrets where name = 'sales_alerts_slack_webhook'
union all
select 'constraint ' || conname from pg_constraint
 where (conname = 'cockpit_sales_messages_source_check' and pg_get_constraintdef(oid) like '%room%')
    or (conname = 'cockpit_sales_followups_segment_check' and pg_get_constraintdef(oid) like '%reactivate%')
union all
select 'people ' || email from public.cockpit_sales_people where email like 'lc-test-%'
union all
select 'auth user ' || email from auth.users where email like 'lc-test-%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'lc-test-%'
union all
select 'attempt ' || contact_id from public.cockpit_sales_attempts where contact_id like 'lc-test-%'
union all
select 'message ' || contact_id from public.cockpit_sales_messages where contact_id like 'lc-test-%'
union all
select 'followup ' || contact_id from public.cockpit_sales_followups where contact_id like 'lc-test-%'
union all
select 'queued request ' || url from net.http_request_queue where url like '%example.invalid%' or url like '%sales-live/cron%'
union all
select 'vault ' || name from vault.secrets where name = 'cockpit_sync_secret' and description like 'lc-db test%'
"""


def main():
    applied = "--applied" in sys.argv[1:]
    twice = "--twice" in sys.argv[1:]
    before = None if applied else query(LEFTOVERS, write=False)
    if before:
        print("These exist before the run, so the leftovers check cannot tell them apart:")
        for r in before:
            print("  ", r["what"])
    rows = query(compose(applied, twice), write=True) or []
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    code = 0 if rows and not failed else 1
    if not applied:
        after = query(LEFTOVERS, write=False) or []
        new = [r["what"] for r in after if r not in (before or [])]
        if new:
            print("LEFT BEHIND after the rollback:", new)
            code = 1
        else:
            print("Nothing persisted: no table, view, function, cron job, setting key, template row, audit row, "
                  "status row, vault secret, constraint change, test row or queued request from the run is in the database.")
    sys.exit(code)


if __name__ == "__main__":
    main()
