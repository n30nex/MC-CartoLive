package store

import (
	"context"
	"database/sql"
	"encoding/hex"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	mq "meshcore-canada-live-map/backend/internal/mqtt"
)

type ObservationInsert struct {
	IngestID      string
	Message       mq.NormalizedMessage
	Parsed        meshcore.ParsedPacket
	Summary       string
	MessageSender string
	MessageText   string
}

func (s *Store) InsertObservation(ctx context.Context, in ObservationInsert) (int64, error) {
	now := time.Now().UnixMilli()
	result, err := s.db.ExecContext(ctx, `
INSERT INTO packet_observations (
  ingest_id, packet_hash, topic, iata, observer_public_key, observer_name, raw_json, heard_at_ms,
  rssi, snr, score, route_type, route_type_name, payload_type, payload_type_name,
  payload_version, hash_size, hop_count, path_hex, payload_hex, resolution_status,
  resolution_reason, invalid_for_map, summary, message_sender, message_text, created_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.IngestID,
		in.Parsed.PacketHash,
		in.Message.Topic,
		in.Message.TopicInfo.IATA,
		in.Message.TopicInfo.PublisherPK,
		in.Message.ObserverName,
		in.Message.RawJSON,
		in.Message.HeardAtMs,
		nullableFloat(in.Message.RSSI),
		nullableFloat(in.Message.SNR),
		nullableFloat(in.Message.Score),
		in.Parsed.RouteType,
		in.Parsed.RouteTypeName,
		in.Parsed.PayloadType,
		in.Parsed.PayloadTypeName,
		in.Parsed.PayloadVersion,
		in.Parsed.HashSize,
		in.Parsed.HopCount,
		strings.ToUpper(hex.EncodeToString(in.Parsed.PathBytes)),
		strings.ToUpper(hex.EncodeToString(in.Parsed.Payload)),
		"unresolved",
		"",
		boolInt(in.Parsed.InvalidForMap),
		in.Summary,
		in.MessageSender,
		in.MessageText,
		now,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) UpdateObservationResolution(ctx context.Context, id int64, status, reason string) error {
	_, err := s.db.ExecContext(ctx, `
UPDATE packet_observations
SET resolution_status=?, resolution_reason=?
WHERE id=?`, status, reason, id)
	return err
}

type NonEdgeActivityCommitRequest struct {
	ObservationID      int64
	ResolutionStatus   string
	ResolutionReason   string
	PublishPublicEvent bool
	Activity           live.PublicActivity
	DedupeKey          string
	ReceivedAtMs       int64
}

type NonEdgeActivityCommitResult struct {
	PublicEvent   live.PublicEvent
	EventPresent  bool
	EventInserted bool
}

// CommitNonEdgeActivity atomically records the final non-route resolution and
// the activity cursor row used by PacketTV/observer animation. Nothing may be
// broadcast until this transaction succeeds.
func (s *Store) CommitNonEdgeActivity(ctx context.Context, request NonEdgeActivityCommitRequest) (NonEdgeActivityCommitResult, error) {
	result := NonEdgeActivityCommitResult{}
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
	if _, err := tx.ExecContext(ctx, `
UPDATE packet_observations
SET resolution_status=?, resolution_reason=?
WHERE id=?`, request.ResolutionStatus, request.ResolutionReason, request.ObservationID); err != nil {
		return result, err
	}
	if request.PublishPublicEvent {
		event := live.PublicEventFromData("activity", request.Activity)
		event.DedupeKey = strings.TrimSpace(request.DedupeKey)
		event.ReceivedAt = request.ReceivedAtMs
		stored, inserted, err := insertPublicEventOnceTx(ctx, tx, event)
		if err != nil {
			return result, err
		}
		result.PublicEvent = stored
		result.EventPresent = true
		result.EventInserted = inserted
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	committed = true
	return result, nil
}

func (s *Store) ObservationByID(ctx context.Context, id int64) (live.PacketObservation, error) {
	rows, err := s.reader().QueryContext(ctx, `
SELECT id, packet_hash, payload_type, payload_type_name, route_type, route_type_name,
  observer_name, observer_public_key, iata, heard_at_ms, rssi, snr, score, hash_size,
  hop_count, path_hex, resolution_status, resolution_reason, summary, message_sender, message_text, invalid_for_map
FROM packet_observations
WHERE id=?`, id)
	if err != nil {
		return live.PacketObservation{}, err
	}
	defer rows.Close()
	items, err := scanPacketObservations(rows)
	if err != nil {
		return live.PacketObservation{}, err
	}
	if len(items) == 0 {
		return live.PacketObservation{}, sql.ErrNoRows
	}
	return items[0], nil
}

func (s *Store) ResolutionDebug(ctx context.Context, status string, limit int) ([]live.PacketObservation, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	args := []any{limit}
	query := `
SELECT id, packet_hash, payload_type, payload_type_name, route_type, route_type_name,
  observer_name, observer_public_key, iata, heard_at_ms, rssi, snr, score, hash_size,
  hop_count, path_hex, resolution_status, resolution_reason, summary, message_sender, message_text, invalid_for_map
FROM packet_observations`
	if status != "" {
		query += ` WHERE resolution_status=?`
		args = []any{status, limit}
	}
	query += ` ORDER BY heard_at_ms DESC, id DESC LIMIT ?`
	rows, err := s.reader().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPacketObservations(rows)
}

func scanPacketObservations(rows *sql.Rows) ([]live.PacketObservation, error) {
	out := []live.PacketObservation{}
	for rows.Next() {
		var item live.PacketObservation
		var rssi, snr, score sql.NullFloat64
		var invalid int
		if err := rows.Scan(
			&item.ID,
			&item.PacketHash,
			&item.PayloadType,
			&item.PayloadTypeName,
			&item.RouteType,
			&item.RouteTypeName,
			&item.ObserverName,
			&item.ObserverPublicKey,
			&item.IATA,
			&item.HeardAt,
			&rssi,
			&snr,
			&score,
			&item.HashSize,
			&item.HopCount,
			&item.PathHex,
			&item.ResolutionStatus,
			&item.ResolutionReason,
			&item.Summary,
			&item.MessageSender,
			&item.MessageText,
			&invalid,
		); err != nil {
			return nil, err
		}
		item.RSSI = floatPtr(rssi)
		item.SNR = floatPtr(snr)
		item.Score = floatPtr(score)
		item.InvalidForMap = invalid == 1
		out = append(out, item)
	}
	return out, rows.Err()
}
