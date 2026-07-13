package store

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
)

const observationByIngestIDSQL = `SELECT id FROM packet_observations WHERE ingest_id = ? AND ingest_id != ''`

func (s *Store) UpsertPacket(ctx context.Context, parsed meshcore.ParsedPacket, seenAt int64) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO packets (
  packet_hash, raw_hex, route_type, route_type_name, payload_type, payload_type_name,
  payload_version, hash_size, hop_count, path_hex, payload_hex, invalid_for_map,
  invalid_reason, first_seen_ms, last_seen_ms, seen_count
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
ON CONFLICT(packet_hash) DO UPDATE SET
  last_seen_ms=excluded.last_seen_ms,
  seen_count=packets.seen_count + 1
`,
		parsed.PacketHash,
		parsed.RawHex,
		parsed.RouteType,
		parsed.RouteTypeName,
		parsed.PayloadType,
		parsed.PayloadTypeName,
		parsed.PayloadVersion,
		parsed.HashSize,
		parsed.HopCount,
		strings.ToUpper(hex.EncodeToString(parsed.PathBytes)),
		strings.ToUpper(hex.EncodeToString(parsed.Payload)),
		boolInt(parsed.InvalidForMap),
		parsed.InvalidReason,
		seenAt,
		seenAt,
	)
	return err
}

func (s *Store) UpsertPacketAndObservation(ctx context.Context, parsed meshcore.ParsedPacket, seenAt int64, in ObservationInsert) (int64, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, false, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	if in.IngestID != "" {
		var existingID int64
		err := tx.QueryRowContext(ctx, observationByIngestIDSQL, in.IngestID).Scan(&existingID)
		switch {
		case err == nil:
			if err := tx.Commit(); err != nil {
				return 0, false, err
			}
			committed = true
			return existingID, true, nil
		case !errors.Is(err, sql.ErrNoRows):
			return 0, false, err
		}
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO packets (
  packet_hash, raw_hex, route_type, route_type_name, payload_type, payload_type_name,
  payload_version, hash_size, hop_count, path_hex, payload_hex, invalid_for_map,
  invalid_reason, first_seen_ms, last_seen_ms, seen_count
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
ON CONFLICT(packet_hash) DO UPDATE SET
  last_seen_ms=excluded.last_seen_ms,
  seen_count=packets.seen_count + 1
`,
		parsed.PacketHash,
		parsed.RawHex,
		parsed.RouteType,
		parsed.RouteTypeName,
		parsed.PayloadType,
		parsed.PayloadTypeName,
		parsed.PayloadVersion,
		parsed.HashSize,
		parsed.HopCount,
		strings.ToUpper(hex.EncodeToString(parsed.PathBytes)),
		strings.ToUpper(hex.EncodeToString(parsed.Payload)),
		boolInt(parsed.InvalidForMap),
		parsed.InvalidReason,
		seenAt,
		seenAt,
	)
	if err != nil {
		return 0, false, err
	}
	now := time.Now().UnixMilli()
	result, err := tx.ExecContext(ctx, `
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
		return 0, false, err
	}
	if err := incrementObserverPacket(ctx, tx, in.Message); err != nil {
		return 0, false, err
	}
	if err := tx.Commit(); err != nil {
		return 0, false, err
	}
	committed = true
	id, err := result.LastInsertId()
	return id, false, err
}

func (s *Store) RecentPackets(ctx context.Context, limit int) ([]live.PacketObservation, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	maxHeardAt := time.Now().Add(maxFutureEdgeSkew).UnixMilli()
	rows, err := s.reader().QueryContext(ctx, `
SELECT id, packet_hash, payload_type, payload_type_name, route_type, route_type_name,
  observer_name, observer_public_key, iata, heard_at_ms, rssi, snr, score, hash_size,
  hop_count, path_hex, resolution_status, resolution_reason, summary, message_sender, message_text, invalid_for_map
FROM packet_observations
WHERE heard_at_ms <= ?
ORDER BY heard_at_ms DESC, id DESC
LIMIT ?`, maxHeardAt, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPacketObservations(rows)
}

func (s *Store) PacketByHash(ctx context.Context, packetHash string) (map[string]any, error) {
	row := s.reader().QueryRowContext(ctx, `
SELECT packet_hash, raw_hex, route_type_name, payload_type_name, payload_version,
  hash_size, hop_count, path_hex, payload_hex, invalid_for_map, invalid_reason,
  first_seen_ms, last_seen_ms, seen_count
FROM packets
WHERE packet_hash=?`, packetHash)
	var out = map[string]any{}
	var rawHex, route, payload, pathHex, payloadHex, invalidReason string
	var hash string
	var version, hashSize, hopCount, invalid, seen int
	var firstSeen, lastSeen int64
	if err := row.Scan(&hash, &rawHex, &route, &payload, &version, &hashSize, &hopCount, &pathHex, &payloadHex, &invalid, &invalidReason, &firstSeen, &lastSeen, &seen); err != nil {
		return nil, err
	}
	out["packetHash"] = hash
	out["rawHex"] = rawHex
	out["routeTypeName"] = route
	out["payloadTypeName"] = payload
	out["payloadVersion"] = version
	out["hashSize"] = hashSize
	out["hopCount"] = hopCount
	out["pathHex"] = pathHex
	out["payloadHex"] = payloadHex
	out["invalidForMap"] = invalid == 1
	out["invalidReason"] = invalidReason
	out["firstSeen"] = firstSeen
	out["lastSeen"] = lastSeen
	out["seenCount"] = seen
	return out, nil
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
