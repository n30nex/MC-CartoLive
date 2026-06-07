package live

import (
	"fmt"
	"hash/fnv"
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"meshcore-canada-live-map/backend/internal/resolve"
)

var (
	publicSecretPairRE = regexp.MustCompile(`(?i)\b(?:broker|resolver|debug|secret|token|key|hash|payload|path)[\w.-]*\s*[:=]\s*\S+`)
	publicPathHexRE    = regexp.MustCompile(`(?i)\b(?:[a-f0-9]{2}[:\-\s]){5,}[a-f0-9]{2}\b`)
	publicLongHexRE    = regexp.MustCompile(`(?i)\b(?:0x)?[a-f0-9]{16,}\b`)
	publicBase64RE     = regexp.MustCompile(`\b[A-Za-z0-9+/]{40,}={0,2}\b`)
)

type PublicNode struct {
	ID             string   `json:"id"`
	Label          string   `json:"label"`
	Role           string   `json:"role"`
	IsObserver     bool     `json:"isObserver,omitempty"`
	Latitude       float64  `json:"latitude"`
	Longitude      float64  `json:"longitude"`
	LastSeen       int64    `json:"lastSeen"`
	FirstSeen      int64    `json:"firstSeen"`
	IATAsHeardIn   []string `json:"iatasHeardIn"`
	RegionsHeardIn []string `json:"regionsHeardIn,omitempty"`
	ActivityCount  int64    `json:"activityCount"`
}

type PublicRouteEndpoint struct {
	NodeID    string  `json:"nodeId"`
	Label     string  `json:"label"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	PathHash3 string  `json:"pathHash3,omitempty"`
}

type PublicRouteSegment struct {
	RouteID    string              `json:"routeId"`
	From       PublicRouteEndpoint `json:"from"`
	To         PublicRouteEndpoint `json:"to"`
	DistanceKM float64             `json:"distanceKm"`
}

type PublicRoute struct {
	ID               string              `json:"id"`
	From             PublicRouteEndpoint `json:"from"`
	To               PublicRouteEndpoint `json:"to"`
	DistanceKM       float64             `json:"distanceKm"`
	PacketCount      int                 `json:"packetCount"`
	LastHeard        int64               `json:"lastHeard"`
	FrequencyBucket  int                 `json:"frequencyBucket"`
	PayloadTypeNames []string            `json:"payloadTypeNames"`
}

type PublicActivity struct {
	ID               string                  `json:"id"`
	Kind             string                  `json:"kind"`
	PayloadTypeName  string                  `json:"payloadTypeName"`
	RouteTypeName    string                  `json:"routeTypeName,omitempty"`
	IATA             string                  `json:"iata,omitempty"`
	Region           string                  `json:"region,omitempty"`
	HeardAt          int64                   `json:"heardAt"`
	HopCount         int                     `json:"hopCount"`
	HasRoute         bool                    `json:"hasRoute"`
	AnimationState   string                  `json:"animationState"`
	ResolutionBucket string                  `json:"resolutionBucket"`
	ObserverLocation *PublicObserverLocation `json:"observerLocation,omitempty"`
	RouteIDs         []string                `json:"routeIds,omitempty"`
	EndpointLabels   []string                `json:"endpointLabels,omitempty"`
	MessageSender    string                  `json:"messageSender,omitempty"`
	MessageText      string                  `json:"messageText,omitempty"`
	MessageAnchor    *PublicMessageAnchor    `json:"messageAnchor,omitempty"`
}

type PublicObserverLocation struct {
	Label  string  `json:"label"`
	IATA   string  `json:"iata,omitempty"`
	Region string  `json:"region,omitempty"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
}

type PublicMessageAnchor struct {
	Kind   string  `json:"kind"`
	NodeID string  `json:"nodeId,omitempty"`
	Label  string  `json:"label"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
}

type PublicRoutePulse struct {
	ID              string               `json:"id"`
	IATA            string               `json:"iata,omitempty"`
	Region          string               `json:"region,omitempty"`
	PayloadTypeName string               `json:"payloadTypeName"`
	MessageSender   string               `json:"messageSender,omitempty"`
	MessageText     string               `json:"messageText,omitempty"`
	MessageAnchor   *PublicMessageAnchor `json:"messageAnchor,omitempty"`
	HeardAt         int64                `json:"heardAt"`
	Segments        []PublicRouteSegment `json:"segments"`
}

type PublicPacketPath struct {
	ID              string               `json:"id"`
	At              int64                `json:"at"`
	IATA            string               `json:"iata,omitempty"`
	Region          string               `json:"region,omitempty"`
	PayloadTypeName string               `json:"payloadTypeName"`
	MessageSender   string               `json:"messageSender,omitempty"`
	MessageText     string               `json:"messageText,omitempty"`
	HopCount        int                  `json:"hopCount"`
	SegmentCount    int                  `json:"segmentCount"`
	DistanceKM      float64              `json:"distanceKm"`
	RouteIDs        []string             `json:"routeIds"`
	EndpointLabels  []string             `json:"endpointLabels"`
	Segments        []PublicRouteSegment `json:"segments"`
}

type PublicChatMessage struct {
	ID              string               `json:"id"`
	At              int64                `json:"at"`
	IATA            string               `json:"iata,omitempty"`
	Region          string               `json:"region,omitempty"`
	Sender          string               `json:"sender,omitempty"`
	Text            string               `json:"text"`
	ChannelLabel    string               `json:"channelLabel"`
	PayloadTypeName string               `json:"payloadTypeName"`
	Source          string               `json:"source"`
	Anchor          *PublicMessageAnchor `json:"anchor,omitempty"`
	RouteIDs        []string             `json:"routeIds,omitempty"`
	EndpointLabels  []string             `json:"endpointLabels,omitempty"`
}

type PublicChatResponse struct {
	ServerTime int64               `json:"serverTime"`
	Messages   []PublicChatMessage `json:"messages"`
	NextCursor string              `json:"nextCursor,omitempty"`
	Window     PublicHistoryWindow `json:"window"`
}

type PublicPacketsResponse struct {
	ServerTime int64               `json:"serverTime"`
	Packets    []PublicPacketPath  `json:"packets"`
	NextCursor string              `json:"nextCursor,omitempty"`
	Window     PublicHistoryWindow `json:"window"`
	Scan       PublicPacketScan    `json:"scan,omitempty"`
}

type PublicPacketScan struct {
	EventsScanned int  `json:"eventsScanned"`
	ScanLimit     int  `json:"scanLimit"`
	Filtered      bool `json:"filtered,omitempty"`
	Partial       bool `json:"partial,omitempty"`
}

type PublicStats struct {
	Packets           int64                       `json:"packets"`
	ActiveNodes       int64                       `json:"activeNodes"`
	ActiveRoutes      int64                       `json:"activeRoutes"`
	MQTTConnected     bool                        `json:"mqttConnected"`
	MQTTMessages      int64                       `json:"mqttMessages"`
	WSClients         int                         `json:"wsClients"`
	ServerTime        int64                       `json:"serverTime"`
	ResolutionBuckets map[string]map[string]int64 `json:"resolutionBuckets,omitempty"`
	ExcludedIATAs     map[string]int64            `json:"excludedIatas,omitempty"`
	ExcludedRegions   map[string]int64            `json:"excludedRegions,omitempty"`
}

type PublicLiveState struct {
	ServerTime     int64              `json:"serverTime"`
	Map            PublicMapConfig    `json:"map,omitempty"`
	Stats          PublicStats        `json:"stats"`
	Nodes          []PublicNode       `json:"nodes"`
	Routes         []PublicRoute      `json:"routes"`
	RecentPulses   []PublicRoutePulse `json:"recentPulses,omitempty"`
	RecentActivity []PublicActivity   `json:"recentActivity"`
	UpdatedAt      int64              `json:"updatedAt"`
}

type PublicMapConfig struct {
	RegionPreset  string           `json:"regionPreset,omitempty"`
	DefaultRegion string           `json:"defaultRegion,omitempty"`
	DefaultCenter []float64        `json:"defaultCenter,omitempty"`
	DefaultZoom   float64          `json:"defaultZoom,omitempty"`
	Bounds        CoordinateBounds `json:"bounds,omitempty"`
}

type PublicHistoryEvent struct {
	Type string `json:"type"`
	At   int64  `json:"at"`
	Data any    `json:"data"`
}

type PublicHistoryWindow struct {
	From  int64 `json:"from"`
	To    int64 `json:"to"`
	Count int   `json:"count"`
}

type PublicHistoryResponse struct {
	ServerTime int64                `json:"serverTime"`
	Events     []PublicHistoryEvent `json:"events"`
	NextCursor string               `json:"nextCursor,omitempty"`
	Window     PublicHistoryWindow  `json:"window"`
}

type PublicHistorySummaryBucket struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
	Count int64 `json:"count"`
}

type PublicHistorySummaryResponse struct {
	ServerTime int64                        `json:"serverTime"`
	From       int64                        `json:"from"`
	To         int64                        `json:"to"`
	BucketMs   int64                        `json:"bucketMs"`
	Buckets    []PublicHistorySummaryBucket `json:"buckets"`
}

func BuildPublicLiveState(state State, stats PublicStats) PublicLiveState {
	pathHash3ByNodeID := BuildPublicPathHash3Index(state.Nodes, state.Observers)
	routes, routesByPacket := BuildPublicRoutes(state.RecentEdgeEvents, pathHash3ByNodeID)
	recentPulses := BuildPublicRoutePulses(state.RecentEdgeEvents, 80, state.ServerTime-20_000, pathHash3ByNodeID)
	observerLocations := BuildPublicObserverLocationIndex(state.Nodes, state.Observers)
	activity := make([]PublicActivity, 0, len(state.RecentPackets))
	for _, packet := range state.RecentPackets {
		activity = append(activity, PublicActivityFromPacket(packet, routesByPacket[packet.PacketHash], observerLocations.locationForPacket(packet)))
	}
	nodes := make([]PublicNode, 0, len(state.Nodes)+len(state.Observers))
	observerPublicKeys := map[string]struct{}{}
	for _, observer := range state.Observers {
		observerPublicKeys[strings.ToUpper(observer.PublicKey)] = struct{}{}
	}
	renderedPublicKeys := map[string]struct{}{}
	for _, node := range state.Nodes {
		if item, ok := PublicNodeFromNode(node); ok {
			_, item.IsObserver = observerPublicKeys[strings.ToUpper(node.PublicKey)]
			nodes = append(nodes, item)
			renderedPublicKeys[strings.ToUpper(node.PublicKey)] = struct{}{}
		}
	}
	for _, observer := range state.Observers {
		if _, exists := renderedPublicKeys[strings.ToUpper(observer.PublicKey)]; exists {
			continue
		}
		if item, ok := PublicNodeFromObserver(observer); ok {
			nodes = append(nodes, item)
		}
	}
	stats.ActiveNodes = int64(len(nodes))
	stats.ActiveRoutes = int64(len(routes))
	stats.ResolutionBuckets = PublicResolutionCounters(activity)
	return PublicLiveState{
		ServerTime:     state.ServerTime,
		Stats:          stats,
		Nodes:          nodes,
		Routes:         routes,
		RecentPulses:   recentPulses,
		RecentActivity: activity,
	}
}

func PublicNodeFromNode(node Node) (PublicNode, bool) {
	if !PublicNodeMapInclusion(node, NewPublicIATAFilter(nil)).Mappable {
		return PublicNode{}, false
	}
	return PublicNode{
		ID:             publicNodeID(node.NodeID),
		Label:          displayLabel(node.Name, node.Role),
		Role:           normalizeRole(node.Role),
		Latitude:       *node.Latitude,
		Longitude:      *node.Longitude,
		LastSeen:       node.LastSeen,
		FirstSeen:      node.FirstSeen,
		IATAsHeardIn:   append([]string{}, node.IATAsHeardIn...),
		RegionsHeardIn: append([]string{}, node.IATAsHeardIn...),
		ActivityCount:  node.ObservationCount,
	}, true
}

func PublicNodeFromObserver(observer Observer) (PublicNode, bool) {
	if !PublicObserverFallbackInclusion(observer, NewPublicIATAFilter(nil)).Mappable {
		return PublicNode{}, false
	}
	iata := strings.ToUpper(strings.TrimSpace(observer.IATA))
	iatas := []string{}
	if iata != "" {
		iatas = append(iatas, iata)
	}
	return PublicNode{
		ID:             publicObserverNodeID(observer),
		Label:          publicObserverLabel(observer.Name, observer.IATA),
		Role:           "unknown",
		IsObserver:     true,
		Latitude:       *observer.Latitude,
		Longitude:      *observer.Longitude,
		LastSeen:       observer.LastSeen,
		FirstSeen:      observer.LastSeen,
		IATAsHeardIn:   iatas,
		RegionsHeardIn: append([]string{}, iatas...),
		ActivityCount:  observer.PacketCount,
	}, true
}

func BuildPublicPathHash3Index(nodes []Node, observers []Observer) map[string]string {
	out := map[string]string{}
	for _, node := range nodes {
		hash := pathHash3FromPublicKey(node.PublicKey)
		if hash == "" {
			continue
		}
		out[node.NodeID] = hash
		out[publicNodeID(node.PublicKey)] = hash
	}
	for _, observer := range observers {
		hash := pathHash3FromPublicKey(observer.PublicKey)
		if hash == "" {
			continue
		}
		out[observer.PublicKey] = hash
		out[publicNodeID(observer.PublicKey)] = hash
	}
	return out
}

func PublicActivityFromPacket(packet PacketObservation, routeIDs []string, observerLocation *PublicObserverLocation) PublicActivity {
	ids := uniqueSorted(routeIDs)
	hasRoute := len(ids) > 0
	messageText := publicMessageText(packet.MessageText)
	messageAnchor := (*PublicMessageAnchor)(nil)
	animationState := PublicAnimationUnmapped
	if hasRoute {
		animationState = PublicAnimationRoute
		observerLocation = nil
	} else if observerLocation != nil {
		animationState = PublicAnimationObserver
		if messageText != "" {
			messageAnchor = messageAnchorFromObserver(observerLocation)
		}
	}
	return PublicActivity{
		ID:               fmt.Sprintf("activity-%d", packet.ID),
		Kind:             "packet",
		PayloadTypeName:  packet.PayloadTypeName,
		RouteTypeName:    packet.RouteTypeName,
		IATA:             packet.IATA,
		Region:           packet.IATA,
		HeardAt:          packet.HeardAt,
		HopCount:         packet.HopCount,
		HasRoute:         hasRoute,
		AnimationState:   animationState,
		ResolutionBucket: PublicResolutionBucket(packet, hasRoute),
		ObserverLocation: observerLocation,
		RouteIDs:         ids,
		MessageSender:    publicMessageSender(packet.MessageSender),
		MessageText:      messageText,
		MessageAnchor:    messageAnchor,
	}
}

func PublicRoutePulseFromEdge(edge EdgeEvent, pathHash3Indexes ...map[string]string) (PublicRoutePulse, bool) {
	pathHash3ByNodeID := firstPathHash3Index(pathHash3Indexes)
	segments := make([]PublicRouteSegment, 0, len(edge.Segments))
	labels := []string{}
	for _, segment := range edge.Segments {
		if !validEndpoint(segment.From) || !validEndpoint(segment.To) {
			continue
		}
		publicSegment := PublicRouteSegment{
			RouteID:    PublicRouteID(segment.From.NodeID, segment.To.NodeID),
			From:       publicEndpoint(segment.From, pathHash3ByNodeID),
			To:         publicEndpoint(segment.To, pathHash3ByNodeID),
			DistanceKM: segment.DistanceKM,
		}
		segments = append(segments, publicSegment)
		labels = append(labels, publicSegment.From.Label, publicSegment.To.Label)
	}
	if len(segments) == 0 {
		return PublicRoutePulse{}, false
	}
	messageText := publicMessageText(edge.MessageText)
	var messageAnchor *PublicMessageAnchor
	if messageText != "" {
		messageAnchor = messageAnchorFromEdge(edge, segments)
	}
	return PublicRoutePulse{
		ID:              fmt.Sprintf("pulse-%d", edge.ID),
		IATA:            strings.ToUpper(edge.IATA),
		Region:          strings.ToUpper(edge.IATA),
		PayloadTypeName: edge.PayloadTypeName,
		MessageSender:   publicMessageSender(edge.MessageSender),
		MessageText:     messageText,
		MessageAnchor:   messageAnchor,
		HeardAt:         edge.HeardAt,
		Segments:        segments,
	}, len(labels) > 0
}

func PublicPacketPathFromPulse(pulse PublicRoutePulse) (PublicPacketPath, bool) {
	if len(pulse.Segments) == 0 {
		return PublicPacketPath{}, false
	}
	segments := make([]PublicRouteSegment, 0, len(pulse.Segments))
	routeIDs := make([]string, 0, len(pulse.Segments))
	labels := make([]string, 0, len(pulse.Segments)+1)
	var distance float64
	for index, segment := range pulse.Segments {
		if !validPublicCoords(segment.From.Lat, segment.From.Lng) || !validPublicCoords(segment.To.Lat, segment.To.Lng) {
			continue
		}
		segments = append(segments, segment)
		routeIDs = append(routeIDs, segment.RouteID)
		distance += segment.DistanceKM
		if index == 0 {
			labels = append(labels, segment.From.Label)
		}
		labels = append(labels, segment.To.Label)
	}
	if len(segments) == 0 {
		return PublicPacketPath{}, false
	}
	return PublicPacketPath{
		ID:              strings.TrimSpace(pulse.ID),
		At:              pulse.HeardAt,
		IATA:            strings.ToUpper(strings.TrimSpace(pulse.IATA)),
		Region:          strings.ToUpper(strings.TrimSpace(pulse.IATA)),
		PayloadTypeName: strings.TrimSpace(pulse.PayloadTypeName),
		MessageSender:   publicMessageSender(pulse.MessageSender),
		MessageText:     publicMessageText(pulse.MessageText),
		HopCount:        len(segments),
		SegmentCount:    len(segments),
		DistanceKM:      distance,
		RouteIDs:        uniqueSorted(routeIDs),
		EndpointLabels:  uniqueConsecutive(labels),
		Segments:        segments,
	}, true
}

func PublicActivityFromEdge(edge EdgeEvent) (PublicActivity, bool) {
	pulse, ok := PublicRoutePulseFromEdge(edge)
	if !ok {
		return PublicActivity{}, false
	}
	routeIDs := make([]string, 0, len(pulse.Segments))
	labels := make([]string, 0, len(pulse.Segments)+1)
	for index, segment := range pulse.Segments {
		routeIDs = append(routeIDs, segment.RouteID)
		if index == 0 {
			labels = append(labels, segment.From.Label)
		}
		labels = append(labels, segment.To.Label)
	}
	return PublicActivity{
		ID:               fmt.Sprintf("route-activity-%d", edge.ID),
		Kind:             "packet",
		PayloadTypeName:  edge.PayloadTypeName,
		HeardAt:          edge.HeardAt,
		HasRoute:         true,
		AnimationState:   PublicAnimationRoute,
		ResolutionBucket: PublicBucketRouted,
		RouteIDs:         uniqueSorted(routeIDs),
		EndpointLabels:   uniqueConsecutive(labels),
		IATA:             strings.ToUpper(edge.IATA),
		Region:           strings.ToUpper(edge.IATA),
		MessageSender:    publicMessageSender(edge.MessageSender),
		MessageText:      publicMessageText(edge.MessageText),
		MessageAnchor:    pulse.MessageAnchor,
	}, true
}

const (
	PublicAnimationRoute    = "route"
	PublicAnimationObserver = "observer"
	PublicAnimationUnmapped = "unmapped"

	PublicBucketRouted        = "routed"
	PublicBucketObserverOnly  = "observer_only"
	PublicBucketUnresolved    = "unresolved_path"
	PublicBucketMissingLoc    = "missing_location"
	PublicBucketRFGated       = "rf_gated"
	PublicBucketDistanceGated = "distance_gated"
	PublicBucketNotMapSafe    = "not_map_safe"
)

type PublicObserverLocationIndex map[string]PublicObserverLocation

func BuildPublicObserverLocationIndex(nodes []Node, observers []Observer) PublicObserverLocationIndex {
	out := PublicObserverLocationIndex{}
	for _, observer := range observers {
		if observer.Latitude == nil || observer.Longitude == nil || !validPublicCoords(*observer.Latitude, *observer.Longitude) {
			continue
		}
		out[observerLocationKey(observer.PublicKey, observer.IATA)] = PublicObserverLocation{
			Label:  publicObserverLabel(observer.Name, observer.IATA),
			IATA:   strings.ToUpper(observer.IATA),
			Region: strings.ToUpper(observer.IATA),
			Lat:    *observer.Latitude,
			Lng:    *observer.Longitude,
		}
	}
	for _, node := range nodes {
		if node.Latitude == nil || node.Longitude == nil || !validPublicCoords(*node.Latitude, *node.Longitude) {
			continue
		}
		location := PublicObserverLocation{
			Label: displayLabel(node.Name, node.Role),
			Lat:   *node.Latitude,
			Lng:   *node.Longitude,
		}
		if _, exists := out[observerLocationKey(node.PublicKey, "")]; !exists {
			out[observerLocationKey(node.PublicKey, "")] = location
		}
		for _, iata := range node.IATAsHeardIn {
			location.IATA = strings.ToUpper(iata)
			location.Region = strings.ToUpper(iata)
			if _, exists := out[observerLocationKey(node.PublicKey, iata)]; !exists {
				out[observerLocationKey(node.PublicKey, iata)] = location
			}
		}
	}
	return out
}

func (i PublicObserverLocationIndex) LocationForPublicKey(publicKey string, iata string) *PublicObserverLocation {
	if i == nil {
		return nil
	}
	if location, ok := i[observerLocationKey(publicKey, iata)]; ok {
		return &location
	}
	if location, ok := i[observerLocationKey(publicKey, "")]; ok {
		if location.IATA == "" {
			location.IATA = strings.ToUpper(iata)
			location.Region = strings.ToUpper(iata)
		}
		return &location
	}
	return nil
}

func (i PublicObserverLocationIndex) locationForPacket(packet PacketObservation) *PublicObserverLocation {
	return i.LocationForPublicKey(packet.ObserverPublicKey, packet.IATA)
}

func PublicObserverLocationFromNode(node Node, iata string) *PublicObserverLocation {
	if node.Latitude == nil || node.Longitude == nil || !validPublicCoords(*node.Latitude, *node.Longitude) {
		return nil
	}
	return &PublicObserverLocation{
		Label:  displayLabel(node.Name, node.Role),
		IATA:   strings.ToUpper(iata),
		Region: strings.ToUpper(iata),
		Lat:    *node.Latitude,
		Lng:    *node.Longitude,
	}
}

func PublicObserverLocationFromObserver(observer Observer) *PublicObserverLocation {
	if observer.Latitude == nil || observer.Longitude == nil || !validPublicCoords(*observer.Latitude, *observer.Longitude) {
		return nil
	}
	return &PublicObserverLocation{
		Label:  publicObserverLabel(observer.Name, observer.IATA),
		IATA:   strings.ToUpper(observer.IATA),
		Region: strings.ToUpper(observer.IATA),
		Lat:    *observer.Latitude,
		Lng:    *observer.Longitude,
	}
}

func PublicResolutionBucket(packet PacketObservation, hasRoute bool) string {
	if hasRoute || packet.ResolutionStatus == resolve.StatusHigh {
		return PublicBucketRouted
	}
	if packet.InvalidForMap || packet.ResolutionStatus == resolve.StatusInvalidForMap {
		return PublicBucketNotMapSafe
	}
	switch packet.ResolutionStatus {
	case resolve.StatusNoPath:
		return PublicBucketObserverOnly
	case resolve.StatusMissingCoords:
		return PublicBucketMissingLoc
	case resolve.StatusMissingRF:
		return PublicBucketRFGated
	case resolve.StatusDistanceGate:
		return PublicBucketDistanceGated
	case resolve.StatusUnresolved, resolve.StatusAmbiguous, resolve.StatusDuplicatePrefix, resolve.StatusRoleInvalid:
		return PublicBucketUnresolved
	default:
		return PublicBucketUnresolved
	}
}

func PublicResolutionCounters(activity []PublicActivity) map[string]map[string]int64 {
	out := map[string]map[string]int64{}
	for _, item := range activity {
		iata := strings.ToUpper(strings.TrimSpace(item.IATA))
		if iata == "" {
			iata = "UNKNOWN"
		}
		if out[iata] == nil {
			out[iata] = map[string]int64{}
		}
		bucket := strings.TrimSpace(item.ResolutionBucket)
		if bucket == "" {
			bucket = PublicBucketUnresolved
		}
		out[iata][bucket]++
	}
	return out
}

func BuildPublicRoutes(edges []EdgeEvent, pathHash3Indexes ...map[string]string) ([]PublicRoute, map[string][]string) {
	pathHash3ByNodeID := firstPathHash3Index(pathHash3Indexes)
	type aggregate struct {
		route        PublicRoute
		payloadTypes map[string]struct{}
	}
	byID := map[string]*aggregate{}
	routesByPacket := map[string][]string{}
	for _, edge := range edges {
		for _, segment := range edge.Segments {
			if !validEndpoint(segment.From) || !validEndpoint(segment.To) {
				continue
			}
			id := PublicRouteID(segment.From.NodeID, segment.To.NodeID)
			item := byID[id]
			if item == nil {
				item = &aggregate{
					route: PublicRoute{
						ID:         id,
						From:       publicEndpoint(segment.From, pathHash3ByNodeID),
						To:         publicEndpoint(segment.To, pathHash3ByNodeID),
						DistanceKM: segment.DistanceKM,
					},
					payloadTypes: map[string]struct{}{},
				}
				byID[id] = item
			}
			item.route.PacketCount++
			if edge.HeardAt > item.route.LastHeard {
				item.route.LastHeard = edge.HeardAt
			}
			item.payloadTypes[edge.PayloadTypeName] = struct{}{}
			routesByPacket[edge.PacketHash] = append(routesByPacket[edge.PacketHash], id)
		}
	}
	routes := make([]PublicRoute, 0, len(byID))
	maxCount := 1
	for _, item := range byID {
		if item.route.PacketCount > maxCount {
			maxCount = item.route.PacketCount
		}
	}
	for _, item := range byID {
		item.route.FrequencyBucket = frequencyBucket(item.route.PacketCount, maxCount)
		item.route.PayloadTypeNames = mapKeys(item.payloadTypes)
		routes = append(routes, item.route)
	}
	sort.Slice(routes, func(i, j int) bool {
		if routes[i].PacketCount == routes[j].PacketCount {
			return routes[i].LastHeard > routes[j].LastHeard
		}
		return routes[i].PacketCount > routes[j].PacketCount
	})
	for packetHash, ids := range routesByPacket {
		routesByPacket[packetHash] = uniqueSorted(ids)
	}
	return routes, routesByPacket
}

func BuildPublicRoutePulses(edges []EdgeEvent, limit int, minHeardAt int64, pathHash3Indexes ...map[string]string) []PublicRoutePulse {
	pathHash3ByNodeID := firstPathHash3Index(pathHash3Indexes)
	if limit <= 0 {
		limit = 80
	}
	pulses := make([]PublicRoutePulse, 0, min(limit, len(edges)))
	for _, edge := range edges {
		if edge.HeardAt < minHeardAt {
			continue
		}
		pulse, ok := PublicRoutePulseFromEdge(edge, pathHash3ByNodeID)
		if !ok {
			continue
		}
		pulses = append(pulses, pulse)
		if len(pulses) >= limit {
			break
		}
	}
	return pulses
}

func PublicRouteID(a string, b string) string {
	if b < a {
		a, b = b, a
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(a + ":" + b))
	return fmt.Sprintf("r-%08x", h.Sum32())
}

func publicEndpoint(endpoint EdgeEndpoint, pathHash3Indexes ...map[string]string) PublicRouteEndpoint {
	pathHash3ByNodeID := firstPathHash3Index(pathHash3Indexes)
	return PublicRouteEndpoint{
		NodeID:    publicNodeID(endpoint.NodeID),
		Label:     displayLabel(endpoint.Name, "unknown"),
		Lat:       endpoint.Lat,
		Lng:       endpoint.Lng,
		PathHash3: publicEndpointPathHash3(endpoint, pathHash3ByNodeID),
	}
}

func publicEndpointPathHash3(endpoint EdgeEndpoint, pathHash3ByNodeID map[string]string) string {
	if hash := publicPathHash3(endpoint.PathHash3); hash != "" {
		return hash
	}
	if hash := publicPathHash3(pathHash3ByNodeID[endpoint.NodeID]); hash != "" {
		return hash
	}
	if hash := publicPathHash3(pathHash3ByNodeID[publicNodeID(endpoint.NodeID)]); hash != "" {
		return hash
	}
	return pathHash3FromPublicKey(endpoint.NodeID)
}

func publicPathHash3(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if len(value) != 6 || !looksSensitiveHex(value, 6) {
		return ""
	}
	return value
}

func pathHash3FromPublicKey(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if len(value) < 6 || !looksSensitiveHex(value[:6], 6) {
		return ""
	}
	return value[:6]
}

func firstPathHash3Index(indexes []map[string]string) map[string]string {
	if len(indexes) == 0 || indexes[0] == nil {
		return map[string]string{}
	}
	return indexes[0]
}

func messageAnchorFromRouteSegments(segments []PublicRouteSegment) *PublicMessageAnchor {
	if len(segments) == 0 {
		return nil
	}
	return messageAnchorFromEndpoint(segments[0].From)
}

func messageAnchorFromEdge(edge EdgeEvent, segments []PublicRouteSegment) *PublicMessageAnchor {
	if edge.MessageAnchor != nil && validEndpoint(edge.MessageAnchor.Endpoint) {
		endpoint := publicEndpoint(edge.MessageAnchor.Endpoint)
		kind := strings.ToLower(strings.TrimSpace(edge.MessageAnchor.Kind))
		if kind != "observer" {
			kind = "source"
		}
		return messageAnchorFromEndpointKind(endpoint, kind)
	}
	return messageAnchorFromRouteSegments(segments)
}

func messageAnchorFromEndpoint(endpoint PublicRouteEndpoint) *PublicMessageAnchor {
	return messageAnchorFromEndpointKind(endpoint, "source")
}

func messageAnchorFromEndpointKind(endpoint PublicRouteEndpoint, kind string) *PublicMessageAnchor {
	if !validPublicCoords(endpoint.Lat, endpoint.Lng) {
		return nil
	}
	anchor := &PublicMessageAnchor{
		Kind:  kind,
		Label: endpoint.Label,
		Lat:   endpoint.Lat,
		Lng:   endpoint.Lng,
	}
	if kind == "source" {
		anchor.NodeID = endpoint.NodeID
	}
	return anchor
}

func messageAnchorFromObserver(location *PublicObserverLocation) *PublicMessageAnchor {
	if location == nil || !validPublicCoords(location.Lat, location.Lng) {
		return nil
	}
	return &PublicMessageAnchor{
		Kind:  "observer",
		Label: location.Label,
		Lat:   location.Lat,
		Lng:   location.Lng,
	}
}

func publicNodeID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return "n-empty"
	}
	if looksSensitiveHex(id, 32) || !publicSafeToken(id) {
		h := fnv.New32a()
		_, _ = h.Write([]byte(strings.ToUpper(id)))
		return fmt.Sprintf("n-%08x", h.Sum32())
	}
	return id
}

func PublicSafeID(id string) string {
	return publicNodeID(id)
}

func publicObserverNodeID(observer Observer) string {
	seed := strings.ToUpper(strings.TrimSpace(observer.PublicKey))
	if seed == "" {
		seed = strings.ToUpper(strings.TrimSpace(observer.Name)) + "|" + strings.ToUpper(strings.TrimSpace(observer.IATA))
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(seed))
	id := fmt.Sprintf("o-%08x", h.Sum32())
	if iata := strings.ToLower(strings.TrimSpace(observer.IATA)); iata != "" {
		id += "-" + iata
	}
	return id
}

func validEndpoint(endpoint EdgeEndpoint) bool {
	return validPublicCoords(endpoint.Lat, endpoint.Lng)
}

func validPublicCoords(lat float64, lng float64) bool {
	return ValidPublicCoords(lat, lng)
}

func frequencyBucket(count int, maxCount int) int {
	if maxCount <= 1 {
		return 0
	}
	strength := math.Log1p(float64(count)) / math.Log1p(float64(maxCount)+1)
	bucket := int(math.Round(strength * 4))
	if bucket < 0 {
		return 0
	}
	if bucket > 4 {
		return 4
	}
	return bucket
}

func normalizeRole(role string) string {
	switch role {
	case "repeater", "room_server", "companion", "sensor":
		return role
	default:
		return "unknown"
	}
}

func displayLabel(name string, role string) string {
	name = PublicDisplayText(name, 80)
	if name != "" && !looksSensitiveHex(name, 8) {
		return name
	}
	switch normalizeRole(role) {
	case "repeater":
		return "Repeater"
	case "room_server":
		return "Room"
	case "companion":
		return "Companion"
	case "sensor":
		return "Sensor"
	default:
		return "Node"
	}
}

func publicObserverLabel(name string, iata string) string {
	name = PublicDisplayText(name, 80)
	if name != "" && !looksSensitiveHex(name, 8) {
		return name
	}
	iata = strings.ToUpper(strings.TrimSpace(iata))
	if iata != "" {
		return iata + " observer"
	}
	return "Observer"
}

func observerLocationKey(publicKey string, iata string) string {
	return strings.ToUpper(strings.TrimSpace(publicKey)) + "|" + strings.ToUpper(strings.TrimSpace(iata))
}

func looksSensitiveHex(value string, minLength int) bool {
	value = strings.TrimSpace(value)
	if len(value) < minLength {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F') {
			continue
		}
		return false
	}
	return true
}

func mapKeys(items map[string]struct{}) []string {
	out := make([]string, 0, len(items))
	for key := range items {
		if key != "" {
			out = append(out, key)
		}
	}
	sort.Strings(out)
	return out
}

func uniqueSorted(items []string) []string {
	seen := map[string]struct{}{}
	for _, item := range items {
		if item != "" {
			seen[item] = struct{}{}
		}
	}
	return mapKeys(seen)
}

func uniqueConsecutive(items []string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if item == "" {
			continue
		}
		if len(out) == 0 || out[len(out)-1] != item {
			out = append(out, item)
		}
	}
	return out
}

func publicMessageText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = redactPublicMessageText(value)
	return PublicDisplayText(value, 500)
}

func publicMessageSender(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = redactPublicMessageText(value)
	return PublicDisplayText(value, 80)
}

func redactPublicMessageText(value string) string {
	value = publicSecretPairRE.ReplaceAllString(value, "[redacted]")
	value = publicPathHexRE.ReplaceAllString(value, "[redacted path]")
	value = publicLongHexRE.ReplaceAllString(value, "[redacted id]")
	value = publicBase64RE.ReplaceAllString(value, "[redacted key]")
	return strings.TrimSpace(value)
}

// PublicDisplayText normalizes MeshCore-controlled display strings before they
// cross the public API/WebSocket boundary. React and MapLibre render these as
// text, but stripping HTML delimiter characters here keeps older projections
// and downstream public consumers from turning crafted node names into markup.
func PublicDisplayText(value string, maxRunes int) string {
	value = strings.TrimSpace(strings.TrimRight(value, "\x00"))
	if value == "" {
		return ""
	}
	value = strings.Map(func(r rune) rune {
		switch r {
		case '\n', '\r', '\t':
			return ' '
		case '<', '>', '&', '"', '\'', '`', '=':
			return -1
		}
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return -1
		}
		return r
	}, value)
	value = strings.Join(strings.Fields(value), " ")
	if maxRunes <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes])
}

func publicSafeToken(value string) bool {
	if len(value) > 96 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		switch r {
		case '-', '_', '.', ':':
			continue
		}
		return false
	}
	return true
}
