-- What each stage of the two sales pipelines means to the dialer, pinned by
-- stage id (read from HighLevel on 2026-09-26). Names are only a fallback:
-- they carry emoji and stray spaces, and "Demo Cancelled" read by name alone
-- looked like a booking.
--
-- 2-Call (96oywOezX39jQzXP3Mg0) is the pipeline of record; the mirror and B2B
-- read it. 1-Call (eU5KW4TRt3haofQSnWC1) holds a card for many of the same
-- leads; its "Call" is the one call, so it maps onto the intro roles.
-- auto_moves: the dialer moves leads after outcomes (Aziz, 2026-09-26).

begin;

insert into public.cockpit_sales_settings (key, value, updated_by)
values ('pipeline', jsonb_build_object(
  'auto_moves', true,
  'record_pipeline', '96oywOezX39jQzXP3Mg0',
  'roles', jsonb_build_object(
    -- Sales Pipeline (2-Call)
    'e9c4926a-f80f-41fb-8748-174a31948a83', 'new',
    '2d510b28-592b-4d9e-9b65-d153ed200347', 'hot',
    '712ff5d2-e7cc-471c-a169-7ebb9059673b', 'nurture_short',
    'c9fdb20e-0342-4b91-8aac-7d092a1075b7', 'intro_booked',
    '7f7720ff-5f55-4d0a-b93f-c5104d0c9312', 'intro_confirmed',
    'adc92378-1e0a-4841-90ea-e052b0bc68be', 'intro_cancelled',
    'cc65a0f4-6b2a-4c7c-b657-bf6cfe971dbb', 'intro_noshow',
    'f5eb7551-6a18-4f39-aaa1-67369f8f5d36', 'no_progress',
    'd8e522d1-40c2-48ff-b8a4-ffb4d80adcef', 'demo_booked',
    'fadc2f9c-bb2b-4836-ac48-b29c143124fb', 'demo_cancelled',
    'ec9bccc2-8a23-4ea7-b92c-3225604cfd7a', 'demo_noshow',
    '065e3cba-17d3-4105-97ee-44e3bafeb72b', 'no_progress',
    'd1266bbc-6406-4eec-b990-9b9dd74d3390', 'deposit',
    '1d47f28d-7b3e-4e6c-a1e6-b64247790d88', 'won',
    'a565b3a6-f195-4640-929c-8e0e8f810f52', 'nurture_long',
    '755c5a72-1f36-4d95-904d-ed26377b3ccd', 'paused',
    '4932da76-4e4a-45aa-9c41-3a7030c086ba', 'won',
    'b18d6490-e079-47a3-bc4a-ca960a24c6d4', 'disqualified',
    -- Sales Pipeline (1-Call)
    '05e74522-9f08-4ba6-b903-fc3edfbed3a4', 'new',
    'de528ffb-0877-42aa-b6ca-8b8a2ef3efdf', 'hot',
    '399e641a-13c8-42d1-93ca-b088f3f218b0', 'nurture_short',
    '10396f96-68de-40f9-a84d-44d57dad9c99', 'no_progress',
    'db9514e8-eaac-4ad4-94fa-d1a68322d784', 'intro_booked',
    '7233ad66-990d-4525-8223-740651658c19', 'intro_confirmed',
    '96017468-c261-4872-97a3-e1f42a2dc344', 'intro_cancelled',
    '44605a7d-ef78-4ba3-ac26-d047ede5305e', 'intro_noshow',
    '08bc0dd8-7c9a-4021-b201-eb48e352ff3e', 'no_progress',
    'f4703a9e-ca35-409d-bda9-a5e5349cb3ca', 'deposit',
    '500184df-9560-45a4-a24e-28827acfa9d9', 'won',
    'cbaa66c0-5176-4d94-b927-0443f519e4bf', 'nurture_long',
    'fb534593-b42a-41af-b7ed-b30807156995', 'paused',
    '44c28fc3-7be4-4fde-8b92-47dab8fc099e', 'won',
    '7ca17b2e-b032-4c8c-b47e-66d9a8b53294', 'disqualified'
  )
), 'migration')
on conflict (key) do update
  set value = public.cockpit_sales_settings.value || excluded.value,
      updated_by = 'migration',
      updated_at = now();

commit;
