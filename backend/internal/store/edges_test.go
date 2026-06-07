package store

import (
	"context"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

func TestRecentEdgeEventsSkipsFarFutureRows(t *testing.T) {
	ctx := context.Background()
	s, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	if _, err := s.db.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UnixMilli()
	current, err := s.InsertEdgeEvent(ctx, edgeEventForTest("current", now), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.InsertEdgeEvent(ctx, edgeEventForTest("future", time.Now().Add(24*time.Hour).UnixMilli()), "", ""); err != nil {
		t.Fatal(err)
	}

	events, err := s.RecentEdgeEvents(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].ID != current.ID {
		t.Fatalf("event ID = %d, want current ID %d", events[0].ID, current.ID)
	}
}

func edgeEventForTest(packetHash string, heardAt int64) live.EdgeEvent {
	return live.EdgeEvent{
		PacketHash:      packetHash,
		ObservationID:   1,
		PayloadType:     2,
		PayloadTypeName: "ADVERT",
		HeardAt:         heardAt,
		Segments: []live.EdgeSegment{
			{
				From:       live.EdgeEndpoint{NodeID: "a", Name: "A", Lat: 43, Lng: -79},
				To:         live.EdgeEndpoint{NodeID: "b", Name: "B", Lat: 44, Lng: -80},
				DistanceKM: 10,
			},
		},
		RenderReason: "test",
	}
}
