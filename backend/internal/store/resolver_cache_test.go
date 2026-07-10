package store

import (
	"context"
	"testing"

	"meshcore-canada-live-map/backend/internal/meshcore"
	mq "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/resolve"
)

func TestResolverCandidateGenerationTracksNodeMutationsAndCollision(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	lat1, lng1 := 43.4, -80.4
	key1 := "AA00000000000000000000000000000000000000000000000000000000000000"
	before := st.CandidateGeneration()
	if _, err := st.UpsertAdvertNode(ctx, "YKF", meshcore.Advert{
		PublicKey: key1, Name: "R1", Role: "repeater", NodeType: 2,
		Latitude: &lat1, Longitude: &lng1, LocationSource: "advert",
	}, 1); err != nil {
		t.Fatal(err)
	}
	afterFirstAdvert := st.CandidateGeneration()
	if afterFirstAdvert <= before {
		t.Fatalf("candidate generation did not advance after advert: before=%d after=%d", before, afterFirstAdvert)
	}

	resolver := resolve.New(st, []string{"repeater", "room_server"})
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x01, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	result, err := resolver.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != resolve.StatusHigh {
		t.Fatalf("initial status = %s, want %s", result.Status, resolve.StatusHigh)
	}

	lat2, lng2 := 44.0, -79.0
	key2 := "AA10000000000000000000000000000000000000000000000000000000000000"
	if _, err := st.UpsertAdvertNode(ctx, "YKF", meshcore.Advert{
		PublicKey: key2, Name: "R2", Role: "repeater", NodeType: 2,
		Latitude: &lat2, Longitude: &lng2, LocationSource: "advert",
	}, 2); err != nil {
		t.Fatal(err)
	}
	if st.CandidateGeneration() <= afterFirstAdvert {
		t.Fatal("candidate generation did not advance after collision advert")
	}
	// No explicit resolver invalidation here: the Store generation is the
	// fail-closed safety net for any missed Application call site.
	result, err = resolver.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != resolve.StatusAmbiguous {
		t.Fatalf("post-collision status = %s, want %s", result.Status, resolve.StatusAmbiguous)
	}

	beforeManual := st.CandidateGeneration()
	if err := st.ApplyManualNode(ctx, key1, "Manual R1", 43.5, -80.5, "test"); err != nil {
		t.Fatal(err)
	}
	if st.CandidateGeneration() <= beforeManual {
		t.Fatal("candidate generation did not advance after manual-node mutation")
	}

	beforeStatus := st.CandidateGeneration()
	statusKey := "BB00000000000000000000000000000000000000000000000000000000000000"
	if err := st.UpsertObserver(ctx, mq.NormalizedMessage{
		TopicInfo:    mq.TopicInfo{IATA: "YKF", Region: "YKF", PublisherPK: statusKey, Subtopic: "status"},
		ObserverName: "YKF repeater",
		Payload:      map[string]any{"lat": 43.6, "lon": -80.6, "role": "repeater"},
		RawJSON:      `{"lat":43.6,"lon":-80.6,"role":"repeater"}`,
		HeardAtMs:    3,
	}); err != nil {
		t.Fatal(err)
	}
	if st.CandidateGeneration() <= beforeStatus {
		t.Fatal("candidate generation did not advance after status-node mutation")
	}
}
