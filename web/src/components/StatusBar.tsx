import type { CSSProperties } from 'react';
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
      <div className="status-pill packets-total" title={`${(stats?.packets ?? 0).toLocaleString()} packets total`}>
        <Database size={15} />
        <span>{formatPacketsTotal(stats?.packets)}</span>
      </div>
      <div className="status-pill pulse-rate" title={`${coverage.receivedPerMinute} packets received per minute`}>
        <Zap size={15} />
        <span>{coverage.receivedPerMinute}/min rx</span>
      </div>
      <div className="status-pill route routed-rate" title={`${coverage.routeAnimatedPerMinute} routed packet comets per minute`}>
        <Route size={15} />
        <span>{coverage.routeAnimatedPerMinute}/min routed</span>
      </div>
      <div className="status-pill observer" title={`${coverage.observerBurstPerMinute} observer bursts per minute`}>
        <Sparkles size={15} />
        <span>{coverage.observerBurstPerMinute}/min bursts</span>
      </div>
      <div className="status-pill unmapped" title={`${coverage.unmappedPerMinute} unresolved packets per minute`}>
        <MapPin size={15} />
        <span>{coverage.unmappedPerMinute}/min unresolved</span>
      </div>
      <div className="status-pill node-count" title={`${nodeCount.toLocaleString()} positioned public nodes`}>
        <Shield size={15} />
        <span>{nodeCount.toLocaleString()} nodes</span>
      </div>
      <div className="status-pill route route-count" title={`${routeCount.toLocaleString()} public routes`}>
        <Route size={15} />
        <span>{routeCount.toLocaleString()} routes</span>
      </div>
    </header>
  );
}
