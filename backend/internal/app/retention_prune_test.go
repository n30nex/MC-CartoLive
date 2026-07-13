package app

import (
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
)

func TestRetentionPruneConfiguredCapacityExceedsLockedLoad(t *testing.T) {
	intervalSeconds := int64(retentionPruneInterval / time.Second)
	allRowsRequired := retentionLockedMessagesPerSecond * retentionWorstCaseRowsPerMessage * intervalSeconds
	if retentionPruneMaxRowsPerCycle <= allRowsRequired {
		t.Fatalf("retention row budget=%d must exceed locked worst-case arrivals=%d per interval", retentionPruneMaxRowsPerCycle, allRowsRequired)
	}
	publicEventsRequired := retentionLockedMessagesPerSecond * retentionMaxPublicEventsPerMessage * intervalSeconds
	if retentionPruneMaxRowsPerCycle <= publicEventsRequired {
		t.Fatalf("retention row budget=%d must exceed locked public-event arrivals=%d per interval", retentionPruneMaxRowsPerCycle, publicEventsRequired)
	}
	if got, wantGreaterThan := retentionPruneCapacityRowsPerSecond(), retentionLockedMessagesPerSecond*retentionWorstCaseRowsPerMessage; got <= wantGreaterThan {
		t.Fatalf("retention capacity=%d rows/s must exceed locked worst-case rate=%d rows/s", got, wantGreaterThan)
	}
}

func TestRetentionPruneCycleCanClearCanonicalExpiredFixture(t *testing.T) {
	const canonicalExpiredRows int64 = 500_000
	// Expired observations can also orphan one packet row each. Keep enough
	// headroom for the other bounded projection tables in the canonical seed.
	if retentionPruneMaxRowsPerCycle < canonicalExpiredRows*2 {
		t.Fatalf("retention row budget=%d must clear observations plus orphan packets=%d", retentionPruneMaxRowsPerCycle, canonicalExpiredRows*2)
	}
	if retentionPruneCycleBudget >= retentionPruneInterval {
		t.Fatalf("retention cycle budget=%s must remain below interval=%s", retentionPruneCycleBudget, retentionPruneInterval)
	}
}

func TestRetentionPrunePressurePolicyPrioritizesCriticalCleanup(t *testing.T) {
	nowMs := int64(10_000)
	healthyPrimary := imqtt.Status{QueueDepth: 0, QueueCapacity: 4096}
	derivedBacklog := live.RuntimeStatsSnapshot{
		DerivedQueueDepth:    700,
		DerivedQueueCapacity: 1024,
		DerivedOldestAtMs:    nowMs - 30_000,
	}
	if allowed, reason := retentionPruneAllowed(healthyPrimary, derivedBacklog, "ok", nowMs); allowed || reason != "derived_ingest_pressure" {
		t.Fatalf("healthy-storage derived backlog policy=(%v,%q), want paused derived_ingest_pressure", allowed, reason)
	}
	for _, storageState := range []string{"warn", "critical"} {
		if allowed, reason := retentionPruneAllowed(healthyPrimary, derivedBacklog, storageState, nowMs); !allowed || reason != "" {
			t.Fatalf("%s storage policy=(%v,%q), want cleanup allowed despite paused derived queue", storageState, allowed, reason)
		}
	}
	pressuredPrimary := imqtt.Status{QueueDepth: 2048, QueueCapacity: 4096, OldestQueueItemAgeMs: 3_000}
	if allowed, reason := retentionPruneAllowed(pressuredPrimary, derivedBacklog, "critical", nowMs); allowed || reason != "primary_ingest_pressure" {
		t.Fatalf("critical-storage primary pressure policy=(%v,%q), want bounded pause", allowed, reason)
	}
}
