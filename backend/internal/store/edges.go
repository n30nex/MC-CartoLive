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

const maxFutureEdgeSkew = 5 * time.Minute

func (s *Store) InsertEdgeEvent(ctx context.Context, event live.EdgeEvent, resolutionStatus, resolutionReason string) (live.EdgeEvent, error) {
	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return event, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	if resolutionStatus != "" {
		if _, err := tx.ExecContext(ctx, `
UPDATE packet_observations
SET resolution_status=?, resolution_reason=?
WHERE id=?`, resolutionStatus, resolutionReason, event.ObservationID); err != nil {
			return event, err
		}
	}
	result, err := tx.ExecContext(ctx, `
INSERT INTO live_edge_events (
  packet_hash, observation_id, payload_type, payload_type_name, message_sender, message_text, message_anchor_json,
  heard_at_ms, segments_json, render_reason, created_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.PacketHash,
		event.ObservationID,
		event.PayloadType,
		event.PayloadTypeName,
		event.MessageSender,
		event.MessageText,
		EncodeMessageAnchor(event.MessageAnchor),
		event.HeardAt,
		EncodeSegments(event.Segments),
		event.RenderReason,
		now,
	)
	if err != nil {
		return event, err
	}
	event.ID, _ = result.LastInsertId()
	region := event.IATA
	if strings.TrimSpace(region) == "" {
		_ = tx.QueryRowContext(ctx, `SELECT COALESCE(iata, '') FROM packet_observations WHERE id=?`, event.ObservationID).Scan(&region)
	}
	if _, err := insertPublicPacketPathTx(ctx, tx, event, region); err != nil {
		return event, err
	}
	if err := tx.Commit(); err != nil {
		return event, err
	}
	committed = true
	return event, nil
}

func (s *Store) RecentEdgeEvents(ctx context.Context, limit int) ([]live.EdgeEvent, error) {
	if limit <= 0 || limit > 2000 {
		limit = 200
	}
	maxHeardAt := time.Now().Add(maxFutureEdgeSkew).UnixMilli()
	rows, err := s.db.QueryContext(ctx, `
SELECT e.id, e.packet_hash, e.observation_id, COALESCE(o.iata, ''), e.payload_type, e.payload_type_name,
  e.message_sender, e.message_text, e.message_anchor_json, e.heard_at_ms, e.segments_json, e.render_reason
FROM live_edge_events e
LEFT JOIN packet_observations o ON o.id=e.observation_id
WHERE e.heard_at_ms <= ?
ORDER BY e.heard_at_ms DESC, e.id DESC
LIMIT ?`, maxHeardAt, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []live.EdgeEvent{}
	for rows.Next() {
		var item live.EdgeEvent
		var segmentsJSON string
		var messageAnchorJSON string
		if err := rows.Scan(&item.ID, &item.PacketHash, &item.ObservationID, &item.IATA, &item.PayloadType, &item.PayloadTypeName, &item.MessageSender, &item.MessageText, &messageAnchorJSON, &item.HeardAt, &segmentsJSON, &item.RenderReason); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(segmentsJSON), &item.Segments)
		if messageAnchorJSON != "" {
			var anchor live.MessageAnchor
			if err := json.Unmarshal([]byte(messageAnchorJSON), &anchor); err == nil {
				item.MessageAnchor = &anchor
			}
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return out, nil
}

func EncodeMessageAnchor(anchor *live.MessageAnchor) string {
	if anchor == nil {
		return ""
	}
	data, err := json.Marshal(anchor)
	if err != nil {
		return ""
	}
	return string(data)
}

func int64String(value int64) string {
	return strconv.FormatInt(value, 10)
}
