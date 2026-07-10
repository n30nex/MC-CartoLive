import { describe, expect, it } from 'vitest';
import { buildSharedViewURL, parseSharedView } from './shareView';

describe('share view URLs', () => {
  it('parses a viewport with selected route and search query', () => {
    expect(parseSharedView('?lat=43.6532&lng=-79.3832&z=9.5&route=r-1&q=Toronto')).toEqual({
      lat: 43.6532,
      lng: -79.3832,
      z: 9.5,
      route: 'r-1',
      node: undefined,
      q: undefined
    });
  });

  it('rejects invalid view coordinates', () => {
    expect(parseSharedView('?lat=200&lng=-79&z=9')).toBeNull();
    expect(parseSharedView('?lat=43&lng=-79&z=99')).toBeNull();
    expect(parseSharedView('?lat=43&lng=-79&z=9&pitch=100')).toBeNull();
    expect(parseSharedView('?lat=43&lng=-79&z=9&bearing=240')).toBeNull();
    expect(parseSharedView('?lng=-79&z=9')).toBeNull();
  });

  it('builds a share link with viewport, selected node, and query', () => {
    const url = buildSharedViewURL('https://routes.canadaverse.org/?old=1&route=old', { lat: 45.4215296, lng: -75.6971931, z: 8.125 }, {
      node: 'node-123',
      q: 'Ottawa'
    });
    expect(url).toBe('https://routes.canadaverse.org/?old=1&lat=45.42153&lng=-75.69719&z=8.13&node=node-123');
  });

  it('prefers route selection over node selection', () => {
    const url = buildSharedViewURL('https://routes.canadaverse.org/', { lat: 1, lng: 2, z: 3 }, {
      route: 'route-1',
      node: 'node-1'
    });
    expect(url).toBe('https://routes.canadaverse.org/?lat=1&lng=2&z=3&route=route-1');
  });

  it('round-trips 3d camera pitch and bearing when provided', () => {
    const parsed = parseSharedView('?lat=43.6532&lng=-79.3832&z=15.5&pitch=46.4&bearing=-11.2');
    expect(parsed).toEqual({
      lat: 43.6532,
      lng: -79.3832,
      z: 15.5,
      pitch: 46.4,
      bearing: -11.2,
      route: undefined,
      node: undefined,
      q: undefined
    });
    const url = buildSharedViewURL('https://routes.canadaverse.org/', { lat: 43.6532, lng: -79.3832, z: 15.5, pitch: 46.44, bearing: -11.24 }, {});
    expect(url).toBe('https://routes.canadaverse.org/?lat=43.6532&lng=-79.3832&z=15.5&pitch=46.4&bearing=-11.2');
  });

  it('round-trips a privacy-safe Replay Studio deep link', () => {
    const url = buildSharedViewURL('https://routes.canadaverse.org/', { lat: 43, lng: -79, z: 8 }, {
      route: 'route:abc', studio: true, replayPacket: 'packet-123', replayRoute: 'route:abc'
    });
    expect(parseSharedView(new URL(url).search)).toMatchObject({ studio: true, replayPacket: 'packet-123', replayRoute: 'route:abc', route: 'route:abc' });
    expect(buildSharedViewURL('https://routes.canadaverse.org/', { lat: 43, lng: -79, z: 8 }, {
      studio: true, replayPacket: 'secret / raw payload'
    })).not.toContain('secret');
  });

  it('drops free-form queries and malformed selection identifiers', () => {
    expect(parseSharedView('?lat=43&lng=-79&z=8&route=raw%20packet%20%2F%20secret&q=private')).toMatchObject({ route: undefined, node: undefined, q: undefined });
    expect(buildSharedViewURL('https://routes.canadaverse.org/?q=private', { lat: 43, lng: -79, z: 8 }, { q: 'private' })).not.toContain('q=');
  });
});
