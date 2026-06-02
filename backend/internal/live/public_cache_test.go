package live

import (
	"testing"
	"time"
)

func TestPublicCacheStatusReportsTruncation(t *testing.T) {
	cache := NewPublicStateCache(NewPublicIATAFilter(nil))
	state := PublicLiveState{
		Nodes:          make([]PublicNode, publicCacheMaxNodes+3),
		Routes:         make([]PublicRoute, publicCacheMaxRoutes+2),
		RecentPulses:   make([]PublicRoutePulse, publicCacheMaxPulses+5),
		RecentActivity: make([]PublicActivity, publicCacheMaxActivity+7),
	}
	for i := range state.Nodes {
		state.Nodes[i].ID = string(rune('a' + (i % 26)))
	}

	cache.Replace(state, nil)
	snapshot, ok := cache.Snapshot()
	if !ok {
		t.Fatal("cache should be ready after replace")
	}
	if len(snapshot.Nodes) != publicCacheMaxNodes || len(snapshot.Routes) != publicCacheMaxRoutes {
		t.Fatalf("snapshot limits = nodes %d routes %d", len(snapshot.Nodes), len(snapshot.Routes))
	}
	status := cache.Status(time.Now())
	if status.TruncatedNodes != 3 ||
		status.TruncatedRoutes != 2 ||
		status.TruncatedRecentPulses != 5 ||
		status.TruncatedRecentActivity != 7 {
		t.Fatalf("truncation status = %#v", status)
	}
}

func TestRuntimeStatsRecordsPacketPressure(t *testing.T) {
	stats := NewRuntimeStats()
	stats.RecordPublicPacketsScan(2500, true)
	stats.RecordPublicPacketsProjection(true, true, false)
	stats.RecordPublicPacketsProjection(false, false, true)
	stats.RecordPublicPacketsSearchMode("projectedFts")
	stats.RecordPublicPacketsSearchMode("projectedSubstring")
	stats.RecordPublicPacketsSearchMode("none")
	stats.RecordPacketCountRefresh(12*time.Millisecond, true)
	stats.RecordPacketPathBackfill(9*time.Millisecond, true, 4, 3, 2, 1, 6, true, true)

	snapshot := stats.Snapshot()
	if snapshot.PublicPacketsLastScan != 2500 || snapshot.PublicPacketsScanCapped != 1 {
		t.Fatalf("packet scan stats = %#v", snapshot)
	}
	if snapshot.PublicPacketsProjectionServed != 1 ||
		snapshot.PublicPacketsProjectionFallback != 1 ||
		snapshot.PublicPacketsProjectionErrors != 1 ||
		snapshot.PublicPacketsProjectionLastAtMs <= 0 ||
		snapshot.PublicPacketsProjectionComplete {
		t.Fatalf("packet projection stats = %#v", snapshot)
	}
	if snapshot.PublicPacketsSearchFTS != 1 || snapshot.PublicPacketsSearchSubstring != 1 || snapshot.PublicPacketsSearchNoQuery != 1 {
		t.Fatalf("packet search stats = %#v", snapshot)
	}
	if snapshot.PacketCountRefreshFailures != 1 || snapshot.PacketCountRefreshLastLatencyMs != 12 || snapshot.PacketCountRefreshLastAtMs <= 0 {
		t.Fatalf("packet count refresh stats = %#v", snapshot)
	}
	if snapshot.PacketPathBackfillFailures != 1 ||
		snapshot.PacketPathBackfillLastLatencyMs != 9 ||
		snapshot.PacketPathBackfillLastAtMs <= 0 ||
		snapshot.PacketPathBackfillLastScanned != 4 ||
		snapshot.PacketPathBackfillLastProjected != 3 ||
		snapshot.PacketPathBackfillLastMappable != 2 ||
		snapshot.PacketPathBackfillLastInvalid != 1 ||
		snapshot.PacketPathSearchIndexLastSync != 6 ||
		!snapshot.PacketPathSearchIndexRemaining ||
		!snapshot.PacketPathBackfillRemaining {
		t.Fatalf("packet path backfill stats = %#v", snapshot)
	}
}
