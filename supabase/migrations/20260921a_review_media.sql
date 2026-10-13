-- Images as well as videos, and a queue for pulling a whole Drive folder.

alter table public.review_items
  -- A review is a delivery, and a delivery is rarely all one thing: a
  -- film, three stills and a carousel go to the client together.
  add column if not exists kind text not null default 'video'
    check (kind in ('video', 'image'));

create table if not exists public.review_imports (
  id            bigserial primary key,
  -- The folder, as pasted. Expanding it needs Drive's OAuth token, which
  -- lives on the VPS, so the cockpit queues the job and a worker does it.
  folder_url    text not null,
  title         text not null,
  note          text,
  client_name   text,
  client_task_id text,
  requested_by  text,
  status        text not null default 'queued'
                check (status in ('queued', 'working', 'done', 'failed')),
  token         text,               -- the review it produced
  found         integer,
  copied        integer,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.review_imports enable row level security;
grant all on public.review_imports to service_role;
grant usage, select on sequence public.review_imports_id_seq to service_role;

-- Queue a folder. Returns the row to watch.
create or replace function public.review_import_folder(
  p_folder text, p_title text, p_note text, p_client text,
  p_client_task_id text, p_by text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if coalesce(btrim(p_folder), '') = '' then
    raise exception 'paste the folder link';
  end if;
  insert into public.review_imports
    (folder_url, title, note, client_name, client_task_id, requested_by)
  values (btrim(p_folder), coalesce(nullif(btrim(p_title), ''), 'Videos for review'),
          nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_client, '')), ''),
          nullif(btrim(coalesce(p_client_task_id, '')), ''), p_by)
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;

create or replace function public.review_import_status(p_id bigint)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'status', status, 'token', token,
                            'found', found, 'copied', copied, 'error', error)
  from public.review_imports where id = p_id;
$$;

-- The clients a review can be for: the ClickUp cards, not free text.
create or replace function public.review_clients()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('task_id', task_id, 'name', name)
                            order by name), '[]'::jsonb)
  from public.editor_clients
  where coalesce(btrim(name), '') <> ''
    and coalesce(lower(status), '') not in ('cancelled', 'canceled', 'stopped');
$$;

revoke all on function public.review_import_folder(text,text,text,text,text,text) from public;
revoke all on function public.review_import_status(bigint) from public;
revoke all on function public.review_clients() from public;
grant execute on function public.review_import_folder(text,text,text,text,text,text)
  to authenticated, service_role;
grant execute on function public.review_import_status(bigint) to authenticated, service_role;
grant execute on function public.review_clients() to authenticated, service_role;

-- review_create gains a kind per item.
create or replace function public.review_create(
  p_title text, p_note text, p_client text, p_client_task_id text,
  p_by text, p_items jsonb, p_days integer default 30
) returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
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
      (id, token, n, task_id, title, video_url, poster_url, seconds, kind)
    values (tok || ':' || i, tok, i, nullif(it->>'task_id',''),
            coalesce(nullif(btrim(it->>'title'), ''), 'Item ' || i),
            btrim(it->>'video_url'), nullif(it->>'poster_url',''),
            nullif(it->>'seconds','')::numeric,
            case when lower(coalesce(it->>'kind','video')) = 'image'
                 then 'image' else 'video' end);
  end loop;

  return jsonb_build_object('token', tok, 'items', i);
end;
$$;
grant execute on function public.review_create(text,text,text,text,text,jsonb,integer)
  to authenticated, service_role;

-- And review_open has to say which each one is.
create or replace function public.review_open(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
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
           ), '[]'::jsonb) as notes
    from public.review_items i where i.token = p_token
  ) x;

  return jsonb_build_object(
    'title', link.title, 'note', link.note, 'client', link.client_name,
    'reviewer', link.reviewer_name, 'created_at', link.created_at,
    'items', items);
end;
$$;
grant execute on function public.review_open(text) to anon, authenticated, service_role;
