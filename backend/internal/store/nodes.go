package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	mq "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/resolve"
)

func (s *Store) UpsertAdvertNode(ctx context.Context, iata string, advert meshcore.Advert, heardAt int64) (live.Node, error) {
	finishCandidateMutation := s.beginCandidateMutation()
	defer finishCandidateMutation()
	nodeID := uuid.NewString()
	name := advert.Name
	lat, lng := s.nullableMapLatLng(advert.Latitude, advert.Longitude)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO nodes (
  node_id, public_key, name, node_type, role, latitude, longitude, location_source,
  first_seen_ms, last_seen_ms, observation_count, supports_multibyte
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
ON CONFLICT(public_key) DO UPDATE SET
  name=CASE WHEN excluded.name != '' THEN excluded.name ELSE nodes.name END,
  node_type=CASE WHEN excluded.node_type != 0 THEN excluded.node_type ELSE nodes.node_type END,
  role=CASE WHEN excluded.role != 'unknown' THEN excluded.role ELSE nodes.role END,
  latitude=COALESCE(excluded.latitude, nodes.latitude),
  longitude=COALESCE(excluded.longitude, nodes.longitude),
  location_source=CASE WHEN excluded.location_source != '' THEN excluded.location_source ELSE nodes.location_source END,
  last_seen_ms=excluded.last_seen_ms,
  observation_count=nodes.observation_count + 1,
  supports_multibyte=excluded.supports_multibyte
`,
		nodeID,
		advert.PublicKey,
		name,
		advert.NodeType,
		advert.Role,
		lat,
		lng,
		advert.LocationSource,
		heardAt,
		heardAt,
		"known",
	)
	if err != nil {
		return live.Node{}, err
	}
	if err := s.upsertNodeIATA(ctx, advert.PublicKey, iata, heardAt); err != nil {
		return live.Node{}, err
	}
	if err := s.upsertShortIDs(ctx, advert.PublicKey, iata, advert.Role, heardAt); err != nil {
		return live.Node{}, err
	}
	return s.NodeByPublicKey(ctx, advert.PublicKey)
}

func (s *Store) UpsertObserver(ctx context.Context, msg mq.NormalizedMessage) error {
	if msg.TopicInfo.Subtopic == "status" {
		finishCandidateMutation := s.beginCandidateMutation()
		defer finishCandidateMutation()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	lat, lng := mq.StatusLatLng(msg.Payload)
	dbLat, dbLng := s.nullableMapLatLng(lat, lng)
	name := msg.ObserverName
	if name == "" {
		name = firstPayloadString(msg.Payload, "origin", "name", "node_name")
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO observers (public_key, iata, name, latitude, longitude, last_seen_ms, packet_count, status_json)
VALUES (?, ?, ?, ?, ?, ?, 1, ?)
ON CONFLICT(public_key, iata) DO UPDATE SET
  name=CASE WHEN excluded.name != '' THEN excluded.name ELSE observers.name END,
  latitude=COALESCE(excluded.latitude, observers.latitude),
  longitude=COALESCE(excluded.longitude, observers.longitude),
  last_seen_ms=excluded.last_seen_ms,
  packet_count=observers.packet_count + 1,
  status_json=excluded.status_json
`,
		msg.TopicInfo.PublisherPK,
		msg.TopicInfo.IATA,
		name,
		dbLat,
		dbLng,
		msg.HeardAtMs,
		msg.RawJSON,
	)
	if err != nil {
		return err
	}
	if msg.TopicInfo.Subtopic == "status" {
		_, err = tx.ExecContext(ctx, `
INSERT INTO observer_status (public_key, iata, status_json, received_at_ms)
VALUES (?, ?, ?, ?)`,
			msg.TopicInfo.PublisherPK, msg.TopicInfo.IATA, msg.RawJSON, msg.HeardAtMs)
		if err != nil {
			return err
		}
		if err = s.upsertStatusNode(ctx, tx, msg, name, lat, lng); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return nil
}

func (s *Store) upsertStatusNode(ctx context.Context, tx *sql.Tx, msg mq.NormalizedMessage, name string, lat, lng *float64) error {
	role, nodeType := observerRole(msg.Payload, name)
	locationSource := ""
	dbLat, dbLng := s.nullableMapLatLng(lat, lng)
	if dbLat.Valid && dbLng.Valid {
		locationSource = "status"
	}
	_, err := tx.ExecContext(ctx, `
INSERT INTO nodes (
  node_id, public_key, name, node_type, role, latitude, longitude, location_source,
  first_seen_ms, last_seen_ms, observation_count, supports_multibyte
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'unknown')
ON CONFLICT(public_key) DO UPDATE SET
  name=CASE WHEN excluded.name != '' THEN excluded.name ELSE nodes.name END,
  node_type=CASE WHEN excluded.node_type != 0 THEN excluded.node_type ELSE nodes.node_type END,
  role=CASE WHEN excluded.role != 'unknown' THEN excluded.role ELSE nodes.role END,
  latitude=COALESCE(excluded.latitude, nodes.latitude),
  longitude=COALESCE(excluded.longitude, nodes.longitude),
  location_source=CASE WHEN excluded.location_source != '' THEN excluded.location_source ELSE nodes.location_source END,
  last_seen_ms=excluded.last_seen_ms,
  observation_count=nodes.observation_count + 1
`,
		uuid.NewString(),
		msg.TopicInfo.PublisherPK,
		name,
		nodeType,
		role,
		dbLat,
		dbLng,
		locationSource,
		msg.HeardAtMs,
		msg.HeardAtMs,
	)
	if err != nil {
		return err
	}
	if err := s.upsertNodeIATAWithTx(ctx, tx, msg.TopicInfo.PublisherPK, msg.TopicInfo.IATA, msg.HeardAtMs); err != nil {
		return err
	}
	return s.upsertShortIDsWithTx(ctx, tx, msg.TopicInfo.PublisherPK, msg.TopicInfo.IATA, role, msg.HeardAtMs)
}

func (s *Store) IncrementObserverPacket(ctx context.Context, msg mq.NormalizedMessage) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO observers (public_key, iata, name, last_seen_ms, packet_count, status_json)
VALUES (?, ?, ?, ?, 1, '')
ON CONFLICT(public_key, iata) DO UPDATE SET
  name=CASE WHEN excluded.name != '' THEN excluded.name ELSE observers.name END,
  last_seen_ms=excluded.last_seen_ms,
  packet_count=observers.packet_count + 1
`,
		msg.TopicInfo.PublisherPK,
		msg.TopicInfo.IATA,
		msg.ObserverName,
		msg.HeardAtMs,
	)
	return err
}

func (s *Store) NodeByPublicKey(ctx context.Context, publicKey string) (live.Node, error) {
	rows, err := s.reader().QueryContext(ctx, `
SELECT node_id, public_key, name, node_type, role, latitude, longitude, location_source,
  first_seen_ms, last_seen_ms, observation_count, supports_multibyte
FROM nodes WHERE public_key=?`, strings.ToUpper(publicKey))
	if err != nil {
		return live.Node{}, err
	}
	defer rows.Close()
	nodes, err := s.scanNodes(ctx, rows)
	if err != nil {
		return live.Node{}, err
	}
	if len(nodes) == 0 {
		return live.Node{}, sql.ErrNoRows
	}
	return nodes[0], nil
}

func (s *Store) NodeByID(ctx context.Context, nodeID string) (live.Node, error) {
	rows, err := s.reader().QueryContext(ctx, `
SELECT n.node_id, n.public_key, n.name, n.node_type, n.role, n.latitude, n.longitude,
       n.location_source, n.first_seen_ms, n.last_seen_ms, n.observation_count, n.supports_multibyte
FROM nodes n
WHERE n.node_id = ? OR n.public_key = UPPER(?)
LIMIT 1`, nodeID, nodeID)
	if err != nil {
		return live.Node{}, err
	}
	defer rows.Close()
	nodes, err := s.scanNodes(ctx, rows)
	if err != nil {
		return live.Node{}, err
	}
	if len(nodes) == 0 {
		return live.Node{}, sql.ErrNoRows
	}
	return nodes[0], nil
}

func (s *Store) Nodes(ctx context.Context, positioned bool, iata string) ([]live.Node, error) {
	query := `
SELECT DISTINCT n.node_id, n.public_key, n.name, n.node_type, n.role, n.latitude, n.longitude,
  n.location_source, n.first_seen_ms, n.last_seen_ms, n.observation_count, n.supports_multibyte
FROM nodes n`
	args := []any{}
	where := []string{}
	if iata != "" {
		query += ` JOIN node_iatas ni ON ni.public_key=n.public_key`
		where = append(where, `ni.iata=?`)
		args = append(args, strings.ToUpper(iata))
	}
	if positioned {
		where = append(where, s.coordPolicy().SQL("n.latitude", "n.longitude"))
	}
	if len(where) > 0 {
		query += ` WHERE ` + strings.Join(where, ` AND `)
	}
	query += ` ORDER BY n.last_seen_ms DESC LIMIT 2000`
	rows, err := s.reader().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.scanNodes(ctx, rows)
}

func (s *Store) Observers(ctx context.Context) ([]live.Observer, error) {
	rows, err := s.reader().QueryContext(ctx, `
SELECT public_key, iata, name, latitude, longitude, last_seen_ms, packet_count, status_json
FROM observers ORDER BY last_seen_ms DESC LIMIT 1000`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []live.Observer{}
	for rows.Next() {
		var item live.Observer
		var lat, lng sql.NullFloat64
		if err := rows.Scan(&item.PublicKey, &item.IATA, &item.Name, &lat, &lng, &item.LastSeen, &item.PacketCount, &item.StatusJSON); err != nil {
			return nil, err
		}
		item.Latitude = floatPtr(lat)
		item.Longitude = floatPtr(lng)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) ObserverByPublicKeyIATA(ctx context.Context, publicKey string, iata string) (live.Observer, error) {
	rows, err := s.reader().QueryContext(ctx, `
SELECT public_key, iata, name, latitude, longitude, last_seen_ms, packet_count, status_json
FROM observers WHERE public_key=? AND iata=?`,
		strings.ToUpper(publicKey), strings.ToUpper(iata))
	if err != nil {
		return live.Observer{}, err
	}
	defer rows.Close()
	out := []live.Observer{}
	for rows.Next() {
		var item live.Observer
		var lat, lng sql.NullFloat64
		if err := rows.Scan(&item.PublicKey, &item.IATA, &item.Name, &lat, &lng, &item.LastSeen, &item.PacketCount, &item.StatusJSON); err != nil {
			return live.Observer{}, err
		}
		item.Latitude = floatPtr(lat)
		item.Longitude = floatPtr(lng)
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return live.Observer{}, err
	}
	if len(out) == 0 {
		return live.Observer{}, sql.ErrNoRows
	}
	return out[0], nil
}

func (s *Store) CandidatesByPrefix(ctx context.Context, iata string, hashSize int, prefix string) ([]resolve.Candidate, error) {
	rows, err := s.reader().QueryContext(ctx, `
SELECT n.node_id, n.public_key, n.name, n.role, si.iata, n.latitude, n.longitude
FROM node_short_ids si
JOIN nodes n ON n.public_key=si.public_key
WHERE si.iata=? AND si.hash_size=? AND si.prefix_hex=?
ORDER BY n.last_seen_ms DESC`,
		strings.ToUpper(iata), hashSize, strings.ToUpper(prefix))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []resolve.Candidate{}
	for rows.Next() {
		var c resolve.Candidate
		var lat, lng sql.NullFloat64
		if err := rows.Scan(&c.NodeID, &c.PublicKey, &c.Name, &c.Role, &c.IATA, &lat, &lng); err != nil {
			return nil, err
		}
		c.Latitude = floatPtr(lat)
		c.Longitude = floatPtr(lng)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) Collisions(ctx context.Context, iata string, hashSize int, limit int) ([]map[string]any, error) {
	if hashSize <= 0 {
		hashSize = 1
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := `
SELECT si.iata, si.hash_size, si.prefix_hex, COUNT(*) AS candidate_count,
  GROUP_CONCAT(n.name || ':' || n.role || ':' || substr(n.public_key, 1, 8), '; ') AS candidates
FROM node_short_ids si
JOIN nodes n ON n.public_key=si.public_key
WHERE si.hash_size=?`
	args := []any{hashSize}
	if iata != "" {
		query += ` AND si.iata=?`
		args = append(args, strings.ToUpper(iata))
	}
	query += `
GROUP BY si.iata, si.hash_size, si.prefix_hex
HAVING COUNT(*) > 1
ORDER BY candidate_count DESC, si.iata, si.prefix_hex
LIMIT ?`
	args = append(args, limit)
	rows, err := s.reader().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var iataOut, prefix, candidates string
		var size, count int
		if err := rows.Scan(&iataOut, &size, &prefix, &count, &candidates); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"iata": iataOut, "hashSize": size, "prefixHex": prefix,
			"candidateCount": count, "candidates": candidates,
		})
	}
	return out, rows.Err()
}

func (s *Store) scanNodes(ctx context.Context, rows *sql.Rows) ([]live.Node, error) {
	out := []live.Node{}
	for rows.Next() {
		var item live.Node
		var lat, lng sql.NullFloat64
		if err := rows.Scan(
			&item.NodeID,
			&item.PublicKey,
			&item.Name,
			&item.NodeType,
			&item.Role,
			&lat,
			&lng,
			&item.LocationSource,
			&item.FirstSeen,
			&item.LastSeen,
			&item.ObservationCount,
			&item.SupportsMultibyte,
		); err != nil {
			return nil, err
		}
		item.Latitude = floatPtr(lat)
		item.Longitude = floatPtr(lng)
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	iatasByPublicKey, err := s.nodeIATAsForPublicKeys(ctx, nodePublicKeys(out))
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].IATAsHeardIn = iatasByPublicKey[strings.ToUpper(out[i].PublicKey)]
	}
	return out, nil
}

func nodePublicKeys(nodes []live.Node) []string {
	out := make([]string, 0, len(nodes))
	for _, node := range nodes {
		if node.PublicKey != "" {
			out = append(out, node.PublicKey)
		}
	}
	return out
}

func (s *Store) upsertNodeIATA(ctx context.Context, publicKey, iata string, seenAt int64) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO node_iatas (public_key, iata, first_seen_ms, last_seen_ms, observation_count)
VALUES (?, ?, ?, ?, 1)
ON CONFLICT(public_key, iata) DO UPDATE SET
  last_seen_ms=excluded.last_seen_ms,
  observation_count=node_iatas.observation_count + 1`,
		publicKey, strings.ToUpper(iata), seenAt, seenAt)
	return err
}

func (s *Store) upsertShortIDs(ctx context.Context, publicKey, iata, role string, seenAt int64) error {
	pk := strings.ToUpper(publicKey)
	for size := 1; size <= 3; size++ {
		if len(pk) < size*2 {
			continue
		}
		prefix := pk[:size*2]
		if _, err := s.db.ExecContext(ctx, `
INSERT INTO node_short_ids (public_key, iata, hash_size, prefix_hex, role, updated_at_ms)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(public_key, iata, hash_size, prefix_hex) DO UPDATE SET
  role=excluded.role,
  updated_at_ms=excluded.updated_at_ms`,
			pk, strings.ToUpper(iata), size, prefix, role, seenAt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) upsertNodeIATAWithTx(ctx context.Context, tx *sql.Tx, publicKey, iata string, seenAt int64) error {
	_, err := tx.ExecContext(ctx, `
INSERT INTO node_iatas (public_key, iata, first_seen_ms, last_seen_ms, observation_count)
VALUES (?, ?, ?, ?, 1)
ON CONFLICT(public_key, iata) DO UPDATE SET
  last_seen_ms=excluded.last_seen_ms,
  observation_count=node_iatas.observation_count + 1`,
		publicKey, strings.ToUpper(iata), seenAt, seenAt)
	return err
}

func (s *Store) upsertShortIDsWithTx(ctx context.Context, tx *sql.Tx, publicKey, iata, role string, seenAt int64) error {
	pk := strings.ToUpper(publicKey)
	for size := 1; size <= 3; size++ {
		if len(pk) < size*2 {
			continue
		}
		prefix := pk[:size*2]
		if _, err := tx.ExecContext(ctx, `
INSERT INTO node_short_ids (public_key, iata, hash_size, prefix_hex, role, updated_at_ms)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(public_key, iata, hash_size, prefix_hex) DO UPDATE SET
  role=excluded.role,
  updated_at_ms=excluded.updated_at_ms`,
			pk, strings.ToUpper(iata), size, prefix, role, seenAt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) nodeIATAsForPublicKeys(ctx context.Context, publicKeys []string) (map[string][]string, error) {
	out := map[string][]string{}
	const chunkSize = 500
	for start := 0; start < len(publicKeys); start += chunkSize {
		end := start + chunkSize
		if end > len(publicKeys) {
			end = len(publicKeys)
		}
		chunk := publicKeys[start:end]
		placeholders := strings.TrimRight(strings.Repeat("?,", len(chunk)), ",")
		args := make([]any, 0, len(chunk))
		for _, publicKey := range chunk {
			args = append(args, publicKey)
		}
		rows, err := s.reader().QueryContext(ctx, `SELECT public_key, iata FROM node_iatas WHERE public_key IN (`+placeholders+`) ORDER BY public_key, iata`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var publicKey string
			var iata string
			if err := rows.Scan(&publicKey, &iata); err != nil {
				_ = rows.Close()
				return nil, err
			}
			out[strings.ToUpper(publicKey)] = append(out[strings.ToUpper(publicKey)], iata)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func firstPayloadString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			if s, ok := v.(string); ok {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func observerRole(m map[string]any, name string) (string, int) {
	text := strings.ToLower(name + " " +
		firstPayloadString(m, "role") + " " +
		firstPayloadString(m, "node_type") + " " +
		firstPayloadString(m, "type") + " " +
		firstPayloadString(m, "model") + " " +
		firstPayloadString(m, "client_version") + " " +
		firstPayloadString(m, "firmware_version"))
	switch {
	case roleWordMatch(text, "repeater", "pymc_repeater", "pymc-repeater"):
		return "repeater", 2
	case roleWordMatch(text, "room_server", "room-server", "room server"):
		return "room_server", 3
	case roleWordMatch(text, "companion", "chat node"):
		return "companion", 1
	case roleWordMatch(text, "sensor"):
		return "sensor", 4
	default:
		return "unknown", 0
	}
}

func roleWordMatch(text string, words ...string) bool {
	for _, word := range words {
		if idx := strings.Index(text, word); idx >= 0 {
			end := idx + len(word)
			before := idx == 0 || text[idx-1] == ' ' || text[idx-1] == '_' || text[idx-1] == '-'
			after := end >= len(text) || text[end] == ' ' || text[end] == '_' || text[end] == '-'
			if before && after {
				return true
			}
		}
	}
	return false
}

func (s *Store) ApplyManualNode(ctx context.Context, publicKey, name string, lat, lng float64, source string) error {
	if !s.validMapCoords(lat, lng) {
		return fmt.Errorf("manual node coordinates outside valid map bounds")
	}
	finishCandidateMutation := s.beginCandidateMutation()
	defer finishCandidateMutation()
	now := time.Now().UnixMilli()
	role := "repeater"
	if source == "" {
		source = "operator-config"
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO nodes (node_id, public_key, name, node_type, role, latitude, longitude, location_source, first_seen_ms, last_seen_ms, supports_multibyte)
VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?, ?, 'manual')
ON CONFLICT(public_key) DO UPDATE SET
  name=CASE WHEN excluded.name != '' THEN excluded.name ELSE nodes.name END,
  latitude=excluded.latitude,
  longitude=excluded.longitude,
  location_source=excluded.location_source,
  last_seen_ms=excluded.last_seen_ms`,
		uuid.NewString(), strings.ToUpper(publicKey), name, role, lat, lng, source, now, now)
	return err
}

func EncodeSegments(segments []live.EdgeSegment) string {
	b, _ := json.Marshal(segments)
	return string(b)
}

func (s *Store) nullableMapLatLng(lat, lng *float64) (sql.NullFloat64, sql.NullFloat64) {
	if lat == nil || lng == nil || !s.validMapCoords(*lat, *lng) {
		return sql.NullFloat64{}, sql.NullFloat64{}
	}
	return nullableFloat(lat), nullableFloat(lng)
}

func (s *Store) validMapCoords(lat float64, lng float64) bool {
	return s.coordPolicy().Valid(lat, lng)
}
