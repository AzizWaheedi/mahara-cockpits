-- Creative Triage only. An immutable revision is both the setting and its audit receipt.
create function public.cockpit_webinar_targets_valid(v jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  shape constant jsonb := '{"plannedSpend":1,"costPerRegistration":{"low":1,"high":1,"plan":1},"registrations":{"low":1,"high":1,"plan":1},"pageConversion":{"low":1,"high":1,"floor":1},"showRate":{"low":1,"high":1},"retentionAtPitch1":1,"attendeeToBooked":{"low":1,"high":1},"bookedToHeld":1,"closeRate":1,"killRule":{"spendAfter":1,"costPerRegistrationAbove":1}}';
  k text; c text; x jsonb; n numeric; is_rate boolean;
begin
  if v is null or jsonb_typeof(v) is distinct from 'object' then return false; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(v) key) is distinct from
     (select array_agg(key order by key) from jsonb_object_keys(shape) key) then return false; end if;
  for k in select jsonb_object_keys(shape) loop
    is_rate := k in ('pageConversion','showRate','retentionAtPitch1','attendeeToBooked','bookedToHeld','closeRate');
    if jsonb_typeof(shape->k) = 'object' then
      if jsonb_typeof(v->k) is distinct from 'object' then return false; end if;
      if (select array_agg(key order by key) from jsonb_object_keys(v->k) key) is distinct from
         (select array_agg(key order by key) from jsonb_object_keys(shape->k) key) then return false; end if;
      for c in select jsonb_object_keys(shape->k) loop
        x := v->k->c;
        if jsonb_typeof(x) is distinct from 'number' then return false; end if;
        n := x::text::numeric;
        if n < 0 or n > 1000000000 or (is_rate and n > 1) or
           (k = 'registrations' and n <> trunc(n)) or
           (k in ('costPerRegistration','killRule') and n = 0) then return false; end if;
      end loop;
      if k <> 'killRule' and (v->k->>'low')::numeric > (v->k->>'high')::numeric then return false; end if;
      if k in ('costPerRegistration','registrations') and
         ((v->k->>'plan')::numeric < (v->k->>'low')::numeric or (v->k->>'plan')::numeric > (v->k->>'high')::numeric) then return false; end if;
    else
      x := v->k;
      if jsonb_typeof(x) is distinct from 'number' then return false; end if;
      n := x::text::numeric;
      if n < 0 or n > 1000000000 or (is_rate and n > 1) or (k = 'plannedSpend' and n = 0) then return false; end if;
    end if;
  end loop;
  return (v->'pageConversion'->>'floor')::numeric <= (v->'pageConversion'->>'low')::numeric;
exception when others then return false;
end $$;

create table public.cockpit_webinar_target_versions (
  scope_key text not null check (scope_key = 'defaults' or (scope_key like 'round:%' and length(scope_key) between 7 and 200)),
  revision integer not null check (revision > 0),
  values jsonb not null check (public.cockpit_webinar_targets_valid(values)),
  changed_at timestamptz not null default clock_timestamp(),
  changed_by text not null check (length(btrim(changed_by)) between 1 and 200),
  request_id uuid not null unique,
  primary key (scope_key, revision)
);
alter table public.cockpit_webinar_target_versions enable row level security;
revoke all on public.cockpit_webinar_target_versions from public, anon, authenticated, service_role;
grant select, insert on public.cockpit_webinar_target_versions to service_role;

create function public.cockpit_save_webinar_targets(p_scope text, p_expected_revision integer, p_values jsonb, p_by text, p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare last_revision integer; saved public.cockpit_webinar_target_versions;
begin
  if p_scope is null or p_expected_revision is null or p_expected_revision < 0 or p_request_id is null
     or p_by is null or not public.cockpit_webinar_targets_valid(p_values) then
    raise exception 'Invalid webinar targets';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('webinar-targets:' || p_scope, 0));
  select * into saved from public.cockpit_webinar_target_versions where request_id = p_request_id;
  if found then
    if saved.scope_key <> p_scope or saved.values <> p_values or saved.changed_by <> p_by or saved.revision <> p_expected_revision + 1 then
      raise exception 'Request id already used';
    end if;
    return jsonb_build_object('status','saved','version',to_jsonb(saved));
  end if;
  select coalesce(max(revision),0) into last_revision from public.cockpit_webinar_target_versions where scope_key = p_scope;
  if last_revision <> p_expected_revision then return jsonb_build_object('status','conflict'); end if;
  insert into public.cockpit_webinar_target_versions(scope_key,revision,values,changed_by,request_id)
    values(p_scope,last_revision+1,p_values,p_by,p_request_id) returning * into saved;
  return jsonb_build_object('status','saved','version',to_jsonb(saved));
end $$;
revoke all on function public.cockpit_webinar_targets_valid(jsonb) from public, anon, authenticated;
revoke all on function public.cockpit_save_webinar_targets(text,integer,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.cockpit_webinar_targets_valid(jsonb) to service_role;
grant execute on function public.cockpit_save_webinar_targets(text,integer,jsonb,text,uuid) to service_role;
comment on table public.cockpit_webinar_target_versions is 'CEO-only target revisions; immutable through service-role API. No impact on campaign budgets or workflows.';
