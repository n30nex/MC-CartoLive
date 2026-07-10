package store

import (
	"context"
	"time"

	"golang.org/x/sync/errgroup"

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
		if err := s.reader().QueryRowContext(ctx, q.sql).Scan(q.dest); err != nil {
			return stats, err
		}
	}
	return stats, nil
}

func (s *Store) PacketCount(ctx context.Context) (int64, error) {
	var count int64
	if err := s.reader().QueryRowContext(ctx, `SELECT COUNT(*) FROM packets`).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) LiveState(ctx context.Context, packetLimit int, edgeLimit int) (live.State, error) {
	var state live.State
	state.ServerTime = time.Now().UnixMilli()

	g, gCtx := errgroup.WithContext(ctx)
	g.Go(func() error {
		nodes, err := s.Nodes(gCtx, true, "")
		if err != nil {
			return err
		}
		state.Nodes = nodes
		return nil
	})
	g.Go(func() error {
		observers, err := s.Observers(gCtx)
		if err != nil {
			return err
		}
		state.Observers = observers
		return nil
	})
	g.Go(func() error {
		routes, err := s.PublicRouteSummaries(gCtx, maxInt(edgeLimit, 2500))
		if err != nil {
			return err
		}
		state.Routes = routes
		return nil
	})
	g.Go(func() error {
		packets, err := s.RecentPackets(gCtx, packetLimit)
		if err != nil {
			return err
		}
		state.RecentPackets = packets
		return nil
	})
	g.Go(func() error {
		edges, err := s.RecentEdgeEvents(gCtx, edgeLimit)
		if err != nil {
			return err
		}
		state.RecentEdgeEvents = edges
		return nil
	})
	if err := g.Wait(); err != nil {
		return live.State{}, err
	}
	return state, nil
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
