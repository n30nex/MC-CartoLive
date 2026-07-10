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

func TestPublicRouteSummariesTrackLatestRouteAndBackfillIdempotently(t *testing.T) {
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
	first, err := s.InsertEdgeEvent(ctx, edgeEventForTest("first", now), "", "")
	if err != nil {
		t.Fatal(err)
	}
	secondEvent := edgeEventForTest("second", now+1000)
	secondEvent.PayloadTypeName = "TEXT"
	second, err := s.InsertEdgeEvent(ctx, secondEvent, "", "")
	if err != nil {
		t.Fatal(err)
	}

	routes, err := s.PublicRouteSummaries(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) != 1 {
		t.Fatalf("route summaries = %d, want 1", len(routes))
	}
	route := routes[0]
	if route.PacketCount != 2 {
		t.Fatalf("packet count = %d, want 2", route.PacketCount)
	}
	if route.LastHeard != second.HeardAt {
		t.Fatalf("last heard = %d, want %d", route.LastHeard, second.HeardAt)
	}
	if len(route.PayloadTypeNames) != 2 || route.PayloadTypeNames[0] != "ADVERT" || route.PayloadTypeNames[1] != "TEXT" {
		t.Fatalf("payload types = %#v, want ADVERT,TEXT", route.PayloadTypeNames)
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM public_route_summaries; DELETE FROM public_route_summary_edges`); err != nil {
		t.Fatal(err)
	}
	result, err := s.BackfillPublicRouteSummaries(ctx, now-1000, now+2000, 10)
	if err != nil {
		t.Fatal(err)
	}
	if result.Scanned != 2 || result.Counted != 2 || result.Remaining {
		t.Fatalf("backfill result = %#v, want two counted and complete", result)
	}
	result, err = s.BackfillPublicRouteSummaries(ctx, now-1000, now+2000, 10)
	if err != nil {
		t.Fatal(err)
	}
	if result.Scanned != 0 || result.Counted != 0 {
		t.Fatalf("second backfill result = %#v, want no duplicate work", result)
	}

	routes, err = s.PublicRouteSummaries(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) != 1 || routes[0].PacketCount != 2 || routes[0].LastHeard != second.HeardAt {
		t.Fatalf("routes after backfill = %#v, want one count=2 latest second", routes)
	}
	if first.ID <= 0 {
		t.Fatalf("first edge ID was not assigned")
	}
}

func TestInsertEdgeEventSuppressesAmbiguousRetryByIngestID(t *testing.T) {
	ctx := context.Background()
	s, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.db.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}
	event := edgeEventForTest("dedupe", time.Now().UnixMilli())
	event.IngestID = "ingest-edge-dedupe"
	first, err := s.InsertEdgeEvent(ctx, event, "", "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.InsertEdgeEvent(ctx, event, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("edge IDs differ: %d != %d", first.ID, second.ID)
	}
	var count int
	if err := s.reader().QueryRowContext(ctx, `SELECT COUNT(*) FROM live_edge_events WHERE ingest_id=?`, event.IngestID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("deduped edge count=%d want 1", count)
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
