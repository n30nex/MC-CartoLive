package store

import (
	"context"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

type Stats struct {
	Packets             int64 `json:"packets"`
	Observations        int64 `json:"observations"`
	Nodes               int64 `json:"nodes"`
	NodesWithPosition   int64 `json:"nodesWithPosition"`
	Observers           int64 `json:"observers"`
	Ambiguous           int64 `json:"observationsAmbiguous"`
	Unresolved          int64 `json:"observationsUnresolved"`
	RoleInvalid         int64 `json:"observationsRoleInvalid"`
	EdgeEvents          int64 `json:"edgeEvents"`
	RecentWindowStartMs int64 `json:"recentWindowStartMs"`
}

func (s *Store) Stats(ctx context.Context) (Stats, error) {
	var stats Stats
	stats.RecentWindowStartMs = time.Now().Add(-10 * time.Minute).UnixMilli()
	queries := []struct {
		dest *int64
		sql  string
	}{
		{&stats.Packets, `SELECT COUNT(*) FROM packets`},
		{&stats.Observations, `SELECT COUNT(*) FROM packet_observations`},
		{&stats.Nodes, `SELECT COUNT(*) FROM nodes`},
		{&stats.NodesWithPosition, `SELECT COUNT(*) FROM nodes WHERE ` + s.coordPolicy().SQL("latitude", "longitude")},
		{&stats.Observers, `SELECT COUNT(*) FROM observers`},
		{&stats.Ambiguous, `SELECT COUNT(*) FROM packet_observations WHERE resolution_status='ambiguous'`},
		{&stats.Unresolved, `SELECT COUNT(*) FROM packet_observations WHERE resolution_status='unresolved'`},
		{&stats.RoleInvalid, `SELECT COUNT(*) FROM packet_observations WHERE resolution_status='role_invalid'`},
		{&stats.EdgeEvents, `SELECT COUNT(*) FROM live_edge_events`},
	}
	for _, q := range queries {
		if err := s.db.QueryRowContext(ctx, q.sql).Scan(q.dest); err != nil {
			return stats, err
		}
	}
	return stats, nil
}

func (s *Store) PacketCount(ctx context.Context) (int64, error) {
	var count int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM packets`).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) LiveState(ctx context.Context, packetLimit int, edgeLimit int) (live.State, error) {
	nodes, err := s.Nodes(ctx, true, "")
	if err != nil {
		return live.State{}, err
	}
	observers, err := s.Observers(ctx)
	if err != nil {
		return live.State{}, err
	}
	packets, err := s.RecentPackets(ctx, packetLimit)
	if err != nil {
		return live.State{}, err
	}
	edges, err := s.RecentEdgeEvents(ctx, edgeLimit)
	if err != nil {
		return live.State{}, err
	}
	return live.State{
		ServerTime:       time.Now().UnixMilli(),
		Nodes:            nodes,
		Observers:        observers,
		RecentPackets:    packets,
		RecentEdgeEvents: edges,
	}, nil
}
