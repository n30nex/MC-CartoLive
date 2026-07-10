package store

import (
	"context"
	"fmt"
	"time"
)

const (
	pruneBatchSize  = 500
	pruneBatchPause = 25 * time.Millisecond
)

func (s *Store) PruneOldData(ctx context.Context, beforeMs int64) error {
	tables := []struct{ name, column string }{
		{"propagation_events", "at_ms"},
		{"public_packet_paths", "heard_at_ms"},
		{"public_route_summary_edges", "heard_at_ms"},
		{"public_coverage_cells", "updated_at_ms"},
		{"live_edge_events", "heard_at_ms"},
		{"packet_observations", "heard_at_ms"},
		{"observer_status", "received_at_ms"},
		{"solar_snapshots", "fetched_at_ms"},
		{"propagation_weather_snapshots", "fetched_at_ms"},
	}
	for _, t := range tables {
		if err := s.pruneTableBefore(ctx, t.name, t.column, beforeMs); err != nil {
			return err
		}
	}
	for {
		result, err := s.db.ExecContext(ctx,
			fmt.Sprintf(`DELETE FROM packets
WHERE rowid IN (
  SELECT p.rowid
  FROM packets p
  WHERE NOT EXISTS (
    SELECT 1 FROM packet_observations po WHERE po.packet_hash = p.packet_hash
  )
  LIMIT %d
)`, pruneBatchSize))
		if err != nil {
			return fmt.Errorf("prune packets: %w", err)
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			break
		}
		if err := pausePruneBatch(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) PrunePublicEvents(ctx context.Context, beforeMs int64) error {
	return s.pruneTableBefore(ctx, "public_events", "occurred_at_ms", beforeMs)
}

func (s *Store) PrunePropagationData(ctx context.Context, beforeMs int64) error {
	for _, t := range []struct{ name, column string }{
		{"propagation_events", "at_ms"},
		{"propagation_weather_snapshots", "fetched_at_ms"},
	} {
		if err := s.pruneTableBefore(ctx, t.name, t.column, beforeMs); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) pruneTableBefore(ctx context.Context, table string, column string, beforeMs int64) error {
	for {
		result, err := s.db.ExecContext(ctx,
			fmt.Sprintf("DELETE FROM %s WHERE rowid IN (SELECT rowid FROM %s WHERE %s < ? LIMIT %d)", table, table, column, pruneBatchSize),
			beforeMs)
		if err != nil {
			return fmt.Errorf("prune %s: %w", table, err)
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			break
		}
		if err := pausePruneBatch(ctx); err != nil {
			return err
		}
	}
	return nil
}

func pausePruneBatch(ctx context.Context) error {
	timer := time.NewTimer(pruneBatchPause)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
