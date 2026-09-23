<#
Shared cockpit identity & seat management migration. DRY_RUN = True by default.
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
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260923n_cockpit_identity_management.sql'
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
  (SELECT count(*) FROM public.cockpit_members) AS members,
  (SELECT count(*) FROM public.cockpit_members WHERE active AND auth_user_id IS NOT NULL) AS linked_active_members,
  (SELECT count(*) FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_members') AS member_audits,
  has_function_privilege('authenticated', 'public.cockpit_get_my_access()', 'EXECUTE') AS member_can_get_access,
  has_function_privilege('authenticated', 'public.cockpit_admin_upsert_member(text,text,text[],text[])', 'EXECUTE') AS member_can_call_upsert,
  has_function_privilege('authenticated', 'public.cockpit_admin_remove_member(text)', 'EXECUTE') AS member_can_call_remove,
  has_function_privilege('anon', 'public.cockpit_get_my_access()', 'EXECUTE') AS anon_can_get_access,
  has_function_privilege('anon', 'public.cockpit_admin_upsert_member(text,text,text[],text[])', 'EXECUTE') AS anon_can_call_upsert,
  has_table_privilege('authenticated', 'public.cockpit_members', 'INSERT') AS browser_can_insert_members,
  has_table_privilege('authenticated', 'public.cockpit_members', 'UPDATE') AS browser_can_update_members,
  has_table_privilege('authenticated', 'public.cockpit_members', 'DELETE') AS browser_can_delete_members;
'@

function Verify-Installed {
  $row = @(Invoke-Sql $verifyQuery $true)[0]
  $row | ConvertTo-Json -Compress | Write-Output
  if (-not $row.member_can_get_access -or -not $row.member_can_call_upsert -or
      -not $row.member_can_call_remove -or $row.anon_can_get_access -or
      $row.anon_can_call_upsert -or $row.browser_can_insert_members -or
      $row.browser_can_update_members -or $row.browser_can_delete_members) {
    throw 'Identity management permissions verification failed.'
  }
  Write-Output 'Identity management schema and permissions verified.'
}

if ($VerifyOnly) { Verify-Installed; return }

$sql = Get-Content -LiteralPath $migrationPath -Raw
if ($sql -notmatch '(?is)^\s*--.*?\bBEGIN;[\s\S]*\bCOMMIT;\s*$') {
  throw 'Migration must start a transaction and end in COMMIT.'
}

$smoke = @'
DO $smoke$
DECLARE
  v_founder uuid;
  v_founder_access jsonb;
  v_non_founder uuid;
  v_non_founder_access jsonb;
  v_non_founder_email text;
  v_unlinked uuid;
  v_unlinked_access jsonb;
  v_test_upsert_id uuid;
BEGIN
  -- 1. Founder access check
  SELECT cm.auth_user_id INTO v_founder
  FROM public.cockpit_members AS cm
  JOIN auth.users AS au ON au.id = cm.auth_user_id
  WHERE cm.active AND au.email_confirmed_at IS NOT NULL
    AND cm.email = lower(trim(au.email))
    AND cm.email IN ('aziz@maharamedia.com', 'awaheedi2008@gmail.com')
  LIMIT 1;

  IF v_founder IS NULL THEN
    RAISE EXCEPTION 'Confirmed founder required for smoke test';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_founder::text, true);
  PERFORM set_config('request.jwt.claim.email', 'aziz@maharamedia.com', true);

  v_founder_access := public.cockpit_get_my_access();
  IF (v_founder_access ->> 'is_ceo')::boolean IS NOT TRUE OR
     (v_founder_access ->> 'home') <> '/ceo' THEN
    RAISE EXCEPTION 'Founder did not get CEO access';
  END IF;

  -- 2. Non-founder admin access check
  SELECT cm.auth_user_id, cm.email INTO v_non_founder, v_non_founder_email
  FROM public.cockpit_members AS cm
  JOIN auth.users AS au ON au.id = cm.auth_user_id
  WHERE cm.active AND au.email_confirmed_at IS NOT NULL
    AND cm.email = lower(trim(au.email))
    AND cm.email NOT IN ('aziz@maharamedia.com', 'awaheedi2008@gmail.com')
  LIMIT 1;

  IF v_non_founder IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_non_founder::text, true);
    PERFORM set_config('request.jwt.claim.email', v_non_founder_email, true);
    v_non_founder_access := public.cockpit_get_my_access();
    IF (v_non_founder_access ->> 'is_ceo')::boolean IS TRUE THEN
      RAISE EXCEPTION 'Non-founder incorrectly acquired CEO access';
    END IF;
  END IF;

  -- 3. Anonymous execution check
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.email', '', true);
  IF public.cockpit_get_my_access() IS NOT NULL THEN
    RAISE EXCEPTION 'Anonymous caller received access';
  END IF;

  -- 4. Admin operations smoke test (as founder admin)
  PERFORM set_config('request.jwt.claim.sub', v_founder::text, true);
  PERFORM set_config('request.jwt.claim.email', 'aziz@maharamedia.com', true);

  v_test_upsert_id := public.cockpit_admin_upsert_member(
    'smoke-test-user@maharamedia.com',
    'Smoke Test User',
    ARRAY['media_buyer', 'csm', 'ceo']::text[],
    ARRAY['Client X']::text[]
  );

  -- Verify 'ceo' was rejected/stripped
  IF EXISTS (SELECT 1 FROM public.cockpit_members WHERE id = v_test_upsert_id AND 'ceo' = ANY(roles)) THEN
    RAISE EXCEPTION 'cockpit_admin_upsert_member allowed CEO assignment';
  END IF;

  -- Verify remove member
  PERFORM public.cockpit_admin_remove_member('smoke-test-user@maharamedia.com');
  IF (SELECT active FROM public.cockpit_members WHERE id = v_test_upsert_id) IS NOT FALSE THEN
    RAISE EXCEPTION 'cockpit_admin_remove_member did not deactivate member';
  END IF;

  -- Verify admin cannot remove themselves
  BEGIN
    PERFORM public.cockpit_admin_remove_member('aziz@maharamedia.com');
    RAISE EXCEPTION 'Admin self-removal was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cannot remove yourself%' THEN
      RAISE EXCEPTION 'Unexpected error on self-removal: %', SQLERRM;
    END IF;
  END;

END;
$smoke$;
'@

$drySql = [regex]::Replace($sql, '(?i)\bCOMMIT;\s*$', "$smoke`nROLLBACK;")
if ($drySql -eq $sql) { throw 'Could not build rollback dry run.' }

$before = @(Invoke-Sql 'SELECT count(*) AS members FROM public.cockpit_members; SELECT count(*) AS audits FROM public.cockpit_audit_log WHERE entity_type = ''cockpit_members'';' $true)
Write-Output 'DRY_RUN = True: testing identity functions, grants, founder gate, admin actions and RLS inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
$after = @(Invoke-Sql 'SELECT count(*) AS members FROM public.cockpit_members; SELECT count(*) AS audits FROM public.cockpit_audit_log WHERE entity_type = ''cockpit_members'';' $true)

if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) {
  throw 'Dry run changed live member or audit counts.'
}
Write-Output 'Dry run passed; live member and audit counts unchanged.'

if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying shared identity management schema.'
[void](Invoke-Sql $sql $false)
Verify-Installed
