param(
  [string]$BaseUrl = "http://127.0.0.1:39476",
  [string]$MetricsUrl = $env:METRICS_URL,
  [switch]$SkipDocker,
  [switch]$RunBrowserSmoke,
  [string]$BrowserSmokeBaseUrl = "",
  [switch]$RunPackageSmoke,
  [string]$PackageSmokeImage = "",
  [switch]$RunLiveSmoke,
  [string]$LiveSmokeBaseUrl = "https://carto.canadaverse.org",
  [string]$ContainerRuntime = "",
  [switch]$SkipContainerBuild,
  [string]$LocalImage = "mc-cartolive-meshcore-live-map:latest"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  if (-not $ContainerRuntime) {
    if ($env:CONTAINER_RUNTIME) {
      $ContainerRuntime = $env:CONTAINER_RUNTIME
    }
    elseif (Get-Command podman -ErrorAction SilentlyContinue) {
      $ContainerRuntime = "podman"
    }
    else {
      $ContainerRuntime = "docker"
    }
  }
  if ([string]::IsNullOrWhiteSpace($MetricsUrl)) {
    $MetricsUrl = "http://127.0.0.1:39090/metrics"
  }

  node (Join-Path $root "scripts/check-version-sync.mjs")
  node (Join-Path $root "scripts/public-schema-check.mjs")
  node (Join-Path $root "scripts/check-asset-pack.mjs")

  Push-Location "backend"
  try {
    go test ./...
    go tool govulncheck ./...
  }
  finally {
    Pop-Location
  }

  Push-Location "web"
  try {
    npm ci
    npm audit --audit-level=high
    npm test -- --run --pool=threads --maxWorkers=2
    npm run build
    node (Join-Path $root "scripts/check-frontend-budget.mjs")
  }
  finally {
    Pop-Location
  }

  if (-not $SkipDocker -and -not $SkipContainerBuild) {
    if ($ContainerRuntime -eq "podman") {
      & $ContainerRuntime build --format docker -t $LocalImage .
    }
    else {
      & $ContainerRuntime build -t $LocalImage .
    }
  }

  if ($RunPackageSmoke) {
    $packageImage = if ($PackageSmokeImage) { $PackageSmokeImage } else { $LocalImage }
    node (Join-Path $root "scripts/package-smoke.mjs") --runtime $ContainerRuntime --image $packageImage --version ((Get-Content (Join-Path $root "VERSION") -TotalCount 1).Trim())
  }

  $health = Invoke-RestMethod "$BaseUrl/healthz"
  $ready = Invoke-RestMethod "$BaseUrl/readyz"
  $state = Invoke-RestMethod "$BaseUrl/api/v1/public/state"
  $bootstrap = Invoke-RestMethod "$BaseUrl/api/v1/public/bootstrap"
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $from = $now - 600000
  $history = Invoke-RestMethod "$BaseUrl/api/v1/public/history?from=$from&to=$now&limit=25"
  $historySummary = Invoke-RestMethod "$BaseUrl/api/v1/public/history/summary?from=$from&to=$now&bucketMs=60000"
  $packets = Invoke-RestMethod "$BaseUrl/api/v1/public/packets?from=$from&to=$now&limit=25"
  $chat = Invoke-RestMethod "$BaseUrl/api/v1/public/chat?from=$from&to=$now&limit=25"
  $solar = Invoke-RestMethod "$BaseUrl/api/v1/public/solar"
  $propagation = Invoke-RestMethod "$BaseUrl/api/v1/public/propagation?from=$from&to=$now&limit=25"
  $events = Invoke-RestMethod "$BaseUrl/api/v1/public/events?afterSeq=0&limit=25"
  $noc = Invoke-RestMethod "$BaseUrl/api/v1/public/noc"
  $schema = Invoke-RestMethod "$BaseUrl/api/v1/public/schema"
  $sensors = Invoke-RestMethod "$BaseUrl/api/v1/public/integrations/home-assistant"
  try {
    Invoke-WebRequest -UseBasicParsing "$BaseUrl/metrics" -ErrorAction Stop | Out-Null
    throw "public application listener unexpectedly exposed /metrics"
  }
  catch {
    $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($statusCode -ne 404) {
      throw
    }
  }
  $metrics = Invoke-WebRequest -UseBasicParsing $MetricsUrl
  node (Join-Path $root "scripts/check-public-privacy.mjs") $BaseUrl

  if ($RunBrowserSmoke) {
    $browserBaseUrl = if ($BrowserSmokeBaseUrl) { $BrowserSmokeBaseUrl } else { $BaseUrl }
    node (Join-Path $root "scripts/browser-smoke.mjs") --base-url $browserBaseUrl
  }

  [PSCustomObject]@{
    BaseUrl = $BaseUrl
    ContainerRuntime = $ContainerRuntime
    HealthReady = $health.ready
    ReadyzReady = $ready.ready
    Packets = $state.stats.packets
    Nodes = $state.stats.activeNodes
    Routes = $state.stats.activeRoutes
    BootstrapLatestSeq = $bootstrap.latestSeq
    HistoryEvents = $history.window.count
    HistorySummaryBuckets = @($historySummary.buckets).Count
    PacketPaths = $packets.window.count
    ChatMessages = $chat.window.count
    SolarKp = $solar.kpIndex
    PropagationEvents = $propagation.window.count
    PropagationStatus = $propagation.conditions.sourceStatus
    PublicEvents = @($events.events).Count
    NocStatus = $noc.status
    PublicSchemaVersion = $schema.info.version
    SensorPackets = $sensors.packetRate.perMinute
    MetricsBytes = $metrics.Content.Length
    MetricsUrl = $MetricsUrl
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
    & (Join-Path $PSScriptRoot "live-smoke.ps1") -BaseUrl $LiveSmokeBaseUrl -MetricsUrl $MetricsUrl
  }
}
finally {
  Pop-Location
}
