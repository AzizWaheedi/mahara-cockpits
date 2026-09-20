-- The WhatsApp inbox, as GoHighLevel actually presents it.
--
-- The bridge delivers WhatsApp as TYPE_CUSTOM_SMS, not TYPE_WHATSAPP: the
-- give-aways are in the bodies -- "🔁 Sent from another device", ">AUDIO<"
-- for a voice note, "↩️ Replied to:" for a quote. Anyone checking for a
-- WhatsApp message type finds nothing and concludes the account is empty,
-- which is what happened on the first pass here.

create table if not exists public.wa_threads (
  id              text primary key,            -- GHL conversation id
  location_id     text not null,
  contact_id      text not null,
  contact_name    text,
  phone           text,
  -- Which desk owns the reply. One inbox, three cockpits looking at it.
  desk            text not null default 'csm'
                  check (desk in ('csm', 'ads', 'creative')),
  client_task_id  text,                        -- the ClickUp card, when we can match one
  last_at         timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  -- A thread needs a reply when the client spoke last. Computed on scan
  -- rather than trusted from GHL's unread count, which counts our own
  -- sends from another device as read and lies about who is waiting.
  awaiting_us     boolean not null default false,
  archived        boolean not null default false,
  updated_at      timestamptz not null default now()
);

create table if not exists public.wa_messages (
  id          text primary key,                -- GHL message id
  thread_id   text not null references public.wa_threads(id) on delete cascade,
  direction   text not null check (direction in ('inbound', 'outbound')),
  body        text,
  -- What the bridge actually sent: text, a voice note we cannot read, or
  -- a quoted reply. A recommendation built on ">AUDIO<" would be nonsense,
  -- so the kind is kept and the drafter skips what it cannot read.
  kind        text not null default 'text'
              check (kind in ('text', 'audio', 'image', 'file', 'quote')),
  at          timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists wa_messages_thread_at on public.wa_messages (thread_id, at desc);

create table if not exists public.wa_drafts (
  thread_id   text primary key references public.wa_threads(id) on delete cascade,
  -- Both languages every time. The client's own language is not always
  -- the one the reply should be in, and a CSM switching should not wait
  -- for a second model call.
  ar          text,
  en          text,
  why         text,                            -- one line: what it is answering
  based_on    text,                            -- the message it is replying to
  model       text,
  drafted_at  timestamptz not null default now(),
  sent_at     timestamptz,
  sent_by     text,
  sent_lang   text check (sent_lang in ('ar', 'en')),
  sent_body   text
);

-- Where the scan starts. Aziz, 2026-09-20: the history belongs to a
-- previous CSM, so replies built on it would be answering somebody else's
-- conversation. The watermark starts at switch-on and only moves forward.
create table if not exists public.wa_state (
  location_id text primary key,
  scan_since  timestamptz not null,
  last_scan   timestamptz,
  note        text
);

alter table public.wa_threads  enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_drafts   enable row level security;
alter table public.wa_state    enable row level security;

-- The service key is the only door; the cockpits reach this through their
-- own gated server actions, never from a browser.
grant all on public.wa_threads, public.wa_messages, public.wa_drafts, public.wa_state
  to service_role;
