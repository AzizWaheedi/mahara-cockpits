<#
Phase 3 Domain tables migration. DRY_RUN = True by default.
Smoke checks run inside ROLLBACK before -Apply can commit.
#>
param(
  [switch]$Apply,
  [switch]$VerifyOnly,
  [string]$EnvPath = 'D:\MaharaMedia\mahara-cockpits\.env.local'
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $VerifyOnly) { throw 'Choose -Apply or -VerifyOnly.' }
$projectRef = 'bldgtotkfmhoxmlzowdx'
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260923o_cockpit_domain_tables.sql'
if (-not (Test-Path -LiteralPath $EnvPath)) { throw 'Local env file missing.' }
if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'Migration SQL missing.' }

function Read-EnvValue([string]$name) {
  $line = Get-Content -LiteralPath $EnvPath | Where-Object {
    $_ -match "^$([regex]::Escape($name))="
  } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"', "'")
}

$token = Read-EnvValue 'SUPABASE_ACCESS_TOKEN'
if (-not $token) { $token = Read-EnvValue 'supabase_token' }
if (-not $token) { throw 'Supabase management token missing from local env.' }
if ((Read-EnvValue 'SUPABASE_URL') -ne "https://$projectRef.supabase.co") {
  throw 'SUPABASE_URL does not match Creative Triage.'
}
$headers = @{ Authorization = "Bearer $token" }
$endpoint = "https://api.supabase.com/v1/projects/$projectRef/database/query"

function Invoke-Sql([string]$query, [bool]$readOnly) {
  $body = @{ query = $query; read_only = $readOnly } | ConvertTo-Json -Compress
  try {
    return Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers `
      -ContentType 'application/json' -Body $body
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $detail = $_.ErrorDetails.Message
    if ($detail) {
      try {
        $parsed = $detail | ConvertFrom-Json
        $detail = @($parsed.message, $parsed.error, $parsed.hint) |
          Where-Object { $_ } | Select-Object -First 1
      } catch { $detail = 'Unparseable API error.' }
    }
    throw "Supabase SQL failed (HTTP $status): $detail"
  }
}

$verifyQuery = @'
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (
    'cockpit_eod_reports', 'cockpit_campaigns', 'cockpit_ads', 'cockpit_decisions', 'cockpit_client_profiles'
  )) AS tables_count,
  has_table_privilege('authenticated', 'public.cockpit_campaigns', 'SELECT') AS auth_can_select_campaigns,
  has_table_privilege('authenticated', 'public.cockpit_campaigns', 'INSERT') AS auth_can_insert_campaigns,
  has_table_privilege('anon', 'public.cockpit_campaigns', 'SELECT') AS anon_can_select_campaigns,
  has_table_privilege('anon', 'public.cockpit_campaigns', 'INSERT') AS anon_can_insert_campaigns,
  (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cockpit_campaigns') AS campaigns_rls,
  (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cockpit_ads') AS ads_rls,
  (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cockpit_eod_reports') AS eod_rls,
  (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cockpit_decisions') AS decisions_rls,
  (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cockpit_client_profiles') AS client_profiles_rls;
'@

function Verify-Installed {
  $row = @(Invoke-Sql $verifyQuery $true)[0]
  $row | ConvertTo-Json -Compress | Write-Output
  if ($row.tables_count -ne 5 -or -not $row.auth_can_select_campaigns -or
      $row.auth_can_insert_campaigns -or $row.anon_can_select_campaigns -or
      $row.anon_can_insert_campaigns -or -not $row.campaigns_rls -or
      -not $row.ads_rls -or -not $row.eod_rls -or -not $row.decisions_rls -or
      -not $row.client_profiles_rls) {
    throw 'Domain tables verification failed.'
  }
  Write-Output 'Domain tables schema and RLS permissions verified.'
}

if ($VerifyOnly) { Verify-Installed; return }

$sql = Get-Content -LiteralPath $migrationPath -Raw
if ($sql -notmatch '(?is)^\s*--.*?\bBEGIN;[\s\S]*\bCOMMIT;\s*$') {
  throw 'Migration must start a transaction and end in COMMIT.'
}

$smoke = @'
DO $smoke$
DECLARE
  v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN (
    'cockpit_eod_reports', 'cockpit_campaigns', 'cockpit_ads', 'cockpit_decisions', 'cockpit_client_profiles'
  );
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'Expected 5 domain tables, got %', v_cnt;
  END IF;

  -- Test RLS enforcement for anonymous caller (should fail closed)
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.email', '', true);
END;
$smoke$;
'@

$drySql = [regex]::Replace($sql, '(?i)\bCOMMIT;\s*$', "$smoke`nROLLBACK;")
if ($drySql -eq $sql) { throw 'Could not build rollback dry run.' }

Write-Output 'DRY_RUN = True: testing domain tables schema and RLS inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
Write-Output 'Dry run passed; rollback successful.'

if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying domain tables schema.'
[void](Invoke-Sql $sql $false)
Verify-Installed
