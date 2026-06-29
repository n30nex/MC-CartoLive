package app

import (
	"errors"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

func TestRuntimeCounterLogSnapshotUsesCachedStateWithoutStore(t *testing.T) {
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	cache.Replace(live.PublicLiveState{
		Stats: live.PublicStats{Packets: 123},
		Nodes: []live.PublicNode{
			{ID: "node-a", Label: "Node A"},
		},
		Routes: []live.PublicRoute{
			{ID: "route-a"},
		},
		RecentPulses: []live.PublicRoutePulse{
			{ID: "pulse-a"},
		},
		RecentActivity: []live.PublicActivity{
			{ID: "activity-a"},
		},
	}, nil)

	runtime := live.NewRuntimeStats()
	runtime.RecordCacheRefresh(13*time.Millisecond, true)
	runtime.RecordPacketCountRefresh(17*time.Millisecond, true)

	app := &Application{
		PublicCache: cache,
		Runtime:     runtime,
	}
	app.packetCount.Store(456)

	snapshot := app.runtimeCounterLogSnapshot(time.Now())
	if snapshot.PacketsTotal != 456 {
		t.Fatalf("PacketsTotal = %d, want cached packet-count override 456", snapshot.PacketsTotal)
	}
	if snapshot.PublicNodes != 1 || snapshot.PublicRoutes != 1 || snapshot.PublicRecentPulses != 1 || snapshot.PublicRecentActivity != 1 {
		t.Fatalf("public cache counts = nodes:%d routes:%d pulses:%d activity:%d, want all 1", snapshot.PublicNodes, snapshot.PublicRoutes, snapshot.PublicRecentPulses, snapshot.PublicRecentActivity)
	}
	if snapshot.CacheRefreshFailures != 1 || snapshot.CacheRefreshLatencyMs != 13 {
		t.Fatalf("cache refresh stats = failures:%d latency:%d, want 1/13", snapshot.CacheRefreshFailures, snapshot.CacheRefreshLatencyMs)
	}
	if snapshot.PacketCountRefreshFailures != 1 || snapshot.PacketCountRefreshLatencyMs != 17 {
		t.Fatalf("packet count refresh stats = failures:%d latency:%d, want 1/17", snapshot.PacketCountRefreshFailures, snapshot.PacketCountRefreshLatencyMs)
	}
}

func TestIsSQLiteBusy(t *testing.T) {
	for _, msg := range []string{
		"database is locked (5) (SQLITE_BUSY)",
		"database table is locked",
		"SQLITE_BUSY: lock conflict",
	} {
		if !isSQLiteBusy(errors.New(msg)) {
			t.Fatalf("isSQLiteBusy(%q) = false, want true", msg)
		}
	}
	if isSQLiteBusy(errors.New("syntax error")) {
		t.Fatalf("isSQLiteBusy(non-lock error) = true, want false")
	}
	if isSQLiteBusy(nil) {
		t.Fatalf("isSQLiteBusy(nil) = true, want false")
	}
}
