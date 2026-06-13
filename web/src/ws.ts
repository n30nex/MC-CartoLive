import type { PublicLiveEnvelope } from './types';

export interface LiveSocket {
  close: () => void;
}

export const WS_RECONNECT_BASE_MS = 800;
export const WS_RECONNECT_MAX_MS = 15_000;
export const WS_RECONNECT_JITTER_MS = 500;

export function reconnectDelayMs(attempts: number, random = Math.random): number {
  const attempt = Math.max(0, Math.floor(attempts));
  const backoff = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * 2 ** Math.min(attempt, 5));
  return backoff + Math.floor(random() * WS_RECONNECT_JITTER_MS);
}

export function publicSocketSubscriptionsEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  return String(env['VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED'] ?? '').toLowerCase() === 'true';
}

export function connectPublicSocket(onMessage: (message: PublicLiveEnvelope) => void, onStatus: (status: string) => void, onOpen?: () => void): LiveSocket {
  if (typeof window.WebSocket !== 'function') {
    onStatus('polling');
    return { close: () => undefined };
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/public`;
  let socket: WebSocket | null = null;
  let closed = false;
  let retryTimer: number | undefined;
  let pingTimer: number | undefined;
  let attempts = 0;

  const clearPingTimer = () => {
    if (pingTimer !== undefined) window.clearInterval(pingTimer);
    pingTimer = undefined;
  };

  const scheduleReconnect = () => {
    if (closed || retryTimer !== undefined) return;
    onStatus('recovering');
    attempts += 1;
    const delay = reconnectDelayMs(attempts);
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, delay);
  };

  const handleSendFailure = () => {
    clearPingTimer();
    onStatus('error');
    const activeSocket = socket;
    socket = null;
    try {
      activeSocket?.close();
    } catch {
      // A failed close should still fall back to reconnect scheduling.
    }
    scheduleReconnect();
  };

  const sendJSON = (message: unknown): boolean => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      handleSendFailure();
      return false;
    }
  };

  const connect = () => {
    if (closed) return;
    onStatus(attempts === 0 ? 'connecting' : 'recovering');
    try {
      socket = new WebSocket(url);
    } catch {
      onStatus('error');
      scheduleReconnect();
      return;
    }
    socket.addEventListener('open', () => {
      attempts = 0;
      onStatus('live');
      onOpen?.();
      if (publicSocketSubscriptionsEnabled() && !sendJSON({ v: 1, type: 'subscribe', id: 'public-map' })) return;
      pingTimer = window.setInterval(() => {
        sendJSON({ type: 'ping' });
      }, 25_000);
    });
    socket.addEventListener('close', () => {
      clearPingTimer();
      if (closed) {
        onStatus('closed');
        return;
      }
      scheduleReconnect();
    });
    socket.addEventListener('error', () => onStatus('error'));
    socket.addEventListener('message', (event) => {
      try {
        onMessage(JSON.parse(event.data) as PublicLiveEnvelope);
      } catch {
        onStatus('bad-message');
      }
    });
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      clearPingTimer();
      socket?.close();
    }
  };
}
