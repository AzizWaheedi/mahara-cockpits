-- A note id that cannot collide.
--
-- It was `<item>:<epoch seconds>`, so two notes on the same cut inside
-- the same second raised a duplicate key and the whole decision rolled
-- back -- the client sees an error and their note is gone. A double tap
-- on a phone is enough to cause it; a test doing three things at once
-- found it immediately.

create or replace function public.review_decide(
  p_token text, p_item text, p_decision text, p_note text, p_at numeric,
  p_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  it  public.review_items;
  lnk public.review_links;
  who text;
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

    if it.task_id is not null then
      insert into public.editor_notes
        (id, task_id, at_sec, text, by_name, source, done, at)
      values ('review:' || gen_random_uuid()::text,
              it.task_id, p_at, left(btrim(p_note), 2000), who, 'review', false, now());
    end if;
  end if;

  update public.review_links set last_activity_at = now() where token = p_token;
  return jsonb_build_object('ok', true, 'reviewer', lnk.reviewer_name);
end;
$$;
grant execute on function public.review_decide(text,text,text,text,numeric,text)
  to anon, authenticated, service_role;
