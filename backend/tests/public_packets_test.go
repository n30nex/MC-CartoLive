package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/resolve"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestPublicPacketsEndpointReturnsOnlySanitizedTrueRoutedPackets(t *testing.T) {
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
	invalidID := insertHistoryObservation(t, ctx, st, "hash-invalid-private", "YYZ", observerKey, base+2_200, resolve.StatusHigh)
	insertInvalidHistoryEdge(t, ctx, st, invalidID, "hash-invalid-private", base+2_200)
	disallowedID := insertHistoryObservation(t, ctx, st, "hash-prg-private", "PRG", observerKey, base+2_400, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, disallowedID, "hash-prg-private", base+2_400)

	server := publicHistoryTestServer(st, func(iata string) bool { return strings.ToUpper(iata) == "YYZ" })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/packets?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("packets status = %d body=%s", response.Code, response.Body.String())
	}
	var packets live.PublicPacketsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &packets); err != nil {
		t.Fatal(err)
	}
	if got, want := len(packets.Packets), 1; got != want {
		t.Fatalf("packets = %d, want %d: %#v", got, want, packets.Packets)
	}
	packet := packets.Packets[0]
	if packet.At != base+2_000 || packet.IATA != "YYZ" || packet.HopCount != 1 || packet.SegmentCount != 1 {
		t.Fatalf("packet summary = %#v, want the single valid YYZ routed packet", packet)
	}
	if packet.DistanceKM != 360 || len(packet.Segments) != 1 || len(packet.EndpointLabels) != 2 {
		t.Fatalf("packet path = %#v, want public segment details", packet)
	}
	if packets.Scan.EventsScanned == 0 || packets.Scan.ScanLimit == 0 || packets.Scan.Filtered || packets.Scan.Partial {
		t.Fatalf("scan summary = %#v, want public-safe complete unfiltered scan metadata", packets.Scan)
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
		"hash-invalid-private",
		"hash-prg-private",
		"secret summary",
	} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("packets response leaked forbidden value %q: %s", forbidden, raw)
		}
	}
	if strings.Contains(raw, "PRG") {
		t.Fatalf("packets response included disallowed IATA: %s", raw)
	}
	if observerOnlyID <= 0 {
		t.Fatalf("invalid observation ID")
	}
}

func TestPublicPacketsEndpointFallsBackToRawEdgesWhenProjectionTableMissingRows(t *testing.T) {
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
	observedID := insertHistoryObservation(t, ctx, st, "hash-fallback-private", "YYZ", observerKey, base+1_000, resolve.StatusHigh)
	edgeID := insertHistoryEdge(t, ctx, st, observedID, "hash-fallback-private", base+1_000)
	if err := st.DeletePublicPacketPathForEdge(ctx, edgeID); err != nil {
		t.Fatal(err)
	}

	server := publicHistoryTestServer(st, func(iata string) bool { return strings.ToUpper(iata) == "YYZ" })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/packets?from="+ms(base)+"&to="+ms(base+2_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("packets status = %d body=%s", response.Code, response.Body.String())
	}
	var packets live.PublicPacketsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &packets); err != nil {
		t.Fatal(err)
	}
	if got, want := len(packets.Packets), 1; got != want {
		t.Fatalf("packets = %d, want %d: %#v", got, want, packets.Packets)
	}
	if packets.Packets[0].At != base+1_000 || packets.Packets[0].IATA != "YYZ" || packets.Packets[0].HopCount != 1 || packets.Packets[0].SegmentCount != 1 {
		t.Fatalf("fallback packet summary = %#v, want raw path fallback packet", packets.Packets[0])
	}
	if packets.Scan.EventsScanned == 0 {
		t.Fatalf("scan metadata = %#v, want raw scan path", packets.Scan)
	}
}

func TestPublicPacketsEndpointReturnsNewestFirstWithStableCursorPagination(t *testing.T) {
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
	firstID := insertHistoryObservation(t, ctx, st, "hash-route-one-private", "YYZ", observerKey, base+1_000, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, firstID, "hash-route-one-private", base+1_000)
	secondID := insertHistoryObservation(t, ctx, st, "hash-route-two-private", "YYZ", observerKey, base+2_000, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, secondID, "hash-route-two-private", base+2_000)

	server := publicHistoryTestServer(st, func(string) bool { return true })
	firstPage := httptest.NewRecorder()
	firstRequest := httptest.NewRequest(http.MethodGet, "/api/v1/public/packets?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=1", nil)
	server.Routes().ServeHTTP(firstPage, firstRequest)
	if firstPage.Code != http.StatusOK {
		t.Fatalf("first cursor page status = %d body=%s", firstPage.Code, firstPage.Body.String())
	}
	var page1 live.PublicPacketsResponse
	if err := json.Unmarshal(firstPage.Body.Bytes(), &page1); err != nil {
		t.Fatal(err)
	}
	if len(page1.Packets) != 1 || page1.Packets[0].At != base+2_000 || page1.NextCursor == "" {
		t.Fatalf("first page = %#v, want newest packet plus cursor", page1)
	}

	secondPage := httptest.NewRecorder()
	secondRequest := httptest.NewRequest(http.MethodGet, "/api/v1/public/packets?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=1&cursor="+page1.NextCursor, nil)
	server.Routes().ServeHTTP(secondPage, secondRequest)
	if secondPage.Code != http.StatusOK {
		t.Fatalf("second cursor page status = %d body=%s", secondPage.Code, secondPage.Body.String())
	}
	var page2 live.PublicPacketsResponse
	if err := json.Unmarshal(secondPage.Body.Bytes(), &page2); err != nil {
		t.Fatal(err)
	}
	if len(page2.Packets) != 1 || page2.Packets[0].At != base+1_000 {
		t.Fatalf("second page = %#v, want next older packet", page2)
	}
}

func TestPublicPacketsEndpointFiltersAcrossSanitizedPacketFields(t *testing.T) {
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
	txtID := insertHistoryObservation(t, ctx, st, "hash-filter-text-private", "YKF", observerKey, base+1_000, resolve.StatusHigh)
	insertHistoryEdgeWithOptions(t, ctx, st, txtID, "hash-filter-text-private", base+1_000, historyEdgeOptions{
		PayloadTypeName: "PLAIN_TEXT",
		MessageSender:   "Corebot",
		MessageText:     "hello from YKF",
		Labels:          []string{"YKF Corebot", "Krabs Repeater", "Room Observer"},
	})
	advID := insertHistoryObservation(t, ctx, st, "hash-filter-adv-private", "YTR", observerKey, base+2_000, resolve.StatusHigh)
	insertHistoryEdgeWithOptions(t, ctx, st, advID, "hash-filter-adv-private", base+2_000, historyEdgeOptions{
		PayloadTypeName: "ADVERT",
		Labels:          []string{"YTR Sender", "YTR Repeater"},
	})

	server := publicHistoryTestServer(st, func(string) bool { return true })
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"iata", "/api/v1/public/packets?from=" + ms(base) + "&to=" + ms(base+3_000) + "&iata=ykf&limit=10", "YKF"},
		{"payload", "/api/v1/public/packets?from=" + ms(base) + "&to=" + ms(base+3_000) + "&payload=advert&limit=10", "YTR"},
		{"minimum hops", "/api/v1/public/packets?from=" + ms(base) + "&to=" + ms(base+3_000) + "&minHops=2&limit=10", "YKF"},
		{"message only", "/api/v1/public/packets?from=" + ms(base) + "&to=" + ms(base+3_000) + "&messageOnly=true&limit=10", "YKF"},
		{"public query", "/api/v1/public/packets?from=" + ms(base) + "&to=" + ms(base+3_000) + "&q=krabs&limit=10", "YKF"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, tt.url, nil)
			server.Routes().ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("packets status = %d body=%s", response.Code, response.Body.String())
			}
			var packets live.PublicPacketsResponse
			if err := json.Unmarshal(response.Body.Bytes(), &packets); err != nil {
				t.Fatal(err)
			}
			if len(packets.Packets) != 1 || packets.Packets[0].IATA != tt.want {
				t.Fatalf("packets = %#v, want single %s match", packets.Packets, tt.want)
			}
			if !packets.Scan.Filtered || packets.Scan.EventsScanned == 0 {
				t.Fatalf("scan summary = %#v, want filtered scan metadata", packets.Scan)
			}
			raw := response.Body.String()
			if strings.Contains(raw, "hash-filter") || strings.Contains(raw, "private resolver reason") {
				t.Fatalf("filtered response leaked private data: %s", raw)
			}
		})
	}
}

func TestPublicPacketPathProjectionIsSanitizedAndFilterable(t *testing.T) {
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
	validID := insertHistoryObservation(t, ctx, st, "hash-projection-private", "YKF", observerKey, base+1_000, resolve.StatusHigh)
	insertHistoryEdgeWithOptions(t, ctx, st, validID, "hash-projection-private", base+1_000, historyEdgeOptions{
		PayloadTypeName: "GROUP_TEXT",
		MessageSender:   "Corebot",
		MessageText:     "hello projection",
		Labels:          []string{"YKF Corebot", "Krabs Repeater", "Room Observer"},
	})
	invalidID := insertHistoryObservation(t, ctx, st, "hash-projection-invalid-private", "YKF", observerKey, base+2_000, resolve.StatusHigh)
	insertInvalidHistoryEdge(t, ctx, st, invalidID, "hash-projection-invalid-private", base+2_000)

	complete, err := st.PublicPacketPathProjectionComplete(ctx, base, base+3_000)
	if err != nil {
		t.Fatal(err)
	}
	if !complete {
		t.Fatalf("projection should cover both valid and non-mappable edge rows")
	}
	packets, next, searchMode, err := st.PublicPacketPaths(ctx, store.PublicPacketPathQuery{
		From:            base,
		To:              base + 3_000,
		Limit:           10,
		IATA:            "ykf",
		PayloadTypeName: "group_text",
		MinHops:         2,
		MessageOnly:     true,
		Search:          "krabs",
	})
	if err != nil {
		t.Fatal(err)
	}
	if searchMode != store.PublicPacketPathSearchFTS {
		t.Fatalf("projection search mode = %q, want %q", searchMode, store.PublicPacketPathSearchFTS)
	}
	if next != nil {
		t.Fatalf("projection cursor = %#v, want exhausted single page", next)
	}
	if len(packets) != 1 {
		t.Fatalf("projection packets = %#v, want one valid mappable packet", packets)
	}
	packet := packets[0]
	if packet.IATA != "YKF" || packet.Region != "YKF" || packet.HopCount != 2 || packet.SegmentCount != 2 || packet.MessageText != "hello projection" {
		t.Fatalf("projected packet = %#v", packet)
	}
	raw, err := json.Marshal(packet)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"hash-projection", "packetHash", "pathHex", "observerPublicKey", "private resolver reason", "secret summary"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("projected packet leaked forbidden value %q: %s", forbidden, raw)
		}
	}
}

func TestPublicPacketsEndpointUsesProjectionWithoutLeakingDisallowedRegions(t *testing.T) {
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
	allowedID := insertHistoryObservation(t, ctx, st, "hash-projection-allowed-private", "YYZ", observerKey, base+1_000, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, allowedID, "hash-projection-allowed-private", base+1_000)
	disallowedID := insertHistoryObservation(t, ctx, st, "hash-projection-disallowed-private", "PRG", observerKey, base+2_000, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, disallowedID, "hash-projection-disallowed-private", base+2_000)

	server := publicHistoryTestServer(st, func(iata string) bool { return strings.ToUpper(iata) == "YYZ" })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/packets?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("packets status = %d body=%s", response.Code, response.Body.String())
	}
	var packets live.PublicPacketsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &packets); err != nil {
		t.Fatal(err)
	}
	if len(packets.Packets) != 1 || packets.Packets[0].IATA != "YYZ" {
		t.Fatalf("packets = %#v, want only allowed projected packet", packets.Packets)
	}
	if packets.Scan.EventsScanned != 2 || packets.Scan.Partial {
		t.Fatalf("projection scan summary = %#v, want scanned projected rows with complete page", packets.Scan)
	}
	if raw := response.Body.String(); strings.Contains(raw, "PRG") || strings.Contains(raw, "hash-projection") {
		t.Fatalf("projected response leaked disallowed/private data: %s", raw)
	}
}

func TestPublicPacketsEndpointRecordsProjectedSearchModes(t *testing.T) {
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
	validID := insertHistoryObservation(t, ctx, st, "hash-search-mode-private", "YKF", observerKey, base+1_000, resolve.StatusHigh)
	insertHistoryEdgeWithOptions(t, ctx, st, validID, "hash-search-mode-private", base+1_000, historyEdgeOptions{
		PayloadTypeName: "GROUP_TEXT",
		MessageSender:   "Corebot",
		MessageText:     "hello search mode",
		Labels:          []string{"YKF Corebot", "Krabs Repeater"},
	})

	server := publicHistoryTestServer(st, func(string) bool { return true })
	server.Runtime = live.NewRuntimeStats()
	for _, url := range []string{
		"/api/v1/public/packets?from=" + ms(base) + "&to=" + ms(base+2_000) + "&limit=10&q=krabs",
		"/api/v1/public/packets?from=" + ms(base) + "&to=" + ms(base+2_000) + "&limit=10&q=!!!",
		"/api/v1/public/packets?from=" + ms(base) + "&to=" + ms(base+2_000) + "&limit=10",
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, url, nil)
		server.Routes().ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("packets status = %d url=%s body=%s", response.Code, url, response.Body.String())
		}
		if strings.Contains(response.Body.String(), "hash-search-mode-private") {
			t.Fatalf("projected response leaked private hash: %s", response.Body.String())
		}
	}
	snapshot := server.Runtime.Snapshot()
	if snapshot.PublicPacketsSearchFTS != 1 || snapshot.PublicPacketsSearchSubstring != 1 || snapshot.PublicPacketsSearchNoQuery != 1 {
		t.Fatalf("projected search counters = %#v, want one FTS, substring, and no-query request", snapshot)
	}
}

type historyEdgeOptions struct {
	PayloadTypeName string
	MessageSender   string
	MessageText     string
	Labels          []string
}

func insertHistoryEdgeWithOptions(t *testing.T, ctx context.Context, st *store.Store, observationID int64, hash string, heardAt int64, options historyEdgeOptions) {
	t.Helper()
	payload := options.PayloadTypeName
	if payload == "" {
		payload = "PLAIN_TEXT"
	}
	labels := options.Labels
	if len(labels) < 2 {
		labels = []string{"Sender", "Repeater"}
	}
	segments := make([]live.EdgeSegment, 0, len(labels)-1)
	for index := 0; index < len(labels)-1; index++ {
		segments = append(segments, live.EdgeSegment{
			From:       live.EdgeEndpoint{NodeID: "node-" + ms(int64(index)), Name: labels[index], Lat: 43.65 + float64(index)*0.15, Lng: -79.38 - float64(index)*0.12},
			To:         live.EdgeEndpoint{NodeID: "node-" + ms(int64(index+1)), Name: labels[index+1], Lat: 43.65 + float64(index+1)*0.15, Lng: -79.38 - float64(index+1)*0.12},
			DistanceKM: 18 + float64(index)*6,
		})
	}
	if _, err := st.InsertEdgeEvent(ctx, live.EdgeEvent{
		PacketHash:      hash,
		ObservationID:   observationID,
		PayloadType:     2,
		PayloadTypeName: payload,
		MessageSender:   options.MessageSender,
		MessageText:     options.MessageText,
		HeardAt:         heardAt,
		Segments:        segments,
		RenderReason:    "resolved_path_high_confidence",
	}, "high", "test"); err != nil {
		t.Fatal(err)
	}
}

func insertInvalidHistoryEdge(t *testing.T, ctx context.Context, st *store.Store, observationID int64, hash string, heardAt int64) {
	t.Helper()
	if _, err := st.InsertEdgeEvent(ctx, live.EdgeEvent{
		PacketHash:      hash,
		ObservationID:   observationID,
		PayloadType:     2,
		PayloadTypeName: "PLAIN_TEXT",
		HeardAt:         heardAt,
		Segments: []live.EdgeSegment{
			{
				From:       live.EdgeEndpoint{NodeID: "node-a", Name: "Sender", Lat: 0, Lng: 0},
				To:         live.EdgeEndpoint{NodeID: "node-b", Name: "Repeater", Lat: 45.42, Lng: -75.69},
				DistanceKM: 360,
			},
		},
		RenderReason: "resolved_path_high_confidence",
	}, "high", "test"); err != nil {
		t.Fatal(err)
	}
}
