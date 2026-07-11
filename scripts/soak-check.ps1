param(
  [string]$BaseUrl = "https://carto.canadaverse.org",
  [string]$MetricsUrl = "http://127.0.0.1:39090/metrics",
  [int]$DurationMinutes = 60,
  [int]$IntervalSeconds = 60,
  [int]$MaxBadSamples = 3,
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutFile = Join-Path (Get-Location) "mc-cartolive-soak-$stamp.ndjson"
}

$deadline = (Get-Date).AddMinutes($DurationMinutes)
$badSamples = 0
$sample = 0
$lastPackets = $null
$lastLatestSeq = $null
$firstLatestSeq = $null
$firstAccepted = $null
$firstProcessed = $null
$firstDerivedAccepted = $null
$firstDerivedProcessed = $null
$lastAccepted = $null
$lastProcessed = $null
$lastDerivedAccepted = $null
$lastDerivedProcessed = $null
$probeScript = Join-Path $PSScriptRoot "websocket-flow-probe.mjs"
$probeResult = [IO.Path]::GetTempFileName()
$probeTimeoutMs = [Math]::Max(1000, $DurationMinutes * 60 * 1000)
$probe = Start-Process -FilePath "node" -ArgumentList @($probeScript, $BaseUrl, "--origin", $BaseUrl, "--timeout-ms", "$probeTimeoutMs", "--output", $probeResult) -NoNewWindow -PassThru

try {
while ((Get-Date) -lt $deadline) {
  $sample += 1
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $from = $now - 600000
  $ok = $true
  $errorText = ""

  try {
    $health = Invoke-RestMethod "$BaseUrl/healthz"
    $ready = Invoke-RestMethod "$BaseUrl/readyz"
    $state = Invoke-RestMethod "$BaseUrl/api/v1/public/state"
    $history = Invoke-RestMethod "$BaseUrl/api/v1/public/history?from=$from&to=$now&limit=25"
    $metrics = (Invoke-WebRequest -UseBasicParsing $MetricsUrl).Content
    $acceptedMatch = [regex]::Match($metrics, '(?m)^meshcore_mqtt_messages_accepted_total\s+([0-9]+)$')
    $processedMatch = [regex]::Match($metrics, '(?m)^meshcore_mqtt_messages_processed_total\s+([0-9]+)$')
    $derivedAcceptedMatch = [regex]::Match($metrics, '(?m)^meshcore_derived_accepted_total\s+([0-9]+)$')
    $derivedProcessedMatch = [regex]::Match($metrics, '(?m)^meshcore_derived_processed_total\s+([0-9]+)$')
    $droppedMatch = [regex]::Match($metrics, '(?m)^meshcore_mqtt_messages_dropped_total\s+([0-9]+)$')
    $derivedDroppedMatch = [regex]::Match($metrics, '(?m)^meshcore_derived_dropped_total\s+([0-9]+)$')
    $derivedFailuresMatch = [regex]::Match($metrics, '(?m)^meshcore_derived_failures_total\s+([0-9]+)$')
    $cacheFailuresMatch = [regex]::Match($metrics, '(?m)^meshcore_cache_refresh_failures_total\s+([0-9]+)$')
    $storeFailuresMatch = [regex]::Match($metrics, '(?m)^meshcore_store_write_failures_total\s+([0-9]+)$')
    $storeFullMatch = [regex]::Match($metrics, '(?m)^meshcore_store_write_full_errors_total\s+([0-9]+)$')
    $storeBusyMatch = [regex]::Match($metrics, '(?m)^meshcore_store_write_busy_errors_total\s+([0-9]+)$')
    if (-not $acceptedMatch.Success -or -not $processedMatch.Success -or -not $derivedAcceptedMatch.Success -or -not $derivedProcessedMatch.Success -or -not $droppedMatch.Success -or -not $derivedDroppedMatch.Success -or -not $derivedFailuresMatch.Success -or -not $cacheFailuresMatch.Success -or -not $storeFailuresMatch.Success -or -not $storeFullMatch.Success -or -not $storeBusyMatch.Success) { throw "loopback MQTT/derived/store counters were missing" }
    $accepted = [long]$acceptedMatch.Groups[1].Value
    $processed = [long]$processedMatch.Groups[1].Value
    $derivedAccepted = [long]$derivedAcceptedMatch.Groups[1].Value
    $derivedProcessed = [long]$derivedProcessedMatch.Groups[1].Value
    $dropped = [long]$droppedMatch.Groups[1].Value
    $derivedDropped = [long]$derivedDroppedMatch.Groups[1].Value
    $derivedFailures = [long]$derivedFailuresMatch.Groups[1].Value
    $cacheFailures = [long]$cacheFailuresMatch.Groups[1].Value
    $storeFailures = [long]$storeFailuresMatch.Groups[1].Value
    $storeFull = [long]$storeFullMatch.Groups[1].Value
    $storeBusy = [long]$storeBusyMatch.Groups[1].Value
    if ($processed -gt $accepted -or $derivedProcessed -gt $derivedAccepted -or $dropped -ne 0 -or $derivedDropped -ne 0 -or $derivedFailures -ne 0 -or $cacheFailures -ne 0 -or $storeFailures -ne 0 -or $storeFull -ne 0 -or $storeBusy -ne 0) { $ok = $false }

    if (-not $health.ok -or -not $ready.ready) { $ok = $false }
    if (-not $ready.mqttSessionReady) { $ok = $false }
    if ($ready.storagePressureState -eq "critical") { $ok = $false }
    if (@("fresh_start", "warming", "live") -notcontains ([string]$ready.datasetState)) { $ok = $false }
    if ($null -ne $lastPackets -and $state.stats.packets -lt $lastPackets) { $ok = $false }
    $lastPackets = $state.stats.packets
    $latestSeq = 0
    if ($null -ne $state.stats.latestSeq) { $latestSeq = [long]$state.stats.latestSeq }
    if ($null -ne $lastLatestSeq -and $latestSeq -lt $lastLatestSeq) { $ok = $false }
    $lastLatestSeq = $latestSeq
    if ($null -ne $lastAccepted -and $accepted -lt $lastAccepted) { $ok = $false }
    if ($null -ne $lastProcessed -and $processed -lt $lastProcessed) { $ok = $false }
    if ($null -ne $lastDerivedAccepted -and $derivedAccepted -lt $lastDerivedAccepted) { $ok = $false }
    if ($null -ne $lastDerivedProcessed -and $derivedProcessed -lt $lastDerivedProcessed) { $ok = $false }
    if ($null -eq $firstLatestSeq) { $firstLatestSeq = $latestSeq }
    if ($null -eq $firstAccepted) {
      $firstAccepted = $accepted
      $firstProcessed = $processed
      $firstDerivedAccepted = $derivedAccepted
      $firstDerivedProcessed = $derivedProcessed
    }
    $lastAccepted = $accepted
    $lastProcessed = $processed
    $lastDerivedAccepted = $derivedAccepted
    $lastDerivedProcessed = $derivedProcessed

    $record = [PSCustomObject]@{
      at = (Get-Date).ToUniversalTime().ToString("o")
      sample = $sample
      ok = $ok
      version = $health.version
      gitSha = $health.gitSha
      packets = $state.stats.packets
      nodes = $state.stats.activeNodes
      routes = $state.stats.activeRoutes
      latestSeq = $latestSeq
      mqttAccepted = $accepted
      mqttProcessed = $processed
      derivedAccepted = $derivedAccepted
      derivedProcessed = $derivedProcessed
      mqttDropped = $dropped
      derivedDropped = $derivedDropped
      derivedFailures = $derivedFailures
      cacheRefreshFailures = $cacheFailures
      storeWriteFailures = $storeFailures
      storeWriteFullErrors = $storeFull
      storeWriteBusyErrors = $storeBusy
      datasetState = $ready.datasetState
      mqttSessionReady = $ready.mqttSessionReady
      storagePressureState = $ready.storagePressureState
      historyEvents = $history.window.count
    }
  }
  catch {
    $ok = $false
    $errorText = $_.Exception.Message
    $record = [PSCustomObject]@{
      at = (Get-Date).ToUniversalTime().ToString("o")
      sample = $sample
      ok = $false
      error = $errorText
    }
  }

  $record | ConvertTo-Json -Compress | Add-Content -Encoding utf8 $OutFile
  if ($ok) {
    $badSamples = 0
  } else {
    $badSamples += 1
    if ($badSamples -ge $MaxBadSamples) {
      throw "Soak failed after $badSamples consecutive bad samples. Last error: $errorText. Output: $OutFile"
    }
  }

  Write-Host ("sample {0}: ok={1} packets={2} latestSeq={3} dataset={4} storage={5}" -f $sample, $ok, $record.packets, $record.latestSeq, $record.datasetState, $record.storagePressureState)
  Start-Sleep -Seconds $IntervalSeconds
}

if (-not $probe.WaitForExit(5000)) { $probe.Kill(); $probe.WaitForExit() }
if ($null -eq $firstAccepted -or $null -eq $lastAccepted) { throw "Soak failed: MQTT evidence was incomplete" }
$probeEvidence = Get-Content $probeResult -Raw | ConvertFrom-Json
if ($probe.ExitCode -ne 0 -or $null -eq $probeEvidence.helloSeq) { throw "Soak failed: WebSocket hello was not sustained during the interval" }
if ($lastAccepted -gt $firstAccepted) {
  if ($lastProcessed -le $firstProcessed) { throw "Soak failed: processed MQTT traffic did not advance" }
  if ($lastDerivedAccepted -le $firstDerivedAccepted) { throw "Soak failed: accepted derived projection work did not advance" }
  if ($lastDerivedProcessed -le $firstDerivedProcessed) { throw "Soak failed: processed derived projection work did not advance" }
  if ($lastLatestSeq -le $firstLatestSeq) { throw "Soak failed: public latestSeq did not advance with active traffic" }
  if (-not [bool]$probeEvidence.eventReceived) { throw "Soak failed: no live WebSocket event was received while MQTT advanced" }
  Write-Host "soak check complete: active MQTT/derived/public/WebSocket flow proven; output: $OutFile"
}
elseif ($lastAccepted -eq $firstAccepted) {
  Write-Host "soak check complete: healthy quiet interval (no MQTT acceptance change); output: $OutFile"
}
else {
  throw "Soak failed: MQTT acceptance counter moved backwards"
}
}
finally {
  if (-not $probe.HasExited) { $probe.Kill() }
  Remove-Item -LiteralPath $probeResult -Force -ErrorAction SilentlyContinue
}
