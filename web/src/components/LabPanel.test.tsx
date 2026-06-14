import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LabPanel from './LabPanel';
import type { AppState } from '../state';

describe('LabPanel', () => {
  it('renders the single Waterfall Labs workspace and controls', () => {
    const html = renderToStaticMarkup(
      <LabPanel
        state={emptyLabState()}
        socketStatus="live"
        presentation="side"
        onPresentationChange={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('3.0.0 Labs');
    expect(html).toContain('Packet Waterfall');
    expect(html).toContain('Flow');
    expect(html).toContain('Rhythm');
    expect(html).toContain('Payload Streams');
    expect(html).toContain('Latest Drop');
    expect(html).toContain('Enable waterfall audio');
    expect(html).toContain('waterfall-canvas');
    expect(html).toContain('workspace-side');
    expect(html).not.toContain('RF Synth');
    expect(html).not.toContain('Message Fireflies');
  });

  it('renders the Waterfall as a fullscreen page surface', () => {
    const html = renderToStaticMarkup(
      <LabPanel
        state={emptyLabState()}
        socketStatus="live"
        experimentID="waterfall"
        presentation="fullscreen"
        onExperimentChange={() => undefined}
        onPresentationChange={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('Packet Waterfall');
    expect(html).toContain('Intensity');
    expect(html).toContain('Tempo');
    expect(html).toContain('workspace-fullscreen');
  });
});

function emptyLabState(): Pick<AppState, 'activity' | 'pulses' | 'nodes' | 'routes' | 'stats' | 'serverTime'> {
  return {
    activity: [],
    pulses: [],
    nodes: [],
    routes: [],
    stats: null,
    serverTime: 1_700_000_000_000
  };
}
