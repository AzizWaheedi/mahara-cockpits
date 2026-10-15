-- Lead sync watch: Facebook (Meta) leads vs leads that reached the CRM (GoHighLevel), per client.
-- One row per client (its GoHighLevel sub-account, or its ad account when no sub-account is linked).
-- Meta is summed over every ad account of the client. The CRM count is every new contact in the
-- sub-account, the way the Master Dashboard's "Leads in CRM" counted them, with the Meta-tagged
-- part kept next to it.
-- Written only by hermes/lead-sync-watch with the service role. Browsers read through RLS:
-- the CEO and admins see every client; media buyers see the clients they are allowed.
-- A count that could not be read is NULL, never 0 (missing is never zero).

CREATE TABLE IF NOT EXISTS public.cockpit_lead_sync_status (
  client_key        text PRIMARY KEY,
  client_name       text NOT NULL,
  location_id       text,
  meta_account_ids  text[] NOT NULL DEFAULT '{}',
  matched_by        text NOT NULL DEFAULT '',
  state             text NOT NULL CHECK (state IN ('ok','gap','stalled','watch','quiet','unknown','unlinked')),
  reason            text NOT NULL DEFAULT '',
  meta_24h          integer,
  crm_24h           integer,
  crm_meta_24h      integer,
  meta_6h           integer,
  crm_6h            integer,
  missing_24h       integer,
  days              jsonb NOT NULL DEFAULT '[]'::jsonb,
  window_start      timestamptz,
  window_end        timestamptz,
  crm_synced_at     timestamptz,
  strikes           integer NOT NULL DEFAULT 0,
  clears            integer NOT NULL DEFAULT 0,
  episode_id        text,
  gap_since         timestamptz,
  alert_ts          text,
  checked_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cockpit_lead_sync_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean,
  clients     integer NOT NULL DEFAULT 0,
  accounts    integer NOT NULL DEFAULT 0,
  read        integer NOT NULL DEFAULT 0,
  failed      jsonb NOT NULL DEFAULT '[]'::jsonb,
  gaps        integer NOT NULL DEFAULT 0,
  note        text NOT NULL DEFAULT ''
);

-- Slack delivery ledger. One row per (episode, kind). The row is written before the send, so a
-- crash mid-send leaves 'sending' and the next run looks for the message in Slack history instead
-- of posting a second time.
CREATE TABLE IF NOT EXISTS public.cockpit_lead_sync_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id   text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('alert','resolved')),
  client_key   text NOT NULL,
  client_name  text NOT NULL,
  channel      text NOT NULL,
  status       text NOT NULL CHECK (status IN ('sending','sent','unknown','failed')),
  slack_ts     text,
  thread_ts    text,
  body         text NOT NULL,
  error        text,
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  UNIQUE (episode_id, kind)
);

CREATE INDEX IF NOT EXISTS cockpit_lead_sync_alerts_open ON public.cockpit_lead_sync_alerts (status) WHERE status IN ('sending','unknown');
CREATE INDEX IF NOT EXISTS cockpit_lead_sync_runs_started ON public.cockpit_lead_sync_runs (started_at DESC);

ALTER TABLE public.cockpit_lead_sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_lead_sync_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_lead_sync_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cockpit_lead_sync_status, public.cockpit_lead_sync_runs, public.cockpit_lead_sync_alerts FROM anon, authenticated;
GRANT SELECT ON public.cockpit_lead_sync_status, public.cockpit_lead_sync_runs TO authenticated;
GRANT ALL ON public.cockpit_lead_sync_status, public.cockpit_lead_sync_runs, public.cockpit_lead_sync_alerts TO service_role;

DROP POLICY IF EXISTS lead_sync_status_read ON public.cockpit_lead_sync_status;
CREATE POLICY lead_sync_status_read ON public.cockpit_lead_sync_status FOR SELECT TO authenticated
  USING (
    public.cockpit_is_ceo() OR public.cockpit_has_role('admin')
    OR (public.cockpit_has_role('media_buyer') AND public.cockpit_client_allowed(client_name))
  );

DROP POLICY IF EXISTS lead_sync_runs_read ON public.cockpit_lead_sync_runs;
CREATE POLICY lead_sync_runs_read ON public.cockpit_lead_sync_runs FOR SELECT TO authenticated
  USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin') OR public.cockpit_has_role('media_buyer'));

-- The alert ledger holds Slack bodies; no browser policy, service role only.
