package store

import (
	"context"
	"testing"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
)

func TestStoreCoordinatePolicyControlsPositionedNodes(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	lat := -33.86
	lng := 151.21
	advert := meshcore.Advert{
		PublicKey:      "ABCDEF0123456789",
		Name:           "Sydney repeater",
		Role:           "repeater",
		NodeType:       2,
		Latitude:       &lat,
		Longitude:      &lng,
		LocationSource: "advert",
	}

	st.SetCoordinatePolicy(live.NewCoordinatePolicy(live.CanadaCoordinateBounds()))
	if _, err := st.UpsertAdvertNode(ctx, "r1", advert, 1); err != nil {
		t.Fatal(err)
	}
	nodes, err := st.Nodes(ctx, true, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 0 {
		t.Fatalf("Canada bounds returned positioned Australia node: %#v", nodes)
	}

	st.SetCoordinatePolicy(live.NewCoordinatePolicy(live.WorldCoordinateBounds()))
	if _, err := st.UpsertAdvertNode(ctx, "r1", advert, 2); err != nil {
		t.Fatal(err)
	}
	nodes, err = st.Nodes(ctx, true, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].Latitude == nil || nodes[0].Longitude == nil {
		t.Fatalf("world bounds did not return positioned Australia node: %#v", nodes)
	}
}
