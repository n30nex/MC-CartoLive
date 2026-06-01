import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Radio, RefreshCw, Server, Signal, UsersRound, X } from 'lucide-react';
import { fetchHealthz, fetchPublicChat, fetchPublicHistory, fetchPublicPackets, fetchPublicState, fetchReadyz } from '../api';
import type { PublicLiveState, RuntimeHealth } from '../types';

interface PerfPanelProps {
  onClose: () => void;
}

type EndpointKey = 'health' | 'ready' | 'state' | 'history' | 'packets' | 'chat';
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
  historyEvents: number | null;
  packetPaths: number | null;
  chatMessages: number | null;
  endpoints: Record<EndpointKey, EndpointStatus>;
  checkedAt: number;
}

const ENDPOINT_LABELS: Record<EndpointKey, string> = {
  health: '/healthz',
  ready: '/readyz',
  state: '/api/v1/public/state',
  history: '/api/v1/public/history',
  packets: '/api/v1/public/packets',
  chat: '/api/v1/public/chat'
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
    const now = Date.now();
    Promise.allSettled([
      fetchHealthz(),
      fetchReadyz(),
      fetchPublicState(),
      fetchPublicHistory({ from: now - 10 * 60_000, to: now, limit: 25 }),
      fetchPublicPackets({ from: now - 10 * 60_000, to: now, limit: 25 }),
      fetchPublicChat({ from: now - 60 * 60_000, to: now, limit: 25 })
    ])
      .then(([healthResult, readyResult, stateResult, historyResult, packetsResult, chatResult]) => {
        if (!mountedRef.current || requestID !== requestIDRef.current) return;
        const endpoints = {
          health: endpointFromResult('health', healthResult),
          ready: endpointFromResult('ready', readyResult),
          state: endpointFromResult('state', stateResult),
          history: endpointFromResult('history', historyResult),
          packets: endpointFromResult('packets', packetsResult),
          chat: endpointFromResult('chat', chatResult)
        };
        const online = countOnline(endpoints);
        setSnapshot({
          health: settledValue(healthResult),
          ready: settledValue(readyResult),
          state: settledValue(stateResult),
          historyEvents: settledValue(historyResult)?.window.count ?? null,
          packetPaths: settledValue(packetsResult)?.window.count ?? null,
          chatMessages: settledValue(chatResult)?.window.count ?? null,
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
  const lastChecked = useMemo(() => snapshot ? new Date(snapshot.checkedAt).toLocaleTimeString() : 'checking', [snapshot]);
  const apiOnline = countOnline(endpoints);
  const systemStatus = systemSummary(snapshot);
  const backendStatus = backendSummary(endpoints, ready);
  const mqttStatus = mqttSummary(health);
  const mapStatus = mapMotionSummary(health);
  const wsStatus = websocketSummary(health, state);
  const packetEndpoint = endpointSummary(endpoints.packets, snapshot?.packetPaths);
  const chatEndpoint = endpointSummary(endpoints.chat, snapshot?.chatMessages);

  return (
    <section className="perf-panel" aria-label="Live deployment status">
      <header className="perf-panel-header">
        <div>
          <span className="panel-eyebrow">Live Status</span>
          <h2>Is the system live?</h2>
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

      <div className="perf-status-strip">
        <PerfStatus label="System" value={systemStatus.value} tone={systemStatus.tone} />
        <PerfStatus label="Backend" value={backendStatus.value} tone={backendStatus.tone} />
        <PerfStatus label="Public API" value={snapshot ? `${apiOnline}/${ENDPOINT_COUNT} online` : 'checking'} tone={snapshot ? reachabilityTone(apiOnline, ENDPOINT_COUNT) : 'quiet'} />
        <PerfStatus label="MQTT ingest" value={mqttStatus.value} tone={mqttStatus.tone} />
        <PerfStatus label="Map motion" value={mapStatus.value} tone={mapStatus.tone} />
        <PerfStatus label="Websocket" value={wsStatus.value} tone={wsStatus.tone} />
        <PerfStatus label="Packets" value={packetEndpoint.value} tone={packetEndpoint.tone} />
        <PerfStatus label="Chat" value={chatEndpoint.value} tone={chatEndpoint.tone} />
      </div>

      {error && <div className="perf-error" role="alert">{error}</div>}
      {loading && !snapshot && <div className="perf-loading">Checking public live status...</div>}

      <div className="perf-grid">
        <PerfSection icon={<Server size={17} />} title="Backend">
          <PerfMetric label="Health endpoint" value={endpointValue(endpoints.health)} tone={endpointTone(endpoints.health)} title={endpoints.health.error} />
          <PerfMetric label="Ready endpoint" value={ready?.ready ? 'ready' : endpointValue(endpoints.ready)} tone={ready?.ready ? 'good' : endpointTone(endpoints.ready)} title={endpoints.ready.error} />
          <PerfMetric label="Database" value={formatReady(health?.dbReady)} tone={readyTone(health?.dbReady)} />
          <PerfMetric label="Public state" value={formatReady(health?.publicStateReady)} tone={readyTone(health?.publicStateReady)} />
          <PerfMetric label="Cache age" value={formatAge(health?.cacheAgeMs)} tone={freshnessTone(health?.cacheAgeMs, 60_000)} />
        </PerfSection>

        <PerfSection icon={<Signal size={17} />} title="Browser / Public API">
          <PerfMetric label="State fetch" value={endpointValue(endpoints.state)} tone={endpointTone(endpoints.state)} title={endpoints.state.error} />
          <PerfMetric label="History fetch" value={endpointValue(endpoints.history)} tone={endpointTone(endpoints.history)} title={endpoints.history.error} />
          <PerfMetric label="Packet endpoint" value={endpointValue(endpoints.packets)} tone={endpointTone(endpoints.packets)} title={endpoints.packets.error} />
          <PerfMetric label="Chat endpoint" value={endpointValue(endpoints.chat)} tone={endpointTone(endpoints.chat)} title={endpoints.chat.error} />
          <PerfMetric label="Last check" value={lastChecked} />
        </PerfSection>

        <PerfSection icon={<Radio size={17} />} title="MQTT Ingest">
          <PerfMetric label="Connection" value={health?.mqttConnected ? 'connected' : health?.mqttConnected === false ? 'offline' : 'unknown'} tone={health?.mqttConnected ? 'good' : health?.mqttConnected === false ? 'bad' : 'quiet'} />
          <PerfMetric label="Message age" value={formatAge(health?.mqttLastMessageAgeMs)} tone={freshnessTone(health?.mqttLastMessageAgeMs, 60_000)} />
          <PerfMetric label="Messages" value={formatCount(health?.mqttMessages ?? state?.stats.mqttMessages)} />
          <PerfMetric label="Reconnects" value={formatCount(health?.mqttReconnects)} />
          <PerfMetric label="Dropped" value={formatCount(health?.mqttDroppedMessages)} />
        </PerfSection>

        <PerfSection icon={<Activity size={17} />} title="Routes / Map Motion">
          <PerfMetric label="Ingest" value={health?.packetIngestState ?? 'unknown'} tone={toneForState(health?.packetIngestState)} />
          <PerfMetric label="Map motion" value={health?.mapMotionState ?? 'unknown'} tone={toneForState(health?.mapMotionState)} />
          <PerfMetric label="Route motion" value={health?.routeMotionState ?? 'unknown'} tone={toneForState(health?.routeMotionState)} />
          <PerfMetric label="Observer motion" value={health?.observerMotionState ?? 'unknown'} tone={toneForState(health?.observerMotionState)} />
          <PerfMetric label="Route pulse age" value={formatAge(health?.recentRoutePulseAgeMs)} tone={freshnessTone(health?.recentRoutePulseAgeMs, 60_000)} />
          <PerfMetric label="Observer age" value={formatAge(health?.recentObserverBurstAgeMs)} tone={freshnessTone(health?.recentObserverBurstAgeMs, 60_000)} />
        </PerfSection>

        <PerfSection icon={<UsersRound size={17} />} title="Clients / Public Data">
          <PerfMetric label="WS clients" value={formatCount(health?.wsClients ?? state?.stats.wsClients)} />
          <PerfMetric label="WS drops" value={formatCount(health?.wsDroppedMessages)} tone={(health?.wsDroppedMessages ?? 0) > 0 ? 'warn' : undefined} />
          <PerfMetric label="Total packets" value={formatCount(state?.stats.packets ?? health?.packets)} />
          <PerfMetric label="Nodes / routes" value={`${formatCount(state?.stats.activeNodes ?? health?.nodesWithPosition)} / ${formatCount(state?.stats.activeRoutes ?? health?.edgeEvents)}`} />
          <PerfMetric label="History sample" value={formatCount(snapshot?.historyEvents)} />
          <PerfMetric label="Packet / chat sample" value={`${formatCount(snapshot?.packetPaths)} / ${formatCount(snapshot?.chatMessages)}`} />
        </PerfSection>
      </div>

      <p className="perf-note">
        Public-safe aggregate checks only.
      </p>
    </section>
  );
}

function PerfSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="perf-card">
      <h3>{icon}<span>{title}</span></h3>
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

function PerfStatus({ label, value, tone }: { label: string; value: string; tone: PerfTone }) {
  return (
    <div className={`perf-status perf-${tone}`}>
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

function backendSummary(endpoints: Record<EndpointKey, EndpointStatus>, ready: RuntimeHealth | null): { value: string; tone: PerfTone } {
  if (ready?.ready) return { value: 'ready', tone: 'good' };
  if (endpoints.ready.ok) return { value: 'not ready', tone: 'warn' };
  if (endpoints.health.ok) return { value: 'health only', tone: 'warn' };
  return { value: 'unreachable', tone: 'bad' };
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
  const publicLive = health?.publicLiveFresh !== false;
  if (backendReady && apiReady && mqttReady && publicLive) return { value: 'live', tone: 'good' };
  if (backendReady || apiOnline > 0) return { value: 'degraded', tone: 'warn' };
  return { value: 'offline', tone: 'bad' };
}

function mqttSummary(health: RuntimeHealth | null): { value: string; tone: PerfTone } {
  if (health?.mqttConnected) {
    return { value: health.mqttLastMessageAgeMs === undefined ? 'connected' : formatAge(health.mqttLastMessageAgeMs), tone: freshnessTone(health.mqttLastMessageAgeMs, 60_000) ?? 'good' };
  }
  if (health?.mqttConnected === false) return { value: 'offline', tone: 'bad' };
  return { value: 'unknown', tone: 'quiet' };
}

function mapMotionSummary(health: RuntimeHealth | null): { value: string; tone: PerfTone } {
  const state = health?.mapMotionState ?? health?.routeMotionState ?? health?.liveConfidenceState;
  return { value: state ?? 'unknown', tone: toneForState(state) };
}

function websocketSummary(health: RuntimeHealth | null, state: PublicLiveState | null): { value: string; tone: PerfTone } {
  const clients = health?.wsClients ?? state?.stats.wsClients;
  if (clients === undefined || !Number.isFinite(clients)) return { value: 'unknown', tone: 'quiet' };
  const drops = health?.wsDroppedMessages ?? 0;
  const count = Math.max(0, Math.floor(clients));
  return { value: `${count.toLocaleString()} ${count === 1 ? 'client' : 'clients'}`, tone: drops > 0 ? 'warn' : count > 0 ? 'good' : 'quiet' };
}

function endpointSummary(endpoint: EndpointStatus, sampleCount: number | null | undefined): { value: string; tone: PerfTone } {
  if (!endpoint.ok) return { value: 'offline', tone: 'bad' };
  if (sampleCount === null || sampleCount === undefined || !Number.isFinite(sampleCount)) return { value: 'online', tone: 'good' };
  const count = Math.max(0, Math.floor(sampleCount));
  return { value: `${count.toLocaleString()} ${count === 1 ? 'sample' : 'samples'}`, tone: 'good' };
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
