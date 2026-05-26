package main

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestReportFromDBExplainsYTRStyleMismatch(t *testing.T) {
	db := openDiagnosticTestDB(t)
	_, err := db.Exec(`
INSERT INTO nodes VALUES
  ('node-ytr-observer', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'YTR-Observer-01', 0, 'repeater', 44.1923, -77.39821, 'advert', 1000, 3000, 1205, 'known'),
  ('node-ytr-companion', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'DD0236FF', 0, 'companion', NULL, NULL, '', 1000, 4000, 645, 'unknown');
INSERT INTO node_iatas VALUES
  ('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'YGK', 1000, 3000, 1205),
  ('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'YTR', 1000, 4000, 645);
INSERT INTO observers VALUES
  ('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 'YTR', 'Corebot', NULL, NULL, 5000, 104, '{}'),
  ('DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', 'YTR', 'Positioned Observer', 43.4377, -80.3053, 6000, 13, '{}');
INSERT INTO packet_observations VALUES
  (1, 'hash-private', 'YTR/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/packets', 'YTR',
   'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'DD0236FF', '{}', 7000,
   NULL, NULL, NULL, 0, 'FLOOD', 0, 'TEXT', 0, 4, 0, '', '', 'unresolved', '', 0, '', '', '', 7000);
INSERT INTO live_edge_events VALUES
  (1, 'hash-private', 1, 0, 'TEXT', '', '', '', 7000, '[]', 'test', 7000);
`)
	if err != nil {
		t.Fatal(err)
	}

	report, err := reportFromDB(context.Background(), db, diagnosticFilters{IATA: "YTR", PublicIATAs: "YTR,YGK", Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`filters: region="YTR" iata="YTR"`,
		`public_regions="YTR,YGK"`,
		"DD0236FF",
		"actual_iatas=YTR",
		"public_iata=allowed:YTR",
		"coord_status=missing_coords",
		"map=missing_coords",
		"Corebot",
		"Positioned Observer",
		"actual_iata=YTR",
		"map=mappable source=observer_position_used",
		"recent packet observations (1)",
		"recent routed edge events (1)",
	} {
		if !strings.Contains(report, want) {
			t.Fatalf("report missing %q:\n%s", want, report)
		}
	}
	if strings.Contains(report, "AAAAAAAAAAAAAAAA") || strings.Contains(report, "hash-private") {
		t.Fatalf("report leaked private identifier:\n%s", report)
	}

	nameReport, err := reportFromDB(context.Background(), db, diagnosticFilters{Name: "YTR-Observer", PublicIATAs: "YTR,YGK", Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(nameReport, "actual_iatas=YGK") || !strings.Contains(nameReport, "label_iata_hint=YTR") {
		t.Fatalf("name report should show YTR-named node is actually YGK:\n%s", nameReport)
	}

	labelReport, err := reportFromDB(context.Background(), db, diagnosticFilters{Label: "Positioned", PublicIATAs: "YTR,YGK", Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(labelReport, "Positioned Observer") || !strings.Contains(labelReport, "coord_status=valid") {
		t.Fatalf("label report should support sanitized label lookup:\n%s", labelReport)
	}

	regionReport, err := reportFromDB(context.Background(), db, diagnosticFilters{Region: "ytr", PublicRegions: "ytr,ygk", Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(regionReport, "DD0236FF") || !strings.Contains(regionReport, `public_regions="YTR,YGK"`) {
		t.Fatalf("region aliases should behave like legacy IATA filters:\n%s", regionReport)
	}
}

func openDiagnosticTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file::memory:?cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.Exec(`
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
  observation_count INTEGER NOT NULL DEFAULT 0,
  supports_multibyte TEXT NOT NULL DEFAULT 'unknown'
);
CREATE TABLE node_iatas (
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE observers (
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  last_seen_ms INTEGER NOT NULL,
  packet_count INTEGER NOT NULL DEFAULT 0,
  status_json TEXT NOT NULL DEFAULT ''
);
CREATE TABLE packet_observations (
  id INTEGER PRIMARY KEY,
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
  message_sender TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE live_edge_events (
  id INTEGER PRIMARY KEY,
  packet_hash TEXT NOT NULL,
  observation_id INTEGER NOT NULL,
  payload_type INTEGER NOT NULL,
  payload_type_name TEXT NOT NULL,
  message_sender TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  message_anchor_json TEXT NOT NULL DEFAULT '',
  heard_at_ms INTEGER NOT NULL,
  segments_json TEXT NOT NULL,
  render_reason TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
`)
	if err != nil {
		t.Fatal(err)
	}
	return db
}
