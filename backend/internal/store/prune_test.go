package store

import (
	"context"
	"testing"
)

func TestRetentionPrunerStepsAreBoundedAndPrioritizePublicEvents(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	oldRows := pruneBatchSize + 1
	if _, err := st.db.ExecContext(ctx, `
WITH RECURSIVE numbers(n) AS (
  VALUES(1)
  UNION ALL
  SELECT n + 1 FROM numbers WHERE n < ?
)
INSERT INTO public_events (
  dedupe_key, event_type, occurred_at_ms, received_at_ms, region, iata,
  payload_type_name, message_flag, route_ids_json, node_ids_json, public_json
)
SELECT '', 'activity', 100, 100, 'YYZ', 'YYZ', 'TXT', 0, '[]', '[]', '{}'
FROM numbers`, oldRows); err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.ExecContext(ctx, `
INSERT INTO public_events (
  dedupe_key, event_type, occurred_at_ms, received_at_ms, region, iata,
  payload_type_name, message_flag, route_ids_json, node_ids_json, public_json
) VALUES ('recent', 'activity', 2000, 2000, 'YYZ', 'YYZ', 'TXT', 0, '[]', '[]', '{}')`); err != nil {
		t.Fatal(err)
	}

	pruner := st.NewRetentionPruner(RetentionCutoffs{
		DataBeforeMs:        1000,
		PublicEventBeforeMs: 1000,
		PropagationBeforeMs: 1000,
	})
	first, err := pruner.Step(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if first.Target != "public_events" || first.RowsDeleted != pruneBatchSize || first.Done {
		t.Fatalf("first prune step=%+v, want bounded full public_events batch", first)
	}
	second, err := pruner.Step(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if second.Target != "public_events" || second.RowsDeleted != 1 || second.Done {
		t.Fatalf("second prune step=%+v, want final one-row public_events batch", second)
	}

	var oldRemaining, recentRemaining int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM public_events WHERE occurred_at_ms < 1000`).Scan(&oldRemaining); err != nil {
		t.Fatal(err)
	}
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM public_events WHERE dedupe_key = 'recent'`).Scan(&recentRemaining); err != nil {
		t.Fatal(err)
	}
	if oldRemaining != 0 || recentRemaining != 1 {
		t.Fatalf("retained public events old=%d recent=%d, want 0/1", oldRemaining, recentRemaining)
	}

	done := false
	for stepNumber := 0; stepNumber < 20 && !done; stepNumber++ {
		step, err := pruner.Step(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if step.RowsDeleted > pruneBatchSize {
			t.Fatalf("step %d deleted %d rows, batch limit=%d", stepNumber, step.RowsDeleted, pruneBatchSize)
		}
		done = step.Done
	}
	if !done {
		t.Fatal("retention pruner did not finish its finite target list")
	}
}

func TestRetentionPrunerSkipsObservationsStillReferencedByRecentPublicData(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	if _, err := st.db.ExecContext(ctx, `
INSERT INTO packets (
  packet_hash, raw_hex, route_type, route_type_name, payload_type,
  payload_type_name, payload_version, hash_size, hop_count, path_hex,
  payload_hex, first_seen_ms, last_seen_ms
) VALUES ('packet-retained', '00', 0, '', 0, '', 0, 1, 0, '', '', 100, 2000);
INSERT INTO packet_observations (
  id, packet_hash, topic, iata, observer_public_key, heard_at_ms,
  route_type, route_type_name, payload_type, payload_type_name,
  payload_version, hash_size, hop_count, path_hex, payload_hex, created_at_ms
) VALUES (1, 'packet-retained', 'topic', 'YYZ', 'observer', 100, 0, '', 0, '', 0, 1, 0, '', '', 100);
INSERT INTO live_edge_events (
  id, packet_hash, observation_id, payload_type, payload_type_name,
  heard_at_ms, segments_json, render_reason, created_at_ms
) VALUES (1, 'packet-retained', 1, 0, '', 2000, '[]', 'retained', 2000);
INSERT INTO public_packet_paths (edge_id, observation_id, heard_at_ms, created_at_ms)
VALUES (1, 1, 2000, 2000);`); err != nil {
		t.Fatal(err)
	}

	pruner := st.NewRetentionPruner(RetentionCutoffs{DataBeforeMs: 1000, PublicEventBeforeMs: 1000, PropagationBeforeMs: 1000})
	for step := 0; step < 20; step++ {
		result, err := pruner.Step(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if result.Done {
			break
		}
	}
	var remaining int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM packet_observations WHERE id=1`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 1 {
		t.Fatalf("referenced observation rows=%d, want 1", remaining)
	}

	if _, err := st.db.ExecContext(ctx, `DELETE FROM public_packet_paths; DELETE FROM live_edge_events;`); err != nil {
		t.Fatal(err)
	}
	pruner = st.NewRetentionPruner(RetentionCutoffs{DataBeforeMs: 1000, PublicEventBeforeMs: 1000, PropagationBeforeMs: 1000})
	for step := 0; step < 20; step++ {
		result, err := pruner.Step(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if result.Done {
			break
		}
	}
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM packet_observations WHERE id=1`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("unreferenced expired observation rows=%d, want 0", remaining)
	}
}
