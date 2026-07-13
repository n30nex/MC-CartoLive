// Command perfseed creates and inspects credential-free SQLite datasets for
// the current release performance gate. It is not part of the production image.
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
	ObservationRows        int64 `json:"observationRows"`
	ExpiredObservationRows int64 `json:"expiredObservationRows"`
	NonEmptyIngestIDs      int64 `json:"nonEmptyIngestIds"`
	UniqueIngestIDs        int64 `json:"uniqueIngestIds"`
	PacketRows             int64 `json:"packetRows"`
	PublicPathRows         int64 `json:"publicPathRows"`
	PublicEventRows        int64 `json:"publicEventRows"`
	EdgeRows               int64 `json:"edgeRows"`
	MultiHopEdgeRows       int64 `json:"multiHopEdgeRows"`
	NodeRows               int64 `json:"nodeRows"`
	ObserverStatusRows     int64 `json:"observerStatusRows"`
	PublicRouteRows        int64 `json:"publicRouteRows"`
	PublicPathFTSRows      int64 `json:"publicPathFtsRows"`
	SchemaVersion          int   `json:"schemaVersion"`
	DatabaseBytes          int64 `json:"databaseBytes"`
	WriteAheadLogBytes     int64 `json:"writeAheadLogBytes"`
	SeedDurationMillis     int64 `json:"seedDurationMs,omitempty"`
}

type perfTopologyNode struct {
	id, prefix, name, role, iata string
	lat, lng                     float64
}

type perfTopologyRoute struct {
	id       string
	from, to perfTopologyNode
	distance float64
}

func perfPublicKey(prefix string) string {
	return strings.ToUpper(prefix) + strings.Repeat("0", 64-len(prefix))
}

func main() {
	mode := flag.String("mode", "seed", "seed or count")
	dbPath := flag.String("db", "", "SQLite database path")
	observations := flag.Int64("observations", 5_000_000, "synthetic packet_observation rows")
	paths := flag.Int64("paths", 10_000, "synthetic public packet paths")
	events := flag.Int64("events", 20_000, "retained public events")
	expiredObservations := flag.Int64("expired-observations", -1, "observation rows older than the retention window; -1 seeds 10% capped at 250000")
	expiredAge := flag.Duration("expired-age", 30*24*time.Hour, "age of the controlled expired observation cohort")
	topology := flag.Bool("topology", true, "seed resolvable observer/forwarder nodes plus one-hop and multi-hop routes")
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
	if *expiredObservations < -1 {
		fatalf("expired observation count cannot be below -1")
	}
	expiredCount := *expiredObservations
	if expiredCount < 0 {
		expiredCount = min(*observations/10, 250_000)
	}
	if expiredCount > *observations {
		fatalf("expired observation rows (%d) cannot exceed observation rows (%d)", expiredCount, *observations)
	}
	if *expiredAge < 24*time.Hour {
		fatalf("-expired-age must be at least 24h")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Minute)
	defer cancel()
	started := time.Now()
	if *mode == "seed" {
		if *fresh {
			removeDatabaseFiles(*dbPath)
		}
		if err := seed(ctx, *dbPath, *observations, *paths, *events, expiredCount, *expiredAge, *topology); err != nil {
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

func seed(ctx context.Context, path string, observations, paths, events, expiredObservations int64, expiredAge time.Duration, topology bool) error {
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
	CASE WHEN n >= ? THEN ? - (n % 86400000) ELSE ? - (n % ?) END,
	-72.0, 7.0, 1.0, 9, 'flood', 1, 'TXT', 1, 1,
	CASE WHEN (n % 3) = 0 THEN 1 ELSE 2 END,
  'A1', '4869', 'high', 'synthetic_load_gate', 0, 'synthetic performance row',
	'Performance Gate', 'Synthetic performance message',
	CASE WHEN n >= ? THEN ? - (n % 86400000) ELSE ? - (n % ?) END
FROM numbers WHERE n < ?`
		window := int64(6 * 24 * time.Hour / time.Millisecond)
		expiredStart := observations - expiredObservations
		expiredAt := now - expiredAge.Milliseconds()
		if _, err := db.ExecContext(ctx, query,
			strings.Repeat("A", 64),
			"meshcore/YYZ/"+strings.Repeat("B", 64)+"/packets",
			strings.Repeat("C", 64),
			expiredStart, expiredAt, now, window,
			expiredStart, expiredAt, now, window,
			observations,
		); err != nil {
			return fmt.Errorf("insert observations: %w", err)
		}
	}

	if paths > 0 {
		edgeSegmentsOne := `[{"from":{"nodeId":"node-perf-aa","name":"Toronto Core","lat":43.6532,"lng":-79.3832,"pathHash3":"AA0000"},"to":{"nodeId":"node-perf-bb","name":"Lakeshore Relay","lat":43.7000,"lng":-79.2000,"pathHash3":"BB0000"},"distanceKm":15.4}]`
		edgeSegmentsMultiA := `[{"from":{"nodeId":"node-perf-aa","name":"Toronto Core","lat":43.6532,"lng":-79.3832,"pathHash3":"AA0000"},"to":{"nodeId":"node-perf-bb","name":"Lakeshore Relay","lat":43.7000,"lng":-79.2000,"pathHash3":"BB0000"},"distanceKm":15.4},{"from":{"nodeId":"node-perf-bb","name":"Lakeshore Relay","lat":43.7000,"lng":-79.2000,"pathHash3":"BB0000"},"to":{"nodeId":"node-perf-cc","name":"YYZ Observer","lat":43.6410,"lng":-79.3890,"pathHash3":"CC0000"},"distanceKm":17.1}]`
		edgeSegmentsMultiB := `[{"from":{"nodeId":"node-perf-dd","name":"Ottawa Core","lat":45.4215,"lng":-75.6972,"pathHash3":"DD0000"},"to":{"nodeId":"node-perf-ee","name":"Gatineau Relay","lat":45.4765,"lng":-75.7013,"pathHash3":"EE0000"},"distanceKm":6.1},{"from":{"nodeId":"node-perf-ee","name":"Gatineau Relay","lat":45.4765,"lng":-75.7013,"pathHash3":"EE0000"},"to":{"nodeId":"node-perf-ff","name":"YOW Observer","lat":45.3500,"lng":-75.7500,"pathHash3":"FF0000"},"distanceKm":14.6}]`
		if !topology {
			edgeSegmentsMultiA, edgeSegmentsMultiB = edgeSegmentsOne, edgeSegmentsOne
		}
		query := numberCTE(paths) + `
INSERT INTO live_edge_events (
  id, ingest_id, packet_hash, observation_id, payload_type, payload_type_name,
  message_sender, message_text, message_anchor_json, heard_at_ms, segments_json,
  render_reason, created_at_ms
)
SELECT n + 1, '', ?, n + 1, 1, 'TXT', 'Performance Gate',
	'Synthetic performance message', '', ? - (n % 3600000),
	CASE (n % 3) WHEN 0 THEN ? WHEN 1 THEN ? ELSE ? END,
  'resolved_path_high_confidence', ?
FROM numbers WHERE n < ?`
		if _, err := db.ExecContext(ctx, query, strings.Repeat("A", 64), now, edgeSegmentsOne, edgeSegmentsMultiA, edgeSegmentsMultiB, now, paths); err != nil {
			return fmt.Errorf("insert edge events: %w", err)
		}

		publicSegmentsOne := strings.ReplaceAll(edgeSegmentsOne, `"name":`, `"label":`)
		publicSegmentsMultiA := strings.ReplaceAll(edgeSegmentsMultiA, `"name":`, `"label":`)
		publicSegmentsMultiB := strings.ReplaceAll(edgeSegmentsMultiB, `"name":`, `"label":`)
		query = numberCTE(paths) + `
INSERT INTO public_packet_paths (
  edge_id, observation_id, mappable, heard_at_ms, iata, region, payload_type_name,
  message_sender, message_text, hop_count, segment_count, distance_km,
  route_ids_json, endpoint_labels_json, segments_json, search_text, created_at_ms
)
SELECT n + 1, n + 1, 1, ? - (n % 3600000), 'YYZ', 'YYZ', 'TXT',
	'Performance Gate', 'Synthetic performance message',
	CASE WHEN (n % 3) = 0 THEN 1 ELSE 2 END,
	CASE WHEN (n % 3) = 0 THEN 1 ELSE 2 END,
	CASE WHEN (n % 3) = 0 THEN 15.4 WHEN (n % 3) = 1 THEN 32.5 ELSE 20.7 END,
	CASE (n % 3) WHEN 0 THEN '["perf-route-ab"]' WHEN 1 THEN '["perf-route-ab","perf-route-bc"]' ELSE '["perf-route-de","perf-route-ef"]' END,
	CASE (n % 3) WHEN 0 THEN '["Toronto Core","Lakeshore Relay"]' WHEN 1 THEN '["Toronto Core","Lakeshore Relay","YYZ Observer"]' ELSE '["Ottawa Core","Gatineau Relay","YOW Observer"]' END,
	CASE (n % 3) WHEN 0 THEN ? WHEN 1 THEN ? ELSE ? END,
  'performance gate synthetic route yyz txt', ?
FROM numbers WHERE n < ?`
		if _, err := db.ExecContext(ctx, query, now, publicSegmentsOne, publicSegmentsMultiA, publicSegmentsMultiB, now, paths); err != nil {
			return fmt.Errorf("insert public paths: %w", err)
		}
	}

	topologyNodes := []perfTopologyNode{
		{id: "node-perf-aa", prefix: "AA", name: "Toronto Core", role: "repeater", iata: "YYZ", lat: 43.6532, lng: -79.3832},
		{id: "node-perf-bb", prefix: "BB", name: "Lakeshore Relay", role: "repeater", iata: "YYZ", lat: 43.7000, lng: -79.2000},
		{id: "node-perf-cc", prefix: "CC", name: "YYZ Observer", role: "observer", iata: "YYZ", lat: 43.6410, lng: -79.3890},
	}
	if topology {
		topologyNodes = append(topologyNodes,
			perfTopologyNode{id: "node-perf-dd", prefix: "DD", name: "Ottawa Core", role: "repeater", iata: "YOW", lat: 45.4215, lng: -75.6972},
			perfTopologyNode{id: "node-perf-ee", prefix: "EE", name: "Gatineau Relay", role: "repeater", iata: "YOW", lat: 45.4765, lng: -75.7013},
			perfTopologyNode{id: "node-perf-ff", prefix: "FF", name: "YOW Observer", role: "observer", iata: "YOW", lat: 45.3500, lng: -75.7500},
		)
	}
	for _, node := range topologyNodes {
		publicKey := perfPublicKey(node.prefix)
		if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO nodes (
  node_id, public_key, name, node_type, role, latitude, longitude, location_source,
  first_seen_ms, last_seen_ms, observation_count, supports_multibyte
) VALUES (?, ?, ?, 2, ?, ?, ?, 'synthetic', ?, ?, ?, 'unknown')`,
			node.id, publicKey, node.name, node.role, node.lat, node.lng, now-86_400_000, now, observations); err != nil {
			return err
		}
		if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO node_iatas (public_key, iata, first_seen_ms, last_seen_ms, observation_count)
VALUES (?, ?, ?, ?, ?)`, publicKey, node.iata, now-86_400_000, now, observations); err != nil {
			return err
		}
		if node.role == "repeater" {
			if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO node_short_ids (public_key, iata, hash_size, prefix_hex, role, updated_at_ms)
VALUES (?, ?, 1, ?, ?, ?)`, publicKey, node.iata, node.prefix, node.role, now); err != nil {
				return err
			}
		} else {
			statusJSON := fmt.Sprintf(`{"origin":%q,"role":"observer","latitude":%.4f,"longitude":%.4f}`, node.name, node.lat, node.lng)
			if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO observers (public_key, iata, name, latitude, longitude, last_seen_ms, packet_count, status_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, publicKey, node.iata, node.name, node.lat, node.lng, now, observations, statusJSON); err != nil {
				return err
			}
			if _, err := db.ExecContext(ctx, `
INSERT INTO observer_status (public_key, iata, status_json, received_at_ms) VALUES (?, ?, ?, ?)`, publicKey, node.iata, statusJSON, now); err != nil {
				return err
			}
		}
	}
	routes := []perfTopologyRoute{
		{id: "perf-route-ab", from: topologyNodes[0], to: topologyNodes[1], distance: 15.4},
		{id: "perf-route-bc", from: topologyNodes[1], to: topologyNodes[2], distance: 17.1},
	}
	if topology {
		routes = append(routes,
			perfTopologyRoute{id: "perf-route-de", from: topologyNodes[3], to: topologyNodes[4], distance: 6.1},
			perfTopologyRoute{id: "perf-route-ef", from: topologyNodes[4], to: topologyNodes[5], distance: 14.6},
		)
	}
	for _, route := range routes {
		if _, err := db.ExecContext(ctx, `
INSERT OR REPLACE INTO public_route_summaries (
  route_id, from_node_id, from_label, from_lat, from_lng, from_path_hash3,
  to_node_id, to_label, to_lat, to_lng, to_path_hash3, distance_km,
  packet_count, last_heard_ms, payload_type_names_json, updated_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '["TXT"]', ?)`,
			route.id, route.from.id, route.from.name, route.from.lat, route.from.lng, route.from.prefix+"0000",
			route.to.id, route.to.name, route.to.lat, route.to.lng, route.to.prefix+"0000", route.distance,
			max(paths/int64(len(routes)), 1), now, now); err != nil {
			return err
		}
	}

	if events > 0 {
		query := numberCTE(events) + `
INSERT INTO public_events (
  dedupe_key, event_type, occurred_at_ms, received_at_ms, region, iata,
  payload_type_name, message_flag, route_ids_json, node_ids_json, public_json
)
SELECT '', 'activity', ? - (n % 82800000), ? - (n % 82800000), 'YYZ', 'YYZ',
	'TXT', 1, '["perf-route-ab"]', '["node-perf-aa","node-perf-bb"]',
	'{"id":"activity-perf","kind":"packet","payloadTypeName":"TXT","region":"YYZ","iata":"YYZ","heardAt":1,"hopCount":1,"hasRoute":true,"animationState":"resolved","resolutionBucket":"high","routeIds":["perf-route-ab"],"endpointLabels":["Toronto Core","Lakeshore Relay"],"messageSender":"Performance Gate","messageText":"Synthetic performance message"}'
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
  (SELECT COUNT(*) FROM packet_observations WHERE heard_at_ms < ?),
  (SELECT COUNT(*) FROM packet_observations WHERE ingest_id != ''),
  (SELECT COUNT(DISTINCT ingest_id) FROM packet_observations WHERE ingest_id != ''),
  (SELECT COUNT(*) FROM packets),
  (SELECT COUNT(*) FROM public_packet_paths),
  (SELECT COUNT(*) FROM public_events),
  (SELECT COUNT(*) FROM live_edge_events),
  (SELECT COUNT(*) FROM live_edge_events WHERE json_array_length(segments_json) > 1),
  (SELECT COUNT(*) FROM nodes),
  (SELECT COUNT(*) FROM observer_status),
  (SELECT COUNT(*) FROM public_route_summaries),
  (SELECT COUNT(*) FROM public_packet_paths_fts),
  (SELECT user_version FROM pragma_user_version)
`, time.Now().Add(-7*24*time.Hour).UnixMilli()).Scan(
		&stats.ObservationRows,
		&stats.ExpiredObservationRows,
		&stats.NonEmptyIngestIDs,
		&stats.UniqueIngestIDs,
		&stats.PacketRows,
		&stats.PublicPathRows,
		&stats.PublicEventRows,
		&stats.EdgeRows,
		&stats.MultiHopEdgeRows,
		&stats.NodeRows,
		&stats.ObserverStatusRows,
		&stats.PublicRouteRows,
		&stats.PublicPathFTSRows,
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
