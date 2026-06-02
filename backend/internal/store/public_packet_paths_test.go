package store

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

func TestBackfillPublicPacketPathsProjectsMissingLegacyEdges(t *testing.T) {
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

	now := time.Now().UnixMilli()
	validObservation := insertPacketPathBackfillObservation(t, ctx, s, "hash-backfill-valid-private", "YKF", now-2_000)
	insertPacketPathBackfillEdge(t, ctx, s, validObservation, "hash-backfill-valid-private", "GROUP_TEXT", "Corebot", "hello from backfill", now-2_000, []live.EdgeSegment{
		{
			From:       live.EdgeEndpoint{NodeID: "node-a", Name: "Sender", Lat: 43.65, Lng: -79.38, PathHash3: "AAAAAA"},
			To:         live.EdgeEndpoint{NodeID: "node-b", Name: "Repeater", Lat: 43.75, Lng: -79.48, PathHash3: "BBBBBB"},
			DistanceKM: 14,
		},
	})
	invalidObservation := insertPacketPathBackfillObservation(t, ctx, s, "hash-backfill-invalid-private", "YKF", now-1_000)
	insertPacketPathBackfillEdge(t, ctx, s, invalidObservation, "hash-backfill-invalid-private", "GROUP_TEXT", "Corebot", "invalid coords", now-1_000, []live.EdgeSegment{
		{
			From:       live.EdgeEndpoint{NodeID: "node-c", Name: "Invalid", Lat: 0, Lng: 0, PathHash3: "CCCCCC"},
			To:         live.EdgeEndpoint{NodeID: "node-d", Name: "Repeater", Lat: 43.85, Lng: -79.58, PathHash3: "DDDDDD"},
			DistanceKM: 20,
		},
	})

	result, err := s.BackfillPublicPacketPaths(ctx, now-10_000, now, 1)
	if err != nil {
		t.Fatal(err)
	}
	if result.Scanned != 1 || result.Projected != 1 || !result.Remaining {
		t.Fatalf("first backfill result = %#v, want one projected with remaining work", result)
	}
	result, err = s.BackfillPublicPacketPaths(ctx, now-10_000, now, 10)
	if err != nil {
		t.Fatal(err)
	}
	if result.Scanned != 1 || result.Projected != 1 || result.Remaining {
		t.Fatalf("second backfill result = %#v, want final projected row", result)
	}
	complete, err := s.PublicPacketPathProjectionComplete(ctx, now-10_000, now)
	if err != nil {
		t.Fatal(err)
	}
	if !complete {
		t.Fatalf("projection should be complete after backfill")
	}
	packets, next, err := s.PublicPacketPaths(ctx, PublicPacketPathQuery{
		From:        now - 10_000,
		To:          now,
		Limit:       10,
		IATA:        "YKF",
		MessageOnly: true,
		Search:      "sender",
	})
	if err != nil {
		t.Fatal(err)
	}
	if next != nil {
		t.Fatalf("next cursor = %#v, want exhausted", next)
	}
	if len(packets) != 1 {
		t.Fatalf("projected packets = %#v, want only the valid mappable path", packets)
	}
	packet := packets[0]
	if packet.IATA != "YKF" || packet.Region != "YKF" || packet.HopCount != 1 || packet.MessageText != "hello from backfill" {
		t.Fatalf("projected packet = %#v", packet)
	}
	raw, err := json.Marshal(packet)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"hash-backfill", "packetHash", "pathHex", "observerPublicKey"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("backfilled public packet leaked %q: %s", forbidden, raw)
		}
	}
}

func TestPublicPacketPathSearchIndexFallbackKeepsResults(t *testing.T) {
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

	now := time.Now().UnixMilli()
	validObservation := insertPacketPathBackfillObservation(t, ctx, s, "hash-fts-valid-private", "YKF", now-2_000)
	insertPacketPathBackfillEdge(t, ctx, s, validObservation, "hash-fts-valid-private", "GROUP_TEXT", "Corebot", "hello from indexed search", now-2_000, []live.EdgeSegment{
		{
			From:       live.EdgeEndpoint{NodeID: "node-a", Name: "YKF Corebot", Lat: 43.65, Lng: -79.38, PathHash3: "AAAAAA"},
			To:         live.EdgeEndpoint{NodeID: "node-b", Name: "Krabs Repeater", Lat: 43.75, Lng: -79.48, PathHash3: "BBBBBB"},
			DistanceKM: 14,
		},
	})
	if _, err := s.BackfillPublicPacketPaths(ctx, now-10_000, now, 10); err != nil {
		t.Fatal(err)
	}
	if !s.publicPacketPathSearchIndexComplete(ctx, now-10_000, now) {
		t.Fatalf("search index should be complete after trigger-indexed backfill")
	}
	packets, _, err := s.PublicPacketPaths(ctx, PublicPacketPathQuery{
		From:   now - 10_000,
		To:     now,
		Limit:  10,
		Search: "krabs",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(packets) != 1 || packets[0].EndpointLabels[1] != "Krabs Repeater" {
		t.Fatalf("indexed search packets = %#v, want Krabs match", packets)
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM public_packet_paths_fts`); err != nil {
		t.Fatal(err)
	}
	if s.publicPacketPathSearchIndexComplete(ctx, now-10_000, now) {
		t.Fatalf("search index should report incomplete after deleting FTS rows")
	}
	packets, _, err = s.PublicPacketPaths(ctx, PublicPacketPathQuery{
		From:   now - 10_000,
		To:     now,
		Limit:  10,
		Search: "krabs",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(packets) != 1 || packets[0].EndpointLabels[1] != "Krabs Repeater" {
		t.Fatalf("fallback search packets = %#v, want Krabs match", packets)
	}
}

func TestPublicPacketPathFTSQuerySanitizesFreeformSearch(t *testing.T) {
	got := publicPacketPathFTSQuery(`Krabs / YKF-Corebot!!! hidden" OR route`)
	want := "krabs* ykf* corebot* hidden* or* route*"
	if got != want {
		t.Fatalf("FTS query = %q, want %q", got, want)
	}
}

func insertPacketPathBackfillObservation(t *testing.T, ctx context.Context, s *Store, hash string, region string, heardAt int64) int64 {
	t.Helper()
	if _, err := s.db.ExecContext(ctx, `
INSERT INTO packets (
  packet_hash, raw_hex, route_type, route_type_name, payload_type, payload_type_name,
  payload_version, hash_size, hop_count, path_hex, payload_hex, first_seen_ms, last_seen_ms
) VALUES (?, '', 1, 'FLOOD', 2, 'GROUP_TEXT', 0, 1, 1, '', '', ?, ?)`, hash, heardAt, heardAt); err != nil {
		t.Fatal(err)
	}
	result, err := s.db.ExecContext(ctx, `
INSERT INTO packet_observations (
  packet_hash, topic, iata, observer_public_key, observer_name, raw_json, heard_at_ms,
  route_type, route_type_name, payload_type, payload_type_name, payload_version,
  hash_size, hop_count, path_hex, payload_hex, resolution_status, resolution_reason,
  summary, message_sender, message_text, created_at_ms
) VALUES (?, ?, ?, 'AA00000000000000000000000000000000000000000000000000000000000000',
  'Observer', '{}', ?, 1, 'FLOOD', 2, 'GROUP_TEXT', 0, 1, 1, '', '',
  'high', 'resolved_path_high_confidence', 'private summary', 'Corebot', 'hello from backfill', ?)`,
		hash,
		"meshcore/"+region+"/AA00000000000000000000000000000000000000000000000000000000000000/packets",
		region,
		heardAt,
		heardAt,
	)
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func insertPacketPathBackfillEdge(t *testing.T, ctx context.Context, s *Store, observationID int64, hash string, payload string, sender string, message string, heardAt int64, segments []live.EdgeSegment) {
	t.Helper()
	segmentsJSON, err := json.Marshal(segments)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(ctx, `
INSERT INTO live_edge_events (
  packet_hash, observation_id, payload_type, payload_type_name, message_sender,
  message_text, message_anchor_json, heard_at_ms, segments_json, render_reason,
  created_at_ms
) VALUES (?, ?, 2, ?, ?, ?, '', ?, ?, 'resolved_path_high_confidence', ?)`,
		hash,
		observationID,
		payload,
		sender,
		message,
		heardAt,
		string(segmentsJSON),
		heardAt,
	); err != nil {
		t.Fatal(err)
	}
}
