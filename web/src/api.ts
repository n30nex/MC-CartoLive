import type { PublicChatResponse, PublicHistoryResponse, PublicHistorySummaryResponse, PublicLiveState, PublicPacketsResponse, RuntimeHealth } from './types';

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function fetchPublicState(): Promise<PublicLiveState> {
  return getJSON<PublicLiveState>('/api/v1/public/state');
}

export function fetchHealthz(): Promise<RuntimeHealth> {
  return getJSON<RuntimeHealth>('/healthz');
}

export function fetchReadyz(): Promise<RuntimeHealth> {
  return getJSON<RuntimeHealth>('/readyz');
}

export interface PublicHistoryParams {
  from: number;
  to: number;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export function fetchPublicHistory({ from, to, limit, cursor, signal }: PublicHistoryParams): Promise<PublicHistoryResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (limit !== undefined) params.set('limit', Math.round(limit).toString());
  if (cursor) params.set('cursor', cursor);
  return getJSON<PublicHistoryResponse>(`/api/v1/public/history?${params.toString()}`, signal);
}

export interface PublicPacketsParams extends PublicHistoryParams {
  iata?: string;
  region?: string;
  payload?: string;
  minHops?: number;
  messageOnly?: boolean;
  q?: string;
}

export function fetchPublicPackets({ from, to, limit, cursor, iata, region, payload, minHops, messageOnly, q, signal }: PublicPacketsParams): Promise<PublicPacketsResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (limit !== undefined) params.set('limit', Math.round(limit).toString());
  if (cursor) params.set('cursor', cursor);
  if (region || iata) params.set('region', region ?? iata ?? '');
  if (payload) params.set('payload', payload);
  if (minHops !== undefined && minHops > 0) params.set('minHops', Math.round(minHops).toString());
  if (messageOnly) params.set('messageOnly', 'true');
  if (q) params.set('q', q);
  return getJSON<PublicPacketsResponse>(`/api/v1/public/packets?${params.toString()}`, signal);
}

export interface PublicChatParams extends PublicHistoryParams {
  iata?: string;
  region?: string;
  channel?: string;
  q?: string;
}

export function fetchPublicChat({ from, to, limit, cursor, iata, region, channel, q, signal }: PublicChatParams): Promise<PublicChatResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (limit !== undefined) params.set('limit', Math.round(limit).toString());
  if (cursor) params.set('cursor', cursor);
  if (region) params.set('region', region);
  if (iata) params.set('iata', iata);
  if (channel) params.set('channel', channel);
  if (q) params.set('q', q);
  return getJSON<PublicChatResponse>(`/api/v1/public/chat?${params.toString()}`, signal);
}

export interface PublicHistorySummaryParams {
  from: number;
  to: number;
  bucketMs?: number;
  signal?: AbortSignal;
}

export function fetchPublicHistorySummary({ from, to, bucketMs, signal }: PublicHistorySummaryParams): Promise<PublicHistorySummaryResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (bucketMs !== undefined) params.set('bucketMs', Math.round(bucketMs).toString());
  return getJSON<PublicHistorySummaryResponse>(`/api/v1/public/history/summary?${params.toString()}`, signal);
}
