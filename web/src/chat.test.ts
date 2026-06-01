import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAT_FILTERS,
  chatChannelOptions,
  chatWindowForScope,
  dedupeChatMessages,
  filterChatMessages,
  safeChatText
} from './chat';
import type { PublicChatMessage } from './types';

const message = (overrides: Partial<PublicChatMessage> = {}): PublicChatMessage => ({
  id: 'chat-1',
  at: 1_000,
  region: 'ON',
  iata: 'YYZ',
  sender: 'Alice',
  text: 'hello mesh',
  channelLabel: 'Public',
  payloadTypeName: 'PLAIN_TEXT',
  endpointLabels: ['Alpha', 'Bravo'],
  routeIds: ['route-private'],
  source: 'broker-debug',
  ...overrides
});

describe('chat helpers', () => {
  it('filters public chat by query, region, and channel', () => {
    const items = [
      message(),
      message({ id: 'chat-2', region: 'QC', iata: 'YUL', sender: 'Bob', text: 'weather check', channelLabel: 'Ops' })
    ];

    expect(filterChatMessages(items, { ...DEFAULT_CHAT_FILTERS, query: 'mesh' }).map((item) => item.id)).toEqual(['chat-1']);
    expect(filterChatMessages(items, { ...DEFAULT_CHAT_FILTERS, region: 'QC' }).map((item) => item.id)).toEqual(['chat-2']);
    expect(filterChatMessages(items, { ...DEFAULT_CHAT_FILTERS, channel: 'Ops' }).map((item) => item.id)).toEqual(['chat-2']);
  });

  it('dedupes and strips fields that should not be rendered by the chat UI', () => {
    const deduped = dedupeChatMessages([message(), message({ text: 'duplicate' })]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].source).toBeUndefined();
    expect(deduped[0].routeIds).toBeUndefined();
  });

  it('redacts obvious hashes, keys, path hex, and debug pairs from display text', () => {
    expect(safeChatText('hash=abcdefabcdefabcdef raw 01:02:03:04:05:06 token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN')).toBe(
      '[redacted] raw [redacted path] [redacted]'
    );
  });

  it('builds bounded fetch windows and channel options', () => {
    expect(chatWindowForScope(100_000, 60_000)).toEqual({ from: 40_000, to: 100_000 });
    expect(chatWindowForScope(10_000, 60_000)).toEqual({ from: 0, to: 10_000 });
    expect(chatChannelOptions([message({ channelLabel: 'Ops' }), message({ id: 'chat-2', channelLabel: 'Public' }), message({ id: 'chat-3', channelLabel: 'Ops' })])).toEqual([
      'Ops',
      'Public'
    ]);
  });
});
