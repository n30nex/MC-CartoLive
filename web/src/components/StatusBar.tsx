import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Database, MapPin, Route, Shield, Sparkles, Sun, Zap } from 'lucide-react';
import { fetchSolarConditions } from '../api';
import { payloadVisual } from '../payloadVisuals';
import type { LiveCoverageStats } from '../state';
import type { PublicStats, SolarConditions } from '../types';
import { formatPacketsTotal, serverStatus } from './statusDisplay';

interface Props {
  stats: PublicStats | null;
  socketStatus: string;
  nodeCount: number;
  routeCount: number;
  coverage: LiveCoverageStats;
  latestPayloadTypeName: string | null;
  latestPacketID: string | null;
}

export default function StatusBar({ stats, socketStatus, nodeCount, routeCount, coverage, latestPayloadTypeName, latestPacketID }: Props) {
  const status = serverStatus(stats, socketStatus, coverage);
  const latestPayload = payloadVisual(latestPayloadTypeName);
  const perMinuteMax = Math.max(1, coverage.receivedPerMinute, coverage.routeAnimatedPerMinute, coverage.observerBurstPerMinute, coverage.unmappedPerMinute);
  return (
    <header className="status-bar">
      <div className={`status-pill server-status ${status.live ? 'good' : 'warn'}`}>
        <span className={`server-signal ${status.live ? 'live' : 'stale'}`} />
        <span>{status.label}</span>
      </div>
      <div
        className="status-pill payload-signal-pill"
        style={{ '--payload-color': latestPayload.color } as CSSProperties}
        title={`Last packet type: ${latestPayload.label}`}
      >
        <span className="packet-type-signal" key={latestPacketID ?? latestPayloadTypeName ?? 'none'} />
        <span>{latestPayload.shortLabel}</span>
      </div>
      <StatusMetric className="count-pill packets-total" title={`${(stats?.packets ?? 0).toLocaleString()} packets total`} icon={<Database size={14} />} value={formatPacketsTotal(stats?.packets)} label="total" />
      <StatusMetric className="pulse-rate" title={`${coverage.receivedPerMinute} packets received per minute`} icon={<Zap size={14} />} value={formatStatusNumber(coverage.receivedPerMinute)} label="rx/min" meterLevel={metricMeterLevel(coverage.receivedPerMinute, perMinuteMax)} />
      <StatusMetric className="route routed-rate" title={`${coverage.routeAnimatedPerMinute} routed packet comets per minute`} icon={<Route size={14} />} value={formatStatusNumber(coverage.routeAnimatedPerMinute)} label="route/min" meterLevel={metricMeterLevel(coverage.routeAnimatedPerMinute, perMinuteMax)} />
      <StatusMetric className="observer" title={`${coverage.observerBurstPerMinute} observer bursts per minute`} icon={<Sparkles size={14} />} value={formatStatusNumber(coverage.observerBurstPerMinute)} label="bursts/min" meterLevel={metricMeterLevel(coverage.observerBurstPerMinute, perMinuteMax)} />
      <StatusMetric className="unmapped" title={`${coverage.unmappedPerMinute} unresolved packets per minute`} icon={<MapPin size={14} />} value={formatStatusNumber(coverage.unmappedPerMinute)} label="unmapped/min" meterLevel={metricMeterLevel(coverage.unmappedPerMinute, perMinuteMax)} />
      <StatusMetric className="count-pill node-count" title={`${nodeCount.toLocaleString()} positioned public nodes`} icon={<Shield size={14} />} value={formatStatusNumber(nodeCount)} label="nodes" />
      <StatusMetric className="route count-pill route-count" title={`${routeCount.toLocaleString()} public routes`} icon={<Route size={14} />} value={formatStatusNumber(routeCount)} label="routes" />
      <SolarIndicator />
    </header>
  );
}

function SolarIndicator() {
  const [solar, setSolar] = useState<SolarConditions | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const fetch = () => {
      fetchSolarConditions()
        .then(s => { if (active) { setSolar(s); setError(false); } })
        .catch(() => { if (active) setError(true); });
    };
    fetch(); const iv = setInterval(fetch, 300_000);
    return () => { active = false; clearInterval(iv); };
  }, []);
  if (!solar && !error) return <div className="status-pill status-metric solar-indicator" title="Loading solar conditions..."><Sun size={14} style={{ marginRight: 4, opacity: 0.4 }} /><span style={{ opacity: 0.5 }}>···</span></div>;
  if (error && !solar) return <div className="status-pill status-metric solar-indicator warn" title="Solar data unavailable"><Sun size={14} style={{ marginRight: 4, opacity: 0.5 }} /><span style={{ color: '#f97316' }}>N/A</span></div>;
  if (!solar) return null;
  const kp = solar.kpIndex;
  const kpColor = kp >= 5 ? '#ef4444' : kp >= 4 ? '#f97316' : '#22c55e';
  const title = `Solar: Kp ${kp.toFixed(1)} (${solar.kpLabel}), F10.7 ${solar.solarFluxSfu.toFixed(0)} SFU (${solar.solarFluxLabel})`;
  return (
    <div className="status-pill status-metric solar-indicator" title={title} aria-label={title}>
      <Sun size={14} style={{ marginRight: 4 }} />
      <span style={{ color: kpColor, fontWeight: 600 }}>Kp{kp.toFixed(1)}</span>
      <span style={{ margin: '0 4px', opacity: 0.5 }}>·</span>
      <span>F{solar.solarFluxSfu.toFixed(0)}</span>
    </div>
  );
}

function StatusMetric({ className, title, icon, value, label, meterLevel }: { className: string; title: string; icon: ReactNode; value: string; label: string; meterLevel?: number }) {
  return (
    <div className={`status-pill status-metric ${meterLevel !== undefined ? 'has-vu ' : ''}${className}`} title={title} aria-label={`${value} ${label}`}>
      {icon}
      {meterLevel !== undefined && <span className="status-vu" aria-hidden="true" style={{ '--vu-level': meterLevel } as CSSProperties} />}
      <span className="status-pill-text">
        <span className="status-pill-value">{value}</span>
        <span className="status-pill-label">{label}</span>
      </span>
    </div>
  );
}

export function formatStatusNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  if (absolute >= 10_000) return `${Math.round(value / 1_000)}k`;
  return value.toLocaleString();
}

export function metricMeterLevel(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || value <= 0 || maxValue <= 0) return 0;
  return Math.max(0.08, Math.min(1, Math.round((value / maxValue) * 100) / 100));
}
