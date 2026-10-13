-- Client review links for finished videos.
--
-- The page is public: whoever holds the link can watch and decide. So no
-- table is readable by `anon` at all. Everything goes through two
-- security-definer functions that take the token, which means a guessed
-- or expired token returns nothing rather than a row somebody else owns,
-- and there is no table for a curious client to enumerate.

create table if not exists public.review_links (
  token          text primary key,
  client_task_id text,
  client_name    text,
  title          text not null,
  -- One line from whoever sent it. This is a delivery, and a delivery
  -- with no human sentence on it reads like an automated email.
  note           text,
  created_by     text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,
  opened_at      timestamptz,
  sent_at        timestamptz,
  sent_to        text,
  revoked        boolean not null default false
);

create table if not exists public.review_items (
  id         text primary key,
  token      text not null references public.review_links(token) on delete cascade,
  n          integer not null,
  task_id    text,
  title      text not null,
  video_url  text not null,
  poster_url text,
  seconds    numeric,
  decision   text check (decision in ('approved', 'changes')),
  decided_at timestamptz
);
create index if not exists review_items_token on public.review_items (token, n);

create table if not exists public.review_notes (
  id         bigserial primary key,
  item_id    text not null references public.review_items(id) on delete cascade,
  -- Where in the video they meant. A change request tied to a second is
  -- worth more than a paragraph describing which shot they mean.
  at_seconds numeric,
  body       text not null,
  at         timestamptz not null default now()
);
create index if not exists review_notes_item on public.review_notes (item_id, at);

alter table public.review_links enable row level security;
alter table public.review_items enable row level security;
alter table public.review_notes enable row level security;
grant all on public.review_links, public.review_items, public.review_notes to service_role;
grant usage, select on sequence public.review_notes_id_seq to service_role;

-- Everything the page needs, in one call, or nothing.
create or replace function public.review_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link  public.review_links;
  items jsonb;
begin
  select * into link from public.review_links
   where token = p_token and not revoked
     and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  -- First open is worth knowing: it is the difference between "they have
  -- not looked" and "they looked and said nothing".
  if link.opened_at is null then
    update public.review_links set opened_at = now() where token = p_token;
    link.opened_at := now();
  end if;

  select coalesce(jsonb_agg(x order by x.n), '[]'::jsonb) into items
  from (
    select i.n, i.id, i.title, i.video_url, i.poster_url, i.seconds,
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
    'created_at', link.created_at, 'items', items
  );
end;
$$;

-- One decision on one video. The token is checked again here: holding an
-- item id is not permission to decide on it.
create or replace function public.review_decide(
  p_token text, p_item text, p_decision text, p_note text, p_at numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean;
begin
  if p_decision not in ('approved', 'changes') then
    raise exception 'decision must be approved or changes';
  end if;
  -- Asking for a change without saying what would leave the editor with
  -- nothing to do, so it is refused here rather than accepted and lost.
  if p_decision = 'changes' and coalesce(btrim(p_note), '') = '' then
    raise exception 'a change needs a note';
  end if;

  select true into ok from public.review_links l
    join public.review_items i on i.token = l.token
   where l.token = p_token and i.id = p_item and not l.revoked
     and (l.expires_at is null or l.expires_at > now());
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update public.review_items
     set decision = p_decision, decided_at = now()
   where id = p_item;

  if coalesce(btrim(p_note), '') <> '' then
    insert into public.review_notes (item_id, at_seconds, body)
    values (p_item, p_at, left(btrim(p_note), 2000));
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.review_open(text) from public;
revoke all on function public.review_decide(text, text, text, text, numeric) from public;
grant execute on function public.review_open(text) to anon, authenticated, service_role;
grant execute on function public.review_decide(text, text, text, text, numeric)
  to anon, authenticated, service_role;
