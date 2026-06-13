import { memo, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, RadioTower, Router, WifiOff } from 'lucide-react';
import { fetchPublicNOC } from '../api';
import type { PublicNOCResponse } from '../types';

export default memo(function NocSummary() {
  const [noc, setNoc] = useState<PublicNOCResponse | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const refresh = () => {
      fetchPublicNOC()
        .then((next) => {
          if (active) setNoc(next);
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) timer = window.setTimeout(refresh, 30_000);
        });
    };
    refresh();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (!noc) return null;
  const online = noc.observerStateCounts.online ?? 0;
  const stale = noc.observerStateCounts.stale ?? 0;
  const offline = noc.observerStateCounts.offline ?? 0;
  const health = noc.mqttConnected && noc.publicCacheReady ? 'live' : 'degraded';

  return (
    <section className="noc-summary" aria-label="Network operations summary" data-health={health}>
      <NocMetric icon={<Activity size={15} />} label="pkts" value={formatCompact(noc.packets)} />
      <NocMetric icon={<Router size={15} />} label="routes" value={formatCompact(noc.activeRoutes)} />
      <NocMetric icon={<RadioTower size={15} />} label="obs" value={`${online}/${stale}/${offline}`} />
      <NocMetric icon={<WifiOff size={15} />} label="drops" value={formatCompact(noc.wsDroppedMessages)} />
    </section>
  );
});

function NocMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="noc-summary-metric">
      {icon}
      <span className="noc-summary-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.max(0, Math.round(value)));
}
