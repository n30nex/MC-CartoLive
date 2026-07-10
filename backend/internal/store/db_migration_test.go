package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	mq "meshcore-canada-live-map/backend/internal/mqtt"
)

func TestMigrateRollsBackColumnsAndVersionOnFailure(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "rollback.db")
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, oldSchemaSQLForMigrationTest); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	st := &Store{db: db, path: path, coordinatePolicy: live.CurrentCoordinatePolicy(), migrationHook: func(stage string) error {
		return errors.New("injected migration failure at " + stage)
	}}
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(ctx); err == nil {
		t.Fatal("expected injected migration failure")
	}
	if testColumnExists(t, ctx, st, "packet_observations", "ingest_id") {
		t.Fatal("ingest_id column survived rolled-back migration")
	}
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 0 {
		t.Fatalf("user_version=%d after rollback, want 0", version)
	}
}

func TestMigrateUpgradesOldSchemaColumns(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, oldSchemaSQLForMigrationTest); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	db, err = sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, path: path, coordinatePolicy: live.CurrentCoordinatePolicy()}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate old schema: %v", err)
	}

	for table, columns := range map[string][]string{
		"nodes":                         {"supports_multibyte"},
		"packet_observations":           {"ingest_id", "message_sender", "message_text"},
		"live_edge_events":              {"ingest_id", "message_sender", "message_text", "message_anchor_json"},
		"public_packet_paths":           {"mappable", "region", "route_ids_json", "endpoint_labels_json", "search_text", "message_sender", "message_text"},
		"public_route_summaries":        {"route_id", "from_node_id", "to_node_id", "last_heard_ms"},
		"public_route_summary_edges":    {"edge_id", "heard_at_ms"},
		"public_events":                 {"dedupe_key", "event_type", "public_json", "route_ids_json", "node_ids_json"},
		"public_coverage_cells":         {"precision_bucket", "attribution"},
		"propagation_weather_snapshots": {"fetched_at_ms", "pressure_hpa", "inversion_proxy"},
		"propagation_events":            {"public_id", "classification", "weather_json", "solar_json"},
	} {
		for _, column := range columns {
			if !testColumnExists(t, ctx, s, table, column) {
				t.Fatalf("missing migrated column %s.%s", table, column)
			}
		}
	}

	lat, lng := 43.65, -79.38
	now := time.Now().UnixMilli()
	advertKey := "AA00000000000000000000000000000000000000000000000000000000000000"
	if _, err := s.UpsertAdvertNode(ctx, "YKF", meshcore.Advert{
		PublicKey:      advertKey,
		NodeType:       1,
		Role:           "repeater",
		Latitude:       &lat,
		Longitude:      &lng,
		Name:           "Advert Node",
		LocationSource: "advert",
	}, now); err != nil {
		t.Fatalf("upsert advert node after migration: %v", err)
	}
	node, err := s.NodeByPublicKey(ctx, advertKey)
	if err != nil {
		t.Fatalf("node by public key after migration: %v", err)
	}
	if node.SupportsMultibyte != "known" {
		t.Fatalf("supports multibyte = %q, want known", node.SupportsMultibyte)
	}

	statusKey := "BB00000000000000000000000000000000000000000000000000000000000000"
	if err := s.UpsertObserver(ctx, mq.NormalizedMessage{
		TopicInfo: mq.TopicInfo{IATA: "YKF", Region: "YKF", PublisherPK: statusKey, Subtopic: "status"},
		Payload:   map[string]any{"lat": 43.66, "lng": -79.39},
		RawJSON:   `{"lat":43.66,"lng":-79.39}`,
		HeardAtMs: now + 1,
	}); err != nil {
		t.Fatalf("upsert observer/status node after migration: %v", err)
	}
	if _, err := s.NodeByPublicKey(ctx, statusKey); err != nil {
		t.Fatalf("status node by public key after migration: %v", err)
	}
	nodes, err := s.Nodes(ctx, false, "")
	if err != nil {
		t.Fatalf("nodes after migration: %v", err)
	}
	if len(nodes) < 2 {
		t.Fatalf("nodes after migration = %d, want at least 2", len(nodes))
	}
}

func testColumnExists(t *testing.T, ctx context.Context, s *Store, table string, column string) bool {
	t.Helper()
	tableIdent, err := sqliteIdent(table)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(`+tableIdent+`)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name string
		var typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			t.Fatal(err)
		}
		if name == column {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return false
}

const oldSchemaSQLForMigrationTest = `
CREATE TABLE packets (
  packet_hash TEXT PRIMARY KEY,
  raw_hex TEXT NOT NULL,
  route_type INTEGER NOT NULL,
  route_type_name TEXT NOT NULL,
  payload_type INTEGER NOT NULL,
  payload_type_name TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  hash_size INTEGER NOT NULL,
  hop_count INTEGER NOT NULL,
  path_hex TEXT NOT NULL,
  payload_hex TEXT NOT NULL,
  invalid_for_map INTEGER NOT NULL DEFAULT 0,
  invalid_reason TEXT NOT NULL DEFAULT '',
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE packet_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  packet_hash TEXT NOT NULL,
  topic TEXT NOT NULL,
  iata TEXT NOT NULL,
  observer_public_key TEXT NOT NULL,
  observer_name TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  heard_at_ms INTEGER NOT NULL,
  rssi REAL,
  snr REAL,
  score REAL,
  route_type INTEGER NOT NULL,
  route_type_name TEXT NOT NULL,
  payload_type INTEGER NOT NULL,
  payload_type_name TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  hash_size INTEGER NOT NULL,
  hop_count INTEGER NOT NULL,
  path_hex TEXT NOT NULL,
  payload_hex TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'unresolved',
  resolution_reason TEXT NOT NULL DEFAULT '',
  invalid_for_map INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE nodes (
  node_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  node_type INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'unknown',
  latitude REAL,
  longitude REAL,
  location_source TEXT NOT NULL DEFAULT '',
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE node_iatas (
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(public_key, iata)
);
CREATE TABLE node_short_ids (
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  hash_size INTEGER NOT NULL,
  prefix_hex TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'unknown',
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(public_key, iata, hash_size, prefix_hex)
);
CREATE TABLE observers (
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  last_seen_ms INTEGER NOT NULL,
  packet_count INTEGER NOT NULL DEFAULT 0,
  status_json TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(public_key, iata)
);
CREATE TABLE observer_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  status_json TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL
);
CREATE TABLE live_edge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  packet_hash TEXT NOT NULL,
  observation_id INTEGER NOT NULL,
  payload_type INTEGER NOT NULL,
  payload_type_name TEXT NOT NULL,
  heard_at_ms INTEGER NOT NULL,
  segments_json TEXT NOT NULL,
  render_reason TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE public_packet_paths (
  edge_id INTEGER PRIMARY KEY,
  observation_id INTEGER NOT NULL,
  heard_at_ms INTEGER NOT NULL,
  iata TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL
);
`
