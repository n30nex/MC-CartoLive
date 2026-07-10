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

func TestDerivedWorkPausesForPrimaryOrStoragePressure(t *testing.T) {
	if !derivedWorkPausedFor(imqtt.Status{QueueDepth: 50, QueueCapacity: 100}, "ok") {
		t.Fatal("50% primary queue pressure must pause derived work")
	}
	if !derivedWorkPausedFor(imqtt.Status{}, "warn") || !derivedWorkPausedFor(imqtt.Status{}, "critical") {
		t.Fatal("storage pressure must pause derived work")
	}
	if derivedWorkPausedFor(imqtt.Status{QueueDepth: 49, QueueCapacity: 100}, "ok") {
		t.Fatal("healthy pressure unexpectedly paused derived work")
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
