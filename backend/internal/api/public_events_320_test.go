package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestPublicEventsResetCursorNeverScansHistory(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	now := time.Now().UnixMilli()
	for i := 0; i < 3; i++ {
		if _, err := st.InsertPublicEvent(ctx, live.PublicEvent{
			Type: "activity", At: now + int64(i), Region: "YYZ",
			Data: map[string]any{"id": i},
		}); err != nil {
			t.Fatal(err)
		}
	}

	server := newPublic320TestServer(st, live.PublicLiveState{})
	for _, path := range []string{
		"/api/v1/public/events?afterSeq=0&limit=25",
		"/api/v1/public/events?afterSeq=99&limit=25",
	} {
		response := httptest.NewRecorder()
		server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, response.Code, response.Body.String())
		}
		var body live.PublicEventsResponse
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if !body.ResetRequired || body.OldestSeq != 1 || body.LatestSeq != 3 || body.NextCursor != "3" || len(body.Events) != 0 {
			t.Fatalf("%s reset response = %#v", path, body)
		}
	}
}

func TestPublicEventsEmptyTableReturnsResetMetadata(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	server := newPublic320TestServer(st, live.PublicLiveState{})
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/public/events?afterSeq=0", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body live.PublicEventsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.ResetRequired || body.OldestSeq != 0 || body.LatestSeq != 0 || body.NextCursor != "" || len(body.Events) != 0 {
		t.Fatalf("empty reset response = %#v", body)
	}
}

func TestPublicEventsCursorImmediatelyBeforeRetainedFloorIsValid(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	now := time.Now().UnixMilli()
	if _, err := st.InsertPublicEvent(ctx, live.PublicEvent{Type: "activity", At: now - int64(48*time.Hour/time.Millisecond), Data: map[string]any{"id": "expired"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.InsertPublicEvent(ctx, live.PublicEvent{Type: "activity", At: now, Data: map[string]any{"id": "retained"}}); err != nil {
		t.Fatal(err)
	}
	if err := st.PrunePublicEvents(ctx, now-int64(24*time.Hour/time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	server := newPublic320TestServer(st, live.PublicLiveState{})
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/public/events?afterSeq=1", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body live.PublicEventsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.ResetRequired || body.OldestSeq != 2 || len(body.Events) != 1 || body.Events[0].Seq != 2 {
		t.Fatalf("retained-floor response = %#v", body)
	}
}

func TestPublicEventsValidCursorReturnsResumeCursor(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	now := time.Now().UnixMilli()
	for i := 0; i < 3; i++ {
		if _, err := st.InsertPublicEvent(ctx, live.PublicEvent{Type: "activity", At: now + int64(i), Region: "YYZ", Data: map[string]any{"id": i}}); err != nil {
			t.Fatal(err)
		}
	}
	server := newPublic320TestServer(st, live.PublicLiveState{})
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/public/events?afterSeq=1&limit=25", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body live.PublicEventsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.ResetRequired || len(body.Events) != 2 || body.Events[0].Seq != 2 || body.Events[1].Seq != 3 || body.NextCursor != "3" {
		t.Fatalf("resume response = %#v", body)
	}
}

func TestPublicBootstrapIsCompactAndPublicSafe(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	now := time.Now().UnixMilli()
	state := live.PublicLiveState{
		Map:   live.PublicMapConfig{RegionPreset: "canada", DefaultRegion: "YYZ"},
		Stats: live.PublicStats{Packets: 10, ActiveNodes: 2, ActiveRoutes: 1},
		Nodes: []live.PublicNode{
			{ID: "public-a", Latitude: 43.65, Longitude: -79.38, LastSeen: now, RegionsHeardIn: []string{"YYZ"}, ActivityCount: 4},
			{ID: "public-b", Latitude: 43.67, Longitude: -79.40, LastSeen: now - 1, RegionsHeardIn: []string{"YYZ"}, ActivityCount: 6},
		},
		RecentActivity: []live.PublicActivity{{ID: "safe-activity", HeardAt: now}},
	}
	server := newPublic320TestServer(st, state)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/public/bootstrap", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body live.PublicBootstrapResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Health.DatasetState != "live" || body.Health.StoragePressureState != "ok" || len(body.Clusters) != 1 || body.Clusters[0].Count != 2 {
		t.Fatalf("bootstrap = %#v", body)
	}
	if len(response.Body.Bytes()) > 150*1024 {
		t.Fatalf("bootstrap size = %d, want <= 150 KiB", response.Body.Len())
	}
}

func TestPublicOpenAPISchemaInventoriesEveryPublicRoute(t *testing.T) {
	schema := publicOpenAPISchema("3.2.0")
	paths := schema["paths"].(map[string]any)
	for _, path := range []string{
		"/healthz", "/readyz", "/ws/public",
		"/api/v1/public/state", "/api/v1/public/bootstrap", "/api/v1/public/history",
		"/api/v1/public/history/summary", "/api/v1/public/events", "/api/v1/public/viewport",
		"/api/v1/public/noc", "/api/v1/public/packets", "/api/v1/public/chat",
		"/api/v1/public/solar", "/api/v1/public/propagation", "/api/v1/public/coverage",
		"/api/v1/public/los/profile", "/api/v1/public/schema",
		"/api/v1/public/integrations/home-assistant",
	} {
		if _, ok := paths[path]; !ok {
			t.Fatalf("OpenAPI missing public route %s", path)
		}
	}
	components := schema["components"].(map[string]any)["schemas"].(map[string]any)
	for _, name := range []string{"PublicMapCluster", "PublicRuntimeHealth", "PublicEventsResponse", "PublicBootstrapResponse", "PublicViewportResponse"} {
		if _, ok := components[name]; !ok {
			t.Fatalf("OpenAPI missing schema %s", name)
		}
	}
}

func TestPublicViewportLowZoomReturnsAggregatesWithoutDetail(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	state := live.PublicLiveState{
		Nodes: []live.PublicNode{
			{ID: "a", Latitude: 43.6, Longitude: -79.3, RegionsHeardIn: []string{"YYZ"}},
			{ID: "b", Latitude: 45.4, Longitude: -75.7, RegionsHeardIn: []string{"YOW"}},
		},
		Routes: []live.PublicRoute{{ID: "route-a-b", From: live.PublicRouteEndpoint{NodeID: "a", Lat: 43.6, Lng: -79.3}, To: live.PublicRouteEndpoint{NodeID: "b", Lat: 45.4, Lng: -75.7}}},
	}
	server := newPublic320TestServer(st, state)
	low := httptest.NewRecorder()
	server.Routes().ServeHTTP(low, httptest.NewRequest(http.MethodGet, "/api/v1/public/viewport?bbox=-141,41,-52,84&zoom=5&include=nodes,routes", nil))
	if low.Code != http.StatusOK {
		t.Fatalf("low zoom status=%d body=%s", low.Code, low.Body.String())
	}
	var lowBody live.PublicViewportResponse
	if err := json.Unmarshal(low.Body.Bytes(), &lowBody); err != nil {
		t.Fatal(err)
	}
	if len(lowBody.Nodes) != 0 || len(lowBody.Routes) != 0 || len(lowBody.Clusters) != 2 || !publicViewportHasInclude(lowBody.Includes, "clusters") {
		t.Fatalf("low zoom leaked detail: %#v", lowBody)
	}

	high := httptest.NewRecorder()
	server.Routes().ServeHTTP(high, httptest.NewRequest(http.MethodGet, "/api/v1/public/viewport?bbox=-141,41,-52,84&zoom=8", nil))
	if high.Code != http.StatusOK {
		t.Fatalf("detail zoom status=%d body=%s", high.Code, high.Body.String())
	}
	var highBody live.PublicViewportResponse
	if err := json.Unmarshal(high.Body.Bytes(), &highBody); err != nil {
		t.Fatal(err)
	}
	if len(highBody.Nodes) != 2 || len(highBody.Routes) != 1 || len(highBody.Clusters) != 0 {
		t.Fatalf("detail zoom response=%#v", highBody)
	}
}

func newPublic320TestServer(st *store.Store, state live.PublicLiveState) *Server {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	cache.Replace(state, nil)
	return &Server{
		Config:            Config{PublicMode: true, PublicEventsEnabled: true, PublicViewportEnabled: true},
		Store:             st,
		PublicHub:         live.NewHub(log, 8),
		Runtime:           live.NewRuntimeStats(),
		PublicState:       cache.Snapshot,
		PublicCacheStatus: cache.Status,
		MQTTStatus: func(time.Time) mqtt.Status {
			return mqtt.Status{Enabled: true, Connected: true, Subscribed: true, SessionReady: true}
		},
	}
}
