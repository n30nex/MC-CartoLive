package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

type HistoryCursor struct {
	At        int64 `json:"at"`
	TypeOrder int   `json:"typeOrder"`
	ID        int64 `json:"id"`
}

type HistoryEvent struct {
	Type      string
	At        int64
	TypeOrder int
	ID        int64
	Packet    *live.PacketObservation
	Edge      *live.EdgeEvent
}

func (e HistoryEvent) Cursor() HistoryCursor {
	return HistoryCursor{At: e.At, TypeOrder: e.TypeOrder, ID: e.ID}
}

func (e HistoryEvent) IATA() string {
	if e.Edge != nil {
		return e.Edge.IATA
	}
	if e.Packet != nil {
		return e.Packet.IATA
	}
	return ""
}

type HistoryQuery struct {
	From            int64
	To              int64
	Limit           int
	Cursor          *HistoryCursor
	NewestFirst     bool
	IATA            string
	PayloadTypeName string
}

type HistorySummaryRow struct {
	IATA   string
	Bucket int64
	Count  int64
}

func (s *Store) PublicHistoryEvents(ctx context.Context, query HistoryQuery) ([]HistoryEvent, error) {
	limit := query.Limit
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	to := boundedHistoryTo(query.To)
	sqlText := `
  SELECT 2 AS type_order, 'routePulse' AS event_type, e.heard_at_ms AS at_ms, e.id AS entity_id,
    0 AS packet_id, '' AS packet_hash, 0 AS packet_payload_type, '' AS packet_payload_type_name,
    0 AS packet_route_type, '' AS packet_route_type_name, '' AS packet_observer_name,
    '' AS packet_observer_public_key, COALESCE(po.iata, '') AS packet_iata,
    0 AS packet_heard_at_ms, NULL AS packet_rssi, NULL AS packet_snr, NULL AS packet_score,
    0 AS packet_hash_size, 0 AS packet_hop_count, '' AS packet_path_hex,
    '' AS packet_resolution_status, '' AS packet_resolution_reason, '' AS packet_summary,
    '' AS packet_message_sender, '' AS packet_message_text, 0 AS packet_invalid_for_map,
    e.id AS edge_id, e.packet_hash AS edge_packet_hash, e.observation_id AS edge_observation_id,
    COALESCE(po.iata, '') AS edge_iata, e.payload_type AS edge_payload_type,
    e.payload_type_name AS edge_payload_type_name, e.message_sender AS edge_message_sender,
    e.message_text AS edge_message_text, e.message_anchor_json AS edge_message_anchor_json,
    e.heard_at_ms AS edge_heard_at_ms, e.segments_json AS edge_segments_json,
    e.render_reason AS edge_render_reason
  FROM live_edge_events e
  LEFT JOIN packet_observations po ON po.id=e.observation_id
  WHERE e.heard_at_ms >= ? AND e.heard_at_ms <= ?`
	args := []any{query.From, to}
	if iata := strings.ToUpper(strings.TrimSpace(query.IATA)); iata != "" {
		sqlText += ` AND UPPER(COALESCE(po.iata, '')) = ?`
		args = append(args, iata)
	}
	if payload := strings.ToUpper(strings.TrimSpace(query.PayloadTypeName)); payload != "" {
		sqlText += ` AND UPPER(COALESCE(e.payload_type_name, '')) = ?`
		args = append(args, payload)
	}
	if query.Cursor != nil {
		if query.NewestFirst {
			sqlText += ` AND (e.heard_at_ms < ? OR (e.heard_at_ms = ? AND e.id < ?))`
		} else {
			sqlText += ` AND (e.heard_at_ms > ? OR (e.heard_at_ms = ? AND e.id > ?))`
		}
		args = append(args, query.Cursor.At, query.Cursor.At, query.Cursor.ID)
	}
	if query.NewestFirst {
		sqlText += `
ORDER BY at_ms DESC, type_order DESC, entity_id DESC
LIMIT ?`
	} else {
		sqlText += `
ORDER BY at_ms ASC, type_order ASC, entity_id ASC
LIMIT ?`
	}
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHistoryEvents(rows)
}

func (s *Store) PublicPacketEdgeEvents(ctx context.Context, query HistoryQuery) ([]live.EdgeEvent, error) {
	limit := query.Limit
	if limit <= 0 || limit > 2500 {
		limit = 1000
	}
	to := boundedHistoryTo(query.To)
	sqlText := `
SELECT e.id, e.packet_hash, e.observation_id, COALESCE(po.iata, '') AS edge_iata,
  e.payload_type, e.payload_type_name, e.message_sender, e.message_text,
  e.message_anchor_json, e.heard_at_ms, e.segments_json, e.render_reason
FROM live_edge_events e
LEFT JOIN packet_observations po ON po.id=e.observation_id
WHERE e.heard_at_ms >= ? AND e.heard_at_ms <= ?`
	args := []any{query.From, to}
	if iata := strings.ToUpper(strings.TrimSpace(query.IATA)); iata != "" {
		sqlText += ` AND UPPER(COALESCE(po.iata, '')) = ?`
		args = append(args, iata)
	}
	if payload := strings.ToUpper(strings.TrimSpace(query.PayloadTypeName)); payload != "" {
		sqlText += ` AND UPPER(COALESCE(e.payload_type_name, '')) = ?`
		args = append(args, payload)
	}
	if query.Cursor != nil {
		sqlText += ` AND (e.heard_at_ms < ? OR (e.heard_at_ms = ? AND e.id < ?))`
		args = append(args, query.Cursor.At, query.Cursor.At, query.Cursor.ID)
	}
	sqlText += `
ORDER BY e.heard_at_ms DESC, e.id DESC
LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []live.EdgeEvent{}
	for rows.Next() {
		var edge live.EdgeEvent
		var messageAnchorJSON string
		var segmentsJSON string
		if err := rows.Scan(
			&edge.ID,
			&edge.PacketHash,
			&edge.ObservationID,
			&edge.IATA,
			&edge.PayloadType,
			&edge.PayloadTypeName,
			&edge.MessageSender,
			&edge.MessageText,
			&messageAnchorJSON,
			&edge.HeardAt,
			&segmentsJSON,
			&edge.RenderReason,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(segmentsJSON), &edge.Segments)
		if messageAnchorJSON != "" {
			var anchor live.MessageAnchor
			if err := json.Unmarshal([]byte(messageAnchorJSON), &anchor); err == nil {
				edge.MessageAnchor = &anchor
			}
		}
		out = append(out, edge)
	}
	return out, rows.Err()
}

func (s *Store) PublicHistorySummary(ctx context.Context, from int64, to int64, bucketMs int64) ([]HistorySummaryRow, error) {
	if bucketMs <= 0 {
		bucketMs = int64(time.Hour / time.Millisecond)
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT COALESCE(po.iata, '') AS iata, CAST((e.heard_at_ms - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS count
FROM live_edge_events e
LEFT JOIN packet_observations po ON po.id=e.observation_id
WHERE e.heard_at_ms >= ? AND e.heard_at_ms <= ?
GROUP BY COALESCE(po.iata, ''), bucket
ORDER BY bucket ASC, iata ASC`, from, bucketMs, from, boundedHistoryTo(to))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HistorySummaryRow{}
	for rows.Next() {
		var row HistorySummaryRow
		if err := rows.Scan(&row.IATA, &row.Bucket, &row.Count); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Store) PublicHistorySummaryTotals(ctx context.Context, from int64, to int64, bucketMs int64) ([]HistorySummaryRow, error) {
	if bucketMs <= 0 {
		bucketMs = int64(time.Hour / time.Millisecond)
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT '' AS iata, CAST((heard_at_ms - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS count
FROM live_edge_events
WHERE heard_at_ms >= ? AND heard_at_ms <= ?
GROUP BY bucket
ORDER BY bucket ASC`, from, bucketMs, from, boundedHistoryTo(to))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HistorySummaryRow{}
	for rows.Next() {
		var row HistorySummaryRow
		if err := rows.Scan(&row.IATA, &row.Bucket, &row.Count); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func scanHistoryEvents(rows *sql.Rows) ([]HistoryEvent, error) {
	out := []HistoryEvent{}
	for rows.Next() {
		var event HistoryEvent
		var packet live.PacketObservation
		var packetRSSI, packetSNR, packetScore sql.NullFloat64
		var packetInvalid int
		var edge live.EdgeEvent
		var edgeMessageAnchorJSON string
		var edgeSegmentsJSON string
		if err := rows.Scan(
			&event.TypeOrder,
			&event.Type,
			&event.At,
			&event.ID,
			&packet.ID,
			&packet.PacketHash,
			&packet.PayloadType,
			&packet.PayloadTypeName,
			&packet.RouteType,
			&packet.RouteTypeName,
			&packet.ObserverName,
			&packet.ObserverPublicKey,
			&packet.IATA,
			&packet.HeardAt,
			&packetRSSI,
			&packetSNR,
			&packetScore,
			&packet.HashSize,
			&packet.HopCount,
			&packet.PathHex,
			&packet.ResolutionStatus,
			&packet.ResolutionReason,
			&packet.Summary,
			&packet.MessageSender,
			&packet.MessageText,
			&packetInvalid,
			&edge.ID,
			&edge.PacketHash,
			&edge.ObservationID,
			&edge.IATA,
			&edge.PayloadType,
			&edge.PayloadTypeName,
			&edge.MessageSender,
			&edge.MessageText,
			&edgeMessageAnchorJSON,
			&edge.HeardAt,
			&edgeSegmentsJSON,
			&edge.RenderReason,
		); err != nil {
			return nil, err
		}
		if packet.ID > 0 {
			packet.RSSI = floatPtr(packetRSSI)
			packet.SNR = floatPtr(packetSNR)
			packet.Score = floatPtr(packetScore)
			packet.InvalidForMap = packetInvalid == 1
			event.Packet = &packet
		}
		if edge.ID > 0 {
			_ = json.Unmarshal([]byte(edgeSegmentsJSON), &edge.Segments)
			if edgeMessageAnchorJSON != "" {
				var anchor live.MessageAnchor
				if err := json.Unmarshal([]byte(edgeMessageAnchorJSON), &anchor); err == nil {
					edge.MessageAnchor = &anchor
				}
			}
			event.Edge = &edge
		}
		out = append(out, event)
	}
	return out, rows.Err()
}

func boundedHistoryTo(to int64) int64 {
	maxHeardAt := time.Now().Add(maxFutureEdgeSkew).UnixMilli()
	if to <= 0 || to > maxHeardAt {
		return maxHeardAt
	}
	return to
}
