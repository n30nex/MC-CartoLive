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
	"time"

	"meshcore-canada-live-map/backend/internal/live"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

const SchemaVersion = 32000

type Store struct {
	db               *sql.DB
	readDB           *sql.DB
	path             string
	coordinatePolicy live.CoordinatePolicy
	migrationHook    func(string) error
}

func Open(ctx context.Context, path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	fresh := true
	if info, err := os.Stat(path); err == nil && info.Size() > 0 {
		fresh = false
	}
	db, err := sql.Open("sqlite", sqliteDSNForOpen(path, fresh))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	s := &Store{db: db, path: path, coordinatePolicy: live.CurrentCoordinatePolicy()}
	if fresh {
		if _, err := db.ExecContext(ctx, `PRAGMA auto_vacuum=INCREMENTAL`); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("enable incremental auto vacuum: %w", err)
		}
	}
	if err := s.Migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	readDB, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	readConns := sqliteEnvInt("SQLITE_READ_OPEN_CONNS", sqliteEnvInt("SQLITE_MAX_OPEN_CONNS", 2))
	readDB.SetMaxOpenConns(readConns)
	readDB.SetMaxIdleConns(readConns)
	if err := readDB.PingContext(ctx); err != nil {
		_ = readDB.Close()
		_ = db.Close()
		return nil, fmt.Errorf("open sqlite read pool: %w", err)
	}
	s.readDB = readDB
	_ = s.Optimize(ctx, true)
	return s, nil
}

func OpenMemory(ctx context.Context) (*Store, error) {
	db, err := sql.Open("sqlite", sqliteDSN("file::memory:?cache=shared"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, path: "file::memory:?cache=shared", coordinatePolicy: live.CurrentCoordinatePolicy()}
	s.readDB = db
	if _, err := db.ExecContext(ctx, `PRAGMA auto_vacuum=INCREMENTAL`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.Migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Migrate(ctx context.Context) error {
	var current int
	if err := s.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&current); err != nil {
		return fmt.Errorf("read sqlite schema version: %w", err)
	}
	if current > SchemaVersion {
		return fmt.Errorf("sqlite schema version %d is newer than supported version %d", current, SchemaVersion)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin sqlite migration: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	if err := s.ensureBaseTables(ctx, tx); err != nil {
		return err
	}
	if err := s.migrateColumns(ctx, tx); err != nil {
		return err
	}
	if s.migrationHook != nil {
		if err := s.migrationHook("after_columns"); err != nil {
			return fmt.Errorf("sqlite migration hook after_columns: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("migrate sqlite: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (?, ?)`, SchemaVersion, time.Now().UnixMilli()); err != nil {
		return fmt.Errorf("record sqlite schema migration: %w", err)
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version=%d`, SchemaVersion)); err != nil {
		return fmt.Errorf("set sqlite schema version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit sqlite schema version: %w", err)
	}
	committed = true
	return nil
}

func (s *Store) ensureBaseTables(ctx context.Context, tx *sql.Tx) error {
	for _, stmt := range sqliteStatements(schemaSQL) {
		normalized := strings.ToUpper(strings.TrimSpace(stmt))
		if !strings.HasPrefix(normalized, "CREATE TABLE IF NOT EXISTS ") && !strings.HasPrefix(normalized, "PRAGMA ") {
			continue
		}
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
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

func (s *Store) migrateColumns(ctx context.Context, tx *sql.Tx) error {
	migrations := []columnMigration{
		{table: "nodes", column: "supports_multibyte", alterSQL: `ALTER TABLE nodes ADD COLUMN supports_multibyte TEXT NOT NULL DEFAULT 'unknown'`},
		{table: "packet_observations", column: "ingest_id", alterSQL: `ALTER TABLE packet_observations ADD COLUMN ingest_id TEXT NOT NULL DEFAULT ''`},
		{table: "packet_observations", column: "message_sender", alterSQL: `ALTER TABLE packet_observations ADD COLUMN message_sender TEXT NOT NULL DEFAULT ''`},
		{table: "packet_observations", column: "message_text", alterSQL: `ALTER TABLE packet_observations ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`},
		{table: "live_edge_events", column: "message_sender", alterSQL: `ALTER TABLE live_edge_events ADD COLUMN message_sender TEXT NOT NULL DEFAULT ''`},
		{table: "live_edge_events", column: "ingest_id", alterSQL: `ALTER TABLE live_edge_events ADD COLUMN ingest_id TEXT NOT NULL DEFAULT ''`},
		{table: "live_edge_events", column: "message_text", alterSQL: `ALTER TABLE live_edge_events ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`},
		{table: "live_edge_events", column: "message_anchor_json", alterSQL: `ALTER TABLE live_edge_events ADD COLUMN message_anchor_json TEXT NOT NULL DEFAULT ''`},
		{table: "public_packet_paths", column: "mappable", alterSQL: `ALTER TABLE public_packet_paths ADD COLUMN mappable INTEGER NOT NULL DEFAULT 1`},
		{table: "public_events", column: "dedupe_key", alterSQL: `ALTER TABLE public_events ADD COLUMN dedupe_key TEXT NOT NULL DEFAULT ''`},
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
		if err := s.addColumnIfMissing(ctx, tx, migration); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) addColumnIfMissing(ctx context.Context, tx *sql.Tx, migration columnMigration) error {
	tableIdent, err := sqliteIdent(migration.table)
	if err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(`+tableIdent+`)`)
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
	if _, err := tx.ExecContext(ctx, migration.alterSQL); err != nil {
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
	return sqliteDSNForOpen(path, false)
}

func sqliteDSNForOpen(path string, fresh bool) string {
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	busyTimeoutMs := sqliteEnvInt("SQLITE_BUSY_TIMEOUT_MS", 750)
	cacheKB := sqliteEnvInt("SQLITE_CACHE_SIZE_KB", 16000)
	mmapSizeBytes := sqliteEnvInt("SQLITE_MMAP_SIZE_BYTES", 67108864)
	pragmas := []string{}
	if fresh {
		pragmas = append(pragmas, "_pragma=auto_vacuum%3dINCREMENTAL")
	}
	pragmas = append(pragmas,
		"_pragma=busy_timeout%3d"+strconv.Itoa(busyTimeoutMs),
		"_pragma=foreign_keys%3dON",
		"_pragma=journal_mode%3dWAL",
		"_pragma=synchronous%3dNORMAL",
		"_pragma=cache_size%3d-"+strconv.Itoa(cacheKB),
		"_pragma=temp_store%3dMEMORY",
		"_pragma=mmap_size%3d"+strconv.Itoa(mmapSizeBytes),
	)
	return path + sep + strings.Join(pragmas, "&")
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
	if s == nil {
		return nil
	}
	var readErr error
	if s.readDB != nil && s.readDB != s.db {
		readErr = s.readDB.Close()
	}
	writeErr := s.db.Close()
	if writeErr != nil {
		return writeErr
	}
	return readErr
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

func (s *Store) Analyze(ctx context.Context) error {
	return s.Optimize(ctx, false)
}

func (s *Store) Optimize(ctx context.Context, initial bool) error {
	pragma := `PRAGMA optimize`
	if initial {
		pragma = `PRAGMA optimize=0x10002`
	}
	if _, err := s.db.ExecContext(ctx, pragma); err != nil {
		return fmt.Errorf("optimize: %w", err)
	}
	return nil
}

func (s *Store) IncrementalVacuum(ctx context.Context, pages int) error {
	if pages <= 0 {
		pages = 256
	}
	if _, err := s.db.ExecContext(ctx, fmt.Sprintf(`PRAGMA incremental_vacuum(%d)`, pages)); err != nil {
		return fmt.Errorf("incremental vacuum: %w", err)
	}
	return nil
}

func (s *Store) reader() *sql.DB {
	if s != nil && s.readDB != nil {
		return s.readDB
	}
	if s == nil {
		return nil
	}
	return s.db
}

func (s *Store) Vacuum(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "VACUUM"); err != nil {
		return fmt.Errorf("vacuum: %w", err)
	}
	return nil
}

type RuntimeInfo struct {
	Path             string `json:"path"`
	JournalMode      string `json:"journalMode"`
	BusyTimeout      int    `json:"busyTimeoutMs"`
	MaxOpenConns     int    `json:"maxOpenConns"`
	OpenConns        int    `json:"openConns"`
	InUse            int    `json:"inUse"`
	Idle             int    `json:"idle"`
	ReadMaxOpenConns int    `json:"readMaxOpenConns"`
	ReadOpenConns    int    `json:"readOpenConns"`
	ReadInUse        int    `json:"readInUse"`
	ReadIdle         int    `json:"readIdle"`
}

type StorageInfo struct {
	TotalBytes    uint64  `json:"totalBytes"`
	FreeBytes     uint64  `json:"freeBytes"`
	FreePercent   float64 `json:"freePercent"`
	PressureState string  `json:"pressureState"`
}

func (s *Store) StorageInfo() StorageInfo {
	if s == nil || strings.HasPrefix(s.path, "file:") || s.path == "" {
		return StorageInfo{PressureState: "ok"}
	}
	info, err := filesystemSpace(filepath.Dir(s.path))
	if err != nil || info.TotalBytes == 0 {
		return StorageInfo{PressureState: "ok"}
	}
	info.FreePercent = float64(info.FreeBytes) * 100 / float64(info.TotalBytes)
	info.PressureState = storagePressureState(info.FreePercent)
	return info
}

func storagePressureState(freePercent float64) string {
	if freePercent <= 10 {
		return "critical"
	}
	if freePercent <= 20 {
		return "warn"
	}
	return "ok"
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
	if s.readDB != nil {
		readStats := s.readDB.Stats()
		info.ReadMaxOpenConns = readStats.MaxOpenConnections
		info.ReadOpenConns = readStats.OpenConnections
		info.ReadInUse = readStats.InUse
		info.ReadIdle = readStats.Idle
	}
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
