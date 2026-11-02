-- "No reply needed" on the Messages page (2026-10-29). About half of the
-- leads waiting on a reply had last written a few words ("على خير", "لا",
-- "."), and some of those need no answer. A rep marks the conversation
-- (sales-api inbox.done, audited); it leaves Needs reply until the lead
-- writes again, which brings it straight back. Undo clears the mark.

begin;

alter table public.cockpit_sales_conversations
  add column if not exists cleared_at timestamptz,
  add column if not exists cleared_by text;

-- needs_reply now also waits for a mark older than the lead's last message.
drop index if exists public.cockpit_sales_conversations_reply;
alter table public.cockpit_sales_conversations drop column if exists needs_reply;
alter table public.cockpit_sales_conversations
  add column needs_reply boolean generated always as (
    last_in_at is not null
    and (last_reply_at is null or last_reply_at < last_in_at)
    and (cleared_at is null or cleared_at < last_in_at)) stored;
create index if not exists cockpit_sales_conversations_reply
  on public.cockpit_sales_conversations (last_in_at desc, conversation_id desc) where needs_reply;

-- The list row says who marked it, so the thread can offer Undo.
create or replace function public.cockpit_sales_conversation_row(c public.cockpit_sales_conversations)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'conversation_id', c.conversation_id,
    'contact_id', c.contact_id,
    'name', coalesce(nullif(l.name, ''), nullif(c.contact_name, ''), c.phone, c.email),
    'phone', coalesce(c.phone, l.phone),
    'email', coalesce(c.email, l.email),
    'assigned_to', c.assigned_to,
    'owner', (select p.name from public.cockpit_sales_people as p
               where p.ghl_user_id = c.assigned_to order by p.active desc, p.added_at limit 1),
    'stage', l.stage_name,
    'client', coalesce('client' = any (coalesce(l.tags, c.tags)), false),
    'channels', c.channels,
    'accounts', c.accounts,
    'last_at', c.last_at,
    'last_channel', c.last_channel,
    'last_direction', c.last_direction,
    'last_body', c.last_body,
    'last_automated', c.last_automated,
    'last_in_at', c.last_in_at,
    'last_in_channel', c.last_in_channel,
    'last_in_body', c.last_in_body,
    'last_reply_at', c.last_reply_at,
    'last_reply_by', (select p.name from public.cockpit_sales_people as p
                       where p.ghl_user_id = c.last_reply_user_id order by p.active desc, p.added_at limit 1),
    'needs_reply', c.needs_reply,
    'cleared', c.cleared_at is not null and c.last_in_at is not null and c.cleared_at >= c.last_in_at,
    'cleared_by', c.cleared_by,
    'unread', c.unread,
    'copies', c.copies,
    'wa_in_at', c.wa_in_at,
    'ig_in_at', c.ig_in_at,
    'fb_in_at', c.fb_in_at,
    'read', c.messages_synced_at is not null)
  from (select 1) as one
  left join public.cockpit_sales_leads as l on l.contact_id = c.contact_id;
$$;
revoke all on function public.cockpit_sales_conversation_row(public.cockpit_sales_conversations) from public, anon, authenticated;
grant execute on function public.cockpit_sales_conversation_row(public.cockpit_sales_conversations) to service_role;

commit;
