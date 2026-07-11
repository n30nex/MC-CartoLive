param(
  [string]$BaseUrl = "https://carto.canadaverse.org",
  [string]$SshTarget = $env:LIVE_SMOKE_SSH_TARGET,
  [string]$KeyPath = $env:LIVE_SMOKE_KEY_PATH,
  [string]$RepoPath = "/opt/MC-CartoLive",
  [string]$Service = "meshcore-live-map",
  [Alias("DiagnoseIata")]
  [string]$DiagnoseRegion = "YTR",
  [string]$ExpectedVersion = "",
  [string]$ExpectedGitSha = "",
  [string]$ExpectedBuildTime = ""
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")
$root = Split-Path -Parent $PSScriptRoot

function Write-Pass {
  param([string]$Message)
  Write-Host "[pass] $Message"
}

function Assert-Smoke {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Test-GitShaMatch {
  param(
    [string]$Actual,
    [string]$Expected
  )
  if ([string]::IsNullOrWhiteSpace($Expected)) {
    return $true
  }
  if ([string]::IsNullOrWhiteSpace($Actual)) {
    return $false
  }
  $actualClean = $Actual.Trim().ToLowerInvariant()
  $expectedClean = $Expected.Trim().ToLowerInvariant()
  return $actualClean.StartsWith($expectedClean) -or $expectedClean.StartsWith($actualClean)
}

function Get-RepoValue {
  param(
    [string]$Command,
    [string]$Fallback
  )
  try {
    $value = Invoke-Expression $Command
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($value)) {
      return ($value | Select-Object -First 1).Trim()
    }
  }
  catch {
  }
  return $Fallback
}

function Get-WebSocketHello {
  param([string]$PublicBaseUrl)

  $base = [Uri]$PublicBaseUrl
  $wsScheme = "ws"
  if ($base.Scheme -eq "https") {
    $wsScheme = "wss"
  }
  $wsUri = [Uri]::new(("{0}://{1}/ws/public" -f $wsScheme, $base.Authority))
  $client = [System.Net.WebSockets.ClientWebSocket]::new()
  $client.Options.SetRequestHeader("Origin", $PublicBaseUrl.TrimEnd("/"))
  $cts = [System.Threading.CancellationTokenSource]::new()
  $cts.CancelAfter([TimeSpan]::FromSeconds(10))

  try {
    $client.ConnectAsync($wsUri, $cts.Token).GetAwaiter().GetResult()
    $buffer = New-Object byte[] 8192
    $segment = [ArraySegment[byte]]::new($buffer)
    $result = $client.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
    $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    return $text | ConvertFrom-Json
  }
  finally {
    if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $closeCts = [System.Threading.CancellationTokenSource]::new()
      $closeCts.CancelAfter([TimeSpan]::FromSeconds(2))
      try {
        $client.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "smoke complete", $closeCts.Token).GetAwaiter().GetResult()
      }
      catch {
      }
    }
    $client.Dispose()
  }
}

function Get-HealthForSmoke {
  param([string]$PublicBaseUrl)

  $last = $null
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      $last = Invoke-RestMethod "$PublicBaseUrl/healthz"
    } catch {
      if ($attempt -eq 6) {
        throw
      }
      Start-Sleep -Seconds 5
      continue
    }
    if ([bool]$last.ok) {
      return $last
    }
    Start-Sleep -Seconds 5
  }
  return $last
}

function Invoke-RemoteSmoke {
  param(
    [string]$Target,
    [string]$Identity,
    [string]$RemoteRepo,
    [string]$ComposeService,
    [string]$Iata
  )

  $remoteScript = @'
set -euo pipefail
cd "__REPO_PATH__"
echo "gitSha=$(git rev-parse --short HEAD)"
mapfile -t containers < <(docker ps --filter "label=com.docker.compose.service=__SERVICE__" --filter status=running --format '{{.ID}}')
test "${#containers[@]}" -eq 1
cid="${containers[0]}"
echo "containerId=$cid"
echo "containerHealth=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
metrics=$(curl -fsS --max-time 10 http://127.0.0.1:39090/metrics)
metric() { awk -v wanted="$1" '$1 == wanted {print $2; exit}' <<<"$metrics"; }
echo "metricsAvailable=true"
echo "metricsAccepted=$(metric meshcore_mqtt_messages_accepted_total)"
echo "metricsProcessed=$(metric meshcore_mqtt_messages_processed_total)"
echo "metricsDropped=$(metric meshcore_mqtt_messages_dropped_total)"
echo "metricsQueueDepth=$(metric meshcore_mqtt_queue_depth)"
echo "metricsDerivedAccepted=$(metric meshcore_derived_accepted_total)"
echo "metricsDerivedProcessed=$(metric meshcore_derived_processed_total)"
echo "metricsDerivedDropped=$(metric meshcore_derived_dropped_total)"
echo "metricsDerivedFailures=$(metric meshcore_derived_failures_total)"
echo "metricsCacheRefreshFailures=$(metric meshcore_cache_refresh_failures_total)"
echo "metricsStoreWriteFailures=$(metric meshcore_store_write_failures_total)"
echo "metricsStoreWriteFullErrors=$(metric meshcore_store_write_full_errors_total)"
echo "metricsStoreWriteBusyErrors=$(metric meshcore_store_write_busy_errors_total)"
docker exec "$cid" sh -lc 'regions="${PUBLIC_REGIONS:-${PUBLIC_IATAS:-}}"; /app/mc-diagnose --db /app/data/meshcore-live.db --region "$1" --public-regions "$regions"' sh "__IATA__"
'@
  $remoteScript = $remoteScript.Replace("__REPO_PATH__", $RemoteRepo).Replace("__SERVICE__", $ComposeService).Replace("__IATA__", $Iata)

  $sshArgs = @("-i", $Identity, "-o", "IdentitiesOnly=yes", $Target, $remoteScript)
  $output = & ssh @sshArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "remote smoke failed: $($output -join "`n")"
  }
  return ($output -join "`n")
}

Push-Location $root
try {
  if ([string]::IsNullOrWhiteSpace($SshTarget)) {
    throw "LIVE_SMOKE_SSH_TARGET environment variable is required but was empty"
  }
  if ([string]::IsNullOrWhiteSpace($KeyPath)) {
    throw "LIVE_SMOKE_KEY_PATH environment variable is required but was empty"
  }
  if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
    $ExpectedVersion = (Get-Content (Join-Path $root "VERSION") -TotalCount 1).Trim()
  }
  if ([string]::IsNullOrWhiteSpace($ExpectedGitSha)) {
    $ExpectedGitSha = Get-RepoValue "git rev-parse --short HEAD" ""
  }

  $health = Get-HealthForSmoke $BaseUrl
  Assert-Smoke ([bool]$health.ok) "/healthz did not report ok=true"
  Assert-Smoke ([string]$health.version -eq $ExpectedVersion) "deployed version $($health.version) did not match expected $ExpectedVersion"
  Assert-Smoke (-not [string]::IsNullOrWhiteSpace([string]$health.buildTime)) "deployed buildTime is empty"
  if (-not [string]::IsNullOrWhiteSpace($ExpectedBuildTime)) {
    Assert-Smoke ([string]$health.buildTime -eq $ExpectedBuildTime) "deployed buildTime $($health.buildTime) did not match expected $ExpectedBuildTime"
  }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedGitSha)) {
    Assert-Smoke (Test-GitShaMatch ([string]$health.gitSha) $ExpectedGitSha) "deployed gitSha $($health.gitSha) did not match expected $ExpectedGitSha"
  }
  Write-Pass "/healthz ok, version=$($health.version), gitSha=$($health.gitSha)"

  $ready = Invoke-RestMethod "$BaseUrl/readyz"
  Assert-Smoke ([bool]$ready.ready) "/readyz did not report ready=true"
  Assert-Smoke ([string]$ready.storagePressureState -ne "critical") "/readyz reported critical storage pressure"
  Assert-Smoke ([bool]$ready.mqttSessionReady) "/readyz did not report MQTT session readiness"
  Assert-Smoke (@("fresh_start", "warming", "live") -contains ([string]$ready.datasetState)) "unexpected datasetState $($ready.datasetState)"
  Write-Pass "/readyz ready, dataset=$($ready.datasetState), storage=$($ready.storagePressureState)"

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
  Write-Pass "public /metrics is hidden"

  $state = Invoke-RestMethod "$BaseUrl/api/v1/public/state"
  Assert-Smoke ($state.stats.packets -ge 0) "public state packet count was invalid"
  Assert-Smoke ($state.stats.activeNodes -ge 0) "public state active node count was invalid"
  Assert-Smoke ($state.stats.activeRoutes -ge 0) "public state active route count was invalid"
  if ([string]$ready.datasetState -eq "live") {
    Assert-Smoke ($state.stats.packets -gt 0) "live dataset did not contain a packet"
  }
  Write-Pass "public state packets=$($state.stats.packets), nodes=$($state.stats.activeNodes), routes=$($state.stats.activeRoutes)"

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $from = $now - 600000
  $history = Invoke-RestMethod "$BaseUrl/api/v1/public/history?from=$from&to=$now&limit=25"
  Assert-Smoke ($null -ne $history.window) "public history did not include a window"
  Assert-Smoke ($history.window.to -ge $history.window.from) "public history window was invalid"
  Write-Pass "public history window count=$($history.window.count)"

  $packets = Invoke-RestMethod "$BaseUrl/api/v1/public/packets?from=$from&to=$now&limit=25"
  Assert-Smoke ($null -ne $packets.window) "public packets did not include a window"
  Assert-Smoke ($packets.window.to -ge $packets.window.from) "public packets window was invalid"
  Write-Pass "public packets window count=$($packets.window.count)"

  $chat = Invoke-RestMethod "$BaseUrl/api/v1/public/chat?from=$from&to=$now&limit=25"
  Assert-Smoke ($null -ne $chat.window) "public chat did not include a window"
  Assert-Smoke ($chat.window.to -ge $chat.window.from) "public chat window was invalid"
  Write-Pass "public chat window count=$($chat.window.count)"

  $hello = Get-WebSocketHello $BaseUrl
  Assert-Smoke ([string]$hello.type -eq "hello") "WebSocket first frame was $($hello.type), expected hello"
  $helloSeq = if ($null -eq $hello.seq) { 0 } else { [long]$hello.seq }
  Assert-Smoke ($helloSeq -ge 0) "WebSocket hello sequence was negative"
  Write-Pass "WebSocket hello seq=$helloSeq"

  $remote = Invoke-RemoteSmoke $SshTarget $KeyPath $RepoPath $Service $DiagnoseRegion
  if (-not [string]::IsNullOrWhiteSpace($ExpectedGitSha)) {
    $remoteGitSha = ""
    if ($remote -match "gitSha=([0-9A-Fa-f]+)") {
      $remoteGitSha = $Matches[1]
    }
    Assert-Smoke (Test-GitShaMatch $remoteGitSha $ExpectedGitSha) "remote git SHA $remoteGitSha did not match expected $ExpectedGitSha"
  }
  Assert-Smoke ($remote -match "containerHealth=healthy") "remote container was not healthy"
  Assert-Smoke ($remote -match "(?m)^metricsAvailable=true$") "remote loopback metrics endpoint was unavailable"
  $remoteAccepted = if ($remote -match "(?m)^metricsAccepted=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteProcessed = if ($remote -match "(?m)^metricsProcessed=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteDropped = if ($remote -match "(?m)^metricsDropped=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteQueueDepth = if ($remote -match "(?m)^metricsQueueDepth=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteDerivedAccepted = if ($remote -match "(?m)^metricsDerivedAccepted=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteDerivedProcessed = if ($remote -match "(?m)^metricsDerivedProcessed=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteDerivedDropped = if ($remote -match "(?m)^metricsDerivedDropped=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteDerivedFailures = if ($remote -match "(?m)^metricsDerivedFailures=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteCacheRefreshFailures = if ($remote -match "(?m)^metricsCacheRefreshFailures=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteStoreWriteFailures = if ($remote -match "(?m)^metricsStoreWriteFailures=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteStoreWriteFullErrors = if ($remote -match "(?m)^metricsStoreWriteFullErrors=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  $remoteStoreWriteBusyErrors = if ($remote -match "(?m)^metricsStoreWriteBusyErrors=([0-9]+)$") { [long]$Matches[1] } else { -1 }
  Assert-Smoke ($remoteAccepted -ge 0 -and $remoteProcessed -ge 0 -and $remoteDropped -ge 0 -and $remoteQueueDepth -ge 0 -and $remoteDerivedAccepted -ge 0 -and $remoteDerivedProcessed -ge 0 -and $remoteDerivedDropped -ge 0 -and $remoteDerivedFailures -ge 0 -and $remoteCacheRefreshFailures -ge 0 -and $remoteStoreWriteFailures -ge 0 -and $remoteStoreWriteFullErrors -ge 0 -and $remoteStoreWriteBusyErrors -ge 0) "remote loopback metrics were incomplete"
  Assert-Smoke ($remoteProcessed -le $remoteAccepted) "processed MQTT count exceeded accepted count"
  Assert-Smoke ($remoteDerivedProcessed -le $remoteDerivedAccepted) "processed derived projection count exceeded accepted count"
  Assert-Smoke ($remoteDropped -eq 0) "remote metrics reported dropped MQTT messages"
  Assert-Smoke ($remoteDerivedDropped -eq 0) "remote metrics reported dropped derived projection jobs"
  Assert-Smoke ($remoteDerivedFailures -eq 0) "remote metrics reported failed derived projection jobs"
  Assert-Smoke ($remoteCacheRefreshFailures -eq 0) "remote metrics reported cache refresh failures"
  Assert-Smoke ($remoteStoreWriteFailures -eq 0) "remote metrics reported SQLite write failures"
  Assert-Smoke ($remoteStoreWriteFullErrors -eq 0) "remote metrics reported SQLite full-disk errors"
  Assert-Smoke ($remoteStoreWriteBusyErrors -eq 0) "remote metrics reported exhausted SQLite busy retries"
  Assert-Smoke ($remote -match "MC-CartoLive operator diagnostic") "mc-diagnose did not produce a diagnostic report"
  $diagnosticStart = $remote.IndexOf("MC-CartoLive operator diagnostic")
  $diagnosticText = $remote.Substring($diagnosticStart)
  Assert-Smoke (-not ($diagnosticText -match "\b[0-9A-Fa-f]{64}\b")) "mc-diagnose output included a raw 64-character hex identifier"
  Write-Pass "remote container healthy; MQTT accepted=$remoteAccepted processed=$remoteProcessed queue=$remoteQueueDepth; derived accepted=$remoteDerivedAccepted processed=$remoteDerivedProcessed failures=$remoteDerivedFailures; mc-diagnose ran for $DiagnoseRegion"

  $summary = [ordered]@{
    baseUrl = $BaseUrl
    version = $health.version
    gitSha = $health.gitSha
    buildTime = $health.buildTime
    packets = $state.stats.packets
    nodes = $state.stats.activeNodes
    routes = $state.stats.activeRoutes
    datasetState = $ready.datasetState
    storagePressureState = $ready.storagePressureState
    mqttSessionReady = $ready.mqttSessionReady
    historyEvents = $history.window.count
    packetPaths = $packets.window.count
    chatMessages = $chat.window.count
    websocketType = $hello.type
    remoteMetrics = [ordered]@{
      accepted = $remoteAccepted
      processed = $remoteProcessed
      dropped = $remoteDropped
      queueDepth = $remoteQueueDepth
      derivedAccepted = $remoteDerivedAccepted
      derivedProcessed = $remoteDerivedProcessed
      derivedDropped = $remoteDerivedDropped
      derivedFailures = $remoteDerivedFailures
      cacheRefreshFailures = $remoteCacheRefreshFailures
      storeWriteFailures = $remoteStoreWriteFailures
      storeWriteFullErrors = $remoteStoreWriteFullErrors
      storeWriteBusyErrors = $remoteStoreWriteBusyErrors
    }
    remoteTarget = $SshTarget
    diagnoseRegion = $DiagnoseRegion
  }
  $summary | ConvertTo-Json -Depth 4
  Write-Pass "live smoke complete"
}
finally {
  Pop-Location
}
