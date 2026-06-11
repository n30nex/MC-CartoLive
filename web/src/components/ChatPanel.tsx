import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Maximize2, MessageSquareText, Minimize2, RefreshCw, Search, X } from 'lucide-react';
import { fetchPublicChat } from '../api';
import { formatRelative } from '../lib/formatRelative';
import { isAbortError } from '../lib/isAbortError';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import {
  CHAT_SCOPE_OPTIONS,
  DEFAULT_CHAT_FILTERS,
  chatRegion,
  chatWindowForScope,
  dedupeChatMessages,
  normalizeChatFilter,
  safeChatText,
  type ChatFilters
} from '../chat';
import type { PublicChatMessage, PublicHistoryWindow } from '../types';
import { toggleWorkspacePresentation, workspacePresentationTitle, type WorkspacePresentation } from './workspacePanel';

interface ChatPanelProps {
  initialMessages?: PublicChatMessage[];
  initialError?: string | null;
  autoRefresh?: boolean;
  presentation?: WorkspacePresentation;
  onPresentationChange?: (presentation: WorkspacePresentation) => void;
  onClose: () => void;
}

const CHAT_PAGE_LIMIT = 200;
const CHAT_RETAINED_LIMIT = 1000;
const CHAT_FILTER_DEBOUNCE_MS = 250;
const CHAT_ROW_HEIGHT = 96;
const CHAT_LIST_OVERSCAN = 5;

export default function ChatPanel({
  initialMessages = [],
  initialError = null,
  autoRefresh = true,
  presentation = 'side',
  onPresentationChange,
  onClose
}: ChatPanelProps) {
  const [scopeMs, setScopeMs] = useState(CHAT_SCOPE_OPTIONS[0].value);
  const [filters, setFilters] = useState<ChatFilters>(DEFAULT_CHAT_FILTERS);
  const [messages, setMessages] = useState<PublicChatMessage[]>(() => dedupeChatMessages(initialMessages));
  const prevInitialLenRef = useRef(initialMessages.length);
  const [windowInfo, setWindowInfo] = useState<PublicHistoryWindow | null>(null);
  const [nextCursor, setNextCursor] = useState('');
  const [serverTime, setServerTime] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState(0);
  const [loading, setLoading] = useState(autoRefresh && initialMessages.length === 0 && !initialError);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(460);
  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const filterGenerationRef = useRef(0);
  const initialLoadRef = useRef(true);
  const debouncedFilters = useDebouncedValue(filters, CHAT_FILTER_DEBOUNCE_MS);
  const visibleMessages = useMemo(() => capChatMessages(messages), [messages]);
  const virtualRows = useMemo(() => virtualChatRows(visibleMessages, scrollTop, listHeight), [visibleMessages, scrollTop, listHeight]);

  useEffect(() => {
    const updateHeight = () => {
      const element = listRef.current;
      if (element) setListHeight(Math.max(220, element.clientHeight || 460));
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      requestAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (initialMessages.length > 0 && prevInitialLenRef.current === 0) {
      setMessages(dedupeChatMessages(initialMessages));
    }
    prevInitialLenRef.current = initialMessages.length;
  }, [initialMessages]);

  const refresh = useCallback(() => {
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    filterGenerationRef.current += 1;
    setLoading(true);
    setMessages([]);
    setWindowInfo(null);
    setServerTime(0);
    setNextCursor('');
    setError(null);
    const window = chatWindowForScope(Date.now(), scopeMs);
    fetchPublicChat({
      from: window.from,
      to: window.to,
      limit: CHAT_PAGE_LIMIT,
      region: debouncedFilters.region || undefined,
      channel: debouncedFilters.channel || undefined,
      q: debouncedFilters.query.trim() || undefined,
      signal: controller.signal
    })
      .then((response) => {
        if (controller.signal.aborted || !mountedRef.current || generation !== requestGenerationRef.current) return;
        setMessages(capChatMessages(response.messages));
        setWindowInfo(response.window);
        setNextCursor(response.nextCursor ?? '');
        setServerTime(response.serverTime);
        setLastCheckedAt(Date.now());
        initialLoadRef.current = false;
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (mountedRef.current && generation === requestGenerationRef.current) setError(chatRequestErrorMessage(err));
      })
      .finally(() => {
        if (!mountedRef.current || generation !== requestGenerationRef.current) return;
        if (requestAbortRef.current === controller) requestAbortRef.current = null;
        setLoading(false);
      });
  }, [debouncedFilters, scopeMs]);

  const loadOlder = useCallback(() => {
    if (!windowInfo || !nextCursor || loadingMore) return;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const generation = requestGenerationRef.current;
    const filterGeneration = filterGenerationRef.current;
    setLoadingMore(true);
    setError(null);
    fetchPublicChat({
      from: windowInfo.from,
      to: windowInfo.to,
      limit: CHAT_PAGE_LIMIT,
      cursor: nextCursor,
      region: debouncedFilters.region || undefined,
      channel: debouncedFilters.channel || undefined,
      q: debouncedFilters.query.trim() || undefined,
      signal: controller.signal
    })
      .then((response) => {
        if (controller.signal.aborted || !mountedRef.current || generation !== requestGenerationRef.current || filterGeneration !== filterGenerationRef.current) return;
        setMessages((current) => capChatMessages([...current, ...response.messages]));
        setWindowInfo(response.window);
        setNextCursor(response.nextCursor ?? '');
        setServerTime(response.serverTime);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (mountedRef.current && generation === requestGenerationRef.current && filterGeneration === filterGenerationRef.current) setError(chatRequestErrorMessage(err));
      })
      .finally(() => {
        if (!mountedRef.current) return;
        if (generation !== requestGenerationRef.current) return;
        if (filterGeneration !== filterGenerationRef.current) return;
        if (requestAbortRef.current === controller) requestAbortRef.current = null;
        setLoadingMore(false);
      });
  }, [debouncedFilters, loadingMore, nextCursor, windowInfo]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    refresh();
    const interval = window.setInterval(refresh, 20_000);
    return () => {
      requestAbortRef.current?.abort();
      window.clearInterval(interval);
    };
  }, [autoRefresh, refresh]);

  const channelOptions = useMemo(() => {
    const channelLabels = new Set(visibleMessages.map((m) => m.channelLabel).filter(Boolean));
    if (filters.channel) channelLabels.add(filters.channel);
    return [...channelLabels].sort();
  }, [visibleMessages, filters.channel]);

  return (
    <section className={`chat-panel workspace-panel workspace-${presentation}`} aria-label="Public chat">
      <header className="chat-panel-header">
        <div>
          <span className="panel-eyebrow">Chat</span>
          <p>Public messages from map-safe packet fields</p>
        </div>
        <div className="chat-panel-actions">
          {onPresentationChange && (
            <button
              type="button"
              className="icon-button"
              title={workspacePresentationTitle(presentation)}
              aria-label={workspacePresentationTitle(presentation)}
              onClick={() => onPresentationChange(toggleWorkspacePresentation(presentation))}
            >
              {presentation === 'fullscreen' ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          )}
          <button type="button" className="icon-button" title="Refresh public chat" onClick={refresh}>
            <RefreshCw size={17} />
          </button>
          <button type="button" className="icon-button" title="Close chat" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="chat-summary-strip">
        <ChatSummary icon={<MessageSquareText size={15} />} label="Loaded" value={visibleMessages.length.toLocaleString()} />
        <ChatSummary icon={<Clock3 size={15} />} label="Window" value={formatWindow(windowInfo, scopeMs)} />
        <ChatSummary icon={<RefreshCw size={15} />} label="Updated" value={lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : 'pending'} />
        <ChatSummary icon={<Clock3 size={15} />} label="Server" value={serverTime ? formatRelative(serverTime) : 'pending'} />
      </div>

      <div className="chat-toolbar">
        <label className="chat-search">
          <Search size={15} />
          <input
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="Search sender, message, region, channel"
          />
          {filters.query && (
            <button type="button" onClick={() => setFilters((current) => ({ ...current, query: '' }))} aria-label="Clear chat search">
              <X size={14} />
            </button>
          )}
        </label>
        <label className="chat-region-filter">
          <span>Region</span>
          <input
            value={filters.region}
            maxLength={32}
            onChange={(event) => setFilters((current) => ({ ...current, region: normalizeChatFilter(event.target.value) }))}
            placeholder="Any"
            aria-label="Filter chat region"
          />
        </label>
        <select value={filters.channel} onChange={(event) => setFilters((current) => ({ ...current, channel: event.target.value }))} aria-label="Filter chat channel">
          <option value="">All channels</option>
          {channelOptions.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
        </select>
        <div className="chat-scopes" aria-label="Chat history window">
          {CHAT_SCOPE_OPTIONS.map((option) => (
            <button key={option.label} type="button" className={scopeMs === option.value ? 'active' : ''} onClick={() => setScopeMs(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="chat-error" role="alert">{error}</div>}
      {loading && initialLoadRef.current && <div className="chat-loading-bar" />}

      <div
        ref={listRef}
        className="chat-list"
        role="list"
        aria-label="Public chat messages"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: visibleMessages.length * CHAT_ROW_HEIGHT, position: 'relative' }}>
          <div style={{ transform: `translateY(${virtualRows.offset}px)` }}>
            {virtualRows.items.map((message) => <ChatRow key={message.id} message={message} />)}
          </div>
        </div>
        {!loading && visibleMessages.length === 0 && (
          <div className="chat-empty">
            {hasActiveChatFilters(debouncedFilters) ? 'No public chat messages match the current filters.' : 'No public chat messages in this window.'}
          </div>
        )}
      </div>

      <footer className="chat-footer">
        <span>{chatFooterStatus(visibleMessages.length, nextCursor, loadingMore)}</span>
        <button type="button" disabled={!nextCursor || loadingMore} onClick={loadOlder}>
          {loadingMore ? 'Loading...' : nextCursor ? 'Load older' : 'End of window'}
        </button>
      </footer>
    </section>
  );
}

function ChatRow({ message }: { message: PublicChatMessage }) {
  const region = safeChatText(chatRegion(message), 'unknown');
  const channel = safeChatText(message.channelLabel, 'Public');
  const sender = safeChatText(message.sender, 'Unknown');
  const text = safeChatText(message.text, '');
  const payload = safeChatText(message.payloadTypeName, 'Message');
  const endpoints = (message.endpointLabels ?? []).map((label) => safeChatText(label, '')).filter(Boolean);
  const anchorLabel = safeChatText(message.anchor?.label, '');
  return (
    <article className="chat-row" role="listitem">
      <div className="chat-row-top">
        <strong>{sender || 'Unknown'}</strong>
        <span>{region}</span>
        <em>{formatRelative(message.at)}</em>
      </div>
      {text ? <p>{text}</p> : <p className="chat-muted">Message text unavailable</p>}
      <div className="chat-row-meta">
        <span>{channel || 'Public'}</span>
        <span>{payload || 'Message'}</span>
        {anchorLabel && <span>{anchorLabel}</span>}
        {endpoints.length > 0 && <span>{endpointSummary(endpoints)}</span>}
      </div>
    </article>
  );
}

function ChatSummary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="chat-summary">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function capChatMessages(messages: PublicChatMessage[]): PublicChatMessage[] {
  return dedupeChatMessages(messages).slice(0, CHAT_RETAINED_LIMIT);
}

function hasActiveChatFilters(filters: ChatFilters): boolean {
  return Boolean(filters.query.trim() || filters.region || filters.channel);
}

export function chatFooterStatus(count: number, nextCursor: string, loadingMore: boolean): string {
  if (loadingMore) return 'Loading older messages...';
  if (nextCursor) return `${count.toLocaleString()} loaded - older available`;
  if (count > 0) return `${count.toLocaleString()} loaded`;
  return 'No messages loaded';
}

function endpointSummary(labels: string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels[0]} -> ${labels[labels.length - 1]}`;
}

function formatWindow(window: PublicHistoryWindow | null, scopeMs: number): string {
  const span = window ? Math.max(0, window.to - window.from) : scopeMs;
  if (span >= 23 * 60 * 60_000) return '24h';
  if (span >= 5 * 60 * 60_000) return '6h';
  return '1h';
}

function chatRequestErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err || '');
  return message || 'Unable to load public chat';
}

function virtualChatRows(messages: PublicChatMessage[], scrollTop: number, height: number): { offset: number; items: PublicChatMessage[] } {
  const start = Math.max(0, Math.floor(scrollTop / CHAT_ROW_HEIGHT) - CHAT_LIST_OVERSCAN);
  const end = Math.min(messages.length, Math.ceil((scrollTop + height) / CHAT_ROW_HEIGHT) + CHAT_LIST_OVERSCAN);
  return { offset: start * CHAT_ROW_HEIGHT, items: messages.slice(start, end) };
}
