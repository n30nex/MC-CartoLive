import { useMemo, useState } from 'react';
import { Search, SortAsc, SortDesc, X } from 'lucide-react';
import type { PublicNode } from '../types';

interface Props {
  nodes: PublicNode[];
  selectedNodeID: string | null;
  onSelectNode: (nodeID: string) => void;
  onClose: () => void;
}

type SortKey = 'label' | 'role' | 'activityCount' | 'lastSeen';

export default function NodeListPanel({ nodes, selectedNodeID, onSelectNode, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('activityCount');
  const [sortAsc, setSortAsc] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');

  const roles = useMemo(() => {
    const set = new Set(nodes.map(n => n.role).filter(Boolean));
    return [...set].sort();
  }, [nodes]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    let result = nodes;
    if (q) {
      result = result.filter(n =>
        n.label.toLowerCase().includes(q) ||
        n.role.toLowerCase().includes(q) ||
        n.iatasHeardIn.some(i => i.toLowerCase().includes(q))
      );
    }
    if (roleFilter) {
      result = result.filter(n => n.role === roleFilter);
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'label': cmp = a.label.localeCompare(b.label); break;
        case 'role': cmp = a.role.localeCompare(b.role); break;
        case 'activityCount': cmp = a.activityCount - b.activityCount; break;
        case 'lastSeen': cmp = a.lastSeen - b.lastSeen; break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [nodes, query, sortKey, sortAsc, roleFilter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  return (
    <section className="node-list-panel workspace-panel" role="dialog" aria-label="Node list">
      <header className="panel-header">
        <h2>Nodes ({filtered.length})</h2>
        <button type="button" onClick={onClose} aria-label="Close node list"><X size={18} /></button>
      </header>
      <div className="node-list-filters">
        <div className="node-list-search">
          <Search size={15} />
          <input type="text" placeholder="Search nodes..." value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <table className="node-list-table">
        <thead>
          <tr>
            <th><button type="button" onClick={() => toggleSort('label')}>Name {sortKey === 'label' && (sortAsc ? <SortAsc size={12} /> : <SortDesc size={12} />)}</button></th>
            <th><button type="button" onClick={() => toggleSort('role')}>Role {sortKey === 'role' && (sortAsc ? <SortAsc size={12} /> : <SortDesc size={12} />)}</button></th>
            <th>Regions</th>
            <th><button type="button" onClick={() => toggleSort('activityCount')}>Activity {sortKey === 'activityCount' && (sortAsc ? <SortAsc size={12} /> : <SortDesc size={12} />)}</button></th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 200).map(node => (
            <tr key={node.id} className={node.id === selectedNodeID ? 'selected' : ''} onClick={() => onSelectNode(node.id)}>
              <td><strong>{node.label}</strong></td>
              <td><span className={`role-badge role-${node.role}`}>{node.role}</span></td>
              <td>{node.iatasHeardIn.slice(0, 3).join(', ')}{node.iatasHeardIn.length > 3 ? ` +${node.iatasHeardIn.length - 3}` : ''}</td>
              <td>{node.activityCount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && <div className="empty compact-empty">No nodes match your filters</div>}
      {filtered.length > 200 && <div className="node-list-truncated">Showing 200 of {filtered.length} nodes</div>}
    </section>
  );
}
