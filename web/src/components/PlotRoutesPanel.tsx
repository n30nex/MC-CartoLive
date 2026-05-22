import { Copy, MapPinned, MousePointer2, Route, X } from 'lucide-react';
import type { ReachableNode } from '../connectivity';
import { meshcorePathAvailable, meshcorePathCopyText, type RouteBounds } from '../routeTools';
import type { PublicNode, PublicRoute } from '../types';

export type PlotMode = 'off' | 'node' | 'area';

export type PlotResult =
  | { type: 'path'; source: PublicNode; target: PublicNode; path: ReachableNode | null }
  | { type: 'area'; bounds: RouteBounds; routes: PublicRoute[] };

interface Props {
  mode: PlotMode;
  firstNode: PublicNode | null;
  areaPointCount: number;
  result: PlotResult | null;
  copyStatus: string | null;
  onStartNodePlot: () => void;
  onStartAreaPlot: () => void;
  onCancel: () => void;
  onCopyPath: (path: ReachableNode | null) => void;
  onSelectRoute: (routeID: string) => void;
}

export default function PlotRoutesPanel({
  mode,
  firstNode,
  areaPointCount,
  result,
  copyStatus,
  onStartNodePlot,
  onStartAreaPlot,
  onCancel,
  onCopyPath,
  onSelectRoute
}: Props) {
  return (
    <section className={`plot-routes-panel ${mode !== 'off' ? 'active' : ''}`} aria-label="Plot routes">
      <div className="plot-route-actions">
        <button type="button" className={`plot-route-button primary ${mode === 'node' ? 'active' : ''}`} onClick={onStartNodePlot}>
          <Route size={14} />
          <span>Plot routes</span>
        </button>
        <button type="button" className={`plot-route-button ${mode === 'area' ? 'active' : ''}`} onClick={onStartAreaPlot} title="Select two map points">
          <MapPinned size={14} />
        </button>
        {(mode !== 'off' || result) && (
          <button type="button" className="plot-route-button icon-only" onClick={onCancel} aria-label="Clear plotted routes">
            <X size={14} />
          </button>
        )}
      </div>

      {(mode !== 'off' || result || copyStatus) && (
        <div className="plot-route-toast" role="status">
          {mode === 'node' && (
            <p>
              <MousePointer2 size={13} />
              <span>{firstNode ? `Select destination from ${firstNode.label}` : 'Select the first node'}</span>
            </p>
          )}
          {mode === 'area' && (
            <p>
              <MapPinned size={13} />
              <span>{areaPointCount === 0 ? 'Select first map corner' : 'Select opposite map corner'}</span>
            </p>
          )}
          {result?.type === 'path' && <PathResult result={result} onCopyPath={onCopyPath} />}
          {result?.type === 'area' && <AreaResult result={result} onSelectRoute={onSelectRoute} />}
          {copyStatus && <em className="plot-copy-status">{copyStatus}</em>}
        </div>
      )}
    </section>
  );
}

function PathResult({ result, onCopyPath }: { result: Extract<PlotResult, { type: 'path' }>; onCopyPath: (path: ReachableNode | null) => void }) {
  const copyText = meshcorePathCopyText(result.path);
  return (
    <div className="plot-result-block">
      <strong>{result.source.label}{' -> '}{result.target.label}</strong>
      {result.path ? (
        <>
          <span>{result.path.hopCount} {result.path.hopCount === 1 ? 'hop' : 'hops'} / {result.path.totalDistanceKm.toFixed(1)} km / {result.path.totalRoutePackets.toLocaleString()} packets</span>
          <code>{copyText || 'No 3-byte path available'}</code>
          <button type="button" className="copy-path-button" disabled={!meshcorePathAvailable(result.path)} onClick={() => onCopyPath(result.path)}>
            <Copy size={13} />
            <span>Copy 3-byte path</span>
          </button>
        </>
      ) : (
        <span>No valid public route path connects these nodes.</span>
      )}
    </div>
  );
}

function AreaResult({ result, onSelectRoute }: { result: Extract<PlotResult, { type: 'area' }>; onSelectRoute: (routeID: string) => void }) {
  return (
    <div className="plot-result-block">
      <strong>{result.routes.length.toLocaleString()} routes in selected square</strong>
      {result.routes.length === 0 ? (
        <span>No public routes cross that map area.</span>
      ) : (
        <div className="plot-area-route-list">
          {result.routes.slice(0, 8).map((route) => (
            <button type="button" key={route.id} onClick={() => onSelectRoute(route.id)}>
              <span>{route.from.label}{' -> '}{route.to.label}</span>
              <em>{route.packetCount.toLocaleString()}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
