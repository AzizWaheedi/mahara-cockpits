<#
Direct Supabase checklist API migration. DRY_RUN = True by default.
The migration and smoke checks run inside ROLLBACK before -Apply can commit.
No application route or live checklist value is changed by this schema step.
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
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260923l_cockpit_daily_checks_direct.sql'

function Read-EnvValue([string]$name) {
  $line = Get-Content -LiteralPath $EnvPath | Where-Object {
    $_ -match "^$([regex]::Escape($name))="
  } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"', "'")
}

if (-not (Test-Path -LiteralPath $EnvPath)) { throw 'Local env file missing.' }
if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'Migration SQL missing.' }
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
  (SELECT count(*) FROM public.cockpit_daily_checks) AS check_count,
  (SELECT count(*) FROM public.cockpit_audit_log
    WHERE entity_type = 'cockpit_daily_checks') AS audit_count,
  to_regprocedure('public.cockpit_get_daily_checks(text,date)') IS NOT NULL AS read_function,
  to_regprocedure('public.cockpit_set_daily_check(bigint,boolean,boolean)') IS NOT NULL AS write_function,
  has_function_privilege('authenticated', 'public.cockpit_get_daily_checks(text,date)', 'EXECUTE') AS member_can_read,
  has_function_privilege('authenticated', 'public.cockpit_set_daily_check(bigint,boolean,boolean)', 'EXECUTE') AS member_can_write,
  has_function_privilege('anon', 'public.cockpit_get_daily_checks(text,date)', 'EXECUTE') AS anon_can_read,
  has_function_privilege('anon', 'public.cockpit_set_daily_check(bigint,boolean,boolean)', 'EXECUTE') AS anon_can_write,
  has_table_privilege('authenticated', 'public.cockpit_daily_checks', 'UPDATE') AS browser_can_update_table,
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.cockpit_daily_checks'::regclass) AS rls_enabled,
  EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.cockpit_daily_checks'::regclass
      AND tgname = 'trg_cockpit_daily_checks_audit' AND NOT tgisinternal) AS audit_trigger;
'@

function Verify-Installed {
  $row = @(Invoke-Sql $verifyQuery $true)[0]
  $row | ConvertTo-Json -Compress | Write-Output
  if (-not $row.read_function -or -not $row.write_function -or
      -not $row.member_can_read -or -not $row.member_can_write -or
      $row.anon_can_read -or $row.anon_can_write -or
      $row.browser_can_update_table -or -not $row.rls_enabled -or
      -not $row.audit_trigger) {
    throw 'Direct checklist API verification failed.'
  }
  Write-Output 'Direct checklist API schema and permissions verified.'
}

if ($VerifyOnly) { Verify-Installed; return }

$sql = Get-Content -LiteralPath $migrationPath -Raw
if ($sql -notmatch '(?is)^\s*--.*?\bBEGIN;[\s\S]*\bCOMMIT;\s*$') {
  throw 'Migration must start a transaction and end in COMMIT.'
}
$smoke = @'
DO $smoke$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.cockpit_get_daily_checks(text,date)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.cockpit_set_daily_check(bigint,boolean,boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.cockpit_get_daily_checks(text,date)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.cockpit_set_daily_check(bigint,boolean,boolean)', 'EXECUTE')
    OR has_table_privilege('authenticated', 'public.cockpit_daily_checks', 'UPDATE')
  THEN RAISE EXCEPTION 'Checklist access grants failed'; END IF;
  BEGIN
    PERFORM public.cockpit_get_daily_checks('media_buyer', DATE '2000-01-01');
    RAISE EXCEPTION 'Unauthenticated checklist read was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.cockpit_set_daily_check(1, false, true);
    RAISE EXCEPTION 'Unauthenticated checklist write was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$smoke$;
'@
$drySql = [regex]::Replace($sql, '(?i)\bCOMMIT;\s*$', "$smoke`nROLLBACK;")
if ($drySql -eq $sql) { throw 'Could not build rollback dry run.' }

$before = @(Invoke-Sql 'SELECT count(*) AS checks FROM public.cockpit_daily_checks; SELECT count(*) AS audits FROM public.cockpit_audit_log WHERE entity_type = ''cockpit_daily_checks'';' $true)
Write-Output 'DRY_RUN = True: direct checklist functions, grants, and unauthenticated denial tested inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
$after = @(Invoke-Sql 'SELECT count(*) AS checks FROM public.cockpit_daily_checks; SELECT count(*) AS audits FROM public.cockpit_audit_log WHERE entity_type = ''cockpit_daily_checks'';' $true)
if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) {
  throw 'Dry run changed live checklist or audit counts.'
}
Write-Output 'Dry run passed; live counts unchanged.'
if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying only the direct API schema. Live screens remain unchanged.'
[void](Invoke-Sql $sql $false)
Verify-Installed
