import { Copy, MessageSquareText, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { phonebookGroupsForNode, type ConnectivityGraph, type PhonebookGroup, type PhonebookSortMode, type ReachableNode } from '../connectivity';
import ElevationProfile from './ElevationProfile';
import { formatRelative } from '../lib/formatRelative';
import { meshcorePathAvailable, meshcorePathCopyText, type NodeMessageHistoryItem } from '../routeTools';
import type { PublicNode, PublicRoute } from '../types';

interface Props {
  node: PublicNode | null;
  route: PublicRoute | null;
  connectedRoutes: PublicRoute[];
  phonebookGroups: PhonebookGroup[];
  connectivityGraph: ConnectivityGraph;
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
  connectivityGraph,
  selectedPath,
  selectedPathTargetID,
  messageHistory,
  copyStatus,
  onRouteSelect,
  onPhonebookSelect,
  onCopyPath,
  onClose
}: Props) {
  const [phonebookQuery, setPhonebookQuery] = useState('');
  const [phonebookSort, setPhonebookSort] = useState<PhonebookSortMode>('best');
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | null>(null);
  useEffect(() => {
    setPhonebookQuery('');
    setPhonebookSort('best');
    setMaxDistanceKm(null);
  }, [node?.id]);
  const reachableCount = phonebookGroups.reduce((total, group) => total + group.nodes.length, 0);
  const filteredPhonebookGroups = useMemo(
    () => phonebookGroupsForNode(connectivityGraph, node?.id ?? null, { query: phonebookQuery, sortMode: phonebookSort, maxDistanceKm }),
    [connectivityGraph, maxDistanceKm, node?.id, phonebookQuery, phonebookSort]
  );
  const filteredReachableCount = filteredPhonebookGroups.reduce((total, group) => total + group.nodes.length, 0);
  if (!node && !route) return null;

  return (
    <div className={`selection-panels ${node ? 'with-phonebook' : 'route-only'}`}>
      <aside className="selection-panel details-panel" aria-label={node ? 'Node details' : 'Route details'}>
        <PanelCloseButton onClose={onClose} />
        {node && (
          <>
            <span className="eyebrow">{formatNodeRole(node.role)}{node.isObserver ? ' observer' : ''}</span>
            <h2>{node.label}</h2>
            <SelectionSummaryStrip
              items={[
                { label: 'Routes', value: connectedRoutes.length.toLocaleString() },
                { label: 'Reachable', value: reachableCount.toLocaleString() },
                { label: 'Activity', value: node.activityCount.toLocaleString() },
                { label: 'Seen', value: formatRelative(node.lastSeen) }
              ]}
            />
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
            <SelectionSummaryStrip
              items={[
                { label: 'Distance', value: `${route.distanceKm.toFixed(1)} km` },
                { label: 'Packets', value: route.packetCount.toLocaleString() },
                { label: 'Last', value: formatRelative(route.lastHeard) },
                { label: 'Payloads', value: route.payloadTypeNames.length.toLocaleString() }
              ]}
            />
            <div className="selection-endpoint-row" aria-label="Route endpoints">
              <span>{route.from.label}</span>
              <em>to</em>
              <span>{route.to.label}</span>
            </div>
            <dl>
              <Detail label="Packets" value={route.packetCount.toLocaleString()} />
              <Detail label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
              <Detail label="Last heard" value={formatRelative(route.lastHeard)} />
              <Detail label="Payloads" value={route.payloadTypeNames.join(', ') || 'Unknown'} />
              <Detail label="From" value={route.from.label} />
              <Detail label="To" value={route.to.label} />
            </dl>
            <ElevationProfile from={route.from} to={route.to} />
          </>
        )}
      </aside>

      {node && (
        <aside className="selection-panel phonebook-panel" aria-label="Reachable node phonebook">
          <PanelCloseButton onClose={onClose} />
          <span className="eyebrow">phonebook</span>
          <h2>Reachable nodes</h2>
          <p className="phonebook-summary">{filteredReachableCount.toLocaleString()} of {reachableCount.toLocaleString()} nodes through valid public routes</p>
          <PhonebookControls
            query={phonebookQuery}
            sort={phonebookSort}
            maxDistanceKm={maxDistanceKm}
            onQueryChange={setPhonebookQuery}
            onSortChange={setPhonebookSort}
            onMaxDistanceChange={setMaxDistanceKm}
          />
          {selectedPath && <PhonebookCopyCard item={selectedPath} copyStatus={copyStatus} onCopyPath={onCopyPath} />}
          {filteredPhonebookGroups.length === 0 ? (
            <p className="phonebook-empty">{reachableCount === 0 ? 'No reachable nodes in the current public route graph.' : 'No reachable nodes match the current phonebook filters.'}</p>
          ) : (
            <div className="phonebook-groups">
              {filteredPhonebookGroups.map((group) => (
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

function SelectionSummaryStrip({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="selection-summary-strip">
      {items.map((item) => (
        <span key={item.label}>
          <strong>{item.value}</strong>
          <em>{item.label}</em>
        </span>
      ))}
    </div>
  );
}

function PhonebookControls({
  query,
  sort,
  maxDistanceKm,
  onQueryChange,
  onSortChange,
  onMaxDistanceChange
}: {
  query: string;
  sort: PhonebookSortMode;
  maxDistanceKm: number | null;
  onQueryChange: (value: string) => void;
  onSortChange: (value: PhonebookSortMode) => void;
  onMaxDistanceChange: (value: number | null) => void;
}) {
  return (
    <div className="phonebook-tools">
      <label className="phonebook-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search city, region, repeater, ID"
        />
        {query && (
          <button type="button" onClick={() => onQueryChange('')} aria-label="Clear phonebook search">
            <X size={12} />
          </button>
        )}
      </label>
      <div className="phonebook-filter-row">
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => onSortChange(event.target.value as PhonebookSortMode)}>
            <option value="best">Best route</option>
            <option value="shortest">Shortest</option>
            <option value="busiest">Busiest</option>
            <option value="nearest">Nearest</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
        <label>
          <span>Distance</span>
          <select value={maxDistanceKm ?? ''} onChange={(event) => onMaxDistanceChange(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Any</option>
            <option value="50">under 50 km</option>
            <option value="100">under 100 km</option>
            <option value="250">under 250 km</option>
            <option value="500">under 500 km</option>
            <option value="1000">under 1000 km</option>
          </select>
        </label>
      </div>
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
