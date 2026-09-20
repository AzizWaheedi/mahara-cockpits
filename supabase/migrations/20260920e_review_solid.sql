-- Making the review loop solid: the note reaches the editor, and the
-- client can keep talking after they have decided.

alter table public.review_links
  -- Who is actually reviewing. Asked once, on the first decision, because
  -- a link gets forwarded and "approved" with no name on it is not worth
  -- much when somebody asks later who signed it off.
  add column if not exists reviewer_name text,
  add column if not exists last_activity_at timestamptz;

alter table public.review_items
  add column if not exists task_id_note_sent boolean not null default false;

/**
 * A decision, and everything that has to happen because of it.
 *
 * The client's note is written into `editor_notes` in the same
 * transaction, so it lands in the editor's own list with its timecode
 * rather than in a place somebody has to remember to check. If that
 * write fails the decision fails with it: a note the client believes
 * they sent and the editor never sees is the worst outcome here.
 */
create or replace function public.review_decide(
  p_token text, p_item text, p_decision text, p_note text, p_at numeric,
  p_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it    public.review_items;
  lnk   public.review_links;
  who   text;
begin
  if p_decision is not null and p_decision not in ('approved', 'changes') then
    raise exception 'decision must be approved or changes';
  end if;
  if p_decision = 'changes' and coalesce(btrim(p_note), '') = '' then
    raise exception 'a change needs a note';
  end if;
  -- A note on its own is allowed: a client who has already approved may
  -- still want to say one more thing, and refusing that sends them to
  -- WhatsApp where the editor will never find it.
  if p_decision is null and coalesce(btrim(p_note), '') = '' then
    raise exception 'there is nothing to save';
  end if;

  select l.* into lnk from public.review_links l
    join public.review_items i on i.token = l.token
   where l.token = p_token and i.id = p_item and not l.revoked
     and (l.expires_at is null or l.expires_at > now());
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  select * into it from public.review_items where id = p_item;

  if coalesce(btrim(coalesce(p_name, '')), '') <> '' and lnk.reviewer_name is null then
    update public.review_links set reviewer_name = left(btrim(p_name), 80)
     where token = p_token;
    lnk.reviewer_name := left(btrim(p_name), 80);
  end if;
  who := coalesce(lnk.reviewer_name, lnk.client_name, 'The client');

  if p_decision is not null then
    update public.review_items
       set decision = p_decision, decided_at = now()
     where id = p_item;
  end if;

  if coalesce(btrim(p_note), '') <> '' then
    insert into public.review_notes (item_id, at_seconds, body)
    values (p_item, p_at, left(btrim(p_note), 2000));

    -- Into the editor's own notes, with the timecode, marked as coming
    -- from the client so the job page can link back to the frame.
    if it.task_id is not null then
      insert into public.editor_notes
        (id, task_id, at_sec, text, by_name, source, done, at)
      values (p_item || ':' || extract(epoch from now())::bigint,
              it.task_id, p_at,
              left(btrim(p_note), 2000), who, 'review', false, now());
    end if;
  end if;

  update public.review_links set last_activity_at = now() where token = p_token;
  return jsonb_build_object('ok', true, 'reviewer', lnk.reviewer_name);
end;
$$;

revoke all on function public.review_decide(text,text,text,text,numeric,text) from public;
grant execute on function public.review_decide(text,text,text,text,numeric,text)
  to anon, authenticated, service_role;
-- The old five-argument version would still be callable and would skip
-- everything above, so it goes.
drop function if exists public.review_decide(text, text, text, text, numeric);

-- `review_open` has to carry the reviewer's name so the page knows
-- whether to ask for it.
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
    'reviewer', link.reviewer_name, 'created_at', link.created_at,
    'items', items);
end;
$$;
grant execute on function public.review_open(text) to anon, authenticated, service_role;
