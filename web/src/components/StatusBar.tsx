import type { CSSProperties, ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { CloudSun, Database, MapPin, Route, Shield, Sparkles, Sun, Zap } from 'lucide-react';
import { fetchSolarConditions } from '../api';
import { isAbortError } from '../lib/isAbortError';
import { payloadVisual } from '../payloadVisuals';
import type { LiveCoverageStats } from '../state';
import type { PublicPropagationConditions, PublicStats, SolarConditions } from '../types';
import { formatPacketsTotal, serverStatus } from './statusDisplay';

interface Props {
  stats: PublicStats | null;
  socketStatus: string;
  nodeCount: number;
  routeCount: number;
  coverage: LiveCoverageStats;
  latestPayloadTypeName: string | null;
  latestPacketID: string | null;
  propagationConditions: PublicPropagationConditions | null;
  propagationEventCount: number;
  onOpenPropagation: () => void;
}

export default memo(function StatusBar({ stats, socketStatus, nodeCount, routeCount, coverage, latestPayloadTypeName, latestPacketID, propagationConditions, propagationEventCount, onOpenPropagation }: Props) {
  const status = serverStatus(stats, socketStatus, coverage);
  const latestPayload = payloadVisual(latestPayloadTypeName);
  const perMinuteMax = Math.max(1, coverage.receivedPerMinute, coverage.routeAnimatedPerMinute, coverage.observerBurstPerMinute, coverage.unmappedPerMinute);
  const pulseRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = pulseRef.current;
    if (!el || !latestPacketID) return;
    el.setAttribute('data-pulse', 'active');
    const timer = window.setTimeout(() => el.removeAttribute('data-pulse'), 400);
    return () => window.clearTimeout(timer);
  }, [latestPacketID]);
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
        <span className="packet-type-signal" ref={pulseRef} />
        <span>{latestPayload.shortLabel}</span>
      </div>
      <StatusMetric className="count-pill packets-total" title={`${(stats?.packets ?? 0).toLocaleString()} packets total`} icon={<Database size={14} />} value={formatPacketsTotal(stats?.packets)} label="total" />
      <StatusMetric className="pulse-rate" title={`${coverage.receivedPerMinute} packets received per minute`} icon={<Zap size={14} />} value={formatStatusNumber(coverage.receivedPerMinute)} label="rx/min" meterLevel={metricMeterLevel(coverage.receivedPerMinute, perMinuteMax)} />
      <StatusMetric className="route routed-rate" title={`${coverage.routeAnimatedPerMinute} routed packet comets per minute`} icon={<Route size={14} />} value={formatStatusNumber(coverage.routeAnimatedPerMinute)} label="route/min" meterLevel={metricMeterLevel(coverage.routeAnimatedPerMinute, perMinuteMax)} />
      <StatusMetric className="observer" title={`${coverage.observerBurstPerMinute} observer bursts per minute`} icon={<Sparkles size={14} />} value={formatStatusNumber(coverage.observerBurstPerMinute)} label="bursts/min" meterLevel={metricMeterLevel(coverage.observerBurstPerMinute, perMinuteMax)} />
      <PropagationIndicator conditions={propagationConditions} eventCount={propagationEventCount} onOpen={onOpenPropagation} />
      <span className="status-secondary">
        <StatusMetric className="unmapped" title={`${coverage.unmappedPerMinute} unresolved packets per minute`} icon={<MapPin size={14} />} value={formatStatusNumber(coverage.unmappedPerMinute)} label="unmapped/min" meterLevel={metricMeterLevel(coverage.unmappedPerMinute, perMinuteMax)} />
        <StatusMetric className="count-pill node-count" title={`${nodeCount.toLocaleString()} positioned public nodes`} icon={<Shield size={14} />} value={formatStatusNumber(nodeCount)} label="nodes" />
        <StatusMetric className="route count-pill route-count" title={`${routeCount.toLocaleString()} public routes`} icon={<Route size={14} />} value={formatStatusNumber(routeCount)} label="routes" />
      </span>
      <SolarIndicator />
    </header>
  );
});

function PropagationIndicator({ conditions, eventCount, onOpen }: { conditions: PublicPropagationConditions | null; eventCount: number; onOpen: () => void }) {
  const latest = conditions?.latestEvent;
  const active = eventCount > 0;
  const label = latest?.classification === 'tropo_possible' ? 'tropo' : active ? 'long RF' : 'quiet';
  const title = active
    ? `${eventCount.toLocaleString()} public long-distance propagation event${eventCount === 1 ? '' : 's'}`
    : 'No public long-distance propagation events in the current window';
  return (
    <button type="button" className={`status-pill status-metric propagation-indicator ${active ? 'active' : 'quiet'}`} title={title} onClick={onOpen}>
      <CloudSun size={14} />
      <span className="status-pill-text">
        <span className="status-pill-value">{formatStatusNumber(eventCount)}</span>
        <span className="status-pill-label">{label}</span>
      </span>
    </button>
  );
}

function SolarIndicator() {
  const [solar, setSolar] = useState<SolarConditions | null>(null);
  const [error, setError] = useState(false);
  const failCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSolar = useCallback(() => {
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fetchSolarConditions(controller.signal)
      .then((s) => {
        if (controller.signal.aborted) return;
        setSolar(s);
        setError(false);
        failCountRef.current = 0;
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        if (controller.signal.aborted) return;
        setError(true);
        failCountRef.current += 1;
        const backoff = Math.min(60_000 * Math.pow(2, failCountRef.current - 1), 300_000);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(fetchSolar, backoff);
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const cancel = fetchSolar();
    const interval = setInterval(fetchSolar, 300_000);
    return () => {
      cancel();
      clearInterval(interval);
      abortRef.current?.abort();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [fetchSolar]);

  const manualRetry = useCallback(() => {
    setError(false);
    failCountRef.current = 0;
    fetchSolar();
  }, [fetchSolar]);

  if (!solar && !error) return <div className="status-pill status-metric solar-indicator" title="Loading solar conditions..."><Sun size={14} style={{ marginRight: 4, opacity: 0.4 }} /><span style={{ opacity: 0.5 }}>···</span></div>;
  if (error && !solar) return (
    <div className="status-pill status-metric solar-indicator warn" title="Solar data unavailable — click to retry">
      <Sun size={14} style={{ marginRight: 4, opacity: 0.5 }} />
      <button type="button" className="solar-retry" onClick={manualRetry} style={{ color: '#f97316', cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit' }}>N/A</button>
    </div>
  );
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
  return Math.min(1, Math.round((value / maxValue) * 100) / 100);
}
