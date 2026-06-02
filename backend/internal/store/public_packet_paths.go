package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

type PublicPacketPathQuery struct {
	From            int64
	To              int64
	Limit           int
	Cursor          *HistoryCursor
	IATA            string
	PayloadTypeName string
	MinHops         int
	MessageOnly     bool
	Search          string
}

func (s *Store) PublicPacketPathProjectionComplete(ctx context.Context, from int64, to int64) (bool, error) {
	var missing int
	err := s.db.QueryRowContext(ctx, `
SELECT EXISTS (
  SELECT 1
  FROM live_edge_events e
  WHERE e.heard_at_ms >= ? AND e.heard_at_ms <= ?
    AND NOT EXISTS (SELECT 1 FROM public_packet_paths p WHERE p.edge_id=e.id)
  LIMIT 1
)`, from, boundedHistoryTo(to)).Scan(&missing)
	if err != nil {
		return false, err
	}
	return missing == 0, nil
}

func (s *Store) PublicPacketPaths(ctx context.Context, query PublicPacketPathQuery) ([]live.PublicPacketPath, *HistoryCursor, error) {
	limit := query.Limit
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	to := boundedHistoryTo(query.To)
	sqlText := `
SELECT edge_id, heard_at_ms, iata, region, payload_type_name, message_sender, message_text,
  hop_count, segment_count, distance_km, route_ids_json, endpoint_labels_json, segments_json
FROM public_packet_paths
WHERE mappable=1 AND heard_at_ms >= ? AND heard_at_ms <= ?`
	args := []any{query.From, to}
	if iata := strings.ToUpper(strings.TrimSpace(query.IATA)); iata != "" {
		sqlText += ` AND region = ?`
		args = append(args, iata)
	}
	if payload := strings.ToUpper(strings.TrimSpace(query.PayloadTypeName)); payload != "" {
		sqlText += ` AND payload_type_name = ?`
		args = append(args, payload)
	}
	if query.MinHops > 0 {
		sqlText += ` AND hop_count >= ?`
		args = append(args, query.MinHops)
	}
	if query.MessageOnly {
		sqlText += ` AND message_text != ''`
	}
	if search := strings.ToLower(strings.TrimSpace(query.Search)); search != "" {
		sqlText += ` AND instr(search_text, ?) > 0`
		args = append(args, search)
	}
	if query.Cursor != nil {
		sqlText += ` AND (heard_at_ms < ? OR (heard_at_ms = ? AND edge_id < ?))`
		args = append(args, query.Cursor.At, query.Cursor.At, query.Cursor.ID)
	}
	sqlText += `
ORDER BY heard_at_ms DESC, edge_id DESC
LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	packets := []live.PublicPacketPath{}
	var next *HistoryCursor
	var last *HistoryCursor
	for rows.Next() {
		packet, edgeID, err := scanPublicPacketPathProjection(rows)
		if err != nil {
			return nil, nil, err
		}
		if len(packets) >= limit {
			next = last
			break
		}
		packets = append(packets, packet)
		last = &HistoryCursor{At: packet.At, TypeOrder: 2, ID: edgeID}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return packets, next, nil
}

func insertPublicPacketPathTx(ctx context.Context, tx *sql.Tx, edge live.EdgeEvent, region string) error {
	edge.IATA = strings.ToUpper(strings.TrimSpace(region))
	region = edge.IATA
	packet, ok := live.PublicPacketPathFromPulse(mustPublicRoutePulse(edge))
	if !ok {
		_, err := tx.ExecContext(ctx, `
INSERT INTO public_packet_paths (
  edge_id, observation_id, mappable, heard_at_ms, iata, region, payload_type_name,
  message_sender, message_text, created_at_ms
) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(edge_id) DO UPDATE SET
  observation_id=excluded.observation_id,
  mappable=excluded.mappable,
  heard_at_ms=excluded.heard_at_ms,
  iata=excluded.iata,
  region=excluded.region,
  payload_type_name=excluded.payload_type_name,
  message_sender=excluded.message_sender,
  message_text=excluded.message_text`,
			edge.ID,
			edge.ObservationID,
			edge.HeardAt,
			region,
			region,
			strings.ToUpper(strings.TrimSpace(edge.PayloadTypeName)),
			publicProjectionText(edge.MessageSender),
			publicProjectionText(edge.MessageText),
			time.Now().UnixMilli(),
		)
		return err
	}
	packet.ID = "pulse-" + int64String(edge.ID)
	packet.IATA = region
	packet.Region = region
	routeIDsJSON, _ := json.Marshal(packet.RouteIDs)
	labelsJSON, _ := json.Marshal(packet.EndpointLabels)
	segmentsJSON, _ := json.Marshal(packet.Segments)
	searchText := publicPacketPathSearchText(packet)
	_, err := tx.ExecContext(ctx, `
INSERT INTO public_packet_paths (
  edge_id, observation_id, mappable, heard_at_ms, iata, region, payload_type_name,
  message_sender, message_text, hop_count, segment_count, distance_km,
  route_ids_json, endpoint_labels_json, segments_json, search_text, created_at_ms
) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(edge_id) DO UPDATE SET
  observation_id=excluded.observation_id,
  mappable=excluded.mappable,
  heard_at_ms=excluded.heard_at_ms,
  iata=excluded.iata,
  region=excluded.region,
  payload_type_name=excluded.payload_type_name,
  message_sender=excluded.message_sender,
  message_text=excluded.message_text,
  hop_count=excluded.hop_count,
  segment_count=excluded.segment_count,
  distance_km=excluded.distance_km,
  route_ids_json=excluded.route_ids_json,
  endpoint_labels_json=excluded.endpoint_labels_json,
  segments_json=excluded.segments_json,
  search_text=excluded.search_text`,
		edge.ID,
		edge.ObservationID,
		packet.At,
		packet.IATA,
		packet.Region,
		strings.ToUpper(strings.TrimSpace(packet.PayloadTypeName)),
		packet.MessageSender,
		packet.MessageText,
		packet.HopCount,
		packet.SegmentCount,
		packet.DistanceKM,
		string(routeIDsJSON),
		string(labelsJSON),
		string(segmentsJSON),
		searchText,
		time.Now().UnixMilli(),
	)
	return err
}

func mustPublicRoutePulse(edge live.EdgeEvent) live.PublicRoutePulse {
	pulse, ok := live.PublicRoutePulseFromEdge(edge)
	if !ok {
		return live.PublicRoutePulse{}
	}
	return pulse
}

func scanPublicPacketPathProjection(rows *sql.Rows) (live.PublicPacketPath, int64, error) {
	var edgeID int64
	var packet live.PublicPacketPath
	var routeIDsJSON, labelsJSON, segmentsJSON string
	if err := rows.Scan(
		&edgeID,
		&packet.At,
		&packet.IATA,
		&packet.Region,
		&packet.PayloadTypeName,
		&packet.MessageSender,
		&packet.MessageText,
		&packet.HopCount,
		&packet.SegmentCount,
		&packet.DistanceKM,
		&routeIDsJSON,
		&labelsJSON,
		&segmentsJSON,
	); err != nil {
		return live.PublicPacketPath{}, 0, err
	}
	packet.ID = "pulse-" + int64String(edgeID)
	if err := json.Unmarshal([]byte(routeIDsJSON), &packet.RouteIDs); err != nil {
		return live.PublicPacketPath{}, 0, err
	}
	if err := json.Unmarshal([]byte(labelsJSON), &packet.EndpointLabels); err != nil {
		return live.PublicPacketPath{}, 0, err
	}
	if err := json.Unmarshal([]byte(segmentsJSON), &packet.Segments); err != nil {
		return live.PublicPacketPath{}, 0, err
	}
	return packet, edgeID, nil
}

func publicPacketPathSearchText(packet live.PublicPacketPath) string {
	fields := []string{
		packet.ID,
		packet.IATA,
		packet.Region,
		packet.PayloadTypeName,
		packet.MessageSender,
		packet.MessageText,
	}
	fields = append(fields, packet.RouteIDs...)
	fields = append(fields, packet.EndpointLabels...)
	for _, segment := range packet.Segments {
		fields = append(fields,
			segment.RouteID,
			segment.From.Label,
			segment.From.PathHash3,
			segment.To.Label,
			segment.To.PathHash3,
		)
	}
	return strings.ToLower(strings.Join(fields, " "))
}

func publicProjectionText(value string) string {
	return strings.TrimSpace(value)
}
