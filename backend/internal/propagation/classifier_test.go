package propagation

import (
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/solar"
)

func TestClassifierIgnoresShortPublicPaths(t *testing.T) {
	event, ok := Classifier{MinDistanceKM: 75}.Classify(packetPath(42, 70), nil, nil, 1, time.UnixMilli(42))
	if ok {
		t.Fatalf("short path classified as %#v", event)
	}
}

func TestClassifierMarksWeatherSupportedTropoPossible(t *testing.T) {
	now := time.Date(2026, 6, 11, 10, 0, 0, 0, time.UTC)
	weather := &WeatherSample{
		Summary: live.PublicPropagationWeatherSummary{
			Source:              "open-meteo-gfs-hrrr",
			Model:               "best_match",
			SampleTime:          now.Add(-30 * time.Minute).UnixMilli(),
			FetchedAt:           now.UnixMilli(),
			TemperatureC:        18.2,
			DewPointC:           16.9,
			RelativeHumidityPct: 91,
			PressureHPa:         1025,
			CloudCoverPct:       18,
			VisibilityM:         7000,
			WindSpeedKmh:        7,
			InversionProxy:      "inversion",
		},
	}
	solarConditions := &solar.Conditions{
		KpIndex:        2,
		KpLabel:        "quiet",
		SolarFluxSFU:   120,
		SolarFluxLabel: "moderate",
		GeomagActivity: "quiet",
		FetchedAt:      now.UnixMilli(),
	}
	event, ok := Classifier{MinDistanceKM: 75}.Classify(packetPath(now.UnixMilli(), 118), weather, solarConditions, 5, now)
	if !ok {
		t.Fatal("expected event")
	}
	if event.Classification != ClassificationTropoPossible || event.Confidence != "medium" {
		t.Fatalf("classification = %s/%s, want tropo_possible/medium: %#v", event.Classification, event.Confidence, event.Reasons)
	}
	if event.Score < 0.62 {
		t.Fatalf("score = %.2f, want weather-supported score", event.Score)
	}
	if !containsReason(event.Reasons, "temperature inversion proxy present") || !containsReason(event.Reasons, "humid air with low temperature-dewpoint spread") {
		t.Fatalf("reasons = %#v, want weather evidence", event.Reasons)
	}
	if event.Solar == nil || event.Weather == nil {
		t.Fatalf("event missing public weather/solar summaries: %#v", event)
	}
}

func TestClassifierFallsBackToLongDistanceWhenWeatherMissing(t *testing.T) {
	now := time.Date(2026, 6, 11, 14, 0, 0, 0, time.UTC)
	event, ok := Classifier{MinDistanceKM: 75}.Classify(packetPath(now.UnixMilli(), 92), nil, nil, 1, now)
	if !ok {
		t.Fatal("expected fallback event")
	}
	if event.Classification != ClassificationLongDistance || event.Confidence != "low" {
		t.Fatalf("classification = %s/%s, want long distance low", event.Classification, event.Confidence)
	}
	if !containsReason(event.Reasons, "weather model unavailable") {
		t.Fatalf("reasons = %#v, want weather fallback reason", event.Reasons)
	}
}

func packetPath(at int64, distance float64) live.PublicPacketPath {
	return live.PublicPacketPath{
		ID:              "pulse-123",
		At:              at,
		IATA:            "YYZ",
		Region:          "YYZ",
		PayloadTypeName: "PLAIN_TEXT",
		HopCount:        1,
		SegmentCount:    1,
		DistanceKM:      distance,
		RouteIDs:        []string{"r-12345678"},
		EndpointLabels:  []string{"Toronto", "Cambridge"},
		Segments: []live.PublicRouteSegment{{
			RouteID:    "r-12345678",
			DistanceKM: distance,
			From:       live.PublicRouteEndpoint{NodeID: "n-toronto", Label: "Toronto", Lat: 43.65, Lng: -79.38, PathHash3: "ABC123"},
			To:         live.PublicRouteEndpoint{NodeID: "n-cambridge", Label: "Cambridge", Lat: 43.36, Lng: -80.31, PathHash3: "DEF456"},
		}},
	}
}

func containsReason(reasons []string, want string) bool {
	for _, reason := range reasons {
		if reason == want {
			return true
		}
	}
	return false
}
