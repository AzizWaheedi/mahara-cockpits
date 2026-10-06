#!/usr/bin/env python3
"""Milestone 1, video-link round 6, SECURITY: the settings guard (20261004a)
that keeps the pilot's fence shut, on the live database (Creative Triage), in
ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_security_r6.py

The repo's 20261003d and 20261004a (20261004a is not applied in production
yet) are applied inside the transaction. m1-scope.md section 4: in the
database, cockpit_sales_settings_guard "refuses any write that turns on a
switch of rooms, live, threads or followups, or widens who the rooms reach
(test_only, test_contacts, fallback.pilot_emails, the test and live
calendars), unless its updated_by names an active sales manager and the write
stamps itself; every switch change, on or off, leaves a settings.switch audit
row". Section 5 says the guard refuses "the desk, sales-api's name, a
non-manager, an unstamped write, an upsert".

Each scenario runs in its own subtransaction that is undone at its end, so
the scenarios never see each other's writes:

  C1. control: a non-manager's stamped update that turns rooms on is refused;
  C2. control: a non-manager's stamped update of rooms.test_contacts is refused;
  C3. control: a non-manager's stamped update of fallback.scope to "any" is refused;
  C4. control: the manager's stamped switch-on is taken and audited;
  F1. a non-manager stages a fully switched-on copy under another key (no
      guard: not one of the four keys), moves the rooms row aside and renames
      the copy to 'rooms': every switch is on, test_only is false, with no
      manager and no settings.switch row;
  F2. a non-manager deletes the rooms row and inserts it again, switches
      off, with the test list widened to other contacts: taken with no
      manager and no settings.switch row (the insert path skips the test-list
      comparison);
  F3. a non-manager writes fallback.scope "any " (a trailing space): the
      guard reads it as not "any", so no manager and no settings.switch row,
      while sales-api reads it trimmed as "any" (roomlogic.ts roomsSetting's
      str(), proved in sales-api/m1_security_r6.test.ts);
  F4. with the pilot switched on by the manager, the rooms row is deleted
      (the kill switch by another shape): rooms.enabled goes from true to
      missing (off) with no settings.switch row;
  F5. with the pilot switched on by the manager, a script turns test_only
      off and sets only updated_at = now() (updated_by left as it was): the
      write counts as "stamped", so it borrows the manager's name, is taken,
      and its settings.switch row says the manager widened the rooms to
      every lead.

A FAIL is a finding; checks named "control" pass. Synthetic rows only: the
manager and the script end in '@stress.invalid', the staged key starts with
'stress_m1s6'. Nothing is committed, so the pg_cron jobs never see the
switches and no post reaches Slack.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

BOSS = "stress-m1s6-boss@stress.invalid"
SCRIPT = "stress-m1s6-script@stress.invalid"

CHECKS = r"""
create temp table m1s6_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('%(boss)s', 'Stress Boss', 'manager', true, 'stress-m1s6')
on conflict (email) do nothing;

-- One scenario: `body` runs in a subtransaction that is undone at its end.
-- A refusal by the guard (42501) inside the write is caught and said.
create function pg_temp.m1s6_switches_on(p_key text) returns integer language sql as $f$
  select count(*)::integer from public.cockpit_audit_log as a
   where a.action = 'settings.switch' and a.entity_id = p_key
$f$;

-- C1. A non-manager's stamped update turning rooms on.
do $c1$
declare refused boolean := false; said text := '';
begin
  begin
    begin
      update public.cockpit_sales_settings
         set value = value || '{"enabled": true}'::jsonb, updated_by = '%(script)s', updated_at = clock_timestamp()
       where key = 'rooms';
    exception when insufficient_privilege then refused := true; said := sqlerrm;
    end;
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('control: a non-manager''s stamped update that turns rooms on is refused', refused, left(said, 300));
end
$c1$;

-- C2. A non-manager's stamped update of the test list.
do $c2$
declare refused boolean := false; said text := '';
begin
  begin
    begin
      update public.cockpit_sales_settings
         set value = jsonb_set(value, '{test_contacts}', '["VjPfR4Cc1Y0OFvaqeor5", "stress-m1s6-real-lead"]'::jsonb),
             updated_by = '%(script)s', updated_at = clock_timestamp()
       where key = 'rooms';
    exception when insufficient_privilege then refused := true; said := sqlerrm;
    end;
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('control: a non-manager''s stamped update that widens rooms.test_contacts is refused', refused, left(said, 300));
end
$c2$;

-- C3. A non-manager's stamped update of fallback.scope to "any".
do $c3$
declare refused boolean := false; said text := '';
begin
  begin
    begin
      update public.cockpit_sales_settings
         set value = jsonb_set(value, '{fallback,scope}', '"any"'::jsonb),
             updated_by = '%(script)s', updated_at = clock_timestamp()
       where key = 'rooms';
    exception when insufficient_privilege then refused := true; said := sqlerrm;
    end;
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('control: a non-manager''s stamped update of rooms.fallback.scope to "any" is refused', refused, left(said, 300));
end
$c3$;

-- C4. The manager's stamped switch-on (m1-scope.md section 3's SQL).
do $c4$
declare refused boolean := false; said text := ''; added integer := 0; b integer; en text;
begin
  b := pg_temp.m1s6_switches_on('rooms');
  begin
    begin
      -- The manager names themself in the write's own transaction (round 6's fix).
      perform set_config('mahara.actor', '%(boss)s', true);
      update public.cockpit_sales_settings
         set value = value || jsonb_build_object(
               'enabled', true,
               'providers', '{"meet": true, "zoom": true}'::jsonb,
               'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb),
             updated_by = '%(boss)s', updated_at = clock_timestamp()
       where key = 'rooms';
    exception when insufficient_privilege then refused := true; said := sqlerrm;
    end;
    added := pg_temp.m1s6_switches_on('rooms') - b;
    select s.value ->> 'enabled' into en from public.cockpit_sales_settings as s where s.key = 'rooms';
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('control: the manager''s stamped switch-on is taken and leaves one settings.switch row',
          not refused and en = 'true' and added = 1, format('refused %%s, enabled %%s, rows %%s %%s', refused, en, added, said));
end
$c4$;

-- F1. Staged under another key, renamed to 'rooms'.
do $f1$
declare refused boolean := false; said text := ''; added integer := 0; b integer;
        en text; tonly text; zoom text; mail text; scope text;
begin
  b := pg_temp.m1s6_switches_on('rooms');
  begin
    begin
      insert into public.cockpit_sales_settings (key, value, updated_by, updated_at)
      select 'stress_m1s6_rooms',
             s.value || jsonb_build_object(
               'enabled', true, 'test_only', false,
               'providers', '{"meet": true, "zoom": true}'::jsonb,
               'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb,
               'fallback', coalesce(s.value -> 'fallback', '{}'::jsonb) || '{"scope": "any"}'::jsonb),
             '%(script)s', clock_timestamp()
        from public.cockpit_sales_settings as s where s.key = 'rooms';
      update public.cockpit_sales_settings set key = 'stress_m1s6_rooms_old' where key = 'rooms';
      update public.cockpit_sales_settings set key = 'rooms' where key = 'stress_m1s6_rooms';
    exception when insufficient_privilege then refused := true; said := sqlerrm;
    end;
    select s.value ->> 'enabled', s.value ->> 'test_only', s.value #>> '{providers,zoom}', s.value #>> '{send,email}',
           s.value #>> '{fallback,scope}'
      into en, tonly, zoom, mail, scope
      from public.cockpit_sales_settings as s where s.key = 'rooms';
    added := pg_temp.m1s6_switches_on('rooms') - b;
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('m1-security-r6-settings-key-rename-turns-switches-on-unguarded: a non-manager''s copy staged under another key and renamed to ''rooms'' is refused, or at least leaves a settings.switch row',
          refused or added > 0,
          format('refused %%s; rooms now: enabled %%s, test_only %%s, zoom %%s, email %%s, scope %%s; settings.switch rows added %%s %%s',
                 refused, en, tonly, zoom, mail, scope, added, said));
end
$f1$;

-- F2. Deleted and inserted again, switches off, the test list widened.
do $f2$
declare refused boolean := false; said text := ''; added integer := 0; b integer; list text;
begin
  b := pg_temp.m1s6_switches_on('rooms');
  begin
    begin
      create temp table m1s6_saved on commit drop as
        select value from public.cockpit_sales_settings where key = 'rooms';
      delete from public.cockpit_sales_settings where key = 'rooms';
      insert into public.cockpit_sales_settings (key, value, updated_by, updated_at)
      select 'rooms',
             jsonb_set(v.value, '{test_contacts}', '["VjPfR4Cc1Y0OFvaqeor5", "stress-m1s6-real-lead-1", "stress-m1s6-real-lead-2"]'::jsonb),
             '%(script)s', clock_timestamp()
        from pg_temp.m1s6_saved as v;
    exception when insufficient_privilege then refused := true; said := sqlerrm;
    end;
    select s.value ->> 'test_contacts' into list from public.cockpit_sales_settings as s where s.key = 'rooms';
    added := pg_temp.m1s6_switches_on('rooms') - b;
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('m1-security-r6-settings-delete-insert-widens-test-list-unguarded: a non-manager''s delete and insert of ''rooms'' with a wider test list is refused, or at least leaves a settings.switch row',
          refused or added > 0,
          format('refused %%s; rooms.test_contacts now %%s; settings.switch rows added %%s %%s', refused, list, added, said));
end
$f2$;

-- F3. fallback.scope "any " (a trailing space).
do $f3$
declare refused boolean := false; said text := ''; added integer := 0; b integer; scope text;
begin
  b := pg_temp.m1s6_switches_on('rooms');
  begin
    begin
      update public.cockpit_sales_settings
         set value = jsonb_set(value, '{fallback,scope}', '"any "'::jsonb),
             updated_by = '%(script)s', updated_at = clock_timestamp()
       where key = 'rooms';
    exception when insufficient_privilege then refused := true; said := sqlerrm;
    end;
    select s.value #>> '{fallback,scope}' into scope from public.cockpit_sales_settings as s where s.key = 'rooms';
    added := pg_temp.m1s6_switches_on('rooms') - b;
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('m1-security-r6-fallback-scope-any-with-space-unguarded: a non-manager''s fallback.scope "any " (which sales-api reads as "any") is refused, or at least leaves a settings.switch row',
          refused or added > 0,
          format('refused %%s; rooms.fallback.scope now %%s; settings.switch rows added %%s %%s', refused, to_json(scope)::text, added, said));
end
$f3$;

-- F4. The pilot on (by the manager), then the rooms row deleted.
do $f4$
declare said text := ''; added integer := 0; b integer; gone boolean;
begin
  begin
    perform set_config('mahara.actor', '%(boss)s', true);
    update public.cockpit_sales_settings
       set value = value || jsonb_build_object(
             'enabled', true,
             'providers', '{"meet": true, "zoom": true}'::jsonb,
             'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb),
           updated_by = '%(boss)s', updated_at = clock_timestamp()
     where key = 'rooms';
    b := pg_temp.m1s6_switches_on('rooms');
    -- Anyone's delete, naming nobody.
    perform set_config('mahara.actor', '', true);
    delete from public.cockpit_sales_settings where key = 'rooms';
    gone := not exists (select 1 from public.cockpit_sales_settings where key = 'rooms');
    added := pg_temp.m1s6_switches_on('rooms') - b;
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('m1-security-r6-settings-row-delete-switch-off-unaudited: deleting the switched-on rooms row (rooms.enabled true to missing, off) leaves a settings.switch row',
          added > 0,
          format('row gone %%s; settings.switch rows added %%s %%s', gone, added, said));
end
$f4$;

-- F5. The pilot on (by the manager), then a script's write that widens the
-- rooms to every lead and refreshes only updated_at (the habit of every
-- script that writes a row), leaving the manager's name on the row.
do $f5$
declare refused boolean := false; said text := ''; added integer := 0; b integer; tonly text; actor text; by_ text;
begin
  begin
    perform set_config('mahara.actor', '%(boss)s', true);
    update public.cockpit_sales_settings
       set value = value || jsonb_build_object(
             'enabled', true,
             'providers', '{"meet": true, "zoom": true}'::jsonb,
             'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb),
           updated_by = '%(boss)s', updated_at = clock_timestamp()
     where key = 'rooms';
    b := pg_temp.m1s6_switches_on('rooms');
    -- The script's own transaction names nobody.
    perform set_config('mahara.actor', '', true);
    begin
      update public.cockpit_sales_settings
         set value = jsonb_set(value, '{test_only}', 'false'), updated_at = clock_timestamp()
       where key = 'rooms';
    exception when insufficient_privilege then refused := true; said := sqlerrm;
    end;
    select s.value ->> 'test_only' into tonly from public.cockpit_sales_settings as s where s.key = 'rooms';
    added := pg_temp.m1s6_switches_on('rooms') - b;
    select a.actor_email, a.metadata ->> 'by' into actor, by_
      from public.cockpit_audit_log as a
     where a.action = 'settings.switch' and a.entity_id = 'rooms' and a.after ->> 'rooms.everyone' = 'true'
     order by a.created_at desc limit 1;
    raise exception using errcode = 'P0001', message = 'm1s6_undo';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'm1s6_undo' then said := said || ' error: ' || sqlerrm; end if;
  end;
  insert into pg_temp.m1s6_checks (name, ok, detail)
  values ('m1-security-r6-settings-updated-at-only-borrows-managers-name: a write that turns test_only off and refreshes only updated_at (updated_by left as the manager who switched the pilot on) is refused, never taken in that manager''s name',
          refused,
          format('refused %%s; rooms.test_only now %%s; settings.switch rows added %%s, naming actor %%s (by %%s) %%s',
                 refused, tonly, added, coalesce(actor, '(none)'), coalesce(by_, '(none)'), said));
end
$f5$;

select name, ok, detail from pg_temp.m1s6_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email in ('%(boss)s', '%(script)s')
union all
select 'setting ' || key from public.cockpit_sales_settings where key like 'stress_m1s6%%'
union all
select 'audit ' || action from public.cockpit_audit_log
 where action = 'settings.switch' and (metadata ->> 'by' in ('%(boss)s', '%(script)s') or actor_email in ('%(boss)s', '%(script)s'))
"""


def fill(sql: str) -> str:
    return sql.replace("%(boss)s", BOSS).replace("%(script)s", SCRIPT).replace("%%", "%")


def compose() -> str:
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '100s';",
             "-- ===== 20261003d + 20261004a (the repo's, idempotent) =====", run_checks.hardening_sql(),
             fill(CHECKS), "rollback;"]
    sql = "\n".join(parts)
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return sql


def main():
    before = q(fill(LEFTOVERS), write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = q(compose(), write=True)
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = q(fill(LEFTOVERS), write=False)
    if after:
        print("LEFT BEHIND:", json.dumps([r["what"] for r in after]))
        sys.exit(1)
    print("Nothing persisted.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
