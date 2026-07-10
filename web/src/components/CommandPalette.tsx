import { CornerDownLeft, RadioTower, Route, Search, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAccessibleDialog } from '../lib/useAccessibleDialog';
import { filterDashboardActions, type DashboardAction } from '../uiActions';
import type { PublicNode, PublicRoute } from '../types';
import './command-palette.css';

interface Props {
  actions: readonly DashboardAction[];
  nodes: PublicNode[];
  routes: PublicRoute[];
  onSelectNode: (nodeID: string) => void;
  onSelectRoute: (routeID: string) => void;
  onClose: () => void;
}

type Result =
  | { key: string; label: string; description: string; kind: 'action'; action: DashboardAction }
  | { key: string; label: string; description: string; kind: 'node'; node: PublicNode }
  | { key: string; label: string; description: string; kind: 'route'; route: PublicRoute };

export default function CommandPalette({ actions, nodes, routes, onSelectNode, onSelectRoute, onClose }: Props) {
  const dialogRef = useAccessibleDialog<HTMLDivElement>(true, onClose);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo<Result[]>(() => {
    const normalized = query.trim().toLowerCase();
    const actionResults: Result[] = filterDashboardActions(actions, query).slice(0, 6).map((action) => ({
      key: `action:${action.id}`,
      label: action.label,
      description: action.description,
      kind: 'action',
      action
    }));
    if (!normalized) return actionResults;
    const nodeResults: Result[] = nodes
      .filter((node) => `${node.label} ${node.role} ${node.iatasHeardIn.join(' ')} ${(node.regionsHeardIn ?? []).join(' ')}`.toLowerCase().includes(normalized))
      .slice(0, 6)
      .map((node) => ({ key: `node:${node.id}`, label: node.label, description: `${node.role.replace('_', ' ')} · ${(node.regionsHeardIn ?? node.iatasHeardIn).slice(0, 2).join(', ') || 'public node'}`, kind: 'node', node }));
    const routeResults: Result[] = routes
      .filter((route) => `${route.from.label} ${route.to.label} ${route.payloadTypeNames.join(' ')}`.toLowerCase().includes(normalized))
      .slice(0, 5)
      .map((route) => ({ key: `route:${route.id}`, label: `${route.from.label} → ${route.to.label}`, description: `${route.distanceKm.toFixed(1)} km · ${route.packetCount.toLocaleString()} packets`, kind: 'route', route }));
    return [...actionResults, ...nodeResults, ...routeResults].slice(0, 12);
  }, [actions, nodes, query, routes]);

  const choose = (result: Result | undefined) => {
    if (!result) return;
    if (result.kind === 'action') void result.action.run();
    else if (result.kind === 'node') onSelectNode(result.node.id);
    else onSelectRoute(result.route.id);
    onClose();
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" tabIndex={-1}>
        <header>
          <Search size={18} />
          <label id="command-palette-title" className="sr-only" htmlFor="command-palette-input">Search commands, nodes, and routes</label>
          <input
            id="command-palette-input"
            data-autofocus
            value={query}
            placeholder="Search commands, nodes, routes…"
            autoComplete="off"
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.min(results.length - 1, value + 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); }
              if (event.key === 'Enter') { event.preventDefault(); choose(results[activeIndex]); }
            }}
          />
          <kbd>⌘K</kbd>
          <button type="button" aria-label="Close command palette" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="command-results" role="listbox" aria-label="Search results">
          {results.length === 0 && <p>No public nodes, routes, or actions match.</p>}
          {results.map((result, index) => (
            <button
              key={result.key}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(result)}
            >
              <span aria-hidden="true">{result.kind === 'node' ? <RadioTower size={16} /> : result.kind === 'route' ? <Route size={16} /> : <Sparkles size={16} />}</span>
              <span><strong>{result.label}</strong><small>{result.description}</small></span>
              {index === activeIndex && <CornerDownLeft size={14} />}
            </button>
          ))}
        </div>
        <footer><span>↑↓ navigate</span><span>Enter select</span><span>Esc close</span></footer>
      </div>
    </div>
  );
}
