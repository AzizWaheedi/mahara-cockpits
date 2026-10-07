param(
  [Parameter(Mandatory=$true)]
  [string]$Query,
  [switch]$ReadOnly,
  [string]$EnvPath = 'D:\MaharaMedia\mahara-cockpits\.env.local'
)

$ErrorActionPreference = 'Stop'
$projectRef = 'bldgtotkfmhoxmlzowdx'

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

$headers = @{ Authorization = "Bearer $token" }
$endpoint = "https://api.supabase.com/v1/projects/$projectRef/database/query"

$body = @{ query = $Query; read_only = [bool]$ReadOnly } | ConvertTo-Json -Compress
try {
  $resp = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers `
    -ContentType 'application/json' -Body $body
  $resp | ConvertTo-Json -Depth 5 | Write-Output
} catch {
  $detail = $_.ErrorDetails.Message
  throw "Supabase SQL failed: $detail"
}
