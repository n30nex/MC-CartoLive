import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildConnectivityGraph } from '../connectivity';
import type { PublicNode, PublicRoute } from '../types';
import SelectionDrawer from './SelectionDrawer';

const now = Date.UTC(2026, 5, 12, 12);

const nodes: PublicNode[] = [
  {
    id: 'node-a',
    label: 'Toronto Repeater',
    role: 'repeater',
    latitude: 43.65,
    longitude: -79.38,
    firstSeen: now - 86_400_000,
    lastSeen: now,
    iatasHeardIn: ['YYZ'],
    activityCount: 42
  },
  {
    id: 'node-b',
    label: 'Cambridge Node',
    role: 'companion',
    latitude: 43.36,
    longitude: -80.31,
    firstSeen: now - 86_400_000,
    lastSeen: now,
    iatasHeardIn: ['YKF'],
    activityCount: 18
  }
];

const route: PublicRoute = {
  id: 'route-a-b',
  from: { nodeId: 'node-a', label: 'Toronto Repeater', lat: 43.65, lng: -79.38, pathHash3: 'abc123' },
  to: { nodeId: 'node-b', label: 'Cambridge Node', lat: 43.36, lng: -80.31, pathHash3: 'def456' },
  distanceKm: 77.4,
  packetCount: 12,
  lastHeard: now,
  frequencyBucket: 2,
  payloadTypeNames: ['Text']
};

describe('SelectionDrawer', () => {
  it('renders route summary metrics before detailed route fields', () => {
    const html = renderToStaticMarkup(
      <SelectionDrawer
        node={null}
        route={route}
        connectedRoutes={[]}
        phonebookGroups={[]}
        connectivityGraph={buildConnectivityGraph(nodes, [route])}
        selectedPath={null}
        selectedPathTargetID={null}
        messageHistory={[]}
        copyStatus={null}
        onRouteSelect={() => undefined}
        onPhonebookSelect={() => undefined}
        onCopyPath={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('selection-summary-strip');
    expect(html).toContain('77.4 km');
    expect(html).toContain('Packets');
    expect(html).toContain('Route endpoints');
    expect(html).toContain('Toronto Repeater');
    expect(html).toContain('Cambridge Node');
  });

  it('renders node summary metrics for operations scanning', () => {
    const html = renderToStaticMarkup(
      <SelectionDrawer
        node={nodes[0]}
        route={null}
        connectedRoutes={[route]}
        phonebookGroups={[]}
        connectivityGraph={buildConnectivityGraph(nodes, [route])}
        selectedPath={null}
        selectedPathTargetID={null}
        messageHistory={[]}
        copyStatus={null}
        onRouteSelect={() => undefined}
        onPhonebookSelect={() => undefined}
        onCopyPath={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('Routes');
    expect(html).toContain('Reachable');
    expect(html).toContain('Activity');
    expect(html).toContain('Toronto Repeater');
  });
});
