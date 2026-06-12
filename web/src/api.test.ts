import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicChat, fetchPublicPackets, fetchPublicPropagation } from './api';

describe('fetchPublicPackets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes malformed packet payload shape', async () => {
    const responseBody = {
      serverTime: '1700',
      window: { from: '200', to: '300', count: '2' },
      nextCursor: 'n-1',
      scan: { eventsScanned: '12', scanLimit: '34', filtered: true, partial: true },
      packets: [
        {
          id: 9,
          at: '150',
          payloadTypeName: 'PLAIN_TEXT',
          hopCount: '2',
          segmentCount: undefined,
          distanceKm: '12.5',
          routeIds: [1, true],
          endpointLabels: ['Alpha', 2],
          segments: [
            {
              routeId: 7,
              from: { nodeId: 12, label: 34, lat: '43.1', lng: -79.4, pathHash3: 1 },
              to: { nodeId: 'n2', label: 'Bravo', lat: '44', lng: -79.8, pathHash3: undefined },
              distanceKm: '5.7'
            },
            null
          ]
        },
        null
      ]
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })));

    const parsed = await fetchPublicPackets({ from: 100, to: 200, limit: 50 });
    expect(parsed).toMatchObject({
      serverTime: 1700,
      nextCursor: 'n-1',
      window: { from: 200, to: 300, count: 2 },
      scan: { eventsScanned: 12, scanLimit: 34, filtered: true, partial: true }
    });
    expect(parsed.packets).toHaveLength(1);
    expect(parsed.packets[0]).toMatchObject({
      id: '9',
      at: 150,
      routeIds: ['1', 'true'],
      endpointLabels: ['Alpha', '2'],
      segmentCount: 1,
      distanceKm: 12.5,
      segments: [
        {
          routeId: '7',
          from: { nodeId: '12', label: '34', lat: 43.1, lng: -79.4, pathHash3: '1' },
          to: { nodeId: 'n2', label: 'Bravo', lat: 44, lng: -79.8 }
        }
      ]
    });
    expect(parsed.packets[0].segments[0].distanceKm).toBe(5.7);
  });
});

describe('fetchPublicChat', () => {
  it('normalizes malformed chat payload shape', async () => {
    const responseBody = {
      serverTime: '1700',
      window: { from: '200', to: '300', count: '2' },
      nextCursor: 456,
      messages: [
        {
          id: 9,
          at: '150',
          region: 2,
          iata: 3,
          sender: null,
          text: 'hello mesh',
          payloadTypeName: 'PLAIN_TEXT',
          channelLabel: null,
          routeIds: [1, true],
          endpointLabels: ['ka.RF.cli', 2],
          anchor: {
            kind: 'node',
            nodeId: 99,
            label: 'Anchor',
            lat: '43.7',
            lng: -79.4
          }
        },
        { not: 'message' }
      ]
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })));

    const parsed = await fetchPublicChat({ from: 100, to: 200, limit: 50 });
    expect(parsed).toMatchObject({
      serverTime: 1700,
      nextCursor: '456',
      window: { from: 200, to: 300, count: 2 }
    });
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      id: '9',
      at: 150,
      region: '2',
      iata: '3',
      sender: 'Unknown',
      text: 'hello mesh',
      channelLabel: 'Public',
      payloadTypeName: 'PLAIN_TEXT',
      routeIds: ['1', 'true'],
      endpointLabels: ['ka.RF.cli', '2']
    });
    expect(parsed.messages[0].anchor).toMatchObject({
      kind: 'node',
      nodeId: '99',
      label: 'Anchor',
      lat: 43.7,
      lng: -79.4
    });
  });

  it('sends chat region as both region and iata params for backward compatibility', async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        fetchCalls.push(String(input));
        return new Response(
          JSON.stringify({
            serverTime: 1700,
            window: { from: 100, to: 200, count: 0 },
            messages: []
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );

    await fetchPublicChat({ from: 100, to: 200, limit: 25, region: 'yyz', channel: 'public', q: 'chat' });

    expect(fetchCalls).toHaveLength(1);
    const requestUrl = new URL(fetchCalls[0], 'http://localhost');
    expect(requestUrl.pathname).toBe('/api/v1/public/chat');
    expect(requestUrl.searchParams.getAll('region')).toEqual(['yyz']);
    expect(requestUrl.searchParams.getAll('iata')).toEqual(['yyz']);
    expect(requestUrl.searchParams.get('channel')).toBe('public');
    expect(requestUrl.searchParams.get('q')).toBe('chat');
    expect(requestUrl.searchParams.get('limit')).toBe('25');
    expect(requestUrl.searchParams.get('from')).toBe('100');
    expect(requestUrl.searchParams.get('to')).toBe('200');
  });
});

describe('fetchPublicPropagation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes propagation event payloads and public summaries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      serverTime: '1700',
      window: { from: '100', to: '200', count: '1' },
      nextCursor: 55,
      conditions: {
        eventCount: '1',
        sourceStatus: 'active',
        weather: {
          source: 'open-meteo',
          model: 123,
          sampleTime: '150',
          fetchedAt: '160',
          temperatureC: '12.4',
          dewPointC: '11.2',
          relativeHumidityPct: '92',
          pressureHPa: '1019',
          cloudCoverPct: '20',
          visibilityM: '12000',
          windSpeedKmh: '8',
          inversionProxy: 'inversion'
        }
      },
      events: [
        {
          id: 9,
          at: '150',
          classification: 'tropo_possible',
          confidence: 'high',
          score: '0.86',
          distanceKm: '142.5',
          region: 7,
          routeIds: [1, true],
          endpointLabels: ['Toronto', 2],
          reasons: ['distance threshold met', 'humid air'],
          replayWindow: { from: '120', to: '180' },
          segments: [
            {
              routeId: 7,
              from: { nodeId: 12, label: 34, lat: '43.1', lng: -79.4 },
              to: { nodeId: 'n2', label: 'Bravo', lat: '44', lng: -79.8 },
              distanceKm: '142.5'
            }
          ]
        },
        { not: 'event' }
      ]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })));

    const parsed = await fetchPublicPropagation({ from: 100, to: 200, limit: 25, region: 'YYZ' });
    expect(parsed).toMatchObject({
      serverTime: 1700,
      nextCursor: '55',
      window: { from: 100, to: 200, count: 1 },
      conditions: {
        eventCount: 1,
        sourceStatus: 'active',
        weather: {
          source: 'open-meteo',
          model: '123',
          temperatureC: 12.4,
          inversionProxy: 'inversion'
        }
      }
    });
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      id: '9',
      classification: 'tropo_possible',
      confidence: 'high',
      score: 0.86,
      distanceKm: 142.5,
      region: '7',
      routeIds: ['1', 'true'],
      endpointLabels: ['Toronto', '2'],
      replayWindow: { from: 120, to: 180 }
    });
    expect(parsed.events[0].segments[0].from).toMatchObject({ nodeId: '12', label: '34', lat: 43.1, lng: -79.4 });
  });
});
