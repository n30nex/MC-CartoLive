package app

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
)

func TestPublicBackfillAllowedRequiresFullyIdleLiveIngest(t *testing.T) {
	now := int64(10_000)
	tests := []struct {
		name    string
		mqtt    imqtt.Status
		runtime live.RuntimeStatsSnapshot
		storage string
		want    bool
		reason  string
	}{
		{name: "idle", storage: "ok", want: true},
		{name: "primary queued", mqtt: imqtt.Status{QueueDepth: 1}, storage: "ok", reason: "primary_ingest_active"},
		{name: "primary in flight", mqtt: imqtt.Status{AcceptedMessages: 2, ProcessedMessages: 1}, storage: "ok", reason: "primary_ingest_active"},
		{name: "primary age", mqtt: imqtt.Status{OldestQueueItemAgeMs: 1}, storage: "ok", reason: "primary_ingest_active"},
		{name: "primary recently quiet", mqtt: imqtt.Status{LastMessageAt: now - 1_999, LastMessageAgeMs: 1_999}, storage: "ok", reason: "primary_ingest_recent"},
		{name: "primary quiet window elapsed", mqtt: imqtt.Status{LastMessageAt: now - 2_000, LastMessageAgeMs: 2_000}, storage: "ok", want: true},
		{name: "derived queued", runtime: live.RuntimeStatsSnapshot{DerivedQueueDepth: 1}, storage: "ok", reason: "derived_ingest_active"},
		{name: "derived in flight", runtime: live.RuntimeStatsSnapshot{DerivedAccepted: 2, DerivedProcessed: 1}, storage: "ok", reason: "derived_ingest_active"},
		{name: "derived age", runtime: live.RuntimeStatsSnapshot{DerivedOldestAtMs: now - 1}, storage: "ok", reason: "derived_ingest_active"},
		{name: "storage warning", storage: "warn", reason: "storage_pressure"},
		{name: "storage critical", storage: "critical", reason: "storage_pressure"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, reason := publicBackfillAllowed(tt.mqtt, tt.runtime, tt.storage, now)
			if got != tt.want || reason != tt.reason {
				t.Fatalf("allowed/reason=(%v,%q), want (%v,%q)", got, reason, tt.want, tt.reason)
			}
		})
	}
}

func TestPublicBackfillStagesRunSequentiallyAndGateEveryBatch(t *testing.T) {
	ctx := context.Background()
	order := []string{}
	idleChecks := 0
	waits := []time.Duration{}
	pathCalls := 0
	running := false
	stage := func(name string, remaining func() bool) publicBackfillStage {
		return publicBackfillStage{name: name, run: func(context.Context) (bool, error) {
			if running {
				t.Fatal("backfill stages overlapped")
			}
			running = true
			defer func() { running = false }()
			order = append(order, name)
			return remaining(), nil
		}}
	}
	stages := []publicBackfillStage{
		stage("paths", func() bool {
			pathCalls++
			return pathCalls < 2
		}),
		stage("routes", func() bool { return false }),
	}
	runPublicBackfillStages(
		ctx,
		stages,
		func(context.Context) bool { idleChecks++; return true },
		func(_ context.Context, delay time.Duration) bool { waits = append(waits, delay); return true },
		nil,
	)
	if want := []string{"paths", "paths", "routes"}; !reflect.DeepEqual(order, want) {
		t.Fatalf("stage order=%v want=%v", order, want)
	}
	if idleChecks != len(order) {
		t.Fatalf("idle checks=%d want one before each of %d batches", idleChecks, len(order))
	}
	if want := []time.Duration{publicBackfillBatchPause}; !reflect.DeepEqual(waits, want) {
		t.Fatalf("batch waits=%v want=%v", waits, want)
	}
}

func TestPublicBackfillWorkIsBoundedBelowPrimaryDeadline(t *testing.T) {
	if got := boundedPublicBackfillBatch(500); got != publicBackfillBatchLimit || got >= 500 {
		t.Fatalf("bounded batch=%d limit=%d", got, publicBackfillBatchLimit)
	}
	if publicBackfillBatchTimeout >= primaryIngestBudget {
		t.Fatalf("backfill timeout=%v must stay below primary budget=%v", publicBackfillBatchTimeout, primaryIngestBudget)
	}
	if publicBackfillStartupQuietDelay < 30*time.Second {
		t.Fatalf("startup quiet delay=%v is too short", publicBackfillStartupQuietDelay)
	}
	if got := reducedPublicBackfillBatch(50, context.DeadlineExceeded); got != 25 {
		t.Fatalf("deadline-reduced batch=%d want=25", got)
	}
	if got := reducedPublicBackfillBatch(25, errors.New("other")); got != 25 {
		t.Fatalf("non-timeout batch=%d want=25", got)
	}
}
