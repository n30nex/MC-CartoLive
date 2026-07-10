package store

import (
	"context"
	"fmt"
	"time"
)

const (
	pruneBatchSize  = 500
	pruneBatchPause = 25 * time.Millisecond
	pruneMaxBatches = 200
)

// RetentionCutoffs keeps the independently locked observation, public-event,
// and propagation windows explicit for the incremental production pruner.
type RetentionCutoffs struct {
	DataBeforeMs        int64
	PublicEventBeforeMs int64
	PropagationBeforeMs int64
}

type RetentionPruneStep struct {
	Target      string
	RowsDeleted int64
	Done        bool
}

type retentionPruneTarget struct {
	table     string
	column    string
	beforeMs  int64
	orphanSQL string
}

// RetentionPruner performs exactly one bounded DELETE statement per Step. The
// application owns pacing, the wall-clock/row budget, and ingest-pressure
// checks, which means pressure is re-evaluated between every SQLite batch.
type RetentionPruner struct {
	store   *Store
	targets []retentionPruneTarget
	next    int
}

func (s *Store) NewRetentionPruner(cutoffs RetentionCutoffs) *RetentionPruner {
	propagationBeforeMs := cutoffs.PropagationBeforeMs
	if propagationBeforeMs <= 0 {
		propagationBeforeMs = cutoffs.DataBeforeMs
	}
	return &RetentionPruner{store: s, targets: []retentionPruneTarget{
		// Public events have the shortest retention window and are intentionally
		// first when storage pressure requires rapid reclamation.
		{table: "public_events", column: "occurred_at_ms", beforeMs: cutoffs.PublicEventBeforeMs},
		{table: "propagation_events", column: "at_ms", beforeMs: propagationBeforeMs},
		{table: "public_packet_paths", column: "heard_at_ms", beforeMs: cutoffs.DataBeforeMs},
		{table: "public_route_summary_edges", column: "heard_at_ms", beforeMs: cutoffs.DataBeforeMs},
		{table: "public_route_summaries", column: "last_heard_ms", beforeMs: cutoffs.DataBeforeMs},
		{table: "public_coverage_cells", column: "updated_at_ms", beforeMs: cutoffs.DataBeforeMs},
		{table: "live_edge_events", column: "heard_at_ms", beforeMs: cutoffs.DataBeforeMs},
		{table: "packet_observations", column: "heard_at_ms", beforeMs: cutoffs.DataBeforeMs},
		{table: "observer_status", column: "received_at_ms", beforeMs: cutoffs.DataBeforeMs},
		{table: "solar_snapshots", column: "fetched_at_ms", beforeMs: cutoffs.DataBeforeMs},
		{table: "propagation_weather_snapshots", column: "fetched_at_ms", beforeMs: propagationBeforeMs},
		{table: "packets", orphanSQL: `DELETE FROM packets
WHERE rowid IN (
  SELECT p.rowid
  FROM packets p
  WHERE NOT EXISTS (
    SELECT 1 FROM packet_observations po WHERE po.packet_hash = p.packet_hash
  )
  LIMIT %d
)`},
	}}
}

func (p *RetentionPruner) Step(ctx context.Context) (RetentionPruneStep, error) {
	if p == nil || p.store == nil || p.store.db == nil {
		return RetentionPruneStep{}, fmt.Errorf("retention pruner: store unavailable")
	}
	if p.next >= len(p.targets) {
		return RetentionPruneStep{Done: true}, nil
	}
	target := p.targets[p.next]
	var (
		result interface {
			RowsAffected() (int64, error)
		}
		err error
	)
	if target.orphanSQL != "" {
		result, err = p.store.db.ExecContext(ctx, fmt.Sprintf(target.orphanSQL, pruneBatchSize))
	} else {
		result, err = p.store.db.ExecContext(ctx,
			fmt.Sprintf("DELETE FROM %s WHERE rowid IN (SELECT rowid FROM %s WHERE %s < ? LIMIT %d)", target.table, target.table, target.column, pruneBatchSize),
			target.beforeMs)
	}
	if err != nil {
		return RetentionPruneStep{}, fmt.Errorf("prune %s: %w", target.table, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return RetentionPruneStep{}, fmt.Errorf("prune %s rows affected: %w", target.table, err)
	}
	// A short batch exhausts this target. An exactly full batch keeps the same
	// target selected for the next pressure-checked step.
	if affected < pruneBatchSize {
		p.next++
	}
	return RetentionPruneStep{
		Target:      target.table,
		RowsDeleted: affected,
		Done:        p.next >= len(p.targets),
	}, nil
}

func (s *Store) PruneOldData(ctx context.Context, beforeMs int64) error {
	tables := []struct{ name, column string }{
		{"propagation_events", "at_ms"},
		{"public_packet_paths", "heard_at_ms"},
		{"public_route_summary_edges", "heard_at_ms"},
		{"public_route_summaries", "last_heard_ms"},
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
	for batch := 0; batch < pruneMaxBatches; batch++ {
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
	for batch := 0; batch < pruneMaxBatches; batch++ {
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
