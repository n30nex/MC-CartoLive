import { afterEach, describe, expect, it, vi } from 'vitest';
import { WS_INBOUND_SILENCE_MS, WS_RECONNECT_BASE_MS, WS_RECONNECT_MAX_MS, connectPublicSocket, publicSocketSubscriptionsEnabled, reconnectDelayMs } from './ws';

const originalWebSocket = window.WebSocket;

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, 'WebSocket', {
    configurable: true,
    writable: true,
    value: originalWebSocket
  });
});

describe('public websocket reconnect backoff', () => {
  it('uses capped exponential backoff with bounded jitter', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(WS_RECONNECT_BASE_MS);
    expect(reconnectDelayMs(1, () => 0)).toBe(WS_RECONNECT_BASE_MS * 2);
    expect(reconnectDelayMs(20, () => 0)).toBe(WS_RECONNECT_MAX_MS);
    expect(reconnectDelayMs(20, () => 0.99)).toBeLessThan(WS_RECONNECT_MAX_MS + 500);
  });

  it('keeps scoped subscriptions opt-in', () => {
    expect(publicSocketSubscriptionsEnabled({ VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED: 'false' })).toBe(false);
    expect(publicSocketSubscriptionsEnabled({ VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED: 'true' })).toBe(true);
  });

  it('falls back to recovering when WebSocket construction throws', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    class BlockingWebSocket {
      static readonly OPEN = 1;

      constructor() {
        throw new Error('blocked');
      }
    }
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: BlockingWebSocket
    });

    const socket = connectPublicSocket(() => undefined, (status) => statuses.push(status));

    expect(statuses).toEqual(['connecting', 'error', 'recovering']);
    socket.close();
  });

  it('recovers when a live ping send fails', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const sockets: FakeWebSocket[] = [];
    class ThrowingPingWebSocket extends FakeWebSocket {
      override send(data: string) {
        super.send(data);
        if (data.includes('"ping"')) {
          throw new Error('send failed');
        }
      }
    }
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: class extends ThrowingPingWebSocket {
        constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      }
    });

    const socket = connectPublicSocket(() => undefined, (status) => statuses.push(status));
    sockets[0].emit('open');
    vi.advanceTimersByTime(25_000);

    expect(sockets[0].sent[0]).toContain('"ping"');
    expect(sockets[0].closed).toBe(true);
    expect(statuses).toEqual(['connecting', 'live', 'error', 'recovering']);
    socket.close();
  });

  it('reconnects after prolonged inbound silence and refreshes liveness on every frame', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const sockets: FakeWebSocket[] = [];
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: class extends FakeWebSocket {
        constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      }
    });

    const socket = connectPublicSocket(() => undefined, (status) => statuses.push(status));
    sockets[0].emit('open');
    vi.advanceTimersByTime(WS_INBOUND_SILENCE_MS - 1_000);
    sockets[0].emit('message', { data: JSON.stringify({ v: 1, type: 'pong' }) });
    vi.advanceTimersByTime(1_001);
    expect(sockets[0].closed).toBe(false);
    vi.advanceTimersByTime(WS_INBOUND_SILENCE_MS);
    expect(sockets[0].closed).toBe(true);
    expect(statuses).toContain('stale');
    expect(statuses.at(-1)).toBe('recovering');
    socket.close();
  });
});

type FakeListener = (event: { data?: string }) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, FakeListener[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: FakeListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  emit(type: string, event: { data?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
