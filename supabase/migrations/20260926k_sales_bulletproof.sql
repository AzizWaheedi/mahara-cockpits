-- Hardening the sales cockpit (Aziz, 2026-09-26: "What else is missing to
-- make this perfect and bullet proof").
--
-- - A follow-up draft for a lead nobody owns in HighLevel (most leads today:
--   600 of 1,485 in the last 90 days had an owner) was visible to managers
--   only, and only a manager could send it, so a rep would have seen an empty
--   page. Such a draft is now every seat's to read and to send; a draft for
--   an owned lead stays with its rep and the managers.
-- - The WhatsApp ceilings sales-api reads: templates a day (Meta limits how
--   many conversations a number may start, and marks it down when too many
--   are ignored or reported), and when automatic sends pause because too
--   many failed at Meta in the last day.
-- - Assets a manager has stopped offering in Proof to send (the library is
--   B2B's and stays as it is there).

begin;

drop policy if exists cockpit_sales_followups_read on public.cockpit_sales_followups;
create policy cockpit_sales_followups_read on public.cockpit_sales_followups
  for select to authenticated
  using (
    public.cockpit_sales_seat()
    and (
      public.cockpit_sales_manager()
      or owner_email is null
      or owner_email = public.cockpit_sales_email()
    )
  );

insert into public.cockpit_sales_settings (key, value, updated_by)
values
  ('whatsapp_guard', '{"templates_per_day": 250, "pause_fail_share": 0.3, "pause_min_sends": 5}'::jsonb, 'migration'),
  ('assets', '{"hidden": {}}'::jsonb, 'migration')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
