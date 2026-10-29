-- A conversation is on a platform when the lead wrote there or a person
-- answered there. Automations alone do not put it there: workflow nurture
-- emails sit in almost every thread, so with them the Email filter held
-- 1,283 of 1,731 conversations (checked 2026-10-29). Same for the inboxes.
-- Everything else in the summary is as 20261029d worked it out.

begin;

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
           max(m.at) filter (where not m.copy and m.channel <> 'call' and m.direction = 'outbound' and not m.automated) as last_reply_at,
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

-- Every conversation already copied, worked out again under the new rule.
select public.cockpit_sales_conversation_refresh(array_agg(conversation_id))
  from public.cockpit_sales_conversations where messages_synced_at is not null;

commit;
