-- Booking past the lead's booking page (2026-10-11).
--
-- The CEO, verbatim: "Is there anyway we can make it so we can book people
-- carther out or have an internal calendar or custom appointment the same way
-- on GHL cause I don't want the front end calendar links to have far out
-- availability . Also format confirmed"
--
-- sales-api (book.slots, book.check, book.create, book.move) now offers times
-- past each calendar's public window, up to `booking.reach_days` days from
-- today, on the same HighLevel calendars: the host's own working hours and
-- calendar decide (farout.ts), HighLevel's own extended answer has to agree,
-- and the public windows stay as they are (intros 2 days, demos 3). A custom
-- time (any time to the 5-minute mark, clash-checked) is booked the same way.
--
-- This seeds the one setting, the CEO's 60 days. sales-api reads it as a whole
-- number from 15 to 120 and treats the row being absent as 60, so this
-- migration changes nothing that runs today; it only puts the number where a
-- manager can see and change it. An existing row is left as it is.
--
-- No new table and no new column: how each call was placed (window, far_out
-- or custom, the flags sent to HighLevel, the window's last day, the reach,
-- and for a custom time whether it was outside the host's hours and when the
-- host's calendar was read) is kept on the call's book.create / book.move row
-- in cockpit_audit_log. So no grant changes either.

begin;

insert into public.cockpit_sales_settings (key, value, updated_by)
values ('booking', jsonb_build_object('reach_days', 60), 'migration 20261011f')
on conflict (key) do nothing;

commit;
