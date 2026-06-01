package tests

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/api"
	"meshcore-canada-live-map/backend/internal/live"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestHealthzIncludesPublicSafeOperationalFields(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	cache := live.NewPublicStateCache(live.NewPublicIATAFilter([]string{"YYZ"}))
	now := time.Now().UnixMilli()
	cache.Replace(live.PublicLiveState{
		ServerTime: now,
		Stats: live.PublicStats{
			Packets:      42,
			ActiveNodes:  3,
			ActiveRoutes: 2,
		},
		RecentPulses: []live.PublicRoutePulse{{ID: "pulse-1", HeardAt: now - 1_000}},
		RecentActivity: []live.PublicActivity{
			{ID: "activity-observer", AnimationState: live.PublicAnimationObserver, HeardAt: now - 2_000},
		},
	}, nil)
	runtime := live.NewRuntimeStats()
	runtime.RecordPublicHistory(12*time.Millisecond, false)
	runtime.RecordPublicPackets(17*time.Millisecond, true)
	runtime.RecordPublicPacketsScan(2500, true)
	runtime.RecordPacketCountRefresh(19*time.Millisecond, false)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := api.Server{
		Config:            api.Config{PublicMode: true, AppVersion: "2.1.10", GitSHA: "abcdef1", BuildTime: "2026-05-23T00:00:00Z"},
		Store:             st,
		PublicHub:         live.NewHub(log, 4),
		Runtime:           runtime,
		MQTTConnected:     func() bool { return true },
		MQTTTotal:         func() int64 { return 77 },
		PublicState:       cache.Snapshot,
		PublicCacheStatus: cache.Status,
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("healthz status = %d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"cacheAgeMs", "cacheTruncatedNodes", "cacheTruncatedRoutes", "cacheTruncatedRecentPulses", "cacheTruncatedRecentActivity", "mqttConnected", "wsDroppedMessages", "publicStateReady", "dbReady", "version", "gitSha", "buildTime", "publicHistoryRequests", "publicPacketsRequests", "publicPacketsErrors", "publicPacketsLatencyMs", "publicPacketsLastScan", "publicPacketsScanCapped", "packetCountRefreshFailures", "packetCountRefreshLatencyMs", "packetCountRefreshLastAt", "recentRoutePulseAgeMs", "recentObserverBurstAgeMs", "packetIngestState", "publicCacheState", "routeMotionState", "observerMotionState", "mapMotionState", "liveConfidenceState", "packetIngestFresh", "mapMotionFresh", "publicLiveFresh"} {
		if _, ok := payload[key]; !ok {
			t.Fatalf("healthz missing %q in %#v", key, payload)
		}
	}
	if payload["publicPacketsRequests"] != float64(1) || payload["publicPacketsErrors"] != float64(1) {
		t.Fatalf("packets counters = %#v", payload)
	}
	if payload["version"] != "2.1.10" || payload["gitSha"] != "abcdef1" || payload["buildTime"] == "" {
		t.Fatalf("build metadata = %#v", payload)
	}
	if payload["publicLiveFresh"] != true {
		t.Fatalf("publicLiveFresh = %#v, want true in fresh fixture", payload["publicLiveFresh"])
	}
	if payload["packetIngestState"] != "fresh" || payload["mapMotionState"] != "moving" || payload["liveConfidenceState"] != "fresh" {
		t.Fatalf("live confidence fields = %#v", payload)
	}
	raw := response.Body.String()
	for _, forbidden := range []string{"packetHash", "raw_hex", "publicKey", "pathHex", "resolver"} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("healthz leaked forbidden token %q: %s", forbidden, raw)
		}
	}
}

func TestHealthzSeparatesPacketIngestFromQuietMapMotion(t *testing.T) {
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter([]string{"YYZ"}))
	now := time.Now().UnixMilli()
	cache.Replace(live.PublicLiveState{
		ServerTime: now,
		Stats:      live.PublicStats{Packets: 100},
	}, nil)
	server := api.Server{
		Config:            api.Config{PublicMode: true},
		PublicHub:         live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4),
		PublicState:       cache.Snapshot,
		PublicCacheStatus: cache.Status,
		MQTTConnected:     func() bool { return true },
		MQTTTotal:         func() int64 { return 100 },
		MQTTStatus: func(time.Time) imqtt.Status {
			return imqtt.Status{Connected: true, TotalMessages: 100, LastMessageAgeMs: 4000}
		},
	}

	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("healthz status = %d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["packetIngestState"] != "fresh" || payload["packetIngestFresh"] != true {
		t.Fatalf("packet ingest should be fresh under 5s: %#v", payload)
	}
	if payload["mapMotionState"] != "missing" || payload["mapMotionFresh"] != false {
		t.Fatalf("map motion should be separate from packet ingest: %#v", payload)
	}
	if payload["publicLiveFresh"] != true || payload["liveConfidenceState"] != "quiet" {
		t.Fatalf("quiet routed motion should not mark ingest stale: %#v", payload)
	}
}

func TestHealthzBuildMetadataFallbacksAreNonEmpty(t *testing.T) {
	server := api.Server{
		Config:        api.Config{PublicMode: true},
		PublicHub:     live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4),
		MQTTConnected: func() bool { return false },
		MQTTTotal:     func() int64 { return 0 },
	}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("healthz status = %d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["version"] == "" || payload["gitSha"] == "" || payload["buildTime"] == "" {
		t.Fatalf("metadata fallback should be non-empty: %#v", payload)
	}
}

func TestReadyzFailsUntilPublicCacheReady(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	server := api.Server{
		Config:            api.Config{PublicMode: true},
		Store:             st,
		PublicHub:         live.NewHub(log, 4),
		PublicState:       cache.Snapshot,
		PublicCacheStatus: cache.Status,
		MQTTConnected:     func() bool { return false },
		MQTTTotal:         func() int64 { return 0 },
	}

	notReady := httptest.NewRecorder()
	server.Routes().ServeHTTP(notReady, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if notReady.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz before cache = %d body=%s", notReady.Code, notReady.Body.String())
	}

	cache.Replace(live.PublicLiveState{ServerTime: time.Now().UnixMilli()}, nil)
	ready := httptest.NewRecorder()
	server.Routes().ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if ready.Code != http.StatusOK {
		t.Fatalf("readyz after cache = %d body=%s", ready.Code, ready.Body.String())
	}
}
