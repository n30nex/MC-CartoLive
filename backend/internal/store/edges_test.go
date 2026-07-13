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

func TestCommitLiveEdgeAtomicallyOrdersPublicEventsAndDedupes(t *testing.T) {
	ctx := context.Background()
	s, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.db.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}
	edge := edgeEventForTest("live-core", time.Now().UnixMilli())
	edge.IngestID = "live-core:edge"
	request := LiveEdgeCommitRequest{
		Edge: edge, ResolutionStatus: "high", ResolutionReason: "test",
		PublishPublicEvents: true, ActivityDedupeKey: "live-core:activity",
		RoutePulseDedupeKey: "live-core:pulse", ReceivedAtMs: time.Now().UnixMilli(),
	}
	first, err := s.CommitLiveEdge(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if !first.EdgeInserted || len(first.PublicEvents) != 2 || !first.EventInserted[0] || !first.EventInserted[1] {
		t.Fatalf("first=%#v", first)
	}
	if first.PublicEvents[0].Type != "activity" || first.PublicEvents[1].Type != "routePulse" || first.PublicEvents[1].Seq != first.PublicEvents[0].Seq+1 {
		t.Fatalf("public events=%#v", first.PublicEvents)
	}
	second, err := s.CommitLiveEdge(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if second.EdgeInserted || second.EventInserted[0] || second.EventInserted[1] || second.Edge.ID != first.Edge.ID {
		t.Fatalf("retry=%#v", second)
	}
}

func TestCommitLiveEdgeRollsBackEdgeWhenPublicEventInsertFails(t *testing.T) {
	ctx := context.Background()
	s, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.db.ExecContext(ctx, `
PRAGMA foreign_keys=OFF;
CREATE TRIGGER fail_live_core_public_event BEFORE INSERT ON public_events
BEGIN SELECT RAISE(ABORT, 'forced public event failure'); END;`); err != nil {
		t.Fatal(err)
	}
	edge := edgeEventForTest("rollback", time.Now().UnixMilli())
	edge.IngestID = "rollback:edge"
	_, err = s.CommitLiveEdge(ctx, LiveEdgeCommitRequest{
		Edge: edge, ResolutionStatus: "high", PublishPublicEvents: true,
		ActivityDedupeKey: "rollback:activity", RoutePulseDedupeKey: "rollback:pulse",
	})
	if err == nil {
		t.Fatal("expected forced public event failure")
	}
	var edgeCount, eventCount int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM live_edge_events WHERE ingest_id='rollback:edge'`).Scan(&edgeCount); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM public_events`).Scan(&eventCount); err != nil {
		t.Fatal(err)
	}
	if edgeCount != 0 || eventCount != 0 {
		t.Fatalf("rollback left edge/events=%d/%d", edgeCount, eventCount)
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
