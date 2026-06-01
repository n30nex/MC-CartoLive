param(
  [string]$BaseUrl = "http://127.0.0.1:39476",
  [switch]$SkipDocker,
  [switch]$RunLiveSmoke,
  [string]$LiveSmokeBaseUrl = "https://carto.canadaverse.org"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  node (Join-Path $root "scripts/check-version-sync.mjs")

  Push-Location "backend"
  try {
    go test ./...
  }
  finally {
    Pop-Location
  }

  Push-Location "web"
  try {
    npm test -- --run
    npm run build
  }
  finally {
    Pop-Location
  }

  if (-not $SkipDocker) {
    docker compose build
  }

  $health = Invoke-RestMethod "$BaseUrl/healthz"
  $ready = Invoke-RestMethod "$BaseUrl/readyz"
  $state = Invoke-RestMethod "$BaseUrl/api/v1/public/state"
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $from = $now - 600000
  $history = Invoke-RestMethod "$BaseUrl/api/v1/public/history?from=$from&to=$now&limit=25"
  $packets = Invoke-RestMethod "$BaseUrl/api/v1/public/packets?from=$from&to=$now&limit=25"
  $chat = Invoke-RestMethod "$BaseUrl/api/v1/public/chat?from=$from&to=$now&limit=25"
  node (Join-Path $root "scripts/check-public-privacy.mjs") $BaseUrl

  [PSCustomObject]@{
    BaseUrl = $BaseUrl
    HealthReady = $health.ready
    ReadyzReady = $ready.ready
    Packets = $state.stats.packets
    Nodes = $state.stats.activeNodes
    Routes = $state.stats.activeRoutes
    HistoryEvents = $history.window.count
    PacketPaths = $packets.window.count
    ChatMessages = $chat.window.count
    PacketIngestState = $health.packetIngestState
    PublicCacheState = $health.publicCacheState
    MapMotionState = $health.mapMotionState
    LiveConfidenceState = $health.liveConfidenceState
    PacketIngestFresh = $health.packetIngestFresh
    PublicLiveFresh = $health.publicLiveFresh
    GitSha = $health.gitSha
    BuildTime = $health.buildTime
  } | Format-List

  if ($RunLiveSmoke) {
    & (Join-Path $PSScriptRoot "live-smoke.ps1") -BaseUrl $LiveSmokeBaseUrl
  }
}
finally {
  Pop-Location
}
