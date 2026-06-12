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
	"meshcore-canada-live-map/backend/internal/propagation"
	"meshcore-canada-live-map/backend/internal/resolve"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestPublicPropagationEndpointReturnsSanitizedEvents(t *testing.T) {
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
	observationID := insertHistoryObservation(t, ctx, st, "hash-propagation-private", "YYZ", observerKey, base+1_000, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, observationID, "hash-propagation-private", base+1_000)

	packets, _, _, err := st.PublicPacketPaths(ctx, store.PublicPacketPathQuery{From: base, To: base + 2_000, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(packets) != 1 {
		t.Fatalf("packets = %#v, want one projected path", packets)
	}
	now := time.Now()
	weather := &propagation.WeatherSample{
		Summary: live.PublicPropagationWeatherSummary{
			Source:              "open-meteo-gfs-hrrr",
			Model:               "best_match",
			SampleTime:          now.UnixMilli(),
			FetchedAt:           now.UnixMilli(),
			TemperatureC:        20,
			DewPointC:           18,
			RelativeHumidityPct: 90,
			PressureHPa:         1024,
			CloudCoverPct:       20,
			VisibilityM:         9000,
			WindSpeedKmh:        8,
			InversionProxy:      "stable_layer",
		},
	}
	event, ok := propagation.Classifier{MinDistanceKM: 75}.Classify(packets[0], weather, nil, 4, now)
	if !ok {
		t.Fatal("classifier did not produce propagation event")
	}
	if err := st.UpsertPropagationEvent(ctx, event); err != nil {
		t.Fatal(err)
	}

	server := publicHistoryTestServer(st, func(iata string) bool { return strings.ToUpper(iata) == "YYZ" })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/propagation?from="+ms(base)+"&to="+ms(base+2_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("propagation status = %d body=%s", response.Code, response.Body.String())
	}
	var propagationResponse live.PublicPropagationResponse
	if err := json.Unmarshal(response.Body.Bytes(), &propagationResponse); err != nil {
		t.Fatal(err)
	}
	if len(propagationResponse.Events) != 1 {
		t.Fatalf("events = %#v, want one propagation event", propagationResponse.Events)
	}
	got := propagationResponse.Events[0]
	if got.Region != "YYZ" || got.DistanceKM <= 75 || got.Classification == "" || got.ReplayWindow.From <= 0 {
		t.Fatalf("event = %#v, want public route annotation", got)
	}
	if propagationResponse.Conditions.LatestEvent == nil || propagationResponse.Conditions.SourceStatus != "ready" {
		t.Fatalf("conditions = %#v, want ready latest event", propagationResponse.Conditions)
	}
	raw := response.Body.String()
	for _, forbidden := range []string{
		"hash-propagation-private",
		"packetHash",
		"observerPublicKey",
		"pathHex",
		"rawHex",
		"private resolver reason",
		"secret summary",
	} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("propagation response leaked forbidden value %q: %s", forbidden, raw)
		}
	}
}

func TestPublicPropagationEndpointFiltersDisallowedRegions(t *testing.T) {
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
	observationID := insertHistoryObservation(t, ctx, st, "hash-prg-propagation-private", "PRG", observerKey, base+1_000, resolve.StatusHigh)
	insertHistoryEdge(t, ctx, st, observationID, "hash-prg-propagation-private", base+1_000)
	packets, _, _, err := st.PublicPacketPaths(ctx, store.PublicPacketPathQuery{From: base, To: base + 2_000, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	event, ok := propagation.Classifier{MinDistanceKM: 75}.Classify(packets[0], nil, nil, 1, time.Now())
	if !ok {
		t.Fatal("classifier did not produce propagation event")
	}
	if err := st.UpsertPropagationEvent(ctx, event); err != nil {
		t.Fatal(err)
	}

	server := publicHistoryTestServer(st, func(iata string) bool { return strings.ToUpper(iata) == "YYZ" })
	server.Config.PublicRegionRestricted = true
	server.Config.PublicIATARestricted = true
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/propagation?from="+ms(base)+"&to="+ms(base+2_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("propagation status = %d body=%s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "PRG") || strings.Contains(response.Body.String(), "hash-prg") {
		t.Fatalf("restricted propagation response leaked disallowed data: %s", response.Body.String())
	}
	var propagationResponse live.PublicPropagationResponse
	if err := json.Unmarshal(response.Body.Bytes(), &propagationResponse); err != nil {
		t.Fatal(err)
	}
	if len(propagationResponse.Events) != 0 || propagationResponse.Conditions.EventCount != 0 {
		t.Fatalf("restricted response = %#v, want no visible events", propagationResponse)
	}
}
