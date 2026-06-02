package app

import (
	"testing"

	"meshcore-canada-live-map/backend/internal/live"
)

func TestObserverRecordEndpointAcceptsPositionedObserver(t *testing.T) {
	lat := 43.6532
	lng := -79.3832

	endpoint, ok := observerRecordEndpoint(live.Observer{
		PublicKey: "ABCDEF0123456789",
		Name:      "Toronto observer",
		Latitude:  &lat,
		Longitude: &lng,
	})
	if !ok {
		t.Fatal("observerRecordEndpoint rejected positioned observer")
	}
	if endpoint.NodeID != "ABCDEF0123456789" || endpoint.Name != "Toronto observer" || endpoint.Lat != lat || endpoint.Lng != lng {
		t.Fatalf("endpoint = %#v, want observer identity and coordinates", endpoint)
	}
	if endpoint.PathHash3 == "" {
		t.Fatal("endpoint PathHash3 is empty")
	}
}

func TestObserverRecordEndpointRejectsUnmappableObservers(t *testing.T) {
	lat := 43.6532
	lng := -79.3832
	zero := 0.0
	outOfBounds := 181.0

	tests := []struct {
		name     string
		observer live.Observer
	}{
		{name: "missing latitude", observer: live.Observer{PublicKey: "a", Longitude: &lng}},
		{name: "missing longitude", observer: live.Observer{PublicKey: "a", Latitude: &lat}},
		{name: "zero coordinate", observer: live.Observer{PublicKey: "a", Latitude: &zero, Longitude: &zero}},
		{name: "out of bounds", observer: live.Observer{PublicKey: "a", Latitude: &lat, Longitude: &outOfBounds}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if endpoint, ok := observerRecordEndpoint(tt.observer); ok {
				t.Fatalf("observerRecordEndpoint accepted unmappable observer as %#v", endpoint)
			}
		})
	}
}
