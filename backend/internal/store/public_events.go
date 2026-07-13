package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

type PublicEventStore interface {
	InsertPublicEvent(ctx context.Context, event live.PublicEvent) (live.PublicEvent, error)
	InsertPublicEventsOnce(ctx context.Context, events []live.PublicEvent) ([]live.PublicEvent, []bool, error)
	ListPublicEventsAfter(ctx context.Context, filter PublicEventFilter) ([]live.PublicEvent, int64, error)
	LatestPublicSeq(ctx context.Context) (int64, error)
	PublicSeqBounds(ctx context.Context) (int64, int64, error)
}

type PublicEventFilter struct {
	AfterSeq        int64
	From            int64
	To              int64
	Limit           int
	Region          string
	PayloadTypeName string
	EventType       string
	MessageOnly     bool
}

const publicEventByDedupeKeySQL = `SELECT seq FROM public_events WHERE dedupe_key = ? AND dedupe_key != ''`

func (s *Store) InsertPublicEvent(ctx context.Context, event live.PublicEvent) (live.PublicEvent, error) {
	event, _, err := s.InsertPublicEventOnce(ctx, event)
	return event, err
}

// InsertPublicEventOnce reports whether this call created the durable event.
// A false inserted result means the dedupe key already existed, which lets the
// live publisher suppress a retry instead of rebroadcasting an older sequence.
func (s *Store) InsertPublicEventOnce(ctx context.Context, event live.PublicEvent) (live.PublicEvent, bool, error) {
	events, inserted, err := s.InsertPublicEventsOnce(ctx, []live.PublicEvent{event})
	if err != nil {
		return event, false, err
	}
	return events[0], inserted[0], nil
}

// InsertPublicEventsOnce commits the ordered public activity/pulse set for one
// observation in a single short transaction. Dedupe keys preserve exactly-once
// cursor semantics when a live-core job is retried after an ambiguous commit.
func (s *Store) InsertPublicEventsOnce(ctx context.Context, events []live.PublicEvent) ([]live.PublicEvent, []bool, error) {
	if s == nil || s.db == nil {
		return events, nil, fmt.Errorf("store unavailable")
	}
	if len(events) == 0 {
		return []live.PublicEvent{}, []bool{}, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return events, nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	inserted := make([]bool, len(events))
	for i := range events {
		event, wasInserted, err := insertPublicEventOnceTx(ctx, tx, events[i])
		if err != nil {
			return events, nil, err
		}
		events[i], inserted[i] = event, wasInserted
	}
	if err := tx.Commit(); err != nil {
		return events, nil, err
	}
	committed = true
	return events, inserted, nil
}

func insertPublicEventOnceTx(ctx context.Context, tx *sql.Tx, event live.PublicEvent) (live.PublicEvent, bool, error) {
	now := time.Now().UnixMilli()
	if event.At <= 0 {
		event.At = now
	}
	if event.ReceivedAt <= 0 {
		event.ReceivedAt = now
	}
	event.Type = strings.TrimSpace(event.Type)
	event.Region = strings.ToUpper(strings.TrimSpace(event.Region))
	event.IATA = strings.ToUpper(strings.TrimSpace(event.IATA))
	if event.Region == "" {
		event.Region = event.IATA
	}
	if event.IATA == "" {
		event.IATA = event.Region
	}
	event.PayloadTypeName = strings.ToUpper(strings.TrimSpace(event.PayloadTypeName))
	event.RouteIDs = cleanPublicStringList(event.RouteIDs)
	event.NodeIDs = cleanPublicStringList(event.NodeIDs)

	publicJSON, err := json.Marshal(event.Data)
	if err != nil {
		return event, false, err
	}
	routeIDsJSON, _ := json.Marshal(event.RouteIDs)
	nodeIDsJSON, _ := json.Marshal(event.NodeIDs)
	result, err := tx.ExecContext(ctx, `
INSERT INTO public_events (
  dedupe_key, event_type, occurred_at_ms, received_at_ms, region, iata, payload_type_name,
  message_flag, route_ids_json, node_ids_json, public_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(dedupe_key) WHERE dedupe_key != '' DO NOTHING`,
		event.DedupeKey,
		event.Type,
		event.At,
		event.ReceivedAt,
		event.Region,
		event.IATA,
		event.PayloadTypeName,
		boolInt(event.Message),
		string(routeIDsJSON),
		string(nodeIDsJSON),
		string(publicJSON),
	)
	if err != nil {
		return event, false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return event, false, err
	}
	if affected == 0 && event.DedupeKey != "" {
		if err := tx.QueryRowContext(ctx, publicEventByDedupeKeySQL, event.DedupeKey).Scan(&event.Seq); err != nil {
			return event, false, err
		}
		return event, false, nil
	}
	if seq, err := result.LastInsertId(); err == nil {
		event.Seq = seq
	}
	return event, true, nil
}

func (s *Store) LatestPublicSeq(ctx context.Context) (int64, error) {
	_, latest, err := s.PublicSeqBounds(ctx)
	return latest, err
}

// PublicSeqBounds uses primary-key index seeks instead of aggregating the
// retained event table. This must remain fast even with millions of events.
func (s *Store) PublicSeqBounds(ctx context.Context) (int64, int64, error) {
	if s == nil || s.db == nil {
		return 0, 0, nil
	}
	var oldest sql.NullInt64
	var latest sql.NullInt64
	err := s.reader().QueryRowContext(ctx, `
SELECT
  (SELECT seq FROM public_events ORDER BY seq ASC LIMIT 1),
  (SELECT seq FROM public_events ORDER BY seq DESC LIMIT 1)`).Scan(&oldest, &latest)
	if err != nil {
		return 0, 0, err
	}
	if !oldest.Valid || !latest.Valid {
		return 0, 0, nil
	}
	return oldest.Int64, latest.Int64, nil
}

func (s *Store) ListPublicEventsAfter(ctx context.Context, filter PublicEventFilter) ([]live.PublicEvent, int64, error) {
	if s == nil || s.db == nil {
		return nil, 0, fmt.Errorf("store unavailable")
	}
	limit := filter.Limit
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	sqlText := `
SELECT seq, event_type, occurred_at_ms, received_at_ms, region, iata, payload_type_name,
  message_flag, route_ids_json, node_ids_json, public_json
FROM public_events
WHERE seq > ?`
	args := []any{filter.AfterSeq}
	if filter.From > 0 {
		sqlText += ` AND occurred_at_ms >= ?`
		args = append(args, filter.From)
	}
	if filter.To > 0 {
		sqlText += ` AND occurred_at_ms <= ?`
		args = append(args, filter.To)
	}
	if region := strings.ToUpper(strings.TrimSpace(filter.Region)); region != "" {
		sqlText += ` AND region = ?`
		args = append(args, region)
	}
	if payload := strings.ToUpper(strings.TrimSpace(filter.PayloadTypeName)); payload != "" {
		sqlText += ` AND payload_type_name = ?`
		args = append(args, payload)
	}
	if eventType := strings.TrimSpace(filter.EventType); eventType != "" {
		sqlText += ` AND event_type = ?`
		args = append(args, eventType)
	}
	if filter.MessageOnly {
		sqlText += ` AND message_flag = 1`
	}
	sqlText += `
ORDER BY seq ASC
LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.reader().QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	events := []live.PublicEvent{}
	var nextCursor int64
	for rows.Next() {
		event, err := scanPublicEvent(rows)
		if err != nil {
			return nil, 0, err
		}
		if len(events) >= limit {
			if len(events) > 0 {
				nextCursor = events[len(events)-1].Seq
			}
			break
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return events, nextCursor, nil
}

func scanPublicEvent(rows *sql.Rows) (live.PublicEvent, error) {
	var event live.PublicEvent
	var messageFlag int
	var routeIDsJSON string
	var nodeIDsJSON string
	var publicJSON string
	if err := rows.Scan(
		&event.Seq,
		&event.Type,
		&event.At,
		&event.ReceivedAt,
		&event.Region,
		&event.IATA,
		&event.PayloadTypeName,
		&messageFlag,
		&routeIDsJSON,
		&nodeIDsJSON,
		&publicJSON,
	); err != nil {
		return live.PublicEvent{}, err
	}
	event.Message = messageFlag == 1
	_ = json.Unmarshal([]byte(routeIDsJSON), &event.RouteIDs)
	_ = json.Unmarshal([]byte(nodeIDsJSON), &event.NodeIDs)
	event.Data = json.RawMessage(publicJSON)
	return event, nil
}

func cleanPublicStringList(items []string) []string {
	out := make([]string, 0, len(items))
	seen := map[string]struct{}{}
	for _, item := range items {
		item = live.PublicDisplayText(item, 96)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}
