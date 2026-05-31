import type { CSSProperties, ReactNode } from 'react';
import { Database, MapPin, Route, Shield, Sparkles, Zap } from 'lucide-react';
import { payloadVisual } from '../payloadVisuals';
import type { LiveCoverageStats } from '../state';
import type { PublicStats } from '../types';
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
      <StatusMetric className="packets-total" title={`${(stats?.packets ?? 0).toLocaleString()} packets total`} icon={<Database size={14} />} value={formatPacketsTotal(stats?.packets)} label="total" />
      <StatusMetric className="pulse-rate" title={`${coverage.receivedPerMinute} packets received per minute`} icon={<Zap size={14} />} value={formatStatusNumber(coverage.receivedPerMinute)} label="rx/min" />
      <StatusMetric className="route routed-rate" title={`${coverage.routeAnimatedPerMinute} routed packet comets per minute`} icon={<Route size={14} />} value={formatStatusNumber(coverage.routeAnimatedPerMinute)} label="route/min" />
      <StatusMetric className="observer" title={`${coverage.observerBurstPerMinute} observer bursts per minute`} icon={<Sparkles size={14} />} value={formatStatusNumber(coverage.observerBurstPerMinute)} label="bursts/min" />
      <StatusMetric className="unmapped" title={`${coverage.unmappedPerMinute} unresolved packets per minute`} icon={<MapPin size={14} />} value={formatStatusNumber(coverage.unmappedPerMinute)} label="unmapped/min" />
      <StatusMetric className="node-count" title={`${nodeCount.toLocaleString()} positioned public nodes`} icon={<Shield size={14} />} value={formatStatusNumber(nodeCount)} label="nodes" />
      <StatusMetric className="route route-count" title={`${routeCount.toLocaleString()} public routes`} icon={<Route size={14} />} value={formatStatusNumber(routeCount)} label="routes" />
    </header>
  );
}

function StatusMetric({ className, title, icon, value, label }: { className: string; title: string; icon: ReactNode; value: string; label: string }) {
  return (
    <div className={`status-pill status-metric ${className}`} title={title} aria-label={`${value} ${label}`}>
      {icon}
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
