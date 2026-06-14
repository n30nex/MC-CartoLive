import { routeAssetIcons } from './assets/routes/assets';

export type NodeIconShape = 'diamond' | 'triangle' | 'square' | 'pentagon' | 'circle' | 'observer';

export interface NodeRoleVisual {
  key: string;
  role: string;
  label: string;
  icon: string;
  mapImageID: string;
  color: string;
  shape: NodeIconShape;
  legendClass?: string;
}

export const NODE_ROLE_VISUALS: NodeRoleVisual[] = [
  {
    key: 'repeater',
    role: 'repeater',
    label: 'Repeater',
    icon: routeAssetIcons.repeater,
    mapImageID: 'node-repeater',
    color: '#22c55e',
    shape: 'diamond'
  },
  {
    key: 'companion',
    role: 'companion',
    label: 'Companion',
    icon: routeAssetIcons.companion,
    mapImageID: 'node-companion',
    color: '#3b82f6',
    shape: 'triangle'
  },
  {
    key: 'room',
    role: 'room_server',
    label: 'Room',
    icon: routeAssetIcons.room,
    mapImageID: 'node-room_server',
    color: '#a855f7',
    shape: 'square'
  },
  {
    key: 'sensor',
    role: 'sensor',
    label: 'Sensor',
    icon: routeAssetIcons.sensor,
    mapImageID: 'node-sensor',
    color: '#65a30d',
    shape: 'pentagon'
  },
  {
    key: 'other',
    role: 'unknown',
    label: 'Other',
    icon: routeAssetIcons.unknown,
    mapImageID: 'node-unknown',
    color: '#64748b',
    shape: 'circle'
  }
];

export const OBSERVER_NODE_VISUAL: NodeRoleVisual = {
  key: 'observer',
  role: 'observer',
  label: 'Observer',
  icon: routeAssetIcons.observer,
  mapImageID: 'observer-node',
  color: '#f59e0b',
  shape: 'observer',
  legendClass: 'observer'
};

const ROLE_VISUALS_BY_ROLE = new Map(NODE_ROLE_VISUALS.map((visual) => [visual.role, visual]));

export function nodeRoleVisual(role: string): NodeRoleVisual {
  return ROLE_VISUALS_BY_ROLE.get(role) ?? NODE_ROLE_VISUALS[NODE_ROLE_VISUALS.length - 1];
}

export function nodeMapImageID(role: string): string {
  return nodeRoleVisual(role).mapImageID;
}

export function nodeRoleColor(role: string): string {
  return nodeRoleVisual(role).color;
}
