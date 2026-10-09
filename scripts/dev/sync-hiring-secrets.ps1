# Copies the hiring GoHighLevel key and location from the Hermes native runtime file
# into the Creative Triage Edge Function secrets (GHL_HIRING_PIT, GHL_HIRING_LOCATION).
# Convex read both in convex/hiring/ghl.ts; the native hiring-sync and hiring-api need them.
# Prints no secret value. Run from PowerShell on Muhammed's machine.
$ErrorActionPreference = 'Stop'
$py = @'
import json, pathlib
root = pathlib.Path("/home/hermes/cockpit-native-current").resolve().name
d = json.loads(pathlib.Path(f"/home/hermes/.cockpit-native-state/runtime-{root}.json").read_text())
for k in ("GHL_HIRING_PIT", "GHL_HIRING_LOCATION"):
    print(f"{k}={d[k]}")
'@
$tmp = Join-Path $env:TEMP ("hiring-" + [guid]::NewGuid() + ".env")
try {
  $py | wsl -d Ubuntu -- ssh -o BatchMode=yes root@187.77.156.166 python3 - | Out-File -Encoding ascii $tmp
  if ((Get-Content $tmp | Measure-Object -Line).Lines -ne 2) { throw "Could not read both hiring keys from the VPS." }
  $line = Get-Content D:\MaharaMedia\mahara-cockpits\.env.local | Where-Object { $_ -match '^supabase_token=' } | Select-Object -First 1
  $env:SUPABASE_ACCESS_TOKEN = ($line -split '=', 2)[1].Trim().Trim('"')
  supabase secrets set --env-file $tmp --project-ref bldgtotkfmhoxmlzowdx
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
}
