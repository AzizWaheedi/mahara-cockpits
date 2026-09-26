-- These unfiltered owner-privileged views are internal read models.
-- Client panels retain the token-checked panel_data RPC; its owner can still read.
-- pulse_* invoker functions retain service-role access. No data or function bodies change.
revoke all on public.recent_sync_calls, public.recent_cron_runs,
  public.v_panel_spend, public.v_panel_appointments,
  public.v_panel_leads, public.media_buyer_changes
  from public, anon, authenticated;
grant select on public.recent_sync_calls, public.recent_cron_runs,
  public.v_panel_spend, public.v_panel_appointments,
  public.v_panel_leads, public.media_buyer_changes to service_role;
