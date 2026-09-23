<#
Daily checks shadow write contract migration. DRY_RUN = True by default: execute
the entire migration and synthetic smoke tests inside ROLLBACK.
-Apply runs the dry run first before committing the schema.
-VerifyOnly reads schema, grants, and current table/audit counts with zero writes.
No live application writer is claimed to be enabled.
#>
param(
  [switch]$Apply,
  [switch]$VerifyOnly,
  [string]$EnvPath = 'D:\MaharaMedia\mahara-cockpits\.env.local'
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $VerifyOnly) { throw 'Choose -Apply or -VerifyOnly, not both.' }
$projectRef = 'bldgtotkfmhoxmlzowdx'
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260923f_cockpit_daily_check_shadow.sql'

function Read-EnvValue([string]$name) {
  $line = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match "^$([regex]::Escape($name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"', "'")
}

if (-not (Test-Path -LiteralPath $EnvPath)) { throw 'The local env file is missing.' }
if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'The migration SQL file is missing.' }
$token = Read-EnvValue 'SUPABASE_ACCESS_TOKEN'
if (-not $token) { $token = Read-EnvValue 'supabase_token' }
if (-not $token) { throw 'Set SUPABASE_ACCESS_TOKEN or supabase_token in the local env file first.' }
if ((Read-EnvValue 'SUPABASE_URL') -ne "https://$projectRef.supabase.co") {
  throw 'SUPABASE_URL does not match Creative Triage. Stopping before any query.'
}

$headers = @{ Authorization = "Bearer $token" }
$endpoint = "https://api.supabase.com/v1/projects/$projectRef/database/query"

function Invoke-Sql([string]$query, [bool]$readOnly) {
  $body = @{ query = $query; read_only = $readOnly } | ConvertTo-Json -Depth 3 -Compress
  try {
    return Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -ContentType 'application/json' -Body $body
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $detail = $_.ErrorDetails.Message
    if ($detail) {
      try {
        $parsed = $detail | ConvertFrom-Json
        $detail = @($parsed.message, $parsed.error, $parsed.hint) | Where-Object { $_ } | Select-Object -First 1
      } catch { $detail = 'Unparseable API error.' }
    }
    throw "Supabase SQL request failed (HTTP $status): $detail. No migration completion was confirmed."
  }
}

$verifyQuery = @'
SELECT
  (SELECT count(*) FROM public.cockpit_daily_checks) AS check_count,
  (SELECT count(*) FROM public.cockpit_audit_log
    WHERE entity_type = 'cockpit_daily_checks') AS audit_count,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cockpit_daily_checks'
      AND column_name = 'source_revision' AND column_default = '0'
  ) AS source_revision_present,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cockpit_daily_checks'
      AND column_name = 'source_deleted' AND column_default = 'false'
  ) AS source_deleted_present,
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cockpit_apply_daily_check_shadow'
  ) AS shadow_function_present,
  has_function_privilege('service_role', 'public.cockpit_apply_daily_check_shadow(jsonb)', 'EXECUTE') AS service_can_execute_function,
  has_function_privilege('authenticated', 'public.cockpit_apply_daily_check_shadow(jsonb)', 'EXECUTE') AS authenticated_can_execute_function,
  has_function_privilege('anon', 'public.cockpit_apply_daily_check_shadow(jsonb)', 'EXECUTE') AS anon_can_execute_function,
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.cockpit_daily_checks'::regclass) AS rls_enabled,
  has_table_privilege('service_role', 'public.cockpit_daily_checks', 'INSERT') AS service_can_insert,
  has_table_privilege('service_role', 'public.cockpit_daily_checks', 'SELECT') AS service_can_read,
  has_table_privilege('authenticated', 'public.cockpit_daily_checks', 'SELECT') AS authenticated_can_read,
  has_table_privilege('authenticated', 'public.cockpit_daily_checks', 'INSERT') AS authenticated_can_insert,
  has_table_privilege('anon', 'public.cockpit_daily_checks', 'SELECT') AS anon_can_read,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.cockpit_daily_checks'::regclass
      AND tgname = 'trg_cockpit_daily_checks_audit' AND NOT tgisinternal
  ) AS audit_trigger_present;
'@

function Verify-Installed {
  $result = @(Invoke-Sql $verifyQuery $true)[0]
  $result | ConvertTo-Json -Compress | Write-Output
  if (-not $result.source_revision_present -or
      -not $result.source_deleted_present -or
      -not $result.shadow_function_present -or
      -not $result.service_can_execute_function -or
      $result.authenticated_can_execute_function -or
      $result.anon_can_execute_function -or
      -not $result.rls_enabled -or
      -not $result.service_can_insert -or
      -not $result.service_can_read -or
      $result.authenticated_can_read -or
      $result.authenticated_can_insert -or
      $result.anon_can_read -or
      -not $result.audit_trigger_present) {
    throw 'Shadow verification failed: columns, RPC, RLS, grants, or audit trigger differ.'
  }
  Write-Output 'Daily-checks shadow schema and service-only RPC verification passed.'
}

if ($VerifyOnly) { Verify-Installed; return }

$sql = Get-Content -LiteralPath $migrationPath -Raw
if ($sql -notmatch '(?is)^\s*--.*?\bBEGIN;[\s\S]*\bCOMMIT;\s*$') {
  throw 'Migration must start a transaction and end in COMMIT.'
}

$smoke = @'
DO $smoke$
DECLARE
  v_synthetic_id text := gen_random_uuid()::text;
  v_res jsonb;
  v_check_id bigint;
  v_audit_count_before int;
  v_audit_count_after int;
  v_conflict_caught boolean := false;
BEGIN
  -- 1. Verify column presence and defaults
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cockpit_daily_checks'
      AND column_name = 'source_revision' AND column_default = '0'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cockpit_daily_checks'
      AND column_name = 'source_deleted' AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'Column defaults smoke failed';
  END IF;

  -- 2. Verify service-only execution grants and browser denial
  IF NOT has_function_privilege('service_role', 'public.cockpit_apply_daily_check_shadow(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cockpit_apply_daily_check_shadow(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cockpit_apply_daily_check_shadow(jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Function privileges smoke failed';
  END IF;

  -- 3. Synthetic insert
  v_res := public.cockpit_apply_daily_check_shadow(jsonb_build_object(
    'role', 'media_buyer',
    'owner_app', 'media-buyer',
    'day', '2000-01-01',
    'check_key', 'shadow-smoke',
    'label', 'Synthetic Smoke Check',
    'detail', 'Testing insert',
    'phase', 'sod',
    'block', 'sprint_am',
    'display_order', 1,
    'href', '/smoke',
    'done', false,
    'source_system', 'convex',
    'source_deployment', 'adorable-seahorse-418',
    'source_id', v_synthetic_id,
    'source_snapshot_ts', 'live:100',
    'source_row', '{"smoke": true}'::jsonb,
    'changed_by', 'smoke-runner',
    'source_revision', 100
  ));

  IF v_res ->> 'status' <> 'inserted' THEN
    RAISE EXCEPTION 'Synthetic insert status smoke failed: %', v_res;
  END IF;
  v_check_id := (v_res ->> 'id')::bigint;

  IF NOT EXISTS (
    SELECT 1 FROM public.cockpit_audit_log
    WHERE entity_type = 'cockpit_daily_checks'
      AND entity_id = v_check_id::text
      AND action = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'Synthetic insert audit smoke failed';
  END IF;

  -- 4. Synthetic later update (higher revision)
  v_res := public.cockpit_apply_daily_check_shadow(jsonb_build_object(
    'role', 'media_buyer',
    'owner_app', 'media-buyer',
    'day', '2000-01-01',
    'check_key', 'shadow-smoke',
    'label', 'Synthetic Smoke Check Updated',
    'detail', 'Testing update',
    'phase', 'sod',
    'block', 'sprint_am',
    'display_order', 1,
    'href', '/smoke',
    'done', true,
    'done_at', now(),
    'source_system', 'convex',
    'source_deployment', 'adorable-seahorse-418',
    'source_id', v_synthetic_id,
    'source_snapshot_ts', 'live:200',
    'source_row', '{"smoke": true, "updated": true}'::jsonb,
    'changed_by', 'smoke-runner',
    'source_revision', 200
  ));

  IF v_res ->> 'status' <> 'updated' THEN
    RAISE EXCEPTION 'Synthetic update status smoke failed: %', v_res;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cockpit_audit_log
    WHERE entity_type = 'cockpit_daily_checks'
      AND entity_id = v_check_id::text
      AND action = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'Synthetic update audit smoke failed';
  END IF;

  -- 5. Stale replay (lower revision)
  SELECT count(*) INTO v_audit_count_before
  FROM public.cockpit_audit_log
  WHERE entity_type = 'cockpit_daily_checks' AND entity_id = v_check_id::text;

  v_res := public.cockpit_apply_daily_check_shadow(jsonb_build_object(
    'role', 'media_buyer',
    'owner_app', 'media-buyer',
    'day', '2000-01-01',
    'check_key', 'shadow-smoke',
    'label', 'Synthetic Smoke Check Stale',
    'done', false,
    'source_system', 'convex',
    'source_deployment', 'adorable-seahorse-418',
    'source_id', v_synthetic_id,
    'source_snapshot_ts', 'live:150',
    'source_row', '{"smoke": true}'::jsonb,
    'changed_by', 'smoke-runner',
    'source_revision', 150
  ));

  IF v_res ->> 'status' <> 'stale' THEN
    RAISE EXCEPTION 'Stale replay status smoke failed: %', v_res;
  END IF;

  SELECT count(*) INTO v_audit_count_after
  FROM public.cockpit_audit_log
  WHERE entity_type = 'cockpit_daily_checks' AND entity_id = v_check_id::text;

  IF v_audit_count_after <> v_audit_count_before THEN
    RAISE EXCEPTION 'Stale replay produced an audit entry';
  END IF;

  -- 6. Duplicate replay (same revision, identical content)
  v_res := public.cockpit_apply_daily_check_shadow(jsonb_build_object(
    'role', 'media_buyer',
    'owner_app', 'media-buyer',
    'day', '2000-01-01',
    'check_key', 'shadow-smoke',
    'label', 'Synthetic Smoke Check Updated',
    'detail', 'Testing update',
    'phase', 'sod',
    'block', 'sprint_am',
    'display_order', 1,
    'href', '/smoke',
    'done', true,
    'done_at', (SELECT done_at FROM public.cockpit_daily_checks WHERE id = v_check_id),
    'source_system', 'convex',
    'source_deployment', 'adorable-seahorse-418',
    'source_id', v_synthetic_id,
    'source_snapshot_ts', 'live:200',
    'source_row', '{"smoke": true, "updated": true}'::jsonb,
    'changed_by', 'smoke-runner',
    'source_revision', 200
  ));

  IF v_res ->> 'status' <> 'duplicate' THEN
    RAISE EXCEPTION 'Duplicate replay status smoke failed: %', v_res;
  END IF;

  SELECT count(*) INTO v_audit_count_after
  FROM public.cockpit_audit_log
  WHERE entity_type = 'cockpit_daily_checks' AND entity_id = v_check_id::text;

  IF v_audit_count_after <> v_audit_count_before THEN
    RAISE EXCEPTION 'Duplicate replay produced an audit entry';
  END IF;

  -- 7. Conflicting same-version rejection (same revision, divergent content)
  BEGIN
    PERFORM public.cockpit_apply_daily_check_shadow(jsonb_build_object(
      'role', 'media_buyer',
      'owner_app', 'media-buyer',
      'day', '2000-01-01',
      'check_key', 'shadow-smoke',
      'label', 'Conflicting Label at Same Revision',
      'done', false,
      'source_system', 'convex',
      'source_deployment', 'adorable-seahorse-418',
      'source_id', v_synthetic_id,
      'source_snapshot_ts', 'live:200',
      'source_row', '{"smoke": true}'::jsonb,
      'changed_by', 'smoke-runner',
      'source_revision', 200
    ));
  EXCEPTION WHEN OTHERS THEN
    v_conflict_caught := true;
  END;

  IF NOT v_conflict_caught THEN
    RAISE EXCEPTION 'Conflicting same-version replay was not rejected';
  END IF;
END;
$smoke$;
'@

$drySql = [regex]::Replace($sql, '(?i)\bCOMMIT;\s*$', "$smoke`nROLLBACK;")
if ($drySql -eq $sql) { throw 'Could not build rolled-back dry run.' }

$before = @(Invoke-Sql "SELECT (to_regclass('public.cockpit_daily_checks') IS NOT NULL) AS table_exists" $true)[0]
Write-Output ('Creative Triage shadow checks preflight: table_exists=' + $before.table_exists)
Write-Output 'Planned: source_revision/source_deleted columns, service-only cockpit_apply_daily_check_shadow RPC, serialization, versioned updates.'
Write-Output 'DRY_RUN = True: additive migration and synthetic smoke tests execute inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
$afterDryRun = @(Invoke-Sql "SELECT (to_regclass('public.cockpit_daily_checks') IS NOT NULL) AS table_exists" $true)[0]
if ($afterDryRun.table_exists -ne $before.table_exists) {
  throw 'The dry run changed visible table state. Inspect before applying.'
}
Write-Output 'Dry run passed; table state unchanged.'
if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying the shadow schema only. Live application shadow writer remains unenabled in dry-run mode.'
[void](Invoke-Sql $sql $false)
Verify-Installed
Write-Output 'Schema installed and verified. Live application shadow writer remains unenabled in dry-run mode.'
