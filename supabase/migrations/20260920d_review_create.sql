-- Making and watching a review link, from the editor cockpit.
--
-- That cockpit talks to Supabase straight from the browser with the anon
-- key and a signed-in session, so these are granted to `authenticated`
-- only. Same reasoning as the public pair: no table is exposed, and the
-- function decides what a caller may see.

create or replace function public.review_create(
  p_title text, p_note text, p_client text, p_client_task_id text,
  p_by text, p_items jsonb, p_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tok text;
  it  jsonb;
  i   integer := 0;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'a review needs a title';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'a review needs at least one video';
  end if;

  -- Long and random: the link is the only credential, so it has to be
  -- unguessable rather than merely unique.
  tok := replace(encode(gen_random_bytes(18), 'base64'), '/', '_');
  tok := replace(replace(tok, '+', '-'), '=', '');

  insert into public.review_links
    (token, client_task_id, client_name, title, note, created_by, expires_at)
  values (tok, p_client_task_id, p_client, btrim(p_title), nullif(btrim(coalesce(p_note,'')), ''),
          p_by, now() + make_interval(days => greatest(1, least(365, p_days))));

  for it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if coalesce(btrim(it->>'video_url'), '') = '' then
      raise exception 'video % has no url', i;
    end if;
    insert into public.review_items
      (id, token, n, task_id, title, video_url, poster_url, seconds)
    values (tok || ':' || i, tok, i, nullif(it->>'task_id',''),
            coalesce(nullif(btrim(it->>'title'), ''), 'Video ' || i),
            btrim(it->>'video_url'), nullif(it->>'poster_url',''),
            nullif(it->>'seconds','')::numeric);
  end loop;

  return jsonb_build_object('token', tok, 'items', i);
end;
$$;

-- What the client has done with it, for the desk that sent it.
create or replace function public.review_status(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'title', l.title, 'client', l.client_name, 'created_at', l.created_at,
    'sent_at', l.sent_at, 'opened_at', l.opened_at, 'revoked', l.revoked,
    'expires_at', l.expires_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'n', i.n, 'title', i.title, 'decision', i.decision,
               'decided_at', i.decided_at,
               'notes', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'at_seconds', nt.at_seconds, 'body', nt.body, 'at', nt.at)
                        order by nt.at)
                 from public.review_notes nt where nt.item_id = i.id), '[]'::jsonb))
             order by i.n)
      from public.review_items i where i.token = l.token), '[]'::jsonb))
  from public.review_links l where l.token = p_token;
$$;

-- Every link this desk has made, newest first.
create or replace function public.review_list(p_limit integer default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select l.token, l.title, l.client_name, l.created_at, l.sent_at,
           l.opened_at, l.revoked,
           (select count(*) from public.review_items i where i.token = l.token) as items,
           (select count(*) from public.review_items i
             where i.token = l.token and i.decision is not null) as decided,
           (select count(*) from public.review_items i
             where i.token = l.token and i.decision = 'changes') as changes
    from public.review_links l
    order by l.created_at desc
    limit greatest(1, least(100, p_limit))
  ) x;
$$;

create or replace function public.review_revoke(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  update public.review_links set revoked = true where token = p_token
  returning jsonb_build_object('revoked', true);
$$;

revoke all on function public.review_create(text,text,text,text,text,jsonb,integer) from public;
revoke all on function public.review_status(text) from public;
revoke all on function public.review_list(integer) from public;
revoke all on function public.review_revoke(text) from public;
grant execute on function public.review_create(text,text,text,text,text,jsonb,integer)
  to authenticated, service_role;
grant execute on function public.review_status(text) to authenticated, service_role;
grant execute on function public.review_list(integer) to authenticated, service_role;
grant execute on function public.review_revoke(text) to authenticated, service_role;
