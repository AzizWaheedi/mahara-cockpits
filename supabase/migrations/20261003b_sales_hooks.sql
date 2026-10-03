-- Live calls, the hooks commit's two check constraints (consistency check
-- C26 and P3's new kinds, 2026-10-03).
--
-- 1. cockpit_sales_messages.source: adds 'room' (a room link, F and P1) and
--    'thread' (a demo chat step, P4), so per-source WhatsApp health can tell
--    them from a rep's own sends ('rep') and follow-ups ('followup').
-- 2. cockpit_sales_followups.segment: adds 'good_intro' (qualified at the
--    intro, no demo 24 h later) and 'reactivate' (a wave member whose window
--    is closed), P3 phases 1 and 2.
--
-- Both only widen the allowed set, so every row that passes today passes
-- after (on 2026-10-03: 0 messages rows; 81 follow-ups, nurture and reply).
-- The check first stops the migration with a plain sentence if any row
-- would not fit, before a constraint is dropped. Running it twice changes
-- nothing.

begin;

do $$
declare
  bad integer;
begin
  select count(*) into bad from public.cockpit_sales_messages
   where source is null or source not in ('rep', 'followup', 'thread', 'room');
  if bad > 0 then
    raise exception '% messages rows have a source outside rep, followup, thread, room. Fix them before this migration.', bad;
  end if;
  select count(*) into bad from public.cockpit_sales_followups
   where segment is null or segment not in
     ('reply', 'confirm', 'no_show', 'cancelled', 'new', 'after_call', 'nurture', 'good_intro', 'reactivate');
  if bad > 0 then
    raise exception '% follow-up rows have a segment outside the nine kinds. Fix them before this migration.', bad;
  end if;
end;
$$;

alter table public.cockpit_sales_messages
  drop constraint if exists cockpit_sales_messages_source_check;
alter table public.cockpit_sales_messages
  add constraint cockpit_sales_messages_source_check
  check (source = any (array['rep', 'followup', 'thread', 'room']::text[]));

comment on column public.cockpit_sales_messages.source is
  'Who sent it: rep (a rep''s own send), followup (the follow-up desk), room (a live-call room link), thread (a demo chat step).';

alter table public.cockpit_sales_followups
  drop constraint if exists cockpit_sales_followups_segment_check;
alter table public.cockpit_sales_followups
  add constraint cockpit_sales_followups_segment_check
  check (segment = any (array['reply', 'confirm', 'no_show', 'cancelled', 'new', 'after_call', 'nurture',
                              'good_intro', 'reactivate']::text[]));

notify pgrst, 'reload schema';

commit;
