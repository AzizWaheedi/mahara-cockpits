<#
Phase 4 Actions and RPCs migration. DRY_RUN = True by default.
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
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260923p_cockpit_actions_and_rpcs.sql'
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
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cockpit_plan_items') AS plan_items_table_count,
  (SELECT count(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name IN (
    'cockpit_save_eod', 'cockpit_log_decision', 'cockpit_remove_decision',
    'cockpit_update_client_profile', 'cockpit_add_plan_item',
    'cockpit_remove_plan_item', 'cockpit_get_dashboard_summary'
  )) AS rpcs_count,
  (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cockpit_plan_items') AS plan_items_rls,
  has_table_privilege('authenticated', 'public.cockpit_plan_items', 'SELECT') AS auth_can_select_plan_items,
  has_table_privilege('authenticated', 'public.cockpit_plan_items', 'INSERT') AS auth_can_insert_plan_items;
'@

function Verify-Installed {
  $row = @(Invoke-Sql $verifyQuery $true)[0]
  $row | ConvertTo-Json -Compress | Write-Output
  if ($row.plan_items_table_count -ne 1 -or $row.rpcs_count -ne 7 -or
      -not $row.plan_items_rls -or -not $row.auth_can_select_plan_items -or
      $row.auth_can_insert_plan_items) {
    throw 'Actions and RPCs verification failed.'
  }
  Write-Output 'Cockpit actions, RPCs, and plan items schema verified.'
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
  v_rpcs integer;
BEGIN
  SELECT count(*) INTO v_cnt FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'cockpit_plan_items';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'Expected cockpit_plan_items table, got %', v_cnt;
  END IF;

  SELECT count(*) INTO v_rpcs FROM information_schema.routines
  WHERE routine_schema = 'public' AND routine_name IN (
    'cockpit_save_eod', 'cockpit_log_decision', 'cockpit_remove_decision',
    'cockpit_update_client_profile', 'cockpit_add_plan_item',
    'cockpit_remove_plan_item', 'cockpit_get_dashboard_summary'
  );
  IF v_rpcs <> 7 THEN
    RAISE EXCEPTION 'Expected 7 new RPCs, got %', v_rpcs;
  END IF;
END;
$smoke$;
'@

$drySql = [regex]::Replace($sql, '(?i)\bCOMMIT;\s*$', "$smoke`nROLLBACK;")
if ($drySql -eq $sql) { throw 'Could not build rollback dry run.' }

Write-Output 'DRY_RUN = True: testing actions migration inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
Write-Output 'Dry run passed; rollback successful.'

if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying actions migration.'
[void](Invoke-Sql $sql $false)
Verify-Installed
