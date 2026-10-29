-- Messages: every HighLevel conversation on the sales sub-account, in the
-- cockpit (Aziz, 2026-10-29: "the same way in the CRM there's a messages
-- section and they can filter the messages per platform ... filtering by
-- which inbox and which lead each is assigned to, like a messages section
-- for every single person").
--
-- The sales-conversations worker (Edge Function, pg_cron every minute)
-- copies each conversation HighLevel changed and its newest messages here,
-- reads the rest of the 4,810 conversations back in the background, and
-- keeps assignment and unread counts fresh with a full pass every twenty
-- minutes. The cockpit reads only these tables, so filtering by person,
-- channel and inbox is instant; sending still goes through sales-api.
--
-- cockpit_sales_inbox (20260924h, the 100 newest conversations from
-- sales-mirror) stays as it is: the follow-ups, rooms and hot sheet read it.
--
-- What counts:
-- - A message is one on WhatsApp, email, Instagram, Facebook, SMS, a call,
--   web chat or Google; HighLevel's activity lines (stage moves, bookings)
--   are not kept.
-- - An SMS copy is a message the WA2 Connector sent as the SMS twin of a
--   WhatsApp step. It is kept (marked copy) and left out of every summary.
-- - Automated: sent by a workflow, campaign or bulk action. A rep's send,
--   from HighLevel or the cockpit (the follow-up agent's approved drafts
--   too), is a person's reply.
-- - Needs a reply: the lead's last message (calls aside) came after the
--   last reply a person sent. The Needs reply list holds those from the last
--   14 days (cockpit_sales_reply_days()); older ones stay under All.

begin;

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.cockpit_sales_conversations (
  conversation_id text primary key,
  contact_id text not null,
  contact_name text,
  email text,
  phone text,
  assigned_to text,
  tags text[] not null default '{}',
  unread integer not null default 0,
  starred boolean not null default false,
  -- HighLevel's own fields, as its conversation search last gave them.
  ghl_last_at timestamptz,
  ghl_updated_at timestamptz,
  ghl_last_type text,
  -- The summary, worked out from the messages below by
  -- cockpit_sales_conversation_refresh (SMS copies left out).
  channels text[] not null default '{}',
  accounts text[] not null default '{}',
  last_at timestamptz,
  last_channel text,
  last_direction text,
  last_body text,
  last_user_id text,
  last_automated boolean,
  last_in_at timestamptz,
  last_in_channel text,
  last_in_body text,
  last_reply_at timestamptz,
  last_reply_user_id text,
  last_auto_at timestamptz,
  wa_in_at timestamptz,
  ig_in_at timestamptz,
  fb_in_at timestamptz,
  messages integer not null default 0,
  copies integer not null default 0,
  has_person boolean generated always as (last_in_at is not null or last_reply_at is not null) stored,
  needs_reply boolean generated always as (
    last_in_at is not null and (last_reply_at is null or last_reply_at < last_in_at)) stored,
  -- Null until the worker has read the conversation's messages.
  messages_synced_at timestamptz,
  mirrored_at timestamptz not null default now()
);

create index if not exists cockpit_sales_conversations_reply
  on public.cockpit_sales_conversations (last_in_at desc, conversation_id desc) where needs_reply;
create index if not exists cockpit_sales_conversations_last
  on public.cockpit_sales_conversations (last_at desc nulls last, conversation_id desc);
create index if not exists cockpit_sales_conversations_assigned
  on public.cockpit_sales_conversations (assigned_to);
create index if not exists cockpit_sales_conversations_contact
  on public.cockpit_sales_conversations (contact_id);
create index if not exists cockpit_sales_conversations_channels
  on public.cockpit_sales_conversations using gin (channels);
create index if not exists cockpit_sales_conversations_unread_queue
  on public.cockpit_sales_conversations (ghl_last_at desc) where messages_synced_at is null;

create table if not exists public.cockpit_sales_conversation_messages (
  id text primary key,
  conversation_id text not null,
  contact_id text not null,
  at timestamptz not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  channel text not null check (channel in ('whatsapp', 'email', 'instagram', 'facebook', 'sms', 'call', 'webchat', 'google')),
  type text,
  -- The inbox it went through: the WhatsApp number, the email address on
  -- our side, or the Instagram or Facebook page.
  account text check (account is null or length(account) <= 200),
  body text check (body is null or length(body) <= 8000),
  subject text check (subject is null or length(subject) <= 300),
  status text,
  error text check (error is null or length(error) <= 500),
  source text,
  user_id text,
  automated boolean not null default false,
  copy boolean not null default false,
  attachments text[] not null default '{}',
  mirrored_at timestamptz not null default now()
);

create index if not exists cockpit_sales_conversation_messages_thread
  on public.cockpit_sales_conversation_messages (conversation_id, at desc);
create index if not exists cockpit_sales_conversation_messages_contact
  on public.cockpit_sales_conversation_messages (contact_id, at desc);
create index if not exists cockpit_sales_conversation_messages_body
  on public.cockpit_sales_conversation_messages using gin (body extensions.gin_trgm_ops);

-- The worker's place in HighLevel's list, and how its last run went.
create table if not exists public.cockpit_sales_conversation_sync (
  name text primary key,
  cursor_at timestamptz,
  full_after text,
  full_started_at timestamptz,
  full_done_at timestamptz,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 1000),
  counts jsonb not null default '{}'::jsonb
);
insert into public.cockpit_sales_conversation_sync (name) values ('conversations') on conflict (name) do nothing;

do $$
declare t text;
begin
  foreach t in array array['cockpit_sales_conversations', 'cockpit_sales_conversation_messages', 'cockpit_sales_conversation_sync'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_seat_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.cockpit_sales_seat()))', t || '_seat_read', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- How far back Needs reply looks, in days.
create or replace function public.cockpit_sales_reply_days()
returns integer language sql immutable set search_path = '' as $$ select 14 $$;
grant execute on function public.cockpit_sales_reply_days() to authenticated, service_role;

-- Work out each conversation's summary from its messages. The worker calls
-- it after every copy; it is the one place "needs a reply" is decided.
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
           coalesce(array_agg(distinct m.channel order by m.channel) filter (where m.id is not null and not m.copy), '{}') as channels,
           coalesce(array_agg(distinct m.channel || ':' || m.account order by m.channel || ':' || m.account)
                      filter (where m.id is not null and not m.copy and m.account is not null), '{}') as accounts,
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

-- One conversation as the list shows it.
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

-- Does a conversation match the filters? Shared by the list and the counts.
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
     and (p_channel is null or p_channel = any (c.channels))
     and (p_account is null or p_account = any (c.accounts))
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

-- The list. p_person: null for everyone, 'unassigned', or a HighLevel user
-- id. p_state: reply, unread, all or auto. Newest first (Needs reply by the
-- lead's last message); p_before_* is the last row of the page before.
create or replace function public.cockpit_sales_conversations_list(
  p_person text default null,
  p_state text default 'reply',
  p_channel text default null,
  p_account text default null,
  p_q text default null,
  p_before_at timestamptz default null,
  p_before_id text default null,
  p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := nullif(btrim(coalesce(p_q, '')), '');
  digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  by_in boolean := coalesce(p_state, 'reply') = 'reply';
  out_rows jsonb;
begin
  if not public.cockpit_sales_seat() then
    raise exception using errcode = '42501', message = 'Messages are for the sales team.';
  end if;
  with hits as (
    select c.*, case when by_in then c.last_in_at else c.last_at end as sort_at
      from public.cockpit_sales_conversations as c
     where public.cockpit_sales_conversation_matches(c, p_person, p_state, p_channel, p_account)
       and (q is null
            or c.contact_name ilike '%' || q || '%'
            or c.email ilike '%' || q || '%'
            or (length(digits) >= 4 and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || digits || '%')
            or exists (select 1 from public.cockpit_sales_leads as l
                        where l.contact_id = c.contact_id and l.name ilike '%' || q || '%')
            or (length(q) >= 3 and exists (
                  select 1 from public.cockpit_sales_conversation_messages as m
                   where m.conversation_id = c.conversation_id and not m.copy and m.body ilike '%' || q || '%')))
  ),
  page as (
    select h.conversation_id, h.sort_at from hits as h
     where h.sort_at is not null
       and (p_before_at is null or (h.sort_at, h.conversation_id) < (p_before_at, coalesce(p_before_id, '')))
     order by h.sort_at desc, h.conversation_id desc
     limit lim + 1
  )
  select coalesce(jsonb_agg(public.cockpit_sales_conversation_row(c) || jsonb_build_object('sort_at', p.sort_at)
           order by p.sort_at desc, p.conversation_id desc), '[]'::jsonb)
    into out_rows
    from page as p
    join public.cockpit_sales_conversations as c on c.conversation_id = p.conversation_id;
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
               select e from jsonb_array_elements(out_rows) with ordinality as x(e, n) where n <= lim order by n) as s),
    'more', jsonb_array_length(out_rows) > lim);
end;
$$;
revoke all on function public.cockpit_sales_conversations_list(text, text, text, text, text, timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.cockpit_sales_conversations_list(text, text, text, text, text, timestamptz, text, integer)
  to authenticated, service_role;

-- The numbers beside each filter, the people and inboxes to pick from, and
-- how fresh the copy is. p_person and p_channel are the filters in use: the
-- state counts follow both, the channel counts follow the person, and the
-- person counts follow the channel.
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
      'auto', (select count(*) from scoped_ch where not has_person and messages > 0)),
    'channels', (select coalesce(jsonb_object_agg(ch, jsonb_build_object('reply', reply, 'all', total)), '{}'::jsonb)
                   from (select ch, count(*) filter (where s.waiting) as reply, count(*) filter (where s.has_person) as total
                           from scoped as s, unnest(s.channels) as ch group by ch) as x),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('key', acct, 'reply', reply, 'all', total) order by acct), '[]'::jsonb)
                   from (select acct, count(*) filter (where s.waiting) as reply, count(*) filter (where s.has_person) as total
                           from scoped as s, unnest(s.accounts) as acct group by acct) as x),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
                         'ghl_user_id', p.ghl_user_id, 'name', p.name, 'role', p.role,
                         'reply', (select count(*) from base as b where b.assigned_to = p.ghl_user_id and b.waiting
                                     and (p_channel is null or p_channel = any (b.channels))),
                         'all', (select count(*) from base as b where b.assigned_to = p.ghl_user_id and b.has_person))
                       order by p.name), '[]'::jsonb)
                 from (select distinct on (x.ghl_user_id) x.ghl_user_id, x.name, x.role
                         from public.cockpit_sales_people as x
                        where x.active and x.ghl_user_id is not null
                        order by x.ghl_user_id, x.added_at) as p),
    'unassigned', jsonb_build_object(
      'reply', (select count(*) from base as b where b.assigned_to is null and b.waiting
                  and (p_channel is null or p_channel = any (b.channels))),
      'all', (select count(*) from base as b where b.assigned_to is null and b.has_person)),
    'everyone', jsonb_build_object(
      'reply', (select count(*) from base as b where b.waiting and (p_channel is null or p_channel = any (b.channels))),
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

commit;
