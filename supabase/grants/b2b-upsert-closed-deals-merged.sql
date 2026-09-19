-- b2b_upsert_closed_deals: the tombstones AND the fill-not-clobber, together
--
-- For Mahara B2B (flwboeijllbtrufxkhts).
--
-- How the two halves got separated. On 2026-06-29 the April backfill migration
-- made the three money columns fill-not-clobber, so a hand-entered contracted
-- value survived the next Typeform sync instead of being overwritten with the
-- form's null. On 2026-08-29 the manual-corrections migration redefined the
-- same function to add two genuinely important things — it skips responses with
-- a tombstone in record_voids, and it calls b2b_apply_record_edits at the end
-- so a human's correction is re-stamped after every sync — and in doing so it
-- went back to plain `excluded.*` on the money columns.
--
-- The result was quiet and expensive: April's fifteen backfilled contracted
-- values were wiped by the next sync, and the month Mahara signed the most
-- clients all year read as $0 contracted from then on. A migration whose whole
-- purpose was to stop syncs reverting human fixes reintroduced the one line
-- that reverts human fixes.
--
-- On 2026-09-19 Claude applied the June version to restore April, which fixed
-- the money columns and, in doing so, dropped the tombstones and the
-- corrections call. This version is the merge, and it is what should be in the
-- repository: the August behaviour with the June guard.
--
--   * voided responses stay gone, however often Typeform hands them back
--   * in-force record_edits are stamped back on after every sync
--   * contracted_revenue, cash_collected and new_mrr fill rather than clobber,
--     so a value already on the row survives a sync that carries null, while a
--     real form value still wins
--
-- Everything else is identical to the 2026-08-29 definition.

create or replace function public.b2b_upsert_closed_deals(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.closed_deals as d (
    response_id, form_id, account_id, submitted_at, landed_at,
    closer, client_first_name, client_last_name, email, phone, phone_raw,
    phone_normalized, business_name, business_address, city, state, country,
    zip, website, timezone, lead_source, payment_structure, agreement_type,
    daily_ad_spend, cash_collected, contracted_revenue, new_mrr,
    fathom_link, csm, handoff_risks, go_live_notes, raw_payload
  )
  select
    r.response_id, r.form_id, r.account_id, r.submitted_at, r.landed_at,
    r.closer, r.client_first_name, r.client_last_name, r.email, r.phone, r.phone_raw,
    r.phone_normalized, r.business_name, r.business_address, r.city, r.state, r.country,
    r.zip, r.website, r.timezone, r.lead_source, r.payment_structure, r.agreement_type,
    r.daily_ad_spend, r.cash_collected, r.contracted_revenue, r.new_mrr,
    r.fathom_link, r.csm, r.handoff_risks, r.go_live_notes, r.raw_payload
  from jsonb_to_recordset(p_rows) as r(
    response_id text, form_id text, account_id uuid, submitted_at timestamptz,
    landed_at timestamptz, closer text, client_first_name text, client_last_name text,
    email text, phone text, phone_raw text, phone_normalized text, business_name text,
    business_address text, city text, state text, country text, zip text, website text,
    timezone text, lead_source text, payment_structure text, agreement_type text,
    daily_ad_spend numeric, cash_collected numeric, contracted_revenue numeric,
    new_mrr numeric, fathom_link text, csm text, handoff_risks text, go_live_notes text,
    raw_payload jsonb
  )
  -- A voided response stays gone, however many times Typeform hands it back.
  where not exists (
    select 1 from public.record_voids v
    where v.entity = 'closed_deal' and v.record_id = r.response_id
  )
  on conflict (response_id) do update set
    form_id            = excluded.form_id,
    account_id         = excluded.account_id,
    submitted_at       = excluded.submitted_at,
    landed_at          = excluded.landed_at,
    closer             = excluded.closer,
    client_first_name  = excluded.client_first_name,
    client_last_name   = excluded.client_last_name,
    email              = excluded.email,
    phone              = excluded.phone,
    phone_raw          = excluded.phone_raw,
    phone_normalized   = excluded.phone_normalized,
    business_name      = excluded.business_name,
    business_address   = excluded.business_address,
    city               = excluded.city,
    state              = excluded.state,
    country            = excluded.country,
    zip                = excluded.zip,
    website            = excluded.website,
    timezone           = excluded.timezone,
    lead_source        = excluded.lead_source,
    payment_structure  = excluded.payment_structure,
    agreement_type     = excluded.agreement_type,
    daily_ad_spend     = excluded.daily_ad_spend,
    -- Fill, never clobber: the form only gained its contracted-value question
    -- in May 2026, so a sync of an April response still carries null here.
    cash_collected     = coalesce(excluded.cash_collected, d.cash_collected),
    contracted_revenue = coalesce(excluded.contracted_revenue, d.contracted_revenue),
    new_mrr            = coalesce(excluded.new_mrr, d.new_mrr),
    fathom_link        = excluded.fathom_link,
    csm                = excluded.csm,
    handoff_risks      = excluded.handoff_risks,
    go_live_notes      = excluded.go_live_notes,
    raw_payload        = excluded.raw_payload,
    synced_at          = now();
  get diagnostics n = row_count;

  -- The form is the source of truth right up until a human corrected it.
  perform public.b2b_apply_record_edits('closed_deal');
  return n;
end;
$$;

revoke all on function public.b2b_upsert_closed_deals(jsonb) from public, anon, authenticated;
grant execute on function public.b2b_upsert_closed_deals(jsonb) to service_role;
