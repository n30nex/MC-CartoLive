package store

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"meshcore-canada-live-map/backend/internal/live"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

type Store struct {
	db               *sql.DB
	path             string
	coordinatePolicy live.CoordinatePolicy
}

func Open(ctx context.Context, path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		return nil, err
	}
	maxOpenConns := sqliteEnvInt("SQLITE_MAX_OPEN_CONNS", 1)
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxOpenConns)
	s := &Store{db: db, path: path, coordinatePolicy: live.CurrentCoordinatePolicy()}
	if err := s.Migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func OpenMemory(ctx context.Context) (*Store, error) {
	db, err := sql.Open("sqlite", sqliteDSN("file::memory:?cache=shared"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, path: "file::memory:?cache=shared", coordinatePolicy: live.CurrentCoordinatePolicy()}
	if err := s.Migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Migrate(ctx context.Context) error {
	if err := s.ensureBaseTables(ctx); err != nil {
		return err
	}
	if err := s.migrateColumns(ctx); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("migrate sqlite: %w", err)
	}
	return nil
}

func (s *Store) ensureBaseTables(ctx context.Context) error {
	for _, stmt := range sqliteStatements(schemaSQL) {
		normalized := strings.ToUpper(strings.TrimSpace(stmt))
		if !strings.HasPrefix(normalized, "CREATE TABLE IF NOT EXISTS ") && !strings.HasPrefix(normalized, "PRAGMA ") {
			continue
		}
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrate sqlite base tables: %w", err)
		}
	}
	return nil
}

type columnMigration struct {
	table    string
	column   string
	alterSQL string
}

func (s *Store) migrateColumns(ctx context.Context) error {
	migrations := []columnMigration{
		{table: "nodes", column: "supports_multibyte", alterSQL: `ALTER TABLE nodes ADD COLUMN supports_multibyte TEXT NOT NULL DEFAULT 'unknown'`},
		{table: "packet_observations", column: "message_sender", alterSQL: `ALTER TABLE packet_observations ADD COLUMN message_sender TEXT NOT NULL DEFAULT ''`},
		{table: "packet_observations", column: "message_text", alterSQL: `ALTER TABLE packet_observations ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`},
		{table: "live_edge_events", column: "message_sender", alterSQL: `ALTER TABLE live_edge_events ADD COLUMN message_sender TEXT NOT NULL DEFAULT ''`},
		{table: "live_edge_events", column: "message_text", alterSQL: `ALTER TABLE live_edge_events ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`},
		{table: "live_edge_events", column: "message_anchor_json", alterSQL: `ALTER TABLE live_edge_events ADD COLUMN message_anchor_json TEXT NOT NULL DEFAULT ''`},
		{table: "public_packet_paths", column: "mappable", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN mappable INTEGER NOT NULL DEFAULT 1`},
		{table: "public_packet_paths", column: "region", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN region TEXT NOT NULL DEFAULT ''`},
		{table: "public_packet_paths", column: "payload_type_name", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN payload_type_name TEXT NOT NULL DEFAULT ''`},
		{table: "public_packet_paths", column: "message_sender", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN message_sender TEXT NOT NULL DEFAULT ''`},
		{table: "public_packet_paths", column: "message_text", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`},
		{table: "public_packet_paths", column: "hop_count", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN hop_count INTEGER NOT NULL DEFAULT 0`},
		{table: "public_packet_paths", column: "segment_count", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN segment_count INTEGER NOT NULL DEFAULT 0`},
		{table: "public_packet_paths", column: "distance_km", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN distance_km REAL NOT NULL DEFAULT 0`},
		{table: "public_packet_paths", column: "route_ids_json", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN route_ids_json TEXT NOT NULL DEFAULT '[]'`},
		{table: "public_packet_paths", column: "endpoint_labels_json", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN endpoint_labels_json TEXT NOT NULL DEFAULT '[]'`},
		{table: "public_packet_paths", column: "segments_json", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN segments_json TEXT NOT NULL DEFAULT '[]'`},
		{table: "public_packet_paths", column: "search_text", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN search_text TEXT NOT NULL DEFAULT ''`},
	}
	for _, migration := range migrations {
		if err := s.addColumnIfMissing(ctx, migration); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) addColumnIfMissing(ctx context.Context, migration columnMigration) error {
	tableIdent, err := sqliteIdent(migration.table)
	if err != nil {
		return err
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(`+tableIdent+`)`)
	if err != nil {
		return fmt.Errorf("inspect sqlite table %s: %w", migration.table, err)
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
			return fmt.Errorf("inspect sqlite column %s.%s: %w", migration.table, migration.column, err)
		}
		if strings.EqualFold(name, migration.column) {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect sqlite table %s: %w", migration.table, err)
	}
	if _, err := s.db.ExecContext(ctx, migration.alterSQL); err != nil {
		return fmt.Errorf("migrate sqlite column %s.%s: %w", migration.table, migration.column, err)
	}
	return nil
}

func sqliteIdent(name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("empty sqlite identifier")
	}
	for _, r := range name {
		if r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		return "", fmt.Errorf("unsafe sqlite identifier %q", name)
	}
	return `"` + name + `"`, nil
}

func sqliteStatements(sqlText string) []string {
	parts := strings.Split(sqlText, ";")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		stmt := strings.TrimSpace(part)
		if stmt == "" {
			continue
		}
		out = append(out, stmt)
	}
	return out
}

func sqliteDSN(path string) string {
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	cacheKB := sqliteEnvInt("SQLITE_CACHE_SIZE_KB", 16000)
	mmapSizeBytes := sqliteEnvInt("SQLITE_MMAP_SIZE_BYTES", 67108864)
	return path + sep + strings.Join([]string{
		"_pragma=busy_timeout%3d5000",
		"_pragma=foreign_keys%3dON",
		"_pragma=journal_mode%3dWAL",
		"_pragma=synchronous%3dNORMAL",
		"_pragma=cache_size%3d-" + strconv.Itoa(cacheKB),
		"_pragma=temp_store%3dMEMORY",
		"_pragma=mmap_size%3d" + strconv.Itoa(mmapSizeBytes),
	}, "&")
}

func sqliteEnvInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) SetCoordinatePolicy(policy live.CoordinatePolicy) {
	if s == nil {
		return
	}
	s.coordinatePolicy = live.NewCoordinatePolicy(policy.Bounds)
}

func (s *Store) coordPolicy() live.CoordinatePolicy {
	if s == nil {
		return live.CurrentCoordinatePolicy()
	}
	return live.NewCoordinatePolicy(s.coordinatePolicy.Bounds)
}

func (s *Store) Ping(ctx context.Context) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("store unavailable")
	}
	return s.db.PingContext(ctx)
}

func (s *Store) VacuumAndAnalyze(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "ANALYZE"); err != nil {
		return fmt.Errorf("analyze: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, "VACUUM"); err != nil {
		return fmt.Errorf("vacuum: %w", err)
	}
	return nil
}

type RuntimeInfo struct {
	Path         string `json:"path"`
	JournalMode  string `json:"journalMode"`
	BusyTimeout  int    `json:"busyTimeoutMs"`
	MaxOpenConns int    `json:"maxOpenConns"`
	OpenConns    int    `json:"openConns"`
	InUse        int    `json:"inUse"`
	Idle         int    `json:"idle"`
}

func (s *Store) RuntimeInfo(ctx context.Context) RuntimeInfo {
	if s == nil || s.db == nil {
		return RuntimeInfo{}
	}
	info := RuntimeInfo{Path: s.path}
	_ = s.db.QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&info.JournalMode)
	_ = s.db.QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&info.BusyTimeout)
	stats := s.db.Stats()
	info.MaxOpenConns = stats.MaxOpenConnections
	info.OpenConns = stats.OpenConnections
	info.InUse = stats.InUse
	info.Idle = stats.Idle
	return info
}

func nullableFloat(v *float64) sql.NullFloat64 {
	if v == nil {
		return sql.NullFloat64{}
	}
	return sql.NullFloat64{Float64: *v, Valid: true}
}

func floatPtr(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	out := v.Float64
	return &out
}
