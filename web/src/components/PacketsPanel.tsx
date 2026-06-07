import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Clock3, Copy, Filter, Maximize2, MessageSquareText, Minimize2, Play, RefreshCw, Route, Search, X } from 'lucide-react';
import { fetchPublicPackets } from '../api';
import { formatRelative } from '../lib/formatRelative';
import { isAbortError } from '../lib/isAbortError';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { DEFAULT_PACKET_FILTERS, packetEndpointSummary, PACKETS_SCOPE_OPTIONS, packetRegion, packetWindowForScope, type PacketFilters } from '../packets';
import { payloadLegendVisuals, payloadVisual } from '../payloadVisuals';
import type { PublicHistoryWindow, PublicPacketPath, PublicPacketScan } from '../types';
import { toggleWorkspacePresentation, workspacePresentationTitle, type WorkspacePresentation } from './workspacePanel';

export type PacketsPanelMode = 'expanded' | 'compactTray';

interface PacketsPanelProps {
  mode: PacketsPanelMode;
  selectedPacketID: string | null;
  selectedPacket: PublicPacketPath | null;
  presentation?: WorkspacePresentation;
  onClose: () => void;
  onExpand: () => void;
  onPresentationChange?: (presentation: WorkspacePresentation) => void;
  onResumeLive: () => void;
  onSelectPacket: (packet: PublicPacketPath) => void;
  onReplayPacket: (packet: PublicPacketPath) => void;
}

const PACKETS_PAGE_LIMIT = 500;
const PACKETS_RETAINED_LIMIT = 5000;
const PACKETS_FILTER_SCAN_PAGES = 3;
const PACKET_ROW_HEIGHT = 112;
const PACKET_LIST_OVERSCAN = 5;
const PACKET_FILTER_DEBOUNCE_MS = 250;

export default function PacketsPanel({
  mode,
  selectedPacketID,
  selectedPacket,
  presentation = 'side',
  onClose,
  onExpand,
  onPresentationChange,
  onResumeLive,
  onSelectPacket,
  onReplayPacket
}: PacketsPanelProps) {
  const [scopeMs, setScopeMs] = useState(PACKETS_SCOPE_OPTIONS[0].value);
  const [filters, setFilters] = useState<PacketFilters>(DEFAULT_PACKET_FILTERS);
  const [packets, setPackets] = useState<PublicPacketPath[]>([]);
  const [windowInfo, setWindowInfo] = useState<PublicHistoryWindow | null>(null);
  const [scanInfo, setScanInfo] = useState<PublicPacketScan | null>(null);
  const [nextCursor, setNextCursor] = useState('');
  const [lastCheckedAt, setLastCheckedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'more' | 'end'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(460);
  const [copyStatus, setCopyStatus] = useState('');
  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const filterGenerationRef = useRef(0);
  const debouncedFilters = useDebouncedValue(filters, PACKET_FILTER_DEBOUNCE_MS);
  const selectedFromList = useMemo(() => packets.find((packet) => packet.id === selectedPacketID) ?? null, [packets, selectedPacketID]);
  const activePacket = selectedPacket ?? selectedFromList;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      requestAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    filterGenerationRef.current += 1;
  }, [debouncedFilters, scopeMs]);

  const refresh = useCallback(() => {
    let active = true;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setLoading(true);
    setError(null);
    setSearchState(hasActivePacketFilters(debouncedFilters) ? 'searching' : 'idle');
    const window = packetWindowForScope(Date.now(), scopeMs);
    fetchPacketPages({ window, filters: debouncedFilters, targetCount: PACKETS_PAGE_LIMIT, signal: controller.signal })
      .then((response) => {
        if (!active || !mountedRef.current || generation !== requestGenerationRef.current) return;
        setPackets(capPackets(response.packets));
        setWindowInfo(response.window);
        setScanInfo(response.scan);
        setNextCursor(response.nextCursor ?? '');
        setSearchState(response.nextCursor ? 'more' : 'end');
        setLastCheckedAt(Date.now());
        setScrollTop(0);
        if (listRef.current) listRef.current.scrollTop = 0;
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (!active || !mountedRef.current || generation !== requestGenerationRef.current) return;
        setError(packetRequestErrorMessage(err));
      })
      .finally(() => {
        if (active && mountedRef.current && generation === requestGenerationRef.current) {
          if (requestAbortRef.current === controller) requestAbortRef.current = null;
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
      if (requestAbortRef.current === controller) requestAbortRef.current = null;
    };
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
    setSearchState(hasActivePacketFilters(debouncedFilters) ? 'searching' : 'idle');
    fetchPacketPages({
      window: { from: windowInfo.from, to: windowInfo.to },
      filters: debouncedFilters,
      cursor: nextCursor,
      targetCount: PACKETS_PAGE_LIMIT,
      signal: controller.signal
    })
      .then((response) => {
        if (controller.signal.aborted || !mountedRef.current || generation !== requestGenerationRef.current || filterGeneration !== filterGenerationRef.current) return;
        setPackets((current) => capPackets([...current, ...response.packets]));
        setNextCursor(response.nextCursor ?? '');
        setWindowInfo(response.window);
        setScanInfo(response.scan);
        setSearchState(response.nextCursor ? 'more' : 'end');
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (mountedRef.current && generation === requestGenerationRef.current && filterGeneration === filterGenerationRef.current) setError(packetRequestErrorMessage(err));
      })
      .finally(() => {
        if (!mountedRef.current) return;
        if (requestAbortRef.current === controller) requestAbortRef.current = null;
        setLoadingMore(false);
      });
  }, [debouncedFilters, loadingMore, nextCursor, windowInfo]);

  useEffect(() => {
    const cancelRefresh = refresh();
    const interval = window.setInterval(refresh, 20_000);
    return () => {
      cancelRefresh?.();
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    const updateHeight = () => {
      const element = listRef.current;
      if (element) setListHeight(Math.max(220, element.clientHeight || 460));
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [mode]);

  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(''), 2200);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const payloadOptions = useMemo(() => payloadLegendVisuals(), []);
  const virtualRows = useMemo(() => virtualPacketRows(packets, scrollTop, listHeight), [listHeight, packets, scrollTop]);

  const copyRouteIDs = useCallback(async (packet: PublicPacketPath) => {
    const text = packet.routeIds.join(',');
    if (!text) {
      setCopyStatus('No route IDs');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Route IDs copied');
    } catch {
      setCopyStatus(text);
    }
  }, []);

  if (mode === 'compactTray') {
    return (
      <section className="packets-compact-tray" aria-label="Selected packet replay">
        <div className="packets-tray-summary">
          <span className="panel-eyebrow">Packet replay</span>
          <strong>{activePacket ? packetEndpointSummary(activePacket) : 'No packet selected'}</strong>
          {activePacket && <small>{activePacket.hopCount} hops / {activePacket.distanceKm.toFixed(1)} km / {formatRelative(activePacket.at)}</small>}
        </div>
        <div className="packets-tray-actions">
          <button type="button" onClick={onExpand}>Expand</button>
          <button type="button" disabled={!activePacket} onClick={() => activePacket && onReplayPacket(activePacket)}>
            <Play size={14} />
            Replay again
          </button>
          <button type="button" onClick={onResumeLive}>Resume live</button>
          <button type="button" className="icon-button" title="Close packets" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={`packets-panel workspace-panel workspace-${presentation}`} aria-label="Packet routes">
      <header className="packets-panel-header">
        <div>
          <span className="panel-eyebrow">Packets</span>
          <p>Select route to view on map</p>
        </div>
        <div className="packets-panel-actions">
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
          <button type="button" className="icon-button" title="Refresh true path packets" onClick={refresh}>
            <RefreshCw size={17} />
          </button>
          <button type="button" className="icon-button" title="Close packets tab" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="packets-summary-strip">
        <PacketSummary icon={<Route size={15} />} label="Loaded" value={packets.length.toLocaleString()} />
        <PacketSummary icon={<Filter size={15} />} label="Scanned" value={scanInfo?.eventsScanned ? scanInfo.eventsScanned.toLocaleString() : windowInfo?.count.toLocaleString() ?? 'loading'} />
        <PacketSummary icon={<Clock3 size={15} />} label="Window" value={formatWindow(windowInfo)} />
        <PacketSummary icon={<MessageSquareText size={15} />} label="Updated" value={lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : 'loading'} />
      </div>

      <div className="packets-toolbar">
        <label className="packets-search">
          <Search size={15} />
          <input
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="Search endpoint, region, route prefix, message"
          />
          {filters.query && (
            <button type="button" onClick={() => setFilters((current) => ({ ...current, query: '' }))} aria-label="Clear packet search">
              <X size={14} />
            </button>
          )}
        </label>
        <label className="packets-iata-filter">
          <span>Region</span>
          <input
            value={filters.iata}
            maxLength={16}
            onChange={(event) => setFilters((current) => ({ ...current, iata: normalizeIataFilter(event.target.value) }))}
            placeholder="Any"
            aria-label="Filter packet region"
          />
        </label>
        <select value={filters.payload} onChange={(event) => setFilters((current) => ({ ...current, payload: event.target.value }))} aria-label="Filter packet payload">
          <option value="">All payloads</option>
          {payloadOptions.map((payload) => <option key={payload.className} value={payload.shortLabel === 'OTH' ? 'OTHER' : payload.label.toUpperCase().replace(/\s+/g, '_')}>{payload.label}</option>)}
        </select>
        <select value={filters.minHops} onChange={(event) => setFilters((current) => ({ ...current, minHops: Number(event.target.value) || 0 }))} aria-label="Filter minimum hops">
          <option value={0}>Any hops</option>
          <option value={2}>2+ hops</option>
          <option value={3}>3+ hops</option>
          <option value={5}>5+ hops</option>
        </select>
        <label className="packets-checkbox">
          <input type="checkbox" checked={filters.messageOnly} onChange={(event) => setFilters((current) => ({ ...current, messageOnly: event.target.checked }))} />
          <span>Messages</span>
        </label>
        <div className="packets-scopes" aria-label="Packet history window">
          {PACKETS_SCOPE_OPTIONS.map((option) => (
            <button key={option.label} type="button" className={scopeMs === option.value ? 'active' : ''} onClick={() => setScopeMs(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <PacketSearchStatus state={searchState} nextCursor={nextCursor} loading={loading || loadingMore} scan={scanInfo} />
      {error && <div className="packets-error" role="alert">{error}</div>}
      {loading && <div className="packets-loading-bar" />}

      <div className="packets-content">
        <div
          ref={listRef}
          className="packets-list virtual"
          role="list"
          aria-label="True path packet rows"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div style={{ height: packets.length * PACKET_ROW_HEIGHT, position: 'relative' }}>
            <div style={{ transform: `translateY(${virtualRows.offset}px)` }}>
              {virtualRows.items.map((packet) => (
                <PacketRow
                  key={packet.id}
                  packet={packet}
                  selected={packet.id === selectedPacketID}
                  onSelect={onSelectPacket}
                  onReplay={onReplayPacket}
                />
              ))}
            </div>
          </div>
          {!loading && packets.length === 0 && (
            <div className="packets-empty">
              {scanInfo?.partial
                ? 'No matches in the scanned slice yet. Load older to keep searching this window.'
                : 'No true path packets match the current filters.'}
            </div>
          )}
        </div>
        <PacketDetail packet={activePacket} copyStatus={copyStatus} onFocus={onSelectPacket} onReplay={onReplayPacket} onCopyRouteIDs={copyRouteIDs} />
      </div>

      <footer className="packets-footer">
        <button type="button" disabled={!nextCursor || loadingMore} onClick={loadOlder}>
          {loadingMore ? 'Searching...' : nextCursor ? 'Load older' : 'End of window'}
        </button>
      </footer>
    </section>
  );
}

function PacketSearchStatus({
  state,
  nextCursor,
  loading,
  scan
}: {
  state: 'idle' | 'searching' | 'more' | 'end';
  nextCursor: string;
  loading: boolean;
  scan: PublicPacketScan | null;
}) {
  const status = packetSearchStatus(state, nextCursor, loading, scan);
  return (
    <div className={`packets-search-status ${loading ? 'loading' : ''} ${nextCursor ? 'has-more' : ''}`}>
      <span>{status}</span>
    </div>
  );
}

function PacketRow({
  packet,
  selected,
  onSelect,
  onReplay
}: {
  packet: PublicPacketPath;
  selected: boolean;
  onSelect: (packet: PublicPacketPath) => void;
  onReplay: (packet: PublicPacketPath) => void;
}) {
  const visual = payloadVisual(packet.payloadTypeName);
  const path = packetEndpointSummary(packet);
  return (
    <article className={`packet-row ${selected ? 'selected' : ''}`} role="listitem">
      <button type="button" className="packet-row-main" onClick={() => onSelect(packet)} title="Focus this packet path on the map">
        <span className="packet-row-top">
          <span className="packet-payload" style={{ '--packet-color': visual.color } as CSSProperties}>
            <i />
            {visual.shortLabel}
          </span>
          <strong>{path}</strong>
          <em>{formatRelative(packet.at)}</em>
        </span>
        <span className="packet-row-meta">
          <span>{packetRegion(packet) || 'unknown'}</span>
          <span>{packet.hopCount} {packet.hopCount === 1 ? 'hop' : 'hops'}</span>
          <span>{packet.distanceKm.toFixed(1)} km</span>
          <span>{packet.segmentCount} {packet.segmentCount === 1 ? 'segment' : 'segments'}</span>
        </span>
        {packet.messageText && (
          <span className="packet-message-preview">
            {packet.messageSender && <b>{packet.messageSender}: </b>}
            {packet.messageText}
          </span>
        )}
      </button>
      <button type="button" className="packet-replay-button" onClick={() => onReplay(packet)} title="Replay this packet comet on the map">
        <Play size={15} />
        <span>Replay</span>
      </button>
    </article>
  );
}

function PacketDetail({
  packet,
  copyStatus,
  onFocus,
  onReplay,
  onCopyRouteIDs
}: {
  packet: PublicPacketPath | null;
  copyStatus: string;
  onFocus: (packet: PublicPacketPath) => void;
  onReplay: (packet: PublicPacketPath) => void;
  onCopyRouteIDs: (packet: PublicPacketPath) => void;
}) {
  if (!packet) {
    return (
      <aside className="packet-detail empty">
        <span className="panel-eyebrow">Details</span>
        <strong>Select a packet</strong>
        <p>Focus or replay any true public path from the list.</p>
      </aside>
    );
  }
  const visual = payloadVisual(packet.payloadTypeName);
  return (
    <aside className="packet-detail">
      <div className="packet-detail-title">
        <span className="packet-payload" style={{ '--packet-color': visual.color } as CSSProperties}><i />{visual.shortLabel}</span>
        <strong>{packetEndpointSummary(packet)}</strong>
      </div>
      <dl className="packet-detail-grid">
        <div><dt>Region</dt><dd>{packetRegion(packet) || 'unknown'}</dd></div>
        <div><dt>Heard</dt><dd>{new Date(packet.at).toLocaleString()}</dd></div>
        <div><dt>Age</dt><dd>{formatRelative(packet.at)}</dd></div>
        <div><dt>Path</dt><dd>{packet.hopCount} hops / {packet.segmentCount} segments</dd></div>
        <div><dt>Distance</dt><dd>{packet.distanceKm.toFixed(1)} km</dd></div>
        <div><dt>Payload</dt><dd>{visual.label}</dd></div>
      </dl>
      {packet.messageText && (
        <blockquote className="packet-detail-message">
          {packet.messageSender && <b>{packet.messageSender}: </b>}
          {packet.messageText}
        </blockquote>
      )}
      <div className="packet-detail-actions">
        <button type="button" onClick={() => onFocus(packet)}>Focus</button>
        <button type="button" onClick={() => onReplay(packet)}><Play size={14} />Replay</button>
        <button type="button" onClick={() => onCopyRouteIDs(packet)}><Copy size={14} />Copy route IDs</button>
      </div>
      {copyStatus && <span className="packet-copy-status">{copyStatus}</span>}
      <div className="packet-segment-list" aria-label="Public packet segments">
        {packet.segments.map((segment, index) => (
          <div key={`${segment.routeId}-${index}`} className="packet-segment">
            <span>{index + 1}</span>
            <strong>{segment.from.label}{' -> '}{segment.to.label}</strong>
            <em>{segment.distanceKm.toFixed(1)} km</em>
          </div>
        ))}
      </div>
    </aside>
  );
}

function PacketSummary({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="packet-summary">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function fetchPacketPages({
  window,
  filters,
  cursor,
  targetCount,
  signal
}: {
  window: { from: number; to: number };
  filters: PacketFilters;
  cursor?: string;
  targetCount: number;
  signal?: AbortSignal;
}): Promise<{ packets: PublicPacketPath[]; nextCursor: string; window: PublicHistoryWindow; scan: PublicPacketScan }> {
  const activeFilters = hasActivePacketFilters(filters);
  const packets: PublicPacketPath[] = [];
  let nextCursor = cursor ?? '';
  let latestWindow: PublicHistoryWindow | null = null;
  let eventsScanned = 0;
  let scanLimit = 0;
  let pages = 0;

  do {
    const response = await fetchPublicPackets({
      from: window.from,
      to: window.to,
      limit: PACKETS_PAGE_LIMIT,
      cursor: nextCursor || undefined,
      signal,
      ...filtersToParams(filters)
    });
    packets.push(...response.packets);
    latestWindow = response.window;
    eventsScanned += response.scan?.eventsScanned ?? 0;
    scanLimit += response.scan?.scanLimit ?? 0;
    nextCursor = response.nextCursor ?? '';
    pages += 1;
    if (!activeFilters) break;
  } while (nextCursor && packets.length < targetCount && pages < PACKETS_FILTER_SCAN_PAGES);

  const deduped = dedupePackets(packets).slice(0, targetCount);
  return {
    packets: deduped,
    nextCursor,
    window: { ...(latestWindow ?? { from: window.from, to: window.to, count: 0 }), count: deduped.length },
    scan: {
      eventsScanned,
      scanLimit,
      filtered: activeFilters,
      partial: Boolean(nextCursor)
    }
  };
}

function dedupePackets(items: PublicPacketPath[]): PublicPacketPath[] {
  const seen = new Set<string>();
  const out: PublicPacketPath[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function capPackets(items: PublicPacketPath[]): PublicPacketPath[] {
  return dedupePackets(items).slice(0, PACKETS_RETAINED_LIMIT);
}

function hasActivePacketFilters(filters: PacketFilters): boolean {
  return Boolean(filters.query.trim() || filters.iata || filters.payload || filters.minHops || filters.messageOnly);
}

export function packetFooterStatus(
  packet: PublicPacketPath | null,
  state: 'idle' | 'searching' | 'more' | 'end',
  nextCursor: string,
  loadingMore: boolean,
  scan: PublicPacketScan | null
): string {
  void scan;
  if (loadingMore || state === 'searching') return 'Searching older packets...';
  if (packet) return `Selected ${packetEndpointSummary(packet)}`;
  if (nextCursor || state === 'more') return 'More packet paths available.';
  if (state === 'end') return 'End of the selected history window.';
  return 'Select a packet to focus its real path on the map.';
}

export function formatPacketScanStatus(scan: PublicPacketScan | null): string {
  if (!scan || !scan.eventsScanned) return '';
  const scanned = compactCount(scan.eventsScanned);
  if (scan.partial) {
    return `Searched ${scanned} routes`;
  }
  return `Searched ${scanned} routes`;
}

export function packetSearchStatus(state: 'idle' | 'searching' | 'more' | 'end', nextCursor: string, loading: boolean, scan: PublicPacketScan | null): string {
  const scanStatus = formatPacketScanStatus(scan);
  if (loading || state === 'searching') {
    return scanStatus ? `Searching... ${scanStatus}` : 'Searching history';
  }
  if (nextCursor || state === 'more') {
    return scanStatus ? `${scanStatus} · Load older for more` : 'More routes available';
  }
  if (state === 'end') {
    return scanStatus || 'End of window';
  }
  return 'Server-backed filters';
}

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

function packetRequestErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err || '');
  if (message.includes('context deadline') || message.includes('500')) {
    return 'Packet search is still catching up. Try a narrower window, region, payload, or hop filter.';
  }
  return message || 'Unable to load packet paths';
}

function normalizeIataFilter(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

function filtersToParams(filters: PacketFilters) {
  return {
    region: filters.iata || undefined,
    payload: filters.payload || undefined,
    minHops: filters.minHops || undefined,
    messageOnly: filters.messageOnly || undefined,
    q: filters.query.trim() || undefined
  };
}

function virtualPacketRows(packets: PublicPacketPath[], scrollTop: number, height: number): { offset: number; items: PublicPacketPath[] } {
  const start = Math.max(0, Math.floor(scrollTop / PACKET_ROW_HEIGHT) - PACKET_LIST_OVERSCAN);
  const end = Math.min(packets.length, Math.ceil((scrollTop + height) / PACKET_ROW_HEIGHT) + PACKET_LIST_OVERSCAN);
  return { offset: start * PACKET_ROW_HEIGHT, items: packets.slice(start, end) };
}

function formatWindow(window: PublicHistoryWindow | null): string {
  if (!window) return 'loading';
  const span = Math.max(0, window.to - window.from);
  if (span >= 23 * 60 * 60_000) return '24h';
  if (span >= 5 * 60 * 60_000) return '6h';
  return '1h';
}
