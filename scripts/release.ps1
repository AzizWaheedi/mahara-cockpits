<#
.SYNOPSIS
Release one cockpit (or all) in one command: merge the PR, ship from a clean
worktree of origin/main, check the live site, roll back on a failure, and
report one line.

.DESCRIPTION
  powershell -ExecutionPolicy Bypass -File scripts\release.ps1 sales -Pr 54
  powershell -ExecutionPolicy Bypass -File scripts\release.ps1 all
  powershell -ExecutionPolicy Bypass -File scripts\release.ps1 sales -Pr 54 -CheckOnly

Each step stops the release when it fails:
 1. -Pr: the PR must not be a draft, must have no conflicts, and every check
    must have passed. An open PR is merged with gh pr merge --squash (or
    -MergeMethod merge), never --admin. A merged PR is released as it is.
 2. A clean, detached worktree at origin/main under ..\worktrees\release-<sha>,
    prepared with scripts/prepare-worktree.sh --apply.
 3. The production deployment of every app being shipped is recorded
    (scripts/check-vercel-project.py --current).
 4. scripts\ship.ps1 runs from that worktree with every test and live check
    ship.sh has.
 5. Each app's production must then serve the release commit and its page must
    answer. If ship or this check fails and production changed to this release,
    that app is promoted back to its recorded deployment
    (check-vercel-project.py --rollback-to). Production that another release
    changed in the meantime is never rolled back.
 6. One line says what shipped or where it stopped. On Muhammed's laptop the
    line also goes to his status page (~/.agents/bin/status_feed.py).

-CheckOnly reads the PR and production, runs ship.ps1 -CheckOnly, and merges,
deploys and rolls back nothing. The worktree is removed after a successful
release and kept after a failure, for diagnosis.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('media-buyer', 'client-success', 'creative', 'video-editor', 'sales', 'all')]
  [string]$App,
  [int]$Pr = 0,
  [ValidateSet('squash', 'merge')]
  [string]$MergeMethod = 'squash',
  [switch]$CheckOnly
)
# Continue, not Stop: Windows PowerShell 5.1 turns any stderr line of a native
# command under 2>&1 into a terminating error (git worktree add writes progress
# there). Failures are raised explicitly with Fail.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$mainCheckout = ((git -C $repo worktree list --porcelain | Select-Object -First 1) -replace '^worktree ', '') -replace '/', '\'
$ghRepo = 'AzizWaheedi/mahara-cockpits'
$appDirs = [ordered]@{
  'client-success' = 'apps/client-success-cockpit'; 'creative' = 'apps/creative-director-cockpit'
  'media-buyer' = 'apps/media-buyer-cockpit'; 'video-editor' = 'apps/video-editor-cockpit'; 'sales' = 'apps/sales-cockpit'
}
# ship.sh all ships in this order: the receiving cockpits before the media buyer.
$apps = if ($App -eq 'all') { @($appDirs.Keys) } else { @($App) }

$stage = 'start'
$sha = ''
$wt = ''
$prNote = ''
$recorded = @{}
$rolledBack = @()
$log = Join-Path $env:TEMP ("cockpit-release-{0}-{1}.log" -f $App, (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Fail([string]$Message) { throw $Message }

function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  $out = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { Fail ("{0} {1} failed: {2}" -f $Exe, $Arguments[0], (($out | Select-Object -Last 5) -join ' ')) }
  return $out
}

function Get-Production([string]$Dir) {
  $json = & python scripts/check-vercel-project.py $Dir --current 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { Fail "Could not read production for ${Dir}: $($json -join ' ')" }
  return ($json -join '') | ConvertFrom-Json -ErrorAction Stop
}

function Send-Feed([string]$State, [string]$Line) {
  $feed = Join-Path $HOME '.agents\bin\status_feed.py'
  if (Test-Path -LiteralPath $feed) {
    & python $feed post --harness release --session "cockpits-$App" --state $State --summary $Line --cwd $repo --task "Release $App" 2>$null | Out-Null
  }
}

$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
if (-not (Test-Path -LiteralPath $bash)) {
  $git = (Get-Command git -ErrorAction SilentlyContinue).Source
  if ($git) { $bash = Join-Path (Split-Path -Parent (Split-Path -Parent $git)) 'bin\bash.exe' }
}

try {
  if (-not (Test-Path -LiteralPath $bash)) { Fail 'Git Bash was not found. Install Git for Windows.' }

  # 1. The PR
  if ($Pr -gt 0) {
    $stage = "PR #$Pr checks"
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'The GitHub CLI (gh) is needed to read and merge the PR.' }
    $view = (Invoke-Native 'gh' @('pr', 'view', "$Pr", '--repo', $ghRepo, '--json', 'state,isDraft,mergeable,title,statusCheckRollup,mergeCommit')) -join "`n" | ConvertFrom-Json -ErrorAction Stop
    $prNote = " (PR #$Pr $($view.title))"
    if ($view.state -eq 'CLOSED') { Fail "PR #$Pr is closed without a merge." }
    if ($view.state -eq 'OPEN') {
      if ($view.isDraft) { Fail "PR #$Pr is a draft." }
      if ($view.mergeable -eq 'CONFLICTING') { Fail "PR #$Pr has merge conflicts." }
      $bad = @($view.statusCheckRollup | Where-Object {
          $ok = ($_.conclusion -in @('SUCCESS', 'NEUTRAL', 'SKIPPED')) -or ($_.state -eq 'SUCCESS')
          -not $ok
        } | ForEach-Object { if ($_.name) { $_.name } else { $_.context } })
      if ($bad.Count -gt 0) { Fail "PR #$Pr checks not passed: $($bad -join ', ')." }
      if ($CheckOnly) {
        Write-Host "PR #${Pr}: open, checks passed, would merge with --$MergeMethod."
      }
      else {
        $stage = "PR #$Pr merge"
        Invoke-Native 'gh' @('pr', 'merge', "$Pr", '--repo', $ghRepo, "--$MergeMethod") | Out-Null
        $view = (Invoke-Native 'gh' @('pr', 'view', "$Pr", '--repo', $ghRepo, '--json', 'state,mergeCommit')) -join "`n" | ConvertFrom-Json -ErrorAction Stop
        if ($view.state -ne 'MERGED') { Fail "PR #$Pr did not merge (state $($view.state))." }
        Write-Host "PR #${Pr}: merged."
      }
    }
  }

  # 2. A clean worktree at origin/main
  $stage = 'clean worktree'
  Invoke-Native 'git' @('-C', $repo, 'fetch', '--quiet', 'origin', 'main') | Out-Null
  $sha = (Invoke-Native 'git' @('-C', $repo, 'rev-parse', 'origin/main') | Select-Object -Last 1).Trim()
  if ($Pr -gt 0 -and $view.mergeCommit -and $view.mergeCommit.oid) {
    & git -C $repo merge-base --is-ancestor $view.mergeCommit.oid $sha
    if ($LASTEXITCODE -ne 0) { Fail "origin/main does not contain the merge of PR #$Pr yet." }
  }
  $wt = Join-Path (Join-Path (Split-Path -Parent $mainCheckout) 'worktrees') ('release-' + $sha.Substring(0, 8))
  if (Test-Path -LiteralPath $wt) {
    $head = (& git -C $wt rev-parse HEAD).Trim()
    $dirty = & git -C $wt status --porcelain --untracked-files=no
    if ($head -ne $sha -or $dirty) { Fail "$wt exists but is not a clean checkout of $($sha.Substring(0, 8))." }
  }
  else {
    Invoke-Native 'git' @('-C', $repo, 'worktree', 'add', '--detach', $wt, $sha) | Out-Null
  }
  Push-Location $wt
  $stage = 'prepare worktree'
  & $bash scripts/prepare-worktree.sh --apply 2>&1 | Tee-Object -FilePath $log -Append | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "prepare-worktree.sh failed. Log: $log" }

  # 3. What production serves now
  $stage = 'record production'
  foreach ($a in $apps) { $recorded[$a] = Get-Production $appDirs[$a] }
  Write-Host ("Production now: " + (($apps | ForEach-Object { "$_ $($recorded[$_].id)" }) -join ', '))

  # 4. Ship
  $stage = 'ship'
  $shipArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $wt 'scripts\ship.ps1'), $App, '-SourceCheckout', $mainCheckout)
  if ($CheckOnly) { $shipArgs += '-CheckOnly' }
  & powershell @shipArgs 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { Fail "ship.ps1 stopped (exit $LASTEXITCODE). Log: $log" }

  if ($CheckOnly) {
    $line = "Release check for $App from $($sha.Substring(0, 8))${prNote}: preflight passed, nothing merged or deployed. Worktree ready: $wt"
  }
  else {
    # 5. Production serves this release and its page answers
    $stage = 'live check'
    $config = Get-Content -Raw -ErrorAction Stop -LiteralPath (Join-Path $wt 'config\vercel-projects.json') | ConvertFrom-Json -ErrorAction Stop
    $live = @()
    foreach ($a in $apps) {
      $now = Get-Production $appDirs[$a]
      if ($now.sha -ne $sha) { Fail "$a production serves $($now.id), not this release." }
      $url = 'https://' + $config.($appDirs[$a]).domain.TrimEnd('/') + '/'
      $code = 0
      try { $code = (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30 -ErrorAction Stop).StatusCode } catch { $code = -1 }
      if ($code -ne 200) { Fail "$url answered $code after the release." }
      $live += "$a $($now.id)"
    }
    $line = "Released $App from $($sha.Substring(0, 8))${prNote}: live $($live -join ', '). Checks passed."
  }
  Pop-Location
  if (-not $CheckOnly) {
    & git -C $repo worktree remove $wt 2>$null
    if ($LASTEXITCODE -ne 0) { $line += " Worktree kept: $wt" }
  }
  Write-Host "RELEASE: $line"
  Send-Feed 'done' $line
  exit 0
}
catch {
  $reason = $_.Exception.Message
  if ($wt -and (Get-Location).Path -ne $wt -and (Test-Path -LiteralPath $wt)) { Push-Location $wt }
  if (-not $CheckOnly -and $recorded.Count -gt 0) {
    foreach ($a in $apps) {
      if (-not $recorded[$a]) { continue }
      try {
        $now = Get-Production $appDirs[$a]
        # Only undo our own release. Production that changed to another commit
        # belongs to someone else's release.
        if ($now.id -ne $recorded[$a].id -and $now.sha -eq $sha) {
          & python scripts/check-vercel-project.py $appDirs[$a] --rollback-to $recorded[$a].url 2>&1 | Tee-Object -FilePath $log -Append | Out-Null
          if ($LASTEXITCODE -eq 0) { $rolledBack += "$a to $($recorded[$a].id)" }
          else { $rolledBack += "$a ROLLBACK FAILED, promote $($recorded[$a].id) in Vercel" }
        }
      }
      catch { $rolledBack += "$a not checked ($($_.Exception.Message))" }
    }
  }
  $short = if ($sha) { $sha.Substring(0, 8) } else { 'unknown' }
  $rb = if ($rolledBack.Count) { " Rolled back: $($rolledBack -join '; ')." } else { ' Production unchanged by this release.' }
  $line = "Release of $App from $short$prNote stopped at ${stage}: $reason$rb Log: $log"
  Write-Host "RELEASE: $line"
  Send-Feed 'failed' $line
  exit 1
}
