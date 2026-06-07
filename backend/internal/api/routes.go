package api

import (
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"meshcore-canada-live-map/backend/internal/live"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/store"
)

var gzipWriterPool = sync.Pool{New: func() any { return gzip.NewWriter(io.Discard) }}

type Config struct {
	RecentPacketLimit      int
	RecentEdgeEventLimit   int
	DefaultCenterLat       float64
	DefaultCenterLng       float64
	DefaultZoom            float64
	DefaultRegion          string
	MapRegionPreset        string
	MapBounds              live.CoordinateBounds
	PublicMode             bool
	StrictRFOnly           bool
	MaxUnverifiedEdgeKM    float64
	AppVersion             string
	GitSHA                 string
	BuildTime              string
	PublicIATARestricted   bool
	PublicRegionRestricted bool
}

type Server struct {
	Config            Config
	Store             *store.Store
	Hub               *live.Hub
	PublicHub         *live.Hub
	Runtime           *live.RuntimeStats
	Log               *slog.Logger
	MQTTConnected     func() bool
	MQTTTotal         func() int64
	MQTTStatus        func(time.Time) imqtt.Status
	PublicState       func() (live.PublicLiveState, bool)
	PublicCacheStatus func(time.Time) live.PublicCacheStatus
	PublicAllowsIATA  func(string) bool
	SolarConditions   func() any

	historyLocations *historyLocationCache
	summaryCache     *historySummaryCache
}

func (s *Server) Routes() http.Handler {
	if s.historyLocations == nil {
		s.historyLocations = &historyLocationCache{}
	}
	if s.summaryCache == nil {
		s.summaryCache = newHistorySummaryCache(20 * time.Second)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("GET /readyz", s.readyz)
	mux.HandleFunc("GET /api/v1/public/state", s.publicState)
	mux.HandleFunc("GET /api/v1/public/history", s.publicHistory)
	mux.HandleFunc("GET /api/v1/public/history/summary", s.publicHistorySummary)
	mux.HandleFunc("GET /api/v1/public/packets", s.publicPackets)
	mux.HandleFunc("GET /api/v1/public/chat", s.publicChat)
	mux.HandleFunc("GET /api/v1/public/solar", s.publicSolar)
	mux.Handle("GET /ws/public", s.PublicHub)
	if !s.Config.PublicMode {
		mux.HandleFunc("GET /api/v1/live/state", s.liveState)
		mux.HandleFunc("GET /api/v1/nodes", s.nodes)
		mux.HandleFunc("GET /api/v1/nodes/{nodeID}", s.nodeByID)
		mux.HandleFunc("GET /api/v1/packets/recent", s.recentPackets)
		mux.HandleFunc("GET /api/v1/packets/{packetHash}", s.packetByHash)
		mux.HandleFunc("GET /api/v1/debug/resolution", s.debugResolution)
		mux.HandleFunc("GET /api/v1/debug/collisions", s.debugCollisions)
		mux.HandleFunc("GET /api/v1/debug/stats", s.debugStats)
		mux.Handle("GET /ws", s.Hub)
	}
	mux.HandleFunc("/", StaticHandler)
	return withSecurityHeaders(mux)
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.operationalStatus(r.Context(), false))
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	status := s.operationalStatus(r.Context(), true)
	code := http.StatusOK
	if ready, ok := status["ready"].(bool); !ok || !ready {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, status)
}

func (s *Server) operationalStatus(ctx context.Context, includeDB bool) map[string]any {
	now := time.Now()
	dbReady := !includeDB && s.Store != nil
	if includeDB && s.Store != nil {
		pingCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
		err := s.Store.Ping(pingCtx)
		cancel()
		dbReady = err == nil
	}
	cacheStatus := live.PublicCacheStatus{}
	if s.PublicCacheStatus != nil {
		cacheStatus = s.PublicCacheStatus(now)
	}
	mqttStatus := imqtt.Status{Connected: s.mqttConnected(), TotalMessages: s.mqttTotal()}
	if s.MQTTStatus != nil {
		mqttStatus = s.MQTTStatus(now)
	}
	publicHubStats := s.publicHubStats()
	staticReady := StaticReady()
	runtime := live.RuntimeStatsSnapshot{}
	if s.Runtime != nil {
		runtime = s.Runtime.Snapshot()
	}
	payload := map[string]any{
		"ok":                              true,
		"ready":                           true,
		"dbReady":                         dbReady,
		"staticReady":                     staticReady,
		"publicStateReady":                cacheStatus.Ready,
		"cacheAgeMs":                      cacheStatus.CacheAgeMs,
		"cacheUpdatedAt":                  cacheStatus.UpdatedAt,
		"cacheTruncatedNodes":             cacheStatus.TruncatedNodes,
		"cacheTruncatedRoutes":            cacheStatus.TruncatedRoutes,
		"cacheTruncatedRecentPulses":      cacheStatus.TruncatedRecentPulses,
		"cacheTruncatedRecentActivity":    cacheStatus.TruncatedRecentActivity,
		"mqttConnected":                   mqttStatus.Connected,
		"mqttLastMessageAgeMs":            mqttStatus.LastMessageAgeMs,
		"mqttMessages":                    mqttStatus.TotalMessages,
		"mqttDroppedMessages":             mqttStatus.DroppedMessages,
		"mqttReconnects":                  mqttStatus.Reconnects,
		"mqttMalformedTopics":             mqttStatus.MalformedTopics,
		"wsClients":                       s.wsClientCount(),
		"wsDroppedMessages":               publicHubStats.DroppedMessages,
		"wsQueueHighWater":                publicHubStats.QueueHighWater,
		"wsPingFailures":                  publicHubStats.PingFailures,
		"version":                         fallbackString(s.Config.AppVersion, "dev"),
		"gitSha":                          fallbackString(s.Config.GitSHA, "unknown"),
		"buildTime":                       fallbackString(s.Config.BuildTime, "unknown"),
		"mapRegionPreset":                 s.Config.MapRegionPreset,
		"mapBounds":                       s.Config.MapBounds,
		"defaultRegion":                   s.Config.DefaultRegion,
		"defaultCenter":                   []float64{s.Config.DefaultCenterLng, s.Config.DefaultCenterLat},
		"defaultZoom":                     s.Config.DefaultZoom,
		"publicRegionRestricted":          s.Config.PublicRegionRestricted || s.Config.PublicIATARestricted,
		"publicStateRequests":             runtime.PublicStateRequests,
		"publicStateErrors":               runtime.PublicStateErrors,
		"publicHistoryRequests":           runtime.PublicHistoryRequests,
		"publicHistoryErrors":             runtime.PublicHistoryErrors,
		"publicHistoryLatencyMs":          runtime.PublicHistoryLastLatencyMs,
		"publicSummaryRequests":           runtime.PublicSummaryRequests,
		"publicSummaryErrors":             runtime.PublicSummaryErrors,
		"publicPacketsRequests":           runtime.PublicPacketsRequests,
		"publicPacketsErrors":             runtime.PublicPacketsErrors,
		"publicPacketsLatencyMs":          runtime.PublicPacketsLastLatencyMs,
		"publicPacketsLastScan":           runtime.PublicPacketsLastScan,
		"publicPacketsScanCapped":         runtime.PublicPacketsScanCapped,
		"publicPacketsProjectionServed":   runtime.PublicPacketsProjectionServed,
		"publicPacketsProjectionFallback": runtime.PublicPacketsProjectionFallback,
		"publicPacketsProjectionErrors":   runtime.PublicPacketsProjectionErrors,
		"publicPacketsProjectionLastAt":   runtime.PublicPacketsProjectionLastAtMs,
		"publicPacketsProjectionComplete": runtime.PublicPacketsProjectionComplete,
		"publicPacketsSearchFTS":          runtime.PublicPacketsSearchFTS,
		"publicPacketsSearchSubstring":    runtime.PublicPacketsSearchSubstring,
		"publicPacketsSearchNoQuery":      runtime.PublicPacketsSearchNoQuery,
		"packetPathBackfillFailures":      runtime.PacketPathBackfillFailures,
		"packetPathBackfillLatencyMs":     runtime.PacketPathBackfillLastLatencyMs,
		"packetPathBackfillLastAt":        runtime.PacketPathBackfillLastAtMs,
		"packetPathBackfillLastScan":      runtime.PacketPathBackfillLastScanned,
		"packetPathBackfillProjected":     runtime.PacketPathBackfillLastProjected,
		"packetPathBackfillMappable":      runtime.PacketPathBackfillLastMappable,
		"packetPathBackfillInvalid":       runtime.PacketPathBackfillLastInvalid,
		"packetPathSearchIndexSynced":     runtime.PacketPathSearchIndexLastSync,
		"packetPathSearchIndexRemaining":  runtime.PacketPathSearchIndexRemaining,
		"packetPathBackfillRemaining":     runtime.PacketPathBackfillRemaining,
		"cacheRefreshFailures":            runtime.CacheRefreshFailures,
		"packetCountRefreshFailures":      runtime.PacketCountRefreshFailures,
		"packetCountRefreshLatencyMs":     runtime.PacketCountRefreshLastLatencyMs,
		"packetCountRefreshLastAt":        runtime.PacketCountRefreshLastAtMs,
		"cached":                          cacheStatus.Ready,
	}
	if s.PublicState != nil {
		if state, ok := s.PublicState(); ok {
			payload["packets"] = state.Stats.Packets
			payload["nodesWithPosition"] = state.Stats.ActiveNodes
			payload["edgeEvents"] = state.Stats.ActiveRoutes
			payload["unresolved"] = publicResolutionCount(state.Stats.ResolutionBuckets, "unresolved_path")
			routePulseAgeMs := publicLatestAgeMs(now, latestRoutePulseAt(state.RecentPulses))
			observerBurstAgeMs := publicLatestAgeMs(now, latestObserverActivityAt(state.RecentActivity))
			liveHealth := publicLiveHealth(cacheStatus.CacheAgeMs, routePulseAgeMs, observerBurstAgeMs, mqttStatus)
			payload["recentRoutePulseAgeMs"] = routePulseAgeMs
			payload["recentObserverBurstAgeMs"] = observerBurstAgeMs
			payload["packetIngestState"] = liveHealth.PacketIngestState
			payload["publicCacheState"] = liveHealth.PublicCacheState
			payload["routeMotionState"] = liveHealth.RouteMotionState
			payload["observerMotionState"] = liveHealth.ObserverMotionState
			payload["mapMotionState"] = liveHealth.MapMotionState
			payload["liveConfidenceState"] = liveHealth.LiveConfidenceState
			payload["packetIngestFresh"] = liveHealth.PacketIngestFresh
			payload["mapMotionFresh"] = liveHealth.MapMotionFresh
			payload["publicLiveFresh"] = liveHealth.PublicLiveFresh
		}
	}
	if includeDB {
		payload["ready"] = dbReady && cacheStatus.Ready && staticReady
	}
	return payload
}

func publicLatestAgeMs(now time.Time, latest int64) int64 {
	if latest <= 0 {
		return -1
	}
	age := now.UnixMilli() - latest
	if age < 0 {
		return 0
	}
	return age
}

func latestRoutePulseAt(items []live.PublicRoutePulse) int64 {
	var latest int64
	for _, item := range items {
		if item.HeardAt > latest {
			latest = item.HeardAt
		}
	}
	return latest
}

func latestObserverActivityAt(items []live.PublicActivity) int64 {
	var latest int64
	for _, item := range items {
		if item.AnimationState == live.PublicAnimationObserver && item.HeardAt > latest {
			latest = item.HeardAt
		}
	}
	return latest
}

const (
	liveStateFresh        = "fresh"
	liveStateQuiet        = "quiet"
	liveStateStale        = "stale"
	liveStateMissing      = "missing"
	liveStateDisconnected = "disconnected"
	liveStateWarming      = "warming"
	liveStateMoving       = "moving"
	liveStateDegraded     = "degraded"
)

type publicLiveHealthSnapshot struct {
	PacketIngestState   string
	PublicCacheState    string
	RouteMotionState    string
	ObserverMotionState string
	MapMotionState      string
	LiveConfidenceState string
	PacketIngestFresh   bool
	MapMotionFresh      bool
	PublicLiveFresh     bool
}

func publicLiveHealth(cacheAgeMs int64, routePulseAgeMs int64, observerBurstAgeMs int64, mqttStatus imqtt.Status) publicLiveHealthSnapshot {
	packetState := liveStateFresh
	if !mqttStatus.Connected {
		packetState = liveStateDisconnected
	} else if mqttStatus.LastMessageAgeMs < 0 {
		packetState = liveStateMissing
	} else if mqttStatus.LastMessageAgeMs > 5_000 {
		packetState = liveStateStale
	}

	cacheState := liveStateFresh
	if cacheAgeMs < 0 {
		cacheState = liveStateWarming
	} else if cacheAgeMs > 30_000 {
		cacheState = liveStateStale
	}

	routeState := motionState(routePulseAgeMs)
	observerState := motionState(observerBurstAgeMs)
	mapMotionFresh := routeState == liveStateFresh || observerState == liveStateFresh
	mapMotionState := liveStateQuiet
	if mapMotionFresh {
		mapMotionState = liveStateMoving
	} else if routeState == liveStateMissing && observerState == liveStateMissing {
		mapMotionState = liveStateMissing
	}

	packetFresh := packetState == liveStateFresh
	cacheFresh := cacheState == liveStateFresh
	liveFresh := packetFresh && cacheFresh
	confidence := liveStateFresh
	if !liveFresh {
		confidence = liveStateDegraded
	} else if !mapMotionFresh {
		confidence = liveStateQuiet
	}

	return publicLiveHealthSnapshot{
		PacketIngestState:   packetState,
		PublicCacheState:    cacheState,
		RouteMotionState:    routeState,
		ObserverMotionState: observerState,
		MapMotionState:      mapMotionState,
		LiveConfidenceState: confidence,
		PacketIngestFresh:   packetFresh,
		MapMotionFresh:      mapMotionFresh,
		PublicLiveFresh:     liveFresh,
	}
}

func motionState(ageMs int64) string {
	if ageMs < 0 {
		return liveStateMissing
	}
	if ageMs <= 120_000 {
		return liveStateFresh
	}
	return liveStateQuiet
}

func publicResolutionCount(buckets map[string]map[string]int64, name string) int64 {
	var total int64
	for _, region := range buckets {
		total += region[name]
	}
	return total
}

func (s *Server) publicState(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	failed := true
	defer func() {
		s.recordPublicState(time.Since(start), failed)
	}()
	if s.PublicState != nil {
		if state, ok := s.PublicState(); ok {
			now := time.Now().UnixMilli()
			state.ServerTime = now
			state.Stats.ServerTime = now
			state.Stats.MQTTConnected = s.mqttConnected()
			state.Stats.MQTTMessages = s.mqttTotal()
			state.Stats.WSClients = s.wsClientCount()
			state.Map = s.publicMapConfig()
			etag := `"` + strconv.FormatInt(state.UpdatedAt, 10) + `"`
			w.Header().Set("ETag", etag)
			w.Header().Set("Cache-Control", "public, max-age=5")
			if match := r.Header.Get("If-None-Match"); match == etag {
				w.WriteHeader(http.StatusNotModified)
				failed = false
				return
			}
			writeJSON(w, http.StatusOK, state)
			failed = false
			return
		}
		failed = false
		writeError(w, http.StatusServiceUnavailable, errors.New("public state cache is warming"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	state, err := s.Store.LiveState(ctx, s.Config.RecentPacketLimit, s.Config.RecentEdgeEventLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	packetCount, err := s.Store.PacketCount(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	publicState := live.BuildPublicLiveState(state, live.PublicStats{
		Packets:       packetCount,
		MQTTConnected: s.mqttConnected(),
		MQTTMessages:  s.mqttTotal(),
		WSClients:     s.wsClientCount(),
		ServerTime:    time.Now().UnixMilli(),
	})
	publicState.Map = s.publicMapConfig()
	writeJSON(w, http.StatusOK, publicState)
	failed = false
}

func (s *Server) publicMapConfig() live.PublicMapConfig {
	return live.PublicMapConfig{
		RegionPreset:  s.Config.MapRegionPreset,
		DefaultRegion: s.Config.DefaultRegion,
		DefaultCenter: []float64{s.Config.DefaultCenterLng, s.Config.DefaultCenterLat},
		DefaultZoom:   s.Config.DefaultZoom,
		Bounds:        s.Config.MapBounds,
	}
}

const (
	publicHistoryDefaultWindowMs = int64(time.Hour / time.Millisecond)
	publicHistoryMaxWindowMs     = int64(24 * time.Hour / time.Millisecond)
	publicHistoryMaxLimit        = 2000
	publicHistoryDefaultLimit    = 1000
	publicChatMaxLimit           = 400
	publicChatDefaultLimit       = 100
	publicChatMaxRawScan         = 2500
	publicChatDedupeWindowMs     = publicHistoryMaxWindowMs
	publicChatTextDedupeWindowMs = int64(10 * time.Minute / time.Millisecond)
	publicPacketsMaxLimit        = 1000
	publicPacketsDefaultLimit    = 250
	publicPacketsMaxRawScan      = 2500
	publicHistoryTargetBuckets   = 96
	publicHistoryMaxBuckets      = 288
	publicHistoryLocationTTL     = 60 * time.Second
	publicHistorySummaryRoundMs  = int64(30 * time.Second / time.Millisecond)
	publicHistoryRequestTimeout  = 10 * time.Second
	publicChatRequestTimeout     = 12 * time.Second
	publicPacketsRequestTimeout  = 12 * time.Second
)

type historyLocationCache struct {
	mu                sync.Mutex
	expiresAt         time.Time
	observerLocations live.PublicObserverLocationIndex
	pathHash3ByNodeID map[string]string
}

func (c *historyLocationCache) Get(ctx context.Context, st *store.Store) (live.PublicObserverLocationIndex, map[string]string, error) {
	if c == nil {
		c = &historyLocationCache{}
	}
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if now.Before(c.expiresAt) && c.observerLocations != nil && c.pathHash3ByNodeID != nil {
		return c.observerLocations, c.pathHash3ByNodeID, nil
	}

	nodes, observers, err := publicLocationInputs(ctx, st)
	if err != nil {
		return nil, nil, err
	}
	locations := live.BuildPublicObserverLocationIndex(nodes, observers)
	pathHash3 := live.BuildPublicPathHash3Index(nodes, observers)

	c.observerLocations = locations
	c.pathHash3ByNodeID = pathHash3
	c.expiresAt = now.Add(publicHistoryLocationTTL)
	return locations, pathHash3, nil
}

type historySummaryCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[string]historySummaryCacheEntry
}

type historySummaryCacheEntry struct {
	expiresAt time.Time
	response  live.PublicHistorySummaryResponse
}

func newHistorySummaryCache(ttl time.Duration) *historySummaryCache {
	if ttl <= 0 {
		ttl = 20 * time.Second
	}
	return &historySummaryCache{ttl: ttl, entries: map[string]historySummaryCacheEntry{}}
}

func (c *historySummaryCache) Get(from, to, bucketMs int64) (live.PublicHistorySummaryResponse, bool) {
	if c == nil {
		return live.PublicHistorySummaryResponse{}, false
	}
	key := historySummaryCacheKey(from, to, bucketMs)
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || now.After(entry.expiresAt) {
		delete(c.entries, key)
		return live.PublicHistorySummaryResponse{}, false
	}
	return copyHistorySummaryResponse(entry.response), true
}

func (c *historySummaryCache) Set(from, to, bucketMs int64, response live.PublicHistorySummaryResponse) {
	if c == nil {
		return
	}
	key := historySummaryCacheKey(from, to, bucketMs)
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) > 64 {
		c.entries = map[string]historySummaryCacheEntry{}
	}
	c.entries[key] = historySummaryCacheEntry{expiresAt: time.Now().Add(c.ttl), response: copyHistorySummaryResponse(response)}
}

func historySummaryCacheKey(from, to, bucketMs int64) string {
	return strconv.FormatInt(from, 10) + ":" + strconv.FormatInt(to, 10) + ":" + strconv.FormatInt(bucketMs, 10)
}

func copyHistorySummaryResponse(response live.PublicHistorySummaryResponse) live.PublicHistorySummaryResponse {
	response.Buckets = append([]live.PublicHistorySummaryBucket{}, response.Buckets...)
	return response
}

func (s *Server) publicHistory(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	failed := true
	defer func() {
		s.recordPublicHistory(time.Since(start), failed)
	}()
	if s.Store == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("store is not available"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), publicHistoryRequestTimeout)
	defer cancel()
	now := time.Now().UnixMilli()
	from, to := publicHistoryWindow(r, now)
	limit := queryInt(r, "limit", publicHistoryDefaultLimit)
	if limit <= 0 {
		limit = publicHistoryDefaultLimit
	}
	if limit > publicHistoryMaxLimit {
		limit = publicHistoryMaxLimit
	}
	cursor, err := decodeHistoryCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if s.publicHistoryFromProjection(w, ctx, now, from, to, limit, cursor) {
		failed = false
		return
	}
	events := make([]live.PublicHistoryEvent, 0, limit)
	nextCursor := cursor
	var observerLocations live.PublicObserverLocationIndex
	var pathHash3ByNodeID map[string]string
	locationsReady := false
	for len(events) < limit {
		rawLimit := historyRawPageSize(limit - len(events))
		rawEvents, err := s.Store.PublicHistoryEvents(ctx, store.HistoryQuery{
			From:   from,
			To:     to,
			Limit:  rawLimit,
			Cursor: nextCursor,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if len(rawEvents) == 0 {
			nextCursor = nil
			break
		}
		if !locationsReady {
			observerLocations, pathHash3ByNodeID, err = s.publicLocationIndexes(ctx)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			locationsReady = true
		}
		for _, rawEvent := range rawEvents {
			cursorValue := rawEvent.Cursor()
			nextCursor = &cursorValue
			if !s.allowsPublicIATA(rawEvent.IATA()) {
				continue
			}
			event, ok := publicHistoryEvent(rawEvent, observerLocations, pathHash3ByNodeID)
			if !ok {
				continue
			}
			events = append(events, event)
			if len(events) >= limit {
				break
			}
		}
		if len(rawEvents) < rawLimit || len(events) >= limit {
			break
		}
	}

	nextCursorToken := ""
	if len(events) >= limit && nextCursor != nil {
		nextCursorToken = encodeHistoryCursor(*nextCursor)
	}
	writeJSON(w, http.StatusOK, live.PublicHistoryResponse{
		ServerTime: now,
		Events:     events,
		NextCursor: nextCursorToken,
		Window: live.PublicHistoryWindow{
			From:  from,
			To:    to,
			Count: len(events),
		},
	})
	failed = false
}

func (s *Server) publicHistoryFromProjection(
	w http.ResponseWriter,
	ctx context.Context,
	now int64,
	from int64,
	to int64,
	limit int,
	cursor *store.HistoryCursor,
) bool {
	events := make([]live.PublicHistoryEvent, 0, limit)
	nextCursor := cursor
	scanned := 0
	exhausted := false
	for len(events) < limit && scanned < publicPacketsMaxRawScan {
		rawLimit := minInt(historyRawPageSize(limit-len(events)), publicPacketsMaxRawScan-scanned)
		rawPackets, rawCursor, _, err := s.Store.PublicPacketPaths(ctx, store.PublicPacketPathQuery{
			From:        from,
			To:          to,
			Limit:       rawLimit,
			Cursor:      nextCursor,
			NewestFirst: false,
		})
		if err != nil {
			return false
		}
		scanned += len(rawPackets)
		if len(rawPackets) == 0 {
			if len(events) == 0 && cursor == nil {
				return false
			}
			nextCursor = nil
			exhausted = true
			break
		}
		lastScannedCursor := nextCursor
		for _, packet := range rawPackets {
			if packetCursor := publicPacketProjectionCursor(packet); packetCursor != nil {
				lastScannedCursor = packetCursor
			}
			if !s.allowsPublicIATA(packet.IATA) {
				continue
			}
			pulse, ok := publicRoutePulseFromPacketPath(packet)
			if !ok {
				continue
			}
			events = append(events, live.PublicHistoryEvent{Type: "routePulse", At: packet.At, Data: pulse})
			if len(events) >= limit {
				nextCursor = lastScannedCursor
				break
			}
		}
		if len(events) >= limit {
			break
		}
		nextCursor = rawCursor
		if rawCursor == nil {
			exhausted = true
			break
		}
	}
	nextCursorToken := ""
	if nextCursor != nil && !exhausted && (len(events) >= limit || scanned >= publicPacketsMaxRawScan) {
		nextCursorToken = encodeHistoryCursor(*nextCursor)
	}
	writeJSON(w, http.StatusOK, live.PublicHistoryResponse{
		ServerTime: now,
		Events:     events,
		NextCursor: nextCursorToken,
		Window: live.PublicHistoryWindow{
			From:  from,
			To:    to,
			Count: len(events),
		},
	})
	return true
}

func (s *Server) publicHistorySummary(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	failed := true
	defer func() {
		s.recordPublicSummary(time.Since(start), failed)
	}()
	if s.Store == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("store is not available"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	now := time.Now().UnixMilli()
	from, to := publicHistoryWindow(r, now)
	bucketMs := queryInt64(r, "bucketMs", 0)
	if bucketMs <= 0 {
		bucketMs = defaultHistoryBucketMs(to - from)
	}
	if bucketMs < 1000 {
		bucketMs = 1000
	}
	if bucketsForSpan(to-from, bucketMs) > publicHistoryMaxBuckets {
		bucketMs = ceilDiv(to-from, publicHistoryMaxBuckets)
	}
	from, to = canonicalHistorySummaryWindow(from, to)
	if cached, ok := s.summaryCache.Get(from, to, bucketMs); ok {
		cached.ServerTime = now
		writeJSON(w, http.StatusOK, cached)
		failed = false
		return
	}
	buckets := make([]live.PublicHistorySummaryBucket, bucketsForSpan(to-from, bucketMs))
	for i := range buckets {
		start := from + int64(i)*bucketMs
		end := start + bucketMs
		if end > to {
			end = to
		}
		buckets[i] = live.PublicHistorySummaryBucket{Start: start, End: end}
	}
	var rows []store.HistorySummaryRow
	var err error
	if s.Config.PublicIATARestricted {
		rows, err = s.Store.PublicHistorySummary(ctx, from, to, bucketMs)
	} else {
		rows, err = s.Store.PublicHistorySummaryTotals(ctx, from, to, bucketMs)
	}
	if err != nil {
		response := live.PublicHistorySummaryResponse{
			ServerTime: now,
			From:       from,
			To:         to,
			BucketMs:   bucketMs,
			Buckets:    buckets,
		}
		s.summaryCache.Set(from, to, bucketMs, response)
		writeJSON(w, http.StatusOK, response)
		return
	}
	for _, row := range rows {
		if !s.allowsPublicIATA(row.IATA) || row.Bucket < 0 || int(row.Bucket) >= len(buckets) {
			continue
		}
		buckets[row.Bucket].Count += row.Count
	}
	response := live.PublicHistorySummaryResponse{
		ServerTime: now,
		From:       from,
		To:         to,
		BucketMs:   bucketMs,
		Buckets:    buckets,
	}
	s.summaryCache.Set(from, to, bucketMs, response)
	writeJSON(w, http.StatusOK, response)
	failed = false
}

func (s *Server) publicSolar(w http.ResponseWriter, r *http.Request) {
	if s.SolarConditions == nil { writeError(w, http.StatusServiceUnavailable, errors.New("solar conditions unavailable")); return }
	writeJSON(w, http.StatusOK, s.SolarConditions())
}

func (s *Server) publicChat(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	failed := true
	defer func() {
		s.logAPI("public_chat", time.Since(start), failed)
	}()
	if s.Store == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("store is not available"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), publicChatRequestTimeout)
	defer cancel()
	now := time.Now().UnixMilli()
	from, to := publicHistoryWindow(r, now)
	limit := queryInt(r, "limit", publicChatDefaultLimit)
	if limit <= 0 {
		limit = publicChatDefaultLimit
	}
	if limit > publicChatMaxLimit {
		limit = publicChatMaxLimit
	}
	filters := publicChatFiltersFromRequest(r)
	cursor, err := decodeHistoryCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	messages := make([]live.PublicChatMessage, 0, limit)
	seenMessages := map[string]struct{}{}
	seenDisplayMessages := map[string]int64{}
	seenTextMessages := map[string]int64{}
	nextCursor := cursor
	scannedRaw := 0
	exhausted := false
	var observerLocations live.PublicObserverLocationIndex
	var pathHash3ByNodeID map[string]string
	locationsReady := false
	for len(messages) < limit && scannedRaw < publicChatMaxRawScan {
		rawLimit := minInt(publicChatRawPageSize(limit-len(messages), filters), publicChatMaxRawScan-scannedRaw)
		rawEvents, err := s.Store.PublicChatEvents(ctx, store.HistoryQuery{
			From:   from,
			To:     to,
			Limit:  rawLimit,
			Cursor: nextCursor,
			IATA:   filters.iata,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		scannedRaw += len(rawEvents)
		if len(rawEvents) == 0 {
			nextCursor = nil
			exhausted = true
			break
		}
		if !locationsReady {
			observerLocations, pathHash3ByNodeID, err = s.publicLocationIndexes(ctx)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			locationsReady = true
		}
		for _, rawEvent := range rawEvents {
			cursorValue := rawEvent.Cursor()
			nextCursor = &cursorValue
			if !s.allowsPublicIATA(rawEvent.IATA()) {
				continue
			}
			message, ok := publicChatMessage(rawEvent, observerLocations, pathHash3ByNodeID)
			if !ok {
				continue
			}
			if !publicChatMatchesFilters(message, filters) {
				continue
			}
			if messageKey := publicChatDedupeKey(rawEvent, message); messageKey != "" {
				if _, seen := seenMessages[messageKey]; seen {
					continue
				}
				seenMessages[messageKey] = struct{}{}
			}
			if displayKey := publicChatDisplayDedupeKey(message); displayKey != "" {
				if previousAt, seen := seenDisplayMessages[displayKey]; seen && publicChatWithinDedupeWindow(previousAt, message.At) {
					continue
				}
				seenDisplayMessages[displayKey] = message.At
			}
			if textKey := publicChatTextDedupeKey(message); textKey != "" {
				if previousAt, seen := seenTextMessages[textKey]; seen && publicChatWithinWindow(previousAt, message.At, publicChatTextDedupeWindowMs) {
					continue
				}
				seenTextMessages[textKey] = message.At
			}
			messages = append(messages, message)
			if len(messages) >= limit {
				break
			}
		}
		if len(rawEvents) < rawLimit || len(messages) >= limit {
			exhausted = len(rawEvents) < rawLimit && len(messages) < limit
			break
		}
	}

	writeJSON(w, http.StatusOK, live.PublicChatResponse{
		ServerTime: now,
		Messages:   messages,
		NextCursor: publicChatNextCursorToken(nextCursor, exhausted, len(messages), limit, scannedRaw),
		Window: live.PublicHistoryWindow{
			From:  from,
			To:    to,
			Count: len(messages),
		},
	})
	failed = false
}

func (s *Server) publicPackets(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	failed := true
	defer func() {
		s.recordPublicPackets(time.Since(start), failed)
	}()
	if s.Store == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("store is not available"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), publicPacketsRequestTimeout)
	defer cancel()
	now := time.Now().UnixMilli()
	from, to := publicHistoryWindow(r, now)
	limit := queryInt(r, "limit", publicPacketsDefaultLimit)
	if limit <= 0 {
		limit = publicPacketsDefaultLimit
	}
	if limit > publicPacketsMaxLimit {
		limit = publicPacketsMaxLimit
	}
	filters := publicPacketFiltersFromRequest(r)
	cursor, err := decodeHistoryCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if s.publicPacketsFromProjection(w, ctx, now, from, to, limit, cursor, filters) {
		failed = false
		return
	}
	packets := make([]live.PublicPacketPath, 0, limit)
	nextCursor := cursor
	scannedRaw := 0
	exhausted := false
	var pathHash3ByNodeID map[string]string
	locationsReady := false
	for len(packets) < limit && scannedRaw < publicPacketsMaxRawScan {
		rawLimit := minInt(publicPacketsRawPageSize(limit-len(packets), filters), publicPacketsMaxRawScan-scannedRaw)
		rawEvents, err := s.Store.PublicPacketEdgeEvents(ctx, store.HistoryQuery{
			From:            from,
			To:              to,
			Limit:           rawLimit,
			Cursor:          nextCursor,
			IATA:            filters.iata,
			PayloadTypeName: filters.payload,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		scannedRaw += len(rawEvents)
		if len(rawEvents) == 0 {
			nextCursor = nil
			exhausted = true
			break
		}
		for _, edge := range rawEvents {
			cursorValue := store.HistoryCursor{At: edge.HeardAt, TypeOrder: 2, ID: edge.ID}
			nextCursor = &cursorValue
			if !s.allowsPublicIATA(edge.IATA) {
				continue
			}
			if !locationsReady {
				_, pathHash3ByNodeID, err = s.publicLocationIndexes(ctx)
				if err != nil {
					writeError(w, http.StatusInternalServerError, err)
					return
				}
				locationsReady = true
			}
			packet, ok := publicPacketPath(edge, pathHash3ByNodeID)
			if !ok {
				continue
			}
			if !publicPacketMatchesFilters(packet, filters) {
				continue
			}
			packets = append(packets, packet)
			if len(packets) >= limit {
				break
			}
		}
		if len(rawEvents) < rawLimit || len(packets) >= limit {
			exhausted = len(rawEvents) < rawLimit && len(packets) < limit
			break
		}
	}

	nextCursorToken := publicPacketsNextCursorToken(nextCursor, exhausted, len(packets), limit, scannedRaw)
	if s.Runtime != nil {
		s.Runtime.RecordPublicPacketsScan(scannedRaw, nextCursorToken != "" && scannedRaw >= publicPacketsMaxRawScan)
	}
	writeJSON(w, http.StatusOK, live.PublicPacketsResponse{
		ServerTime: now,
		Packets:    packets,
		NextCursor: nextCursorToken,
		Window: live.PublicHistoryWindow{
			From:  from,
			To:    to,
			Count: len(packets),
		},
		Scan: live.PublicPacketScan{
			EventsScanned: scannedRaw,
			ScanLimit:     publicPacketsMaxRawScan,
			Filtered:      filters.hasAny(),
			Partial:       nextCursorToken != "",
		},
	})
	failed = false
}

func (s *Server) publicPacketsFromProjection(
	w http.ResponseWriter,
	ctx context.Context,
	now int64,
	from int64,
	to int64,
	limit int,
	cursor *store.HistoryCursor,
	filters publicPacketFilters,
) bool {
	packets := make([]live.PublicPacketPath, 0, limit)
	nextCursor := cursor
	scanned := 0
	exhausted := false
	searchMode := store.PublicPacketPathSearchNone
	for len(packets) < limit && scanned < publicPacketsMaxRawScan {
		rawLimit := minInt(publicPacketsRawPageSize(limit-len(packets), filters), publicPacketsMaxRawScan-scanned)
		rawPackets, rawCursor, rawSearchMode, err := s.Store.PublicPacketPaths(ctx, store.PublicPacketPathQuery{
			From:            from,
			To:              to,
			Limit:           rawLimit,
			Cursor:          nextCursor,
			NewestFirst:     true,
			IATA:            filters.iata,
			PayloadTypeName: filters.payload,
			MinHops:         filters.minHops,
			MessageOnly:     filters.messageOnly,
			Search:          filters.query,
		})
		if err != nil {
			if s.Runtime != nil {
				s.Runtime.RecordPublicPacketsProjection(false, true, true)
			}
			return false
		}
		if rawSearchMode != store.PublicPacketPathSearchNone {
			searchMode = rawSearchMode
		}
		scanned += len(rawPackets)
		if len(rawPackets) == 0 {
			nextCursor = nil
			exhausted = true
			break
		}
		lastScannedCursor := nextCursor
		for _, packet := range rawPackets {
			if packetCursor := publicPacketProjectionCursor(packet); packetCursor != nil {
				lastScannedCursor = packetCursor
			}
			if !s.allowsPublicIATA(packet.IATA) {
				continue
			}
			packets = append(packets, packet)
			if len(packets) >= limit {
				nextCursor = lastScannedCursor
				break
			}
		}
		if len(packets) >= limit {
			break
		}
		nextCursor = rawCursor
		if rawCursor == nil {
			exhausted = rawCursor == nil && len(packets) < limit
			break
		}
	}
	nextCursorToken := publicPacketsNextCursorToken(nextCursor, exhausted, len(packets), limit, scanned)
	if s.Runtime != nil {
		s.Runtime.RecordPublicPacketsProjection(true, true, false)
		s.Runtime.RecordPublicPacketsSearchMode(string(searchMode))
		s.Runtime.RecordPublicPacketsScan(scanned, nextCursorToken != "" && scanned >= publicPacketsMaxRawScan)
	}
	writeJSON(w, http.StatusOK, live.PublicPacketsResponse{
		ServerTime: now,
		Packets:    packets,
		NextCursor: nextCursorToken,
		Window: live.PublicHistoryWindow{
			From:  from,
			To:    to,
			Count: len(packets),
		},
		Scan: live.PublicPacketScan{
			EventsScanned: scanned,
			ScanLimit:     publicPacketsMaxRawScan,
			Filtered:      filters.hasAny(),
			Partial:       nextCursorToken != "",
		},
	})
	return true
}

func publicPacketProjectionCursor(packet live.PublicPacketPath) *store.HistoryCursor {
	idText := strings.TrimPrefix(packet.ID, "pulse-")
	id, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || id <= 0 {
		return nil
	}
	return &store.HistoryCursor{At: packet.At, TypeOrder: 2, ID: id}
}

type publicPacketFilters struct {
	iata        string
	payload     string
	minHops     int
	messageOnly bool
	query       string
}

func (f publicPacketFilters) hasAny() bool {
	return f.iata != "" || f.payload != "" || f.minHops > 0 || f.messageOnly || f.query != ""
}

func publicPacketFiltersFromRequest(r *http.Request) publicPacketFilters {
	query := r.URL.Query()
	return publicPacketFilters{
		iata:        firstUpperQuery(query, "region", "iata"),
		payload:     strings.ToUpper(strings.TrimSpace(query.Get("payload"))),
		minHops:     maxInt(0, queryInt(r, "minHops", 0)),
		messageOnly: queryBool(query.Get("messageOnly")),
		query:       strings.ToLower(trimBounded(query.Get("q"), 120)),
	}
}

func firstUpperQuery(query map[string][]string, keys ...string) string {
	for _, key := range keys {
		if values, ok := query[key]; ok {
			for _, value := range values {
				if item := strings.ToUpper(strings.TrimSpace(value)); item != "" {
					return item
				}
			}
		}
	}
	return ""
}

func publicPacketMatchesFilters(packet live.PublicPacketPath, filters publicPacketFilters) bool {
	if filters.iata != "" && strings.ToUpper(packet.IATA) != filters.iata {
		return false
	}
	if filters.payload != "" && strings.ToUpper(packet.PayloadTypeName) != filters.payload {
		return false
	}
	if filters.minHops > 0 && packet.HopCount < filters.minHops {
		return false
	}
	if filters.messageOnly && strings.TrimSpace(packet.MessageText) == "" {
		return false
	}
	if filters.query == "" {
		return true
	}
	for _, field := range publicPacketSearchFields(packet) {
		if strings.Contains(strings.ToLower(field), filters.query) {
			return true
		}
	}
	return false
}

func publicPacketSearchFields(packet live.PublicPacketPath) []string {
	fields := []string{
		packet.ID,
		packet.IATA,
		packet.PayloadTypeName,
		packet.MessageSender,
		packet.MessageText,
	}
	fields = append(fields, packet.RouteIDs...)
	fields = append(fields, packet.EndpointLabels...)
	for _, segment := range packet.Segments {
		fields = append(fields,
			segment.RouteID,
			segment.From.Label,
			segment.From.PathHash3,
			segment.To.Label,
			segment.To.PathHash3,
		)
	}
	out := fields[:0]
	for _, field := range fields {
		if strings.TrimSpace(field) != "" {
			out = append(out, field)
		}
	}
	return out
}

type publicChatFilters struct {
	iata    string
	channel string
	query   string
}

func publicChatFiltersFromRequest(r *http.Request) publicChatFilters {
	query := r.URL.Query()
	return publicChatFilters{
		iata:    firstUpperQuery(query, "region", "iata"),
		channel: strings.ToLower(trimBounded(query.Get("channel"), 80)),
		query:   strings.ToLower(trimBounded(query.Get("q"), 120)),
	}
}

func publicChatMessage(
	raw store.HistoryEvent,
	observerLocations live.PublicObserverLocationIndex,
	pathHash3ByNodeID map[string]string,
) (live.PublicChatMessage, bool) {
	if raw.Edge != nil {
		pulse, ok := live.PublicRoutePulseFromEdge(*raw.Edge, pathHash3ByNodeID)
		if !ok {
			return live.PublicChatMessage{}, false
		}
		packet, ok := live.PublicPacketPathFromPulse(pulse)
		if !ok || strings.TrimSpace(packet.MessageText) == "" {
			return live.PublicChatMessage{}, false
		}
		messageID := raw.Edge.ObservationID
		if messageID <= 0 {
			messageID = raw.Edge.ID
		}
		return live.PublicChatMessage{
			ID:              "chat-routed-" + strconv.FormatInt(messageID, 10),
			At:              packet.At,
			IATA:            packet.IATA,
			Region:          packet.Region,
			Sender:          packet.MessageSender,
			Text:            packet.MessageText,
			ChannelLabel:    publicChatChannelLabel(packet.PayloadTypeName),
			PayloadTypeName: packet.PayloadTypeName,
			Source:          "routed",
			Anchor:          pulse.MessageAnchor,
			RouteIDs:        packet.RouteIDs,
			EndpointLabels:  packet.EndpointLabels,
		}, true
	}
	if raw.Packet != nil {
		activity := live.PublicActivityFromPacket(
			*raw.Packet,
			nil,
			observerLocations.LocationForPublicKey(raw.Packet.ObserverPublicKey, raw.Packet.IATA),
		)
		if strings.TrimSpace(activity.MessageText) == "" {
			return live.PublicChatMessage{}, false
		}
		return live.PublicChatMessage{
			ID:              "chat-observer-" + strconv.FormatInt(raw.Packet.ID, 10),
			At:              activity.HeardAt,
			IATA:            strings.ToUpper(strings.TrimSpace(activity.IATA)),
			Region:          strings.ToUpper(strings.TrimSpace(activity.Region)),
			Sender:          activity.MessageSender,
			Text:            activity.MessageText,
			ChannelLabel:    publicChatChannelLabel(activity.PayloadTypeName),
			PayloadTypeName: activity.PayloadTypeName,
			Source:          "observer",
			Anchor:          activity.MessageAnchor,
		}, true
	}
	return live.PublicChatMessage{}, false
}

func publicChatChannelLabel(payloadTypeName string) string {
	payloadTypeName = strings.TrimSpace(payloadTypeName)
	switch strings.ToUpper(payloadTypeName) {
	case "PLAIN_TEXT", "GROUP_TEXT":
		return "Public"
	default:
		return fallbackString(payloadTypeName, "Unknown")
	}
}

func publicChatMatchesFilters(message live.PublicChatMessage, filters publicChatFilters) bool {
	if filters.iata != "" && strings.ToUpper(message.IATA) != filters.iata {
		return false
	}
	if filters.channel != "" &&
		strings.ToLower(message.ChannelLabel) != filters.channel &&
		strings.ToLower(message.PayloadTypeName) != filters.channel {
		return false
	}
	if filters.query == "" {
		return true
	}
	for _, field := range publicChatSearchFields(message) {
		if strings.Contains(strings.ToLower(field), filters.query) {
			return true
		}
	}
	return false
}

func publicChatSearchFields(message live.PublicChatMessage) []string {
	fields := []string{
		message.ID,
		message.IATA,
		message.Region,
		message.Sender,
		message.Text,
		message.ChannelLabel,
		message.PayloadTypeName,
		message.Source,
	}
	fields = append(fields, message.RouteIDs...)
	fields = append(fields, message.EndpointLabels...)
	if message.Anchor != nil {
		fields = append(fields, message.Anchor.Label)
	}
	out := fields[:0]
	for _, field := range fields {
		if strings.TrimSpace(field) != "" {
			out = append(out, field)
		}
	}
	return out
}

func publicChatDedupeKey(raw store.HistoryEvent, message live.PublicChatMessage) string {
	if raw.Edge != nil && strings.TrimSpace(raw.Edge.PacketHash) != "" {
		return "packet:" + strings.ToLower(strings.TrimSpace(raw.Edge.PacketHash))
	}
	if raw.Packet != nil && strings.TrimSpace(raw.Packet.PacketHash) != "" {
		return "packet:" + strings.ToLower(strings.TrimSpace(raw.Packet.PacketHash))
	}
	return message.ID
}

func publicChatDisplayDedupeKey(message live.PublicChatMessage) string {
	sender := publicChatDisplayDedupeToken(message.Sender)
	text := publicChatDisplayDedupeToken(message.Text)
	if sender == "" || text == "" {
		return ""
	}
	return sender + "|" + text
}

func publicChatTextDedupeKey(message live.PublicChatMessage) string {
	text := publicChatDisplayDedupeToken(message.Text)
	if !publicChatLongEnoughForTextDedupe(text) {
		return ""
	}
	channel := publicChatDisplayDedupeToken(message.ChannelLabel)
	if channel == "" {
		channel = publicChatDisplayDedupeToken(message.PayloadTypeName)
	}
	if channel == "" {
		channel = "message"
	}
	return channel + "|" + text
}

func publicChatLongEnoughForTextDedupe(token string) bool {
	if token == "" {
		return false
	}
	compact := strings.ReplaceAll(token, " ", "")
	return len([]rune(compact)) >= 14 || len(strings.Fields(token)) >= 3
}

func publicChatDisplayDedupeToken(value string) string {
	cleaned := publicChatVisibleDedupeText(value)
	token := strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return r
		}
		return ' '
	}, cleaned)
	token = strings.ToLower(strings.Join(strings.Fields(token), " "))
	if token != "" {
		return token
	}
	return strings.ToLower(strings.Join(strings.Fields(cleaned), " "))
}

func publicChatVisibleDedupeText(value string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r < 0x20 || (r >= 0x7f && r <= 0x9f):
			return -1
		case r >= 0x200b && r <= 0x200f:
			return -1
		case r >= 0x202a && r <= 0x202e:
			return -1
		case r >= 0x2060 && r <= 0x206f:
			return -1
		case r >= 0xfe00 && r <= 0xfe0f:
			return -1
		case r == 0xfeff:
			return -1
		default:
			return r
		}
	}, value)
}

func publicChatWithinDedupeWindow(a, b int64) bool {
	return publicChatWithinWindow(a, b, publicChatDedupeWindowMs)
}

func publicChatWithinWindow(a, b, windowMs int64) bool {
	delta := a - b
	if delta < 0 {
		delta = -delta
	}
	return delta <= windowMs
}

func (s *Server) publicLocationIndexes(ctx context.Context) (live.PublicObserverLocationIndex, map[string]string, error) {
	if s.historyLocations == nil {
		s.historyLocations = &historyLocationCache{}
	}
	return s.historyLocations.Get(ctx, s.Store)
}

func publicLocationInputs(ctx context.Context, st *store.Store) ([]live.Node, []live.Observer, error) {
	nodes, err := st.Nodes(ctx, true, "")
	if err != nil {
		return nil, nil, err
	}
	observers, err := st.Observers(ctx)
	if err != nil {
		return nil, nil, err
	}
	return nodes, observers, nil
}

func publicHistoryEvent(
	raw store.HistoryEvent,
	observerLocations live.PublicObserverLocationIndex,
	pathHash3ByNodeID map[string]string,
) (live.PublicHistoryEvent, bool) {
	switch raw.Type {
	case "activity":
		if raw.Edge != nil {
			activity, ok := live.PublicActivityFromEdge(*raw.Edge)
			if !ok {
				return live.PublicHistoryEvent{}, false
			}
			return live.PublicHistoryEvent{Type: "activity", At: raw.At, Data: activity}, true
		}
		if raw.Packet != nil {
			activity := live.PublicActivityFromPacket(
				*raw.Packet,
				nil,
				observerLocations.LocationForPublicKey(raw.Packet.ObserverPublicKey, raw.Packet.IATA),
			)
			return live.PublicHistoryEvent{Type: "activity", At: raw.At, Data: activity}, true
		}
	case "routePulse":
		if raw.Edge == nil {
			return live.PublicHistoryEvent{}, false
		}
		pulse, ok := live.PublicRoutePulseFromEdge(*raw.Edge, pathHash3ByNodeID)
		if !ok {
			return live.PublicHistoryEvent{}, false
		}
		return live.PublicHistoryEvent{Type: "routePulse", At: raw.At, Data: pulse}, true
	}
	return live.PublicHistoryEvent{}, false
}

func publicPacketPath(edge live.EdgeEvent, pathHash3ByNodeID map[string]string) (live.PublicPacketPath, bool) {
	pulse, ok := live.PublicRoutePulseFromEdge(edge, pathHash3ByNodeID)
	if !ok {
		return live.PublicPacketPath{}, false
	}
	return live.PublicPacketPathFromPulse(pulse)
}

func publicRoutePulseFromPacketPath(packet live.PublicPacketPath) (live.PublicRoutePulse, bool) {
	if len(packet.Segments) == 0 || packet.At <= 0 {
		return live.PublicRoutePulse{}, false
	}
	region := strings.ToUpper(strings.TrimSpace(packet.Region))
	if region == "" {
		region = strings.ToUpper(strings.TrimSpace(packet.IATA))
	}
	return live.PublicRoutePulse{
		ID:              strings.TrimSpace(packet.ID),
		IATA:            strings.ToUpper(strings.TrimSpace(packet.IATA)),
		Region:          region,
		PayloadTypeName: strings.TrimSpace(packet.PayloadTypeName),
		MessageSender:   strings.TrimSpace(packet.MessageSender),
		MessageText:     strings.TrimSpace(packet.MessageText),
		HeardAt:         packet.At,
		Segments:        append([]live.PublicRouteSegment{}, packet.Segments...),
	}, true
}

func publicHistoryWindow(r *http.Request, now int64) (int64, int64) {
	to := queryInt64(r, "to", now)
	if to <= 0 || to > now {
		to = now
	}
	from := queryInt64(r, "from", to-publicHistoryDefaultWindowMs)
	if from > to {
		from = to
	}
	if to-from > publicHistoryMaxWindowMs {
		from = to - publicHistoryMaxWindowMs
	}
	if from < 0 {
		from = 0
	}
	return from, to
}

func historyRawPageSize(remaining int) int {
	limit := remaining * 4
	if limit < 200 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}
	return limit
}

func publicChatRawPageSize(remaining int, filters publicChatFilters) int {
	if remaining <= 0 {
		return 0
	}
	if filters.channel == "" && filters.query == "" {
		return minInt(maxInt(remaining, 200), 1000)
	}
	return minInt(maxInt(remaining*2, 400), 1200)
}

func publicPacketsRawPageSize(remaining int, filters publicPacketFilters) int {
	if remaining <= 0 {
		return 0
	}
	hasLateFilters := filters.minHops > 0 || filters.messageOnly || filters.query != ""
	if !hasLateFilters {
		return minInt(maxInt(remaining, 200), 1000)
	}
	return minInt(maxInt(remaining*2, 400), 1200)
}

func publicChatNextCursorToken(cursor *store.HistoryCursor, exhausted bool, matched int, limit int, scannedRaw int) string {
	if cursor == nil || exhausted {
		return ""
	}
	if matched >= limit || scannedRaw >= publicChatMaxRawScan {
		return encodeHistoryCursor(*cursor)
	}
	return ""
}

func publicPacketsNextCursorToken(cursor *store.HistoryCursor, exhausted bool, matched int, limit int, scannedRaw int) string {
	if cursor == nil || exhausted {
		return ""
	}
	if matched >= limit || scannedRaw >= publicPacketsMaxRawScan {
		return encodeHistoryCursor(*cursor)
	}
	return ""
}

func defaultHistoryBucketMs(span int64) int64 {
	if span <= 0 {
		return int64(time.Minute / time.Millisecond)
	}
	bucketMs := ceilDiv(span, publicHistoryTargetBuckets)
	if bucketMs < int64(time.Minute/time.Millisecond) {
		return int64(time.Minute / time.Millisecond)
	}
	return bucketMs
}

func bucketsForSpan(span int64, bucketMs int64) int {
	if span <= 0 || bucketMs <= 0 {
		return 1
	}
	return int(ceilDiv(span, int(bucketMs)))
}

func ceilDiv(value int64, divisor int) int64 {
	if value <= 0 {
		return 1
	}
	d := int64(divisor)
	return (value + d - 1) / d
}

func encodeHistoryCursor(cursor store.HistoryCursor) string {
	data, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(data)
}

func decodeHistoryCursor(raw string) (*store.HistoryCursor, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, errors.New("invalid history cursor")
	}
	var cursor store.HistoryCursor
	if err := json.Unmarshal(data, &cursor); err != nil {
		return nil, errors.New("invalid history cursor")
	}
	return &cursor, nil
}

func (s *Server) allowsPublicIATA(iata string) bool {
	if s.PublicAllowsIATA == nil {
		return true
	}
	return s.PublicAllowsIATA(iata)
}

func (s *Server) liveState(w http.ResponseWriter, r *http.Request) {
	state, err := s.Store.LiveState(r.Context(), s.Config.RecentPacketLimit, s.Config.RecentEdgeEventLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) nodes(w http.ResponseWriter, r *http.Request) {
	positioned := r.URL.Query().Get("positioned") == "true"
	iata := firstUpperQuery(r.URL.Query(), "region", "iata")
	nodes, err := s.Store.Nodes(r.Context(), positioned, iata)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) nodeByID(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("nodeID")
	nodes, err := s.Store.Nodes(r.Context(), false, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	for _, node := range nodes {
		if node.NodeID == nodeID || node.PublicKey == strings.ToUpper(nodeID) {
			writeJSON(w, http.StatusOK, node)
			return
		}
	}
	writeError(w, http.StatusNotFound, sql.ErrNoRows)
}

func (s *Server) recentPackets(w http.ResponseWriter, r *http.Request) {
	packets, err := s.Store.RecentPackets(r.Context(), queryInt(r, "limit", 100))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, packets)
}

func (s *Server) packetByHash(w http.ResponseWriter, r *http.Request) {
	packet, err := s.Store.PacketByHash(r.Context(), r.PathValue("packetHash"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, http.StatusOK, packet)
}

func (s *Server) debugResolution(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Store.ResolutionDebug(r.Context(), r.URL.Query().Get("status"), queryInt(r, "limit", 50))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) debugCollisions(w http.ResponseWriter, r *http.Request) {
	hashSize := queryInt(r, "hashSize", 1)
	rows, err := s.Store.Collisions(r.Context(), strings.ToUpper(r.URL.Query().Get("iata")), hashSize, queryInt(r, "limit", 100))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) debugStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.Store.Stats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"serverTime":          time.Now().UnixMilli(),
		"stats":               stats,
		"mqttConnected":       s.mqttConnected(),
		"mqttMessagesTotal":   s.mqttTotal(),
		"wsClients":           s.wsClientCount(),
		"strictRFOnly":        s.Config.StrictRFOnly,
		"publicMode":          s.Config.PublicMode,
		"maxUnverifiedEdgeKm": s.Config.MaxUnverifiedEdgeKM,
		"defaultCenter":       []float64{s.Config.DefaultCenterLng, s.Config.DefaultCenterLat},
		"defaultZoom":         s.Config.DefaultZoom,
	})
}

func (s *Server) mqttConnected() bool {
	if s.MQTTConnected == nil {
		return false
	}
	return s.MQTTConnected()
}

func (s *Server) mqttTotal() int64 {
	if s.MQTTTotal == nil {
		return 0
	}
	return s.MQTTTotal()
}

func (s *Server) publicHubStats() live.HubStats {
	if s.PublicHub == nil {
		return live.HubStats{}
	}
	return s.PublicHub.Stats()
}

func (s *Server) wsClientCount() int {
	count := 0
	if s.Hub != nil {
		count += s.Hub.ClientCount()
	}
	if s.PublicHub != nil {
		count += s.PublicHub.ClientCount()
	}
	return count
}

func (s *Server) recordPublicState(duration time.Duration, failed bool) {
	if s.Runtime != nil {
		s.Runtime.RecordPublicState(duration, failed)
	}
	s.logAPI("public_state", duration, failed)
}

func (s *Server) recordPublicHistory(duration time.Duration, failed bool) {
	if s.Runtime != nil {
		s.Runtime.RecordPublicHistory(duration, failed)
	}
	s.logAPI("public_history", duration, failed)
}

func (s *Server) recordPublicSummary(duration time.Duration, failed bool) {
	if s.Runtime != nil {
		s.Runtime.RecordPublicSummary(duration, failed)
	}
	s.logAPI("public_history_summary", duration, failed)
}

func (s *Server) recordPublicPackets(duration time.Duration, failed bool) {
	if s.Runtime != nil {
		s.Runtime.RecordPublicPackets(duration, failed)
	}
	s.logAPI("public_packets", duration, failed)
}

func (s *Server) logAPI(name string, duration time.Duration, failed bool) {
	if s.Log == nil {
		return
	}
	if failed {
		s.Log.Warn("public api request failed", "route", name, "latencyMs", duration.Milliseconds())
		return
	}
	s.Log.Debug("public api request", "route", name, "latencyMs", duration.Milliseconds())
}

func fallbackString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func canonicalHistorySummaryWindow(from, to int64) (int64, int64) {
	if publicHistorySummaryRoundMs <= 0 {
		return from, to
	}
	from = (from / publicHistorySummaryRoundMs) * publicHistorySummaryRoundMs
	to = (to / publicHistorySummaryRoundMs) * publicHistorySummaryRoundMs
	if to < from {
		to = from
	}
	return from, to
}

func queryInt(r *http.Request, key string, fallback int) int {
	if raw := r.URL.Query().Get(key); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			return parsed
		}
	}
	return fallback
}

func queryInt64(r *http.Request, key string, fallback int64) int64 {
	if raw := r.URL.Query().Get(key); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			return parsed
		}
	}
	return fallback
}

func queryBool(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "t", "true", "y", "yes", "on":
		return true
	default:
		return false
	}
}

func trimBounded(value string, maxLen int) string {
	value = strings.TrimSpace(value)
	if maxLen > 0 && len(value) > maxLen {
		return value[:maxLen]
	}
	return value
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": err.Error()})
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return withCompression(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	}))
}

func withCompression(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !shouldGzip(r) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gz := gzipWriterPool.Get().(*gzip.Writer)
		gz.Reset(w)
		defer func() {
			gz.Close()
			gzipWriterPool.Put(gz)
		}()
		next.ServeHTTP(gzipResponseWriter{ResponseWriter: w, Writer: gz}, r)
	})
}

type gzipResponseWriter struct {
	http.ResponseWriter
	io.Writer
}

func (w gzipResponseWriter) WriteHeader(statusCode int) {
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w gzipResponseWriter) Write(data []byte) (int, error) {
	w.Header().Del("Content-Length")
	return w.Writer.Write(data)
}

func shouldGzip(r *http.Request) bool {
	if strings.Contains(strings.ToLower(r.Header.Get("Upgrade")), "websocket") {
		return false
	}
	if r.Header.Get("Range") != "" {
		return false
	}
	return strings.Contains(r.Header.Get("Accept-Encoding"), "gzip")
}
