import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicNode } from '../types';
import NodeListPanel from './NodeListPanel';

describe('NodeListPanel', () => {
  it('renders a polished searchable node workspace', () => {
    const html = renderToStaticMarkup(
      <NodeListPanel
        nodes={nodes}
        selectedNodeID="node-b"
        presentation="fullscreen"
        onPresentationChange={() => undefined}
        onSelectNode={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('Public nodes');
    expect(html).toContain('Search public nodes by label, role, region, or observer airport.');
    expect(html).toContain('Search labels, roles, regions, IATA');
    expect(html).toContain('Live now');
    expect(html).toContain('workspace-fullscreen');
    expect(html).toContain('Alpha Repeater');
    expect(html).toContain('Bravo Companion');
    expect(html).toContain('class="selected"');
  });
});

const now = Date.now();
const nodes: PublicNode[] = [
  {
    id: 'node-a',
    label: 'Alpha Repeater',
    role: 'repeater',
    latitude: 43.65,
    longitude: -79.38,
    firstSeen: now - 80_000,
    lastSeen: now - 30_000,
    iatasHeardIn: ['YYZ'],
    regionsHeardIn: ['CA-ON'],
    activityCount: 12
  },
  {
    id: 'node-b',
    label: 'Bravo Companion',
    role: 'companion',
    latitude: 45.42,
    longitude: -75.69,
    firstSeen: now - 900_000,
    lastSeen: now - 620_000,
    iatasHeardIn: ['YOW'],
    regionsHeardIn: ['CA-ON'],
    activityCount: 4
  }
];
