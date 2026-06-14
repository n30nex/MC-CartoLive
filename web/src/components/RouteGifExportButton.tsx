import { Download, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { packetEndpointSummary } from '../packets';
import type { PublicPacketPath } from '../types';
import { LoadingSpinner } from './LoadingPrimitives';

export type RouteGifExportStatus = 'idle' | 'rendering' | 'done' | 'error';

interface RouteGifExportButtonProps {
  packet: PublicPacketPath | null;
  status: RouteGifExportStatus;
  progress: number;
  cooldownUntil: number;
  remainingExports: number;
  onExport: () => void;
}

export default function RouteGifExportButton({ packet, status, progress, cooldownUntil, remainingExports, onExport }: RouteGifExportButtonProps) {
  const [cooldownLeft, setCooldownLeft] = useState(0);
  useEffect(() => {
    if (cooldownUntil <= Date.now()) { setCooldownLeft(0); return; }
    setCooldownLeft(Math.ceil((cooldownUntil - Date.now()) / 1000));
    const iv = setInterval(() => {
      const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (left <= 0) { setCooldownLeft(0); clearInterval(iv); return; }
      setCooldownLeft(left);
    }, 1000);
    return () => clearInterval(iv);
  }, [cooldownUntil]);

  if (!packet) return null;
  const rendering = status === 'rendering';
  const limited = remainingExports <= 0 && cooldownUntil > Date.now();
  const cooling = cooldownLeft > 0 && !limited;
  let label = rendering ? `Rendering ${Math.round(progress * 100)}%` : status === 'done' ? 'GIF downloaded' : status === 'error' ? 'Export failed' : 'Export as GIF';
  if (limited) label = `Limit reached (${remainingExports} left)`;
  else if (cooling) label = `Cooldown ${cooldownLeft}s`;
  const disabled = rendering || cooling || limited;
  return (
    <div className={`route-gif-export ${status}`} role="status" aria-live="polite">
      <button
        className="route-gif-export-button"
        type="button"
        disabled={disabled}
        title={`Export ${packetEndpointSummary(packet)} as a shareable animated GIF${cooling ? ` — wait ${cooldownLeft}s` : ''}${limited ? ' — limit reached' : ''}`}
        onClick={onExport}
      >
        {rendering ? <LoadingSpinner size="sm" decorative className="route-gif-spinner" /> : status === 'done' ? <Download size={17} /> : <Sparkles size={17} />}
        <span>{label}</span>
      </button>
      <div className="route-gif-export-detail">
        <span>{packetEndpointSummary(packet)}</span>
        {!rendering && remainingExports > 0 && <small style={{ opacity: 0.6, marginLeft: 6 }}>{remainingExports} left</small>}
        {rendering && <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />}
      </div>
    </div>
  );
}
