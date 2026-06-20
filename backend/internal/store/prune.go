package store

import (
	"context"
	"fmt"
)

func (s *Store) PruneOldData(ctx context.Context, beforeMs int64) error {
	tables := []struct{ name, column string }{
		{"propagation_events", "at_ms"},
		{"public_packet_paths", "heard_at_ms"},
		{"public_route_summary_edges", "heard_at_ms"},
		{"public_events", "occurred_at_ms"},
		{"public_coverage_cells", "updated_at_ms"},
		{"live_edge_events", "heard_at_ms"},
		{"packet_observations", "heard_at_ms"},
		{"observer_status", "received_at_ms"},
		{"solar_snapshots", "fetched_at_ms"},
		{"propagation_weather_snapshots", "fetched_at_ms"},
	}
	for _, t := range tables {
		for {
			result, err := s.db.ExecContext(ctx,
				fmt.Sprintf("DELETE FROM %s WHERE rowid IN (SELECT rowid FROM %s WHERE %s < ? LIMIT 1000)", t.name, t.name, t.column),
				beforeMs)
			if err != nil {
				return fmt.Errorf("prune %s: %w", t.name, err)
			}
			affected, _ := result.RowsAffected()
			if affected == 0 {
				break
			}
		}
	}
	for {
		result, err := s.db.ExecContext(ctx,
			"DELETE FROM packets WHERE rowid IN (SELECT rowid FROM packets WHERE packet_hash NOT IN (SELECT DISTINCT packet_hash FROM packet_observations) LIMIT 1000)")
		if err != nil {
			return fmt.Errorf("prune packets: %w", err)
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			break
		}
	}
	return nil
}

func (s *Store) PrunePropagationData(ctx context.Context, beforeMs int64) error {
	for _, t := range []struct{ name, column string }{
		{"propagation_events", "at_ms"},
		{"propagation_weather_snapshots", "fetched_at_ms"},
	} {
		for {
			result, err := s.db.ExecContext(ctx,
				fmt.Sprintf("DELETE FROM %s WHERE rowid IN (SELECT rowid FROM %s WHERE %s < ? LIMIT 1000)", t.name, t.name, t.column),
				beforeMs)
			if err != nil {
				return fmt.Errorf("prune %s: %w", t.name, err)
			}
			affected, _ := result.RowsAffected()
			if affected == 0 {
				break
			}
		}
	}
	return nil
}
