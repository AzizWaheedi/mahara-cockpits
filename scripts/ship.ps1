<#
.SYNOPSIS
Ship one cockpit (or all) from Windows with the three values scripts/ship.sh needs.

.DESCRIPTION
Loading a secret into a deploy is the person's step, not an agent's, so this
is the command a person runs. It loads three values by name and never prints
them:
  COCKPIT_MANAGEMENT_TOKEN   from supabase_token in the main checkout's .env.local
  VITE_SUPABASE_URL          from an app .env.local (this worktree's first,
  VITE_SUPABASE_ANON_KEY     then the main checkout's)
It then runs scripts/ship.sh in Git Bash. The values live only in this process
and are removed when it ends. scripts/ship-preflight.sh checks that the key is
the anon key before anything is built.

  powershell -ExecutionPolicy Bypass -File scripts\ship.ps1 client-success
  powershell -ExecutionPolicy Bypass -File scripts\ship.ps1 all -CheckOnly

-CheckOnly runs the preflight and stops before any test or deploy.
-SourceCheckout names the clone that holds the .env.local files. It defaults
to the main worktree.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('media-buyer', 'client-success', 'creative', 'video-editor', 'sales', 'all')]
  [string]$App,
  [switch]$CheckOnly,
  [string]$SourceCheckout = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if (-not $SourceCheckout) {
  $first = (git -C $repo worktree list --porcelain | Select-Object -First 1)
  $SourceCheckout = $first -replace '^worktree ', ''
}

function Read-Named([string]$Path, [string[]]$Names) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $at = $line.IndexOf('=')
    if ($at -lt 1) { continue }
    if ($Names -ccontains $line.Substring(0, $at).Trim()) {
      $value = $line.Substring($at + 1).Trim().Trim('"', "'")
      if ($value) { return $value }
    }
  }
  return $null
}

$tokenNames = @('COCKPIT_MANAGEMENT_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'supabase_token')
$token = $null
foreach ($file in @((Join-Path $repo '.env.local'), (Join-Path $SourceCheckout '.env.local'))) {
  $token = Read-Named $file $tokenNames
  if ($token) { Write-Host "Management token: read from $file"; break }
}
if (-not $token) {
  throw "No Supabase management token. Add supabase_token=... to $SourceCheckout\.env.local, then run this again."
}

$appDirs = @{
  'media-buyer' = 'media-buyer-cockpit'; 'client-success' = 'client-success-cockpit'
  'creative' = 'creative-director-cockpit'; 'video-editor' = 'video-editor-cockpit'
  'sales' = 'sales-cockpit'; 'all' = 'client-success-cockpit'
}
$appDir = $appDirs[$App]
# Every app reads the same cockpit project, so any app's file will do once the
# named app has none.
$candidates = @(
  (Join-Path $repo "apps\$appDir\.env.local"),
  (Join-Path $SourceCheckout "apps\$appDir\.env.local")
) + @(Get-ChildItem -Path (Join-Path $SourceCheckout 'apps\*\.env.local') -Force -ErrorAction SilentlyContinue |
  ForEach-Object { $_.FullName })
$url = $null; $anon = $null
foreach ($file in $candidates) {
  $u = Read-Named $file @('VITE_SUPABASE_URL')
  $k = Read-Named $file @('VITE_SUPABASE_ANON_KEY')
  if ($u -and $k) { $url = $u; $anon = $k; Write-Host "Build values: read from $file"; break }
}
if (-not $url) {
  throw "No app .env.local holds both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Add them to $SourceCheckout\apps\$appDir\.env.local (the anon key, never the service key)."
}

$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
if (-not (Test-Path -LiteralPath $bash)) {
  $git = (Get-Command git -ErrorAction SilentlyContinue).Source
  if ($git) { $bash = Join-Path (Split-Path -Parent (Split-Path -Parent $git)) 'bin\bash.exe' }
}
if (-not (Test-Path -LiteralPath $bash)) {
  throw 'Git Bash was not found. Install Git for Windows, then run this again.'
}

$script = if ($CheckOnly) { 'scripts/ship-preflight.sh' } else { 'scripts/ship.sh' }
$names = @('COCKPIT_MANAGEMENT_TOKEN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY')
$code = 1
Push-Location $repo
try {
  $env:COCKPIT_MANAGEMENT_TOKEN = $token
  $env:VITE_SUPABASE_URL = $url
  $env:VITE_SUPABASE_ANON_KEY = $anon
  & $bash $script $App
  $code = $LASTEXITCODE
}
finally {
  Pop-Location
  foreach ($name in $names) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
}
exit $code
