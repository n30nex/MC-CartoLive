param(
  [string]$BaseUrl = "https://carto.canadaverse.org",
  [string]$SshTarget = "root@134.122.45.228",
  [string]$KeyPath = (Join-Path $env:USERPROFILE ".ssh\neonx"),
  [string]$RepoPath = "/opt/MC-CartoLive",
  [string]$Branch = "main",
  [string]$Service = "meshcore-live-map",
  [string]$DiagnoseRegion = "YTR",
  [string]$ExpectedVersion = "",
  [string]$ExpectedGitSha = "",
  [switch]$SkipDbBackup,
  [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Get-FirstLine {
  param([string]$Command)
  $value = Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
    throw "Command failed: $Command"
  }
  return ($value | Select-Object -First 1).Trim()
}

Push-Location $root
try {
  if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
    $ExpectedVersion = (Get-Content (Join-Path $root "VERSION") -TotalCount 1).Trim()
  }
  if ([string]::IsNullOrWhiteSpace($ExpectedGitSha)) {
    $ExpectedGitSha = Get-FirstLine "git rev-parse HEAD"
  }

  if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    throw "ssh was not found on PATH"
  }
  if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key was not found: $KeyPath"
  }

  Write-Host "Deploy target: $SshTarget"
  Write-Host "Remote repo: $RepoPath"
  Write-Host "Branch: $Branch"
  Write-Host "Expected version: $ExpectedVersion"
  Write-Host "Expected SHA: $ExpectedGitSha"

  $skipBackupValue = if ($SkipDbBackup) { "1" } else { "0" }
  $remoteScript = @'
set -euo pipefail
cd "__REPO_PATH__"
if [ "__SKIP_DB_BACKUP__" = "1" ]; then
  SKIP_DB_BACKUP=1 bash scripts/deploy.sh "__REPO_PATH__" "__BRANCH__"
else
  bash scripts/deploy.sh "__REPO_PATH__" "__BRANCH__"
fi
'@
  $remoteScript = $remoteScript.Replace("__REPO_PATH__", $RepoPath).Replace("__BRANCH__", $Branch).Replace("__SKIP_DB_BACKUP__", $skipBackupValue)

  $sshArgs = @("-i", $KeyPath, "-o", "IdentitiesOnly=yes", $SshTarget, $remoteScript)
  $deployOutput = & ssh @sshArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "remote deploy failed: $($deployOutput -join "`n")"
  }
  $deployOutput | ForEach-Object { Write-Host $_ }

  if ($SkipSmoke) {
    Write-Host "Live smoke skipped by request."
  } else {
    $smokeScript = Join-Path $PSScriptRoot "live-smoke.ps1"
    & $smokeScript `
      -BaseUrl $BaseUrl `
      -SshTarget $SshTarget `
      -KeyPath $KeyPath `
      -RepoPath $RepoPath `
      -Service $Service `
      -DiagnoseRegion $DiagnoseRegion `
      -ExpectedVersion $ExpectedVersion `
      -ExpectedGitSha $ExpectedGitSha
    if ($LASTEXITCODE -ne 0) {
      throw "live smoke failed"
    }
  }
}
finally {
  Pop-Location
}
