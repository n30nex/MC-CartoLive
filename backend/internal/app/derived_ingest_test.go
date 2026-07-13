package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/resolve"
	"meshcore-canada-live-map/backend/internal/store"
)

type fixedPacketResolver struct {
	result resolve.Result
	err    error
}

func (r fixedPacketResolver) Resolve(context.Context, string, meshcore.ParsedPacket) (resolve.Result, error) {
	return r.result, r.err
}

func (fixedPacketResolver) InvalidateCandidates() {}

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
	observer, err := st.ObserverByPublicKeyIATA(ctx, msg.TopicInfo.PublisherPK, msg.TopicInfo.IATA)
	if err != nil || observer.PacketCount != 1 {
		t.Fatalf("observer=%#v err=%v want packetCount=1", observer, err)
	}
	app.HandleMQTT(ctx, msg)
	observer, err = st.ObserverByPublicKeyIATA(ctx, msg.TopicInfo.PublisherPK, msg.TopicInfo.IATA)
	if err != nil || observer.PacketCount != 1 {
		t.Fatalf("duplicate observer=%#v err=%v want packetCount=1", observer, err)
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

func TestPublishPublicEventDoesNotApplyWhenDurableInsertFails(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	app := &Application{
		Config: Config{PublicEventsEnabled: true}, Store: st,
		PublicHub: live.NewHub(log, 8), Runtime: live.NewRuntimeStats(), Log: log,
	}
	_, apply := app.publishPublicEvent(ctx, "activity", live.PublicActivity{ID: "must-not-broadcast", HeardAt: time.Now().UnixMilli()}, "failed:activity")
	if apply {
		t.Fatal("durable insert failure was exposed as a live event")
	}
}

func TestBroadcastLatencyStartsAtActualIngestReceiveTime(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	app := &Application{
		Config: Config{PublicEventsEnabled: true}, Store: st,
		PublicHub: live.NewHub(log, 8), Runtime: live.NewRuntimeStats(), Log: log,
	}
	receivedAt := time.Now().Add(-75 * time.Millisecond).UnixMilli()
	results := app.publishPublicEventBatch(ctx, []publicEventPublication{{
		eventType: "activity", data: live.PublicActivity{ID: "latency", HeardAt: time.Now().UnixMilli()},
		dedupeKey: "latency:activity", receivedAt: receivedAt,
	}})
	if len(results) != 1 || !results[0].apply {
		t.Fatalf("results=%#v", results)
	}
	if got := app.Runtime.Snapshot().LastBroadcastLatencyMs; got < 60 {
		t.Fatalf("broadcast latency=%dms, want receive-to-broadcast latency including prior work", got)
	}
	app.Runtime.RecordBroadcastLatency(5 * time.Millisecond)
	snapshot := app.Runtime.Snapshot()
	if snapshot.LastBroadcastLatencyMs != 5 || snapshot.MaxBroadcastLatencyMs < 60 {
		t.Fatalf("last/max latency=%d/%d, cumulative max must retain the spike", snapshot.LastBroadcastLatencyMs, snapshot.MaxBroadcastLatencyMs)
	}
}

func TestNonEdgePacketsCommitActivityForResolverErrorAndPositionedObserver(t *testing.T) {
	for _, tc := range []struct {
		name               string
		resolver           fixedPacketResolver
		positionedObserver bool
		wantStatus         string
		wantAnimation      string
	}{
		{name: "resolver error remains visible", resolver: fixedPacketResolver{err: errors.New("forced resolver error")}, wantStatus: resolve.StatusUnresolved, wantAnimation: live.PublicAnimationUnmapped},
		{name: "non-high positioned observer bursts", resolver: fixedPacketResolver{result: resolve.Result{Status: resolve.StatusUnresolved, Reason: "no unique forwarder"}}, positionedObserver: true, wantStatus: resolve.StatusUnresolved, wantAnimation: live.PublicAnimationObserver},
	} {
		t.Run(tc.name, func(t *testing.T) {
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
				Config: Config{PublicEventsEnabled: true}, Store: st, Runtime: live.NewRuntimeStats(), Log: log,
				Resolver: tc.resolver, Hub: live.NewHub(log, 8), PublicHub: live.NewHub(log, 8), PublicCache: cache,
				derivedQueue: make(chan derivedIngestJob, 4),
			}
			msg := imqtt.NormalizedMessage{
				IngestID: "non-edge-" + tc.name, ReceivedAtMs: time.Now().UnixMilli(),
				Topic:     "meshcore/YYZ/CC00000000000000000000000000000000000000000000000000000000000000/packets",
				TopicInfo: imqtt.TopicInfo{IATA: "YYZ", Region: "YYZ", PublisherPK: "CC00000000000000000000000000000000000000000000000000000000000000", Subtopic: "packets"},
				RawHex:    "0901AA00AA48656C6C6F", HeardAtMs: time.Now().UnixMilli(), ObserverName: "Test Observer",
			}
			if tc.positionedObserver {
				status := msg
				status.TopicInfo.Subtopic = "status"
				status.Payload = map[string]any{"latitude": 43.65, "longitude": -79.38}
				if err := st.UpsertObserver(ctx, status); err != nil {
					t.Fatal(err)
				}
			}
			if outcome := app.handleMQTTOutcome(ctx, msg); outcome != imqtt.HandleProcessed {
				t.Fatalf("outcome=%v", outcome)
			}
			job := <-app.derivedQueue
			jobCtx := context.WithValue(ctx, derivedIngestJobContextKey{}, job)
			app.processDerivedMQTT(jobCtx, job.msg)

			events, _, err := st.ListPublicEventsAfter(ctx, store.PublicEventFilter{})
			if err != nil {
				t.Fatal(err)
			}
			if len(events) != 1 || events[0].Type != "activity" {
				t.Fatalf("events=%#v", events)
			}
			var activity live.PublicActivity
			if err := json.Unmarshal(events[0].Data.(json.RawMessage), &activity); err != nil {
				t.Fatal(err)
			}
			if activity.AnimationState != tc.wantAnimation {
				t.Fatalf("animation=%q want=%q activity=%#v", activity.AnimationState, tc.wantAnimation, activity)
			}
			if tc.positionedObserver != (activity.ObserverLocation != nil) {
				t.Fatalf("observer location=%#v positioned=%t", activity.ObserverLocation, tc.positionedObserver)
			}
			observation, err := st.ObservationByID(ctx, job.observationID)
			if err != nil || observation.ResolutionStatus != tc.wantStatus {
				t.Fatalf("observation=%#v err=%v", observation, err)
			}
			snapshot, ok := cache.Snapshot()
			if !ok || len(snapshot.RecentActivity) != 1 || snapshot.Stats.Packets != 1 {
				t.Fatalf("cache=%#v ready=%t", snapshot, ok)
			}
			app.processDerivedMQTT(jobCtx, job.msg)
			events, _, err = st.ListPublicEventsAfter(ctx, store.PublicEventFilter{})
			if err != nil || len(events) != 1 {
				t.Fatalf("retry events=%d err=%v", len(events), err)
			}
		})
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

func TestRetryStoreWriteRecoversTransientDeadlineWithoutChangingOperation(t *testing.T) {
	app := &Application{Runtime: live.NewRuntimeStats(), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	attempts := 0
	err := app.retryStoreWriteLane(context.Background(), writeLanePrimary, "transient deadline", func(context.Context) error {
		attempts++
		if attempts < 3 {
			return context.DeadlineExceeded
		}
		return nil
	})
	if err != nil || attempts != 3 {
		t.Fatalf("err=%v attempts=%d want nil/3", err, attempts)
	}
	snapshot := app.Runtime.Snapshot()
	if snapshot.StoreWriteRetries != 2 || snapshot.StoreWriteFailures != 0 || snapshot.PrimaryDeadlineFailures != 2 {
		t.Fatalf("runtime=%#v", snapshot)
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
