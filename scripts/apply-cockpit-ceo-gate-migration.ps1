<#
Correct Supabase CEO identity checks. DRY_RUN = True by default: install and
exercise both functions inside ROLLBACK, including a temporary admin grant to
one non-founder member. -Apply reruns the dry run before committing schema.
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
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260923m_cockpit_ceo_gate.sql'
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
  (SELECT count(*) FROM public.cockpit_audit_log
    WHERE entity_type = 'cockpit_members') AS member_audits,
  has_function_privilege('authenticated', 'public.cockpit_is_ceo()', 'EXECUTE') AS member_can_check_ceo,
  has_function_privilege('authenticated', 'public.cockpit_has_role(text)', 'EXECUTE') AS member_can_check_role,
  has_function_privilege('anon', 'public.cockpit_is_ceo()', 'EXECUTE') AS anon_can_check_ceo,
  has_function_privilege('anon', 'public.cockpit_has_role(text)', 'EXECUTE') AS anon_can_check_role,
  position('aziz@maharamedia.com' in pg_get_functiondef('public.cockpit_is_ceo()'::regprocedure)) > 0 AS founder_gate_present,
  position('required_role = ''ceo''' in pg_get_functiondef('public.cockpit_has_role(text)'::regprocedure)) > 0 AS role_gate_present;
'@

function Verify-Installed {
  $row = @(Invoke-Sql $verifyQuery $true)[0]
  $row | ConvertTo-Json -Compress | Write-Output
  if (-not $row.member_can_check_ceo -or -not $row.member_can_check_role -or
      $row.anon_can_check_ceo -or $row.anon_can_check_role -or
      -not $row.founder_gate_present -or -not $row.role_gate_present) {
    throw 'CEO identity and grant verification failed.'
  }
  Write-Output 'Founder-only CEO gate verified.'
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
  v_other uuid;
  v_other_member uuid;
BEGIN
  IF public.cockpit_is_ceo() OR public.cockpit_has_role('ceo') THEN
    RAISE EXCEPTION 'Unauthenticated CEO access';
  END IF;
  SELECT cm.auth_user_id INTO v_founder
  FROM public.cockpit_members AS cm
  JOIN auth.users AS au ON au.id = cm.auth_user_id
  WHERE cm.active AND au.email_confirmed_at IS NOT NULL
    AND cm.email = lower(trim(au.email))
    AND cm.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
  LIMIT 1;
  SELECT cm.id, cm.auth_user_id INTO v_other_member, v_other
  FROM public.cockpit_members AS cm
  JOIN auth.users AS au ON au.id = cm.auth_user_id
  WHERE cm.active AND au.email_confirmed_at IS NOT NULL
    AND cm.email = lower(trim(au.email))
    AND cm.email NOT IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
  LIMIT 1;
  IF v_founder IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION 'Confirmed founder and non-founder canaries required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_founder::text, true);
  IF NOT public.cockpit_is_ceo() OR NOT public.cockpit_has_role('ceo') THEN
    RAISE EXCEPTION 'Founder was denied CEO access';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  IF public.cockpit_is_ceo() OR public.cockpit_has_role('ceo') THEN
    RAISE EXCEPTION 'Non-founder gained CEO access';
  END IF;
  UPDATE public.cockpit_members
  SET roles = array_append(roles, 'admin')
  WHERE id = v_other_member AND NOT ('admin' = ANY(roles));
  IF public.cockpit_is_ceo() OR public.cockpit_has_role('ceo') THEN
    RAISE EXCEPTION 'Admin role wrongly granted CEO access';
  END IF;
END;
$smoke$;
'@
$drySql = [regex]::Replace($sql, '(?i)\bCOMMIT;\s*$', "$smoke`nROLLBACK;")
if ($drySql -eq $sql) { throw 'Could not build rollback dry run.' }
$before = @(Invoke-Sql 'SELECT (SELECT count(*) FROM public.cockpit_members) AS members, (SELECT count(*) FROM public.cockpit_audit_log WHERE entity_type = ''cockpit_members'') AS audits;' $true)[0]
Write-Output 'DRY_RUN = True: founder, non-founder, and temporary-admin checks inside ROLLBACK.'
[void](Invoke-Sql $drySql $false)
$after = @(Invoke-Sql 'SELECT (SELECT count(*) FROM public.cockpit_members) AS members, (SELECT count(*) FROM public.cockpit_audit_log WHERE entity_type = ''cockpit_members'') AS audits;' $true)[0]
if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) {
  throw 'Dry run changed live member or audit counts.'
}
Write-Output 'Dry run passed; live member and audit counts unchanged.'
if (-not $Apply) { return }

Write-Output 'DRY_RUN = False: applying founder-only CEO gate.'
[void](Invoke-Sql $sql $false)
Verify-Installed
