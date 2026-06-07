package store

import (
	"context"
)

func (s *Store) PruneOldData(ctx context.Context, beforeMs int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	if _, err := tx.ExecContext(ctx, `DELETE FROM public_packet_paths WHERE heard_at_ms < ?`, beforeMs); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM live_edge_events WHERE heard_at_ms < ?`, beforeMs); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM packet_observations WHERE heard_at_ms < ?`, beforeMs); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM observer_status WHERE received_at_ms < ?`, beforeMs); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM packets WHERE packet_hash NOT IN (SELECT DISTINCT packet_hash FROM packet_observations)`); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}
