import { useMemo, useState, type ReactNode } from 'react';
import { Activity, Filter, MapPin, Maximize2, Minimize2, RadioTower, Search, SortAsc, SortDesc, X } from 'lucide-react';
import type { NodeRole, PublicNode } from '../types';
import { activeAssetPack } from '../assets/v3/assetPacks';
import { nodeRoleVisual } from '../nodeVisuals';
import { toggleWorkspacePresentation, workspacePresentationTitle, type WorkspacePresentation } from './workspacePanel';

interface Props {
  nodes: PublicNode[];
  selectedNodeID: string | null;
  presentation?: WorkspacePresentation;
  onPresentationChange?: (presentation: WorkspacePresentation) => void;
  onSelectNode: (nodeID: string) => void;
  onClose: () => void;
}

type SortKey = 'label' | 'role' | 'activityCount' | 'lastSeen';
type FreshnessFilter = 'all' | 'live' | 'recent' | 'stale';

const NODE_ROW_LIMIT = 500;
const LIVE_WINDOW_MS = 15 * 60_000;
const RECENT_WINDOW_MS = 6 * 60 * 60_000;

export default function NodeListPanel({
  nodes,
  selectedNodeID,
  presentation = 'fullscreen',
  onPresentationChange,
  onSelectNode,
  onClose
}: Props) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('activityCount');
  const [sortAsc, setSortAsc] = useState(false);
  const [roleFilter, setRoleFilter] = useState<NodeRole | ''>('');
  const [freshnessFilter, setFreshnessFilter] = useState<FreshnessFilter>('all');
  const now = Date.now();

  const roles = useMemo(() => {
    const set = new Set(nodes.map((node) => node.role).filter(Boolean));
    return [...set].sort((a, b) => roleLabel(a).localeCompare(roleLabel(b)));
  }, [nodes]);

  const summary = useMemo(() => nodeSummary(nodes, now), [nodes, now]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    let result = nodes;
    if (q) {
      result = result.filter((node) => {
        const haystack = [
          node.label,
          node.role,
          roleLabel(node.role),
          ...node.iatasHeardIn,
          ...(node.regionsHeardIn ?? [])
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    if (roleFilter) result = result.filter((node) => node.role === roleFilter);
    if (freshnessFilter !== 'all') {
      result = result.filter((node) => freshnessBucket(node.lastSeen, now) === freshnessFilter);
    }
    result = [...result].sort((a, b) => {
      const cmp = compareNodes(a, b, sortKey);
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [freshnessFilter, nodes, now, query, roleFilter, sortAsc, sortKey]);

  const visible = filtered.slice(0, NODE_ROW_LIMIT);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((value) => !value);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? <SortAsc size={13} /> : <SortDesc size={13} />) : null;

  return (
    <section className={`node-list-panel workspace-panel workspace-${presentation}`} role="dialog" aria-label="Node list">
      <header className="node-list-header">
        <div>
          <span className="panel-eyebrow">3.0.1 Nodes</span>
          <h2>Node List</h2>
          <p>Search public nodes by label, role, region, or observer airport.</p>
        </div>
        <div className="node-list-actions">
          {onPresentationChange && (
            <button
              type="button"
              className="icon-button"
              title={workspacePresentationTitle(presentation)}
              onClick={() => onPresentationChange(toggleWorkspacePresentation(presentation))}
            >
              {presentation === 'fullscreen' ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          )}
          <button type="button" className="icon-button" onClick={onClose} title="Close node list" aria-label="Close node list">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="node-list-summary" aria-label="Node summary">
        <SummaryCard icon={<RadioTower size={15} />} label="Nodes" value={nodes.length.toLocaleString()} />
        <SummaryCard icon={<Activity size={15} />} label="Live" value={summary.live.toLocaleString()} />
        <SummaryCard icon={<MapPin size={15} />} label="Regions" value={summary.regions.toLocaleString()} />
        <SummaryCard icon={<Filter size={15} />} label="Showing" value={filtered.length.toLocaleString()} />
      </div>

      <div className="node-list-toolbar" aria-label="Node filters">
        <label className="node-list-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search labels, roles, regions, IATA"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear node search">
              <X size={14} />
            </button>
          )}
        </label>
        <label>
          <span>Role</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as NodeRole | '')}>
            <option value="">All roles</option>
            {roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select>
        </label>
        <label>
          <span>Freshness</span>
          <select value={freshnessFilter} onChange={(event) => setFreshnessFilter(event.target.value as FreshnessFilter)}>
            <option value="all">All nodes</option>
            <option value="live">Live now</option>
            <option value="recent">Recent</option>
            <option value="stale">Stale</option>
          </select>
        </label>
      </div>

      <div className="node-list-table-wrap">
        <table className="node-list-table">
          <thead>
            <tr>
              <th><button type="button" onClick={() => toggleSort('label')}>Node {sortIcon('label')}</button></th>
              <th><button type="button" onClick={() => toggleSort('role')}>Role {sortIcon('role')}</button></th>
              <th>Regions</th>
              <th><button type="button" onClick={() => toggleSort('activityCount')}>Activity {sortIcon('activityCount')}</button></th>
              <th><button type="button" onClick={() => toggleSort('lastSeen')}>Last seen {sortIcon('lastSeen')}</button></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((node) => (
              <tr
                key={node.id}
                className={node.id === selectedNodeID ? 'selected' : ''}
                onClick={() => onSelectNode(node.id)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectNode(node.id);
                  }
                }}
              >
                <td>
                  <strong>{node.label || 'Unnamed node'}</strong>
                  <span>{formatCoordinates(node.latitude, node.longitude)}</span>
                </td>
                <td><span className={`role-badge role-${node.role}`}><img src={nodeRoleVisual(node.role).icon} alt="" aria-hidden="true" />{roleLabel(node.role)}</span></td>
                <td>{regionsForNode(node)}</td>
                <td>{node.activityCount.toLocaleString()}</td>
                <td>{timeAgo(node.lastSeen, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="node-list-empty">
          <img src={activeAssetPack.workspaces.nodes} alt="" aria-hidden="true" />
          <span>No public nodes match those filters.</span>
        </div>
      )}
      {filtered.length > NODE_ROW_LIMIT && <div className="node-list-truncated">Showing {NODE_ROW_LIMIT.toLocaleString()} of {filtered.length.toLocaleString()} matching nodes.</div>}
    </section>
  );
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="node-list-summary-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function nodeSummary(nodes: PublicNode[], now: number) {
  const regions = new Set<string>();
  let live = 0;
  for (const node of nodes) {
    if (freshnessBucket(node.lastSeen, now) === 'live') live += 1;
    for (const region of [...node.iatasHeardIn, ...(node.regionsHeardIn ?? [])]) {
      if (region) regions.add(region);
    }
  }
  return { live, regions: regions.size };
}

function compareNodes(a: PublicNode, b: PublicNode, key: SortKey): number {
  switch (key) {
    case 'label':
      return a.label.localeCompare(b.label);
    case 'role':
      return roleLabel(a.role).localeCompare(roleLabel(b.role)) || a.label.localeCompare(b.label);
    case 'lastSeen':
      return a.lastSeen - b.lastSeen;
    case 'activityCount':
    default:
      return a.activityCount - b.activityCount || a.lastSeen - b.lastSeen;
  }
}

function freshnessBucket(lastSeen: number, now: number): Exclude<FreshnessFilter, 'all'> {
  const age = Math.max(0, now - lastSeen);
  if (age <= LIVE_WINDOW_MS) return 'live';
  if (age <= RECENT_WINDOW_MS) return 'recent';
  return 'stale';
}

function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function regionsForNode(node: PublicNode): string {
  const regions = [...new Set([...node.iatasHeardIn, ...(node.regionsHeardIn ?? [])].filter(Boolean))];
  if (regions.length === 0) return 'Unmapped';
  const head = regions.slice(0, 4).join(', ');
  return regions.length > 4 ? `${head} +${regions.length - 4}` : head;
}

function formatCoordinates(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'No public position';
  return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

function timeAgo(value: number, now: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Unknown';
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
