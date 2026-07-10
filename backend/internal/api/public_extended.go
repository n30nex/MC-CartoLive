package api

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/store"
)

const publicEventsMaxLimit = 1000

func (s *Server) publicEvents(w http.ResponseWriter, r *http.Request) {
	if !s.Config.PublicEventsEnabled {
		writeError(w, http.StatusNotFound, errors.New("public events disabled"))
		return
	}
	limit := queryInt(r, "limit", 500)
	if limit <= 0 || limit > publicEventsMaxLimit {
		limit = 500
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	now := time.Now().UnixMilli()
	afterSeq := queryInt64(r, "afterSeq", 0)
	oldestSeq, latestSeq, err := s.Store.PublicSeqBounds(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	belowRetainedFloor := oldestSeq > 0 && afterSeq < oldestSeq-1
	if afterSeq <= 0 || belowRetainedFloor || afterSeq > latestSeq {
		writeJSON(w, http.StatusOK, live.PublicEventsResponse{
			ServerTime:    now,
			OldestSeq:     oldestSeq,
			LatestSeq:     latestSeq,
			Events:        []live.PublicEvent{},
			NextCursor:    publicSeqCursor(latestSeq),
			ResetRequired: true,
		})
		return
	}
	var from, to int64
	if r.URL.Query().Has("from") || r.URL.Query().Has("to") {
		from, to = publicSevenDayWindow(r, now)
	}
	events, next, err := s.Store.ListPublicEventsAfter(ctx, store.PublicEventFilter{
		AfterSeq:        afterSeq,
		From:            from,
		To:              to,
		Limit:           limit,
		Region:          firstUpperQuery(r.URL.Query(), "region", "iata"),
		PayloadTypeName: firstUpperQuery(r.URL.Query(), "payload", "payloadType"),
		EventType:       strings.TrimSpace(r.URL.Query().Get("event")),
		MessageOnly:     queryBool(r.URL.Query().Get("messageOnly")),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	events = s.filterPublicEvents(events)
	responseCursor := next
	if responseCursor == 0 {
		responseCursor = afterSeq
		if len(events) > 0 {
			responseCursor = events[len(events)-1].Seq
		}
	}
	writeJSON(w, http.StatusOK, live.PublicEventsResponse{
		ServerTime:    now,
		OldestSeq:     oldestSeq,
		LatestSeq:     latestSeq,
		Events:        events,
		NextCursor:    publicSeqCursor(responseCursor),
		ResetRequired: false,
	})
}

func (s *Server) publicBootstrap(w http.ResponseWriter, r *http.Request) {
	if s.PublicState == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("public state cache is warming"))
		return
	}
	state, ok := s.PublicState()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, errors.New("public state cache is warming"))
		return
	}
	now := time.Now()
	latestSeq := s.latestPublicSeq(r.Context())
	state.Stats.LatestSeq = latestSeq
	activity := state.RecentActivity
	if len(activity) > 40 {
		activity = activity[:40]
	}
	writeJSON(w, http.StatusOK, live.PublicBootstrapResponse{
		ServerTime:     now.UnixMilli(),
		Map:            state.Map,
		Stats:          state.Stats,
		LatestSeq:      latestSeq,
		Health:         s.publicRuntimeHealth(now, state),
		Clusters:       publicMapClusters(state.Nodes),
		RecentActivity: append([]live.PublicActivity{}, activity...),
	})
}

func (s *Server) publicViewport(w http.ResponseWriter, r *http.Request) {
	if !s.Config.PublicViewportEnabled {
		writeError(w, http.StatusNotFound, errors.New("public viewport disabled"))
		return
	}
	bbox, ok := parseBBox(r.URL.Query().Get("bbox"))
	if !ok {
		writeError(w, http.StatusBadRequest, errors.New("bbox must be minLng,minLat,maxLng,maxLat"))
		return
	}
	state, ok := s.PublicState()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, errors.New("public state cache is warming"))
		return
	}
	zoom := queryFloat(r, "zoom", 0)
	nodes := make([]live.PublicNode, 0, len(state.Nodes))
	nodeIDs := map[string]struct{}{}
	for _, node := range state.Nodes {
		if pointInBBox(node.Longitude, node.Latitude, bbox) {
			nodes = append(nodes, node)
			nodeIDs[node.ID] = struct{}{}
		}
	}
	routes := make([]live.PublicRoute, 0, len(state.Routes))
	for _, route := range state.Routes {
		if _, ok := nodeIDs[route.From.NodeID]; ok {
			routes = append(routes, route)
			continue
		}
		if _, ok := nodeIDs[route.To.NodeID]; ok {
			routes = append(routes, route)
			continue
		}
		if pointInBBox(route.From.Lng, route.From.Lat, bbox) || pointInBBox(route.To.Lng, route.To.Lat, bbox) {
			routes = append(routes, route)
		}
	}
	events := []live.PublicEvent{}
	if since := queryInt64(r, "sinceSeq", 0); since > 0 && s.Config.PublicEventsEnabled {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		now := time.Now().UnixMilli()
		items, _, err := s.Store.ListPublicEventsAfter(ctx, store.PublicEventFilter{
			AfterSeq: since,
			From:     now - publicHistoryMaxWindowMs,
			To:       now,
			Limit:    250,
		})
		if err == nil {
			for _, event := range s.filterPublicEvents(items) {
				if publicEventInBBox(event, bbox) {
					events = append(events, event)
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, live.PublicViewportResponse{
		ServerTime: time.Now().UnixMilli(),
		LatestSeq:  s.PublicHub.LatestSeq(),
		Nodes:      nodes,
		Routes:     routes,
		Clusters:   publicMapClusters(nodes),
		Events:     events,
		BBox:       bbox,
		Zoom:       zoom,
		Includes:   publicViewportIncludes(r.URL.Query().Get("include")),
	})
}

func publicMapClusters(nodes []live.PublicNode) []live.PublicMapCluster {
	type aggregate struct {
		cluster live.PublicMapCluster
		latSum  float64
		lngSum  float64
	}
	byRegion := map[string]*aggregate{}
	for _, node := range nodes {
		region := ""
		if len(node.RegionsHeardIn) > 0 {
			region = strings.ToUpper(strings.TrimSpace(node.RegionsHeardIn[0]))
		} else if len(node.IATAsHeardIn) > 0 {
			region = strings.ToUpper(strings.TrimSpace(node.IATAsHeardIn[0]))
		}
		key := region
		if key == "" {
			key = "UNASSIGNED"
		}
		item := byRegion[key]
		if item == nil {
			item = &aggregate{cluster: live.PublicMapCluster{ID: "region-" + strings.ToLower(key), Region: region}}
			byRegion[key] = item
		}
		item.cluster.Count++
		item.cluster.ActivityCount += node.ActivityCount
		if node.LastSeen > item.cluster.LastSeen {
			item.cluster.LastSeen = node.LastSeen
		}
		item.latSum += node.Latitude
		item.lngSum += node.Longitude
	}
	out := make([]live.PublicMapCluster, 0, len(byRegion))
	for _, item := range byRegion {
		item.cluster.Latitude = item.latSum / float64(item.cluster.Count)
		item.cluster.Longitude = item.lngSum / float64(item.cluster.Count)
		out = append(out, item.cluster)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count == out[j].Count {
			return out[i].ID < out[j].ID
		}
		return out[i].Count > out[j].Count
	})
	return out
}

func (s *Server) publicNOC(w http.ResponseWriter, r *http.Request) {
	if !s.Config.PublicNOCEnabled {
		writeError(w, http.StatusNotFound, errors.New("public noc disabled"))
		return
	}
	state, ok := s.PublicState()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, errors.New("public state cache is warming"))
		return
	}
	now := time.Now()
	cacheStatus := live.PublicCacheStatus{}
	if s.PublicCacheStatus != nil {
		cacheStatus = s.PublicCacheStatus(now)
	}
	publicHubStats := s.publicHubStats()
	observers, counts := publicNOCObservers(state.Nodes, now.UnixMilli())
	writeJSON(w, http.StatusOK, live.PublicNOCResponse{
		ServerTime:          now.UnixMilli(),
		LatestSeq:           s.PublicHub.LatestSeq(),
		MQTTConnected:       s.mqttConnected(),
		PublicCacheReady:    cacheStatus.Ready,
		PublicCacheAgeMs:    cacheStatus.CacheAgeMs,
		WSClients:           s.wsClientCount(),
		WSDroppedMessages:   publicHubStats.DroppedMessages,
		Packets:             state.Stats.Packets,
		ActiveNodes:         int64(len(state.Nodes)),
		ActiveRoutes:        int64(len(state.Routes)),
		Observers:           observers,
		ObserverStateCounts: counts,
		ResolutionBuckets:   state.Stats.ResolutionBuckets,
	})
}

func (s *Server) publicCoverage(w http.ResponseWriter, r *http.Request) {
	if !s.Config.PublicCoverageEnabled {
		writeError(w, http.StatusNotFound, errors.New("public coverage disabled"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	cells, err := s.Store.PublicCoverageCells(ctx, store.PublicCoverageQuery{
		Region: firstUpperQuery(r.URL.Query(), "region", "iata"),
		Limit:  queryInt(r, "limit", 1000),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	status := "not_configured"
	if len(cells) > 0 {
		status = "ready"
	}
	writeJSON(w, http.StatusOK, live.PublicCoverageResponse{
		ServerTime:       time.Now().UnixMilli(),
		SourceStatus:     status,
		PrecisionDefault: "coarse",
		Cells:            cells,
		Attribution:      publicCoverageAttribution(cells),
	})
}

func (s *Server) publicLOSProfile(w http.ResponseWriter, r *http.Request) {
	if !s.Config.PublicLOSEnabled {
		writeError(w, http.StatusNotFound, errors.New("public los disabled"))
		return
	}
	aLat, aLng, bLat, bLng, ok := s.losEndpoints(r)
	if !ok {
		writeError(w, http.StatusBadRequest, errors.New("provide aLat,aLng,bLat,bLng or nodeA,nodeB"))
		return
	}
	frequency := queryFloat(r, "frequencyMhz", 910.525)
	heightA := queryFloat(r, "antennaHeightAM", 2)
	heightB := queryFloat(r, "antennaHeightBM", 2)
	distance := live.HaversineKM(aLat, aLng, bLat, bLng)
	points := losProfilePoints(aLat, aLng, bLat, bLng, distance, 48)
	writeJSON(w, http.StatusOK, live.PublicLOSProfileResponse{
		ServerTime:      time.Now().UnixMilli(),
		Source:          "canada-cdem",
		SourceStatus:    "dataset_workflow_required",
		DistanceKm:      distance,
		BearingDeg:      bearingDeg(aLat, aLng, bLat, bLng),
		FrequencyMHz:    frequency,
		AntennaHeightAM: heightA,
		AntennaHeightBM: heightB,
		Points:          points,
		Notes:           []string{"Canada CDEM import workflow is documented for 2.9.5; this public response remains safe when elevation samples are unavailable."},
	})
}

func (s *Server) publicSchema(w http.ResponseWriter, r *http.Request) {
	if !s.Config.PublicSchemaEnabled {
		writeError(w, http.StatusNotFound, errors.New("public schema disabled"))
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, publicOpenAPISchema(s.Config.AppVersion))
}

func (s *Server) publicSensorSummary(w http.ResponseWriter, r *http.Request) {
	if !s.Config.PublicIntegrationsEnabled {
		writeError(w, http.StatusNotFound, errors.New("public integrations disabled"))
		return
	}
	state, ok := s.PublicState()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, errors.New("public state cache is warming"))
		return
	}
	now := time.Now()
	cacheStatus := live.PublicCacheStatus{}
	if s.PublicCacheStatus != nil {
		cacheStatus = s.PublicCacheStatus(now)
	}
	_, counts := publicNOCObservers(state.Nodes, now.UnixMilli())
	writeJSON(w, http.StatusOK, live.PublicSensorSummaryResponse{
		ServerTime:       now.UnixMilli(),
		MQTTConnected:    s.mqttConnected(),
		Packets:          state.Stats.Packets,
		ActiveNodes:      int64(len(state.Nodes)),
		ActiveRoutes:     int64(len(state.Routes)),
		WSClients:        s.wsClientCount(),
		ObserverOnline:   counts["online"],
		ObserverStale:    counts["stale"],
		ObserverOffline:  counts["offline"],
		TopRegion:        topPublicRegion(state.Nodes),
		PublicCacheAgeMs: cacheStatus.CacheAgeMs,
		LatestSeq:        s.PublicHub.LatestSeq(),
	})
}

func (s *Server) filterPublicEvents(events []live.PublicEvent) []live.PublicEvent {
	if s.PublicAllowsIATA == nil {
		return events
	}
	out := events[:0]
	for _, event := range events {
		region := strings.ToUpper(strings.TrimSpace(firstNonEmpty(event.Region, event.IATA)))
		if region == "" || s.PublicAllowsIATA(region) {
			out = append(out, event)
		}
	}
	return out
}

func (s *Server) latestPublicSeq(ctx context.Context) int64 {
	latestSeq := s.PublicHub.LatestSeq()
	if s.Store != nil {
		if seq, err := s.Store.LatestPublicSeq(ctx); err == nil && seq > latestSeq {
			latestSeq = seq
		}
	}
	return latestSeq
}

func publicSeqCursor(seq int64) string {
	if seq <= 0 {
		return ""
	}
	return strconv.FormatInt(seq, 10)
}

func parseBBox(raw string) ([]float64, bool) {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\t' || r == '\n' || r == '\r'
	})
	if len(fields) != 4 {
		return nil, false
	}
	out := make([]float64, 4)
	for i, field := range fields {
		value, err := strconv.ParseFloat(strings.TrimSpace(field), 64)
		if err != nil || math.IsInf(value, 0) || math.IsNaN(value) {
			return nil, false
		}
		out[i] = value
	}
	if out[0] >= out[2] || out[1] >= out[3] || out[1] < -90 || out[3] > 90 || out[0] < -180 || out[2] > 180 {
		return nil, false
	}
	return out, true
}

func pointInBBox(lng, lat float64, bbox []float64) bool {
	return len(bbox) == 4 && lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

func publicEventInBBox(event live.PublicEvent, bbox []float64) bool {
	if len(bbox) != 4 {
		return true
	}
	var raw json.RawMessage
	switch data := event.Data.(type) {
	case json.RawMessage:
		raw = data
	case []byte:
		raw = data
	default:
		encoded, err := json.Marshal(data)
		if err != nil {
			return false
		}
		raw = encoded
	}
	var candidate struct {
		Latitude         float64 `json:"latitude"`
		Longitude        float64 `json:"longitude"`
		ObserverLocation *struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		} `json:"observerLocation"`
		MessageAnchor *struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		} `json:"messageAnchor"`
		Segments []struct {
			From struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"from"`
			To struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"to"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(raw, &candidate); err != nil {
		return false
	}
	if pointInBBox(candidate.Longitude, candidate.Latitude, bbox) {
		return true
	}
	if candidate.ObserverLocation != nil && pointInBBox(candidate.ObserverLocation.Lng, candidate.ObserverLocation.Lat, bbox) {
		return true
	}
	if candidate.MessageAnchor != nil && pointInBBox(candidate.MessageAnchor.Lng, candidate.MessageAnchor.Lat, bbox) {
		return true
	}
	for _, segment := range candidate.Segments {
		if pointInBBox(segment.From.Lng, segment.From.Lat, bbox) || pointInBBox(segment.To.Lng, segment.To.Lat, bbox) {
			return true
		}
	}
	return false
}

func publicViewportIncludes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{"nodes", "routes", "events"}
	}
	fields := strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' || r == ' ' })
	out := []string{}
	for _, field := range fields {
		if field = strings.TrimSpace(field); field != "" {
			out = append(out, field)
		}
	}
	return out
}

func publicNOCObservers(nodes []live.PublicNode, now int64) ([]live.PublicNOCObserver, map[string]int) {
	out := []live.PublicNOCObserver{}
	counts := map[string]int{"online": 0, "stale": 0, "offline": 0}
	for _, node := range nodes {
		if !node.IsObserver {
			continue
		}
		state := "offline"
		age := now - node.LastSeen
		if age < 0 {
			age = 0
		}
		switch {
		case age <= int64(10*time.Minute/time.Millisecond):
			state = "online"
		case age <= int64(2*time.Hour/time.Millisecond):
			state = "stale"
		}
		counts[state]++
		region := ""
		if len(node.RegionsHeardIn) > 0 {
			region = node.RegionsHeardIn[0]
		} else if len(node.IATAsHeardIn) > 0 {
			region = node.IATAsHeardIn[0]
		}
		out = append(out, live.PublicNOCObserver{
			ID:            node.ID,
			Label:         node.Label,
			Region:        region,
			State:         state,
			LastSeen:      node.LastSeen,
			LastSeenAgeMs: age,
			PacketsTotal:  node.ActivityCount,
			ActivityCount: node.ActivityCount,
		})
	}
	return out, counts
}

func publicCoverageAttribution(cells []live.PublicCoverageCell) string {
	for _, cell := range cells {
		if strings.TrimSpace(cell.Attribution) != "" {
			return cell.Attribution
		}
	}
	return ""
}

func (s *Server) losEndpoints(r *http.Request) (float64, float64, float64, float64, bool) {
	aLat, aLatOK := queryFloatOK(r, "aLat")
	aLng, aLngOK := queryFloatOK(r, "aLng")
	bLat, bLatOK := queryFloatOK(r, "bLat")
	bLng, bLngOK := queryFloatOK(r, "bLng")
	if aLatOK && aLngOK && bLatOK && bLngOK && live.ValidPublicCoords(aLat, aLng) && live.ValidPublicCoords(bLat, bLng) {
		return aLat, aLng, bLat, bLng, true
	}
	nodeA := strings.TrimSpace(r.URL.Query().Get("nodeA"))
	nodeB := strings.TrimSpace(r.URL.Query().Get("nodeB"))
	if nodeA == "" || nodeB == "" || s.PublicState == nil {
		return 0, 0, 0, 0, false
	}
	state, ok := s.PublicState()
	if !ok {
		return 0, 0, 0, 0, false
	}
	var foundA, foundB *live.PublicNode
	for i := range state.Nodes {
		if state.Nodes[i].ID == nodeA {
			foundA = &state.Nodes[i]
		}
		if state.Nodes[i].ID == nodeB {
			foundB = &state.Nodes[i]
		}
	}
	if foundA == nil || foundB == nil {
		return 0, 0, 0, 0, false
	}
	return foundA.Latitude, foundA.Longitude, foundB.Latitude, foundB.Longitude, true
}

func losProfilePoints(aLat, aLng, bLat, bLng, distanceKm float64, count int) []live.PublicLOSPoint {
	if count < 2 {
		count = 2
	}
	points := make([]live.PublicLOSPoint, 0, count)
	for i := 0; i < count; i++ {
		fraction := float64(i) / float64(count-1)
		points = append(points, live.PublicLOSPoint{
			Fraction:   fraction,
			Lat:        aLat + (bLat-aLat)*fraction,
			Lng:        aLng + (bLng-aLng)*fraction,
			DistanceKm: distanceKm * fraction,
		})
	}
	return points
}

func bearingDeg(aLat, aLng, bLat, bLng float64) float64 {
	lat1 := aLat * math.Pi / 180
	lat2 := bLat * math.Pi / 180
	dLng := (bLng - aLng) * math.Pi / 180
	y := math.Sin(dLng) * math.Cos(lat2)
	x := math.Cos(lat1)*math.Sin(lat2) - math.Sin(lat1)*math.Cos(lat2)*math.Cos(dLng)
	bearing := math.Atan2(y, x) * 180 / math.Pi
	return math.Mod(bearing+360, 360)
}

func queryFloat(r *http.Request, key string, fallback float64) float64 {
	if value, ok := queryFloatOK(r, key); ok {
		return value
	}
	return fallback
}

func queryFloatOK(r *http.Request, key string) (float64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsInf(value, 0) || math.IsNaN(value) {
		return 0, false
	}
	return value, true
}

func topPublicRegion(nodes []live.PublicNode) string {
	counts := map[string]int{}
	for _, node := range nodes {
		for _, region := range node.RegionsHeardIn {
			if region = strings.ToUpper(strings.TrimSpace(region)); region != "" {
				counts[region]++
			}
		}
	}
	top := ""
	topCount := 0
	for region, count := range counts {
		if count > topCount {
			top = region
			topCount = count
		}
	}
	return top
}

func publicOpenAPISchema(version string) map[string]any {
	return map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":   "MC-CartoLive Public API",
			"version": version,
		},
		"paths": map[string]any{
			"/healthz":                                   map[string]any{"get": publicSchemaOperation("Public-safe process health")},
			"/readyz":                                    map[string]any{"get": publicSchemaOperation("Public-safe serving readiness")},
			"/api/v1/public/state":                       map[string]any{"get": publicSchemaOperation("Public live state")},
			"/api/v1/public/bootstrap":                   map[string]any{"get": publicSchemaOperationRef("Compact public map bootstrap", "PublicBootstrapResponse")},
			"/api/v1/public/history":                     map[string]any{"get": publicSchemaOperation("Bounded public history")},
			"/api/v1/public/history/summary":             map[string]any{"get": publicSchemaOperation("Public history summary")},
			"/api/v1/public/events":                      map[string]any{"get": publicSchemaOperationRef("Public event resume", "PublicEventsResponse")},
			"/api/v1/public/viewport":                    map[string]any{"get": publicSchemaOperationRef("Viewport-scoped public map data", "PublicViewportResponse")},
			"/api/v1/public/noc":                         map[string]any{"get": publicSchemaOperation("Public-safe NOC dashboard")},
			"/api/v1/public/packets":                     map[string]any{"get": publicSchemaOperation("Public packet paths")},
			"/api/v1/public/chat":                        map[string]any{"get": publicSchemaOperation("Public chat messages")},
			"/api/v1/public/solar":                       map[string]any{"get": publicSchemaOperation("Public solar conditions")},
			"/api/v1/public/coverage":                    map[string]any{"get": publicSchemaOperation("Coarse public coverage cells")},
			"/api/v1/public/los/profile":                 map[string]any{"get": publicSchemaOperation("Public LOS profile")},
			"/api/v1/public/schema":                      map[string]any{"get": publicSchemaOperation("Static checked public API schema")},
			"/api/v1/public/propagation":                 map[string]any{"get": publicSchemaOperation("Public propagation events")},
			"/api/v1/public/integrations/home-assistant": map[string]any{"get": publicSchemaOperation("Public-safe sensor summary")},
			"/ws/public": map[string]any{
				"get": publicSchemaOperation("Public WebSocket upgrade"),
				"x-websocket": map[string]any{
					"clientMessages": []string{"hello", "pong", "subscribe"},
					"serverMessages": []string{"hello", "event", "ping", "reset"},
				},
			},
		},
		"components":                map[string]any{"schemas": public320Schemas()},
		"x-public-forbidden-fields": []string{"publicKey", "observerPublicKey", "packetHash", "rawHex", "rawJson", "payloadHex", "pathHex", "resolver", "debug", "secret", "token", "password"},
	}
}

func public320Schemas() map[string]any {
	integer := func() map[string]any { return map[string]any{"type": "integer", "format": "int64"} }
	stringType := func() map[string]any { return map[string]any{"type": "string"} }
	return map[string]any{
		"PublicMapCluster": map[string]any{
			"type":     "object",
			"required": []string{"id", "latitude", "longitude", "count"},
			"properties": map[string]any{
				"id": stringType(), "latitude": map[string]any{"type": "number"}, "longitude": map[string]any{"type": "number"},
				"count": map[string]any{"type": "integer"}, "activityCount": integer(), "lastSeen": integer(), "region": stringType(),
			},
		},
		"PublicRuntimeHealth": map[string]any{
			"type":     "object",
			"required": []string{"mqttSessionReady", "datasetState", "datasetStartedAt", "storagePressureState"},
			"properties": map[string]any{
				"mqttSessionReady":     map[string]any{"type": "boolean"},
				"datasetState":         map[string]any{"type": "string", "enum": []string{"fresh_start", "warming", "live"}},
				"datasetStartedAt":     integer(),
				"storagePressureState": map[string]any{"type": "string", "enum": []string{"ok", "warn", "critical"}},
			},
		},
		"PublicEventsResponse": map[string]any{
			"type":     "object",
			"required": []string{"serverTime", "oldestSeq", "latestSeq", "events", "resetRequired"},
			"properties": map[string]any{
				"serverTime": integer(), "oldestSeq": integer(), "latestSeq": integer(),
				"events":     map[string]any{"type": "array", "items": map[string]any{"type": "object"}},
				"nextCursor": stringType(), "resetRequired": map[string]any{"type": "boolean"},
			},
		},
		"PublicBootstrapResponse": map[string]any{
			"type":     "object",
			"required": []string{"serverTime", "map", "stats", "latestSeq", "health", "clusters", "recentActivity"},
			"properties": map[string]any{
				"serverTime": integer(), "map": map[string]any{"type": "object"}, "stats": map[string]any{"type": "object"}, "latestSeq": integer(),
				"health":         map[string]any{"$ref": "#/components/schemas/PublicRuntimeHealth"},
				"clusters":       map[string]any{"type": "array", "items": map[string]any{"$ref": "#/components/schemas/PublicMapCluster"}},
				"recentActivity": map[string]any{"type": "array", "items": map[string]any{"type": "object"}},
			},
		},
		"PublicViewportResponse": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"serverTime": integer(), "latestSeq": integer(),
				"nodes":    map[string]any{"type": "array", "items": map[string]any{"type": "object"}},
				"routes":   map[string]any{"type": "array", "items": map[string]any{"type": "object"}},
				"events":   map[string]any{"type": "array", "items": map[string]any{"type": "object"}},
				"clusters": map[string]any{"type": "array", "items": map[string]any{"$ref": "#/components/schemas/PublicMapCluster"}},
			},
		},
	}
}

func publicSchemaOperationRef(summary, schema string) map[string]any {
	operation := publicSchemaOperation(summary)
	responses := operation["responses"].(map[string]any)
	ok := responses["200"].(map[string]any)
	content := ok["content"].(map[string]any)
	content["application/json"] = map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/" + schema}}
	return operation
}

func publicSchemaOperation(summary string) map[string]any {
	return map[string]any{
		"summary": summary,
		"responses": map[string]any{
			"200": map[string]any{
				"description": "Public-safe JSON response",
				"content": map[string]any{
					"application/json": map[string]any{"schema": map[string]any{"type": "object"}},
				},
			},
		},
	}
}

func firstNonEmpty(items ...string) string {
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			return item
		}
	}
	return ""
}
