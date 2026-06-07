package app

import (
	"context"
	"encoding/hex"
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
	"meshcore-canada-live-map/backend/internal/resolve"
	"meshcore-canada-live-map/backend/internal/solar"
	"meshcore-canada-live-map/backend/internal/store"

	"meshcore-canada-live-map/backend/internal/api"
)

type Application struct {
	Config      Config
	Log         *slog.Logger
	Store       *store.Store
	Hub         *live.Hub
	PublicHub   *live.Hub
	PublicCache *live.PublicStateCache
	Runtime     *live.RuntimeStats
	MQTT        *imqtt.Client
	Resolver    *resolve.Resolver
	Solar         *solar.Fetcher
	solarSnapshot atomic.Pointer[solar.Conditions]

	cacheRefreshMu sync.Mutex
	packetCount    atomic.Int64
	wg             sync.WaitGroup
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
	for _, node := range yc.ManualNodes {
		if node.PublicKey != "" {
			if err := st.ApplyManualNode(ctx, node.PublicKey, node.Name, node.Latitude, node.Longitude, node.Source); err != nil {
				log.Warn("manual node override failed", "publicKey", redact(node.PublicKey), "error", err)
			}
		}
	}
	hub := live.NewHub(log, cfg.WSClientQueueSize, cfg.PublicBaseURL)
	publicHub := live.NewHub(log, cfg.WSClientQueueSize, cfg.PublicBaseURL)
	publicCache := live.NewPublicStateCache(live.NewPublicIATAFilter(publicIATAs(cfg.PublicRegions, yc)))
	resolver := resolve.New(st, yc.ForwarderRoles)
	app := &Application{Config: cfg, Log: log, Store: st, Hub: hub, PublicHub: publicHub, PublicCache: publicCache, Runtime: live.NewRuntimeStats(), Resolver: resolver, Solar: solar.NewFetcher(log)}
	app.MQTT = imqtt.NewClient(imqtt.ClientConfig{
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
	}, log, app.HandleMQTT)
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
	go func() { defer a.wg.Done(); a.backfillPublicPacketPathsLoop(ctx) }()
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
	return a.Store.Close()
}

func (a *Application) HandleMQTT(ctx context.Context, msg imqtt.NormalizedMessage) {
	if msg.TopicInfo.Subtopic == "internal" {
		return
	}
	if msg.TopicInfo.Subtopic == "status" {
		if err := a.Store.UpsertObserver(ctx, msg); err != nil {
			a.Log.Warn("status upsert failed", "error", err)
		}
		if node, err := a.Store.NodeByPublicKey(ctx, msg.TopicInfo.PublisherPK); err == nil && hasCoords(node) {
			a.broadcastNodeUpdateForIATA(node, msg.TopicInfo.IATA)
		}
		return
	}
	if msg.TopicInfo.Subtopic != "packets" {
		return
	}
	if err := a.Store.IncrementObserverPacket(ctx, msg); err != nil {
		a.Log.Warn("observer packet update failed", "error", err)
	}
	if msg.RawHex == "" {
		a.Log.Debug("packet missing raw hex", "topic", msg.Topic)
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
	summary := meshcore.Summary(parsed, advert)
	decodedMessage := meshcore.DecodePublicMessage(parsed.PayloadType, parsed.Payload, msg.RawJSON, a.Config.MeshcoreChannelSecrets)
	observationID, err := a.Store.UpsertPacketAndObservation(ctx, parsed, msg.HeardAtMs, store.ObservationInsert{Message: msg, Parsed: parsed, Summary: summary, MessageSender: decodedMessage.Sender, MessageText: decodedMessage.Text})
	if err != nil {
		a.Log.Warn("packet/observation upsert failed", "error", err)
		return
	}

	var advertNode *live.Node
	if advert != nil {
		node, err := a.Store.UpsertAdvertNode(ctx, msg.TopicInfo.IATA, *advert, msg.HeardAtMs)
		if err != nil {
			a.Log.Warn("advert node upsert failed", "packetHash", parsed.PacketHash, "error", err)
		} else {
			advertNode = &node
			a.broadcastNodeUpdateForIATA(node, msg.TopicInfo.IATA)
		}
	}

	resolution, err := a.Resolver.Resolve(ctx, msg.TopicInfo.IATA, parsed)
	if err != nil {
		a.Log.Warn("resolver failed", "error", err)
		return
	}
	status, reason := a.edgeDecision(ctx, msg, parsed, resolution, advertNode)
	if status != resolve.StatusHigh {
		if err := a.Store.UpdateObservationResolution(ctx, observationID, status, reason); err != nil {
			a.Log.Warn("observation resolution update failed", "error", err)
		}
	}
	observation, err := a.Store.ObservationByID(ctx, observationID)
	if err == nil {
		observation.MessageSender = decodedMessage.Sender
		observation.MessageText = decodedMessage.Text
		a.Hub.Broadcast("packetObservation", observation)
	}

	edge, ok := a.buildEdgeEvent(ctx, msg, parsed, observationID, resolution, advertNode, decodedMessage)
	publicActivitySent := false
	publicAllowed := a.PublicCache.AllowsIATA(msg.TopicInfo.IATA)
	if !publicAllowed {
		a.PublicCache.RecordExcludedIATA(msg.TopicInfo.IATA)
	}
	if ok {
		stored, err := a.Store.InsertEdgeEvent(ctx, edge, status, reason)
		if err != nil {
			a.Log.Warn("edge insert failed", "error", err)
		} else {
			a.Hub.Broadcast("edgeAnimation", stored)
			if publicAllowed {
				if activity, ok := live.PublicActivityFromEdge(stored); ok {
					a.PublicHub.Broadcast("activity", activity)
					a.PublicCache.ApplyActivity(activity)
					publicActivitySent = true
				}
				if pulse, ok := live.PublicRoutePulseFromEdge(stored); ok {
					a.PublicHub.Broadcast("routePulse", pulse)
					a.PublicCache.ApplyRoutePulse(pulse)
				}
			}
		}
	}
	if !publicActivitySent && err == nil && publicAllowed {
		activity := a.publicActivityFromPacket(ctx, observation, nil)
		a.PublicHub.Broadcast("activity", activity)
		a.PublicCache.ApplyActivity(activity)
	}
}

func (a *Application) broadcastNodeUpdate(node live.Node) {
	a.broadcastNodeUpdateForIATA(node, "")
}

func (a *Application) broadcastNodeUpdateForIATA(node live.Node, iata string) {
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
		a.PublicHub.Broadcast("nodeUpdate", publicNode)
		a.PublicCache.ApplyNode(publicNode)
	}
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

func (a *Application) buildEdgeEvent(ctx context.Context, msg imqtt.NormalizedMessage, parsed meshcore.ParsedPacket, observationID int64, resolution resolve.Result, advertNode *live.Node, decodedMessage meshcore.DecodedPublicMessage) (live.EdgeEvent, bool) {
	if a.Config.RequireRSSIOrSNRForEdge && msg.RSSI == nil && msg.SNR == nil {
		return live.EdgeEvent{}, false
	}
	endpoints, status, _ := a.routeEndpoints(ctx, msg, parsed, resolution, advertNode)
	if status != resolve.StatusHigh {
		return live.EdgeEvent{}, false
	}
	segments := make([]live.EdgeSegment, 0, len(endpoints)-1)
	for i := 0; i+1 < len(endpoints); i++ {
		from := endpoints[i]
		to := endpoints[i+1]
		dist := live.HaversineKM(from.Lat, from.Lng, to.Lat, to.Lng)
		if resolve.ShouldRejectDistance(dist, a.Config.MaxUnverifiedEdgeKM, parsed.PayloadType == meshcore.PayloadTrace, a.Config.AllowLongTraceEdges, false) {
			_ = a.Store.UpdateObservationResolution(ctx, observationID, resolve.StatusDistanceGate, "segment exceeds MAX_UNVERIFIED_EDGE_KM")
			return live.EdgeEvent{}, false
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
	}, true
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
	}
	return out
}

func (a *Application) RefreshPublicStateCache(ctx context.Context) error {
	start := time.Now()
	failed := true
	defer func() {
		a.Runtime.RecordCacheRefresh(time.Since(start), failed)
	}()
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
	}
	if count := a.packetCount.Load(); count > 0 {
		publicStats.Packets = count
	}
	publicState := live.BuildPublicLiveState(filtered, publicStats)
	a.PublicCache.Replace(publicState, excluded)
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
			if _, err := a.Store.InsertSolarSnapshot(ctx, store.SolarSnapshot{
				FetchedAtMs: cond.FetchedAt, KpIndex: cond.KpIndex, SolarFluxSfu: cond.SolarFluxSFU, GeomagActivity: cond.GeomagActivity,
			}); err != nil {
				a.Log.Warn("solar insert failed", "error", err)
			}
			_ = a.Store.TrimSolarSnapshots(ctx, 288)
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

func (a *Application) backfillPublicPacketPathsLoop(ctx context.Context) {
	if !a.Config.PublicPacketPathBackfillEnabled {
		return
	}
	batch := a.Config.PublicPacketPathBackfillBatch
	if batch <= 0 {
		return
	}
	window := time.Duration(a.Config.PublicPacketPathBackfillHours) * time.Hour
	if window <= 0 {
		window = 24 * time.Hour
	}
	delay := 2 * time.Second
	for {
		remaining, err := a.backfillPublicPacketPathsOnce(ctx, window, batch)
		if err != nil {
			a.Log.Warn("public packet path backfill failed", "error", err)
			delay = 30 * time.Second
		} else if !remaining {
			return
		} else {
			delay = 2 * time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func (a *Application) backfillPublicPacketPathsOnce(ctx context.Context, window time.Duration, batch int) (bool, error) {
	now := time.Now()
	start := time.Now()
	backfillCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	result, err := a.Store.BackfillPublicPacketPaths(backfillCtx, now.Add(-window).UnixMilli(), now.UnixMilli(), batch)
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


func (a *Application) pruneLoop(ctx context.Context) {
	retentionDays := a.Config.DataRetentionDays
	if retentionDays < 0 {
		return
	}
	if retentionDays == 0 {
		retentionDays = 30
	}
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			beforeMs := time.Now().AddDate(0, 0, -retentionDays).UnixMilli()
			if err := a.Store.PruneOldData(ctx, beforeMs); err != nil {
				a.Log.Warn("data prune failed", "error", err)
			} else {
				a.Log.Debug("data pruned", "beforeMs", beforeMs)
			}
		}
	}
}

func (a *Application) maintenanceLoop(ctx context.Context) {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := a.Store.VacuumAndAnalyze(ctx); err != nil {
				a.Log.Warn("database maintenance failed", "error", err)
			} else {
				a.Log.Info("database maintenance complete")
			}
		}
	}
}
