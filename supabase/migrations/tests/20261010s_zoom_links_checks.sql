-- Checks for 20261010s_sales_zoom_links.sql, always rolled back.
--
-- Run as ONE query: the migration's body (everything between its "begin;"
-- and "commit;") followed by this file, inside begin; ... rollback;
--
--   begin;
--   <20261010s body>
--   <this file>
--   rollback;
--
-- This file also ends in an error on purpose (the last block raises with the
-- summary), so even a runner that forgets the rollback commits nothing. The
-- summary reads "zoom_links checks: N of N passed" or names each failure.
-- Every fixture uses zl-test-* ids and @example.invalid addresses.
--
-- What it proves (plan §1): a non-manager turning Zoom links on is refused;
-- a manager turning them on is audited; turning them off with no actor works
-- and is audited; a rename is refused; anon cannot read either table; a
-- signed-in person without a seat sees no rows. And the catalog: row
-- security, one seat policy, select-only grants, the guard's functions
-- closed to browsers, the row shipped off.

create temp table zl_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.zl_ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.zl_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

-- The SQLSTATE a statement fails with, or 'none' (its effects stay when it succeeds).
create function pg_temp.zl_err(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'none';
exception when others then
  return sqlstate;
end;
$$;

-- A. The catalog ------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['cockpit_sales_zoom_links', 'cockpit_sales_groups'] loop
    perform pg_temp.zl_ck('A ' || t || ': RLS on, one seat policy, authenticated select only, anon none',
      (select c.relrowsecurity from pg_class as c where c.oid = ('public.' || t)::regclass)
      and (select count(*) = 1 and bool_and(p.policyname = t || '_seat_read' and p.cmd = 'SELECT' and p.qual = 'cockpit_sales_seat()')
             from pg_policies as p where p.schemaname = 'public' and p.tablename = t)
      and has_table_privilege('authenticated', 'public.' || t, 'select')
      and not has_table_privilege('authenticated', 'public.' || t, 'insert')
      and not has_table_privilege('authenticated', 'public.' || t, 'update')
      and not has_table_privilege('authenticated', 'public.' || t, 'delete')
      and not has_table_privilege('anon', 'public.' || t, 'select')
      and has_table_privilege('service_role', 'public.' || t, 'insert'));
  end loop;
  perform pg_temp.zl_ck('A the guard functions are security definer with an empty search_path, closed to browsers',
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
       from pg_proc as p where p.proname in ('cockpit_sales_zoom_links_guard', 'cockpit_sales_zoom_links_gone'))
    and not has_function_privilege('authenticated', 'public.cockpit_sales_zoom_links_guard()', 'execute')
    and not has_function_privilege('anon', 'public.cockpit_sales_zoom_links_gone()', 'execute'));
  perform pg_temp.zl_ck('A the triggers are on the settings table, beside 20261004a''s guard',
    (select count(*) from pg_trigger as g
      where g.tgrelid = 'public.cockpit_sales_settings'::regclass and not g.tgisinternal
        and g.tgname in ('cockpit_sales_zoom_links_guard', 'cockpit_sales_zoom_links_gone',
                         'cockpit_sales_zoom_links_gone_truncate', 'cockpit_sales_settings_guard')) = 4);
  perform pg_temp.zl_ck('A the zoom_links row ships off, with the CEO as the shared host',
    (select s.value -> 'enabled' = 'false'::jsonb and s.value ->> 'fallback_host' = 'aziz@maharamedia.com'
       from public.cockpit_sales_settings as s where s.key = 'zoom_links'));
  perform pg_temp.zl_ck('A the migration''s own insert left its settings.switch row (not named)',
    exists (select 1 from public.cockpit_audit_log as a
             where a.entity_id = 'zoom_links' and a.action = 'settings.switch' and a.metadata ->> 'op' = 'insert'
               and a.metadata ->> 'by' = 'not named' and a.after -> 'zoom_links.enabled' = 'false'::jsonb));
  perform pg_temp.zl_ck('A the team view names the Arabic name, after its old columns',
    (select array_agg(a.attname::text order by a.attnum) from pg_attribute as a
      where a.attrelid = 'public.cockpit_sales_team'::regclass and a.attnum > 0 and not a.attisdropped)
    = array['email', 'name', 'role', 'ghl_user_id', 'b2b_rep_id', 'active', 'via_portal', 'name_ar']);
  perform pg_temp.zl_ck('A the group invite check refuses a link that is not a WhatsApp invite',
    pg_temp.zl_err($q$insert into public.cockpit_sales_groups (contact_id, invite_link, made_by)
                      values ('zl-test-bad', 'https://wa.me/965', 'zl-test@example.invalid')$q$) = '23514');
end;
$$;

-- B. The switch -----------------------------------------------------------------------

do $$
declare
  mgr constant text := 'zl-test-mgr@example.invalid';
  setter constant text := 'zl-test-setter@example.invalid';
  s text;
  n_before integer;
begin
  insert into public.cockpit_sales_people (email, name, role, active, via_portal)
  values (mgr, 'ZL Manager', 'manager', true, true), (setter, 'ZL Setter', 'setter', true, true)
  on conflict (email) do update set role = excluded.role, active = true;

  -- No one named: refused.
  perform set_config('mahara.actor', '', true);
  s := pg_temp.zl_err($q$update public.cockpit_sales_settings set value = value || '{"enabled": true}'::jsonb where key = 'zoom_links'$q$);
  perform pg_temp.zl_ck('B turning it on with no one named is refused (42501)', s = '42501', s);

  -- A setter named: refused.
  perform set_config('mahara.actor', setter, true);
  s := pg_temp.zl_err(format($q$update public.cockpit_sales_settings set value = value || '{"enabled": true}'::jsonb, updated_by = %L where key = 'zoom_links'$q$, setter));
  perform pg_temp.zl_ck('B a non-manager turning it on is refused (42501)', s = '42501', s);

  -- A manager named, but updated_by left as someone else: refused.
  perform set_config('mahara.actor', mgr, true);
  s := pg_temp.zl_err($q$update public.cockpit_sales_settings set value = value || '{"enabled": true}'::jsonb, updated_by = 'migration' where key = 'zoom_links'$q$);
  perform pg_temp.zl_ck('B a manager who does not write updated_by as themselves is refused (42501)', s = '42501', s);

  -- A non-manager changing the shared host: refused.
  perform set_config('mahara.actor', setter, true);
  s := pg_temp.zl_err(format($q$update public.cockpit_sales_settings set value = value || '{"fallback_host": "x@example.invalid"}'::jsonb, updated_by = %L where key = 'zoom_links'$q$, setter));
  perform pg_temp.zl_ck('B a non-manager changing the shared host is refused (42501)', s = '42501', s);

  -- The manager turns it on: done and audited.
  perform set_config('mahara.actor', mgr, true);
  s := pg_temp.zl_err(format($q$update public.cockpit_sales_settings set value = value || '{"enabled": true}'::jsonb, updated_by = %L, updated_at = now() where key = 'zoom_links'$q$, mgr));
  -- (Every row in one transaction has the same created_at, so rows are found by what they say.)
  perform pg_temp.zl_ck('B a manager turning it on is done and audited (settings.switch by the manager)',
    s = 'none'
    and (select value -> 'enabled' = 'true'::jsonb from public.cockpit_sales_settings where key = 'zoom_links')
    and exists (select 1 from public.cockpit_audit_log as a
                 where a.entity_type = 'cockpit_sales_settings' and a.entity_id = 'zoom_links' and a.action = 'settings.switch'
                   and a.actor_email = mgr and a.after -> 'zoom_links.enabled' = 'true'::jsonb
                   and a.metadata -> 'turned_on' @> '["zoom_links.enabled"]'::jsonb),
    s);

  -- Off with no one named: done and audited as "not named".
  perform set_config('mahara.actor', '', true);
  select count(*) into n_before from public.cockpit_audit_log where entity_id = 'zoom_links' and action = 'settings.switch';
  s := pg_temp.zl_err($q$update public.cockpit_sales_settings set value = value || '{"enabled": false}'::jsonb where key = 'zoom_links'$q$);
  perform pg_temp.zl_ck('B turning it off needs no one and is audited as not named',
    s = 'none'
    and (select count(*) from public.cockpit_audit_log where entity_id = 'zoom_links' and action = 'settings.switch') = n_before + 1
    and exists (select 1 from public.cockpit_audit_log as a
                 where a.entity_id = 'zoom_links' and a.action = 'settings.switch' and a.metadata ->> 'op' = 'update'
                   and a.metadata ->> 'by' = 'not named' and a.before -> 'zoom_links.enabled' = 'true'::jsonb
                   and a.after -> 'zoom_links.enabled' = 'false'::jsonb),
    s);

  -- A rename to or from zoom_links: refused.
  insert into public.cockpit_sales_settings (key, value, updated_by)
  values ('zl_test_stage', '{"enabled": true, "fallback_host": "x@example.invalid"}'::jsonb, 'zl-test');
  s := pg_temp.zl_err($q$update public.cockpit_sales_settings set key = 'zoom_links_old' where key = 'zoom_links'$q$);
  perform pg_temp.zl_ck('B renaming zoom_links away is refused (42501)', s = '42501', s);
  delete from public.cockpit_sales_settings where key = 'zoom_links';
  s := pg_temp.zl_err($q$update public.cockpit_sales_settings set key = 'zoom_links' where key = 'zl_test_stage'$q$);
  perform pg_temp.zl_ck('B renaming a staged row to zoom_links is refused (42501)', s = '42501', s);

  -- The delete above was Zoom links turned off by anyone: audited.
  perform pg_temp.zl_ck('B deleting the row is audited as removed',
    exists (select 1 from public.cockpit_audit_log as a2
             where a2.entity_id = 'zoom_links' and a2.action = 'settings.switch'
               and a2.metadata ->> 'row_removed' = 'true' and a2.metadata ->> 'op' = 'delete'));

  -- A new row turned on straight away, or naming another host, is a manager's too.
  perform set_config('mahara.actor', setter, true);
  s := pg_temp.zl_err(format($q$insert into public.cockpit_sales_settings (key, value, updated_by)
                               values ('zoom_links', '{"enabled": true, "fallback_host": "aziz@maharamedia.com"}'::jsonb, %L)$q$, setter));
  perform pg_temp.zl_ck('B a new row inserted on, by a non-manager, is refused (42501)', s = '42501', s);
  s := pg_temp.zl_err(format($q$insert into public.cockpit_sales_settings (key, value, updated_by)
                               values ('zoom_links', '{"enabled": false, "fallback_host": "x@example.invalid"}'::jsonb, %L)$q$, setter));
  perform pg_temp.zl_ck('B a new row naming another shared host, by a non-manager, is refused (42501)', s = '42501', s);
  perform set_config('mahara.actor', '', true);
end;
$$;

-- C. Who reads the tables ----------------------------------------------------------------

do $$
declare
  s_anon_links text;
  s_anon_groups text;
  s_write text;
  n_links integer;
  n_groups integer;
begin
  insert into public.cockpit_sales_zoom_links (contact_id, seat_email, call_kind, host_kind, host_email, meeting_id, join_url)
  values ('zl-test-lead', 'zl-test-setter@example.invalid', 'intro', 'shared', 'zl-test-host@example.invalid', '1', 'https://example.invalid/j/1');
  insert into public.cockpit_sales_groups (contact_id, made_by)
  values ('zl-test-lead', 'zl-test-setter@example.invalid');

  set local role anon;
  s_anon_links := pg_temp.zl_err($q$select count(*) from public.cockpit_sales_zoom_links$q$);
  s_anon_groups := pg_temp.zl_err($q$select count(*) from public.cockpit_sales_groups$q$);
  reset role;
  perform pg_temp.zl_ck('C anon reads neither table (42501)', s_anon_links = '42501' and s_anon_groups = '42501',
    s_anon_links || ' ' || s_anon_groups);

  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'email', 'zl-test-nobody@example.invalid')::text, true);
  set local role authenticated;
  select count(*) into n_links from public.cockpit_sales_zoom_links;
  select count(*) into n_groups from public.cockpit_sales_groups;
  s_write := pg_temp.zl_err($q$update public.cockpit_sales_groups set name = 'x'$q$);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.zl_ck('C a signed-in person without a seat sees no rows (rows exist) and cannot write',
    n_links = 0 and n_groups = 0 and s_write = '42501', format('%s links, %s groups, write %s', n_links, n_groups, s_write));
end;
$$;

-- D. The summary, always as an error, so nothing above can be committed ----------

do $$
declare
  total integer;
  failed text;
begin
  select count(*), string_agg(case when not ok then name || coalesce(' [' || detail || ']', '') end, '; ' order by n)
    into total, failed from pg_temp.zl_checks;
  if failed is null then
    raise exception 'zoom_links checks: % of % passed (rolled back)', total, total;
  end if;
  raise exception 'zoom_links checks FAILED: %', failed;
end;
$$;
