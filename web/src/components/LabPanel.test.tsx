import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LabPanel from './LabPanel';
import type { AppState } from '../state';

describe('LabPanel', () => {
  it('renders the 2.9.3 labs workspace and experiment controls', () => {
    const html = renderToStaticMarkup(
      <LabPanel
        state={emptyLabState()}
        socketStatus="live"
        presentation="side"
        onPresentationChange={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('2.9.3 Labs');
    expect(html).toContain('Live RF Labs');
    expect(html).toContain('RF Synth');
    expect(html).toContain('Waterfall');
    expect(html).toContain('Sequence');
    expect(html).toContain('Fireflies');
    expect(html).toContain('workspace-side');
    expect(html).toContain('Enable labs audio');
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
