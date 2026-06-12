package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

type PropagationWeatherSnapshot struct {
	Latitude               float64
	Longitude              float64
	WindDirectionDeg       float64
	Temperature950HPaC     *float64
	DewPoint950HPaC        *float64
	RelativeHumidity950HPa *float64
	Summary                live.PublicPropagationWeatherSummary
}

type PublicPropagationEventQuery struct {
	From        int64
	To          int64
	Limit       int
	Cursor      *HistoryCursor
	NewestFirst bool
	Region      string
}

func (s *Store) InsertPropagationWeatherSnapshot(ctx context.Context, snap PropagationWeatherSnapshot) (int64, error) {
	if s == nil || s.db == nil {
		return 0, sql.ErrConnDone
	}
	if snap.Summary.FetchedAt <= 0 {
		snap.Summary.FetchedAt = time.Now().UnixMilli()
	}
	if snap.Summary.SampleTime <= 0 {
		snap.Summary.SampleTime = snap.Summary.FetchedAt
	}
	result, err := s.db.ExecContext(ctx, `
INSERT INTO propagation_weather_snapshots (
  fetched_at_ms, sample_time_ms, source, model, latitude, longitude,
  temperature_c, dew_point_c, relative_humidity_pct, pressure_hpa,
  cloud_cover_pct, visibility_m, wind_speed_kmh, wind_direction_deg,
  temperature_950hpa_c, dew_point_950hpa_c, relative_humidity_950hpa,
  inversion_proxy
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		snap.Summary.FetchedAt,
		snap.Summary.SampleTime,
		live.PublicDisplayText(snap.Summary.Source, 80),
		live.PublicDisplayText(snap.Summary.Model, 80),
		snap.Latitude,
		snap.Longitude,
		snap.Summary.TemperatureC,
		snap.Summary.DewPointC,
		snap.Summary.RelativeHumidityPct,
		snap.Summary.PressureHPa,
		snap.Summary.CloudCoverPct,
		snap.Summary.VisibilityM,
		snap.Summary.WindSpeedKmh,
		snap.WindDirectionDeg,
		nullableFloat(snap.Temperature950HPaC),
		nullableFloat(snap.DewPoint950HPaC),
		nullableFloat(snap.RelativeHumidity950HPa),
		live.PublicDisplayText(snap.Summary.InversionProxy, 120),
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) PropagationCandidatePaths(ctx context.Context, from int64, to int64, minDistanceKM float64, limit int) ([]live.PublicPacketPath, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT edge_id, heard_at_ms, iata, region, payload_type_name, message_sender, message_text,
  hop_count, segment_count, distance_km, route_ids_json, endpoint_labels_json, segments_json
FROM public_packet_paths
WHERE mappable=1
  AND heard_at_ms >= ? AND heard_at_ms <= ?
  AND distance_km >= ?
  AND NOT EXISTS (SELECT 1 FROM propagation_events e WHERE e.edge_id=public_packet_paths.edge_id)
ORDER BY heard_at_ms DESC, edge_id DESC
LIMIT ?`, from, boundedHistoryTo(to), minDistanceKM, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []live.PublicPacketPath{}
	for rows.Next() {
		packet, _, err := scanPublicPacketPathProjection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, packet)
	}
	return out, rows.Err()
}

func (s *Store) PropagationRouteBurstCount(ctx context.Context, routeIDs []string, from int64, to int64, minDistanceKM float64) (int, error) {
	if s == nil || s.db == nil || len(routeIDs) == 0 {
		return 0, nil
	}
	clauses := []string{}
	args := []any{from, boundedHistoryTo(to), minDistanceKM}
	for _, routeID := range routeIDs {
		routeID = strings.TrimSpace(routeID)
		if routeID == "" {
			continue
		}
		clauses = append(clauses, `instr(route_ids_json, ?) > 0`)
		args = append(args, routeID)
	}
	if len(clauses) == 0 {
		return 0, nil
	}
	query := `
SELECT COUNT(*)
FROM public_packet_paths
WHERE mappable=1
  AND heard_at_ms >= ? AND heard_at_ms <= ?
  AND distance_km >= ?
  AND (` + strings.Join(clauses, ` OR `) + `)`
	var count int
	if err := s.db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) UpsertPropagationEvent(ctx context.Context, event live.PublicPropagationEvent) error {
	if s == nil || s.db == nil {
		return sql.ErrConnDone
	}
	edgeID := propagationEdgeID(event.ID)
	if edgeID <= 0 {
		return nil
	}
	event = sanitizePropagationEvent(event)
	routeIDsJSON, _ := json.Marshal(event.RouteIDs)
	labelsJSON, _ := json.Marshal(event.EndpointLabels)
	segmentsJSON, _ := json.Marshal(event.Segments)
	reasonsJSON, _ := json.Marshal(event.Reasons)
	weatherJSON := ""
	if event.Weather != nil {
		data, _ := json.Marshal(event.Weather)
		weatherJSON = string(data)
	}
	solarJSON := ""
	if event.Solar != nil {
		data, _ := json.Marshal(event.Solar)
		solarJSON = string(data)
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO propagation_events (
  public_id, edge_id, at_ms, region, classification, confidence, score, distance_km,
  route_ids_json, endpoint_labels_json, segments_json, reasons_json, weather_json,
  solar_json, replay_from_ms, replay_to_ms, created_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(edge_id) DO UPDATE SET
  public_id=excluded.public_id,
  at_ms=excluded.at_ms,
  region=excluded.region,
  classification=excluded.classification,
  confidence=excluded.confidence,
  score=excluded.score,
  distance_km=excluded.distance_km,
  route_ids_json=excluded.route_ids_json,
  endpoint_labels_json=excluded.endpoint_labels_json,
  segments_json=excluded.segments_json,
  reasons_json=excluded.reasons_json,
  weather_json=excluded.weather_json,
  solar_json=excluded.solar_json,
  replay_from_ms=excluded.replay_from_ms,
  replay_to_ms=excluded.replay_to_ms`,
		event.ID,
		edgeID,
		event.At,
		event.Region,
		event.Classification,
		event.Confidence,
		event.Score,
		event.DistanceKM,
		string(routeIDsJSON),
		string(labelsJSON),
		string(segmentsJSON),
		string(reasonsJSON),
		weatherJSON,
		solarJSON,
		event.ReplayWindow.From,
		event.ReplayWindow.To,
		time.Now().UnixMilli(),
	)
	return err
}

func (s *Store) PublicPropagationEvents(ctx context.Context, query PublicPropagationEventQuery) ([]live.PublicPropagationEvent, *HistoryCursor, error) {
	limit := query.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	to := boundedHistoryTo(query.To)
	sqlText := `
SELECT id, public_id, at_ms, region, classification, confidence, score, distance_km,
  route_ids_json, endpoint_labels_json, segments_json, reasons_json, weather_json,
  solar_json, replay_from_ms, replay_to_ms
FROM propagation_events
WHERE at_ms >= ? AND at_ms <= ?`
	args := []any{query.From, to}
	if region := strings.ToUpper(strings.TrimSpace(query.Region)); region != "" {
		sqlText += ` AND region = ?`
		args = append(args, region)
	}
	if query.Cursor != nil && query.NewestFirst {
		sqlText += ` AND (at_ms < ? OR (at_ms = ? AND id < ?))`
		args = append(args, query.Cursor.At, query.Cursor.At, query.Cursor.ID)
	} else if query.Cursor != nil {
		sqlText += ` AND (at_ms > ? OR (at_ms = ? AND id > ?))`
		args = append(args, query.Cursor.At, query.Cursor.At, query.Cursor.ID)
	}
	if query.NewestFirst {
		sqlText += `
ORDER BY at_ms DESC, id DESC
LIMIT ?`
	} else {
		sqlText += `
ORDER BY at_ms ASC, id ASC
LIMIT ?`
	}
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	events := []live.PublicPropagationEvent{}
	var next *HistoryCursor
	var last *HistoryCursor
	for rows.Next() {
		event, rowID, err := scanPropagationEvent(rows)
		if err != nil {
			return nil, nil, err
		}
		if len(events) >= limit {
			next = last
			break
		}
		events = append(events, event)
		last = &HistoryCursor{At: event.At, TypeOrder: 3, ID: rowID}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return events, next, nil
}

func (s *Store) LatestPropagationConditions(ctx context.Context, from int64, to int64) (live.PublicPropagationConditions, error) {
	events, _, err := s.PublicPropagationEvents(ctx, PublicPropagationEventQuery{
		From:        from,
		To:          to,
		Limit:       1,
		NewestFirst: true,
	})
	if err != nil {
		return live.PublicPropagationConditions{}, err
	}
	var count int
	if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM propagation_events
WHERE at_ms >= ? AND at_ms <= ?`, from, boundedHistoryTo(to)).Scan(&count); err != nil {
		return live.PublicPropagationConditions{}, err
	}
	conditions := live.PublicPropagationConditions{
		ServerTime:   time.Now().UnixMilli(),
		EventCount:   count,
		SourceStatus: "no_recent_events",
	}
	if len(events) > 0 {
		event := events[0]
		conditions.LatestEvent = &event
		conditions.Weather = event.Weather
		conditions.Solar = event.Solar
		conditions.SourceStatus = "ready"
	}
	return conditions, nil
}

func scanPropagationEvent(rows *sql.Rows) (live.PublicPropagationEvent, int64, error) {
	var rowID int64
	var event live.PublicPropagationEvent
	var routeIDsJSON, labelsJSON, segmentsJSON, reasonsJSON string
	var weatherJSON, solarJSON string
	if err := rows.Scan(
		&rowID,
		&event.ID,
		&event.At,
		&event.Region,
		&event.Classification,
		&event.Confidence,
		&event.Score,
		&event.DistanceKM,
		&routeIDsJSON,
		&labelsJSON,
		&segmentsJSON,
		&reasonsJSON,
		&weatherJSON,
		&solarJSON,
		&event.ReplayWindow.From,
		&event.ReplayWindow.To,
	); err != nil {
		return live.PublicPropagationEvent{}, 0, err
	}
	_ = json.Unmarshal([]byte(routeIDsJSON), &event.RouteIDs)
	_ = json.Unmarshal([]byte(labelsJSON), &event.EndpointLabels)
	_ = json.Unmarshal([]byte(segmentsJSON), &event.Segments)
	_ = json.Unmarshal([]byte(reasonsJSON), &event.Reasons)
	if strings.TrimSpace(weatherJSON) != "" {
		var weather live.PublicPropagationWeatherSummary
		if err := json.Unmarshal([]byte(weatherJSON), &weather); err == nil {
			event.Weather = &weather
		}
	}
	if strings.TrimSpace(solarJSON) != "" {
		var solar live.PublicPropagationSolarSummary
		if err := json.Unmarshal([]byte(solarJSON), &solar); err == nil {
			event.Solar = &solar
		}
	}
	return sanitizePropagationEvent(event), rowID, nil
}

func sanitizePropagationEvent(event live.PublicPropagationEvent) live.PublicPropagationEvent {
	event.ID = publicSafePropagationID(event.ID)
	event.Region = strings.ToUpper(live.PublicDisplayText(event.Region, 16))
	event.Classification = propagationToken(event.Classification, "long_distance_event")
	event.Confidence = propagationToken(event.Confidence, "low")
	if event.Score < 0 {
		event.Score = 0
	}
	if event.Score > 1 {
		event.Score = 1
	}
	for i := range event.RouteIDs {
		event.RouteIDs[i] = live.PublicDisplayText(event.RouteIDs[i], 32)
	}
	event.RouteIDs = compactStrings(event.RouteIDs)
	for i := range event.EndpointLabels {
		event.EndpointLabels[i] = live.PublicDisplayText(event.EndpointLabels[i], 80)
	}
	event.EndpointLabels = compactStrings(event.EndpointLabels)
	for i := range event.Reasons {
		event.Reasons[i] = live.PublicDisplayText(event.Reasons[i], 160)
	}
	event.Reasons = compactStrings(event.Reasons)
	for i := range event.Segments {
		event.Segments[i].From.NodeID = live.PublicSafeID(event.Segments[i].From.NodeID)
		event.Segments[i].From.Label = live.PublicDisplayText(event.Segments[i].From.Label, 80)
		event.Segments[i].To.NodeID = live.PublicSafeID(event.Segments[i].To.NodeID)
		event.Segments[i].To.Label = live.PublicDisplayText(event.Segments[i].To.Label, 80)
	}
	if event.Weather != nil {
		event.Weather.Source = live.PublicDisplayText(event.Weather.Source, 80)
		event.Weather.Model = live.PublicDisplayText(event.Weather.Model, 80)
		event.Weather.InversionProxy = live.PublicDisplayText(event.Weather.InversionProxy, 120)
	}
	if event.ReplayWindow.From <= 0 || event.ReplayWindow.To <= 0 || event.ReplayWindow.To < event.ReplayWindow.From {
		event.ReplayWindow = live.PublicPropagationReplayWindow{From: maxInt64(0, event.At-10*60_000), To: event.At + 10*60_000}
	}
	return event
}

func publicSafePropagationID(id string) string {
	id = strings.TrimSpace(id)
	if strings.HasPrefix(id, "prop-") && propagationEdgeID(id) > 0 {
		return id
	}
	return "prop-0"
}

func propagationEdgeID(id string) int64 {
	id = strings.TrimPrefix(strings.TrimSpace(id), "prop-")
	id = strings.TrimPrefix(id, "pulse-")
	value, err := strconv.ParseInt(id, 10, 64)
	if err != nil || value <= 0 {
		return 0
	}
	return value
}

func propagationToken(value string, fallback string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return fallback
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return fallback
	}
	return value
}

func compactStrings(items []string) []string {
	out := items[:0]
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			out = append(out, item)
		}
	}
	return out
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
