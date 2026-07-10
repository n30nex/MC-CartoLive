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
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := api.Server{
		Config:        api.Config{PublicMode: true, AppVersion: "2.1.10", GitSHA: "abcdef1", BuildTime: "2026-05-23T00:00:00Z"},
		Store:         st,
		PublicHub:     live.NewHub(log, 4),
		MQTTConnected: func() bool { return true },
		MQTTStatus: func(time.Time) imqtt.Status {
			return imqtt.Status{Enabled: true, Connected: true, Subscribed: true, SessionReady: true, TotalMessages: 77}
		},
		PublicState:       cache.Snapshot,
		PublicCacheStatus: cache.Status,
		StaticAssetsReady: func() bool { return true },
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
	allowed := map[string]struct{}{}
	for _, key := range []string{"ok", "ready", "dbReady", "staticReady", "publicStateReady", "mqttSessionReady", "datasetState", "datasetStartedAt", "storagePressureState", "version", "gitSha", "buildTime"} {
		allowed[key] = struct{}{}
		if _, ok := payload[key]; !ok {
			t.Fatalf("healthz missing %q in %#v", key, payload)
		}
	}
	if len(payload) != len(allowed) {
		for key := range payload {
			if _, ok := allowed[key]; !ok {
				t.Fatalf("healthz exposed unexpected field %q in %#v", key, payload)
			}
		}
		t.Fatalf("healthz field count = %d, want %d: %#v", len(payload), len(allowed), payload)
	}
	if payload["version"] != "2.1.10" || payload["gitSha"] != "abcdef1" || payload["buildTime"] == "" {
		t.Fatalf("build metadata = %#v", payload)
	}
	if payload["ok"] != true || payload["ready"] != true || payload["datasetState"] != "live" || payload["storagePressureState"] != "ok" {
		t.Fatalf("minimal health state = %#v", payload)
	}
	raw := response.Body.String()
	for _, forbidden := range []string{"packetHash", "raw_hex", "publicKey", "pathHex", "resolver"} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("healthz leaked forbidden token %q: %s", forbidden, raw)
		}
	}
}

func TestHealthzDoesNotExposeTrafficMotionTelemetry(t *testing.T) {
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
		StaticAssetsReady: func() bool { return true },
		MQTTConnected:     func() bool { return true },
		MQTTTotal:         func() int64 { return 100 },
		MQTTStatus: func(time.Time) imqtt.Status {
			return imqtt.Status{Enabled: true, Connected: true, Subscribed: true, SessionReady: true, TotalMessages: 100, LastMessageAgeMs: 45_000}
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
	if payload["datasetState"] != "live" || payload["mqttSessionReady"] != true {
		t.Fatalf("public dataset/session summary = %#v", payload)
	}
	for _, key := range []string{"mqttConnected", "mqttMessages", "mqttLastMessageAgeMs", "packetIngestState", "packetIngestFresh", "mapMotionState", "mapMotionFresh", "routeMotionState", "liveConfidenceState", "publicLiveFresh"} {
		if _, found := payload[key]; found {
			t.Fatalf("healthz exposed traffic/motion telemetry %q: %#v", key, payload)
		}
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
		StaticAssetsReady: func() bool { return true },
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
	for _, forbidden := range []string{
		"memAllocBytes", "publicHistoryRequests", "fullReconcileAgeMs", "ingestQueueDepth", "ingestQueueCapacity",
		"ingestQueueOldestItemAgeMs", "ingestAccepted", "ingestProcessed", "ingestDropped", "counterReset",
		"derivedQueueDepth", "derivedQueueCapacity", "derivedQueueOldestItemAgeMs", "derivedDropped",
	} {
		if strings.Contains(ready.Body.String(), forbidden) {
			t.Fatalf("readyz leaked detailed field %q: %s", forbidden, ready.Body.String())
		}
	}
}

func TestReadyzFailsClosedOnProcessWriteFailureCounter(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	cache.Replace(live.PublicLiveState{ServerTime: time.Now().UnixMilli()}, nil)
	runtimeStats := live.NewRuntimeStats()
	runtimeStats.RecordStoreWrite(time.Millisecond, 0, true, false, true)
	server := api.Server{
		Config:            api.Config{PublicMode: true},
		Store:             st,
		PublicHub:         live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4),
		Runtime:           runtimeStats,
		PublicState:       cache.Snapshot,
		PublicCacheStatus: cache.Status,
		StaticAssetsReady: func() bool { return true },
	}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestReadyzDuplicateCounterIsBenignAndCacheFailureCanRecover(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	cache.Replace(live.PublicLiveState{ServerTime: time.Now().UnixMilli()}, nil)
	runtimeStats := live.NewRuntimeStats()
	runtimeStats.RecordIngestDuplicate()
	runtimeStats.RecordCacheRefresh(time.Millisecond, true)
	runtimeStats.RecordCacheRefresh(time.Millisecond, false)
	server := api.Server{
		Config: api.Config{PublicMode: true}, Store: st,
		PublicHub: live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4), Runtime: runtimeStats,
		PublicState: cache.Snapshot, PublicCacheStatus: cache.Status, StaticAssetsReady: func() bool { return true },
	}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("readyz status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestReadyzFailsOnCurrentPrimaryQueuePressure(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	cache.Replace(live.PublicLiveState{ServerTime: time.Now().UnixMilli()}, nil)
	for _, tc := range []struct {
		name   string
		status imqtt.Status
	}{
		{"occupancy", imqtt.Status{Enabled: true, Connected: true, SessionReady: true, QueueDepth: 75, QueueCapacity: 100}},
		{"oldest", imqtt.Status{Enabled: true, Connected: true, SessionReady: true, QueueDepth: 1, QueueCapacity: 100, OldestQueueItemAgeMs: 2001}},
		{"drops", imqtt.Status{Enabled: true, Connected: true, SessionReady: true, QueueCapacity: 100, DroppedMessages: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := api.Server{
				Config: api.Config{PublicMode: true}, Store: st,
				PublicHub: live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4), Runtime: live.NewRuntimeStats(),
				PublicState: cache.Snapshot, PublicCacheStatus: cache.Status, StaticAssetsReady: func() bool { return true },
				MQTTStatus: func(time.Time) imqtt.Status { return tc.status },
			}
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("readyz status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestReadyzFailsOnStaleReconcileAndDerivedQueueErrors(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	cache.Replace(live.PublicLiveState{ServerTime: time.Now().UnixMilli()}, nil)
	for _, tc := range []struct {
		name    string
		runtime *live.RuntimeStats
		status  func(time.Time) live.PublicCacheStatus
	}{
		{"stale reconcile", live.NewRuntimeStats(), func(time.Time) live.PublicCacheStatus {
			return live.PublicCacheStatus{Ready: true, FullReconcileAgeMs: 30_001}
		}},
		{"derived drop", func() *live.RuntimeStats {
			r := live.NewRuntimeStats()
			r.RecordDerivedDrop(1, 10, time.Now().UnixMilli())
			return r
		}(), cache.Status},
		{"derived oldest", func() *live.RuntimeStats {
			r := live.NewRuntimeStats()
			r.RecordDerivedEnqueue(1, 10, time.Now().Add(-3*time.Second).UnixMilli())
			return r
		}(), cache.Status},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := api.Server{
				Config: api.Config{PublicMode: true}, Store: st,
				PublicHub: live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4), Runtime: tc.runtime,
				PublicState: cache.Snapshot, PublicCacheStatus: tc.status, StaticAssetsReady: func() bool { return true },
			}
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("readyz status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
