import { routePacketDots } from './assets/routes/assets';

export interface PayloadVisual {
  color: string;
  label: string;
  shortLabel: string;
  className: string;
  description: string;
  priority: number;
  icon: string;
}

interface PayloadVisualDefinition {
  color: string;
  label: string;
  shortLabel: string;
  description: string;
  priority: number;
}

const FALLBACK_COLORS = ['#e2e8f0', '#7dd3fc', '#c084fc', '#f0abfc', '#facc15', '#fb7185', '#2dd4bf', '#a3e635'];

const PAYLOAD_VISUALS: Record<string, PayloadVisualDefinition> = {
  ADVERT: {
    color: '#2dd4bf',
    label: 'Advert',
    shortLabel: 'ADV',
    description: 'Node adverts',
    priority: 10
  },
  PLAIN_TEXT: {
    color: '#38bdf8',
    label: 'Plain text',
    shortLabel: 'TXT',
    description: 'Flood text',
    priority: 20
  },
  GROUP_TEXT: {
    color: '#a78bfa',
    label: 'Group text',
    shortLabel: 'GRP',
    description: 'Group flood',
    priority: 30
  },
  GROUP_DATA: {
    color: '#c084fc',
    label: 'Group data',
    shortLabel: 'GRP',
    description: 'Group data',
    priority: 31
  },
  TRACE: {
    color: '#f59e0b',
    label: 'Trace',
    shortLabel: 'TRC',
    description: 'Trace path',
    priority: 40
  },
  RETURNED_PATH: {
    color: '#facc15',
    label: 'Returned path',
    shortLabel: 'RET',
    description: 'Returned path',
    priority: 41
  },
  REQUEST: {
    color: '#67e8f9',
    label: 'Request',
    shortLabel: 'REQ',
    description: 'Request/control',
    priority: 50
  },
  RESPONSE: {
    color: '#fde047',
    label: 'Response',
    shortLabel: 'RSP',
    description: 'Response/control',
    priority: 51
  },
  ACK: {
    color: '#a3e635',
    label: 'Ack',
    shortLabel: 'ACK',
    description: 'Acknowledgement',
    priority: 60
  },
  CONTROL: {
    color: '#fb7185',
    label: 'Control',
    shortLabel: 'CTL',
    description: 'Control traffic',
    priority: 70
  }
};

const LEGEND_PAYLOADS = ['ADVERT', 'PLAIN_TEXT', 'GROUP_TEXT', 'TRACE', 'RETURNED_PATH', 'ACK', 'CONTROL', 'OTHER'];

export function payloadVisual(payloadTypeName?: string | null): PayloadVisual {
  const normalized = normalizePayloadType(payloadTypeName);
  const known = PAYLOAD_VISUALS[normalized];
  if (known) {
    return {
      ...known,
      className: `payload-${slugifyPayload(normalized)}`,
      icon: routePacketDots[normalized] ?? routePacketDots.OTHER
    };
  }
  const color = normalized === 'OTHER' ? FALLBACK_COLORS[0] : FALLBACK_COLORS[stableHash(normalized) % FALLBACK_COLORS.length];
  return {
    color,
    label: normalized === 'OTHER' ? 'Other' : titleCasePayload(normalized),
    shortLabel: shortPayloadLabel(normalized),
    description: normalized === 'OTHER' ? 'Other packets' : titleCasePayload(normalized),
    className: `payload-${slugifyPayload(normalized)}`,
    priority: 900 + (stableHash(normalized) % 100),
    icon: routePacketDots[normalized] ?? routePacketDots.OTHER
  };
}

export function payloadColor(payloadTypeName?: string | null): string {
  return payloadVisual(payloadTypeName).color;
}

export function payloadLabel(payloadTypeName?: string | null): string {
  return payloadVisual(payloadTypeName).label;
}

export function payloadLegendVisuals(): PayloadVisual[] {
  return LEGEND_PAYLOADS.map((name) => payloadVisual(name));
}

export function payloadVisualsFor(payloadTypeNames: string[] | undefined, limit = 4): PayloadVisual[] {
  const visuals = [...new Map((payloadTypeNames ?? []).map((name) => [normalizePayloadType(name), payloadVisual(name)])).values()];
  return visuals.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label)).slice(0, limit);
}

export function hiddenPayloadCount(payloadTypeNames: string[] | undefined, visibleCount: number): number {
  const total = new Set((payloadTypeNames ?? []).map(normalizePayloadType)).size;
  return Math.max(0, total - visibleCount);
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

function slugifyPayload(payloadTypeName: string): string {
  return payloadTypeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
}

function titleCasePayload(payloadTypeName: string): string {
  return payloadTypeName
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shortPayloadLabel(payloadTypeName: string): string {
  if (payloadTypeName === 'OTHER') return 'OTH';
  const parts = payloadTypeName.split('_').filter(Boolean);
  if (parts.length > 1) return parts.map((part) => part.charAt(0)).join('').slice(0, 3);
  return payloadTypeName.slice(0, 3);
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
