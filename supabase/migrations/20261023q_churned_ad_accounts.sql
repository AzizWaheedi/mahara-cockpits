-- Churned clients' ad accounts (cost per booking decisions of 23 Oct 2026, decision 5: "triple
-- edge is a old churned client"). Contract: docs/client-performance/CPB-DECISIONS-20261023.md
-- 1.5 and 3.2. Creative Triage bldgtotkfmhoxmlzowdx.
--
-- A Meta ad account of a former client that has no ClickUp card, no GoHighLevel location and
-- no board row left: without this table the cockpits call its spend "tied to no client" and
-- the CEO's Delivery tab lists it as a client of its own (Triple Edge, status "bad").
-- With a row here the account reads as a churned client's: the board's "Not in these totals"
-- (cockpit_board_read, 20261023t), the Meta ad-days notes (20261023u) and the CEO refresh
-- (native release N3) name it "churned"; its spend stays in company spend, leads and cost per
-- lead, as a cancelled client's does. Missing is never zero: nothing here drops spend.
--
-- Read only, after the first live tie: a board row listing the account, a hand tie
-- (cockpit_board_account_ties) or a GoHighLevel tie always wins over a row here, so a client
-- who comes back reads as live again (delete its row by migration).
-- Rows are added or removed only by a migration, with the evidence in the row. Digits only, no
-- act_. Row security on with no policy; the service role reads it; nobody writes it but the
-- owner. The CEO worker reads it as supabase_read_only_user (pg_read_all_data, bypasses row
-- security); the board and Meta ad-days functions read it as their owner.
--
-- Seed, read only on 2026-10-23: Triple Edge Building Construction, Meta account
-- 2002793296961811 (Aziz wrote "Contracting"; the account is named "Construction"). Its only
-- ClickUp card, 86ex3n15w "Triple Edge", is archived in Monday Import > hidden > Client
-- Onboarding ("needs contacting", made 17 Jan 2026); no GoHighLevel location, no board row, no
-- account tie, no churn-register row. Meta store: $27.84 in all, $11.13 on 11 to 18 Aug and
-- $16.71 on 14 to 21 Oct 2026, on Meta Page "Promote" campaigns.
-- One audit row when the seed is added (ids and the name only). Safe to run twice: the table is
-- created once, the seed inserts nothing twice, and an unchanged run writes no audit row.
-- Test: apps/media-buyer-cockpit/scripts/churned-ad-accounts-supabase.test.ts.
-- Rollback (only after N3 is rolled back and 20261023u and 20261023t are undone, since they read
-- it): ~/.cache/mahara-ship/rollback/cockpit_churned_ad_accounts.drop-20261023q_churned_ad_accounts.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cockpit_churned_ad_accounts (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[0-9]{5,25}$'),
  client_name text NOT NULL CHECK (btrim(client_name) <> ''),
  status text NOT NULL DEFAULT 'Churned' CHECK (status = 'Churned'),
  evidence text NOT NULL CHECK (btrim(evidence) <> ''),
  added_by text NOT NULL CHECK (btrim(added_by) <> ''),
  added_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_churned_ad_accounts IS
  'Meta ad accounts of churned clients that no ClickUp card, GoHighLevel location or board row ties any more (the CEO, 23 Oct 2026, cost per booking decisions, 5). Read only when no live tie exists: a board row, a hand tie or a GoHighLevel tie always wins. The cockpits then name the account as a churned client''s, out of the live client rows and statuses, its spend still in company spend, leads and cost per lead. Rows are added or removed only by a migration, with the evidence. Digits only, no act_. Delete the row if the client returns.';
ALTER TABLE public.cockpit_churned_ad_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_churned_ad_accounts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_churned_ad_accounts TO service_role;

DO $$
DECLARE
  v_added integer;
BEGIN
  INSERT INTO public.cockpit_churned_ad_accounts (account_id, client_name, evidence, added_by) VALUES
    ('2002793296961811', 'Triple Edge Building Construction',
     'Aziz on 23 Oct 2026: "triple edge is a old churned client". Its only ClickUp card, 86ex3n15w "Triple Edge", is archived in Monday Import > hidden > Client Onboarding ("needs contacting", made 17 Jan 2026); no GoHighLevel location and no board row. Meta lifetime spend $27.84: $11.13 on 11 to 18 Aug and $16.71 on 14 to 21 Oct 2026, on Meta Page Promote campaigns. Checked read only on 23 Oct 2026.',
     'aziz@maharamedia.com, decision 5, 23 Oct 2026')
  ON CONFLICT (account_id) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  IF v_added > 0 THEN
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after", metadata)
    VALUES ('clients.churned_account.add', 'cockpit_churned_ad_accounts', 'migration 20261023q', 'aziz@maharamedia.com', 'ceo', 'migration',
      NULL,
      jsonb_build_object('account_id', '2002793296961811', 'client_name', 'Triple Edge Building Construction', 'status', 'Churned'),
      jsonb_build_object(
        'decision', 'Cost per booking decisions of 23 Oct 2026, 5: "triple edge is a old churned client"',
        'sanctioned_by', 'CEO, 2026-10-23',
        'applied_through', 'the CEO''s Composio Supabase connection',
        'clickup_card', '86ex3n15w (archived)',
        'not_written', 'the churn register, ClickUp, Meta and public.clients are not written'));
  END IF;
END $$;

COMMIT;
