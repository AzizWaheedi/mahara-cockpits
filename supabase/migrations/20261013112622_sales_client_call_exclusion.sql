-- Keep client-service and internal calls out of sales. Preserve source records.
-- This migration changes only sales objects. CSM matching remains read-only.
begin;
set local lock_timeout = '3s';

alter table public.cockpit_sales_recordings
  drop constraint if exists cockpit_sales_recordings_hidden_reason_check;
alter table public.cockpit_sales_recordings
  add constraint cockpit_sales_recordings_hidden_reason_check
  check (hidden_reason in ('duplicate', 'too short', 'client service', 'internal'));
alter table public.cockpit_sales_digests add column if not exists invalidated_at timestamptz;

-- Indexed recording identity, never a person's name or current customer status.
create or replace function public.cockpit_sales_call_exclusion(p_recording_id text, p_title text)
returns text language sql stable security invoker set search_path = '' as $$
  select case when exists (
    select 1 from public.cockpit_sales_call_notes n
    where n.recording_id = p_recording_id and n.notes->>'call_purpose' = 'internal'
      and length(btrim(coalesce(n.notes->>'call_purpose_evidence', ''))) >= 15
  ) then 'internal'
  when coalesce(p_title, '') ~* '(check[ -]?in|onboarding|kick[ -]?off|renewal|brand blueprint|launch call|مكالمة متابعة العميل|مكالمة انطلاق)'
    or exists (
      select 1 from public.cockpit_sales_call_notes n
      where n.recording_id = p_recording_id
        and n.notes->>'call_purpose' = 'client_service'
        and length(btrim(coalesce(n.notes->>'call_purpose_evidence', ''))) >= 15
    )
    or exists (
      select 1 from public.cockpit_csm_calls c
      where c.source = 'fathom' and c.source_id = p_recording_id
        and c.task_id is not null and c.status <> 'gone'
        and c.kind in ('onboarding', 'blueprint', 'launch', 'checkin')
        and c.match_method in ('client_id_field', 'invitee_email', 'appointment_time', 'manual')
    ) then 'client service' end;
$$;
revoke all on function public.cockpit_sales_call_exclusion(text,text) from public, anon, authenticated;
grant execute on function public.cockpit_sales_call_exclusion(text,text) to service_role;

create or replace function public.cockpit_sales_recording_scope_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.hidden_reason := coalesce(public.cockpit_sales_call_exclusion(new.recording_id, new.title), new.hidden_reason);
  if new.hidden_reason in ('client service', 'internal') then new.duplicate_of := null; end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_recording_scope_guard() from public, anon, authenticated;
grant execute on function public.cockpit_sales_recording_scope_guard() to service_role;
drop trigger if exists cockpit_sales_recording_scope_guard on public.cockpit_sales_recordings;
create trigger cockpit_sales_recording_scope_guard before insert or update on public.cockpit_sales_recordings
  for each row execute function public.cockpit_sales_recording_scope_guard();

create or replace function public.cockpit_sales_notes_scope_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.notes->>'call_purpose' in ('client_service', 'internal')
     and length(btrim(coalesce(new.notes->>'call_purpose_evidence', ''))) >= 15 then
    update public.cockpit_sales_recordings set hidden_reason = case when new.notes->>'call_purpose' = 'internal' then 'internal' else 'client service' end,
      duplicate_of = null where recording_id = new.recording_id;
  end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_notes_scope_guard() from public, anon, authenticated;
grant execute on function public.cockpit_sales_notes_scope_guard() to service_role;
drop trigger if exists cockpit_sales_notes_scope_guard on public.cockpit_sales_call_notes;
create trigger cockpit_sales_notes_scope_guard after insert or update of notes on public.cockpit_sales_call_notes
  for each row execute function public.cockpit_sales_notes_scope_guard();

-- A digest that used an excluded call is stale, even though its notes remain.
create or replace function public.cockpit_sales_invalidate_client_digest()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.hidden_reason in ('client service', 'internal') and old.hidden_reason is distinct from new.hidden_reason then
    update public.cockpit_sales_digests d set invalidated_at = now()
    where d.invalidated_at is null and (
      (d.digest->'source_recording_ids') ? new.recording_id
      or (not (d.digest ? 'source_recording_ids') and exists (
        select 1 from public.cockpit_sales_call_notes n
        where n.recording_id = new.recording_id and n.call_at between d.from_at and d.to_at
      ))
    );
  end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_invalidate_client_digest() from public, anon, authenticated;
grant execute on function public.cockpit_sales_invalidate_client_digest() to service_role;
drop trigger if exists cockpit_sales_invalidate_client_digest on public.cockpit_sales_recordings;
create trigger cockpit_sales_invalidate_client_digest after update of hidden_reason on public.cockpit_sales_recordings
  for each row execute function public.cockpit_sales_invalidate_client_digest();

-- Close the race where classification completes while the model writes a digest.
-- An old worker has no source IDs. Its result stays hidden until it is upgraded.
create or replace function public.cockpit_sales_digest_scope_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(new.digest->>'scope_version', '') <> '1'
     or jsonb_typeof(new.digest->'source_recording_ids') is distinct from 'array' then
    new.invalidated_at := now();
  elsif exists (
    select 1 from jsonb_array_elements_text(new.digest->'source_recording_ids') ids(rid)
    left join public.cockpit_sales_recordings r on r.recording_id = ids.rid
    where r.recording_id is null or r.hidden_reason is not null
  ) then
    new.invalidated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_digest_scope_guard() from public, anon, authenticated;
grant execute on function public.cockpit_sales_digest_scope_guard() to service_role;
drop trigger if exists cockpit_sales_digest_scope_guard on public.cockpit_sales_digests;
create trigger cockpit_sales_digest_scope_guard before insert or update of digest on public.cockpit_sales_digests
  for each row execute function public.cockpit_sales_digest_scope_guard();

-- Existing seat policies still authorize reads. These only narrow those reads.
drop policy if exists cockpit_sales_notes_no_client_service on public.cockpit_sales_call_notes;
create policy cockpit_sales_notes_no_client_service on public.cockpit_sales_call_notes
  as restrictive for select to authenticated using (not exists (
    select 1 from public.cockpit_sales_recordings r
    where r.recording_id = cockpit_sales_call_notes.recording_id and r.hidden_reason in ('client service', 'internal')
  ));
drop policy if exists cockpit_sales_reviews_no_client_service on public.cockpit_sales_reviews;
create policy cockpit_sales_reviews_no_client_service on public.cockpit_sales_reviews
  as restrictive for select to authenticated using (not exists (
    select 1 from public.cockpit_sales_recordings r
    where r.recording_id = cockpit_sales_reviews.recording_id and r.hidden_reason in ('client service', 'internal')
  ));

-- Preserve exclusions during every existing importer's duplicate pass.
create or replace function public.cockpit_sales_mark_recordings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  linked integer;
  excluded integer;
begin
  update public.cockpit_sales_recordings r set hidden_reason = public.cockpit_sales_call_exclusion(r.recording_id, r.title), duplicate_of = null
    where public.cockpit_sales_call_exclusion(r.recording_id, r.title) is not null
      and r.hidden_reason is distinct from public.cockpit_sales_call_exclusion(r.recording_id, r.title);
  get diagnostics excluded = row_count;

  with best as (
    select r.recording_id,
           (select b.recording_id
              from public.cockpit_sales_recordings as b
             where coalesce(b.hidden_reason, '') not in ('client service', 'internal')
               and coalesce(b.kind, '') = coalesce(r.kind, '')
               and b.started_at between r.started_at - interval '10 minutes'
                                    and r.started_at + interval '10 minutes'
               and (b.contact_id = r.contact_id or b.recorded_by = r.recorded_by)
             order by coalesce(b.duration_s, 0) desc,
                      coalesce(b.transcript_chars, 0) desc,
                      b.recording_id
             limit 1) as keep
      from public.cockpit_sales_recordings as r
     where coalesce(r.hidden_reason, '') not in ('client service', 'internal')
       and r.started_at is not null
       and coalesce(r.kind, '') <> 'phone'
       and (r.contact_id is not null or r.recorded_by is not null)
  ),
  want as (
    select r.recording_id,
           case when coalesce(r.hidden_reason, '') not in ('client service', 'internal') and b.keep <> r.recording_id then b.keep end as duplicate_of,
           case
             when r.hidden_reason in ('client service', 'internal') then r.hidden_reason
             when b.keep <> r.recording_id then 'duplicate'
             when r.kind = 'phone'
              and r.transcript_path is not null
              and coalesce(r.transcript_chars, 0) < 200
              and coalesce(r.duration_s, 0) < 60 then 'too short'
           end as hidden_reason
      from public.cockpit_sales_recordings as r
      left join best as b on b.recording_id = r.recording_id
  )
  update public.cockpit_sales_recordings as r
     set duplicate_of = w.duplicate_of,
         hidden_reason = w.hidden_reason
    from want as w
   where r.recording_id = w.recording_id
     and (r.duplicate_of is distinct from w.duplicate_of
          or r.hidden_reason is distinct from w.hidden_reason);
  get diagnostics changed = row_count;

  update public.cockpit_sales_recordings as k
     set contact_id = h.contact_id,
         matched_by = 'same meeting'
    from (
      select distinct on (d.duplicate_of) d.duplicate_of, d.contact_id
        from public.cockpit_sales_recordings as d
       where d.duplicate_of is not null
         and d.contact_id is not null
         and coalesce(d.hidden_reason, '') not in ('client service', 'internal')
       order by d.duplicate_of, coalesce(d.duration_s, 0) desc
    ) as h
   where k.recording_id = h.duplicate_of
     and k.contact_id is null
     and coalesce(k.hidden_reason, '') not in ('client service', 'internal');
  get diagnostics linked = row_count;

  return changed + linked + excluded;
end;
$$;
revoke all on function public.cockpit_sales_mark_recordings() from public, anon, authenticated;
grant execute on function public.cockpit_sales_mark_recordings() to service_role;

-- Exact recordings checked against their stored summaries. Prefix guards stop a
-- correction from applying if the evidence has changed. No person-name blacklist.
with confirmed(recording_id, purpose, summary_prefix) as (values
  ('190894076', 'client_service', 'Retention/save call, not a true demo. Existing Mahara client'),
  ('191799288', 'client_service', 'Feedback/account call with an existing Mahara client'),
  ('188616553', 'client_service', 'Retention/save call with an unhappy existing client, not a new prospect.'),
  ('191742063', 'internal', 'Internal Mahara CSM daily'),
  ('191610368', 'internal', 'Internal Mahara account-review call'),
  ('191607399', 'internal', 'Internal CSM daily (not a sales call).'),
  ('191607412', 'internal', 'Internal Mahara operations review on Zoom'),
  ('190915779', 'internal', 'Not a sales call. This is an internal CSM coaching/review session:'),
  ('190490762', 'internal', 'Internal account-review debrief'),
  ('176428652', 'internal', 'Internal Mahara team meeting')
)
update public.cockpit_sales_call_notes n
set notes = n.notes || jsonb_build_object(
  'call_purpose', c.purpose,
  'call_purpose_evidence', c.summary_prefix,
  'call_purpose_source', 'verified correction 2026-10-13'
)
from confirmed c
where n.recording_id = c.recording_id
  and n.notes->>'summary' like c.summary_prefix || '%'
  and n.notes->>'call_purpose' is distinct from c.purpose;
select public.cockpit_sales_mark_recordings();
notify pgrst, 'reload schema';
commit;
