<#
Creative Triage daily-checks schema. DRY_RUN = True by default: execute the
whole migration and a one-row audit/grants smoke inside ROLLBACK. -Apply repeats
the dry run before committing. No Convex or checklist data is read or written.
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
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260923e_cockpit_daily_checks.sql'

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
    WHERE entity_type = 'cockpit_daily_checks' AND action = 'INSERT') AS insert_audit_count,
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.cockpit_daily_checks'::regclass) AS rls_enabled,
  has_table_privilege('service_role', 'public.cockpit_daily_checks', 'INSERT') AS service_can_insert,
  has_table_privilege('service_role', 'public.cockpit_daily_checks', 'SELECT') AS service_can_read,
  has_table_privilege('authenticated', 'public.cockpit_daily_checks', 'SELECT') AS authenticated_can_read,
  has_table_privilege('authenticated', 'public.cockpit_daily_checks', 'INSERT') AS authenticated_can_insert,
  has_table_privilege('anon', 'public.cockpit_daily_checks', 'SELECT') AS anon_can_read,
  EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.cockpit_daily_checks'::regclass
      AND tgname = 'trg_cockpit_daily_checks_audit' AND NOT tgisinternal) AS audit_trigger_present;
'@

function Verify-Installed {
  $result = @(Invoke-Sql $verifyQuery $true)[0]
  $result | ConvertTo-Json -Compress | Write-Output
  if (-not $result.rls_enabled -or -not $result.service_can_insert -or
      -not $result.service_can_read -or $result.authenticated_can_read -or
      $result.authenticated_can_insert -or $result.anon_can_read -or
      -not $result.audit_trigger_present) {
    throw 'Checks verification failed: RLS, grant, or audit trigger differs.'
  }
  Write-Output 'Daily-checks schema verification passed.'
}

if ($VerifyOnly) { Verify-Installed; return }

$sql = Get-Content -LiteralPath $migrationPath -Raw
if ($sql -notmatch '(?is)^\s*--.*?\bBEGIN;[\s\S]*\bCOMMIT;\s*$') {
  throw 'Migration must start a transaction and end in COMMIT.'
}
$smoke = @'
DO $smoke$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.cockpit_daily_checks (
    role, owner_app, day, check_key, label, done, done_at,
    source_system, source_deployment, source_id, source_snapshot_ts,
    source_row, changed_by
  ) VALUES (
    'csm', 'client-success', '2000-01-01', 'rollback-only',
    'Rollback-only migration check', true, now(),
    'migration-smoke', 'migration-smoke', gen_random_uuid()::text,
    'rollback-only', '{}'::jsonb, 'migration-smoke'
  ) RETURNING id INTO v_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.cockpit_audit_log
    WHERE entity_type = 'cockpit_daily_checks'
      AND entity_id = v_id::text
      AND action = 'INSERT'
      AND actor_email = 'migration-smoke'
  ) THEN
    RAISE EXCEPTION 'Daily-checks audit smoke failed';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.cockpit_daily_checks'::regclass)
    OR has_table_privilege('authenticated', 'public.cockpit_daily_checks', 'SELECT')
    OR has_table_privilege('anon', 'public.cockpit_daily_checks', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.cockpit_daily_checks', 'INSERT')
  THEN
    RAISE EXCEPTION 'Daily-checks RLS/grant smoke failed';
  END IF;
END;
$smoke$;
'@
$drySql = [regex]::Replace($sql, '(?i)\bCOMMIT;\s*$', "$smoke`nROLLBACK;")
if ($drySql -eq $sql) { throw 'Could not build rolled-back dry run.' }

$before = @(Invoke-Sql "SELECT to_regclass('public.cockpit_daily_checks') IS NOT NULL AS table_exists" $true)[0]
Write-Output ('Creative Triage checks preflight: table_exists=' + $before.table_exists)
Write-Output 'Planned: service-only cockpit_daily_checks, unique logical/source keys, RLS/grants, and INSERT/UPDATE/DELETE audit.'
Write-Output 'DRY_RUN = True: migration and one checked CSM row run inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
$afterDryRun = @(Invoke-Sql "SELECT to_regclass('public.cockpit_daily_checks') IS NOT NULL AS table_exists" $true)[0]
if ($afterDryRun.table_exists -ne $before.table_exists) {
  throw 'The dry run changed visible table state. Inspect before applying.'
}
Write-Output 'Dry run passed; table state unchanged.'
if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying the schema only. No checklist rows are imported.'
[void](Invoke-Sql $sql $false)
Verify-Installed
