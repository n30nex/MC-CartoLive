import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LabPanel from './LabPanel';
import type { AppState } from '../state';
import { LAB_EXPERIMENTS } from '../lab';

describe('LabPanel', () => {
  it('renders the current labs workspace and experiment controls', () => {
    const html = renderToStaticMarkup(
      <LabPanel
        state={emptyLabState()}
        socketStatus="live"
        presentation="side"
        onPresentationChange={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('2.9.5 Labs');
    expect(html).toContain('RF Synth');
    expect(html).toContain('Packets become pitch, pan, and pulse.');
    expect(html).toContain('Signal');
    expect(html).toContain('Enable audio for tones');
    for (const experiment of LAB_EXPERIMENTS) {
      expect(html).toContain(experiment.shortLabel);
    }
    expect(html).toContain('workspace-side');
    expect(html).toContain('Enable labs audio');
  });

  it('renders the selected experiment as its own page surface', () => {
    const html = renderToStaticMarkup(
      <LabPanel
        state={emptyLabState()}
        socketStatus="live"
        experimentID="radar"
        presentation="fullscreen"
        onExperimentChange={() => undefined}
        onPresentationChange={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('Network Weather Radar');
    expect(html).toContain('Regions scan like storm cells.');
    expect(html).toContain('Sweep line shows live scan');
    expect(html).toContain('Hot zone');
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
