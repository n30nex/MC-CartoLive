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
	ListPublicEventsAfter(ctx context.Context, filter PublicEventFilter) ([]live.PublicEvent, int64, error)
	LatestPublicSeq(ctx context.Context) (int64, error)
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

func (s *Store) InsertPublicEvent(ctx context.Context, event live.PublicEvent) (live.PublicEvent, error) {
	if s == nil || s.db == nil {
		return event, fmt.Errorf("store unavailable")
	}
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
		return event, err
	}
	routeIDsJSON, _ := json.Marshal(event.RouteIDs)
	nodeIDsJSON, _ := json.Marshal(event.NodeIDs)
	result, err := s.db.ExecContext(ctx, `
INSERT INTO public_events (
  event_type, occurred_at_ms, received_at_ms, region, iata, payload_type_name,
  message_flag, route_ids_json, node_ids_json, public_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
		return event, err
	}
	if seq, err := result.LastInsertId(); err == nil {
		event.Seq = seq
	}
	return event, nil
}

func (s *Store) LatestPublicSeq(ctx context.Context) (int64, error) {
	if s == nil || s.db == nil {
		return 0, nil
	}
	var seq sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `SELECT MAX(seq) FROM public_events`).Scan(&seq); err != nil {
		return 0, err
	}
	if !seq.Valid {
		return 0, nil
	}
	return seq.Int64, nil
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

	rows, err := s.db.QueryContext(ctx, sqlText, args...)
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
