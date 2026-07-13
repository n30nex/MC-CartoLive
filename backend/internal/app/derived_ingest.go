package app

import (
	"context"
	"time"

	"github.com/google/uuid"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/store"
)

const (
	storeRetryMaxBackoff = 2 * time.Second
)

type derivedIngestJobContextKey struct{}

type derivedIngestJob struct {
	msg            imqtt.NormalizedMessage
	parsed         meshcore.ParsedPacket
	advert         *meshcore.Advert
	decodedMessage meshcore.DecodedPublicMessage
	observationID  int64
	queuedAtMs     int64
}

type edgeProjectionJob struct {
	edge     live.EdgeEvent
	queuedAt time.Time
}

// HandleMQTT persists the essential normalized observation/status before the
// dispatcher can count the message as processed. Transient writer failures are
// retried with the same ingest ID until success or application shutdown.
func (a *Application) HandleMQTT(ctx context.Context, msg imqtt.NormalizedMessage) {
	_ = a.handleMQTTOutcome(ctx, msg)
}

func (a *Application) handleMQTTOutcome(ctx context.Context, msg imqtt.NormalizedMessage) imqtt.HandleOutcome {
	if msg.IngestID == "" {
		msg.IngestID = uuid.NewString()
	}
	if msg.ReceivedAtMs <= 0 {
		msg.ReceivedAtMs = time.Now().UnixMilli()
	}
	if msg.TopicInfo.Subtopic == "internal" {
		return imqtt.HandleProcessed
	}
	if msg.TopicInfo.Subtopic == "status" {
		if err := a.retryStoreWriteLane(ctx, writeLanePrimary, "status upsert", func(ctx context.Context) error {
			return a.Store.UpsertObserver(ctx, msg)
		}); err != nil {
			a.Log.Warn("status upsert failed", "error", err)
			return imqtt.HandleFailed
		}
		a.Runtime.RecordPrimaryPersisted()
		a.Resolver.InvalidateCandidates()
		if !a.enqueueDerivedIngestContext(ctx, derivedIngestJob{msg: msg, queuedAtMs: time.Now().UnixMilli()}) {
			return imqtt.HandleFailed
		}
		return imqtt.HandleProcessed
	}
	if msg.TopicInfo.Subtopic != "packets" || msg.RawHex == "" {
		a.Runtime.RecordPermanentReject()
		return imqtt.HandlePermanentReject
	}
	parsed, err := meshcore.ParseHexPacket(msg.RawHex)
	if err != nil {
		a.Log.Debug("packet decode failed", "topic", msg.Topic, "error", err)
		a.Runtime.RecordPermanentReject()
		return imqtt.HandlePermanentReject
	}
	var advert *meshcore.Advert
	if parsed.PayloadType == meshcore.PayloadAdvert {
		if parsedAdvert, ok, err := meshcore.ParseAdvertPayload(parsed.Payload); err != nil {
			a.Log.Debug("advert parse failed", "packetHash", parsed.PacketHash, "error", err)
		} else if ok {
			advert = &parsedAdvert
		}
	}
	decoded := meshcore.DecodePublicMessage(parsed.PayloadType, parsed.Payload, msg.RawJSON, a.Config.MeshcoreChannelSecrets)
	insert := store.ObservationInsert{
		IngestID: msg.IngestID, Message: msg, Parsed: parsed,
		Summary: meshcore.Summary(parsed, advert), MessageSender: decoded.Sender, MessageText: decoded.Text,
	}
	var observationID int64
	var duplicate bool
	err = a.retryStoreWriteLane(ctx, writeLanePrimary, "packet/observation upsert", func(ctx context.Context) error {
		var writeErr error
		observationID, duplicate, writeErr = a.Store.UpsertPacketAndObservation(ctx, parsed, msg.HeardAtMs, insert)
		return writeErr
	})
	if err != nil {
		a.Log.Warn("packet/observation upsert failed", "error", err)
		return imqtt.HandleFailed
	}
	a.Runtime.RecordPrimaryPersisted()
	if duplicate {
		a.Runtime.RecordIngestDuplicate()
	}
	if !a.enqueueDerivedIngestContext(ctx, derivedIngestJob{
		msg: msg, parsed: parsed, advert: advert, decodedMessage: decoded,
		observationID: observationID, queuedAtMs: time.Now().UnixMilli(),
	}) {
		return imqtt.HandleFailed
	}
	return imqtt.HandleProcessed
}

func (a *Application) enqueueDerivedIngest(job derivedIngestJob) bool {
	return a.enqueueDerivedIngestContext(context.Background(), job)
}

func (a *Application) enqueueDerivedIngestContext(ctx context.Context, job derivedIngestJob) bool {
	if a == nil || a.derivedQueue == nil {
		return false
	}
	a.derivedQueueMu.Lock()
	if len(a.derivedQueue) < cap(a.derivedQueue) {
		a.derivedQueue <- job
		a.derivedQueueTimes = append(a.derivedQueueTimes, job.queuedAtMs)
		a.Runtime.RecordDerivedEnqueue(len(a.derivedQueue), cap(a.derivedQueue), a.derivedQueueOldestLocked())
		a.derivedQueueMu.Unlock()
		return true
	}
	a.derivedQueueMu.Unlock()
	// Backpressure is lossless: once primary persistence succeeds, wait for the
	// projection worker instead of creating a permanent public-map hole.
	a.derivedQueueMu.Lock()
	a.derivedQueueTimes = append(a.derivedQueueTimes, job.queuedAtMs)
	a.Runtime.RecordDerivedEnqueue(len(a.derivedQueue)+1, cap(a.derivedQueue), a.derivedQueueOldestLocked())
	a.derivedQueueMu.Unlock()
	select {
	case a.derivedQueue <- job:
		return true
	case <-ctx.Done():
		a.derivedQueueMu.Lock()
		for i, queuedAt := range a.derivedQueueTimes {
			if queuedAt == job.queuedAtMs {
				a.derivedQueueTimes = append(a.derivedQueueTimes[:i], a.derivedQueueTimes[i+1:]...)
				break
			}
		}
		a.Runtime.UpdateDerivedQueue(len(a.derivedQueue), cap(a.derivedQueue), a.derivedQueueOldestLocked())
		a.derivedQueueMu.Unlock()
		return false
	}
}

func (a *Application) derivedIngestLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case job := <-a.derivedQueue:
			// Re-check pressure after receiving. Pressure can rise while the
			// worker is blocked on an empty queue; checking only before receive
			// would let the first derived job jump ahead of a newly backlogged
			// primary writer. Keep the FIFO timestamp in place while paused so
			// readiness and metrics continue to report the held job's real age.
			for a.derivedWorkPaused() {
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Second):
				}
			}
			started := time.Now()
			beforeFailures := a.Runtime.Snapshot().StoreWriteFailures
			jobCtx := context.WithValue(ctx, derivedIngestJobContextKey{}, job)
			a.processDerivedMQTT(jobCtx, job.msg)
			jobErr := jobCtx.Err()
			a.derivedQueueMu.Lock()
			a.popDerivedQueueTimestampLocked()
			depth, capacity, oldest := len(a.derivedQueue), cap(a.derivedQueue), a.derivedQueueOldestLocked()
			a.derivedQueueMu.Unlock()
			failed := jobErr != nil || a.Runtime.Snapshot().StoreWriteFailures > beforeFailures
			a.Runtime.RecordDerivedProcessed(time.Since(started), failed, depth, capacity, oldest)
		}
	}
}

func (a *Application) enqueueEdgeProjection(ctx context.Context, edge live.EdgeEvent) bool {
	if a == nil || a.edgeProjectionQueue == nil || edge.ID <= 0 {
		return false
	}
	job := edgeProjectionJob{edge: edge, queuedAt: time.Now()}
	a.edgeProjectionMu.Lock()
	a.edgeProjectionTimes = append(a.edgeProjectionTimes, job.queuedAt.UnixMilli())
	a.updateEdgeProjectionQueueLocked()
	a.edgeProjectionMu.Unlock()
	select {
	case a.edgeProjectionQueue <- job:
		return true
	case <-ctx.Done():
		a.edgeProjectionMu.Lock()
		for i, queuedAt := range a.edgeProjectionTimes {
			if queuedAt == job.queuedAt.UnixMilli() {
				a.edgeProjectionTimes = append(a.edgeProjectionTimes[:i], a.edgeProjectionTimes[i+1:]...)
				break
			}
		}
		a.updateEdgeProjectionQueueLocked()
		a.edgeProjectionMu.Unlock()
		return false
	}
}

func (a *Application) edgeProjectionLoop(ctx context.Context) {
	if a == nil || a.edgeProjectionQueue == nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case job := <-a.edgeProjectionQueue:
			err := a.retryStoreWriteLane(ctx, writeLaneBackground, "edge public projection", func(writeCtx context.Context) error {
				return a.Store.ProjectEdgeEvent(writeCtx, job.edge)
			})
			a.Runtime.RecordDerivedProjection(time.Since(job.queuedAt), err != nil)
			a.edgeProjectionMu.Lock()
			if len(a.edgeProjectionTimes) > 0 {
				a.edgeProjectionTimes = a.edgeProjectionTimes[1:]
			}
			a.updateEdgeProjectionQueueLocked()
			a.edgeProjectionMu.Unlock()
			if err != nil && ctx.Err() == nil {
				a.Log.Warn("edge public projection failed", "edgeID", job.edge.ID, "error", err)
			}
		}
	}
}

func (a *Application) updateEdgeProjectionQueueLocked() {
	oldest := int64(0)
	if len(a.edgeProjectionTimes) > 0 {
		oldest = a.edgeProjectionTimes[0]
	}
	a.Runtime.RecordDerivedProjectionQueue(len(a.edgeProjectionTimes), oldest)
}

func (a *Application) derivedQueueOldestLocked() int64 {
	if len(a.derivedQueueTimes) == 0 {
		return 0
	}
	return a.derivedQueueTimes[0]
}

func (a *Application) popDerivedQueueTimestampLocked() {
	if len(a.derivedQueueTimes) > 0 {
		a.derivedQueueTimes = a.derivedQueueTimes[1:]
	}
}

func (a *Application) derivedWorkPaused() bool {
	if a == nil {
		return false
	}
	mqttStatus := a.MQTT.Status(time.Now())
	return derivedWorkPausedFor(mqttStatus, a.Store.StorageInfo().PressureState)
}

func derivedWorkPausedFor(_ imqtt.Status, storagePressure string) bool {
	// The projection worker must keep making progress while primary ingest is
	// busy. Pausing it based on primary queue depth lets accepted observations
	// fill the derived queue and creates permanent public-map holes. Both paths
	// already share the single SQLite writer and bounded write budgets; release
	// gates assert zero drops and accepted==processed. Only critical filesystem
	// pressure remains a fail-closed pause.
	return storagePressure == "critical"
}
