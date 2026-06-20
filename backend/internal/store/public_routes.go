package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

type PublicRouteSummaryBackfillResult struct {
	Scanned   int
	Counted   int
	Remaining bool
}

func upsertPublicRouteSummariesTx(ctx context.Context, tx *sql.Tx, edge live.EdgeEvent) error {
	if edge.ID <= 0 {
		return nil
	}
	result, err := tx.ExecContext(ctx, `
INSERT OR IGNORE INTO public_route_summary_edges (edge_id, heard_at_ms)
VALUES (?, ?)`, edge.ID, edge.HeardAt)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil
	}
	pulse, ok := live.PublicRoutePulseFromEdge(edge)
	if !ok {
		return nil
	}
	now := time.Now().UnixMilli()
	for _, segment := range pulse.Segments {
		routeID := strings.TrimSpace(segment.RouteID)
		if routeID == "" {
			continue
		}
		payloadTypes, err := publicRoutePayloadTypesTx(ctx, tx, routeID, edge.PayloadTypeName)
		if err != nil {
			return err
		}
		payloadJSON, _ := json.Marshal(payloadTypes)
		if _, err := tx.ExecContext(ctx, `
INSERT INTO public_route_summaries (
  route_id, from_node_id, from_label, from_lat, from_lng, from_path_hash3,
  to_node_id, to_label, to_lat, to_lng, to_path_hash3, distance_km,
  packet_count, last_heard_ms, payload_type_names_json, updated_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
ON CONFLICT(route_id) DO UPDATE SET
  from_node_id=excluded.from_node_id,
  from_label=excluded.from_label,
  from_lat=excluded.from_lat,
  from_lng=excluded.from_lng,
  from_path_hash3=excluded.from_path_hash3,
  to_node_id=excluded.to_node_id,
  to_label=excluded.to_label,
  to_lat=excluded.to_lat,
  to_lng=excluded.to_lng,
  to_path_hash3=excluded.to_path_hash3,
  distance_km=excluded.distance_km,
  packet_count=public_route_summaries.packet_count + 1,
  last_heard_ms=max(public_route_summaries.last_heard_ms, excluded.last_heard_ms),
  payload_type_names_json=excluded.payload_type_names_json,
  updated_at_ms=excluded.updated_at_ms`,
			routeID,
			live.PublicSafeID(segment.From.NodeID),
			live.PublicDisplayText(segment.From.Label, 80),
			segment.From.Lat,
			segment.From.Lng,
			publicProjectionText(segment.From.PathHash3),
			live.PublicSafeID(segment.To.NodeID),
			live.PublicDisplayText(segment.To.Label, 80),
			segment.To.Lat,
			segment.To.Lng,
			publicProjectionText(segment.To.PathHash3),
			segment.DistanceKM,
			edge.HeardAt,
			string(payloadJSON),
			now,
		); err != nil {
			return err
		}
	}
	return nil
}

func publicRoutePayloadTypesTx(ctx context.Context, tx *sql.Tx, routeID string, payloadType string) ([]string, error) {
	seen := map[string]struct{}{}
	var raw string
	err := tx.QueryRowContext(ctx, `SELECT payload_type_names_json FROM public_route_summaries WHERE route_id=?`, routeID).Scan(&raw)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if raw != "" {
		var existing []string
		_ = json.Unmarshal([]byte(raw), &existing)
		for _, item := range existing {
			if item = strings.ToUpper(strings.TrimSpace(item)); item != "" {
				seen[item] = struct{}{}
			}
		}
	}
	if payloadType = strings.ToUpper(strings.TrimSpace(payloadType)); payloadType != "" {
		seen[payloadType] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for item := range seen {
		out = append(out, item)
	}
	sort.Strings(out)
	return out, nil
}

func (s *Store) PublicRouteSummaries(ctx context.Context, limit int) ([]live.PublicRoute, error) {
	if limit <= 0 {
		limit = 2500
	}
	if limit > 5000 {
		limit = 5000
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT route_id,
  from_node_id, from_label, from_lat, from_lng, from_path_hash3,
  to_node_id, to_label, to_lat, to_lng, to_path_hash3,
  distance_km, packet_count, last_heard_ms, payload_type_names_json
FROM public_route_summaries
ORDER BY last_heard_ms DESC, packet_count DESC
LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	routes := []live.PublicRoute{}
	maxCount := 1
	for rows.Next() {
		var route live.PublicRoute
		var payloadJSON string
		if err := rows.Scan(
			&route.ID,
			&route.From.NodeID,
			&route.From.Label,
			&route.From.Lat,
			&route.From.Lng,
			&route.From.PathHash3,
			&route.To.NodeID,
			&route.To.Label,
			&route.To.Lat,
			&route.To.Lng,
			&route.To.PathHash3,
			&route.DistanceKM,
			&route.PacketCount,
			&route.LastHeard,
			&payloadJSON,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(payloadJSON), &route.PayloadTypeNames)
		route.From.Label = live.PublicDisplayText(route.From.Label, 80)
		route.To.Label = live.PublicDisplayText(route.To.Label, 80)
		route.From.NodeID = live.PublicSafeID(route.From.NodeID)
		route.To.NodeID = live.PublicSafeID(route.To.NodeID)
		if route.PacketCount > maxCount {
			maxCount = route.PacketCount
		}
		routes = append(routes, route)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range routes {
		routes[i].FrequencyBucket = publicRouteFrequencyBucket(routes[i].PacketCount, maxCount)
	}
	return routes, nil
}

func (s *Store) BackfillPublicRouteSummaries(ctx context.Context, from int64, to int64, limit int) (PublicRouteSummaryBackfillResult, error) {
	if limit <= 0 {
		limit = 500
	}
	if limit > 2000 {
		limit = 2000
	}
	edges, err := s.publicRouteSummaryMissingEdges(ctx, from, to, limit)
	if err != nil {
		return PublicRouteSummaryBackfillResult{}, err
	}
	result := PublicRouteSummaryBackfillResult{Scanned: len(edges)}
	if len(edges) == 0 {
		return result, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	for _, edge := range edges {
		if err := upsertPublicRouteSummariesTx(ctx, tx, edge); err != nil {
			return result, err
		}
		result.Counted++
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	committed = true

	if len(edges) >= limit {
		result.Remaining = true
	}
	return result, nil
}

func (s *Store) publicRouteSummaryMissingEdges(ctx context.Context, from int64, to int64, limit int) ([]live.EdgeEvent, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT e.id, e.packet_hash, e.observation_id, COALESCE(po.iata, '') AS edge_iata,
  e.payload_type, e.payload_type_name, e.message_sender, e.message_text,
  e.message_anchor_json, e.heard_at_ms, e.segments_json, e.render_reason
FROM live_edge_events e
LEFT JOIN packet_observations po ON po.id=e.observation_id
WHERE e.heard_at_ms >= ? AND e.heard_at_ms <= ?
  AND NOT EXISTS (SELECT 1 FROM public_route_summary_edges r WHERE r.edge_id=e.id)
ORDER BY e.heard_at_ms ASC, e.id ASC
LIMIT ?`, from, boundedHistoryTo(to), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	edges := []live.EdgeEvent{}
	for rows.Next() {
		edge, err := scanPublicPacketPathBackfillEdge(rows)
		if err != nil {
			return nil, err
		}
		edges = append(edges, edge)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return edges, nil
}

func publicRouteFrequencyBucket(count int, maxCount int) int {
	if maxCount <= 1 {
		return 0
	}
	bucket := int(float64(count) / float64(maxCount) * 4)
	if bucket < 0 {
		return 0
	}
	if bucket > 4 {
		return 4
	}
	return bucket
}
