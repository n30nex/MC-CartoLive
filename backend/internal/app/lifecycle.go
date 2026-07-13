package app

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"gopkg.in/yaml.v3"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/propagation"
	"meshcore-canada-live-map/backend/internal/resolve"
	"meshcore-canada-live-map/backend/internal/solar"
	"meshcore-canada-live-map/backend/internal/store"

	"meshcore-canada-live-map/backend/internal/api"
)

type Application struct {
	Config        Config
	Log           *slog.Logger
	Store         *store.Store
	Hub           *live.Hub
	PublicHub     *live.Hub
	PublicCache   *live.PublicStateCache
	Runtime       *live.RuntimeStats
	MQTT          *imqtt.Client
	Resolver      packetResolver
	Solar         *solar.Fetcher
	Propagation   *propagation.WeatherFetcher
	solarSnapshot atomic.Pointer[solar.Conditions]

	apiServer *api.Server

	cacheRefreshMu      sync.Mutex
	packetCount         atomic.Int64
	derivedQueue        chan derivedIngestJob
	derivedQueueMu      sync.Mutex
	derivedQueueTimes   []int64
	edgeProjectionQueue chan edgeProjectionJob
	edgeProjectionMu    sync.Mutex
	edgeProjectionTimes []int64
	writeCoordinator    *writeCoordinator
	wg                  sync.WaitGroup
}

type packetResolver interface {
	Resolve(context.Context, string, meshcore.ParsedPacket) (resolve.Result, error)
	InvalidateCandidates()
}

type runtimeCounterLogSnapshot struct {
	MQTTConnected                bool
	MQTTMessagesTotal            int64
	MQTTMessagesDropped          int64
	MQTTLastMessageAgeMs         int64
	PacketsTotal                 int64
	PublicNodes                  int
	PublicRoutes                 int
	PublicRecentPulses           int
	PublicRecentActivity         int
	PublicCacheAgeMs             int64
	PublicCacheTruncatedNodes    int64
	PublicCacheTruncatedRoutes   int64
	PublicCacheTruncatedPulses   int64
	PublicCacheTruncatedActivity int64
	WSClients                    int
	PublicWSClients              int
	PublicWSDropped              int64
	CacheRefreshFailures         int64
	CacheRefreshLatencyMs        int64
	PacketCountRefreshFailures   int64
	PacketCountRefreshLatencyMs  int64
	PrimaryQueueOldestAgeMs      int64
	LiveProjectionOldestAgeMs    int64
	WriterPrimaryWaitMs          int64
	WriterLiveCoreWaitMs         int64
	WriterBackgroundWaitMs       int64
	PrimaryDeadlineFailures      int64
	StoreWriteFailures           int64
	DerivedProjectionFailures    int64
	LastBroadcastLatencyMs       int64
	MaxBroadcastLatencyMs        int64
}

type yamlConfig struct {
	ForwarderRoles []string `yaml:"forwarderRoles"`
	Regions        []struct {
		IATAs []string `yaml:"iatas"`
	} `yaml:"regions"`
	ManualNodes []struct {
		PublicKey string  `yaml:"publicKey"`
		Name      string  `yaml:"name"`
		Latitude  float64 `yaml:"latitude"`
		Longitude float64 `yaml:"longitude"`
		Source    string  `yaml:"source"`
	} `yaml:"manualNodeLocations"`
}

func NewApplication(ctx context.Context, cfg Config, log *slog.Logger) (*Application, error) {
	coordinatePolicy := live.NewCoordinatePolicy(cfg.MapBounds)
	live.SetCoordinatePolicy(coordinatePolicy)
	st, err := store.Open(ctx, cfg.DBPath)
	if err != nil {
		return nil, err
	}
	st.SetCoordinatePolicy(coordinatePolicy)
	yc := loadYAMLConfig(cfg.ConfigYAML, log)
	resolver := resolve.New(st, yc.ForwarderRoles)
	for _, node := range yc.ManualNodes {
		if node.PublicKey != "" {
			if err := st.ApplyManualNode(ctx, node.PublicKey, node.Name, node.Latitude, node.Longitude, node.Source); err != nil {
				log.Warn("manual node override failed", "publicKey", redact(node.PublicKey), "error", err)
			} else {
				resolver.InvalidateCandidates()
			}
		}
	}
	hub := live.NewHub(log, cfg.WSClientQueueSize, cfg.PublicBaseURL)
	publicHub := live.NewHub(log, cfg.WSClientQueueSize, cfg.PublicBaseURL)
	publicHub.SetResumeEnabled(cfg.PublicWSResumeEnabled)
	publicHub.SetSubscriptionsEnabled(cfg.PublicWSSubscriptionsEnabled)
	publicCache := live.NewPublicStateCache(live.NewPublicIATAFilter(publicIATAs(cfg.PublicRegions, yc)))
	derivedQueueSize := cfg.DerivedIngestQueueSize
	if derivedQueueSize < 1 {
		derivedQueueSize = 1024
	}
	runtimeStats := live.NewRuntimeStats()
	app := &Application{Config: cfg, Log: log, Store: st, Hub: hub, PublicHub: publicHub, PublicCache: publicCache, Runtime: runtimeStats, Resolver: resolver, Solar: solar.NewFetcher(log), Propagation: propagation.NewWeatherFetcher(log), derivedQueue: make(chan derivedIngestJob, derivedQueueSize), edgeProjectionQueue: make(chan edgeProjectionJob, derivedQueueSize)}
	app.writeCoordinator = newWriteCoordinator(runtimeStats)
	if latestSeq, err := st.LatestPublicSeq(ctx); err == nil {
		publicHub.SetLatestSeq(latestSeq)
	} else {
		log.Warn("public event sequence seed failed", "error", err)
	}
	app.MQTT = imqtt.NewClientWithOutcome(imqtt.ClientConfig{
		Enabled:   cfg.MQTTEnabled,
		BrokerURL: cfg.MQTTBrokerURL,
		Topic:     cfg.MQTTTopic,
		ClientID:  cfg.MQTTClientID,
		QueueSize: cfg.MQTTIngestQueueSize,
		Auth: imqtt.AuthConfig{
			Mode:      cfg.AuthMode,
			Username:  cfg.MQTTUsername,
			Password:  cfg.MQTTPassword,
			PublicKey: cfg.MeshcorePublicKey,
			Token:     "",
		},
	}, log, app.handleMQTTOutcome)
	return app, nil
}

func (a *Application) Start(ctx context.Context) error {
	a.Log.Info("startup",
		"listen", a.Config.ListenAddr,
		"dbPath", a.Config.DBPath,
		"broker", redactedURL(a.Config.MQTTBrokerURL),
		"topic", a.Config.MQTTTopic,
		"strictRFOnly", a.Config.StrictRFOnly,
		"distanceGateKm", a.Config.MaxUnverifiedEdgeKM,
		"mqttQueueSize", a.Config.MQTTIngestQueueSize,
		"mapRegionPreset", a.Config.MapRegionPreset,
		"mapBounds", a.Config.MapBounds,
		"propagationEnabled", a.Config.PropagationEnabled,
		"propagationMinDistanceKm", a.Config.PropagationMinDistanceKM,
	)
	if warn := api.StaticWarn(); warn != "" {
		a.Log.Warn(warn)
	}
	dbInfo := a.Store.RuntimeInfo(ctx)
	a.Log.Info("sqlite runtime",
		"path", dbInfo.Path,
		"journalMode", dbInfo.JournalMode,
		"busyTimeoutMs", dbInfo.BusyTimeout,
		"maxOpenConns", dbInfo.MaxOpenConns,
		"readMaxOpenConns", dbInfo.ReadMaxOpenConns,
	)
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.refreshPacketCountOnce(ctx) }()
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.refreshPacketCountLoop(ctx) }()
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.refreshPublicStateCacheOnce(ctx, "warm") }()
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.refreshPublicStateCacheLoop(ctx) }()
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.backfillPublicProjectionsLoop(ctx) }()
	if a.Config.PropagationEnabled {
		a.wg.Add(1)
		go func() { defer a.wg.Done(); a.propagationLoop(ctx) }()
	}
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.derivedIngestLoop(ctx) }()
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.edgeProjectionLoop(ctx) }()
	if err := a.MQTT.Start(ctx); err != nil {
		a.Log.Error("mqtt start failed", "error", err)
	}
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.logCounters(ctx) }()
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.solarFetchLoop(ctx) }()
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.pruneLoop(ctx) }()
	a.wg.Add(1)
	go func() { defer a.wg.Done(); a.maintenanceLoop(ctx) }()
	if a.Config.FixtureReplayPath != "" {
		a.wg.Add(1)
		go func() { defer a.wg.Done(); a.replayFixture(ctx, a.Config.FixtureReplayPath) }()
	}
	return a.StartHTTP(ctx)
}

func (a *Application) Close() error {
	if a.apiServer != nil {
		a.apiServer.Shutdown()
	}
	done := make(chan struct{})
	go func() {
		a.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		a.Log.Warn("shutdown: goroutines did not exit within 10s timeout")
	}
	if a.writeCoordinator != nil {
		a.writeCoordinator.Close()
	}
	return a.Store.Close()
}

func (a *Application) processDerivedMQTT(ctx context.Context, msg imqtt.NormalizedMessage) {
	job, ok := ctx.Value(derivedIngestJobContextKey{}).(derivedIngestJob)
	if !ok {
		a.Log.Error("derived ingest context missing")
		return
	}
	if msg.TopicInfo.Subtopic == "internal" {
		return
	}
	if msg.TopicInfo.Subtopic == "status" {
		if node, err := a.Store.NodeByPublicKey(ctx, msg.TopicInfo.PublisherPK); err == nil && hasCoords(node) {
			a.broadcastNodeUpdateForIATA(ctx, node, msg.TopicInfo.IATA, msg.IngestID+":node")
		}
		return
	}
	if msg.TopicInfo.Subtopic != "packets" {
		return
	}
	parsed := job.parsed
	advert := job.advert
	decodedMessage := job.decodedMessage
	observationID := job.observationID

	var advertNode *live.Node
	if advert != nil {
		var node live.Node
		err := a.retryStoreWriteLane(ctx, writeLaneLiveCore, "advert node upsert", func(ctx context.Context) error {
			var err error
			node, err = a.Store.UpsertAdvertNode(ctx, msg.TopicInfo.IATA, *advert, msg.HeardAtMs)
			return err
		})
		if err != nil {
			a.Log.Warn("advert node upsert failed", "packetHash", parsed.PacketHash, "error", err)
		} else {
			a.Resolver.InvalidateCandidates()
			advertNode = &node
			a.broadcastNodeUpdateForIATA(ctx, node, msg.TopicInfo.IATA, msg.IngestID+":advert-node")
		}
	}

	resolution, err := a.Resolver.Resolve(ctx, msg.TopicInfo.IATA, parsed)
	if err != nil {
		a.Log.Warn("resolver failed", "error", err)
		a.commitNonEdgeActivity(ctx, job, resolve.StatusUnresolved, fmt.Sprintf("resolver_error: %v", err))
		return
	}
	status, reason := a.edgeDecision(ctx, msg, parsed, resolution, advertNode)
	if status != resolve.StatusHigh {
		a.commitNonEdgeActivity(ctx, job, status, reason)
		return
	}
	observation, obsErr := a.Store.ObservationByID(ctx, observationID)
	if obsErr == nil {
		observation.MessageSender = decodedMessage.Sender
		observation.MessageText = decodedMessage.Text
		observation.ResolutionStatus = status
		observation.ResolutionReason = reason
	}

	edge, ok, status, reason := a.buildEdgeEvent(ctx, msg, parsed, observationID, resolution, advertNode, decodedMessage)
	if !ok {
		a.commitNonEdgeActivity(ctx, job, status, reason)
		return
	}
	edge.IngestID = msg.IngestID + ":edge"
	publicAllowed := a.PublicCache.AllowsIATA(msg.TopicInfo.IATA)
	if !publicAllowed {
		a.PublicCache.RecordExcludedIATA(msg.TopicInfo.IATA)
	}
	var commit store.LiveEdgeCommitResult
	attempts := 0
	insertErr := a.retryStoreWriteLane(ctx, writeLaneLiveCore, "live edge and public events", func(ctx context.Context) error {
		attempts++
		var err error
		commit, err = a.Store.CommitLiveEdge(ctx, store.LiveEdgeCommitRequest{
			Edge: edge, ResolutionStatus: status, ResolutionReason: reason,
			PublishPublicEvents: publicAllowed && a.Config.PublicEventsEnabled,
			ActivityDedupeKey:   msg.IngestID + ":edge-activity",
			RoutePulseDedupeKey: msg.IngestID + ":route-pulse",
			ReceivedAtMs:        msg.ReceivedAtMs,
		})
		return err
	})
	if insertErr != nil {
		a.Log.Warn("edge insert failed", "error", insertErr)
		return
	}
	if obsErr == nil && (commit.EdgeInserted || attempts > 1) {
		a.Hub.Broadcast("packetObservation", observation)
	}
	if commit.EdgeInserted || attempts > 1 {
		a.Hub.Broadcast("edgeAnimation", commit.Edge)
	}
	for i, event := range commit.PublicEvents {
		if !commit.EventInserted[i] && attempts == 1 {
			continue
		}
		a.broadcastCommittedPublicEvent(event)
	}
	if publicAllowed && !a.Config.PublicEventsEnabled && (commit.EdgeInserted || attempts > 1) {
		if activity, ok := live.PublicActivityFromEdge(commit.Edge); ok {
			a.PublicHub.BroadcastUnsequenced("activity", activity)
			a.PublicCache.ApplyActivity(activity)
		}
		if pulse, ok := live.PublicRoutePulseFromEdge(commit.Edge); ok {
			a.PublicHub.BroadcastUnsequenced("routePulse", pulse)
			a.PublicCache.ApplyRoutePulse(pulse)
		}
	}
	a.enqueueEdgeProjection(ctx, commit.Edge)
}

func (a *Application) commitNonEdgeActivity(ctx context.Context, job derivedIngestJob, status, reason string) {
	observation, obsErr := a.Store.ObservationByID(ctx, job.observationID)
	if obsErr == nil {
		observation.MessageSender = job.decodedMessage.Sender
		observation.MessageText = job.decodedMessage.Text
		observation.ResolutionStatus = status
		observation.ResolutionReason = reason
	} else {
		a.Log.Warn("non-edge observation lookup failed", "observationID", job.observationID, "error", obsErr)
	}
	publicAllowed := a.PublicCache.AllowsIATA(job.msg.TopicInfo.IATA)
	if !publicAllowed {
		a.PublicCache.RecordExcludedIATA(job.msg.TopicInfo.IATA)
	}
	activity := live.PublicActivity{}
	if obsErr == nil && publicAllowed {
		activity = a.publicActivityFromPacket(ctx, observation, nil)
	}
	var commit store.NonEdgeActivityCommitResult
	attempts := 0
	err := a.retryStoreWriteLane(ctx, writeLaneLiveCore, "non-edge resolution and activity", func(writeCtx context.Context) error {
		attempts++
		var err error
		commit, err = a.Store.CommitNonEdgeActivity(writeCtx, store.NonEdgeActivityCommitRequest{
			ObservationID: job.observationID, ResolutionStatus: status, ResolutionReason: reason,
			PublishPublicEvent: obsErr == nil && publicAllowed && a.Config.PublicEventsEnabled,
			Activity:           activity, DedupeKey: job.msg.IngestID + ":packet-activity",
			ReceivedAtMs: job.msg.ReceivedAtMs,
		})
		return err
	})
	if err != nil {
		a.Log.Warn("non-edge resolution/activity commit failed", "observationID", job.observationID, "error", err)
		return
	}
	if obsErr == nil && (commit.EventInserted || attempts > 1 || !a.Config.PublicEventsEnabled || !publicAllowed) {
		a.Hub.Broadcast("packetObservation", observation)
	}
	if commit.EventPresent && (commit.EventInserted || attempts > 1) {
		a.broadcastCommittedPublicEvent(commit.PublicEvent)
	}
	if obsErr == nil && publicAllowed && !a.Config.PublicEventsEnabled {
		a.PublicCache.ApplyActivity(activity)
		a.PublicHub.BroadcastUnsequenced("activity", activity)
	}
}

func (a *Application) broadcastCommittedPublicEvent(event live.PublicEvent) {
	data := live.PublicEventDataWithSeq(event.Data, event.Seq)
	event.Data = data
	switch item := data.(type) {
	case live.PublicActivity:
		a.PublicCache.ApplyActivity(item)
	case live.PublicRoutePulse:
		a.PublicCache.ApplyRoutePulse(item)
	case live.PublicNode:
		a.PublicCache.ApplyNode(item)
	}
	a.PublicHub.BroadcastPublicEvent(event)
	if event.ReceivedAt > 0 {
		a.Runtime.RecordBroadcastLatency(time.Since(time.UnixMilli(event.ReceivedAt)))
	}
}

func (a *Application) broadcastNodeUpdateForIATA(ctx context.Context, node live.Node, iata string, dedupeKeys ...string) {
	a.Hub.Broadcast("nodeUpdate", node)
	if iata != "" && !a.PublicCache.AllowsIATA(iata) {
		a.PublicCache.RecordExcludedIATA(iata)
		return
	}
	if publicNode, ok := live.PublicNodeFromNode(node); ok {
		filteredIATAs := a.PublicCache.AllowedIATAs(publicNode.IATAsHeardIn)
		if len(publicNode.IATAsHeardIn) > 0 && len(filteredIATAs) == 0 {
			return
		}
		publicNode.IATAsHeardIn = filteredIATAs
		published, apply := a.publishPublicEvent(ctx, "nodeUpdate", publicNode, dedupeKeys...)
		publicNode = published.(live.PublicNode)
		if apply {
			a.PublicCache.ApplyNode(publicNode)
		}
	}
}

type publicEventPublication struct {
	eventType  string
	data       any
	dedupeKey  string
	receivedAt int64
}

type publicEventPublicationResult struct {
	data  any
	apply bool
}

// publishPublicEvent returns apply=false only when the dedupe key already
// exists. Callers must then avoid applying the old event to the live cache.
// Explicitly non-durable configurations still return true. When durable events
// are enabled, an insert failure is never broadcast or applied ahead of its
// recovery cursor.
func (a *Application) publishPublicEvent(ctx context.Context, eventType string, data any, dedupeKeys ...string) (published any, apply bool) {
	dedupeKey := ""
	if len(dedupeKeys) > 0 {
		dedupeKey = dedupeKeys[0]
	}
	results := a.publishPublicEventBatch(ctx, []publicEventPublication{{eventType: eventType, data: data, dedupeKey: dedupeKey}})
	if len(results) == 0 {
		return data, false
	}
	return results[0].data, results[0].apply
}

func (a *Application) publishPublicEventBatch(ctx context.Context, publications []publicEventPublication) []publicEventPublicationResult {
	results := make([]publicEventPublicationResult, len(publications))
	for i := range publications {
		results[i] = publicEventPublicationResult{data: publications[i].data, apply: true}
	}
	if len(publications) == 0 {
		return results
	}
	if a == nil || a.PublicHub == nil {
		return results
	}
	if !a.Config.PublicEventsEnabled || a.Store == nil {
		for _, publication := range publications {
			a.PublicHub.BroadcastUnsequenced(publication.eventType, publication.data)
		}
		return results
	}
	events := make([]live.PublicEvent, len(publications))
	for i, publication := range publications {
		events[i] = live.PublicEventFromData(publication.eventType, publication.data)
		events[i].DedupeKey = strings.TrimSpace(publication.dedupeKey)
		events[i].ReceivedAt = publication.receivedAt
	}
	var stored []live.PublicEvent
	var inserted []bool
	err := a.retryStoreWriteLane(ctx, writeLaneLiveCore, "public event batch insert", func(ctx context.Context) error {
		var err error
		stored, inserted, err = a.Store.InsertPublicEventsOnce(ctx, events)
		return err
	})
	if err != nil {
		a.Log.Warn("public event batch insert failed", "count", len(events), "error", err)
		for i := range results {
			results[i].apply = false
		}
		return results
	}
	for i, event := range stored {
		if !inserted[i] {
			results[i].apply = false
			continue
		}
		data := live.PublicEventDataWithSeq(publications[i].data, event.Seq)
		event.Data = data
		results[i].data = data
		a.PublicHub.BroadcastPublicEvent(event)
		if a.Runtime != nil && event.ReceivedAt > 0 {
			a.Runtime.RecordBroadcastLatency(time.Since(time.UnixMilli(event.ReceivedAt)))
		}
	}
	return results
}

func (a *Application) retryStoreWrite(ctx context.Context, label string, fn func(context.Context) error) error {
	return a.retryStoreWriteLane(ctx, writeLaneLiveCore, label, fn)
}

func (a *Application) retryStoreWriteLane(ctx context.Context, lane writeLane, label string, fn func(context.Context) error) error {
	started := time.Now()
	var err error
	retries := 0
	delay := time.Duration(0)
	for attempt := 0; ; attempt++ {
		if delay > 0 {
			select {
			case <-ctx.Done():
				if err != nil {
					a.Runtime.RecordStoreWrite(time.Since(started), retries, true, isSQLiteBusy(err), isSQLiteFull(err))
					return err
				}
				err = ctx.Err()
				a.Runtime.RecordStoreWrite(time.Since(started), retries, true, false, false)
				return err
			case <-time.After(delay):
			}
		}
		err = a.coordinateStoreWrite(ctx, lane, fn)
		if err == nil {
			if attempt > 0 && a != nil && a.Log != nil {
				a.Log.Debug("sqlite write recovered after retry", "operation", label, "attempt", attempt+1)
			}
			a.Runtime.RecordStoreWrite(time.Since(started), retries, false, false, false)
			return nil
		}
		if ctx.Err() != nil {
			if errors.Is(err, context.DeadlineExceeded) && lane == writeLanePrimary {
				a.Runtime.RecordPrimaryDeadlineFailure()
			}
			a.Runtime.RecordStoreWrite(time.Since(started), retries, true, isSQLiteBusy(err), isSQLiteFull(err))
			return err
		}
		if !isTransientStoreWrite(err) {
			a.Runtime.RecordStoreWrite(time.Since(started), retries, true, false, isSQLiteFull(err))
			return err
		}
		if errors.Is(err, context.DeadlineExceeded) && lane == writeLanePrimary {
			a.Runtime.RecordPrimaryDeadlineFailure()
		}
		retries++
		if delay == 0 {
			delay = 50 * time.Millisecond
		} else {
			delay = min(delay*2, storeRetryMaxBackoff)
		}
	}
}

func (a *Application) coordinateStoreWrite(ctx context.Context, lane writeLane, fn func(context.Context) error) error {
	if a != nil && a.writeCoordinator != nil {
		return a.writeCoordinator.Do(ctx, lane, fn)
	}
	return fn(ctx)
}

func isTransientStoreWrite(err error) bool {
	return isSQLiteBusy(err) || errors.Is(err, context.DeadlineExceeded)
}

func isSQLiteBusy(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "sqlite_busy") || strings.Contains(text, "database is locked") || strings.Contains(text, "database table is locked")
}

func isSQLiteFull(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "sqlite_full") || strings.Contains(text, "database or disk is full") || strings.Contains(text, "disk full")
}

func (a *Application) publicActivityFromPacket(ctx context.Context, observation live.PacketObservation, routeIDs []string) live.PublicActivity {
	return live.PublicActivityFromPacket(observation, routeIDs, a.publicObserverLocation(ctx, observation))
}

func (a *Application) publicObserverLocation(ctx context.Context, observation live.PacketObservation) *live.PublicObserverLocation {
	if node, err := a.Store.NodeByPublicKey(ctx, observation.ObserverPublicKey); err == nil {
		if location := live.PublicObserverLocationFromNode(node, observation.IATA); location != nil {
			return location
		}
	}
	if observer, err := a.Store.ObserverByPublicKeyIATA(ctx, observation.ObserverPublicKey, observation.IATA); err == nil {
		return live.PublicObserverLocationFromObserver(observer)
	}
	return nil
}

func (a *Application) edgeDecision(ctx context.Context, msg imqtt.NormalizedMessage, parsed meshcore.ParsedPacket, resolution resolve.Result, advertNode *live.Node) (string, string) {
	if parsed.InvalidForMap {
		return resolve.StatusInvalidForMap, parsed.InvalidReason
	}
	if a.Config.RequireRSSIOrSNRForEdge && msg.RSSI == nil && msg.SNR == nil {
		return resolve.StatusMissingRF, "strict mode requires RSSI or SNR"
	}
	if parsed.HopCount > 0 && !resolution.IsHigh() {
		return resolution.Status, resolution.Reason
	}
	_, status, reason := a.routeEndpoints(ctx, msg, parsed, resolution, advertNode)
	if status != resolve.StatusHigh {
		return status, reason
	}
	return resolve.StatusHigh, "resolved_path_high_confidence"
}

func (a *Application) buildEdgeEvent(ctx context.Context, msg imqtt.NormalizedMessage, parsed meshcore.ParsedPacket, observationID int64, resolution resolve.Result, advertNode *live.Node, decodedMessage meshcore.DecodedPublicMessage) (live.EdgeEvent, bool, string, string) {
	if a.Config.RequireRSSIOrSNRForEdge && msg.RSSI == nil && msg.SNR == nil {
		return live.EdgeEvent{}, false, resolve.StatusMissingRF, "strict mode requires RSSI or SNR"
	}
	endpoints, status, reason := a.routeEndpoints(ctx, msg, parsed, resolution, advertNode)
	if status != resolve.StatusHigh {
		return live.EdgeEvent{}, false, status, reason
	}
	segments := make([]live.EdgeSegment, 0, len(endpoints)-1)
	for i := 0; i+1 < len(endpoints); i++ {
		from := endpoints[i]
		to := endpoints[i+1]
		dist := live.HaversineKM(from.Lat, from.Lng, to.Lat, to.Lng)
		if resolve.ShouldRejectDistance(dist, a.Config.MaxUnverifiedEdgeKM, parsed.PayloadType == meshcore.PayloadTrace, a.Config.AllowLongTraceEdges, false) {
			return live.EdgeEvent{}, false, resolve.StatusDistanceGate, "segment exceeds MAX_UNVERIFIED_EDGE_KM"
		}
		segments = append(segments, live.EdgeSegment{From: from, To: to, DistanceKM: dist, SNR: msg.SNR, RSSI: msg.RSSI})
	}
	return live.EdgeEvent{
		PacketHash:      parsed.PacketHash,
		ObservationID:   observationID,
		IATA:            strings.ToUpper(msg.TopicInfo.IATA),
		PayloadType:     parsed.PayloadType,
		PayloadTypeName: parsed.PayloadTypeName,
		MessageSender:   decodedMessage.Sender,
		MessageText:     decodedMessage.Text,
		MessageAnchor:   a.messageAnchorEndpoint(ctx, msg, parsed, advertNode, decodedMessage),
		HeardAt:         msg.HeardAtMs,
		Segments:        segments,
		RenderReason:    "resolved_path_high_confidence",
	}, true, resolve.StatusHigh, "resolved_path_high_confidence"
}

func (a *Application) messageAnchorEndpoint(ctx context.Context, msg imqtt.NormalizedMessage, parsed meshcore.ParsedPacket, advertNode *live.Node, decodedMessage meshcore.DecodedPublicMessage) *live.MessageAnchor {
	if strings.TrimSpace(decodedMessage.Text) == "" {
		return nil
	}
	if advertNode != nil && hasCoords(*advertNode) {
		return &live.MessageAnchor{Kind: "source", Endpoint: nodeEndpoint(*advertNode)}
	}
	if origin, ok := a.originEndpoint(ctx, msg, parsed, advertNode); ok {
		return &live.MessageAnchor{Kind: "source", Endpoint: origin}
	}
	if observer, ok := a.observerEndpoint(ctx, msg); ok {
		return &live.MessageAnchor{Kind: "observer", Endpoint: observer}
	}
	return nil
}

func (a *Application) routeEndpoints(ctx context.Context, msg imqtt.NormalizedMessage, parsed meshcore.ParsedPacket, resolution resolve.Result, advertNode *live.Node) ([]live.EdgeEndpoint, string, string) {
	if parsed.HopCount == 0 {
		if parsed.PayloadType != meshcore.PayloadAdvert || advertNode == nil || !hasCoords(*advertNode) {
			return nil, resolve.StatusNoPath, resolution.Reason
		}
		observer, ok := a.observerEndpoint(ctx, msg)
		if !ok {
			return nil, resolve.StatusMissingCoords, "observer has no coordinates"
		}
		return []live.EdgeEndpoint{nodeEndpoint(*advertNode), observer}, resolve.StatusHigh, "zero_hop_advert_with_observer"
	}
	if !resolution.IsHigh() {
		return nil, resolution.Status, resolution.Reason
	}

	endpoints := []live.EdgeEndpoint{}
	if origin, ok := a.originEndpoint(ctx, msg, parsed, advertNode); ok {
		endpoints = appendEndpoint(endpoints, origin)
	}
	for _, hop := range resolution.Hops {
		if !candidateHasCoords(hop.Candidate) {
			return nil, resolve.StatusMissingCoords, "resolved hop missing coordinates"
		}
		endpoints = appendEndpoint(endpoints, candidateEndpoint(hop.Candidate))
	}
	if observer, ok := a.observerEndpoint(ctx, msg); ok {
		endpoints = appendEndpoint(endpoints, observer)
	}
	if len(endpoints) < 2 {
		return nil, resolve.StatusMissingCoords, "not enough positioned endpoints for a real segment"
	}
	return endpoints, resolve.StatusHigh, "resolved_path_high_confidence"
}

func (a *Application) originEndpoint(ctx context.Context, msg imqtt.NormalizedMessage, parsed meshcore.ParsedPacket, advertNode *live.Node) (live.EdgeEndpoint, bool) {
	if advertNode != nil && hasCoords(*advertNode) {
		return nodeEndpoint(*advertNode), true
	}
	if publicKey := fullPublicKeyFromPayload(parsed); publicKey != "" {
		node, err := a.Store.NodeByPublicKey(ctx, publicKey)
		if err == nil && hasCoords(node) {
			return nodeEndpoint(node), true
		}
	}
	prefix, ok := sourcePrefixFromPayload(parsed)
	if !ok {
		return live.EdgeEndpoint{}, false
	}
	candidates, err := a.Store.CandidatesByPrefix(ctx, msg.TopicInfo.IATA, 1, prefix)
	if err != nil {
		return live.EdgeEndpoint{}, false
	}
	positioned := []resolve.Candidate{}
	for _, candidate := range candidates {
		if candidateHasCoords(candidate) {
			positioned = append(positioned, candidate)
		}
	}
	if len(positioned) != 1 {
		return live.EdgeEndpoint{}, false
	}
	return candidateEndpoint(positioned[0]), true
}

func (a *Application) observerEndpoint(ctx context.Context, msg imqtt.NormalizedMessage) (live.EdgeEndpoint, bool) {
	node, err := a.Store.NodeByPublicKey(ctx, msg.TopicInfo.PublisherPK)
	if err == nil && hasCoords(node) {
		return nodeEndpoint(node), true
	}
	observer, err := a.Store.ObserverByPublicKeyIATA(ctx, msg.TopicInfo.PublisherPK, msg.TopicInfo.IATA)
	if err != nil {
		return live.EdgeEndpoint{}, false
	}
	return observerRecordEndpoint(observer)
}

func observerRecordEndpoint(observer live.Observer) (live.EdgeEndpoint, bool) {
	if observer.Latitude == nil || observer.Longitude == nil || !validMapCoords(*observer.Latitude, *observer.Longitude) {
		return live.EdgeEndpoint{}, false
	}
	return live.EdgeEndpoint{
		NodeID:    observer.PublicKey,
		Name:      displayName(observer.Name, observer.PublicKey),
		Lat:       *observer.Latitude,
		Lng:       *observer.Longitude,
		PathHash3: pathHash3(observer.PublicKey),
	}, true
}

func fullPublicKeyFromPayload(parsed meshcore.ParsedPacket) string {
	if parsed.PayloadType == meshcore.PayloadAnonReq && len(parsed.Payload) >= 33 {
		return strings.ToUpper(hex.EncodeToString(parsed.Payload[1:33]))
	}
	return ""
}

func sourcePrefixFromPayload(parsed meshcore.ParsedPacket) (string, bool) {
	switch parsed.PayloadType {
	case meshcore.PayloadRequest, meshcore.PayloadResponse, meshcore.PayloadPlainText, meshcore.PayloadPath:
		if len(parsed.Payload) >= 2 {
			return strings.ToUpper(hex.EncodeToString(parsed.Payload[1:2])), true
		}
	}
	return "", false
}

func (a *Application) logCounters(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			snapshot := a.runtimeCounterLogSnapshot(time.Now())
			a.Log.Info("runtime counters",
				"mqtt_connected", snapshot.MQTTConnected,
				"mqtt_messages_total", snapshot.MQTTMessagesTotal,
				"mqtt_messages_dropped", snapshot.MQTTMessagesDropped,
				"mqtt_last_message_age_ms", snapshot.MQTTLastMessageAgeMs,
				"packets_total", snapshot.PacketsTotal,
				"public_nodes", snapshot.PublicNodes,
				"public_routes", snapshot.PublicRoutes,
				"public_recent_pulses", snapshot.PublicRecentPulses,
				"public_recent_activity", snapshot.PublicRecentActivity,
				"public_cache_age_ms", snapshot.PublicCacheAgeMs,
				"public_cache_truncated_nodes", snapshot.PublicCacheTruncatedNodes,
				"public_cache_truncated_routes", snapshot.PublicCacheTruncatedRoutes,
				"public_cache_truncated_pulses", snapshot.PublicCacheTruncatedPulses,
				"public_cache_truncated_activity", snapshot.PublicCacheTruncatedActivity,
				"ws_clients", snapshot.WSClients,
				"public_ws_clients", snapshot.PublicWSClients,
				"public_ws_dropped", snapshot.PublicWSDropped,
				"cache_refresh_failures", snapshot.CacheRefreshFailures,
				"cache_refresh_latency_ms", snapshot.CacheRefreshLatencyMs,
				"packet_count_refresh_failures", snapshot.PacketCountRefreshFailures,
				"packet_count_refresh_latency_ms", snapshot.PacketCountRefreshLatencyMs,
				"primary_queue_oldest_age_ms", snapshot.PrimaryQueueOldestAgeMs,
				"live_projection_oldest_age_ms", snapshot.LiveProjectionOldestAgeMs,
				"writer_primary_wait_ms", snapshot.WriterPrimaryWaitMs,
				"writer_live_core_wait_ms", snapshot.WriterLiveCoreWaitMs,
				"writer_background_wait_ms", snapshot.WriterBackgroundWaitMs,
				"primary_deadline_failures", snapshot.PrimaryDeadlineFailures,
				"store_write_failures", snapshot.StoreWriteFailures,
				"derived_projection_failures", snapshot.DerivedProjectionFailures,
				"last_broadcast_latency_ms", snapshot.LastBroadcastLatencyMs,
				"max_broadcast_latency_ms", snapshot.MaxBroadcastLatencyMs,
			)
		}
	}
}

func (a *Application) runtimeCounterLogSnapshot(now time.Time) runtimeCounterLogSnapshot {
	var out runtimeCounterLogSnapshot
	if a == nil {
		return out
	}
	if now.IsZero() {
		now = time.Now()
	}
	if a.MQTT != nil {
		mqtt := a.MQTT.Status(now)
		out.MQTTConnected = mqtt.Connected
		out.MQTTMessagesTotal = mqtt.TotalMessages
		out.MQTTMessagesDropped = mqtt.DroppedMessages
		out.MQTTLastMessageAgeMs = mqtt.LastMessageAgeMs
		out.PrimaryQueueOldestAgeMs = mqtt.OldestQueueItemAgeMs
	}
	if a.Hub != nil {
		out.WSClients = a.Hub.Stats().Clients
	}
	if a.PublicHub != nil {
		publicHub := a.PublicHub.Stats()
		out.PublicWSClients = publicHub.Clients
		out.PublicWSDropped = publicHub.DroppedMessages
	}
	if a.PublicCache != nil {
		cacheStatus := a.PublicCache.Status(now)
		out.PublicCacheAgeMs = cacheStatus.CacheAgeMs
		out.PublicCacheTruncatedNodes = cacheStatus.TruncatedNodes
		out.PublicCacheTruncatedRoutes = cacheStatus.TruncatedRoutes
		out.PublicCacheTruncatedPulses = cacheStatus.TruncatedRecentPulses
		out.PublicCacheTruncatedActivity = cacheStatus.TruncatedRecentActivity
		if state, ok := a.PublicCache.Snapshot(); ok {
			out.PacketsTotal = state.Stats.Packets
			out.PublicNodes = len(state.Nodes)
			out.PublicRoutes = len(state.Routes)
			out.PublicRecentPulses = len(state.RecentPulses)
			out.PublicRecentActivity = len(state.RecentActivity)
		}
	}
	if count := a.packetCount.Load(); count > 0 {
		out.PacketsTotal = count
	}
	if a.Runtime != nil {
		runtime := a.Runtime.Snapshot()
		out.CacheRefreshFailures = runtime.CacheRefreshFailures
		out.CacheRefreshLatencyMs = runtime.CacheRefreshLastLatencyMs
		out.PacketCountRefreshFailures = runtime.PacketCountRefreshFailures
		out.PacketCountRefreshLatencyMs = runtime.PacketCountRefreshLastLatencyMs
		out.PrimaryQueueOldestAgeMs = max(out.PrimaryQueueOldestAgeMs, currentRuntimeQueueAgeMs(now.UnixMilli(), runtime.WriterPrimaryOldestAtMs))
		out.LiveProjectionOldestAgeMs = max(currentRuntimeQueueAgeMs(now.UnixMilli(), runtime.DerivedOldestAtMs), currentRuntimeQueueAgeMs(now.UnixMilli(), runtime.WriterLiveCoreOldestAtMs), currentRuntimeQueueAgeMs(now.UnixMilli(), runtime.DerivedProjectionOldestAtMs))
		out.WriterPrimaryWaitMs = runtime.WriterPrimaryLastWaitMs
		out.WriterLiveCoreWaitMs = runtime.WriterLiveCoreLastWaitMs
		out.WriterBackgroundWaitMs = runtime.WriterBackgroundLastWaitMs
		out.PrimaryDeadlineFailures = runtime.PrimaryDeadlineFailures
		out.StoreWriteFailures = runtime.StoreWriteFailures
		out.DerivedProjectionFailures = runtime.DerivedProjectionFailures
		out.LastBroadcastLatencyMs = runtime.LastBroadcastLatencyMs
		out.MaxBroadcastLatencyMs = runtime.MaxBroadcastLatencyMs
	}
	return out
}

func currentRuntimeQueueAgeMs(nowMs, queuedAtMs int64) int64 {
	if queuedAtMs <= 0 {
		return 0
	}
	return max(nowMs-queuedAtMs, 0)
}

func (a *Application) RefreshPublicStateCache(ctx context.Context) error {
	start := time.Now()
	failed := true
	defer func() {
		a.Runtime.RecordCacheRefresh(time.Since(start), failed)
	}()
	cacheGeneration := a.PublicCache.MutationGeneration()
	state, err := a.Store.LiveState(ctx, a.Config.RecentPacketLimit, a.Config.RecentEdgeEventLimit)
	if err != nil {
		return err
	}
	filtered, excluded := a.PublicCache.FilterState(state)
	publicStats := live.PublicStats{
		Packets:       int64(len(filtered.RecentPackets)),
		MQTTConnected: a.MQTT.Connected(),
		MQTTMessages:  a.MQTT.TotalMessages(),
		WSClients:     a.Hub.ClientCount() + a.PublicHub.ClientCount(),
		ServerTime:    time.Now().UnixMilli(),
		LatestSeq:     a.PublicHub.LatestSeq(),
	}
	if count := a.packetCount.Load(); count > 0 {
		publicStats.Packets = count
	}
	publicState := live.BuildPublicLiveState(filtered, publicStats)
	publicState.Map = live.PublicMapConfig{
		RegionPreset:  a.Config.MapRegionPreset,
		DefaultRegion: a.Config.DefaultRegion,
		DefaultCenter: []float64{a.Config.DefaultCenterLng, a.Config.DefaultCenterLat},
		DefaultZoom:   a.Config.DefaultZoom,
		Bounds:        a.Config.MapBounds,
	}
	a.PublicCache.ReplacePreservingMutations(publicState, excluded, cacheGeneration)
	failed = false
	return nil
}

func (a *Application) refreshPublicStateCacheLoop(ctx context.Context) {
	interval := time.Duration(a.Config.PublicCacheRefreshSec) * time.Second
	if interval <= 0 {
		interval = 10 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.refreshPublicStateCacheOnce(ctx, "refresh")
		}
	}
}

func (a *Application) refreshPublicStateCacheOnce(ctx context.Context, phase string) {
	if !a.cacheRefreshMu.TryLock() {
		a.Log.Debug("public state cache refresh skipped; refresh already running", "phase", phase)
		return
	}
	defer a.cacheRefreshMu.Unlock()
	timeout := time.Duration(a.Config.PublicCacheRefreshSec) * time.Second
	if timeout < 30*time.Second {
		timeout = 30 * time.Second
	}
	if timeout > 60*time.Second {
		timeout = 60 * time.Second
	}
	refreshCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := a.RefreshPublicStateCache(refreshCtx); err != nil {
		a.Log.Warn("public state cache refresh failed", "phase", phase, "error", err)
	}
}

func (a *Application) refreshPacketCountLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.refreshPacketCountOnce(ctx)
		}
	}
}

func (a *Application) refreshPacketCountOnce(ctx context.Context) {
	start := time.Now()
	failed := true
	defer func() {
		a.Runtime.RecordPacketCountRefresh(time.Since(start), failed)
	}()
	countCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	count, err := a.Store.PacketCount(countCtx)
	if err != nil {
		a.Log.Warn("packet count refresh failed", "error", err)
		return
	}
	a.packetCount.Store(count)
	a.PublicCache.SetPacketCount(count)
	failed = false
}

func (a *Application) solarFetchLoop(ctx context.Context) {
	seedFromDB := func() {
		snap, err := a.Store.LatestSolarSnapshot(ctx)
		if err != nil {
			a.Log.Debug("solar cache seed skipped, no prior snapshot in database", "error", err)
			return
		}
		cond := solar.Conditions{
			ServerTime:     snap.FetchedAtMs,
			KpIndex:        snap.KpIndex,
			KpLabel:        solar.KpLabelPublic(snap.KpIndex),
			SolarFluxSFU:   snap.SolarFluxSfu,
			SolarFluxLabel: solar.FluxLabelPublic(snap.SolarFluxSfu),
			GeomagActivity: snap.GeomagActivity,
			FetchedAt:      snap.FetchedAtMs,
		}
		a.solarSnapshot.Store(&cond)
		a.Log.Info("solar cache seeded from database", "kp", cond.KpIndex, "flux", cond.SolarFluxSFU)
	}
	if ctx.Err() != nil {
		return
	}
	seedFromDB()
	if ctx.Err() != nil {
		return
	}
	fetchWithRetry := func() {
		backoffs := []time.Duration{0, 30 * time.Second, 60 * time.Second, 120 * time.Second}
		for i, backoff := range backoffs {
			if backoff > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(backoff):
				}
			}
			cond, err := a.Solar.Fetch(ctx)
			if err != nil {
				a.Log.Warn("solar fetch failed", "attempt", i+1, "error", err)
				continue
			}
			a.solarSnapshot.Store(&cond)
			if err := a.retryStoreWriteLane(ctx, writeLaneBackground, "solar snapshot insert", func(writeCtx context.Context) error {
				_, err := a.Store.InsertSolarSnapshot(writeCtx, store.SolarSnapshot{
					FetchedAtMs: cond.FetchedAt, KpIndex: cond.KpIndex, SolarFluxSfu: cond.SolarFluxSFU, GeomagActivity: cond.GeomagActivity,
				})
				return err
			}); err != nil {
				a.Log.Warn("solar insert failed", "error", err)
			}
			_ = a.retryStoreWriteLane(ctx, writeLaneBackground, "solar snapshot trim", func(writeCtx context.Context) error {
				return a.Store.TrimSolarSnapshots(writeCtx, 288)
			})
			return
		}
	}
	fetchWithRetry()
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fetchWithRetry()
		}
	}
}

const (
	publicBackfillStartupQuietDelay = 60 * time.Second
	publicBackfillIdlePollInterval  = time.Second
	publicBackfillBatchPause        = time.Second
	publicBackfillErrorPause        = 30 * time.Second
	publicBackfillBatchLimit        = 50
	publicBackfillBatchTimeout      = 2 * time.Second
	publicBackfillLiveQuietWindow   = 2 * time.Second
)

type publicBackfillStage struct {
	name string
	run  func(context.Context) (bool, error)
}

// backfillPublicProjectionsLoop owns both projection backfills so their write
// transactions can never overlap. Packet-path projection also updates route
// summaries, so draining it first avoids duplicate work in the legacy route
// summary catch-up stage.
func (a *Application) backfillPublicProjectionsLoop(ctx context.Context) {
	if !a.Config.PublicPacketPathBackfillEnabled {
		return
	}
	batch := boundedPublicBackfillBatch(a.Config.PublicPacketPathBackfillBatch)
	if batch <= 0 || !waitForContext(ctx, publicBackfillStartupQuietDelay) {
		return
	}
	packetWindow := time.Duration(a.Config.PublicPacketPathBackfillHours) * time.Hour
	if packetWindow <= 0 {
		packetWindow = 24 * time.Hour
	}
	packetBatch := batch
	stages := []publicBackfillStage{{
		name: "public packet path",
		run: func(ctx context.Context) (bool, error) {
			remaining, err := a.backfillPublicPacketPathsOnce(ctx, packetWindow, packetBatch)
			packetBatch = reducedPublicBackfillBatch(packetBatch, err)
			return remaining, err
		},
	}}
	if retentionDays := a.effectiveDataRetentionDays(); retentionDays >= 0 {
		routeWindow := time.Duration(retentionDays) * 24 * time.Hour
		routeBatch := batch
		stages = append(stages, publicBackfillStage{
			name: "public route summary",
			run: func(ctx context.Context) (bool, error) {
				remaining, err := a.backfillPublicRouteSummariesOnce(ctx, routeWindow, routeBatch)
				routeBatch = reducedPublicBackfillBatch(routeBatch, err)
				return remaining, err
			},
		})
	}
	runPublicBackfillStages(ctx, stages, a.waitForPublicBackfillIdle, waitForContext, func(name string, err error) {
		a.Log.Warn(name+" backfill failed", "error", err)
	})
}

func boundedPublicBackfillBatch(configured int) int {
	if configured <= 0 {
		return 0
	}
	return min(configured, publicBackfillBatchLimit)
}

func reducedPublicBackfillBatch(current int, err error) int {
	if current <= 1 || !errors.Is(err, context.DeadlineExceeded) {
		return current
	}
	return max(current/2, 1)
}

func runPublicBackfillStages(
	ctx context.Context,
	stages []publicBackfillStage,
	waitUntilIdle func(context.Context) bool,
	wait func(context.Context, time.Duration) bool,
	onError func(string, error),
) {
	for _, stage := range stages {
		remaining := true
		for remaining {
			if !waitUntilIdle(ctx) {
				return
			}
			var err error
			remaining, err = stage.run(ctx)
			if err != nil {
				if onError != nil {
					onError(stage.name, err)
				}
				remaining = true
				if !wait(ctx, publicBackfillErrorPause) {
					return
				}
				continue
			}
			if remaining && !wait(ctx, publicBackfillBatchPause) {
				return
			}
		}
	}
}

func (a *Application) waitForPublicBackfillIdle(ctx context.Context) bool {
	for {
		now := time.Now()
		mqttStatus := imqtt.Status{}
		if a.MQTT != nil {
			mqttStatus = a.MQTT.Status(now)
		}
		runtimeStatus := live.RuntimeStatsSnapshot{}
		if a.Runtime != nil {
			runtimeStatus = a.Runtime.Snapshot()
		}
		storageState := "ok"
		if a.Store != nil {
			storageState = a.Store.StorageInfo().PressureState
		}
		if allowed, _ := publicBackfillAllowed(mqttStatus, runtimeStatus, storageState, now.UnixMilli()); allowed {
			return true
		}
		if !waitForContext(ctx, publicBackfillIdlePollInterval) {
			return false
		}
	}
}

func publicBackfillAllowed(mqttStatus imqtt.Status, runtimeStatus live.RuntimeStatsSnapshot, storageState string, nowMs int64) (bool, string) {
	if storageState == "warn" || storageState == "critical" {
		return false, "storage_pressure"
	}
	primaryInFlight := mqttStatus.AcceptedMessages > mqttStatus.ProcessedMessages
	if mqttStatus.QueueDepth > 0 || mqttStatus.OldestQueueItemAgeMs > 0 || primaryInFlight {
		return false, "primary_ingest_active"
	}
	if mqttStatus.LastMessageAt > 0 && mqttStatus.LastMessageAgeMs < publicBackfillLiveQuietWindow.Milliseconds() {
		return false, "primary_ingest_recent"
	}
	derivedOldestAge := int64(0)
	if runtimeStatus.DerivedOldestAtMs > 0 {
		derivedOldestAge = max(nowMs-runtimeStatus.DerivedOldestAtMs, 0)
	}
	derivedInFlight := runtimeStatus.DerivedAccepted > runtimeStatus.DerivedProcessed
	if runtimeStatus.DerivedQueueDepth > 0 || derivedOldestAge > 0 || derivedInFlight {
		return false, "derived_ingest_active"
	}
	return true, ""
}

func waitForContext(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (a *Application) backfillPublicPacketPathsOnce(ctx context.Context, window time.Duration, batch int) (bool, error) {
	now := time.Now()
	start := time.Now()
	backfillCtx, cancel := context.WithTimeout(ctx, publicBackfillBatchTimeout)
	defer cancel()
	var result store.PublicPacketPathBackfillResult
	err := a.coordinateStoreWrite(backfillCtx, writeLaneBackground, func(writeCtx context.Context) error {
		var err error
		result, err = a.Store.BackfillPublicPacketPaths(writeCtx, now.Add(-window).UnixMilli(), now.UnixMilli(), batch)
		return err
	})
	if err != nil {
		a.Runtime.RecordPacketPathBackfill(time.Since(start), true, 0, 0, 0, 0, 0, true, true)
		return true, err
	}
	a.Runtime.RecordPacketPathBackfill(time.Since(start), false, result.Scanned, result.Projected, result.Mappable, result.NonMappable, result.SearchIndexed, result.SearchIndexRemaining, result.Remaining)
	if result.Scanned > 0 || result.SearchIndexed > 0 {
		a.Log.Info("public packet path backfill",
			"scanned", result.Scanned,
			"projected", result.Projected,
			"mappable", result.Mappable,
			"non_mappable", result.NonMappable,
			"search_indexed", result.SearchIndexed,
			"search_index_remaining", result.SearchIndexRemaining,
			"remaining", result.Remaining,
		)
	}
	return result.Remaining, nil
}

func (a *Application) backfillPublicRouteSummariesOnce(ctx context.Context, window time.Duration, batch int) (bool, error) {
	now := time.Now()
	backfillCtx, cancel := context.WithTimeout(ctx, publicBackfillBatchTimeout)
	defer cancel()
	var result store.PublicRouteSummaryBackfillResult
	err := a.coordinateStoreWrite(backfillCtx, writeLaneBackground, func(writeCtx context.Context) error {
		var err error
		result, err = a.Store.BackfillPublicRouteSummaries(writeCtx, now.Add(-window).UnixMilli(), now.UnixMilli(), batch)
		return err
	})
	if err != nil {
		return true, err
	}
	if result.Scanned > 0 {
		a.Log.Info("public route summary backfill",
			"scanned", result.Scanned,
			"counted", result.Counted,
			"remaining", result.Remaining,
		)
	}
	return result.Remaining, nil
}

func (a *Application) propagationLoop(ctx context.Context) {
	interval := time.Duration(a.Config.PropagationFetchIntervalSec) * time.Second
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	initialDelay := 5 * time.Minute
	select {
	case <-ctx.Done():
		return
	case <-time.After(initialDelay):
	}
	a.refreshPropagationOnce(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.refreshPropagationOnce(ctx)
		}
	}
}

func (a *Application) refreshPropagationOnce(ctx context.Context) {
	if a.Store == nil {
		return
	}
	minDistance := a.Config.PropagationMinDistanceKM
	if minDistance <= 0 {
		minDistance = 75
	}
	now := time.Now()
	window := 24 * time.Hour
	queryCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	candidates, err := a.Store.PropagationCandidatePaths(queryCtx, now.Add(-window).UnixMilli(), now.UnixMilli(), minDistance, 40)
	if err != nil {
		a.Log.Warn("propagation candidate query failed", "error", err)
		return
	}
	if len(candidates) == 0 {
		return
	}
	classifier := propagation.Classifier{MinDistanceKM: minDistance}
	created := 0
	for _, packet := range candidates {
		if queryCtx.Err() != nil {
			break
		}
		region := strings.ToUpper(strings.TrimSpace(packet.Region))
		if region == "" {
			region = strings.ToUpper(strings.TrimSpace(packet.IATA))
		}
		if region != "" && a.PublicCache != nil && !a.PublicCache.AllowsIATA(region) {
			continue
		}
		lat, lng, ok := propagation.RouteMidpoint(packet)
		if !ok {
			continue
		}
		var weather *propagation.WeatherSample
		fetcher := a.Propagation
		if fetcher == nil {
			fetcher = propagation.NewWeatherFetcher(a.Log)
		}
		weatherCtx, weatherCancel := context.WithTimeout(queryCtx, 15*time.Second)
		sample, fetchErr := fetcher.Fetch(weatherCtx, lat, lng)
		weatherCancel()
		if fetchErr != nil {
			a.Log.Warn("propagation weather fetch failed", "packet", packet.ID, "error", fetchErr)
		} else {
			weather = &sample
			if insertErr := a.retryStoreWriteLane(queryCtx, writeLaneBackground, "propagation weather snapshot", func(writeCtx context.Context) error {
				_, err := a.Store.InsertPropagationWeatherSnapshot(writeCtx, propagationWeatherSnapshot(sample))
				return err
			}); insertErr != nil {
				a.Log.Warn("propagation weather snapshot insert failed", "error", insertErr)
			}
		}
		burstCount, burstErr := a.Store.PropagationRouteBurstCount(queryCtx, packet.RouteIDs, packet.At-int64(time.Hour/time.Millisecond), packet.At+int64(time.Hour/time.Millisecond), minDistance)
		if burstErr != nil {
			a.Log.Warn("propagation burst count failed", "packet", packet.ID, "error", burstErr)
		}
		event, ok := classifier.Classify(packet, weather, a.solarSnapshot.Load(), burstCount, now)
		if !ok {
			continue
		}
		if err := a.retryStoreWriteLane(queryCtx, writeLaneBackground, "propagation event upsert", func(writeCtx context.Context) error {
			return a.Store.UpsertPropagationEvent(writeCtx, event)
		}); err != nil {
			a.Log.Warn("propagation event insert failed", "event", event.ID, "error", err)
			continue
		}
		created++
	}
	if created > 0 {
		a.Log.Info("propagation events refreshed", "created", created, "candidates", len(candidates), "minDistanceKm", minDistance)
	}
}

func propagationWeatherSnapshot(sample propagation.WeatherSample) store.PropagationWeatherSnapshot {
	return store.PropagationWeatherSnapshot{
		Latitude:               sample.Latitude,
		Longitude:              sample.Longitude,
		WindDirectionDeg:       sample.WindDirectionDeg,
		Temperature950HPaC:     sample.Temperature950HPaC,
		DewPoint950HPaC:        sample.DewPoint950HPaC,
		RelativeHumidity950HPa: sample.RelativeHumidity950HPa,
		Summary:                sample.Summary,
	}
}

func loadYAMLConfig(path string, log *slog.Logger) yamlConfig {
	cfg := yamlConfig{ForwarderRoles: []string{"repeater", "room_server"}}
	if path == "" {
		return cfg
	}
	data, err := os.ReadFile(path)
	if err != nil {
		log.Debug("config yaml not loaded", "path", path, "error", err)
		return cfg
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		log.Warn("config yaml parse failed", "path", path, "error", err)
	}
	if len(cfg.ForwarderRoles) == 0 {
		cfg.ForwarderRoles = []string{"repeater", "room_server"}
	}
	return cfg
}

func publicIATAs(configured []string, yc yamlConfig) []string {
	seen := map[string]struct{}{}
	out := []string{}
	add := func(items ...string) {
		for _, item := range items {
			item = strings.ToUpper(strings.TrimSpace(item))
			if item == "" {
				continue
			}
			if _, ok := seen[item]; ok {
				continue
			}
			seen[item] = struct{}{}
			out = append(out, item)
		}
	}
	add(configured...)
	for _, region := range yc.Regions {
		add(region.IATAs...)
	}
	return out
}

func hasCoords(n live.Node) bool {
	return n.Latitude != nil && n.Longitude != nil && validMapCoords(*n.Latitude, *n.Longitude)
}

func candidateHasCoords(candidate resolve.Candidate) bool {
	return candidate.Latitude != nil && candidate.Longitude != nil && validMapCoords(*candidate.Latitude, *candidate.Longitude)
}

func validMapCoords(lat float64, lng float64) bool {
	return live.ValidPublicCoords(lat, lng)
}

func nodeEndpoint(n live.Node) live.EdgeEndpoint {
	return live.EdgeEndpoint{NodeID: n.NodeID, Name: displayName(n.Name, n.PublicKey), Lat: *n.Latitude, Lng: *n.Longitude, PathHash3: pathHash3(n.PublicKey)}
}

func candidateEndpoint(candidate resolve.Candidate) live.EdgeEndpoint {
	return live.EdgeEndpoint{
		NodeID:    candidate.NodeID,
		Name:      displayName(candidate.Name, candidate.PublicKey),
		Lat:       *candidate.Latitude,
		Lng:       *candidate.Longitude,
		PathHash3: pathHash3(candidate.PublicKey),
	}
}

func pathHash3(publicKey string) string {
	publicKey = strings.ToUpper(strings.TrimSpace(publicKey))
	if len(publicKey) < 6 {
		return ""
	}
	prefix := publicKey[:6]
	for _, char := range prefix {
		if (char >= '0' && char <= '9') || (char >= 'A' && char <= 'F') {
			continue
		}
		return ""
	}
	return prefix
}

func appendEndpoint(endpoints []live.EdgeEndpoint, endpoint live.EdgeEndpoint) []live.EdgeEndpoint {
	if len(endpoints) > 0 && endpoints[len(endpoints)-1].NodeID == endpoint.NodeID {
		return endpoints
	}
	return append(endpoints, endpoint)
}

func displayName(name, publicKey string) string {
	if strings.TrimSpace(name) != "" {
		return name
	}
	if len(publicKey) >= 8 {
		return publicKey[:8]
	}
	return publicKey
}

func redact(in string) string {
	if len(in) <= 8 {
		return "redacted"
	}
	return in[:4] + "..." + in[len(in)-4:]
}

func redactedURL(in string) string {
	if strings.Contains(in, "@") {
		return "redacted"
	}
	return in
}

const (
	retentionPruneInitialDelay          = 30 * time.Second
	retentionPruneInterval              = time.Minute
	retentionPruneRetryDelay            = 5 * time.Second
	retentionPruneCycleBudget           = 55 * time.Second
	retentionPruneMaxRowsPerCycle int64 = 2_000_000

	// MeshCore permits up to 63 path hops. Allowing one route-summary row per
	// segment plus the observation, edge/path projections, packet, and as many as
	// three public events yields fewer than 96 retained rows per input.
	retentionLockedMessagesPerSecond   int64 = 20
	retentionWorstCaseRowsPerMessage   int64 = 96
	retentionMaxPublicEventsPerMessage int64 = 3
)

func retentionPruneCapacityRowsPerSecond() int64 {
	return retentionPruneMaxRowsPerCycle / int64(retentionPruneInterval/time.Second)
}

func retentionPruneAllowed(mqttStatus imqtt.Status, runtimeStatus live.RuntimeStatsSnapshot, storageState string, nowMs int64) (bool, string) {
	primaryPressured := (mqttStatus.QueueCapacity > 0 && mqttStatus.QueueDepth*2 >= mqttStatus.QueueCapacity) || mqttStatus.OldestQueueItemAgeMs > 2_000
	if primaryPressured {
		return false, "primary_ingest_pressure"
	}
	derivedOldestAge := int64(0)
	if runtimeStatus.DerivedOldestAtMs > 0 {
		derivedOldestAge = max(nowMs-runtimeStatus.DerivedOldestAtMs, 0)
	}
	derivedPressured := (runtimeStatus.DerivedQueueCapacity > 0 && runtimeStatus.DerivedQueueDepth*2 >= runtimeStatus.DerivedQueueCapacity) || derivedOldestAge > 2_000
	// Derived projections are intentionally paused under storage pressure. Their
	// growing queue age must not block the cleanup which creates free space.
	if storageState == "warn" || storageState == "critical" {
		return true, ""
	}
	if derivedPressured {
		return false, "derived_ingest_pressure"
	}
	return true, ""
}

func (a *Application) pruneLoop(ctx context.Context) {
	retentionDays := a.effectiveDataRetentionDays()
	if retentionDays < 0 {
		return
	}
	runPrune := func() bool {
		started := time.Now()
		publicEventHours := a.Config.PublicEventRetentionHours
		if publicEventHours <= 0 {
			publicEventHours = 24
		}
		propagationRetentionDays := a.Config.PropagationEventRetentionDays
		if propagationRetentionDays <= 0 {
			propagationRetentionDays = retentionDays
		}
		pruner := a.Store.NewRetentionPruner(store.RetentionCutoffs{
			DataBeforeMs:        started.AddDate(0, 0, -retentionDays).UnixMilli(),
			PublicEventBeforeMs: started.Add(-time.Duration(publicEventHours) * time.Hour).UnixMilli(),
			PropagationBeforeMs: started.AddDate(0, 0, -propagationRetentionDays).UnixMilli(),
		})
		cycleCtx, cancel := context.WithTimeout(ctx, retentionPruneCycleBudget)
		defer cancel()
		var rowsDeleted int64
		steps := 0
		for rowsDeleted < retentionPruneMaxRowsPerCycle {
			now := time.Now()
			mqttStatus := a.MQTT.Status(now)
			runtimeStatus := a.Runtime.Snapshot()
			storageState := a.Store.StorageInfo().PressureState
			allowed, reason := retentionPruneAllowed(mqttStatus, runtimeStatus, storageState, now.UnixMilli())
			if !allowed {
				a.Log.Warn("retention cleanup paused between batches; ingest lag is not healthy",
					"reason", reason,
					"rowsDeleted", rowsDeleted,
					"queueDepth", mqttStatus.QueueDepth, "queueCapacity", mqttStatus.QueueCapacity,
					"queueOldestAgeMs", mqttStatus.OldestQueueItemAgeMs,
					"derivedQueueDepth", runtimeStatus.DerivedQueueDepth, "derivedQueueCapacity", runtimeStatus.DerivedQueueCapacity,
					"storagePressureState", storageState,
				)
				return false
			}
			var step store.RetentionPruneStep
			err := a.coordinateStoreWrite(cycleCtx, writeLaneBackground, func(writeCtx context.Context) error {
				var err error
				step, err = pruner.Step(writeCtx)
				return err
			})
			if err != nil {
				if cycleCtx.Err() != nil {
					a.Log.Warn("retention cleanup reached its bounded time budget", "rowsDeleted", rowsDeleted, "steps", steps)
					return false
				}
				a.Log.Warn("retention cleanup batch failed", "error", err, "rowsDeleted", rowsDeleted, "steps", steps)
				return false
			}
			steps++
			rowsDeleted += step.RowsDeleted
			if step.Done {
				a.Log.Debug("retention cleanup complete", "rowsDeleted", rowsDeleted, "steps", steps, "durationMs", time.Since(started).Milliseconds())
				return true
			}
			// Every step is already a 100-row background-lane transaction. The
			// coordinator rechecks primary/live-core work before admitting the
			// next step, so a fixed sleep only delays cleanup without improving
			// live-lane fairness.
		}
		a.Log.Info("retention cleanup reached its bounded row budget", "rowsDeleted", rowsDeleted, "steps", steps, "durationMs", time.Since(started).Milliseconds())
		return false
	}
	select {
	case <-ctx.Done():
		return
	case <-time.After(retentionPruneInitialDelay):
	}
	nextDelay := time.Duration(0)
	for {
		if nextDelay > 0 {
			timer := time.NewTimer(nextDelay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
		if runPrune() {
			nextDelay = retentionPruneInterval
		} else {
			// A bounded cycle, transient error, or live-lane pressure left work
			// pending. Retry soon; every individual slice still re-enters the
			// background lane and therefore yields to primary/live-core work.
			nextDelay = retentionPruneRetryDelay
		}
	}
}

func (a *Application) effectiveDataRetentionDays() int {
	retentionDays := a.Config.DataRetentionDays
	if retentionDays == 0 {
		return 7
	}
	return retentionDays
}

func (a *Application) maintenanceLoop(ctx context.Context) {
	// Check for a quiet window hourly, reclaim only a small number of pages,
	// and run SQLite's normal optimize pass no more than once per day. The
	// initial 0x10002 optimize pass already runs when the Store opens.
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	lastOptimize := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			mqttStatus := a.MQTT.Status(time.Now())
			runtimeStatus := a.Runtime.Snapshot()
			if mqttStatus.QueueDepth > 0 || mqttStatus.OldestQueueItemAgeMs > 0 || runtimeStatus.DerivedQueueDepth > 0 {
				a.Log.Debug("database maintenance deferred; ingest is not idle")
				continue
			}
			if a.Store.StorageInfo().PressureState == "critical" {
				a.Log.Warn("database maintenance deferred; storage is critical")
				continue
			}
			maintenanceCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			if time.Since(lastOptimize) >= 24*time.Hour {
				if err := a.coordinateStoreWrite(maintenanceCtx, writeLaneBackground, func(writeCtx context.Context) error {
					return a.Store.Optimize(writeCtx, false)
				}); err != nil {
					a.Log.Warn("database optimize failed", "error", err)
					cancel()
					continue
				}
				lastOptimize = time.Now()
			}
			if err := a.coordinateStoreWrite(maintenanceCtx, writeLaneBackground, func(writeCtx context.Context) error {
				return a.Store.IncrementalVacuum(writeCtx, 64)
			}); err != nil {
				a.Log.Warn("database incremental vacuum failed", "error", err)
			} else {
				a.Log.Info("database maintenance complete")
			}
			cancel()
		}
	}
}
