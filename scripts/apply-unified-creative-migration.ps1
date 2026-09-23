<#
Creative Triage schema update. DRY_RUN = True by default.
-Apply repeats the rollback smoke and then commits the same migration.
-VerifyOnly reads the installed schema without writing.
#>
param(
  [switch]$Apply,
  [switch]$VerifyOnly,
  [string]$EnvPath = 'D:\MaharaMedia\mahara-cockpits\.env.local'
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $VerifyOnly) { throw 'Choose -Apply or -VerifyOnly.' }
$projectRef = 'bldgtotkfmhoxmlzowdx'
$migrationPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\migrations\20260923m_unified_creative_request.sql'
if (-not (Test-Path -LiteralPath $EnvPath)) { throw 'The local env file is missing.' }
if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'The migration SQL file is missing.' }

function Read-EnvValue([string]$Name) {
  $line = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"', "'")
}
$token = Read-EnvValue 'SUPABASE_ACCESS_TOKEN'
if (-not $token) { $token = Read-EnvValue 'supabase_token' }
if (-not $token) { throw 'A Supabase management token is required.' }
if ((Read-EnvValue 'SUPABASE_URL') -ne "https://$projectRef.supabase.co") {
  throw 'SUPABASE_URL does not match Creative Triage.'
}
$endpoint = "https://api.supabase.com/v1/projects/$projectRef/database/query"
$headers = @{ Authorization = "Bearer $token" }
function Invoke-Sql([string]$Query, [bool]$ReadOnly) {
  $body = @{ query = $Query; read_only = $ReadOnly } | ConvertTo-Json -Compress
  try {
    return Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -ContentType 'application/json' -Body $body
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $detail = $_.ErrorDetails.Message
    if ($detail) {
      try { $detail = ($detail | ConvertFrom-Json).message } catch { $detail = 'Unparseable API error.' }
    }
    throw "Creative Triage SQL request failed (HTTP $status): $detail"
  }
}

$verifyQuery = @'
select
  (select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'cockpit_creative_requests'
      and column_name = 'source_meta_ad_id') as source_optional,
  (select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'cockpit_creative_requests'
      and column_name = 'source_ad_name') as name_optional,
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cockpit_creative_requests'
      and column_name = 'request_reason') as reason_exists,
  exists (select 1 from pg_constraint where conname = 'cockpit_creative_request_reason_valid') as reason_check,
  to_regclass('public.cockpit_creative_requests_one_open_campaign_reason') is not null as campaign_index,
  (select relrowsecurity from pg_class where oid = 'public.cockpit_creative_requests'::regclass) as rls,
  has_table_privilege('service_role', 'public.cockpit_creative_requests', 'SELECT, INSERT, UPDATE') as service_access,
  has_table_privilege('authenticated', 'public.cockpit_creative_requests', 'SELECT, INSERT, UPDATE') as browser_access,
  exists (select 1 from pg_trigger where tgrelid = 'public.cockpit_creative_requests'::regclass
    and tgname = 'cockpit_creative_request_audit' and not tgisinternal) as audit_trigger,
  (select count(*) from public.cockpit_creative_requests) as request_count;
'@
function Verify-Installed {
  $v = @(Invoke-Sql $verifyQuery $true)[0]
  $v | ConvertTo-Json -Compress | Write-Output
  if (-not $v.source_optional -or -not $v.name_optional -or -not $v.reason_exists -or
      -not $v.reason_check -or -not $v.campaign_index -or -not $v.rls -or
      -not $v.service_access -or $v.browser_access -or -not $v.audit_trigger) {
    throw 'Unified creative request schema or access verification failed.'
  }
  Write-Output 'Unified creative request schema verification passed.'
}

$current = @(Invoke-Sql $verifyQuery $true)[0]
if ($VerifyOnly) { Verify-Installed; return }
if ($current.source_optional -and $current.reason_exists -and $current.campaign_index) {
  Verify-Installed
  return
}
if ($current.reason_exists -or $current.campaign_index) {
  throw 'Partial migration detected. Stop and inspect.'
}
$sql = Get-Content -LiteralPath $migrationPath -Raw
if ($sql -notmatch '(?is)^\s*--.*?\bbegin;[\s\S]*\bcommit;\s*$') {
  throw 'Migration must begin a transaction and end in COMMIT.'
}
$smoke = @'
do $smoke$
declare v_id uuid;
begin
  insert into public.cockpit_creative_requests
    (campaign_name, client_name, meta_account_id, source_meta_ad_id, source_ad_name,
     requested_by, evidence, request_reason, last_actor)
  values ('migration-smoke', 'migration-smoke', '0', null, null,
          'migration-smoke@example.invalid', 'rollback-only', 'new_angle', 'migration-smoke')
  returning id into v_id;
  if (select count(*) from public.cockpit_creative_request_events
      where request_id = v_id and kind = 'created' and actor = 'migration-smoke') <> 1
  then raise exception 'Audit trigger smoke failed'; end if;
end;
$smoke$;
'@
$drySql = [regex]::Replace($sql, '(?i)\bcommit;\s*$', "$smoke`nrollback;")
Write-Output 'DRY_RUN = True: testing the schema and one audited campaign request inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
$after = @(Invoke-Sql $verifyQuery $true)[0]
if ($after.reason_exists -or $after.campaign_index) { throw 'Dry run did not roll back cleanly.' }
Write-Output 'Dry run passed; no schema or row persisted.'
if (-not $Apply) { return }
Write-Output 'DRY_RUN = False: applying the exact migration to Creative Triage.'
[void](Invoke-Sql $sql $false)
Verify-Installed
