-- Social media: which Page and Instagram account a client posts from, and
-- the client's sign-off on their posts through the review link.
--
-- Aziz, 2026-09-23: "ok do it" -- link each client to their Facebook Page
-- and Instagram account, and let clients who must approve do it on the
-- same review page the videos use.

-- ---------------------------------------------------------------------------
-- 1. The accounts a client posts from. One Page and the Instagram account
--    linked to it; chosen by a person in Settings, never guessed into place,
--    because a wrong link posts one client's work on another's account.

alter table public.social_clients
  add column if not exists fb_page_id text,
  add column if not exists fb_page_name text,
  add column if not exists ig_user_id text,
  add column if not exists ig_username text,
  add column if not exists accounts_linked_at timestamptz,
  add column if not exists accounts_linked_by text;

-- The Pages the ads system token manages, with the Instagram account on
-- each, refreshed by Salma. `ad_clients` holds the ClickUp ids whose ad
-- account advertises with the Page: the strongest sign of whose it is.
create table if not exists public.social_meta_pages (
  page_id        text primary key,
  name           text not null,
  picture_url    text,
  ig_user_id     text,
  ig_username    text,
  ig_name        text,
  ig_picture_url text,
  ad_clients     text[] not null default '{}',
  seen_at        timestamptz not null default now()
);
alter table public.social_meta_pages enable row level security;
revoke all on public.social_meta_pages from anon, authenticated;
grant select, insert, update, delete on public.social_meta_pages to service_role;

-- ---------------------------------------------------------------------------
-- 2. Sign-off on a post: sent, approved, a change asked, or changed after
--    the client approved it.

alter table public.social_posts
  add column if not exists client_status text,
  add column if not exists client_note text,
  add column if not exists client_sent_at timestamptz,
  add column if not exists client_decided_at timestamptz,
  add column if not exists client_reviewer text,
  add column if not exists review_token text;
alter table public.social_posts drop constraint if exists social_posts_client_status_check;
alter table public.social_posts
  add constraint social_posts_client_status_check
  check (client_status in ('sent', 'approved', 'changes', 'changed'));

-- An approval covers what the client saw. Change the pictures, the words or
-- the shape afterwards and the post needs their sign-off again -- enforced
-- here, so no writer (the cockpit, Salma, a hand edit) can slip past it.
create or replace function public.social_post_changed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.client_status = 'approved'
     and new.client_status is not distinct from old.client_status
     and (new.media is distinct from old.media
          or new.caption is distinct from old.caption
          or new.caption_facebook is distinct from old.caption_facebook
          or new.aspect is distinct from old.aspect) then
    new.client_status := 'changed';
  end if;
  return new;
end;
$$;
drop trigger if exists social_post_changed on public.social_posts;
create trigger social_post_changed
  before update on public.social_posts
  for each row execute function public.social_post_changed();

-- ---------------------------------------------------------------------------
-- 3. A review item can be a social post. The page reads the post live, so a
--    typo fixed after the link went out is fixed for the client too.

alter table public.review_items add column if not exists post_id text;
alter table public.review_items drop constraint if exists review_items_kind_check;
alter table public.review_items
  add constraint review_items_kind_check check (kind in ('video', 'image', 'post'));

create or replace function public.review_create(
  p_title text, p_note text, p_client text, p_client_task_id text, p_by text,
  p_items jsonb, p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare tok text; it jsonb; i integer := 0;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'a review needs a title';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'a review needs at least one video';
  end if;

  tok := replace(encode(gen_random_bytes(18), 'base64'), '/', '_');
  tok := replace(replace(tok, '+', '-'), '=', '');

  insert into public.review_links
    (token, client_task_id, client_name, title, note, created_by, expires_at)
  values (tok, p_client_task_id, p_client, btrim(p_title),
          nullif(btrim(coalesce(p_note,'')), ''), p_by,
          now() + make_interval(days => greatest(1, least(365, p_days))));

  for it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if coalesce(btrim(it->>'video_url'), '') = '' then
      raise exception 'item % has no url', i;
    end if;
    insert into public.review_items
      (id, token, n, task_id, title, video_url, poster_url, seconds, kind, post_id)
    values (tok || ':' || i, tok, i, nullif(it->>'task_id',''),
            coalesce(nullif(btrim(it->>'title'), ''), 'Item ' || i),
            btrim(it->>'video_url'), nullif(it->>'poster_url',''),
            nullif(it->>'seconds','')::numeric,
            case lower(coalesce(it->>'kind','video'))
                 when 'image' then 'image'
                 when 'post' then 'post'
                 else 'video' end,
            nullif(it->>'post_id',''));
  end loop;

  return jsonb_build_object('token', tok, 'items', i);
end;
$function$;

create or replace function public.review_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare link public.review_links; items jsonb;
begin
  select * into link from public.review_links
   where token = p_token and not revoked
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  if link.opened_at is null then
    update public.review_links set opened_at = now() where token = p_token;
    link.opened_at := now();
  end if;

  select coalesce(jsonb_agg(x order by x.n), '[]'::jsonb) into items from (
    select i.n, i.id, i.title, i.video_url, i.poster_url, i.seconds, i.kind,
           i.decision, i.decided_at,
           coalesce((
             select jsonb_agg(jsonb_build_object('at_seconds', nt.at_seconds,
                                                 'body', nt.body, 'at', nt.at)
                              order by nt.at)
             from public.review_notes nt where nt.item_id = i.id
           ), '[]'::jsonb) as notes,
           -- A post as it stands now: its items, both captions, its shape,
           -- where and when it goes out. Null once taken off the calendar.
           case when i.post_id is null then null else (
             select jsonb_build_object(
                      'media', p.media, 'caption', p.caption,
                      'caption_facebook', p.caption_facebook,
                      'aspect', p.aspect,
                      'platforms', coalesce(p.platforms, sc.platforms),
                      'goes_out_at', p.scheduled_at)
             from public.social_posts p
             left join public.social_clients sc on sc.client_task_id = p.client_task_id
             where p.id = i.post_id) end as post
    from public.review_items i where i.token = p_token
  ) x;

  return jsonb_build_object(
    'title', link.title, 'note', link.note, 'client', link.client_name,
    'reviewer', link.reviewer_name, 'created_at', link.created_at,
    'items', items);
end;
$function$;

create or replace function public.review_decide(
  p_token text, p_item text, p_decision text, p_note text, p_at numeric,
  p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare it public.review_items; lnk public.review_links; who text;
begin
  if p_decision is not null and p_decision not in ('approved', 'changes') then
    raise exception 'decision must be approved or changes';
  end if;
  if p_decision = 'changes' and coalesce(btrim(p_note), '') = '' then
    raise exception 'a change needs a note';
  end if;
  if p_decision is null and coalesce(btrim(p_note), '') = '' then
    raise exception 'there is nothing to save';
  end if;

  select l.* into lnk from public.review_links l
    join public.review_items i on i.token = l.token
   where l.token = p_token and i.id = p_item and not l.revoked
     and (l.expires_at is null or l.expires_at > now());
  if not found then return jsonb_build_object('ok', false); end if;
  select * into it from public.review_items where id = p_item;

  if coalesce(btrim(coalesce(p_name, '')), '') <> '' and lnk.reviewer_name is null then
    update public.review_links set reviewer_name = left(btrim(p_name), 80)
     where token = p_token;
    lnk.reviewer_name := left(btrim(p_name), 80);
  end if;
  who := coalesce(lnk.reviewer_name, lnk.client_name, 'The client');

  if p_decision is not null then
    update public.review_items set decision = p_decision, decided_at = now()
     where id = p_item;
  end if;

  if coalesce(btrim(p_note), '') <> '' then
    insert into public.review_notes (item_id, at_seconds, body, task_id)
    values (p_item, p_at, left(btrim(p_note), 2000), it.task_id);

    if it.task_id is not null then
      insert into public.editor_notes
        (id, task_id, at_sec, text, by_name, source, done, at)
      values ('review:' || gen_random_uuid()::text, it.task_id, p_at,
              left(btrim(p_note), 2000), who, 'review', false, now());
    end if;
  end if;

  -- A post's decision lands on the post in the same transaction, so the
  -- calendar never says "with the client" about something they answered.
  if it.post_id is not null then
    update public.social_posts set
      client_status = coalesce(p_decision, client_status),
      client_note = case
        when coalesce(btrim(p_note), '') <> '' then left(btrim(p_note), 2000)
        when p_decision = 'approved' then null
        else client_note end,
      client_decided_at = case when p_decision is not null then now()
                               else client_decided_at end,
      client_reviewer = coalesce(lnk.reviewer_name, client_reviewer),
      updated_at = now()
     where id = it.post_id;
  end if;

  update public.review_links set last_activity_at = now() where token = p_token;
  return jsonb_build_object('ok', true, 'reviewer', lnk.reviewer_name);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Found on the way, 2026-09-23: every review function was executable
--    with the public browser key, including review_list, which returns every
--    link's token -- so anyone who read the key out of the page could open
--    and decide any client's review, or make and revoke links. A client
--    holding a link needs two functions and only two.

revoke execute on function public.review_create(text, text, text, text, text, jsonb, integer) from public, anon;
revoke execute on function public.review_list(integer) from public, anon;
revoke execute on function public.review_status(text) from public, anon;
revoke execute on function public.review_revoke(text) from public, anon;
revoke execute on function public.review_clients() from public, anon;
revoke execute on function public.review_import_folder(text, text, text, text, text, text) from public, anon;
revoke execute on function public.review_import_status(bigint) from public, anon;

grant execute on function public.review_create(text, text, text, text, text, jsonb, integer) to authenticated, service_role;
grant execute on function public.review_list(integer) to authenticated, service_role;
grant execute on function public.review_status(text) to authenticated, service_role;
grant execute on function public.review_revoke(text) to authenticated, service_role;
grant execute on function public.review_clients() to authenticated, service_role;
grant execute on function public.review_import_folder(text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.review_import_status(bigint) to authenticated, service_role;

grant execute on function public.review_open(text) to anon, authenticated, service_role;
grant execute on function public.review_decide(text, text, text, text, numeric, text) to anon, authenticated, service_role;
