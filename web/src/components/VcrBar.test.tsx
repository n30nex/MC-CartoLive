import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import VcrBar from './VcrBar';

describe('VcrBar', () => {
  it('uses shared spinner styling for replay and Laser Show busy states', () => {
    const now = 1_717_171_717_000;
    const html = renderToStaticMarkup(
      <VcrBar
        mode="replay"
        speed={1}
        scopeMs={60 * 60_000}
        missedCount={0}
        timelineNow={now}
        clock={now - 30_000}
        scrubAt={null}
        status="loading"
        summary={[]}
        laserShowActive
        onLive={() => undefined}
        onPause={() => undefined}
        onReplayMissed={() => undefined}
        onRewind={() => undefined}
        onSpeed={() => undefined}
        onScope={() => undefined}
        onScrub={() => undefined}
        onPlayFromScrub={() => undefined}
        onLaserShow={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('vcr-button-spinner');
    expect(html).toContain('vcr-live-clock-icon spinning');
    expect(html.match(/loading-spinner/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
