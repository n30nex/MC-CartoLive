package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestHandleMQTTPersistsEssentialObservationAndQueuesDerivedWork(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	app := &Application{
		Store: st, Runtime: live.NewRuntimeStats(), Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		derivedQueue: make(chan derivedIngestJob, 2),
	}
	msg := imqtt.NormalizedMessage{
		IngestID: "primary-ingest-id", Topic: "meshcore/YYZ/ABCDEF012345/packets",
		TopicInfo: imqtt.TopicInfo{IATA: "YYZ", Region: "YYZ", PublisherPK: "ABCDEF012345", Subtopic: "packets"},
		RawHex:    "0901AA00AA48656C6C6F", HeardAtMs: time.Now().UnixMilli(),
	}
	app.HandleMQTT(ctx, msg)
	count, err := st.PacketCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || len(app.derivedQueue) != 1 {
		t.Fatalf("packets=%d derivedQueue=%d want 1/1", count, len(app.derivedQueue))
	}
	if snapshot := app.Runtime.Snapshot(); snapshot.DerivedAccepted != 1 || snapshot.DerivedDropped != 0 {
		t.Fatalf("runtime=%#v", snapshot)
	}
}

func TestPublishPublicEventSuppressesDedupeRebroadcastAndCacheApply(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	cache.Replace(live.PublicLiveState{}, nil)
	app := &Application{
		Config:      Config{PublicEventsEnabled: true},
		Store:       st,
		PublicHub:   live.NewHub(log, 8),
		PublicCache: cache,
		Runtime:     live.NewRuntimeStats(),
		Log:         log,
	}
	activity := live.PublicActivity{ID: "activity-once", Kind: "packet", HeardAt: time.Now().UnixMilli()}

	first, apply := app.publishPublicEvent(ctx, "activity", activity, "ingest:activity-once")
	if !apply {
		t.Fatal("new durable event was suppressed")
	}
	firstActivity := first.(live.PublicActivity)
	if firstActivity.Seq <= 0 {
		t.Fatalf("new durable event seq=%d", firstActivity.Seq)
	}
	cache.ApplyActivity(firstActivity)

	_, apply = app.publishPublicEvent(ctx, "activity", activity, "ingest:activity-once")
	if apply {
		t.Fatal("dedupe conflict was reported as a new live event")
	}
	events, _, err := st.ListPublicEventsAfter(ctx, store.PublicEventFilter{})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, ok := cache.Snapshot()
	if !ok {
		t.Fatal("cache should be ready")
	}
	if len(events) != 1 || len(snapshot.RecentActivity) != 1 || snapshot.Stats.Packets != 1 {
		t.Fatalf("events/activity/packets=%d/%d/%d want 1/1/1", len(events), len(snapshot.RecentActivity), snapshot.Stats.Packets)
	}
}

func TestRetryStoreWriteCannotExtendParentDeadline(t *testing.T) {
	app := &Application{Runtime: live.NewRuntimeStats(), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := app.retryStoreWrite(ctx, "locked", func(context.Context) error {
		return errors.New("SQLITE_BUSY: database is locked")
	})
	if err == nil {
		t.Fatal("expected busy failure")
	}
	if elapsed := time.Since(started); elapsed > 250*time.Millisecond {
		t.Fatalf("retry exceeded parent deadline: %v", elapsed)
	}
}

func TestDerivedWorkKeepsProgressUnderPrimaryAndWarningPressure(t *testing.T) {
	if derivedWorkPausedFor(imqtt.Status{QueueDepth: 100, QueueCapacity: 100}, "ok") {
		t.Fatal("primary queue pressure must not freeze live projection work")
	}
	if derivedWorkPausedFor(imqtt.Status{}, "warn") {
		t.Fatal("storage warning must not freeze live projection work")
	}
	if !derivedWorkPausedFor(imqtt.Status{}, "critical") {
		t.Fatal("critical storage pressure must pause derived work")
	}
}

func TestDerivedQueueOldestTracksCurrentFIFOHead(t *testing.T) {
	app := &Application{Runtime: live.NewRuntimeStats(), Log: slog.New(slog.NewTextHandler(io.Discard, nil)), derivedQueue: make(chan derivedIngestJob, 4)}
	if !app.enqueueDerivedIngest(derivedIngestJob{queuedAtMs: 100}) || !app.enqueueDerivedIngest(derivedIngestJob{queuedAtMs: 200}) {
		t.Fatal("failed to enqueue derived jobs")
	}
	if got := app.Runtime.Snapshot().DerivedOldestAtMs; got != 100 {
		t.Fatalf("oldest=%d want 100", got)
	}
	<-app.derivedQueue
	app.derivedQueueMu.Lock()
	app.popDerivedQueueTimestampLocked()
	app.Runtime.UpdateDerivedQueue(len(app.derivedQueue), cap(app.derivedQueue), app.derivedQueueOldestLocked())
	app.derivedQueueMu.Unlock()
	if got := app.Runtime.Snapshot().DerivedOldestAtMs; got != 200 {
		t.Fatalf("oldest after pop=%d want 200", got)
	}
}
