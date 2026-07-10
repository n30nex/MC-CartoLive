param(
  [Parameter(Mandatory = $true)]
  [string]$Image,
  [Parameter(Mandatory = $true)]
  [string]$PreviousImage,
  [string]$BaseUrl = "https://carto.canadaverse.org",
  [string]$SshTarget = "root@134.122.45.228",
  [string]$KeyPath = (Join-Path $env:USERPROFILE ".ssh\neonx"),
  [string]$RepoPath = "/opt/MC-CartoLive",
  [string]$Service = "meshcore-live-map",
  [string]$DiagnoseRegion = "YTR",
  [string]$ExpectedVersion = "",
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ExpectedGitSha,
  [switch]$FreshDatabase,
  [string]$FreshDatabaseConfirmation = "",
  [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$digestPattern = '^[a-zA-Z0-9._:/-]+@sha256:[0-9a-f]{64}$'
$confirmationToken = 'DELETE-MC-CARTOLIVE-PRODUCTION-DATA'

if ($Image -notmatch $digestPattern) { throw "Image must be an immutable @sha256 reference" }
if ($PreviousImage -notmatch $digestPattern) { throw "PreviousImage must be an immutable @sha256 reference" }
if ($RepoPath -notmatch '^/[a-zA-Z0-9._/-]+$') { throw "RepoPath contains unsupported characters" }
if ($FreshDatabase -and $FreshDatabaseConfirmation -ne $confirmationToken) {
  throw "FreshDatabase requires -FreshDatabaseConfirmation $confirmationToken"
}
if (-not $FreshDatabase -and $FreshDatabaseConfirmation) {
  throw "FreshDatabaseConfirmation was supplied without -FreshDatabase"
}
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { throw "ssh was not found on PATH" }
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "SSH key was not found: $KeyPath" }

Push-Location $root
try {
  if (-not $ExpectedVersion) { $ExpectedVersion = (Get-Content VERSION -TotalCount 1).Trim() }
  $args = @(
    "--image", $Image,
    "--previous-image", $PreviousImage,
    "--expected-git-sha", $ExpectedGitSha,
    "--repo", $RepoPath
  )
  if ($FreshDatabase) {
    $args += @("--fresh-database", "--confirm-fresh-database", $confirmationToken)
  }
  # Every remote argument is either validated by a strict image/SHA/path regex
  # above or is the fixed confirmation token, so single-quote wrapping is safe.
  $quoted = $args | ForEach-Object { "'$_'" }
  $remote = "cd '$RepoPath' && bash scripts/deploy.sh " + ($quoted -join " ")

  Write-Host "Deploying immutable image: $Image"
  Write-Host "Rollback image: $PreviousImage"
  Write-Host "Fresh database: $FreshDatabase"
  & ssh -i $KeyPath -o IdentitiesOnly=yes $SshTarget $remote
  if ($LASTEXITCODE -ne 0) { throw "remote digest deployment failed" }

  if (-not $SkipSmoke) {
    & (Join-Path $PSScriptRoot "live-smoke.ps1") `
      -BaseUrl $BaseUrl -SshTarget $SshTarget -KeyPath $KeyPath `
      -RepoPath $RepoPath -Service $Service -DiagnoseRegion $DiagnoseRegion `
      -ExpectedVersion $ExpectedVersion -ExpectedGitSha $ExpectedGitSha
    if ($LASTEXITCODE -ne 0) { throw "live smoke failed" }
  }
}
finally {
  Pop-Location
}
