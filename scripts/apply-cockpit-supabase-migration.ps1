<#
Apply the first cockpit Supabase migration to Creative Triage.
DRY_RUN = True by default. The dry run executes the whole migration inside a
transaction that ends in ROLLBACK. -Apply repeats it with COMMIT only after
the dry run succeeds. The token is read from the local env file, never printed.
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
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260922a_cockpit_identity_audit_issue_reports.sql'

function Read-EnvValue([string]$name) {
  $line = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match "^$([regex]::Escape($name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"', "'")
}

if (-not (Test-Path -LiteralPath $EnvPath)) { throw 'The local env file is missing.' }
if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'The migration SQL file is missing.' }
$token = Read-EnvValue 'SUPABASE_ACCESS_TOKEN'
if (-not $token) { $token = Read-EnvValue 'supabase_token' }
$projectUrl = Read-EnvValue 'SUPABASE_URL'
if (-not $token) { throw 'Set SUPABASE_ACCESS_TOKEN or supabase_token in the local env file first.' }
if ($projectUrl -ne "https://$projectRef.supabase.co") {
  throw 'SUPABASE_URL does not match Creative Triage. Stopping before any query.'
}

$sql = Get-Content -LiteralPath $migrationPath -Raw
if ($sql -notmatch '(?is)^\s*--.*?\bBEGIN;[\s\S]*\bCOMMIT;\s*$') {
  throw 'Migration must start a transaction and end in COMMIT.'
}
$drySql = [regex]::Replace($sql, '(?i)\bCOMMIT;\s*$', 'ROLLBACK;')
if ($drySql -eq $sql) { throw 'Could not build the rolled-back dry run.' }
$rowSmoke = @'
DO $smoke$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.cockpit_issue_reports (
    kind, text, created_by, source_system, source_id,
    app, page, role, actor_email
  ) VALUES (
    'issue', 'rollback-only migration check', 'migration-smoke',
    'migration-smoke', gen_random_uuid()::text,
    'media-buyer', 'migration-smoke', 'media_buyer', 'migration-smoke@example.invalid'
  ) RETURNING id INTO v_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.cockpit_audit_log
    WHERE entity_type = 'cockpit_issue_reports'
      AND entity_id = v_id::text
      AND action = 'INSERT'
      AND actor_email = 'migration-smoke@example.invalid'
  ) THEN
    RAISE EXCEPTION 'Issue-report audit smoke check failed';
  END IF;
END;
$smoke$;
'@
$drySql = [regex]::Replace($drySql, '(?i)\bROLLBACK;\s*$', "$rowSmoke`nROLLBACK;")

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

if ($VerifyOnly) {
  $verification = Invoke-Sql @'
select
  (select count(*) from public.cockpit_members) as member_count,
  (select count(*) from public.cockpit_issue_reports) as issue_report_count,
  (select count(*) from public.cockpit_audit_log where entity_type = 'cockpit_members' and action = 'INSERT') as member_insert_audits,
  (select count(*) from public.cockpit_feedback) as existing_ceo_feedback_count,
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.cockpit_members'::regclass,
    'public.cockpit_audit_log'::regclass,
    'public.cockpit_issue_reports'::regclass
  )) as all_rls_enabled,
  has_table_privilege('authenticated', 'public.cockpit_issue_reports', 'SELECT') as authenticated_can_read_reports,
  has_table_privilege('authenticated', 'public.cockpit_issue_reports', 'INSERT') as authenticated_can_insert_reports,
  has_table_privilege('anon', 'public.cockpit_issue_reports', 'SELECT') as anon_can_read_reports,
  has_table_privilege('service_role', 'public.cockpit_issue_reports', 'INSERT') as service_can_insert_reports,
  has_function_privilege('authenticated', 'public.cockpit_submit_issue_report(text,text,text,text)', 'EXECUTE') as authenticated_can_submit_rpc,
  has_function_privilege('anon', 'public.cockpit_submit_issue_report(text,text,text,text)', 'EXECUTE') as anon_can_submit_rpc;
'@ $true
  Write-Output 'Creative Triage verification:'
  $verification | ConvertTo-Json -Depth 4 -Compress | Write-Output
  $row = @($verification)[0]
  if ($row.member_count -lt 6 -or $row.member_insert_audits -lt 6 -or
      -not $row.all_rls_enabled -or -not $row.authenticated_can_read_reports -or
      $row.authenticated_can_insert_reports -or $row.anon_can_read_reports -or
      -not $row.service_can_insert_reports -or
      -not $row.authenticated_can_submit_rpc -or $row.anon_can_submit_rpc) {
    throw 'Verification failed: membership, audit, RLS, or grants differ from expected state.'
  }
  Write-Output 'Verification passed.'
  return
}

$before = Invoke-Sql @'
select
  to_regclass('public.cockpit_members') is not null as members_exists,
  to_regclass('public.cockpit_audit_log') is not null as audit_exists,
  to_regclass('public.cockpit_issue_reports') is not null as issue_reports_exists,
  to_regclass('public.cockpit_feedback') is not null as ceo_feedback_exists;
'@ $true

Write-Output 'Creative Triage migration preflight:'
$before | ConvertTo-Json -Depth 4 -Compress | Write-Output
Write-Output 'Planned: cockpit_members, cockpit_audit_log, cockpit_issue_reports, role checks, gated issue-report RPC, RLS and grants.'
Write-Output 'Existing cockpit_feedback (Aziz changes queue) is not changed.'
Write-Output 'DRY_RUN = True: executing migration and one-row audit smoke check inside a transaction that ends in ROLLBACK.'
[void](Invoke-Sql $drySql $false)

$afterDryRun = Invoke-Sql @'
select
  to_regclass('public.cockpit_members') is not null as members_exists,
  to_regclass('public.cockpit_audit_log') is not null as audit_exists,
  to_regclass('public.cockpit_issue_reports') is not null as issue_reports_exists;
'@ $true
$beforeRow = @($before)[0]
$dryRow = @($afterDryRun)[0]
if ($dryRow.members_exists -ne $beforeRow.members_exists -or
    $dryRow.audit_exists -ne $beforeRow.audit_exists -or
    $dryRow.issue_reports_exists -ne $beforeRow.issue_reports_exists) {
  throw 'The dry run changed visible table state. Inspect the project before applying.'
}
Write-Output 'Dry run passed; table state is unchanged.'

if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying the same migration to Creative Triage.'
[void](Invoke-Sql $sql $false)

$verified = Invoke-Sql @'
select
  to_regclass('public.cockpit_members') is not null as members_exists,
  to_regclass('public.cockpit_audit_log') is not null as audit_exists,
  to_regclass('public.cockpit_issue_reports') is not null as issue_reports_exists,
  (select count(*) from public.cockpit_members) as member_count;
'@ $true
$verified | ConvertTo-Json -Depth 4 -Compress | Write-Output
$verifiedRow = @($verified)[0]
if (-not $verifiedRow.members_exists -or -not $verifiedRow.audit_exists -or -not $verifiedRow.issue_reports_exists) {
  throw 'Apply returned, but the expected tables were not all visible.'
}
Write-Output 'Migration applied and verified.'
