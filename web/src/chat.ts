import type { PublicChatMessage } from './types';

export const CHAT_SCOPE_OPTIONS = [
  { label: '1h', value: 60 * 60_000 },
  { label: '6h', value: 6 * 60 * 60_000 },
  { label: '24h', value: 24 * 60 * 60_000 }
] as const;

export const CHAT_DISPLAY_DEDUPE_WINDOW_MS = 15 * 60_000;

export interface ChatFilters {
  query: string;
  region: string;
  channel: string;
}

export const DEFAULT_CHAT_FILTERS: ChatFilters = {
  query: '',
  region: '',
  channel: ''
};

const HEX_TOKEN_RE = /\b(?:0x)?[a-f0-9]{16,}\b/gi;
const BASE64_TOKEN_RE = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g;
const PATH_HEX_RE = /\b(?:[a-f0-9]{2}[:\-\s]){5,}[a-f0-9]{2}\b/gi;
const SECRET_PAIR_RE = /\b(?:broker|resolver|debug|secret|token|key|hash|payload|path)[\w.-]*\s*[:=]\s*\S+/gi;

export function chatWindowForScope(now: number, scopeMs: number): { from: number; to: number } {
  const to = Math.max(0, Math.round(now));
  return { from: Math.max(0, to - scopeMs), to };
}

export function chatRegion(message: Pick<PublicChatMessage, 'region' | 'iata'>): string {
  return message.region ?? message.iata ?? '';
}

export function normalizeChatFilter(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_ -]/g, '').slice(0, 32);
}

export function safeChatText(value: string | undefined, fallback = ''): string {
  const text = (value ?? fallback).replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text
    .replace(SECRET_PAIR_RE, '[redacted]')
    .replace(PATH_HEX_RE, '[redacted path]')
    .replace(HEX_TOKEN_RE, '[redacted id]')
    .replace(BASE64_TOKEN_RE, '[redacted key]');
}

export function safeChatMessage(message: PublicChatMessage): PublicChatMessage {
  return {
    ...message,
    sender: safeChatText(message.sender, 'Unknown'),
    text: safeChatText(message.text, ''),
    channelLabel: safeChatText(message.channelLabel, 'Public'),
    payloadTypeName: safeChatText(message.payloadTypeName, 'Message'),
    source: undefined,
    routeIds: undefined
  };
}

export function chatSearchFields(message: PublicChatMessage): string[] {
  const safe = safeChatMessage(message);
  return [
    chatRegion(safe),
    safe.sender ?? '',
    safe.text,
    safe.channelLabel ?? '',
    safe.payloadTypeName,
    safe.anchor?.label ?? '',
    ...(safe.endpointLabels ?? [])
  ].filter(Boolean);
}

export function chatMatchesFilters(message: PublicChatMessage, filters: ChatFilters): boolean {
  const query = filters.query.trim().toLowerCase();
  const region = normalizeChatFilter(filters.region);
  const channel = filters.channel.trim().toLowerCase();
  if (region && chatRegion(message).toUpperCase() !== region) return false;
  if (channel && (message.channelLabel ?? '').toLowerCase() !== channel) return false;
  if (!query) return true;
  return chatSearchFields(message).some((field) => field.toLowerCase().includes(query));
}

export function filterChatMessages(messages: PublicChatMessage[], filters: ChatFilters): PublicChatMessage[] {
  return messages.filter((message) => chatMatchesFilters(message, filters));
}

export function dedupeChatMessages(messages: PublicChatMessage[]): PublicChatMessage[] {
  const seenIds = new Set<string>();
  const seenPublicMessages = new Map<string, number>();
  const out: PublicChatMessage[] = [];
  for (const message of messages) {
    if (seenIds.has(message.id)) continue;
    const safe = safeChatMessage(message);
    const displayKey = chatDisplayDedupeKey(safe);
    if (displayKey) {
      const previousAt = seenPublicMessages.get(displayKey);
      if (previousAt !== undefined && chatWithinDedupeWindow(previousAt, safe.at)) continue;
      seenPublicMessages.set(displayKey, safe.at);
    }
    seenIds.add(message.id);
    out.push(safe);
  }
  return out;
}

export function chatChannelOptions(messages: PublicChatMessage[]): string[] {
  return [...new Set(messages.map((message) => safeChatText(message.channelLabel, '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function chatDisplayDedupeKey(message: PublicChatMessage): string {
  const sender = normalizeDisplayToken(message.sender);
  const text = normalizeDisplayToken(message.text);
  const channel = normalizeDisplayToken(message.channelLabel);
  const payload = normalizeDisplayToken(message.payloadTypeName);
  if (!sender || !text) return '';
  return `${sender}|${text}|${channel}|${payload}`;
}

function chatWithinDedupeWindow(a: number, b: number): boolean {
  return Math.abs(a - b) <= CHAT_DISPLAY_DEDUPE_WINDOW_MS;
}

function normalizeDisplayToken(value: string | undefined): string {
  return safeChatText(value, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
