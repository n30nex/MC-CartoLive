package store

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
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
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
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
	if _, err := s.db.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("migrate sqlite: %w", err)
	}
	for _, stmt := range []string{
		`ALTER TABLE packet_observations ADD COLUMN message_sender TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE packet_observations ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE live_edge_events ADD COLUMN message_sender TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE live_edge_events ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE live_edge_events ADD COLUMN message_anchor_json TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return fmt.Errorf("migrate sqlite column: %w", err)
		}
	}
	return nil
}

func sqliteDSN(path string) string {
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	return path + sep + strings.Join([]string{
		"_pragma=busy_timeout%3d5000",
		"_pragma=foreign_keys%3dON",
		"_pragma=journal_mode%3dWAL",
		"_pragma=synchronous%3dNORMAL",
		"_pragma=cache_size%3d-64000",
		"_pragma=temp_store%3dMEMORY",
		"_pragma=mmap_size%3d268435456",
	}, "&")
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
