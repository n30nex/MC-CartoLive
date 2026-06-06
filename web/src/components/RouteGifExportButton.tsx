import { Download, Loader2, Sparkles } from 'lucide-react';
import { packetEndpointSummary } from '../packets';
import type { PublicPacketPath } from '../types';

export type RouteGifExportStatus = 'idle' | 'rendering' | 'done' | 'error';

interface RouteGifExportButtonProps {
  packet: PublicPacketPath | null;
  status: RouteGifExportStatus;
  progress: number;
  onExport: () => void;
}

export default function RouteGifExportButton({ packet, status, progress, onExport }: RouteGifExportButtonProps) {
  if (!packet) return null;
  const rendering = status === 'rendering';
  const label = rendering ? `Rendering ${Math.round(progress * 100)}%` : status === 'done' ? 'GIF downloaded' : status === 'error' ? 'Export failed' : 'Export as GIF';
  return (
    <div className={`route-gif-export ${status}`} role="status" aria-live="polite">
      <button
        className="route-gif-export-button"
        type="button"
        disabled={rendering}
        title={`Export ${packetEndpointSummary(packet)} as a shareable animated GIF`}
        onClick={onExport}
      >
        {rendering ? <Loader2 size={17} className="route-gif-spinner" /> : status === 'done' ? <Download size={17} /> : <Sparkles size={17} />}
        <span>{label}</span>
      </button>
      <div className="route-gif-export-detail">
        <span>{packetEndpointSummary(packet)}</span>
        {rendering && <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />}
      </div>
    </div>
  );
}
