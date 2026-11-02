-- Messages, after a fresh review on 2026-10-29:
-- - A person's send that failed, bounced or was refused (status failed,
--   undelivered, bounced, opt_out) is not a reply: the lead still waits.
-- - Automations-only threads have no platform, so in that view the platform
--   and inbox filters are skipped instead of emptying the list.
-- - The numbers beside the platforms and inboxes carry Unread too, and the
--   person numbers follow the inbox filter as the list does.
-- - read_failures: the worker tries a conversation it could not read again,
--   up to five runs, instead of passing over it after one hiccup.

begin;

alter table public.cockpit_sales_conversations
  add column if not exists read_failures integer not null default 0;

create or replace function public.cockpit_sales_conversation_refresh(p_ids text[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with ids as (select distinct unnest(p_ids) as conversation_id),
  m as (
    select x.* from public.cockpit_sales_conversation_messages as x
     where x.conversation_id in (select conversation_id from ids)
  ),
  agg as (
    select i.conversation_id,
           coalesce(array_agg(distinct m.channel order by m.channel)
                      filter (where m.id is not null and not m.copy and (m.direction = 'inbound' or not m.automated)), '{}') as channels,
           coalesce(array_agg(distinct m.channel || ':' || m.account order by m.channel || ':' || m.account)
                      filter (where m.id is not null and not m.copy and m.account is not null
                                and (m.direction = 'inbound' or not m.automated)), '{}') as accounts,
           max(m.at) filter (where not m.copy and m.channel <> 'call' and m.direction = 'inbound') as last_in_at,
           max(m.at) filter (where not m.copy and m.channel <> 'call' and m.direction = 'outbound' and not m.automated
                                 and coalesce(m.status, '') not in ('failed', 'undelivered', 'bounced', 'opt_out')) as last_reply_at,
           max(m.at) filter (where not m.copy and m.direction = 'outbound' and m.automated) as last_auto_at,
           max(m.at) filter (where m.direction = 'inbound' and m.channel = 'whatsapp') as wa_in_at,
           max(m.at) filter (where m.direction = 'inbound' and m.channel = 'instagram') as ig_in_at,
           max(m.at) filter (where m.direction = 'inbound' and m.channel = 'facebook') as fb_in_at,
           count(m.id) filter (where not m.copy)::integer as messages,
           count(m.id) filter (where m.copy)::integer as copies
      from ids as i left join m on m.conversation_id = i.conversation_id
     group by i.conversation_id
  ),
  lastm as (
    select distinct on (conversation_id) conversation_id, at, channel, direction, body, subject, user_id, automated
      from m where not copy order by conversation_id, at desc, id desc
  ),
  lastin as (
    select distinct on (conversation_id) conversation_id, channel, body, subject
      from m where not copy and channel <> 'call' and direction = 'inbound' order by conversation_id, at desc, id desc
  ),
  lastreply as (
    select distinct on (conversation_id) conversation_id, user_id
      from m where not copy and channel <> 'call' and direction = 'outbound' and not automated
       and coalesce(status, '') not in ('failed', 'undelivered', 'bounced', 'opt_out')
     order by conversation_id, at desc, id desc
  ),
  upd as (
    update public.cockpit_sales_conversations as t
       set channels = a.channels,
           accounts = a.accounts,
           last_at = l.at,
           last_channel = l.channel,
           last_direction = l.direction,
           last_body = left(coalesce(nullif(l.body, ''), l.subject), 300),
           last_user_id = l.user_id,
           last_automated = l.automated,
           last_in_at = a.last_in_at,
           last_in_channel = li.channel,
           last_in_body = left(coalesce(nullif(li.body, ''), li.subject), 300),
           last_reply_at = a.last_reply_at,
           last_reply_user_id = lr.user_id,
           last_auto_at = a.last_auto_at,
           wa_in_at = a.wa_in_at,
           ig_in_at = a.ig_in_at,
           fb_in_at = a.fb_in_at,
           messages = a.messages,
           copies = a.copies
      from agg as a
      left join lastm as l on l.conversation_id = a.conversation_id
      left join lastin as li on li.conversation_id = a.conversation_id
      left join lastreply as lr on lr.conversation_id = a.conversation_id
     where t.conversation_id = a.conversation_id
    returning 1
  )
  select count(*)::integer from upd;
$$;
revoke all on function public.cockpit_sales_conversation_refresh(text[]) from public, anon, authenticated;
grant execute on function public.cockpit_sales_conversation_refresh(text[]) to service_role;

create or replace function public.cockpit_sales_conversation_matches(
  c public.cockpit_sales_conversations, p_person text, p_state text, p_channel text, p_account text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_person is null
          or (p_person = 'unassigned' and c.assigned_to is null)
          or c.assigned_to = p_person)
     -- Automations-only threads have no platform (20261029h): the filter skips them.
     and (p_channel is null or coalesce(p_state, 'reply') = 'auto' or p_channel = any (c.channels))
     and (p_account is null or coalesce(p_state, 'reply') = 'auto' or p_account = any (c.accounts))
     and case coalesce(p_state, 'reply')
           when 'reply' then c.needs_reply
                         and c.last_in_at > now() - make_interval(days => public.cockpit_sales_reply_days())
           when 'unread' then c.unread > 0 and c.has_person
           when 'all' then c.has_person
           when 'auto' then not c.has_person and c.messages > 0
           else false
         end;
$$;
revoke all on function public.cockpit_sales_conversation_matches(public.cockpit_sales_conversations, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.cockpit_sales_conversation_matches(public.cockpit_sales_conversations, text, text, text, text)
  to service_role;

create or replace function public.cockpit_sales_conversations_counts(
  p_person text default null,
  p_channel text default null,
  p_account text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since timestamptz := now() - make_interval(days => public.cockpit_sales_reply_days());
  out jsonb;
begin
  if not public.cockpit_sales_seat() then
    raise exception using errcode = '42501', message = 'Messages are for the sales team.';
  end if;
  with base as (
    select c.*,
           c.needs_reply and c.last_in_at > since as waiting
      from public.cockpit_sales_conversations as c
  ),
  scoped as (
    select * from base as b
     where (p_person is null or (p_person = 'unassigned' and b.assigned_to is null) or b.assigned_to = p_person)
  ),
  scoped_ch as (
    select * from scoped as s
     where (p_channel is null or p_channel = any (s.channels))
       and (p_account is null or p_account = any (s.accounts))
  )
  select jsonb_build_object(
    'states', jsonb_build_object(
      'reply', (select count(*) from scoped_ch where waiting),
      'unread', (select count(*) from scoped_ch where unread > 0 and has_person),
      'all', (select count(*) from scoped_ch where has_person),
      'auto', (select count(*) from scoped where not has_person and messages > 0)),
    'channels', (select coalesce(jsonb_object_agg(ch, jsonb_build_object('reply', reply, 'all', total, 'unread', unread)), '{}'::jsonb)
                   from (select ch, count(*) filter (where s.waiting) as reply, count(*) filter (where s.has_person) as total,
                                count(*) filter (where s.unread > 0 and s.has_person) as unread
                           from scoped as s, unnest(s.channels) as ch group by ch) as x),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('key', acct, 'reply', reply, 'all', total, 'unread', unread) order by acct), '[]'::jsonb)
                   from (select acct, count(*) filter (where s.waiting) as reply, count(*) filter (where s.has_person) as total,
                                count(*) filter (where s.unread > 0 and s.has_person) as unread
                           from scoped as s, unnest(s.accounts) as acct group by acct) as x),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
                         'ghl_user_id', p.ghl_user_id, 'name', p.name, 'role', p.role,
                         'reply', (select count(*) from base as b where b.assigned_to = p.ghl_user_id and b.waiting
                                     and (p_channel is null or p_channel = any (b.channels))
                                     and (p_account is null or p_account = any (b.accounts))),
                         'all', (select count(*) from base as b where b.assigned_to = p.ghl_user_id and b.has_person))
                       order by p.name), '[]'::jsonb)
                 from (select distinct on (x.ghl_user_id) x.ghl_user_id, x.name, x.role
                         from public.cockpit_sales_people as x
                        where x.active and x.ghl_user_id is not null
                        order by x.ghl_user_id, x.added_at) as p),
    'unassigned', jsonb_build_object(
      'reply', (select count(*) from base as b where b.assigned_to is null and b.waiting
                  and (p_channel is null or p_channel = any (b.channels))
                  and (p_account is null or p_account = any (b.accounts))),
      'all', (select count(*) from base as b where b.assigned_to is null and b.has_person)),
    'everyone', jsonb_build_object(
      'reply', (select count(*) from base as b where b.waiting and (p_channel is null or p_channel = any (b.channels))
                  and (p_account is null or p_account = any (b.accounts))),
      'all', (select count(*) from base as b where b.has_person)),
    'sync', (select jsonb_build_object(
                'last_ok_at', s.last_ok_at, 'last_run_at', s.last_run_at, 'last_error', s.last_error,
                'full_done_at', s.full_done_at,
                'conversations', (select count(*) from public.cockpit_sales_conversations),
                'unread_backlog', (select count(*) from public.cockpit_sales_conversations where messages_synced_at is null))
               from public.cockpit_sales_conversation_sync as s where s.name = 'conversations'),
    'sms_pause', jsonb_build_object(
      'workflows', (select count(*) from public.cockpit_sales_workflow_sms_pause where paused_at is not null and restored_at is null),
      'steps', (select coalesce(sum(jsonb_array_length(w.removed)), 0) from public.cockpit_sales_workflow_sms_pause as w
                 where w.paused_at is not null and w.restored_at is null),
      'since', (select min(w.paused_at) from public.cockpit_sales_workflow_sms_pause as w where w.restored_at is null),
      'copies_since', (select count(*) from public.cockpit_sales_conversation_messages as m
                        where m.copy and m.at > (select min(w.paused_at) from public.cockpit_sales_workflow_sms_pause as w
                                                  where w.restored_at is null))),
    'reply_days', public.cockpit_sales_reply_days())
  into out;
  return out;
end;
$$;
revoke all on function public.cockpit_sales_conversations_counts(text, text, text) from public, anon, authenticated;
grant execute on function public.cockpit_sales_conversations_counts(text, text, text) to authenticated, service_role;

select public.cockpit_sales_conversation_refresh(array_agg(conversation_id))
  from public.cockpit_sales_conversations where messages_synced_at is not null;

commit;
