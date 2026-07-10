package app

import (
	"context"
	"time"

	"github.com/google/uuid"

	"meshcore-canada-live-map/backend/internal/meshcore"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/store"
)

const (
	primaryIngestBudget = 5 * time.Second
	derivedIngestBudget = 5 * time.Second
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

// HandleMQTT owns the single end-to-end primary ingest deadline. Only the
// essential normalized observation/status is persisted on this path; all
// resolver, edge, public-event, and cache projection work is queued without
// blocking the MQTT dispatcher.
func (a *Application) HandleMQTT(ctx context.Context, msg imqtt.NormalizedMessage) {
	messageCtx, cancel := context.WithTimeout(ctx, primaryIngestBudget)
	defer cancel()
	if msg.IngestID == "" {
		msg.IngestID = uuid.NewString()
	}
	if msg.TopicInfo.Subtopic == "internal" {
		return
	}
	if msg.TopicInfo.Subtopic == "status" {
		if err := a.retryStoreWrite(messageCtx, "status upsert", func(ctx context.Context) error {
			return a.Store.UpsertObserver(ctx, msg)
		}); err != nil {
			a.Log.Warn("status upsert failed", "error", err)
			return
		}
		a.Resolver.InvalidateCandidates()
		a.enqueueDerivedIngest(derivedIngestJob{msg: msg, queuedAtMs: time.Now().UnixMilli()})
		return
	}
	if msg.TopicInfo.Subtopic != "packets" || msg.RawHex == "" {
		return
	}
	parsed, err := meshcore.ParseHexPacket(msg.RawHex)
	if err != nil {
		a.Log.Debug("packet decode failed", "topic", msg.Topic, "error", err)
		return
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
	err = a.retryStoreWrite(messageCtx, "packet/observation upsert", func(ctx context.Context) error {
		var writeErr error
		observationID, duplicate, writeErr = a.Store.UpsertPacketAndObservation(ctx, parsed, msg.HeardAtMs, insert)
		return writeErr
	})
	if err != nil {
		a.Log.Warn("packet/observation upsert failed", "error", err)
		return
	}
	if duplicate {
		a.Runtime.RecordIngestDuplicate()
	}
	a.enqueueDerivedIngest(derivedIngestJob{
		msg: msg, parsed: parsed, advert: advert, decodedMessage: decoded,
		observationID: observationID, queuedAtMs: time.Now().UnixMilli(),
	})
}

func (a *Application) enqueueDerivedIngest(job derivedIngestJob) bool {
	if a == nil || a.derivedQueue == nil {
		return false
	}
	a.derivedQueueMu.Lock()
	defer a.derivedQueueMu.Unlock()
	select {
	case a.derivedQueue <- job:
		a.derivedQueueTimes = append(a.derivedQueueTimes, job.queuedAtMs)
		a.Runtime.RecordDerivedEnqueue(len(a.derivedQueue), cap(a.derivedQueue), a.derivedQueueOldestLocked())
		return true
	default:
		a.Runtime.RecordDerivedDrop(len(a.derivedQueue), cap(a.derivedQueue), a.derivedQueueOldestLocked())
		a.Log.Warn("derived ingest queue full; projection deferred permanently", "queueDepth", len(a.derivedQueue), "queueCapacity", cap(a.derivedQueue))
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
			a.derivedQueueMu.Lock()
			a.popDerivedQueueTimestampLocked()
			a.Runtime.UpdateDerivedQueue(len(a.derivedQueue), cap(a.derivedQueue), a.derivedQueueOldestLocked())
			a.derivedQueueMu.Unlock()
			started := time.Now()
			beforeFailures := a.Runtime.Snapshot().StoreWriteFailures
			jobCtx, cancel := context.WithTimeout(ctx, derivedIngestBudget)
			jobCtx = context.WithValue(jobCtx, derivedIngestJobContextKey{}, job)
			a.processDerivedMQTT(jobCtx, job.msg)
			jobErr := jobCtx.Err()
			cancel()
			a.derivedQueueMu.Lock()
			depth, capacity, oldest := len(a.derivedQueue), cap(a.derivedQueue), a.derivedQueueOldestLocked()
			a.derivedQueueMu.Unlock()
			failed := jobErr != nil || a.Runtime.Snapshot().StoreWriteFailures > beforeFailures
			a.Runtime.RecordDerivedProcessed(time.Since(started), failed, depth, capacity, oldest)
		}
	}
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

func derivedWorkPausedFor(status imqtt.Status, storagePressure string) bool {
	return (status.QueueCapacity > 0 && status.QueueDepth*2 >= status.QueueCapacity) || storagePressure == "warn" || storagePressure == "critical"
}
