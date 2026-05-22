import { Copy, MessageSquareText, X } from 'lucide-react';
import type { PhonebookGroup, ReachableNode } from '../connectivity';
import { meshcorePathAvailable, meshcorePathCopyText, type NodeMessageHistoryItem } from '../routeTools';
import type { PublicNode, PublicRoute } from '../types';

interface Props {
  node: PublicNode | null;
  route: PublicRoute | null;
  connectedRoutes: PublicRoute[];
  phonebookGroups: PhonebookGroup[];
  selectedPath: ReachableNode | null;
  selectedPathTargetID: string | null;
  messageHistory: NodeMessageHistoryItem[];
  copyStatus: string | null;
  onRouteSelect: (routeID: string) => void;
  onPhonebookSelect: (nodeID: string) => void;
  onCopyPath: (path: ReachableNode | null) => void;
  onClose: () => void;
}

export default function SelectionDrawer({
  node,
  route,
  connectedRoutes,
  phonebookGroups,
  selectedPath,
  selectedPathTargetID,
  messageHistory,
  copyStatus,
  onRouteSelect,
  onPhonebookSelect,
  onCopyPath,
  onClose
}: Props) {
  if (!node && !route) return null;
  const reachableCount = phonebookGroups.reduce((total, group) => total + group.nodes.length, 0);

  return (
    <div className={`selection-panels ${node ? 'with-phonebook' : 'route-only'}`}>
      <aside className="selection-panel details-panel" aria-label={node ? 'Node details' : 'Route details'}>
        <PanelCloseButton onClose={onClose} />
        {node && (
          <>
            <span className="eyebrow">{formatNodeRole(node.role)}{node.isObserver ? ' observer' : ''}</span>
            <h2>{node.label}</h2>
            <dl>
              <Detail label="Role" value={formatNodeRole(node.role)} />
              <Detail label="Observer" value={node.isObserver ? 'Yes' : 'No'} />
              <Detail label="Last seen" value={formatRelative(node.lastSeen)} />
              <Detail label="First seen" value={formatRelative(node.firstSeen)} />
              <Detail label="Activity" value={`${node.activityCount.toLocaleString()} packets`} />
              <Detail label="Direct routes" value={connectedRoutes.length.toLocaleString()} />
              <Detail label="Reachable" value={`${reachableCount.toLocaleString()} nodes`} />
              <Detail label="Regions" value={formatRegions(node.iatasHeardIn)} />
              <Detail label="Coordinates" value={`${node.latitude.toFixed(4)}, ${node.longitude.toFixed(4)}`} />
            </dl>
            {connectedRoutes.length > 0 && (
              <div className="drawer-route-list" aria-label="Strongest served routes">
                {connectedRoutes.slice(0, 10).map((item) => (
                  <button type="button" key={item.id} onClick={() => onRouteSelect(item.id)}>
                    <span className={`route-swatch bucket-${item.frequencyBucket}`} />
                    <span>{routePeerLabel(item, node.id)}</span>
                    <em>{item.packetCount.toLocaleString()}</em>
                  </button>
                ))}
              </div>
            )}
            <NodeMessageHistory items={messageHistory} />
          </>
        )}
        {!node && route && (
          <>
            <span className="eyebrow">route</span>
            <h2>{route.from.label}{' -> '}{route.to.label}</h2>
            <dl>
              <Detail label="Packets" value={route.packetCount.toLocaleString()} />
              <Detail label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
              <Detail label="Last heard" value={formatRelative(route.lastHeard)} />
              <Detail label="Payloads" value={route.payloadTypeNames.join(', ') || 'Unknown'} />
              <Detail label="From" value={route.from.label} />
              <Detail label="To" value={route.to.label} />
            </dl>
          </>
        )}
      </aside>

      {node && (
        <aside className="selection-panel phonebook-panel" aria-label="Reachable node phonebook">
          <PanelCloseButton onClose={onClose} />
          <span className="eyebrow">phonebook</span>
          <h2>Reachable nodes</h2>
          <p className="phonebook-summary">{reachableCount.toLocaleString()} nodes through valid public routes</p>
          {selectedPath && <PhonebookCopyCard item={selectedPath} copyStatus={copyStatus} onCopyPath={onCopyPath} />}
          {phonebookGroups.length === 0 ? (
            <p className="phonebook-empty">No reachable nodes in the current public route graph.</p>
          ) : (
            <div className="phonebook-groups">
              {phonebookGroups.map((group) => (
                <section className="phonebook-group" key={group.hopCount}>
                  <h3>{group.hopCount} {group.hopCount === 1 ? 'hop' : 'hops'}</h3>
                  <div className="phonebook-list">
                    {group.nodes.map((item) => (
                      <PhonebookRow
                        key={item.node.id}
                        item={item}
                        selected={item.node.id === selectedPathTargetID}
                        onSelect={onPhonebookSelect}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function PhonebookCopyCard({ item, copyStatus, onCopyPath }: { item: ReachableNode; copyStatus: string | null; onCopyPath: (path: ReachableNode | null) => void }) {
  const copyText = meshcorePathCopyText(item);
  return (
    <div className="phonebook-copy-card">
      <span>
        <strong>{item.node.label}</strong>
        <em>{item.hopCount} {item.hopCount === 1 ? 'hop' : 'hops'} / MeshCore 3-byte</em>
      </span>
      <code>{copyText || 'No 3-byte path available'}</code>
      <button type="button" disabled={!meshcorePathAvailable(item)} onClick={() => onCopyPath(item)}>
        <Copy size={13} />
        <span>Copy route</span>
      </button>
      {copyStatus && <em className="copy-status">{copyStatus}</em>}
    </div>
  );
}

function NodeMessageHistory({ items }: { items: NodeMessageHistoryItem[] }) {
  return (
    <section className="node-message-history" aria-label="Decoded chatter through selected node">
      <h3>
        <MessageSquareText size={13} />
        <span>Chatter history</span>
      </h3>
      {items.length === 0 ? (
        <p>No decoded public chatter in the current live window.</p>
      ) : (
        <div className="node-message-list">
          {items.map((item) => (
            <article key={item.id} className="node-message-row">
              <header>
                <strong>{item.sender}</strong>
                <time>{formatRelative(item.heardAt)}</time>
              </header>
              <p>{item.text}</p>
              <em>{item.routeLabels[0] ?? item.payloadTypeName}</em>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PanelCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button className="panel-close-button" type="button" aria-label="Close selection panels" onClick={onClose}>
      <X size={15} />
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PhonebookRow({ item, selected, onSelect }: { item: ReachableNode; selected: boolean; onSelect: (nodeID: string) => void }) {
  return (
    <button type="button" className={`phonebook-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(item.node.id)}>
      <span className="phonebook-row-main">
        <strong>{item.node.label}</strong>
        <em>{formatNodeRole(item.node.role)} / {formatRegions(item.node.iatasHeardIn, 2)}</em>
      </span>
      <span className="phonebook-row-stats">
        <strong>{item.hopCount} {item.hopCount === 1 ? 'hop' : 'hops'}</strong>
        <em>{item.strongestRoutePacketCount.toLocaleString()} max pkt / {formatRelative(item.lastHeard)}</em>
      </span>
      <span className="phonebook-row-path">{formatPathSummary(item)}</span>
    </button>
  );
}

function routePeerLabel(route: PublicRoute, nodeID: string): string {
  return route.from.nodeId === nodeID ? route.to.label : route.from.label;
}

function formatPathSummary(item: ReachableNode): string {
  const labels = item.endpointLabels.slice(0, 4);
  const extra = item.endpointLabels.length > labels.length ? ` +${item.endpointLabels.length - labels.length}` : '';
  return `${labels.join(' -> ')}${extra} / ${item.totalDistanceKm.toFixed(1)} km`;
}

function formatNodeRole(role: string): string {
  if (role === 'room_server') return 'Room';
  if (role === 'repeater') return 'Repeater';
  if (role === 'companion') return 'Companion';
  if (role === 'sensor') return 'Sensor';
  return 'Unknown';
}

function formatRegions(regions: string[], limit = 5): string {
  if (regions.length === 0) return 'Unknown';
  const shown = regions.slice(0, limit).join(', ');
  return regions.length > limit ? `${shown} +${regions.length - limit}` : shown;
}

function formatRelative(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}
