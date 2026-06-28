import type { NodeIconShape } from './nodeVisuals';

const NODE_ROLE_RENDER: Record<string, { color: string; shape: NodeIconShape }> = {
  repeater: { color: '#22c55e', shape: 'diamond' },
  companion: { color: '#3b82f6', shape: 'triangle' },
  room_server: { color: '#a855f7', shape: 'square' },
  sensor: { color: '#65a30d', shape: 'pentagon' },
  unknown: { color: '#64748b', shape: 'circle' }
};

const OBSERVER_RENDER = { color: '#f59e0b', shape: 'observer' as const };

const PAYLOAD_COLORS: Record<string, string> = {
  ADVERT: '#2dd4bf',
  PLAIN_TEXT: '#38bdf8',
  GROUP_TEXT: '#a78bfa',
  GROUP_DATA: '#c084fc',
  TRACE: '#f59e0b',
  RETURNED_PATH: '#facc15',
  REQUEST: '#67e8f9',
  RESPONSE: '#fde047',
  ACK: '#a3e635',
  CONTROL: '#fb7185',
  OTHER: '#e2e8f0'
};

const FALLBACK_PAYLOAD_COLORS = ['#e2e8f0', '#7dd3fc', '#c084fc', '#f0abfc', '#facc15', '#fb7185', '#2dd4bf', '#a3e635'];

export function netGraphNodeColor(role: string, isObserver: boolean): string {
  return isObserver ? OBSERVER_RENDER.color : (NODE_ROLE_RENDER[role] ?? NODE_ROLE_RENDER.unknown).color;
}

export function netGraphNodeShape(role: string, isObserver: boolean): NodeIconShape {
  return isObserver ? OBSERVER_RENDER.shape : (NODE_ROLE_RENDER[role] ?? NODE_ROLE_RENDER.unknown).shape;
}

export function netGraphPayloadColor(payloadTypeName?: string | null): string {
  const normalized = normalizePayloadType(payloadTypeName);
  return PAYLOAD_COLORS[normalized] ?? FALLBACK_PAYLOAD_COLORS[stableHash(normalized) % FALLBACK_PAYLOAD_COLORS.length];
}

export function normalizePayloadType(payloadTypeName?: string | null): string {
  const value = (payloadTypeName ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!value || value === 'UNKNOWN') return 'OTHER';
  if (value === 'TEXT') return 'PLAIN_TEXT';
  if (value === 'GROUP') return 'GROUP_TEXT';
  if (value === 'RETURN_PATH' || value === 'PATH_RETURN' || value === 'PATH') return 'RETURNED_PATH';
  if (value === 'TRACE_ROUTE' || value === 'TRACEROUTE') return 'TRACE';
  if (value === 'COMMAND' || value === 'ADMIN' || value === 'NAK') return 'CONTROL';
  return value;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
