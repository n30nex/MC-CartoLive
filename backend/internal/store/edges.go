package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

const maxFutureEdgeSkew = 5 * time.Minute

const edgeByIngestIDSQL = `SELECT id FROM live_edge_events WHERE ingest_id = ? AND ingest_id != ''`

func (s *Store) InsertEdgeEvent(ctx context.Context, event live.EdgeEvent, resolutionStatus, resolutionReason string) (live.EdgeEvent, error) {
	stored, err := s.InsertEdgeEventCore(ctx, event, resolutionStatus, resolutionReason)
	if err != nil {
		return stored, err
	}
	if err := s.ProjectEdgeEvent(ctx, stored); err != nil {
		return stored, err
	}
	return stored, nil
}

// InsertEdgeEventCore keeps the latency-sensitive durable path limited to the
// resolution update and idempotent edge row. Search/path and route-summary
// projections are recoverable work performed by ProjectEdgeEvent.
func (s *Store) InsertEdgeEventCore(ctx context.Context, event live.EdgeEvent, resolutionStatus, resolutionReason string) (live.EdgeEvent, error) {
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
	event, _, err = insertEdgeEventCoreTx(ctx, tx, event, resolutionStatus, resolutionReason)
	if err != nil {
		return event, err
	}
	if err := tx.Commit(); err != nil {
		return event, err
	}
	committed = true
	return event, nil
}

type LiveEdgeCommitRequest struct {
	Edge                live.EdgeEvent
	ResolutionStatus    string
	ResolutionReason    string
	PublishPublicEvents bool
	ActivityDedupeKey   string
	RoutePulseDedupeKey string
	ReceivedAtMs        int64
}

type LiveEdgeCommitResult struct {
	Edge          live.EdgeEvent
	EdgeInserted  bool
	PublicEvents  []live.PublicEvent
	EventInserted []bool
}

// CommitLiveEdge atomically commits the resolved edge and its ordered public
// activity/route-pulse cursor records. Callers may broadcast only after this
// method returns successfully.
func (s *Store) CommitLiveEdge(ctx context.Context, request LiveEdgeCommitRequest) (LiveEdgeCommitResult, error) {
	result := LiveEdgeCommitResult{Edge: request.Edge}
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
	result.Edge, result.EdgeInserted, err = insertEdgeEventCoreTx(ctx, tx, request.Edge, request.ResolutionStatus, request.ResolutionReason)
	if err != nil {
		return result, err
	}
	if request.PublishPublicEvents {
		if activity, ok := live.PublicActivityFromEdge(result.Edge); ok {
			event := live.PublicEventFromData("activity", activity)
			event.DedupeKey = strings.TrimSpace(request.ActivityDedupeKey)
			event.ReceivedAt = request.ReceivedAtMs
			result.PublicEvents = append(result.PublicEvents, event)
		}
		if pulse, ok := live.PublicRoutePulseFromEdge(result.Edge); ok {
			event := live.PublicEventFromData("routePulse", pulse)
			event.DedupeKey = strings.TrimSpace(request.RoutePulseDedupeKey)
			event.ReceivedAt = request.ReceivedAtMs
			result.PublicEvents = append(result.PublicEvents, event)
		}
		result.EventInserted = make([]bool, len(result.PublicEvents))
		for i := range result.PublicEvents {
			stored, inserted, err := insertPublicEventOnceTx(ctx, tx, result.PublicEvents[i])
			if err != nil {
				return result, err
			}
			result.PublicEvents[i], result.EventInserted[i] = stored, inserted
		}
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	committed = true
	return result, nil
}

func insertEdgeEventCoreTx(ctx context.Context, tx *sql.Tx, event live.EdgeEvent, resolutionStatus, resolutionReason string) (live.EdgeEvent, bool, error) {
	if event.IngestID != "" {
		var existingID int64
		err := tx.QueryRowContext(ctx, edgeByIngestIDSQL, event.IngestID).Scan(&existingID)
		switch {
		case err == nil:
			event.ID = existingID
			return event, false, nil
		case !errors.Is(err, sql.ErrNoRows):
			return event, false, err
		}
	}
	if resolutionStatus != "" {
		if _, err := tx.ExecContext(ctx, `
UPDATE packet_observations
SET resolution_status=?, resolution_reason=?
WHERE id=?`, resolutionStatus, resolutionReason, event.ObservationID); err != nil {
			return event, false, err
		}
	}
	result, err := tx.ExecContext(ctx, `
INSERT INTO live_edge_events (
  ingest_id, packet_hash, observation_id, payload_type, payload_type_name, message_sender, message_text, message_anchor_json,
  heard_at_ms, segments_json, render_reason, created_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.IngestID,
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
		time.Now().UnixMilli(),
	)
	if err != nil {
		return event, false, err
	}
	if id, err := result.LastInsertId(); err == nil {
		event.ID = id
	}
	return event, true, nil
}

func (s *Store) ProjectEdgeEvent(ctx context.Context, event live.EdgeEvent) error {
	if event.ID <= 0 {
		return nil
	}
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
	region := event.IATA
	if strings.TrimSpace(region) == "" {
		if rowErr := tx.QueryRowContext(ctx, `SELECT COALESCE(iata, '') FROM packet_observations WHERE id=?`, event.ObservationID).Scan(&region); rowErr != nil {
			region = ""
		}
	}
	if _, err := insertPublicPacketPathTx(ctx, tx, event, region); err != nil {
		return err
	}
	if err := upsertPublicRouteSummariesTx(ctx, tx, event); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func (s *Store) RecentEdgeEvents(ctx context.Context, limit int) ([]live.EdgeEvent, error) {
	if limit <= 0 || limit > 2000 {
		limit = 200
	}
	maxHeardAt := time.Now().Add(maxFutureEdgeSkew).UnixMilli()
	rows, err := s.reader().QueryContext(ctx, `
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
		if err := json.Unmarshal([]byte(segmentsJSON), &item.Segments); err != nil {
			slog.Default().Warn("edge segments unmarshal failed", "error", err)
		}
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
