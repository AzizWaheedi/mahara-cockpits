-- The instant Zoom link and the setter's WhatsApp group (2026-10-10).
--
-- The CEO asked why the Zoom call can't be made straight away: the room
-- flow (20261003a) waits behind switches that are off. This adds a second,
-- plain path beside it, which sales-api's zoom.link action runs on its own:
-- one press makes a Zoom meeting and the rep gets the link to send from
-- their own WhatsApp. Nothing here touches the rooms, their switches or
-- their guard (20261004a).
--
-- 1. cockpit_sales_zoom_links: one row per meeting a press made (no host or
--    start link is ever stored; zoom.start reads a fresh one from Zoom).
-- 2. cockpit_sales_groups: the WhatsApp group the setter made from her own
--    phone for a booked demo, one row per lead.
-- 3. Row security and grants on both, as 20260924a: a seat reads, only the
--    service role writes.
-- 4. The zoom_links setting's guard: turning it on, or changing its shared
--    host, is a sales manager's, named in the same transaction; turning it
--    off or deleting it is anyone's. Every change leaves a settings.switch
--    audit row.
-- 5. The zoom_links row, shipped OFF.
-- 6. cockpit_sales_team gains name_ar, so the group's Arabic welcome can name
--    the closer as he writes his name (people is own-row only for a seat).
--
-- Checks: supabase/migrations/tests/20261010s_zoom_links_checks.sql (rolled back).

begin;

-- 1. The Zoom links ------------------------------------------------------------

create table if not exists public.cockpit_sales_zoom_links (
  id          uuid primary key default gen_random_uuid(),
  contact_id  text not null,
  seat_email  text not null,
  call_kind   text not null check (call_kind in ('intro', 'demo')),
  host_kind   text not null check (host_kind in ('own', 'shared')),
  host_email  text not null,
  meeting_id  text not null,
  join_url    text not null check (join_url ~ '^https://'),
  topic       text,
  made_at     timestamptz not null default now(),
  shared_at   timestamptz,
  shared_how  text check (shared_how is null or shared_how in ('whatsapp', 'copy_message', 'copy_link')),
  started_at  timestamptz,
  deleted_at  timestamptz,
  deleted_why text
);

create index if not exists cockpit_sales_zoom_links_contact
  on public.cockpit_sales_zoom_links (contact_id, made_at desc);
create index if not exists cockpit_sales_zoom_links_seat
  on public.cockpit_sales_zoom_links (seat_email, made_at desc);
-- The tidy's read: a host's meetings never started and not yet deleted.
create index if not exists cockpit_sales_zoom_links_tidy
  on public.cockpit_sales_zoom_links (host_email, made_at)
  where deleted_at is null and started_at is null;

comment on table public.cockpit_sales_zoom_links is
  'One Zoom meeting per row, made by sales-api zoom.link when a rep pressed "Zoom link" (2026-10-10). Pressing again for the same lead, seat and kind within reuse_hours gives the same row. No host or start link is stored: zoom.start reads a fresh one from Zoom.';
comment on column public.cockpit_sales_zoom_links.seat_email is 'The rep who pressed.';
comment on column public.cockpit_sales_zoom_links.host_kind is
  'own: the rep''s own licensed Zoom user hosts it (join before host off). shared: the zoom_links fallback_host hosts it and both sides join as participants (join before host on).';
comment on column public.cockpit_sales_zoom_links.host_email is 'The Zoom user the meeting was made on.';
comment on column public.cockpit_sales_zoom_links.join_url is 'The join link, with the passcode in it (pwd=), as the lead gets it.';
comment on column public.cockpit_sales_zoom_links.shared_how is 'How the rep last shared it from the cockpit: whatsapp (their own WhatsApp opened), copy_message or copy_link.';
comment on column public.cockpit_sales_zoom_links.started_at is
  'When the meeting first started: the rep asked for the start link (own host), or the tidy found Zoom had held it (its past-meeting start). A started meeting is never tidied.';
comment on column public.cockpit_sales_zoom_links.deleted_at is
  'When the meeting left Zoom: tidied (never held: Zoom has no past meeting for it, older than tidy_after_h) or found gone.';

-- 2. The WhatsApp groups ------------------------------------------------------

create table if not exists public.cockpit_sales_groups (
  id             uuid primary key default gen_random_uuid(),
  contact_id     text not null unique,
  appointment_id text,
  name           text,
  invite_link    text check (invite_link is null or invite_link ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,64}$'),
  made_by        text not null,
  made_at        timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  crm_note       text
);

comment on table public.cockpit_sales_groups is
  'The WhatsApp group a setter made from her own phone for a lead''s demo (2026-10-10), one row per lead: made again, the row is updated (sales-api group.made). The cockpit never posts in it.';
comment on column public.cockpit_sales_groups.invite_link is 'The group''s invite link as WhatsApp copies it (query removed).';
comment on column public.cockpit_sales_groups.crm_note is
  'The HighLevel note that says the group was made (never the link): written, or failed: and why.';

-- 3. Row security and grants ------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['cockpit_sales_zoom_links', 'cockpit_sales_groups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_seat_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.cockpit_sales_seat())',
      t || '_seat_read', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

-- 4. The zoom_links setting's guard -------------------------------------------
--
-- A separate trigger beside 20261004a's cockpit_sales_settings_guard (which
-- is left as it is): the actor is the one the write names in its own
-- transaction (cockpit_sales_settings_actor: set local mahara.actor, or the
-- x-mahara-actor header), never read from the row. What widens: enabled
-- turning true; fallback_host changing on an update, or a new row naming a
-- host other than the shipped one. Turning it off needs no one.

create or replace function public.cockpit_sales_zoom_links_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shipped_host constant text := 'aziz@maharamedia.com';
  actor text := public.cockpit_sales_settings_actor();
  old_on boolean := false;
  new_on boolean;
  old_host text := null;
  new_host text;
  widened text[] := '{}';
  changed text[] := '{}';
  manager boolean;
begin
  if tg_op = 'UPDATE' and new.key is distinct from old.key
     and (old.key = 'zoom_links' or new.key = 'zoom_links') then
    raise exception using errcode = '42501',
      message = 'The zoom_links setting keeps its key: write its value instead of renaming a row to or from it.',
      hint = 'To turn Zoom links off, set enabled false or delete the row; to turn them on, a manager writes it.';
  end if;
  if new.key is distinct from 'zoom_links' then
    return new;
  end if;
  -- An insert on a key already there is skipped, fails, or becomes an update.
  if tg_op = 'INSERT' and exists (select 1 from public.cockpit_sales_settings as s where s.key = 'zoom_links') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    old_on := coalesce(old.value -> 'enabled' = 'true'::jsonb, false);
    old_host := old.value ->> 'fallback_host';
  end if;
  new_on := coalesce(new.value -> 'enabled' = 'true'::jsonb, false);
  new_host := new.value ->> 'fallback_host';
  if new_on is distinct from old_on then
    changed := changed || 'zoom_links.enabled'::text;
    if new_on then
      widened := widened || 'zoom_links.enabled'::text;
    end if;
  end if;
  if new_host is distinct from old_host then
    changed := changed || 'zoom_links.fallback_host'::text;
    if tg_op = 'UPDATE' or new_host is distinct from shipped_host then
      widened := widened || 'zoom_links.fallback_host'::text;
    end if;
  end if;
  if cardinality(changed) = 0 then
    return new;
  end if;
  if cardinality(widened) > 0 then
    manager := actor is not null
               and actor = lower(btrim(coalesce(new.updated_by, '')))
               and exists (select 1 from public.cockpit_sales_people as p
                            where lower(p.email) = actor and p.role = 'manager' and p.active);
    if not manager then
      raise exception using errcode = '42501',
        message = 'Only a sales manager turns on Zoom links or changes their shared host: name yourself in the same transaction (set local mahara.actor = ''<your email>'') and write updated_by as that email.',
        hint = 'Turning Zoom links off needs no manager.';
    end if;
  end if;
  insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  values ('settings.switch', 'cockpit_sales_settings', 'zoom_links',
          case when actor ~ '^[^@\s]+@[^@\s]+$' then actor end,
          'sales', 'database',
          jsonb_build_object('zoom_links.enabled', old_on, 'zoom_links.fallback_host', old_host),
          jsonb_build_object('zoom_links.enabled', new_on, 'zoom_links.fallback_host', new_host),
          jsonb_build_object('by', coalesce(actor, 'not named'), 'named', actor is not null,
                             'updated_by', new.updated_by, 'op', lower(tg_op),
                             'session_user', session_user,
                             'changed', to_jsonb(changed), 'turned_on', to_jsonb(widened)));
  return new;
end;
$$;
revoke all on function public.cockpit_sales_zoom_links_guard() from public, anon, authenticated;

-- The row deleted (or the table truncated) is Zoom links turned off, which
-- sales-api reads as off: anyone may, and it is audited.
create or replace function public.cockpit_sales_zoom_links_gone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := public.cockpit_sales_settings_actor();
  v jsonb;
begin
  if tg_op = 'TRUNCATE' then
    select s.value into v from public.cockpit_sales_settings as s where s.key = 'zoom_links';
    if not found then
      return null;
    end if;
  elsif old.key = 'zoom_links' then
    v := old.value;
  else
    return old;
  end if;
  insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  values ('settings.switch', 'cockpit_sales_settings', 'zoom_links',
          case when actor ~ '^[^@\s]+@[^@\s]+$' then actor end,
          'sales', 'database',
          jsonb_build_object('zoom_links.enabled', coalesce(v -> 'enabled' = 'true'::jsonb, false),
                             'zoom_links.fallback_host', v ->> 'fallback_host'),
          jsonb_build_object('zoom_links.enabled', false, 'zoom_links.fallback_host', null),
          jsonb_build_object('by', coalesce(actor, 'not named'), 'named', actor is not null,
                             'op', lower(tg_op), 'row_removed', true, 'session_user', session_user));
  if tg_op = 'TRUNCATE' then
    return null;
  end if;
  return old;
end;
$$;
revoke all on function public.cockpit_sales_zoom_links_gone() from public, anon, authenticated;

drop trigger if exists cockpit_sales_zoom_links_guard on public.cockpit_sales_settings;
create trigger cockpit_sales_zoom_links_guard
  before insert or update on public.cockpit_sales_settings
  for each row execute function public.cockpit_sales_zoom_links_guard();
drop trigger if exists cockpit_sales_zoom_links_gone on public.cockpit_sales_settings;
create trigger cockpit_sales_zoom_links_gone
  before delete on public.cockpit_sales_settings
  for each row when (old.key = 'zoom_links') execute function public.cockpit_sales_zoom_links_gone();
drop trigger if exists cockpit_sales_zoom_links_gone_truncate on public.cockpit_sales_settings;
create trigger cockpit_sales_zoom_links_gone_truncate
  before truncate on public.cockpit_sales_settings
  for each statement execute function public.cockpit_sales_zoom_links_gone();

-- 5. The setting, shipped off (the trigger above audits this insert) ----------

insert into public.cockpit_sales_settings (key, value, updated_by)
values ('zoom_links',
        '{"enabled": false, "fallback_host": "aziz@maharamedia.com", "per_seat_hour": 20, "reuse_hours": 12,
          "tidy_after_h": 24, "lengths_min": {"intro": 30, "demo": 60}}'::jsonb,
        'migration 20261010s')
on conflict (key) do nothing;

-- 6. The team list names each seat's Arabic name too --------------------------
-- (20260924f's view, the same columns in the same order, name_ar added at the end.)

create or replace view public.cockpit_sales_team as
select p.email, p.name, p.role, p.ghl_user_id, p.b2b_rep_id, p.active, p.via_portal, p.name_ar
  from public.cockpit_sales_people as p
 where public.cockpit_sales_seat();

revoke all on public.cockpit_sales_team from public, anon, authenticated;
grant select on public.cockpit_sales_team to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
