-- Offline candidate only. There is deliberately no runtime grant, writer,
-- provider adapter, Data API exposure, budget amount, or write authorizer.
-- Do not apply until the model and its eventual authentication are reviewed.
CREATE SCHEMA cockpit_budget_inventory_private;
REVOKE ALL ON SCHEMA cockpit_budget_inventory_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE cockpit_budget_inventory_private.gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO cockpit_budget_inventory_private.gate(singleton) VALUES (true);

CREATE TABLE cockpit_budget_inventory_private.scopes (
  client_key text PRIMARY KEY CHECK (length(btrim(client_key)) BETWEEN 1 AND 200),
  all_relevant_platforms_attested boolean NOT NULL DEFAULT false,
  attested_accounts jsonb,
  attested_by_kind text CHECK (attested_by_kind IN ('human', 'authoritative_source')),
  attested_at timestamptz,
  valid_until timestamptz,
  evidence_ref text CHECK (evidence_ref IS NULL OR evidence_ref ~ '^[A-Za-z0-9:_-]{1,128}$'),
  CHECK (attested_accounts IS NULL OR jsonb_typeof(attested_accounts) = 'array')
);
CREATE TABLE cockpit_budget_inventory_private.accounts (
  client_key text NOT NULL REFERENCES cockpit_budget_inventory_private.scopes(client_key) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform ~ '^[a-z][a-z0-9_-]{0,39}$'),
  account_key text NOT NULL CHECK (length(btrim(account_key)) BETWEEN 1 AND 200 AND account_key = btrim(account_key)),
  owner_verified boolean NOT NULL DEFAULT false,
  owner_verifier_kind text CHECK (owner_verifier_kind IN ('human', 'authoritative_source')),
  owner_evidence_ref text CHECK (owner_evidence_ref IS NULL OR owner_evidence_ref ~ '^[A-Za-z0-9:_-]{1,128}$'),
  owner_verified_at timestamptz,
  owner_verified_until timestamptz,
  -- Only canonical IDs for these named platforms can participate in a
  -- ready status. Future adapters must prove these rules against the provider.
  CHECK (platform NOT IN ('meta', 'tiktok') OR account_key ~ '^[1-9][0-9]{0,31}$'),
  CHECK (platform <> 'google' OR account_key ~ '^[0-9]{10}$'),
  CHECK (platform <> 'snap' OR account_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  PRIMARY KEY (client_key, platform, account_key)
);
CREATE TABLE cockpit_budget_inventory_private.coverage (
  client_key text NOT NULL,
  platform text NOT NULL,
  account_key text NOT NULL,
  provider_read_complete boolean NOT NULL DEFAULT false,
  provider_source text CHECK (provider_source IS NULL OR provider_source ~ '^[a-z][a-z0-9_-]{0,39}$'),
  read_evidence_ref text CHECK (read_evidence_ref IS NULL OR read_evidence_ref ~ '^[A-Za-z0-9:_-]{1,128}$'),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (client_key, platform, account_key),
  FOREIGN KEY (client_key, platform, account_key)
    REFERENCES cockpit_budget_inventory_private.accounts(client_key, platform, account_key) ON DELETE CASCADE
);
-- The conflict check searches across clients by platform and account. The
-- primary key starts with client_key, so it does not serve that lookup.
CREATE INDEX accounts_platform_account_client_idx
  ON cockpit_budget_inventory_private.accounts(platform, account_key, client_key);

ALTER TABLE cockpit_budget_inventory_private.gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE cockpit_budget_inventory_private.scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cockpit_budget_inventory_private.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cockpit_budget_inventory_private.coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA cockpit_budget_inventory_private FROM PUBLIC, anon, authenticated, service_role;

-- A status is never a budget total, spend limit or provider write permission.
-- Even the strongest result is scoped to an explicit attestation, not proof
-- that an omitted account cannot exist. Existing adapters do not populate it.
CREATE FUNCTION cockpit_budget_inventory_private.coverage_status(p_client_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  s cockpit_budget_inventory_private.scopes%ROWTYPE;
  actual jsonb; n integer; owner_missing integer; unread integer; conflicted integer; unsupported integer;
  t timestamptz := statement_timestamp();
BEGIN
  IF NOT coalesce((SELECT enabled FROM cockpit_budget_inventory_private.gate WHERE singleton), false) THEN
    RETURN jsonb_build_object('state', 'disabled');
  END IF;
  SELECT * INTO s FROM cockpit_budget_inventory_private.scopes WHERE client_key = p_client_key;
  IF NOT FOUND OR s.all_relevant_platforms_attested IS NOT TRUE OR s.attested_accounts IS NULL
     OR s.attested_by_kind IS NULL OR nullif(btrim(s.evidence_ref), '') IS NULL
     OR s.attested_at IS NULL OR s.attested_at > t OR s.valid_until IS NULL
     OR s.valid_until <= t OR s.valid_until > s.attested_at + interval '30 days' THEN
    RETURN jsonb_build_object('state', 'unknown', 'reason', 'Inventory scope has not been verified or is out of date.');
  END IF;
  SELECT count(*)::integer, coalesce(jsonb_agg(jsonb_build_array(a.platform, a.account_key)
         ORDER BY a.platform, a.account_key), '[]'::jsonb),
         count(*) FILTER (WHERE NOT a.owner_verified OR a.owner_verifier_kind IS NULL
           OR nullif(btrim(a.owner_evidence_ref), '') IS NULL OR a.owner_verified_at IS NULL OR a.owner_verified_at > t
           OR a.owner_verified_until IS NULL OR a.owner_verified_until <= t
           OR a.owner_verified_until > a.owner_verified_at + interval '30 days')::integer,
         count(*) FILTER (WHERE c.client_key IS NULL OR NOT c.provider_read_complete
           OR c.provider_source IS DISTINCT FROM a.platform OR nullif(btrim(c.read_evidence_ref), '') IS NULL
           OR c.observed_at > t OR c.observed_at < t - interval '5 minutes')::integer,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM cockpit_budget_inventory_private.accounts other
           WHERE other.platform = a.platform AND other.account_key = a.account_key
             AND other.client_key <> a.client_key
         ))::integer,
         count(*) FILTER (WHERE a.platform NOT IN ('meta', 'tiktok', 'google', 'snap'))::integer
    INTO n, actual, owner_missing, unread, conflicted, unsupported
  FROM cockpit_budget_inventory_private.accounts a
  LEFT JOIN cockpit_budget_inventory_private.coverage c USING (client_key, platform, account_key)
  WHERE a.client_key = p_client_key;
  IF n = 0 OR s.attested_accounts <> actual THEN
    RETURN jsonb_build_object('state', 'unknown', 'reason', 'Current accounts do not match the verified scope.');
  END IF;
  IF owner_missing > 0 OR unread > 0 OR conflicted > 0 OR unsupported > 0 THEN
    RETURN jsonb_build_object('state', 'incomplete', 'accounts', n,
      'ownership_unverified', owner_missing, 'unread_or_stale', unread,
      'shared_or_conflicted', conflicted, 'unsupported_platforms', unsupported);
  END IF;
  RETURN jsonb_build_object('state', 'ready_for_attested_scope', 'accounts', n,
    'warning', 'This is limited to the attested inventory; omitted accounts or platforms may exist.');
END $$;
REVOKE ALL ON FUNCTION cockpit_budget_inventory_private.coverage_status(text) FROM PUBLIC, anon, authenticated, service_role;
