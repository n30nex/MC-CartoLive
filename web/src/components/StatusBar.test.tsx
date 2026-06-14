import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import StatusBar, { formatStatusNumber, metricMeterLevel } from './StatusBar';

const coverage = {
  receivedPerMinute: 240,
  routeAnimatedPerMinute: 42,
  observerBurstPerMinute: 189,
  unmappedPerMinute: 9,
  lastPacketAgeMs: 500
};

describe('StatusBar', () => {
  it('renders compact metric labels for the crowded top bar', () => {
    const html = renderToStaticMarkup(
      <StatusBar
        stats={{ packets: 683710, activeNodes: 0, activeRoutes: 0, mqttConnected: true, mqttMessages: 12, wsClients: 1, serverTime: Date.now() }}
        socketStatus="live"
        nodeCount={1984}
        routeCount={728}
        coverage={coverage}
        latestPayloadTypeName="TEXT"
        latestPacketID="packet-1"
      />
    );

    expect(html).toContain('rx/min');
    expect(html).toContain('route/min');
    expect(html).toContain('bursts/min');
    expect(html).toContain('unmapped/min');
    expect(html).toContain('total');
    expect(html).toContain('Loading solar conditions');
    expect(html).toContain('solar-loading-spinner');
    expect(html).not.toContain('tropo');
    expect(html).not.toContain('long RF');
    expect(html.match(/status-vu/g)).toHaveLength(4);
    expect(html.match(/count-pill/g)).toHaveLength(3);
  });

  it('compacts large numbers predictably', () => {
    expect(formatStatusNumber(9999)).toBe('9,999');
    expect(formatStatusNumber(12500)).toBe('13k');
    expect(formatStatusNumber(1_250_000)).toBe('1.3M');
  });

  it('normalizes compact VU levels against the busiest per-minute metric', () => {
    expect(metricMeterLevel(0, 240)).toBe(0);
    expect(metricMeterLevel(12, 240)).toBe(0.05);
    expect(metricMeterLevel(240, 240)).toBe(1);
  });
});
