package app

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"math"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/resolve"
	"meshcore-canada-live-map/backend/internal/store"
)

type Application struct {
	Config      Config
	Log         *slog.Logger
	Store       *store.Store
	Hub         *live.Hub
	PublicHub   *live.Hub
	PublicCache *live.PublicStateCache
	MQTT        *imqtt.Client
	Resolver    *resolve.Resolver
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
	st, err := store.Open(ctx, cfg.DBPath)
	if err != nil {
		return nil, err
	}
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
	publicCache := live.NewPublicStateCache(live.NewPublicIATAFilter(publicIATAs(cfg.PublicIATAs, yc)))
	resolver := resolve.New(st, yc.ForwarderRoles)
	app := &Application{Config: cfg, Log: log, Store: st, Hub: hub, PublicHub: publicHub, PublicCache: publicCache, Resolver: resolver}
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
	)
	if err := a.RefreshPublicStateCache(ctx); err != nil {
		a.Log.Warn("public state cache warm failed", "error", err)
	}
	go a.refreshPublicStateCacheLoop(ctx)
	if err := a.MQTT.Start(ctx); err != nil {
		a.Log.Error("mqtt start failed", "error", err)
	}
	go a.logCounters(ctx)
	if a.Config.FixtureReplayPath != "" {
		go a.replayFixture(ctx, a.Config.FixtureReplayPath)
	}
	return a.StartHTTP(ctx)
}

func (a *Application) Close() error {
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
	if err := a.Store.UpsertPacket(ctx, parsed, msg.HeardAtMs); err != nil {
		a.Log.Warn("packet upsert failed", "error", err)
		return
	}
	observationID, err := a.Store.InsertObservation(ctx, store.ObservationInsert{Message: msg, Parsed: parsed, Summary: summary, MessageSender: decodedMessage.Sender, MessageText: decodedMessage.Text})
	if err != nil {
		a.Log.Warn("observation insert failed", "error", err)
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
	if err := a.Store.UpdateObservationResolution(ctx, observationID, status, reason); err != nil {
		a.Log.Warn("observation resolution update failed", "error", err)
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
		stored, err := a.Store.InsertEdgeEvent(ctx, edge)
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
	endpoints, status, reason := a.routeEndpoints(ctx, msg, parsed, resolution, advertNode)
	if status != resolve.StatusHigh {
		_ = a.Store.UpdateObservationResolution(ctx, observationID, status, reason)
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
	observers, err := a.Store.Observers(ctx)
	if err != nil {
		return live.EdgeEndpoint{}, false
	}
	for _, observer := range observers {
		if observer.PublicKey == msg.TopicInfo.PublisherPK && observer.IATA == msg.TopicInfo.IATA && observer.Latitude != nil && observer.Longitude != nil && validMapCoords(*observer.Latitude, *observer.Longitude) {
			return live.EdgeEndpoint{
				NodeID:    observer.PublicKey,
				Name:      displayName(observer.Name, observer.PublicKey),
				Lat:       *observer.Latitude,
				Lng:       *observer.Longitude,
				PathHash3: pathHash3(observer.PublicKey),
			}, true
		}
	}
	return live.EdgeEndpoint{}, false
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
			stats, err := a.Store.Stats(ctx)
			if err != nil {
				a.Log.Warn("stats failed", "error", err)
				continue
			}
			a.Log.Info("runtime counters",
				"mqtt_connected", a.MQTT.Connected(),
				"mqtt_messages_total", a.MQTT.TotalMessages(),
				"mqtt_messages_dropped", a.MQTT.DroppedMessages(),
				"packets_total", stats.Packets,
				"observations_total", stats.Observations,
				"nodes_positioned", stats.NodesWithPosition,
				"observations_ambiguous", stats.Ambiguous,
				"observations_unresolved", stats.Unresolved,
				"edge_events_emitted", stats.EdgeEvents,
				"ws_clients", a.Hub.ClientCount(),
			)
		}
	}
}

func (a *Application) RefreshPublicStateCache(ctx context.Context) error {
	state, err := a.Store.LiveState(ctx, a.Config.RecentPacketLimit, a.Config.RecentEdgeEventLimit)
	if err != nil {
		return err
	}
	filtered, excluded := a.PublicCache.FilterState(state)
	stats, err := a.Store.Stats(ctx)
	if err != nil {
		return err
	}
	publicState := live.BuildPublicLiveState(filtered, live.PublicStats{
		Packets:       stats.Packets,
		MQTTConnected: a.MQTT.Connected(),
		MQTTMessages:  a.MQTT.TotalMessages(),
		WSClients:     a.Hub.ClientCount() + a.PublicHub.ClientCount(),
		ServerTime:    time.Now().UnixMilli(),
	})
	a.PublicCache.Replace(publicState, excluded)
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
			if err := a.RefreshPublicStateCache(ctx); err != nil {
				a.Log.Warn("public state cache refresh failed", "error", err)
			}
		}
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
	return !math.IsNaN(lat) &&
		!math.IsNaN(lng) &&
		!math.IsInf(lat, 0) &&
		!math.IsInf(lng, 0) &&
		lat != 0 &&
		lng != 0 &&
		lat >= 41 &&
		lat <= 84 &&
		lng >= -142 &&
		lng <= -52
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

func compactJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
