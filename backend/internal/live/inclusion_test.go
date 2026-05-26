package live

import (
	"math"
	"testing"
)

func TestPublicMapInclusionReasons(t *testing.T) {
	lat := 43.65
	lng := -79.38
	zero := 0.0
	outside := 89.0
	nan := math.NaN()
	filter := NewPublicIATAFilter([]string{"YYZ"})

	tests := []struct {
		name string
		node Node
		want PublicMapInclusion
	}{
		{
			name: "mappable node",
			node: Node{Latitude: &lat, Longitude: &lng, IATAsHeardIn: []string{"YYZ"}},
			want: PublicMapInclusion{Mappable: true, Reason: MapIncludeMappable, PositionSource: MapIncludeNodePositionUsed},
		},
		{
			name: "missing coords",
			node: Node{IATAsHeardIn: []string{"YYZ"}},
			want: PublicMapInclusion{Reason: MapIncludeMissingCoords},
		},
		{
			name: "zero coords",
			node: Node{Latitude: &zero, Longitude: &lng, IATAsHeardIn: []string{"YYZ"}},
			want: PublicMapInclusion{Reason: MapIncludeZeroCoords},
		},
		{
			name: "outside bounds",
			node: Node{Latitude: &outside, Longitude: &lng, IATAsHeardIn: []string{"YYZ"}},
			want: PublicMapInclusion{Reason: MapIncludeOutsideBounds},
		},
		{
			name: "nan coords",
			node: Node{Latitude: &nan, Longitude: &lng, IATAsHeardIn: []string{"YYZ"}},
			want: PublicMapInclusion{Reason: MapIncludeOutsideBounds},
		},
		{
			name: "iata filtered",
			node: Node{Latitude: &lat, Longitude: &lng, IATAsHeardIn: []string{"PRG"}},
			want: PublicMapInclusion{Reason: MapIncludeIATAFiltered},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := PublicNodeMapInclusion(tt.node, filter)
			if got != tt.want {
				t.Fatalf("PublicNodeMapInclusion() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestCoordinatePolicyPresets(t *testing.T) {
	australiaLat := -33.86
	australiaLng := 151.21
	world := NewCoordinatePolicy(WorldCoordinateBounds())
	if !world.Valid(australiaLat, australiaLng) {
		t.Fatalf("world coordinate policy rejected Sydney coordinates")
	}
	canada := NewCoordinatePolicy(CanadaCoordinateBounds())
	if canada.Valid(australiaLat, australiaLng) {
		t.Fatalf("Canada coordinate policy accepted Sydney coordinates")
	}
}

func TestPublicObserverFallbackInclusion(t *testing.T) {
	lat := 45.42
	lng := -75.69
	filter := NewPublicIATAFilter([]string{"YOW"})
	got := PublicObserverFallbackInclusion(Observer{IATA: "YOW", Latitude: &lat, Longitude: &lng}, filter)
	want := PublicMapInclusion{Mappable: true, Reason: MapIncludeMappable, PositionSource: MapIncludeObserverPositionUsed}
	if got != want {
		t.Fatalf("PublicObserverFallbackInclusion() = %#v, want %#v", got, want)
	}

	filtered := PublicObserverMapInclusion(Observer{IATA: "PRG", Latitude: &lat, Longitude: &lng}, filter)
	if filtered.Reason != MapIncludeIATAFiltered || filtered.Mappable {
		t.Fatalf("filtered observer inclusion = %#v, want iata filtered", filtered)
	}
}
