-- Mahara B2B: let the cockpit's read-only login run the read-only functions
--
-- For Muhammed, on project flwboeijllbtrufxkhts (Mahara B2B). Paste into the
-- SQL editor. It grants nothing that writes.
--
-- Why it is needed. The CEO cockpit reaches B2B through the management API,
-- which connects as `supabase_read_only_user`. On 2026-09-19 that role was
-- refused on 35 of the project's 63 functions with Postgres 42501. Most of
-- those 35 are upserts, voids, secret getters and sync locks, and they SHOULD
-- stay refused: a read-only login has no business running them, and nothing
-- below touches them.
--
-- The fifteen below only read. Each one is a panel that is blank today:
--
--   b2b_rep_scorecard     the closer and setter table on the Sales tab, empty
--                         since before 2026-09-16 for this reason alone
--   b2b_resolve_rep       resolves a typed rep name to a person
--   b2b_pacing_pipeline   pacing against target
--   b2b_action_queue      what needs doing
--   b2b_eod_reports       end-of-day reports
--   b2b_team_eod          the team's end-of-day roll-up
--   b2b_asset_*  (9)      the sales asset library: which asset answers which
--                         objection, what it proves, and which ones close.
--                         The tables read fine already; only the functions
--                         over them are refused.
--
-- Deliberately NOT requested, so nobody has to check: b2b_asset_action_secret
-- and get_b2b_sync_config return secrets; b2b_asset_edit, b2b_asset_pick,
-- b2b_asset_promote_candidate, b2b_asset_reject_candidate, b2b_save_record_edit,
-- b2b_void_record, b2b_unvoid_record, b2b_apply_record_edits,
-- b2b_fill_lead_attribution, b2b_fill_closed_deal_attribution,
-- b2b_reconcile_calls, b2b_set_sync_secret, the four b2b_upsert_* and the two
-- sync-lock functions all write. They stay refused.
--
-- Written by name rather than by signature so an overload does not slip
-- through, and so re-running it after a function is redefined still works.

do $$
declare
  fn record;
  wanted text[] := array[
    'b2b_rep_scorecard',
    'b2b_resolve_rep',
    'b2b_pacing_pipeline',
    'b2b_action_queue',
    'b2b_eod_reports',
    'b2b_team_eod',
    'b2b_asset_index',
    'b2b_asset_search',
    'b2b_asset_shortlist',
    'b2b_asset_brief',
    'b2b_asset_coverage',
    'b2b_asset_health',
    'b2b_asset_performance',
    'b2b_asset_raw',
    'b2b_asset_vocab'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(wanted)
      and p.prokind = 'f'
  loop
    execute format('grant execute on function %s to supabase_read_only_user', fn.sig);
    raise notice 'granted execute on %', fn.sig;
  end loop;
end $$;

-- Check afterwards. Every row should read true; anything false was not granted.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('supabase_read_only_user', p.oid, 'EXECUTE') as can_run
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'b2b_rep_scorecard','b2b_resolve_rep','b2b_pacing_pipeline','b2b_action_queue',
    'b2b_eod_reports','b2b_team_eod','b2b_asset_index','b2b_asset_search',
    'b2b_asset_shortlist','b2b_asset_brief','b2b_asset_coverage','b2b_asset_health',
    'b2b_asset_performance','b2b_asset_raw','b2b_asset_vocab'
  )
order by 1;
