import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MonitorSmartphone, Radio, RefreshCw, Route, Server, X } from 'lucide-react';
import { fetchHealthz, fetchPublicState, fetchReadyz } from '../api';
import type { PublicLiveState, RuntimeHealth } from '../types';

interface PerfPanelProps {
  onClose: () => void;
}

type EndpointKey = 'health' | 'ready' | 'state';
type PerfTone = 'good' | 'warn' | 'bad' | 'quiet';

interface EndpointStatus {
  ok: boolean;
  label: string;
  error?: string;
}

interface PerfSnapshot {
  health: RuntimeHealth | null;
  ready: RuntimeHealth | null;
  state: PublicLiveState | null;
  endpoints: Record<EndpointKey, EndpointStatus>;
  checkedAt: number;
}

const ENDPOINT_LABELS: Record<EndpointKey, string> = {
  health: '/healthz',
  ready: '/readyz',
  state: '/api/v1/public/state'
};

const ENDPOINT_COUNT = Object.keys(ENDPOINT_LABELS).length;

const EMPTY_ENDPOINTS = Object.fromEntries(
  (Object.keys(ENDPOINT_LABELS) as EndpointKey[]).map((key) => [key, { ok: false, label: ENDPOINT_LABELS[key] } satisfies EndpointStatus])
) as Record<EndpointKey, EndpointStatus>;

export default function PerfPanel({ onClose }: PerfPanelProps) {
  const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestIDRef = useRef(0);

  const refresh = useCallback(() => {
    const requestID = requestIDRef.current + 1;
    requestIDRef.current = requestID;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      fetchHealthz(),
      fetchReadyz(),
      fetchPublicState()
    ])
      .then(([healthResult, readyResult, stateResult]) => {
        if (!mountedRef.current || requestID !== requestIDRef.current) return;
        const endpoints = {
          health: endpointFromResult('health', healthResult),
          ready: endpointFromResult('ready', readyResult),
          state: endpointFromResult('state', stateResult)
        };
        const online = countOnline(endpoints);
        setSnapshot({
          health: settledValue(healthResult),
          ready: settledValue(readyResult),
          state: settledValue(stateResult),
          endpoints,
          checkedAt: Date.now()
        });
        setError(online === 0 ? 'Public status APIs are unreachable from this browser.' : null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || requestID !== requestIDRef.current) return;
        setError(err instanceof Error ? err.message : 'Unable to refresh live status');
      })
      .finally(() => {
        if (mountedRef.current && requestID === requestIDRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const refreshInterval = window.setInterval(refresh, 5000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(refreshInterval);
    };
  }, [refresh]);

  const health = snapshot?.health ?? null;
  const ready = snapshot?.ready ?? null;
  const state = snapshot?.state ?? null;
  const endpoints = snapshot?.endpoints ?? EMPTY_ENDPOINTS;
  const apiOnline = countOnline(endpoints);
  const lastChecked = useMemo(() => snapshot ? new Date(snapshot.checkedAt).toLocaleTimeString() : 'checking', [snapshot]);
  const systemStatus = systemSummary(snapshot);
  const backendStatus = backendSummary(endpoints, ready, health);
  const frontendStatus = frontendSummary(endpoints, health);
  const mqttStatus = mqttSummary(health);
  const routeStatus = liveRouteSummary(health);

  return (
    <section className="perf-panel perf-live-panel" aria-label="Live deployment status">
      <header className="perf-panel-header">
        <div>
          <span className="panel-eyebrow">Live Status</span>
          <h2>Is the system live?</h2>
          <p>{lastChecked}</p>
        </div>
        <div className="perf-panel-actions">
          <button type="button" className="icon-button" title="Refresh live status" onClick={refresh}>
            <RefreshCw size={17} />
          </button>
          <button type="button" className="icon-button" title="Close live status" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>

      <div className={`perf-live-hero perf-${systemStatus.tone}`}>
        <span>System</span>
        <strong>{systemStatus.value}</strong>
      </div>

      {error && <div className="perf-error" role="alert">{error}</div>}
      {loading && !snapshot && <div className="perf-loading">Checking live status...</div>}

      <div className="perf-grid perf-live-grid">
        <PerfLiveCard icon={<Server size={18} />} label="Backend" status={backendStatus.value} tone={backendStatus.tone}>
          <PerfMetric label="Ready" value={formatReady(ready?.ready)} tone={readyTone(ready?.ready)} />
          <PerfMetric label="DB" value={formatReady(health?.dbReady)} tone={readyTone(health?.dbReady)} />
          <PerfMetric label="Cache" value={formatAge(health?.cacheAgeMs)} tone={freshnessTone(health?.cacheAgeMs, 60_000)} />
        </PerfLiveCard>

        <PerfLiveCard icon={<MonitorSmartphone size={18} />} label="Frontend" status={frontendStatus.value} tone={frontendStatus.tone}>
          <PerfMetric label="App" value={health?.staticReady === false ? 'static issue' : 'loaded'} tone={health?.staticReady === false ? 'bad' : 'good'} />
          <PerfMetric label="State API" value={endpointValue(endpoints.state)} tone={endpointTone(endpoints.state)} title={endpoints.state.error} />
          <PerfMetric label="Public API" value={snapshot ? `${apiOnline}/${ENDPOINT_COUNT}` : 'checking'} tone={snapshot ? reachabilityTone(apiOnline, ENDPOINT_COUNT) : 'quiet'} />
        </PerfLiveCard>

        <PerfLiveCard icon={<Radio size={18} />} label="MQTT" status={mqttStatus.value} tone={mqttStatus.tone}>
          <PerfMetric label="Connection" value={health?.mqttConnected ? 'connected' : health?.mqttConnected === false ? 'offline' : 'unknown'} tone={health?.mqttConnected ? 'good' : health?.mqttConnected === false ? 'bad' : 'quiet'} />
          <PerfMetric label="Last packet" value={formatAge(health?.mqttLastMessageAgeMs)} tone={freshnessTone(health?.mqttLastMessageAgeMs, 60_000)} />
          <PerfMetric label="Drops" value={formatCount(health?.mqttDroppedMessages)} tone={(health?.mqttDroppedMessages ?? 0) > 0 ? 'warn' : undefined} />
        </PerfLiveCard>

        <PerfLiveCard icon={<Route size={18} />} label="Live routes" status={routeStatus.value} tone={routeStatus.tone}>
          <PerfMetric label="Route motion" value={health?.routeMotionState ?? 'unknown'} tone={toneForState(health?.routeMotionState)} />
          <PerfMetric label="Route pulse" value={formatAge(health?.recentRoutePulseAgeMs)} tone={freshnessTone(health?.recentRoutePulseAgeMs, 60_000)} />
          <PerfMetric label="Routes" value={formatCount(state?.stats.activeRoutes ?? health?.edgeEvents)} />
        </PerfLiveCard>
      </div>

      <p className="perf-note">
        Public-safe live checks only.
      </p>
    </section>
  );
}

function PerfLiveCard({
  icon,
  label,
  status,
  tone,
  children
}: {
  icon: ReactNode;
  label: string;
  status: string;
  tone: PerfTone;
  children: ReactNode;
}) {
  return (
    <section className={`perf-card perf-live-card perf-${tone}`}>
      <h3>{icon}<span>{label}</span></h3>
      <strong className="perf-live-card-status">{status}</strong>
      <div className="perf-metrics">{children}</div>
    </section>
  );
}

function PerfMetric({ label, value, tone, title }: { label: string; value: string; tone?: PerfTone; title?: string }) {
  return (
    <div className={`perf-metric ${tone ? `perf-${tone}` : ''}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function toneForState(state: string | undefined): PerfTone {
  switch ((state ?? '').toLowerCase()) {
    case 'fresh':
    case 'moving':
    case 'ready':
    case 'live':
      return 'good';
    case 'quiet':
    case 'unknown':
      return 'quiet';
    case 'stale':
    case 'lagged':
    case 'warming':
      return 'warn';
    case 'degraded':
    case 'error':
    case 'down':
    case 'offline':
      return 'bad';
    default:
      return 'quiet';
  }
}

export function freshnessTone(ms: number | undefined, staleAfterMs: number): PerfTone | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  if (ms <= staleAfterMs) return 'good';
  if (ms <= staleAfterMs * 5) return 'warn';
  return 'bad';
}

export function formatAge(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return 'unknown';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)} h`;
}

function endpointFromResult<T>(key: EndpointKey, result: PromiseSettledResult<T>): EndpointStatus {
  if (result.status === 'fulfilled') return { ok: true, label: ENDPOINT_LABELS[key] };
  return { ok: false, label: ENDPOINT_LABELS[key], error: result.reason instanceof Error ? result.reason.message : 'request failed' };
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function countOnline(endpoints: Record<EndpointKey, EndpointStatus>): number {
  return Object.values(endpoints).filter((endpoint) => endpoint.ok).length;
}

function endpointValue(endpoint: EndpointStatus): string {
  return endpoint.ok ? 'online' : 'offline';
}

function endpointTone(endpoint: EndpointStatus): PerfTone {
  return endpoint.ok ? 'good' : 'bad';
}

function reachabilityTone(online: number, total: number): PerfTone {
  if (online === total) return 'good';
  if (online > 0) return 'warn';
  return 'bad';
}

function backendSummary(endpoints: Record<EndpointKey, EndpointStatus>, ready: RuntimeHealth | null, health: RuntimeHealth | null): { value: string; tone: PerfTone } {
  if (ready?.ready && health?.dbReady !== false && health?.publicStateReady !== false) return { value: 'ready', tone: 'good' };
  if (endpoints.health.ok || endpoints.ready.ok) return { value: 'degraded', tone: 'warn' };
  return { value: 'offline', tone: 'bad' };
}

function frontendSummary(endpoints: Record<EndpointKey, EndpointStatus>, health: RuntimeHealth | null): { value: string; tone: PerfTone } {
  if (endpoints.state.ok && health?.staticReady !== false) return { value: 'online', tone: 'good' };
  if (endpoints.health.ok && health?.staticReady === false) return { value: 'static issue', tone: 'warn' };
  if (endpoints.health.ok) return { value: 'degraded', tone: 'warn' };
  return { value: 'offline', tone: 'bad' };
}

function systemSummary(snapshot: PerfSnapshot | null): { value: string; tone: PerfTone } {
  if (!snapshot) return { value: 'checking', tone: 'quiet' };
  return systemSummaryFromHealth(snapshot.health, snapshot.ready, countOnline(snapshot.endpoints), ENDPOINT_COUNT);
}

export function systemSummaryFromHealth(health: RuntimeHealth | null, ready: RuntimeHealth | null, apiOnline: number, apiTotal: number): { value: string; tone: PerfTone } {
  if (apiTotal <= 0 || apiOnline <= 0) return { value: 'offline', tone: 'bad' };
  const backendReady = ready?.ready === true;
  const apiReady = apiOnline >= apiTotal;
  const mqttReady = health?.mqttConnected === true && (freshnessTone(health.mqttLastMessageAgeMs, 60_000) ?? 'good') !== 'bad';
  const routesReady = health?.routeMotionState === 'moving' || health?.routeMotionState === 'fresh' || health?.mapMotionState === 'moving';
  if (backendReady && apiReady && mqttReady && routesReady) return { value: 'live', tone: 'good' };
  if (backendReady || apiOnline > 0) return { value: 'degraded', tone: 'warn' };
  return { value: 'offline', tone: 'bad' };
}

function mqttSummary(health: RuntimeHealth | null): { value: string; tone: PerfTone } {
  if (health?.mqttConnected) {
    const tone = freshnessTone(health.mqttLastMessageAgeMs, 60_000) ?? 'good';
    return { value: tone === 'good' ? 'fresh' : formatAge(health.mqttLastMessageAgeMs), tone };
  }
  if (health?.mqttConnected === false) return { value: 'offline', tone: 'bad' };
  return { value: 'unknown', tone: 'quiet' };
}

function liveRouteSummary(health: RuntimeHealth | null): { value: string; tone: PerfTone } {
  const state = health?.routeMotionState ?? health?.mapMotionState ?? health?.liveConfidenceState;
  return { value: state ?? 'unknown', tone: toneForState(state) };
}

function formatReady(value: boolean | undefined): string {
  if (value === undefined) return 'unknown';
  return value ? 'ready' : 'not ready';
}

function readyTone(value: boolean | undefined): PerfTone | undefined {
  if (value === undefined) return undefined;
  return value ? 'good' : 'warn';
}

function formatCount(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return 'unknown';
  return Math.max(0, Math.floor(value)).toLocaleString();
}
