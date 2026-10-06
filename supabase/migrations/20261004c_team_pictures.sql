-- Native meeting pictures. Apply after 20261004b_team_native_security.sql.
-- Browser roles can only reserve/confirm through scoped RPCs. Storage writes
-- use non-upserting service-signed uploads; URLs and source credentials never
-- enter receipts. Acceptance checks Storage's real metadata in the transaction.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-docs','team-docs',false,10485760,array['image/png','image/jpeg','image/gif','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.cockpit_team_pictures (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  meeting_id text not null references public.team_meetings(id),
  path text not null unique,
  kind text not null check(kind in ('upload','fromUrl')),
  content_type text not null check(content_type in ('image/png','image/jpeg','image/gif','image/webp')),
  bytes bigint not null check(bytes between 1 and 10485760),
  source_hash text,
  source_host text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check(path ~ '^[a-z0-9][a-z0-9-]{0,80}/[0-9]{4}-(0[1-9]|1[0-2])/[a-f0-9]{32}\.(png|jpg|gif|webp)$'),
  check(split_part(path,'/',1)=meeting_id),
  check((kind='upload' and source_hash is null and source_host is null) or
        (kind='fromUrl' and source_hash ~ '^[a-f0-9]{64}$' and source_host is not null))
);
create table public.cockpit_team_picture_health (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  provider text not null check(provider in ('image-import','supabase-storage')),
  resource text not null,
  phase text not null check(phase in ('intent','response','failed')),
  http_status integer,
  created_at timestamptz not null default now()
);
alter table public.cockpit_team_pictures enable row level security;
alter table public.cockpit_team_picture_health enable row level security;
revoke all on public.cockpit_team_pictures,public.cockpit_team_picture_health from public,anon,authenticated;
grant select,insert,update on public.cockpit_team_pictures to service_role;
grant select,insert on public.cockpit_team_picture_health to service_role;
grant usage,select on sequence public.cockpit_team_picture_health_id_seq to service_role;

create function public.cockpit_team_picture_context(p_meeting_id text,p_path text default null,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pic public.cockpit_team_pictures;
begin
  if not coalesce(public.cockpit_team_can_edit_doc(p_meeting_id),false) then raise exception 'This meeting is not available to your active seat' using errcode='42501'; end if;
  if p_path is not null or p_request_id is not null then
    select * into pic from public.cockpit_team_pictures
      where actor_id=auth.uid() and meeting_id=p_meeting_id
        and (p_path is null or path=p_path) and (p_request_id is null or request_id=p_request_id);
    if p_path is not null and pic.request_id is null then raise exception 'That picture does not belong to this meeting and upload owner' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('actorId',auth.uid(),'picture',case when pic.request_id is null then null else to_jsonb(pic) end);
end $$;

create function public.cockpit_team_picture_reserve(p_request_id uuid,p_meeting_id text,p_kind text,p_content_type text,p_bytes bigint,p_source_hash text default null,p_source_host text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pic public.cockpit_team_pictures; ext text; who text;
begin
  perform public.cockpit_team_picture_context(p_meeting_id);
  if p_request_id is null or p_meeting_id !~ '^[a-z0-9][a-z0-9-]{0,80}$' or p_kind not in ('upload','fromUrl') or
     p_content_type not in ('image/png','image/jpeg','image/gif','image/webp') or p_bytes is null or p_bytes not between 1 and 10485760 then
    raise exception 'Choose a valid meeting and a PNG, JPEG, GIF or WebP picture up to 10 MB';
  end if;
  if (p_kind='upload' and (p_source_hash is not null or p_source_host is not null)) or
     (p_kind='fromUrl' and (p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$' or p_source_host is null or
      length(p_source_host)>253 or p_source_host !~ '^[a-z0-9.-]+$')) then raise exception 'Invalid picture source'; end if;
  ext:=case p_content_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/gif' then 'gif' when 'image/webp' then 'webp' end;
  -- Serialize duplicate request IDs before checking their immutable input binding.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into pic from public.cockpit_team_pictures where request_id=p_request_id;
  if pic.request_id is not null then
    if pic.actor_id<>auth.uid() or pic.meeting_id<>p_meeting_id or pic.kind<>p_kind or pic.content_type<>p_content_type or pic.bytes<>p_bytes or
       pic.source_hash is distinct from p_source_hash or pic.source_host is distinct from p_source_host then
      raise exception 'This request ID belongs to a different picture' using errcode='42501';
    end if;
    return to_jsonb(pic);
  end if;
  insert into public.cockpit_team_pictures(request_id,actor_id,meeting_id,path,kind,content_type,bytes,source_hash,source_host)
    values(p_request_id,auth.uid(),p_meeting_id,p_meeting_id||'/'||to_char(now() at time zone 'UTC','YYYY-MM')||'/'||replace(gen_random_uuid()::text,'-','')||'.'||ext,p_kind,p_content_type,p_bytes,p_source_hash,p_source_host)
    returning * into pic;
  select email into who from auth.users where id=auth.uid();
  insert into public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after)
    values('teamPictures.reserve','cockpit_team_pictures',pic.path,who,'team','supabase',to_jsonb(pic));
  return to_jsonb(pic);
end $$;

create function public.cockpit_team_picture_accept(p_meeting_id text,p_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pic public.cockpit_team_pictures; meta jsonb; who text; detail jsonb;
begin
  perform public.cockpit_team_picture_context(p_meeting_id,p_path);
  select * into strict pic from public.cockpit_team_pictures where path=p_path and actor_id=auth.uid() and meeting_id=p_meeting_id for update;
  select metadata into meta from storage.objects where bucket_id='team-docs' and name=pic.path;
  if meta is null then raise exception 'The picture did not arrive. Upload it again.'; end if;
  if (meta->>'size')::bigint is distinct from pic.bytes or (meta->>'mimetype') is distinct from pic.content_type then
    raise exception 'The uploaded picture does not match its reservation';
  end if;
  if pic.accepted_at is null then
    update public.cockpit_team_pictures set accepted_at=now() where request_id=pic.request_id returning * into pic;
    select email into who from auth.users where id=auth.uid();
    detail:=jsonb_build_object('path',pic.path,'bytes',pic.bytes,'contentType',pic.content_type,'from',pic.source_host);
    insert into public.team_changes(meeting_id,by_whom,what,detail)
      values(pic.meeting_id,who,case pic.kind when 'upload' then 'added a picture to the doc' else 'copied a picture into the doc' end,detail);
    insert into public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after)
      values('teamPictures.'||pic.kind,'cockpit_team_pictures',pic.path,who,'team','supabase',detail);
  end if;
  return to_jsonb(pic);
end $$;

revoke all on function public.cockpit_team_picture_context(text,text,uuid),public.cockpit_team_picture_reserve(uuid,text,text,text,bigint,text,text),public.cockpit_team_picture_accept(text,text) from public,anon,authenticated,service_role;
grant execute on function public.cockpit_team_picture_context(text,text,uuid),public.cockpit_team_picture_reserve(uuid,text,text,text,bigint,text,text),public.cockpit_team_picture_accept(text,text) to authenticated;

-- No INSERT/UPDATE policy: only a service-signed, non-upserting URL writes.
-- Existing imported paths remain readable; the exact meeting folder gates reads.
drop policy if exists cockpit_team_picture_read on storage.objects;
create policy cockpit_team_picture_read on storage.objects for select to authenticated using (
  bucket_id='team-docs' and name ~ '^[a-z0-9][a-z0-9-]{0,80}/[0-9]{4}-[0-9]{2}/[a-f0-9]{16,40}\.(png|jpg|gif|webp)$'
  and public.cockpit_team_can_edit_doc(split_part(name,'/',1))
);
grant select on storage.objects to authenticated;
commit;
