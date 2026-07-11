package store

import (
	"context"
	"strings"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/meshcore"
	"meshcore-canada-live-map/backend/internal/mqtt"
)

func TestFreshDatabaseUsesVersionedIncrementalVacuumSchema(t *testing.T) {
	ctx := context.Background()
	st, err := Open(ctx, t.TempDir()+"/fresh.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	var userVersion int
	if err := st.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&userVersion); err != nil {
		t.Fatal(err)
	}
	if userVersion != SchemaVersion {
		t.Fatalf("user_version=%d want %d", userVersion, SchemaVersion)
	}
	var autoVacuum int
	if err := st.db.QueryRowContext(ctx, `PRAGMA auto_vacuum`).Scan(&autoVacuum); err != nil {
		t.Fatal(err)
	}
	if autoVacuum != 2 {
		t.Fatalf("auto_vacuum=%d want 2 (INCREMENTAL)", autoVacuum)
	}
	var recorded int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version=?`, SchemaVersion).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if recorded != 1 {
		t.Fatalf("schema migration records=%d want 1", recorded)
	}
	storage := st.StorageInfo()
	if storage.TotalBytes == 0 || storage.FreeBytes == 0 || storage.FreePercent <= 0 || storage.PressureState == "" {
		t.Fatalf("filesystem storage info unavailable: %#v", storage)
	}
}

func TestPublicEventCursorPlanUsesPrimaryKeyAtMillionScaleSequence(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	now := time.Now().UnixMilli()
	for _, seq := range []int64{5_000_000, 5_000_001, 5_000_002} {
		if _, err := st.db.ExecContext(ctx, `
INSERT INTO public_events (
  seq, event_type, occurred_at_ms, received_at_ms, public_json
) VALUES (?, 'activity', ?, ?, '{}')`, seq, now, now); err != nil {
			t.Fatal(err)
		}
	}
	oldest, latest, err := st.PublicSeqBounds(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if oldest != 5_000_000 || latest != 5_000_002 {
		t.Fatalf("bounds=%d..%d", oldest, latest)
	}
	rows, err := st.reader().QueryContext(ctx, `EXPLAIN QUERY PLAN
SELECT seq FROM public_events
WHERE seq > ?
ORDER BY seq ASC LIMIT ?`, 5_000_000, 25)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	plan := ""
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plan += detail + "\n"
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan, "SEARCH public_events") || !strings.Contains(plan, "seq>?") || strings.Contains(plan, "SCAN public_events") || strings.Contains(plan, "TEMP B-TREE") {
		t.Fatalf("cursor query is not a primary-key seek:\n%s", plan)
	}
}

func TestUpsertPacketAndObservationRetryIsIdempotent(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	parsed := meshcore.ParsedPacket{
		PacketHash: "packet-hash", RawHex: "0102", RouteTypeName: "DIRECT",
		PayloadTypeName: "ADVERT", PathBytes: []byte{1}, Payload: []byte{2},
	}
	insert := ObservationInsert{
		IngestID: "queued-delivery-id",
		Message: mqtt.NormalizedMessage{
			IngestID: "queued-delivery-id", Topic: "meshcore/YYZ/packets",
			TopicInfo: mqtt.TopicInfo{IATA: "YYZ", PublisherPK: "observer", Subtopic: "packets"},
			HeardAtMs: time.Now().UnixMilli(),
		},
		Parsed: parsed, Summary: "safe summary",
	}
	firstID, duplicate, err := st.UpsertPacketAndObservation(ctx, parsed, insert.Message.HeardAtMs, insert)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate {
		t.Fatal("first insert reported duplicate")
	}
	secondID, duplicate, err := st.UpsertPacketAndObservation(ctx, parsed, insert.Message.HeardAtMs, insert)
	if err != nil {
		t.Fatal(err)
	}
	if firstID != secondID {
		t.Fatalf("retry IDs differ: %d != %d", firstID, secondID)
	}
	if !duplicate {
		t.Fatal("retry did not report duplicate suppression")
	}
	var observations, seenCount int
	if err := st.reader().QueryRowContext(ctx, `SELECT COUNT(*) FROM packet_observations WHERE ingest_id=?`, insert.IngestID).Scan(&observations); err != nil {
		t.Fatal(err)
	}
	if err := st.reader().QueryRowContext(ctx, `SELECT seen_count FROM packets WHERE packet_hash=?`, parsed.PacketHash).Scan(&seenCount); err != nil {
		t.Fatal(err)
	}
	if observations != 1 || seenCount != 1 {
		t.Fatalf("observations=%d seen_count=%d want 1/1", observations, seenCount)
	}
}

func TestIdempotencyLookupsUsePartialUniqueIndexes(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if _, err := st.db.ExecContext(ctx, `PRAGMA automatic_index=OFF`); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name  string
		query string
		index string
	}{
		{name: "observation", query: observationByIngestIDSQL, index: "idx_observations_ingest_id"},
		{name: "edge", query: edgeByIngestIDSQL, index: "idx_live_edge_events_ingest_id"},
		{name: "public event", query: publicEventByDedupeKeySQL, index: "idx_public_events_dedupe_key"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, err := st.db.QueryContext(ctx, `EXPLAIN QUERY PLAN `+tc.query, "release-lookup-id")
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			plan := ""
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				plan += detail + "\n"
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(plan, "SEARCH") || !strings.Contains(plan, tc.index) || strings.Contains(plan, "SCAN") {
				t.Fatalf("idempotency lookup did not seek through %s:\n%s", tc.index, plan)
			}
		})
	}
}

func TestStoragePressureThresholds(t *testing.T) {
	for _, tc := range []struct {
		free float64
		want string
	}{{21, "ok"}, {20, "warn"}, {10.1, "warn"}, {10, "critical"}, {0, "critical"}} {
		if got := storagePressureState(tc.free); got != tc.want {
			t.Fatalf("storagePressureState(%v)=%q want %q", tc.free, got, tc.want)
		}
	}
}

func TestReadPoolConfigPrefersNewKeyWithLegacyFallback(t *testing.T) {
	ctx := context.Background()
	t.Run("new key", func(t *testing.T) {
		t.Setenv("SQLITE_READ_OPEN_CONNS", "2")
		t.Setenv("SQLITE_MAX_OPEN_CONNS", "4")
		st, err := Open(ctx, t.TempDir()+"/new-key.db")
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		if got := st.RuntimeInfo(ctx).ReadMaxOpenConns; got != 2 {
			t.Fatalf("read pool=%d want 2", got)
		}
	})
	t.Run("legacy fallback", func(t *testing.T) {
		t.Setenv("SQLITE_READ_OPEN_CONNS", "")
		t.Setenv("SQLITE_MAX_OPEN_CONNS", "3")
		st, err := Open(ctx, t.TempDir()+"/legacy-key.db")
		if err != nil {
			t.Fatal(err)
		}
		defer st.Close()
		if got := st.RuntimeInfo(ctx).ReadMaxOpenConns; got != 3 {
			t.Fatalf("legacy read pool=%d want 3", got)
		}
	})
}
