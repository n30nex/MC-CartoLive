package live

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"testing"
	"time"
)

func TestPublicCachePublishesReusableJSONGzipAndETag(t *testing.T) {
	cache := NewPublicStateCache(NewPublicIATAFilter(nil))
	cache.Replace(PublicLiveState{
		Stats: PublicStats{Packets: 12},
		Nodes: []PublicNode{{ID: "safe-node", Label: "Safe", Latitude: 43.6, Longitude: -79.3}},
	}, nil)
	serialized, ok := cache.Serialized()
	if !ok || len(serialized.JSON) == 0 || len(serialized.Gzip) == 0 || serialized.ETag == "" {
		t.Fatalf("serialized cache unavailable: %#v", serialized)
	}
	if !json.Valid(serialized.JSON) {
		t.Fatalf("cached JSON is invalid: %s", serialized.JSON)
	}
	reader, err := gzip.NewReader(bytes.NewReader(serialized.Gzip))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decoded, serialized.JSON) {
		t.Fatal("cached gzip does not decode to cached JSON")
	}
}

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

func TestPublicCacheLiveUpdatesAdvanceSnapshotSequenceMonotonically(t *testing.T) {
	cache := NewPublicStateCache(NewPublicIATAFilter(nil))
	cache.Replace(PublicLiveState{Stats: PublicStats{LatestSeq: 10}}, nil)

	cache.ApplyNode(PublicNode{ID: "node-1", Seq: 11})
	cache.ApplyActivity(PublicActivity{ID: "activity-1", Seq: 13, HeardAt: 13})
	cache.ApplyRoutePulse(PublicRoutePulse{ID: "pulse-1", Seq: 12, HeardAt: 12})

	snapshot, ok := cache.Snapshot()
	if !ok {
		t.Fatal("cache should remain ready after live updates")
	}
	if snapshot.Stats.LatestSeq != 13 {
		t.Fatalf("latestSeq=%d want 13", snapshot.Stats.LatestSeq)
	}
}

func TestPublicCacheReconcilePreservesConcurrentLiveMutations(t *testing.T) {
	cache := NewPublicStateCache(NewPublicIATAFilter(nil))
	cache.Replace(PublicLiveState{
		ServerTime: 100,
		Stats:      PublicStats{LatestSeq: 10, Packets: 10},
		Nodes:      []PublicNode{{ID: "node-existing", LastSeen: 100}},
	}, nil)
	reconcileGeneration := cache.MutationGeneration()

	cache.ApplyNode(PublicNode{ID: "node-live", Seq: 11, LastSeen: 200})
	cache.ApplyActivity(PublicActivity{ID: "activity-live", Kind: "packet", Seq: 12, HeardAt: 200})
	cache.ApplyRoutePulse(PublicRoutePulse{ID: "pulse-live", Seq: 13, HeardAt: 200})

	preserved := cache.ReplacePreservingMutations(PublicLiveState{
		ServerTime: 150,
		Stats:      PublicStats{LatestSeq: 10, Packets: 10},
		Nodes:      []PublicNode{{ID: "node-existing", LastSeen: 150}},
		Routes:     []PublicRoute{{ID: "route-from-database"}},
		RecentActivity: []PublicActivity{
			{ID: "activity-from-database", Kind: "packet", HeardAt: 150},
		},
	}, nil, reconcileGeneration)
	if !preserved {
		t.Fatal("reconcile did not detect concurrent live mutations")
	}
	snapshot, ok := cache.Snapshot()
	if !ok {
		t.Fatal("cache should remain ready")
	}
	if snapshot.Stats.LatestSeq != 13 || snapshot.ServerTime != 200 {
		t.Fatalf("latest/server=%d/%d, want 13/200", snapshot.Stats.LatestSeq, snapshot.ServerTime)
	}
	if len(snapshot.Nodes) != 2 || snapshot.Nodes[0].ID != "node-live" {
		t.Fatalf("concurrent node was erased or misordered: %#v", snapshot.Nodes)
	}
	if len(snapshot.RecentActivity) != 2 || snapshot.RecentActivity[0].ID != "activity-live" {
		t.Fatalf("concurrent activity was erased or misordered: %#v", snapshot.RecentActivity)
	}
	if len(snapshot.RecentPulses) != 1 || snapshot.RecentPulses[0].ID != "pulse-live" {
		t.Fatalf("concurrent pulse was erased: %#v", snapshot.RecentPulses)
	}
	if len(snapshot.Routes) != 1 || snapshot.Routes[0].ID != "route-from-database" {
		t.Fatalf("fresh database routes were not reconciled: %#v", snapshot.Routes)
	}
}

func TestPublicCacheReconcileDoesNotResurrectUnrelatedStaleState(t *testing.T) {
	cache := NewPublicStateCache(NewPublicIATAFilter(nil))
	cache.Replace(PublicLiveState{
		Stats:        PublicStats{LatestSeq: 20, Packets: 20},
		Nodes:        []PublicNode{{ID: "node-expired", LastSeen: 100}},
		RecentPulses: []PublicRoutePulse{{ID: "pulse-expired", HeardAt: 100}},
	}, nil)
	reconcileGeneration := cache.MutationGeneration()

	cache.ApplyActivity(PublicActivity{ID: "activity-live", Kind: "packet", Seq: 21, HeardAt: 200})
	cache.ReplacePreservingMutations(PublicLiveState{
		Stats: PublicStats{LatestSeq: 20, Packets: 20},
		Nodes: []PublicNode{{ID: "node-current", LastSeen: 150}},
	}, nil, reconcileGeneration)

	snapshot, ok := cache.Snapshot()
	if !ok {
		t.Fatal("cache should remain ready")
	}
	if len(snapshot.Nodes) != 1 || snapshot.Nodes[0].ID != "node-current" {
		t.Fatalf("unrelated mutation resurrected an expired node: %#v", snapshot.Nodes)
	}
	if len(snapshot.RecentPulses) != 0 {
		t.Fatalf("unrelated mutation resurrected expired pulses: %#v", snapshot.RecentPulses)
	}
	if len(snapshot.RecentActivity) != 1 || snapshot.RecentActivity[0].ID != "activity-live" {
		t.Fatalf("racing activity was not preserved: %#v", snapshot.RecentActivity)
	}
}

func TestPublicCacheReconcilePreservesAuthoritativePacketCountDecrease(t *testing.T) {
	cache := NewPublicStateCache(NewPublicIATAFilter(nil))
	cache.Replace(PublicLiveState{Stats: PublicStats{Packets: 120}}, nil)
	reconcileGeneration := cache.MutationGeneration()

	cache.SetPacketCount(80)
	cache.ReplacePreservingMutations(PublicLiveState{Stats: PublicStats{Packets: 100}}, nil, reconcileGeneration)

	snapshot, ok := cache.Snapshot()
	if !ok {
		t.Fatal("cache should remain ready")
	}
	if snapshot.Stats.Packets != 80 {
		t.Fatalf("packet count=%d, want authoritative concurrent count 80", snapshot.Stats.Packets)
	}
}

func TestPublicCacheMutationJournalStaysBoundedWithoutReconciliation(t *testing.T) {
	cache := NewPublicStateCache(NewPublicIATAFilter(nil))
	cache.Replace(PublicLiveState{}, nil)

	for index := 0; index < publicCacheMaxNodes+100; index++ {
		cache.ApplyNode(PublicNode{ID: fmt.Sprintf("node-%d", index), LastSeen: int64(index)})
	}
	for index := 0; index < publicCacheMaxActivity+100; index++ {
		cache.ApplyActivity(PublicActivity{ID: fmt.Sprintf("activity-%d", index), HeardAt: int64(index)})
	}
	for index := 0; index < publicCacheMaxPulses+100; index++ {
		cache.ApplyRoutePulse(PublicRoutePulse{ID: fmt.Sprintf("pulse-%d", index), HeardAt: int64(index)})
	}

	cache.mu.RLock()
	defer cache.mu.RUnlock()
	if len(cache.nodeMutations) > publicCacheMaxNodes ||
		len(cache.activityMutations) > publicCacheMaxActivity ||
		len(cache.pulseMutations) > publicCacheMaxPulses {
		t.Fatalf("unbounded mutation journal sizes nodes/activity/pulses=%d/%d/%d", len(cache.nodeMutations), len(cache.activityMutations), len(cache.pulseMutations))
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
