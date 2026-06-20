package tests

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/api"
	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/resolve"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestPublicHistoryEndpointReturnsSanitizedOldestFirstEventsWithCursor(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	observerKey := "AA00000000000000000000000000000000000000000000000000000000000000"
	if err := st.ApplyManualNode(ctx, observerKey, "YYZ Observer", 43.65, -79.38, "test"); err != nil {
		t.Fatal(err)
	}
	base := time.Now().Add(-time.Hour).UnixMilli()
	observerOnlyID := insertHistoryObservation(t, ctx, st, "hash-observer-private", "YYZ", observerKey, base+1_000, resolve.StatusNoPath)
	routedID := insertHistoryObservation(t, ctx, st, "hash-route-private", "YYZ", observerKey, base+2_000, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, routedID, "hash-route-private", base+2_000)
	secondRoutedID := insertHistoryObservation(t, ctx, st, "hash-route-private-2", "YYZ", observerKey, base+2_500, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, secondRoutedID, "hash-route-private-2", base+2_500)
	prgID := insertHistoryObservation(t, ctx, st, "hash-prg-private", "PRG", observerKey, base+2_700, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, prgID, "hash-prg-private", base+2_700)

	server := publicHistoryTestServer(st, func(iata string) bool { return strings.ToUpper(iata) == "YYZ" })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/history?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("history status = %d body=%s", response.Code, response.Body.String())
	}
	var history live.PublicHistoryResponse
	if err := json.Unmarshal(response.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if got, want := len(history.Events), 2; got != want {
		t.Fatalf("history events = %d, want %d: %#v", got, want, history.Events)
	}
	if history.Events[0].At != base+2_000 || history.Events[0].Type != "routePulse" {
		t.Fatalf("first event = %#v, want oldest routed pulse only", history.Events[0])
	}
	if history.Events[1].At != base+2_500 || history.Events[1].Type != "routePulse" {
		t.Fatalf("second event = %#v, want second routed pulse", history.Events[1])
	}
	raw := response.Body.String()
	for _, forbidden := range []string{
		"activity",
		"packetHash",
		"observerPublicKey",
		"pathHex",
		"resolutionReason",
		"hash-observer-private",
		"hash-route-private",
		"hash-route-private-2",
		"hash-prg-private",
		"secret summary",
	} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("history response leaked forbidden value %q: %s", forbidden, raw)
		}
	}
	if strings.Contains(raw, "PRG") {
		t.Fatalf("history response included disallowed IATA: %s", raw)
	}
	if !strings.Contains(raw, "hello public") {
		t.Fatalf("history should retain sanitized public message text: %s", raw)
	}
	if observerOnlyID <= 0 {
		t.Fatalf("invalid observation ID")
	}

	firstPage := httptest.NewRecorder()
	firstRequest := httptest.NewRequest(http.MethodGet, "/api/v1/public/history?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=1", nil)
	server.Routes().ServeHTTP(firstPage, firstRequest)
	if firstPage.Code != http.StatusOK {
		t.Fatalf("first cursor page status = %d body=%s", firstPage.Code, firstPage.Body.String())
	}
	var page1 live.PublicHistoryResponse
	if err := json.Unmarshal(firstPage.Body.Bytes(), &page1); err != nil {
		t.Fatal(err)
	}
	if page1.NextCursor == "" {
		t.Fatalf("first page missing next cursor")
	}
	secondPage := httptest.NewRecorder()
	secondRequest := httptest.NewRequest(http.MethodGet, "/api/v1/public/history?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=1&cursor="+page1.NextCursor, nil)
	server.Routes().ServeHTTP(secondPage, secondRequest)
	if secondPage.Code != http.StatusOK {
		t.Fatalf("second cursor page status = %d body=%s", secondPage.Code, secondPage.Body.String())
	}
	var page2 live.PublicHistoryResponse
	if err := json.Unmarshal(secondPage.Body.Bytes(), &page2); err != nil {
		t.Fatal(err)
	}
	if len(page2.Events) != 1 || page2.Events[0].Type != "routePulse" || page2.Events[0].At != base+2_500 {
		t.Fatalf("second page = %#v, want second route pulse", page2.Events)
	}
}

func TestPublicHistoryEndpointEnforcesWindowAndLimitCaps(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	now := time.Now().UnixMilli()
	server := publicHistoryTestServer(st, func(string) bool { return true })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/history?from="+ms(now-10*24*60*60_000)+"&to="+ms(now)+"&limit=9999", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("history status = %d body=%s", response.Code, response.Body.String())
	}
	var history live.PublicHistoryResponse
	if err := json.Unmarshal(response.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if history.Window.To-history.Window.From > 7*24*60*60_000 {
		t.Fatalf("window = %#v, want capped to 7d", history.Window)
	}
	if history.Window.Count > 2000 {
		t.Fatalf("window count = %d, want <= 2000", history.Window.Count)
	}
}

func TestPublicHistoryFallsBackWhenProjectionIncomplete(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	observerKey := "AA00000000000000000000000000000000000000000000000000000000000000"
	base := time.Now().Add(-time.Hour).UnixMilli()
	firstID := insertHistoryObservation(t, ctx, st, "hash-history-projected-private", "YYZ", observerKey, base+1_000, resolve.StatusHigh)
	firstEdge := insertHistoryEdge(t, ctx, st, firstID, "hash-history-projected-private", base+1_000)
	secondID := insertHistoryObservation(t, ctx, st, "hash-history-missing-projection-private", "YYZ", observerKey, base+2_000, resolve.StatusHigh)
	secondEdge := insertHistoryEdge(t, ctx, st, secondID, "hash-history-missing-projection-private", base+2_000)
	if firstEdge <= 0 || secondEdge <= 0 {
		t.Fatalf("invalid edge ids")
	}
	if err := st.DeletePublicPacketPathForEdge(ctx, secondEdge); err != nil {
		t.Fatal(err)
	}
	complete, err := st.PublicPacketPathProjectionComplete(ctx, base, base+3_000)
	if err != nil {
		t.Fatal(err)
	}
	if complete {
		t.Fatalf("projection should be incomplete after deleting one projected row")
	}

	server := publicHistoryTestServer(st, func(iata string) bool { return strings.ToUpper(iata) == "YYZ" })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/history?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("history status = %d body=%s", response.Code, response.Body.String())
	}
	var history live.PublicHistoryResponse
	if err := json.Unmarshal(response.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if got, want := len(history.Events), 2; got != want {
		t.Fatalf("history events = %d, want %d from legacy fallback: %#v", got, want, history.Events)
	}
	if history.Events[0].At != base+1_000 || history.Events[1].At != base+2_000 {
		t.Fatalf("history events = %#v, want both legacy edge events oldest-first", history.Events)
	}
	raw := response.Body.String()
	if strings.Contains(raw, "hash-history") || strings.Contains(raw, "packetHash") || strings.Contains(raw, "pathHex") {
		t.Fatalf("history fallback leaked private fields: %s", raw)
	}
}

func publicHistoryTestServer(st *store.Store, allows func(string) bool) api.Server {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return api.Server{
		Config:           api.Config{PublicMode: true},
		Store:            st,
		PublicHub:        live.NewHub(log, 4),
		MQTTConnected:    func() bool { return false },
		MQTTTotal:        func() int64 { return 0 },
		PublicAllowsIATA: allows,
	}
}

func insertHistoryObservation(t *testing.T, ctx context.Context, st *store.Store, hash string, iata string, observerKey string, heardAt int64, status string) int64 {
	t.Helper()
	parsed := meshcore.ParsedPacket{
		PacketHash:      hash,
		RawHex:          "00",
		RouteTypeName:   "FLOOD",
		PayloadTypeName: "PLAIN_TEXT",
		HashSize:        3,
		HopCount:        1,
		PathBytes:       []byte{0xaa, 0xbb, 0xcc},
		Payload:         []byte{0x01, 0x02},
	}
	if err := st.UpsertPacket(ctx, parsed, heardAt); err != nil {
		t.Fatal(err)
	}
	id, err := st.InsertObservation(ctx, store.ObservationInsert{
		Message: imqtt.NormalizedMessage{
			TopicInfo:    imqtt.TopicInfo{IATA: iata, PublisherPK: observerKey, Subtopic: "packets"},
			ObserverName: "Observer",
			RawJSON:      `{"private":"not public"}`,
			HeardAtMs:    heardAt,
		},
		Parsed:        parsed,
		Summary:       "secret summary",
		MessageSender: "Alice",
		MessageText:   "hello public",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateObservationResolution(ctx, id, status, "private resolver reason"); err != nil {
		t.Fatal(err)
	}
	return id
}

func insertHistoryEdge(t *testing.T, ctx context.Context, st *store.Store, observationID int64, hash string, heardAt int64) int64 {
	t.Helper()
	edge, err := st.InsertEdgeEvent(ctx, live.EdgeEvent{
		PacketHash:      hash,
		ObservationID:   observationID,
		PayloadType:     2,
		PayloadTypeName: "PLAIN_TEXT",
		MessageSender:   "Alice",
		MessageText:     "hello public",
		HeardAt:         heardAt,
		Segments: []live.EdgeSegment{
			{
				From:       live.EdgeEndpoint{NodeID: "node-a", Name: "Sender", Lat: 43.65, Lng: -79.38},
				To:         live.EdgeEndpoint{NodeID: "node-b", Name: "Repeater", Lat: 45.42, Lng: -75.69},
				DistanceKM: 360,
			},
		},
		RenderReason: "resolved_path_high_confidence",
	}, "high", "test")
	if err != nil {
		t.Fatal(err)
	}
	return edge.ID
}

func ms(value int64) string {
	return strconv.FormatInt(value, 10)
}
