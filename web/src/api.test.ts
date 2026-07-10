import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSON_REQUEST_TIMEOUT_MS, PUBLIC_STATE_CACHE_MAX_AGE_MS, fetchPublicBootstrap, fetchPublicChat, fetchPublicEvents, fetchPublicPackets, fetchPublicPropagation, fetchPublicState, fetchPublicStateWithFallback, readCachedPublicStateSnapshot } from './api';

describe('public transport contracts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('normalizes event reset metadata without scanning history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ serverTime: '100', oldestSeq: '40', latestSeq: '60', resetRequired: true, nextCursor: 60, events: [] }), { status: 200 })));
    await expect(fetchPublicEvents({ afterSeq: 0 })).resolves.toEqual({ serverTime: 100, oldestSeq: 40, latestSeq: 60, resetRequired: true, nextCursor: '60', events: [] });
  });

  it('normalizes bootstrap clusters and public-safe health', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      serverTime: 100,
      latestSeq: 20,
      stats: { packets: 1 },
      health: { mqttSessionReady: true, datasetState: 'warming', datasetStartedAt: 90, storagePressureState: 'ok' },
      clusters: [{ id: 'yyz', lat: '43.6', lng: '-79.3', count: '12', region: 'YYZ' }],
      recentActivity: []
    }), { status: 200 })));
    const response = await fetchPublicBootstrap();
    expect(response.clusters[0]).toEqual({ id: 'yyz', latitude: 43.6, longitude: -79.3, count: 12, activityCount: undefined, lastSeen: undefined, region: 'YYZ' });
    expect(response.health).toMatchObject({ mqttSessionReady: true, datasetState: 'warming', storagePressureState: 'ok' });
  });

  it('aborts JSON requests after ten seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const request = fetchPublicEvents({ afterSeq: 2 });
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(JSON_REQUEST_TIMEOUT_MS);
    await rejection;
  });

  it('never silently substitutes localStorage for the network state API', async () => {
    seedPublicStateCache(Date.now());
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(fetchPublicState()).rejects.toThrow('offline');
    await expect(fetchPublicStateWithFallback()).resolves.toMatchObject({ source: 'offline-cache', cachedAt: expect.any(Number), state: { stats: { latestSeq: 12 } } });
  });

  it('rejects offline snapshots outside the bounded freshness window', () => {
    const now = Date.now();
    seedPublicStateCache(now - PUBLIC_STATE_CACHE_MAX_AGE_MS - 1);
    expect(readCachedPublicStateSnapshot(now)).toBeNull();
    seedPublicStateCache(now - PUBLIC_STATE_CACHE_MAX_AGE_MS);
    expect(readCachedPublicStateSnapshot(now)).toMatchObject({ source: 'offline-cache' });
  });
});

function seedPublicStateCache(cachedAt: number) {
  window.localStorage.setItem('mc-cartolive:last-public-state', JSON.stringify({
    cachedAt,
    state: {
      serverTime: cachedAt,
      stats: { packets: 1, activeNodes: 1, activeRoutes: 0, mqttConnected: false, mqttMessages: 0, wsClients: 0, serverTime: cachedAt, latestSeq: 12 },
      nodes: [], routes: [], recentActivity: []
    }
  }));
}

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
