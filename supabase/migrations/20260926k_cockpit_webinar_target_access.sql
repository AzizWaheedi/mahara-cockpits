-- Migration: 20260926k_cockpit_webinar_target_access.sql
-- Description: CEO webinar targets RPC access, validation, round inheritance, and audit logging.

BEGIN;

-- 1. Helper function to validate scope and derive startedAt from cockpit_sections (key = 'webinar')
create or replace function public.cockpit_resolve_webinar_scope(p_scope text)
returns table(valid boolean, is_round boolean, round_key text, started_at bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_round jsonb;
  v_found boolean := false;
  v_first_reg bigint;
  v_spend_from text;
  v_spend_from_epoch bigint;
  v_started_at bigint := null;
  v_key text;
begin
  if p_scope is null then
    return query select false, false, null::text, null::bigint;
    return;
  end if;

  if p_scope = 'defaults' then
    return query select true, false, null::text, null::bigint;
    return;
  end if;

  if p_scope like 'round:%' and length(p_scope) between 7 and 200 then
    v_key := substring(p_scope from 7);

    -- Reject next, untagged, or empty
    if v_key in ('next', 'untagged', '') then
      return query select false, false, null::text, null::bigint;
      return;
    end if;

    -- Look up round in cockpit_sections where key = 'webinar'
    select payload into v_payload
    from public.cockpit_sections
    where key = 'webinar'
    limit 1;

    if v_payload is not null and jsonb_typeof(v_payload->'rounds') = 'array' then
      for v_round in select jsonb_array_elements(v_payload->'rounds') loop
        if v_round->>'key' = v_key then
          v_found := true;

          -- Calculate roundTargetStart:
          -- earliest positive registration.firstRegisteredAt and spendFrom at Kuwait midnight (UTC+3)
          v_first_reg := null;
          if jsonb_typeof(v_round->'registration'->'firstRegisteredAt') = 'number' then
            v_first_reg := (v_round->'registration'->>'firstRegisteredAt')::bigint;
            if v_first_reg <= 0 then
              v_first_reg := null;
            end if;
          end if;

          v_spend_from := v_round->>'spendFrom';
          v_spend_from_epoch := null;
          if v_spend_from is not null and v_spend_from ~ '^\d{4}-\d{2}-\d{2}$' then
            begin
              -- Kuwait midnight is UTC+03:00. Extract epoch in milliseconds.
              v_spend_from_epoch := (extract(epoch from (v_spend_from || ' 00:00:00+03')::timestamptz) * 1000)::bigint;
              if v_spend_from_epoch <= 0 then
                v_spend_from_epoch := null;
              end if;
            exception when others then
              v_spend_from_epoch := null;
            end;
          end if;

          if v_first_reg is not null and v_spend_from_epoch is not null then
            v_started_at := least(v_first_reg, v_spend_from_epoch);
          elsif v_first_reg is not null then
            v_started_at := v_first_reg;
          elsif v_spend_from_epoch is not null then
            v_started_at := v_spend_from_epoch;
          else
            v_started_at := null;
          end if;

          exit;
        end if;
      end loop;
    end if;

    if v_found then
      return query select true, true, v_key, v_started_at;
      return;
    else
      return query select false, true, v_key, null::bigint;
      return;
    end if;
  end if;

  return query select false, false, null::text, null::bigint;
end;
$$;

revoke all on function public.cockpit_resolve_webinar_scope(text) from public, anon, authenticated;
grant execute on function public.cockpit_resolve_webinar_scope(text) to service_role;

-- 2. Client RPC: cockpit_ceo_webinar_target_context(p_scope text)
create or replace function public.cockpit_ceo_webinar_target_context(p_scope text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_valid boolean;
  v_is_round boolean;
  v_round_key text;
  v_started_at bigint;
  v_own jsonb;
  v_inherited jsonb := '[]'::jsonb;
begin
  -- Enforce server-side CEO check
  if public.cockpit_is_ceo() is not true then
    raise exception 'Unauthorized: CEO access required' using errcode = '42501';
  end if;

  -- Validate scope
  select valid, is_round, round_key, started_at
  into v_valid, v_is_round, v_round_key, v_started_at
  from public.cockpit_resolve_webinar_scope(p_scope);

  if not v_valid then
    raise exception 'Invalid or unrecognized webinar scope: %', p_scope;
  end if;

  -- Fetch newest 10 versions for own scope
  select coalesce(jsonb_agg(to_jsonb(t) order by t.revision desc), '[]'::jsonb)
  into v_own
  from (
    select scope_key, revision, values, changed_at, changed_by
    from public.cockpit_webinar_target_versions
    where scope_key = p_scope
    order by revision desc
    limit 10
  ) t;

  -- If round scope, fetch newest defaults version at or before startedAt for round inheritance
  if v_is_round then
    if v_started_at is not null then
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      into v_inherited
      from (
        select scope_key, revision, values, changed_at, changed_by
        from public.cockpit_webinar_target_versions
        where scope_key = 'defaults'
          and extract(epoch from changed_at) * 1000 <= v_started_at
        order by revision desc
        limit 1
      ) t;
    end if;
  end if;

  return jsonb_build_object(
    'scope', p_scope,
    'startedAt', v_started_at,
    'own', v_own,
    'inherited', v_inherited
  );
end;
$$;

-- 3. Client RPC: cockpit_ceo_save_webinar_targets
create or replace function public.cockpit_ceo_save_webinar_targets(
  p_scope text,
  p_expected_revision integer,
  p_values jsonb,
  p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_valid boolean;
  v_is_round boolean;
  v_round_key text;
  v_started_at bigint;
  v_actor_email text;
  v_uid uuid;
  v_save_result jsonb;
  v_version jsonb;
  v_status text;
  v_rev integer;
begin
  -- Enforce server-side CEO check
  if public.cockpit_is_ceo() is not true then
    raise exception 'Unauthorized: CEO access required' using errcode = '42501';
  end if;

  -- Derive actor email from auth.users with auth.uid()
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Unauthorized: No active auth session' using errcode = '42501';
  end if;

  select lower(btrim(email)) into v_actor_email
  from auth.users
  where id = v_uid;

  if v_actor_email is null or length(btrim(v_actor_email)) = 0 then
    raise exception 'Actor email could not be resolved from auth session';
  end if;

  -- Validate scope
  select valid, is_round, round_key, started_at
  into v_valid, v_is_round, v_round_key, v_started_at
  from public.cockpit_resolve_webinar_scope(p_scope);

  if not v_valid then
    raise exception 'Invalid or unrecognized webinar scope: %', p_scope;
  end if;

  -- Call the existing service-only function public.cockpit_save_webinar_targets
  v_save_result := public.cockpit_save_webinar_targets(
    p_scope,
    p_expected_revision,
    p_values,
    v_actor_email,
    p_request_id
  );

  v_status := v_save_result->>'status';

  if v_status = 'conflict' then
    return jsonb_build_object(
      'status', 'conflict',
      'startedAt', v_started_at
    );
  end if;

  if v_status = 'saved' then
    v_version := v_save_result->'version';
    v_rev := (v_version->>'revision')::integer;

    return jsonb_build_object(
      'status', 'saved',
      'version', v_version,
      'startedAt', v_started_at
    );
  end if;

  return v_save_result;
end;
$$;

-- 4. Permissions: Explicit revoke/grant
revoke all on function public.cockpit_ceo_webinar_target_context(text) from public, anon;
grant execute on function public.cockpit_ceo_webinar_target_context(text) to authenticated, service_role;

revoke all on function public.cockpit_ceo_save_webinar_targets(text, integer, jsonb, uuid) from public, anon;
grant execute on function public.cockpit_ceo_save_webinar_targets(text, integer, jsonb, uuid) to authenticated, service_role;

-- Audit the physical insert, so concurrent same-request retries cannot duplicate it.
-- The existing target table and audit immutability rules remain unchanged.
create or replace function public.cockpit_audit_webinar_target_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email, source_app, source_system,
    before, after, metadata
  ) values (
    'INSERT', 'cockpit_webinar_target_versions', new.scope_key || ':' || new.revision,
    new.changed_by, 'ceo-webinar-targets', 'supabase', null, to_jsonb(new),
    jsonb_build_object('request_id', new.request_id, 'scope', new.scope_key, 'revision', new.revision)
  );
  return new;
end;
$$;
revoke all on function public.cockpit_audit_webinar_target_insert() from public, anon, authenticated, service_role;
drop trigger if exists cockpit_webinar_target_insert_audit on public.cockpit_webinar_target_versions;
create trigger cockpit_webinar_target_insert_audit
  after insert on public.cockpit_webinar_target_versions
  for each row execute function public.cockpit_audit_webinar_target_insert();

COMMIT;
