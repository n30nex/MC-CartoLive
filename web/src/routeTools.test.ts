import { describe, expect, it } from 'vitest';
import { boundsFromPoints, meshcorePathCopyText, messageHistoryForNode, routeNodeIDs, routesInBounds } from './routeTools';
import type { ReachableNode } from './connectivity';
import type { PublicActivity, PublicNode, PublicRoute, PublicRouteEndpoint } from './types';

const node = (id: string, lat = 43, lng = -79): PublicNode => ({
  id,
  label: id.toUpperCase(),
  role: 'repeater',
  latitude: lat,
  longitude: lng,
  firstSeen: 1,
  lastSeen: 1,
  iatasHeardIn: ['YYZ'],
  activityCount: 1
});

const endpoint = (nodeId: string, lat: number, lng: number): PublicRouteEndpoint => ({
  nodeId,
  label: nodeId.toUpperCase(),
  lat,
  lng,
  pathHash3: `${nodeId}${nodeId}${nodeId}${nodeId}${nodeId}${nodeId}`.slice(0, 6).toUpperCase()
});

const route = (id: string, from: PublicRouteEndpoint, to: PublicRouteEndpoint, packetCount = 1): PublicRoute => ({
  id,
  from,
  to,
  distanceKm: 1,
  packetCount,
  lastHeard: packetCount,
  frequencyBucket: 1,
  payloadTypeNames: ['GROUP_TEXT']
});

describe('route tools', () => {
  it('formats MeshCore 3-byte path copy text', () => {
    expect(meshcorePathCopyText({ meshcorePath3: 'AAAAAA,BBBBBB' } as ReachableNode)).toBe('AAAAAA,BBBBBB');
    expect(meshcorePathCopyText(null)).toBe('');
  });

  it('finds routes that touch a selected map bounds', () => {
    const bounds = boundsFromPoints({ lat: 42.9, lng: -79.2 }, { lat: 43.2, lng: -78.8 });
    const inside = route('inside', endpoint('a', 43, -79), endpoint('b', 43.1, -79.1), 3);
    const crossing = route('crossing', endpoint('c', 42.8, -79), endpoint('d', 43.3, -79), 8);
    const outside = route('outside', endpoint('e', 44, -78), endpoint('f', 44.2, -78.2), 20);

    expect(routesInBounds([outside, inside, crossing], bounds).map((item) => item.id)).toEqual(['crossing', 'inside']);
  });

  it('returns node IDs touched by routes', () => {
    const ids = routeNodeIDs([route('a-b', endpoint('a', 43, -79), endpoint('b', 43, -79))]);
    expect([...ids]).toEqual(['a', 'b']);
  });

  it('keeps decoded chatter that passed through a selected node', () => {
    const selected = node('a');
    const routes = [route('a-b', endpoint('a', 43, -79), endpoint('b', 43, -79))];
    const activity: PublicActivity[] = [
      {
        id: 'msg-1',
        kind: 'packet',
        payloadTypeName: 'GROUP_TEXT',
        heardAt: 20,
        hopCount: 1,
        hasRoute: true,
        animationState: 'route',
        resolutionBucket: 'routed',
        routeIds: ['a-b'],
        messageSender: 'Alice',
        messageText: 'hello'
      },
      {
        id: 'msg-2',
        kind: 'packet',
        payloadTypeName: 'GROUP_TEXT',
        heardAt: 10,
        hopCount: 0,
        hasRoute: false,
        animationState: 'unmapped',
        resolutionBucket: 'unresolved_path',
        messageText: 'ignore'
      }
    ];

    expect(messageHistoryForNode(selected, routes, activity)).toEqual([
      {
        id: 'msg-1',
        heardAt: 20,
        sender: 'Alice',
        text: 'hello',
        payloadTypeName: 'GROUP_TEXT',
        routeLabels: ['A -> B']
      }
    ]);
  });
});
