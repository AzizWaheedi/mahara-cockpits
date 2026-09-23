<#
Creative request store in Creative Triage. DRY_RUN = True by default.
-Apply runs the rollback smoke first, then commits the same migration.
-VerifyOnly reads the installed schema and grants without writing.
#>
param(
  [switch]$Apply,
  [switch]$VerifyOnly,
  [string]$EnvPath = 'D:\MaharaMedia\mahara-cockpits\.env.local'
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $VerifyOnly) { throw 'Choose -Apply or -VerifyOnly.' }
$projectRef = 'bldgtotkfmhoxmlzowdx'
$migrationPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\migrations\20260923k_cockpit_creative_requests.sql'
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
      try {
        $parsed = $detail | ConvertFrom-Json
        $detail = @($parsed.message, $parsed.error, $parsed.hint) | Where-Object { $_ } | Select-Object -First 1
      } catch { $detail = 'Unparseable API error.' }
    }
    throw "Creative Triage SQL request failed (HTTP $status): $detail"
  }
}

$presenceQuery = @'
select
  to_regclass('public.cockpit_creative_requests') is not null as requests_exists,
  to_regclass('public.cockpit_creative_request_events') is not null as events_exists;
'@

function Verify-Installed {
  $verification = @(Invoke-Sql @'
select
  (select relrowsecurity from pg_class where oid = 'public.cockpit_creative_requests'::regclass) as requests_rls,
  (select relrowsecurity from pg_class where oid = 'public.cockpit_creative_request_events'::regclass) as events_rls,
  has_table_privilege('service_role', 'public.cockpit_creative_requests', 'SELECT, INSERT, UPDATE') as service_requests_access,
  has_table_privilege('service_role', 'public.cockpit_creative_request_events', 'SELECT, INSERT') as service_events_access,
  has_table_privilege('anon', 'public.cockpit_creative_requests', 'SELECT, INSERT, UPDATE') as anon_requests_access,
  has_table_privilege('authenticated', 'public.cockpit_creative_requests', 'SELECT, INSERT, UPDATE') as browser_requests_access,
  has_table_privilege('anon', 'public.cockpit_creative_request_events', 'SELECT, INSERT') as anon_events_access,
  has_table_privilege('authenticated', 'public.cockpit_creative_request_events', 'SELECT, INSERT') as browser_events_access,
  exists (select 1 from pg_trigger where tgrelid = 'public.cockpit_creative_requests'::regclass
    and tgname = 'cockpit_creative_request_audit' and not tgisinternal) as audit_trigger_present,
  (select count(*) from public.cockpit_creative_requests) as request_count,
  (select count(*) from public.cockpit_creative_request_events) as event_count;
'@ $true)[0]
  $verification | ConvertTo-Json -Compress | Write-Output
  if (-not $verification.requests_rls -or -not $verification.events_rls -or
      -not $verification.service_requests_access -or -not $verification.service_events_access -or
      $verification.anon_requests_access -or $verification.browser_requests_access -or
      $verification.anon_events_access -or $verification.browser_events_access -or
      -not $verification.audit_trigger_present) {
    throw 'RLS, grants, or the audit trigger did not match the migration.'
  }
  Write-Output 'Creative request schema verification passed.'
}

$presence = @(Invoke-Sql $presenceQuery $true)[0]
Write-Output "Creative Triage preflight: requests=$($presence.requests_exists), events=$($presence.events_exists)"
if ($VerifyOnly) {
  if (-not $presence.requests_exists -or -not $presence.events_exists) { throw 'The migration is not installed.' }
  Verify-Installed
  return
}
if ($presence.requests_exists -and $presence.events_exists) { Verify-Installed; return }
if ($presence.requests_exists -or $presence.events_exists) { throw 'Partial installation detected. Stop and inspect.' }

$sql = Get-Content -LiteralPath $migrationPath -Raw
if ($sql -notmatch '(?is)^\s*--.*?\bbegin;[\s\S]*\bcommit;\s*$') {
  throw 'Migration must begin a transaction and end in COMMIT.'
}
$smoke = @'
do $smoke$
declare
  v_id uuid;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.cockpit_creative_requests'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.cockpit_creative_request_events'::regclass)
     or has_table_privilege('authenticated', 'public.cockpit_creative_requests', 'INSERT')
     or not has_table_privilege('service_role', 'public.cockpit_creative_requests', 'INSERT')
  then raise exception 'RLS or grant smoke failed'; end if;

  insert into public.cockpit_creative_requests
    (campaign_name, client_name, meta_account_id, source_meta_ad_id, source_ad_name,
     requested_by, evidence, last_actor)
  values ('migration-smoke', 'migration-smoke', '0', '0', 'migration-smoke',
          'migration-smoke@example.invalid', 'rollback-only', 'migration-smoke')
  returning id into v_id;
  if (select count(*) from public.cockpit_creative_request_events
      where request_id = v_id and kind = 'created' and actor = 'migration-smoke') <> 1
  then raise exception 'Audit trigger smoke failed'; end if;
end;
$smoke$;
'@
$drySql = [regex]::Replace($sql, '(?i)\bcommit;\s*$', "$smoke`nrollback;")
Write-Output 'DRY_RUN = True: applying the migration and one-row audit smoke inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
$afterDryRun = @(Invoke-Sql $presenceQuery $true)[0]
if ($afterDryRun.requests_exists -or $afterDryRun.events_exists) {
  throw 'Dry run did not roll back cleanly.'
}
Write-Output 'Dry run passed; neither table persisted.'
if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying the exact migration to Creative Triage.'
[void](Invoke-Sql $sql $false)
Verify-Installed
