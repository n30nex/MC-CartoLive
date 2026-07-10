// Command perfseed creates and inspects credential-free SQLite datasets for
// the 3.2.0 release performance gate. It is not part of the production image.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/store"

	_ "modernc.org/sqlite"
)

type databaseStats struct {
	ObservationRows    int64 `json:"observationRows"`
	NonEmptyIngestIDs  int64 `json:"nonEmptyIngestIds"`
	UniqueIngestIDs    int64 `json:"uniqueIngestIds"`
	PacketRows         int64 `json:"packetRows"`
	PublicPathRows     int64 `json:"publicPathRows"`
	PublicEventRows    int64 `json:"publicEventRows"`
	SchemaVersion      int   `json:"schemaVersion"`
	DatabaseBytes      int64 `json:"databaseBytes"`
	WriteAheadLogBytes int64 `json:"writeAheadLogBytes"`
	SeedDurationMillis int64 `json:"seedDurationMs,omitempty"`
}

func main() {
	mode := flag.String("mode", "seed", "seed or count")
	dbPath := flag.String("db", "", "SQLite database path")
	observations := flag.Int64("observations", 5_000_000, "synthetic packet_observation rows")
	paths := flag.Int64("paths", 10_000, "synthetic public packet paths")
	events := flag.Int64("events", 20_000, "retained public events")
	fresh := flag.Bool("fresh", false, "remove the explicitly named gate database before seeding")
	flag.Parse()

	if strings.TrimSpace(*dbPath) == "" {
		fatalf("-db is required")
	}
	if *mode != "seed" && *mode != "count" {
		fatalf("unsupported -mode %q", *mode)
	}
	if *observations < 0 || *paths < 0 || *events < 0 {
		fatalf("row counts cannot be negative")
	}
	if *paths > *observations {
		fatalf("public path rows (%d) cannot exceed observation rows (%d)", *paths, *observations)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Minute)
	defer cancel()
	started := time.Now()
	if *mode == "seed" {
		if *fresh {
			removeDatabaseFiles(*dbPath)
		}
		if err := seed(ctx, *dbPath, *observations, *paths, *events); err != nil {
			fatalf("seed performance database: %v", err)
		}
	}
	stats, err := inspect(ctx, *dbPath)
	if err != nil {
		fatalf("inspect performance database: %v", err)
	}
	if *mode == "seed" {
		stats.SeedDurationMillis = time.Since(started).Milliseconds()
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(stats); err != nil {
		fatalf("encode result: %v", err)
	}
}

func seed(ctx context.Context, path string, observations, paths, events int64) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	st, err := store.Open(ctx, path)
	if err != nil {
		return err
	}
	if err := st.Close(); err != nil {
		return err
	}

	db, err := sql.Open("sqlite", sqliteSeedDSN(path))
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if err := db.PingContext(ctx); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO packets (
  packet_hash, raw_hex, route_type, route_type_name, payload_type, payload_type_name,
  payload_version, hash_size, hop_count, path_hex, payload_hex, invalid_for_map,
  invalid_reason, first_seen_ms, last_seen_ms, seen_count
) VALUES (?, ?, 9, 'flood', 1, 'TXT', 1, 1, 1, 'A1', '4869', 0, '', ?, ?, ?)`,
		strings.Repeat("A", 64), "0901A14869", now-6*24*60*60*1000, now, observations); err != nil {
		return err
	}

	if observations > 0 {
		query := numberCTE(observations) + `
INSERT INTO packet_observations (
  ingest_id, packet_hash, topic, iata, observer_public_key, observer_name, raw_json,
  heard_at_ms, rssi, snr, score, route_type, route_type_name, payload_type,
  payload_type_name, payload_version, hash_size, hop_count, path_hex, payload_hex,
  resolution_status, resolution_reason, invalid_for_map, summary, message_sender,
  message_text, created_at_ms
)
SELECT '', ?, ?, 'YYZ', ?, 'Performance Observer', '{}',
  ? - (n % ?), -72.0, 7.0, 1.0, 9, 'flood', 1, 'TXT', 1, 1, 1,
  'A1', '4869', 'high', 'synthetic_load_gate', 0, 'synthetic performance row',
  'Performance Gate', 'Synthetic performance message', ? - (n % ?)
FROM numbers WHERE n < ?`
		window := int64(6 * 24 * time.Hour / time.Millisecond)
		if _, err := db.ExecContext(ctx, query,
			strings.Repeat("A", 64),
			"meshcore/YYZ/"+strings.Repeat("B", 64)+"/packets",
			strings.Repeat("B", 64), now, window, now, window, observations,
		); err != nil {
			return fmt.Errorf("insert observations: %w", err)
		}
	}

	if paths > 0 {
		edgeSegments := `[{"from":{"nodeId":"node-perf-a","name":"Performance A","lat":43.6532,"lng":-79.3832,"pathHash3":"A1B2C3"},"to":{"nodeId":"node-perf-b","name":"Performance B","lat":43.7000,"lng":-79.2000,"pathHash3":"D4E5F6"},"distanceKm":15.4}]`
		query := numberCTE(paths) + `
INSERT INTO live_edge_events (
  id, ingest_id, packet_hash, observation_id, payload_type, payload_type_name,
  message_sender, message_text, message_anchor_json, heard_at_ms, segments_json,
  render_reason, created_at_ms
)
SELECT n + 1, '', ?, n + 1, 1, 'TXT', 'Performance Gate',
  'Synthetic performance message', '', ? - (n % 3600000), ?,
  'resolved_path_high_confidence', ?
FROM numbers WHERE n < ?`
		if _, err := db.ExecContext(ctx, query, strings.Repeat("A", 64), now, edgeSegments, now, paths); err != nil {
			return fmt.Errorf("insert edge events: %w", err)
		}

		publicSegments := `[{"routeId":"perf-route","from":{"nodeId":"node-perf-a","label":"Performance A","lat":43.6532,"lng":-79.3832,"pathHash3":"A1B2C3"},"to":{"nodeId":"node-perf-b","label":"Performance B","lat":43.7000,"lng":-79.2000,"pathHash3":"D4E5F6"},"distanceKm":15.4}]`
		query = numberCTE(paths) + `
INSERT INTO public_packet_paths (
  edge_id, observation_id, mappable, heard_at_ms, iata, region, payload_type_name,
  message_sender, message_text, hop_count, segment_count, distance_km,
  route_ids_json, endpoint_labels_json, segments_json, search_text, created_at_ms
)
SELECT n + 1, n + 1, 1, ? - (n % 3600000), 'YYZ', 'YYZ', 'TXT',
  'Performance Gate', 'Synthetic performance message', 1, 1, 15.4,
  '["perf-route"]', '["Performance A","Performance B"]', ?,
  'performance gate synthetic route yyz txt', ?
FROM numbers WHERE n < ?`
		if _, err := db.ExecContext(ctx, query, now, publicSegments, now, paths); err != nil {
			return fmt.Errorf("insert public paths: %w", err)
		}
	}

	if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO nodes (
  node_id, public_key, name, node_type, role, latitude, longitude, location_source,
  first_seen_ms, last_seen_ms, observation_count, supports_multibyte
) VALUES
  ('node-perf-a', ?, 'Performance A', 2, 'repeater', 43.6532, -79.3832, 'synthetic', ?, ?, ?, 'unknown'),
  ('node-perf-b', ?, 'Performance B', 2, 'repeater', 43.7000, -79.2000, 'synthetic', ?, ?, ?, 'unknown')`,
		strings.Repeat("C", 64), now-86_400_000, now, observations,
		strings.Repeat("D", 64), now-86_400_000, now, observations); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO node_iatas (public_key, iata, first_seen_ms, last_seen_ms, observation_count)
VALUES (?, 'YYZ', ?, ?, ?), (?, 'YYZ', ?, ?, ?)`,
		strings.Repeat("C", 64), now-86_400_000, now, observations,
		strings.Repeat("D", 64), now-86_400_000, now, observations); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO public_route_summaries (
  route_id, from_node_id, from_label, from_lat, from_lng, from_path_hash3,
  to_node_id, to_label, to_lat, to_lng, to_path_hash3, distance_km,
  packet_count, last_heard_ms, payload_type_names_json, updated_at_ms
) VALUES ('perf-route', 'node-perf-a', 'Performance A', 43.6532, -79.3832, 'A1B2C3',
  'node-perf-b', 'Performance B', 43.7000, -79.2000, 'D4E5F6', 15.4, ?, ?, '["TXT"]', ?)`,
		paths, now, now); err != nil {
		return err
	}

	if events > 0 {
		query := numberCTE(events) + `
INSERT INTO public_events (
  dedupe_key, event_type, occurred_at_ms, received_at_ms, region, iata,
  payload_type_name, message_flag, route_ids_json, node_ids_json, public_json
)
SELECT '', 'activity', ? - (n % 82800000), ? - (n % 82800000), 'YYZ', 'YYZ',
  'TXT', 1, '["perf-route"]', '["node-perf-a","node-perf-b"]',
  '{"id":"activity-perf","kind":"packet","payloadTypeName":"TXT","region":"YYZ","iata":"YYZ","heardAt":1,"hopCount":1,"hasRoute":true,"animationState":"resolved","resolutionBucket":"high","routeIds":["perf-route"],"endpointLabels":["Performance A","Performance B"],"messageSender":"Performance Gate","messageText":"Synthetic performance message"}'
FROM numbers WHERE n < ?`
		if _, err := db.ExecContext(ctx, query, now, now, events); err != nil {
			return fmt.Errorf("insert public events: %w", err)
		}
	}
	if _, err := db.ExecContext(ctx, `PRAGMA optimize`); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return err
	}
	return nil
}

func inspect(ctx context.Context, path string) (databaseStats, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout%3d5000")
	if err != nil {
		return databaseStats{}, err
	}
	defer db.Close()
	var stats databaseStats
	if err := db.QueryRowContext(ctx, `
SELECT
  (SELECT COUNT(*) FROM packet_observations),
  (SELECT COUNT(*) FROM packet_observations WHERE ingest_id != ''),
  (SELECT COUNT(DISTINCT ingest_id) FROM packet_observations WHERE ingest_id != ''),
  (SELECT COUNT(*) FROM packets),
  (SELECT COUNT(*) FROM public_packet_paths),
  (SELECT COUNT(*) FROM public_events),
  (SELECT user_version FROM pragma_user_version)
`).Scan(
		&stats.ObservationRows,
		&stats.NonEmptyIngestIDs,
		&stats.UniqueIngestIDs,
		&stats.PacketRows,
		&stats.PublicPathRows,
		&stats.PublicEventRows,
		&stats.SchemaVersion,
	); err != nil {
		return databaseStats{}, err
	}
	stats.DatabaseBytes = fileSize(path)
	stats.WriteAheadLogBytes = fileSize(path + "-wal")
	return stats, nil
}

func numberCTE(count int64) string {
	digits := 1
	if count > 1 {
		digits = int(math.Ceil(math.Log10(float64(count))))
		if power := int64(math.Pow10(digits)); power < count {
			digits++
		}
	}
	if digits > 9 {
		digits = 9
	}
	aliases := make([]string, 0, digits)
	terms := make([]string, 0, digits)
	for i := 0; i < digits; i++ {
		alias := fmt.Sprintf("d%d", i)
		aliases = append(aliases, "digits "+alias)
		terms = append(terms, fmt.Sprintf("%d*%s.n", int64(math.Pow10(i)), alias))
	}
	return "WITH digits(n) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),\n" +
		"numbers(n) AS (SELECT " + strings.Join(terms, " + ") + " FROM " + strings.Join(aliases, " CROSS JOIN ") + ")\n"
}

func sqliteSeedDSN(path string) string {
	return path + "?_pragma=busy_timeout%3d5000&_pragma=foreign_keys%3dOFF&_pragma=journal_mode%3dWAL&_pragma=synchronous%3dOFF&_pragma=temp_store%3dMEMORY"
}

func removeDatabaseFiles(path string) {
	for _, item := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Remove(item); err != nil && !os.IsNotExist(err) {
			fatalf("remove %s: %v", item, err)
		}
	}
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
