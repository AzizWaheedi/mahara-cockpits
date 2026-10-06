import { cockpitTestDb, migration } from '../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
// Only the unrelated clients FK target is a fixture. Feed definitions, constraints,
// policies, role checks, audit triggers and publication functions are canonical SQL.
export async function nativeFeedDb() {
 const db=await cockpitTestDb();
 await db.exec('CREATE TABLE public.clients(id uuid PRIMARY KEY);');
 const touch=migration('20260922a_cockpit_identity_audit_issue_reports.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_touch_updated_at\(\)[\s\S]*?\$\$;/)?.[0];
 if(!touch)throw new Error('Canonical touch trigger missing');await db.exec(touch);
 await db.exec(migration('20260923e_cockpit_daily_checks.sql'));
 await db.exec(migration('20260923f_cockpit_daily_check_shadow.sql'));
 await db.exec(migration('20260923o_cockpit_domain_tables.sql'));
 const plan=migration('20260923p_cockpit_actions_and_rpcs.sql').match(/CREATE TABLE IF NOT EXISTS public\.cockpit_plan_items \([\s\S]*?GRANT ALL ON TABLE public\.cockpit_plan_items TO service_role;/)?.[0];
 if(!plan)throw new Error('Canonical plan table missing');await db.exec(plan);
 await db.exec(migration('20260926m_cockpit_csm_state.sql'));
 const core=migration('20260919_cockpit_core.sql');
 const metric=core.match(/create table if not exists public\.cockpit_metric_days \([\s\S]*?\n\);/)?.[0];
 const metricRls=core.match(/^alter table public\.cockpit_metric_days[^;]+;/m)?.[0];
 const metricRevoke=core.match(/^revoke all on public\.cockpit_metric_days[^;]+;/m)?.[0];
 if(!metric||!metricRls||!metricRevoke)throw new Error('Canonical metric history definition missing');
 await db.exec(metric+metricRls+metricRevoke);
 const billing=core.match(/create table if not exists public\.cockpit_client_billing_days \([\s\S]*?\n\);/)?.[0];
 const billingRls=core.match(/^alter table public\.cockpit_client_billing_days[^;]+;/m)?.[0];
 const billingRevoke=core.match(/^revoke all on public\.cockpit_client_billing_days[^;]+;/m)?.[0];
 if(!billing||!billingRls||!billingRevoke)throw new Error('Canonical client billing history definition missing');
 await db.exec(billing+billingRls+billingRevoke);
 const staffing=migration('20260927h_cockpit_ceo_actions.sql');
 for(const pattern of [
  /CREATE TABLE IF NOT EXISTS public\.cockpit_team_status_state\([\s\S]*?GRANT SELECT,UPDATE ON public\.cockpit_team_status_state TO service_role;/,
  /CREATE TABLE IF NOT EXISTS public\.cockpit_team_status \([\s\S]*?GRANT SELECT,INSERT,UPDATE ON public\.cockpit_team_status TO service_role;/,
 ]){
  const definition=staffing.match(pattern)?.[0];
  if(!definition)throw new Error('Canonical staffing history definition missing');
  await db.exec(definition);
 }
 await db.exec(migration('20260927k_cockpit_snapshot_reconcile.sql'));
 await db.exec(migration('20260927j_cockpit_media_statistics.sql'));
 const actions=migration('20260927g_cockpit_media_actions.sql');
 const health=actions.match(/CREATE TABLE public\.cockpit_media_provider_health \([\s\S]*?\n\);/)?.[0];
 if(!health)throw new Error('Canonical health ledger missing');await db.exec(health);
 const dismiss=migration('20260927u_cockpit_media_workflows.sql').match(/CREATE TABLE public\.cockpit_offboard_dismissals\([^;]+;/)?.[0];
 if(!dismiss)throw new Error('Canonical dismissal table missing');await db.exec(dismiss);
 const eodAudit=migration('20260927e_cockpit_personal_eod.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_personal_eod_audit\(\)[\s\S]*?\$\$;/)?.[0];
 if(!eodAudit)throw new Error('Canonical EOD audit missing');await db.exec(eodAudit);
 await db.exec('CREATE TRIGGER cockpit_personal_eod_audit AFTER INSERT OR UPDATE ON public.cockpit_eod_reports FOR EACH ROW EXECUTE FUNCTION public.cockpit_personal_eod_audit()');
 const projections=migration('20261004a_csm_churn_projections.sql');
 const projectionAudit=projections.match(/CREATE OR REPLACE FUNCTION public\.cockpit_csm_domain_audit\(\)[\s\S]*?\$\$;/)?.[0];
 const projectionTables=projections.match(/CREATE TABLE IF NOT EXISTS public\.cockpit_csm_projections \([\s\S]*?CREATE TRIGGER csm_renewal_plan_audit[^;]+;/)?.[0];
 if(!projectionAudit||!projectionTables)throw new Error('Canonical projection history catalog missing');
 await db.exec(projectionAudit+projectionTables);
 for(const name of ['20260927s_creative_read_models.sql','20260927v_csm_read_models.sql','20260927w_media_read_models.sql','20261005f_cockpit_csm_history.sql'])await db.exec(migration(name));
 const calendarOwner=migration('20260927a_cockpit_ask_ai_jobs.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/)?.[0];
 if(!calendarOwner)throw new Error('Canonical calendar owner permission missing');await db.exec(calendarOwner);
 for(const name of ['20261004d_media_native_surface.sql','20261004e_media_native_worker_contracts.sql','20261006b_cockpit_whatsapp_history.sql','20260927x_cockpit_native_media_sync.sql'])await db.exec(migration(name));
 return db;
}
