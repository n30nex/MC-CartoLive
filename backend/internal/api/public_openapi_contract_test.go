package api

import (
	"context"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"log/slog"
	"math"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/solar"
)

func TestGeneratedPublicOpenAPIIsSynchronizedAndVersioned(t *testing.T) {
	docs, err := os.ReadFile("../../../docs/public-api.openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(docs, publicOpenAPIDocument) {
		t.Fatal("embedded and docs public OpenAPI documents differ; run node scripts/generate-public-openapi.mjs")
	}
	versionBytes, err := os.ReadFile("../../../VERSION")
	if err != nil {
		t.Fatal(err)
	}
	version := strings.TrimSpace(string(versionBytes))
	schema := publicOpenAPISchema(version)
	info, _ := schema["info"].(map[string]any)
	if got := fmt.Sprint(info["version"]); got != version {
		t.Fatalf("OpenAPI version = %q, want VERSION %q", got, version)
	}
	if _, found := publicSchemas(t, schema)["SanitizedPublicObject"]; found {
		t.Fatal("catch-all SanitizedPublicObject must not be present")
	}
}

func TestPublicOpenAPIInventoriesRegisteredPublicRoutesExactly(t *testing.T) {
	registered := registeredPublicGETRoutes(t)
	schema := publicOpenAPISchema("3.2.0")
	paths := schema["paths"].(map[string]any)
	documented := make([]string, 0, len(paths))
	for path := range paths {
		documented = append(documented, path)
	}
	sort.Strings(documented)
	if !reflect.DeepEqual(documented, registered) {
		t.Fatalf("public route inventory drift\nregistered: %v\ndocumented: %v", registered, documented)
	}
	for _, path := range documented {
		pathItem := paths[path].(map[string]any)
		operation, ok := pathItem["get"].(map[string]any)
		if !ok {
			t.Fatalf("%s has no GET operation", path)
		}
		responses, ok := operation["responses"].(map[string]any)
		if !ok || responses["200"] == nil && responses["101"] == nil {
			t.Fatalf("%s has no success response", path)
		}
		if path == "/ws/public" {
			messages := operation["x-websocket-messages"].(map[string]any)
			for _, side := range []string{"client", "server"} {
				messageRef := messages[side].(map[string]any)["$ref"]
				if messageRef == nil {
					t.Fatalf("%s WebSocket %s contract is missing", path, side)
				}
			}
			continue
		}
		response := responses["200"].(map[string]any)
		content := response["content"].(map[string]any)
		responseSchema := content["application/json"].(map[string]any)["schema"].(map[string]any)
		if responseSchema["$ref"] == nil {
			t.Fatalf("%s 200 response is not bound to a named schema", path)
		}
	}
}

func TestPublicOpenAPIQueryInventory(t *testing.T) {
	expected := map[string][]string{
		"/healthz": {}, "/readyz": {}, "/api/v1/public/state": {}, "/api/v1/public/bootstrap": {},
		"/api/v1/public/history":                     {"cursor", "from", "limit", "to"},
		"/api/v1/public/history/summary":             {"bucketMs", "from", "to"},
		"/api/v1/public/events":                      {"afterSeq", "event", "from", "iata", "limit", "messageOnly", "payload", "payloadType", "region", "to"},
		"/api/v1/public/viewport":                    {"bbox", "include", "sinceSeq", "zoom"},
		"/api/v1/public/noc":                         {},
		"/api/v1/public/packets":                     {"cursor", "from", "iata", "limit", "messageOnly", "minHops", "payload", "q", "region", "to"},
		"/api/v1/public/chat":                        {"channel", "cursor", "from", "iata", "limit", "q", "region", "to"},
		"/api/v1/public/solar":                       {},
		"/api/v1/public/propagation":                 {"cursor", "from", "iata", "limit", "region", "to"},
		"/api/v1/public/coverage":                    {"iata", "limit", "region"},
		"/api/v1/public/los/profile":                 {"aLat", "aLng", "antennaHeightAM", "antennaHeightBM", "bLat", "bLng", "frequencyMhz", "nodeA", "nodeB"},
		"/api/v1/public/schema":                      {},
		"/api/v1/public/integrations/home-assistant": {},
		"/ws/public":                                 {},
	}
	paths := publicOpenAPISchema("3.2.0")["paths"].(map[string]any)
	for path, want := range expected {
		operation := paths[path].(map[string]any)["get"].(map[string]any)
		got := []string{}
		if parameters, ok := operation["parameters"].([]any); ok {
			for _, item := range parameters {
				got = append(got, item.(map[string]any)["name"].(string))
			}
		}
		sort.Strings(got)
		sort.Strings(want)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s query parameters = %v, want %v", path, got, want)
		}
	}
}

func TestPublicOpenAPIRuntimeLimitsAndWebSocketHTTPOutcomes(t *testing.T) {
	paths := publicOpenAPISchema("3.2.0")["paths"].(map[string]any)
	history := paths["/api/v1/public/history"].(map[string]any)["get"].(map[string]any)
	parameters := history["parameters"].([]any)
	var historyLimit map[string]any
	for _, parameter := range parameters {
		candidate := parameter.(map[string]any)
		if candidate["name"] == "limit" {
			historyLimit = candidate
			break
		}
	}
	if historyLimit == nil {
		t.Fatal("public history limit parameter is missing")
	}
	maximum := historyLimit["schema"].(map[string]any)["maximum"]
	if maximum != float64(publicHistoryMaxLimit) {
		t.Fatalf("public history OpenAPI maximum = %v, runtime maximum = %d", maximum, publicHistoryMaxLimit)
	}

	webSocket := paths["/ws/public"].(map[string]any)["get"].(map[string]any)
	responses := webSocket["responses"].(map[string]any)
	gotStatuses := make([]string, 0, len(responses))
	for status := range responses {
		gotStatuses = append(gotStatuses, status)
	}
	sort.Strings(gotStatuses)
	wantStatuses := []string{"101", "400", "403", "405", "429", "500", "503"}
	if !reflect.DeepEqual(gotStatuses, wantStatuses) {
		t.Fatalf("public WebSocket HTTP statuses = %v, want %v", gotStatuses, wantStatuses)
	}
	for _, status := range []string{"400", "403", "405", "500"} {
		content := responses[status].(map[string]any)["content"].(map[string]any)
		if _, found := content["text/plain; charset=utf-8"]; !found || len(content) != 1 {
			t.Fatalf("public WebSocket %s content = %#v, want only plain text", status, content)
		}
	}
	for _, status := range []string{"429"} {
		content := responses[status].(map[string]any)["content"].(map[string]any)
		if _, found := content["application/json"]; !found || len(content) != 1 {
			t.Fatalf("public WebSocket %s content = %#v, want only JSON", status, content)
		}
	}
	serviceUnavailableContent := responses["503"].(map[string]any)["content"].(map[string]any)
	if len(serviceUnavailableContent) != 2 || serviceUnavailableContent["application/json"] == nil || serviceUnavailableContent["text/plain; charset=utf-8"] == nil {
		t.Fatalf("public WebSocket 503 content = %#v, want JSON hub-unavailable and plain-text saturation shapes", serviceUnavailableContent)
	}
}

func TestPublicStructJSONFieldsMatchNamedSchemas(t *testing.T) {
	types := map[string]reflect.Type{
		"CoordinateBounds":                reflect.TypeOf(live.CoordinateBounds{}),
		"PublicMapConfig":                 reflect.TypeOf(live.PublicMapConfig{}),
		"PublicStats":                     reflect.TypeOf(live.PublicStats{}),
		"PublicNode":                      reflect.TypeOf(live.PublicNode{}),
		"PublicRouteEndpoint":             reflect.TypeOf(live.PublicRouteEndpoint{}),
		"PublicRouteSegment":              reflect.TypeOf(live.PublicRouteSegment{}),
		"PublicRoute":                     reflect.TypeOf(live.PublicRoute{}),
		"PublicObserverLocation":          reflect.TypeOf(live.PublicObserverLocation{}),
		"PublicMessageAnchor":             reflect.TypeOf(live.PublicMessageAnchor{}),
		"PublicActivity":                  reflect.TypeOf(live.PublicActivity{}),
		"PublicRoutePulse":                reflect.TypeOf(live.PublicRoutePulse{}),
		"PublicPacketPath":                reflect.TypeOf(live.PublicPacketPath{}),
		"PublicChatMessage":               reflect.TypeOf(live.PublicChatMessage{}),
		"PublicChatResponse":              reflect.TypeOf(live.PublicChatResponse{}),
		"PublicPacketsResponse":           reflect.TypeOf(live.PublicPacketsResponse{}),
		"PublicPropagationWeatherSummary": reflect.TypeOf(live.PublicPropagationWeatherSummary{}),
		"PublicPropagationSolarSummary":   reflect.TypeOf(live.PublicPropagationSolarSummary{}),
		"PublicPropagationReplayWindow":   reflect.TypeOf(live.PublicPropagationReplayWindow{}),
		"PublicPropagationEvent":          reflect.TypeOf(live.PublicPropagationEvent{}),
		"PublicPropagationConditions":     reflect.TypeOf(live.PublicPropagationConditions{}),
		"PublicPropagationResponse":       reflect.TypeOf(live.PublicPropagationResponse{}),
		"PublicPacketScan":                reflect.TypeOf(live.PublicPacketScan{}),
		"PublicLiveState":                 reflect.TypeOf(live.PublicLiveState{}),
		"PublicHistoryWindow":             reflect.TypeOf(live.PublicHistoryWindow{}),
		"PublicHistoryResponse":           reflect.TypeOf(live.PublicHistoryResponse{}),
		"PublicEventsResponse":            reflect.TypeOf(live.PublicEventsResponse{}),
		"PublicMapCluster":                reflect.TypeOf(live.PublicMapCluster{}),
		"PublicRuntimeHealth":             reflect.TypeOf(live.PublicRuntimeHealth{}),
		"PublicBootstrapResponse":         reflect.TypeOf(live.PublicBootstrapResponse{}),
		"PublicViewportResponse":          reflect.TypeOf(live.PublicViewportResponse{}),
		"PublicNOCObserver":               reflect.TypeOf(live.PublicNOCObserver{}),
		"PublicNOCResponse":               reflect.TypeOf(live.PublicNOCResponse{}),
		"PublicCoverageCell":              reflect.TypeOf(live.PublicCoverageCell{}),
		"PublicCoverageResponse":          reflect.TypeOf(live.PublicCoverageResponse{}),
		"PublicLOSPoint":                  reflect.TypeOf(live.PublicLOSPoint{}),
		"PublicLOSProfileResponse":        reflect.TypeOf(live.PublicLOSProfileResponse{}),
		"PublicSensorSummaryResponse":     reflect.TypeOf(live.PublicSensorSummaryResponse{}),
		"PublicHistorySummaryBucket":      reflect.TypeOf(live.PublicHistorySummaryBucket{}),
		"PublicHistorySummaryResponse":    reflect.TypeOf(live.PublicHistorySummaryResponse{}),
		"SolarConditions":                 reflect.TypeOf(solar.Conditions{}),
	}
	schemas := publicSchemas(t, publicOpenAPISchema("3.2.0"))
	for schemaName, goType := range types {
		t.Run(schemaName, func(t *testing.T) {
			schema := schemas[schemaName].(map[string]any)
			properties := schema["properties"].(map[string]any)
			required := map[string]bool{}
			for _, item := range schema["required"].([]any) {
				required[item.(string)] = true
			}
			goFields := map[string]bool{}
			for index := 0; index < goType.NumField(); index++ {
				field := goType.Field(index)
				tag := field.Tag.Get("json")
				parts := strings.Split(tag, ",")
				name := parts[0]
				if name == "" {
					name = field.Name
				}
				if name == "-" {
					continue
				}
				goFields[name] = true
				if _, found := properties[name]; !found {
					t.Errorf("Go JSON field %s is missing from schema", name)
				}
				omitempty := false
				for _, option := range parts[1:] {
					omitempty = omitempty || option == "omitempty"
				}
				alwaysEncoded := !omitempty || field.Type.Kind() == reflect.Struct
				if required[name] != alwaysEncoded {
					t.Errorf("required[%s] = %v, want %v from json tag %q", name, required[name], alwaysEncoded, tag)
				}
			}
			for name := range properties {
				if !goFields[name] {
					t.Errorf("schema property %s has no Go JSON field", name)
				}
			}
		})
	}
}

func TestRepresentativePublicPayloadsMatchOpenAPI(t *testing.T) {
	now := time.Now().UnixMilli()
	endpoint := live.PublicRouteEndpoint{NodeID: "node-public", Label: "Public node", Lat: 43.65, Lng: -79.38, PathHash3: "A1B2C3"}
	segment := live.PublicRouteSegment{RouteID: "route-public", From: endpoint, To: live.PublicRouteEndpoint{NodeID: "node-public-2", Label: "Other", Lat: 45.42, Lng: -75.69}, DistanceKM: 351}
	activity := live.PublicActivity{
		Seq: 9, ID: "activity-9", Kind: "packet", PayloadTypeName: "TEXT", HeardAt: now, HopCount: 1, HasRoute: true,
		AnimationState: live.PublicAnimationRoute, ResolutionBucket: "routed", RouteIDs: []string{"route-public"},
	}
	pulse := live.PublicRoutePulse{Seq: 10, ID: "pulse-10", PayloadTypeName: "TEXT", HeardAt: now, Segments: []live.PublicRouteSegment{segment}}
	node := live.PublicNode{
		Seq: 11, ID: "node-public", Label: "Public node", Role: "repeater", Latitude: 43.65, Longitude: -79.38,
		LastSeen: now, FirstSeen: now - 1000, IATAsHeardIn: []string{"YYZ"}, RegionsHeardIn: []string{"YYZ"}, ActivityCount: 2,
	}
	route := live.PublicRoute{ID: "route-public", From: segment.From, To: segment.To, DistanceKM: 351, PacketCount: 2, LastHeard: now, FrequencyBucket: 1, PayloadTypeNames: []string{"TEXT"}}
	stats := live.PublicStats{Packets: 2, ActiveNodes: 2, ActiveRoutes: 1, MQTTConnected: true, MQTTMessages: 2, WSClients: 1, ServerTime: now, LatestSeq: 11}
	mapConfig := live.PublicMapConfig{RegionPreset: "canada", DefaultRegion: "YYZ", DefaultCenter: []float64{-96, 56}, DefaultZoom: 3, Bounds: live.CoordinateBounds{MinLat: 41, MaxLat: 84, MinLng: -141, MaxLng: -52}}

	server := &Server{
		Config:    Config{AppVersion: "3.2.0", GitSHA: "abcdef1", BuildTime: "2026-07-10T12:00:00Z", MapBounds: mapConfig.Bounds},
		PublicHub: live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 8),
		Runtime:   live.NewRuntimeStats(),
		startTime: time.Now().Add(-time.Minute),
	}

	cases := []struct {
		name  string
		value any
	}{
		{"RuntimeOperationalStatus", server.healthStatus(time.UnixMilli(now))},
		{"RuntimeReadinessStatus", server.readinessStatus(context.Background())},
		{"PublicLiveState", live.PublicLiveState{ServerTime: now, Map: mapConfig, Stats: stats, Nodes: []live.PublicNode{node}, Routes: []live.PublicRoute{route}, RecentPulses: []live.PublicRoutePulse{pulse}, RecentActivity: []live.PublicActivity{activity}, UpdatedAt: now}},
		{"PublicBootstrapResponse", live.PublicBootstrapResponse{ServerTime: now, Map: mapConfig, Stats: stats, LatestSeq: 11, Health: live.PublicRuntimeHealth{MQTTSessionReady: true, DatasetState: "live", DatasetStartedAt: now, StoragePressureState: "ok"}, Clusters: []live.PublicMapCluster{{ID: "region-yyz", Latitude: 43.65, Longitude: -79.38, Count: 1}}, RecentActivity: []live.PublicActivity{activity}}},
		{"PublicHistoryResponse", live.PublicHistoryResponse{ServerTime: now, Events: []live.PublicHistoryEvent{{Type: "activity", At: now, Data: activity}, {Type: "routePulse", At: now, Data: pulse}}, NextCursor: "opaque", Window: live.PublicHistoryWindow{From: now - 1000, To: now, Count: 2}}},
		{"PublicHistorySummaryResponse", live.PublicHistorySummaryResponse{ServerTime: now, From: now - 1000, To: now, BucketMs: 1000, Buckets: []live.PublicHistorySummaryBucket{{Start: now - 1000, End: now, Count: 2}}}},
		{"PublicEventsResponse", live.PublicEventsResponse{ServerTime: now, OldestSeq: 9, LatestSeq: 11, Events: []live.PublicEvent{{Seq: 10, Type: "routePulse", At: now, Data: pulse}}, NextCursor: "10"}},
		{"PublicEventsResponse", live.PublicEventsResponse{ServerTime: now, OldestSeq: 9, LatestSeq: 11, Events: []live.PublicEvent{}, NextCursor: "11", ResetRequired: true}},
		{"PublicViewportResponse", live.PublicViewportResponse{ServerTime: now, LatestSeq: 11, Nodes: []live.PublicNode{node}, Routes: []live.PublicRoute{route}, BBox: []float64{-141, 41, -52, 84}, Zoom: 8, Includes: []string{"nodes", "routes"}}},
		{"PublicNOCResponse", live.PublicNOCResponse{ServerTime: now, LatestSeq: 11, MQTTConnected: true, PublicCacheReady: true, PublicCacheAgeMs: 1, WSClients: 1, Packets: 2, ActiveNodes: 1, ActiveRoutes: 1, Observers: []live.PublicNOCObserver{}, ObserverStateCounts: map[string]int{"online": 0, "stale": 0, "offline": 0}}},
		{"PublicPacketsResponse", live.PublicPacketsResponse{ServerTime: now, Packets: []live.PublicPacketPath{{ID: "pulse-10", At: now, PayloadTypeName: "TEXT", HopCount: 1, SegmentCount: 1, DistanceKM: 351, RouteIDs: []string{"route-public"}, EndpointLabels: []string{"Public node", "Other"}, Segments: []live.PublicRouteSegment{segment}}}, Window: live.PublicHistoryWindow{From: now - 1000, To: now, Count: 1}, Scan: live.PublicPacketScan{EventsScanned: 1, ScanLimit: 2500}}},
		{"PublicChatResponse", live.PublicChatResponse{ServerTime: now, Messages: []live.PublicChatMessage{{ID: "chat-1", At: now, Text: "hello", ChannelLabel: "Public", PayloadTypeName: "TEXT", Source: "routed"}}, Window: live.PublicHistoryWindow{From: now - 1000, To: now, Count: 1}}},
		{"SolarConditions", solar.Conditions{ServerTime: now, KpIndex: 2, KpLabel: "quiet", SolarFluxSFU: 110, SolarFluxLabel: "moderate", GeomagActivity: "quiet", FetchedAt: now}},
		{"PublicPropagationResponse", live.PublicPropagationResponse{ServerTime: now, Conditions: live.PublicPropagationConditions{ServerTime: now, EventCount: 1, SourceStatus: "ready"}, Events: []live.PublicPropagationEvent{{ID: "prop-10", At: now, Classification: "long_distance_event", Confidence: "low", Score: .5, DistanceKM: 351, RouteIDs: []string{"route-public"}, EndpointLabels: []string{"Public node", "Other"}, Segments: []live.PublicRouteSegment{segment}, Reasons: []string{"long verified RF path"}, ReplayWindow: live.PublicPropagationReplayWindow{From: now - 1000, To: now + 1000}}}, Window: live.PublicHistoryWindow{From: now - 1000, To: now, Count: 1}}},
		{"PublicCoverageResponse", live.PublicCoverageResponse{ServerTime: now, SourceStatus: "ready", PrecisionDefault: "coarse", Cells: []live.PublicCoverageCell{{ID: "coverage-1", Source: "synthetic", BBox: []float64{-80, 43, -79, 44}, Intensity: 1, SampleCount: 2, AgeBucket: "recent", UpdatedAt: now, PrecisionBucket: "coarse"}}}},
		{"PublicLOSProfileResponse", live.PublicLOSProfileResponse{ServerTime: now, Source: "canada-cdem", SourceStatus: "dataset_workflow_required", DistanceKm: 351, BearingDeg: 45, FrequencyMHz: 910.525, AntennaHeightAM: 2, AntennaHeightBM: 2, Points: []live.PublicLOSPoint{{Fraction: 0, Lat: 43.65, Lng: -79.38}, {Fraction: 1, Lat: 45.42, Lng: -75.69, DistanceKm: 351}}}},
		{"PublicSensorSummaryResponse", live.PublicSensorSummaryResponse{ServerTime: now, MQTTConnected: true, Packets: 2, ActiveNodes: 1, ActiveRoutes: 1, WSClients: 1, ObserverOnline: 1, PublicCacheAgeMs: 1, LatestSeq: 11}},
		{"OpenAPIDocument", publicOpenAPISchema("3.2.0")},
	}

	schema := publicOpenAPISchema("3.2.0")
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { assertMatchesPublicSchema(t, schema, tc.name, tc.value) })
	}
}

func TestRepresentativePublicWebSocketEnvelopesMatchOpenAPI(t *testing.T) {
	now := time.Now().UnixMilli()
	node := live.PublicNode{ID: "node-public", Label: "Public node", Role: "unknown", Latitude: 43.65, Longitude: -79.38, LastSeen: now, FirstSeen: now, IATAsHeardIn: []string{}, ActivityCount: 1}
	activity := live.PublicActivity{ID: "activity-1", Kind: "packet", PayloadTypeName: "TEXT", HeardAt: now, HopCount: 0, AnimationState: "unmapped", ResolutionBucket: "unresolved_path"}
	segment := live.PublicRouteSegment{RouteID: "route-1", From: live.PublicRouteEndpoint{NodeID: "a", Label: "A", Lat: 43, Lng: -79}, To: live.PublicRouteEndpoint{NodeID: "b", Label: "B", Lat: 44, Lng: -78}, DistanceKM: 10}
	pulse := live.PublicRoutePulse{ID: "pulse-1", PayloadTypeName: "TEXT", HeardAt: now, Segments: []live.PublicRouteSegment{segment}}
	schema := publicOpenAPISchema("3.2.0")

	serverMessages := []live.Envelope{
		{Version: 1, Type: "hello", Seq: 1, LatestSeq: 1, ServerTime: now, ReceivedAt: now, DisplayAt: now, ConnectionID: "550e8400-e29b-41d4-a716-446655440000"},
		{Version: 1, Type: "pong", Seq: 1, LatestSeq: 1, ServerTime: now, ReceivedAt: now, DisplayAt: now},
		{Version: 1, Type: "lagged", Seq: 3, LatestSeq: 3, FromSeq: 2, ToSeq: 3, ServerTime: now, ReceivedAt: now, DisplayAt: now, DroppedCount: 1, Since: now - 1000},
		{Version: 1, Type: "event", Event: "nodeUpdate", Seq: 1, LatestSeq: 1, ServerTime: now, DisplayAt: now, Data: node},
		{Version: 1, Type: "event", Event: "activity", Seq: 2, LatestSeq: 2, ServerTime: now, DisplayAt: now, Data: activity},
		{Version: 1, Type: "event", Event: "routePulse", Seq: 3, LatestSeq: 3, ServerTime: now, DisplayAt: now, Data: pulse},
	}
	for i, message := range serverMessages {
		t.Run(fmt.Sprintf("server-%d-%s", i, message.Type), func(t *testing.T) {
			assertMatchesPublicSchema(t, schema, "WebSocketServerMessage", message)
		})
	}

	clientMessages := []map[string]any{
		{"v": 1, "type": "ping"},
		{"v": 1, "type": "resume", "afterSeq": 2},
		{"v": 1, "type": "subscribe", "scope": map[string]any{"regions": []string{"YYZ"}, "events": []string{"activity"}, "bbox": []float64{-80, 43, -79, 44}}},
		{"v": 1, "type": "unsubscribe"},
	}
	for i, message := range clientMessages {
		t.Run(fmt.Sprintf("client-%d", i), func(t *testing.T) {
			assertMatchesPublicSchema(t, schema, "WebSocketClientMessage", message)
		})
	}
}

func registeredPublicGETRoutes(t *testing.T) []string {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), "routes.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	set := map[string]struct{}{}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) == 0 {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "HandleFunc" {
			return true
		}
		literal, ok := call.Args[0].(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		pattern, err := strconv.Unquote(literal.Value)
		if err != nil || !strings.HasPrefix(pattern, "GET ") {
			return true
		}
		path := strings.TrimPrefix(pattern, "GET ")
		if path == "/healthz" || path == "/readyz" || path == "/ws/public" || strings.HasPrefix(path, "/api/v1/public/") {
			set[path] = struct{}{}
		}
		return true
	})
	result := make([]string, 0, len(set))
	for path := range set {
		result = append(result, path)
	}
	sort.Strings(result)
	return result
}

func publicSchemas(t *testing.T, document map[string]any) map[string]any {
	t.Helper()
	components, ok := document["components"].(map[string]any)
	if !ok {
		t.Fatal("OpenAPI components missing")
	}
	schemas, ok := components["schemas"].(map[string]any)
	if !ok {
		t.Fatal("OpenAPI schemas missing")
	}
	return schemas
}

func assertMatchesPublicSchema(t *testing.T, document map[string]any, schemaName string, value any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if err := validatePublicSchema(document, map[string]any{"$ref": "#/components/schemas/" + schemaName}, decoded, "$", 0); err != nil {
		t.Fatalf("%s does not match %s: %v\npayload: %s", reflect.TypeOf(value), schemaName, err, encoded)
	}
}

func validatePublicSchema(document map[string]any, rawSchema any, value any, path string, depth int) error {
	if depth > 100 {
		return fmt.Errorf("%s schema recursion limit", path)
	}
	if allowed, ok := rawSchema.(bool); ok {
		if allowed {
			return nil
		}
		return fmt.Errorf("%s is forbidden", path)
	}
	schema, ok := rawSchema.(map[string]any)
	if !ok {
		return fmt.Errorf("%s invalid schema node %T", path, rawSchema)
	}
	if reference, ok := schema["$ref"].(string); ok {
		const prefix = "#/components/schemas/"
		if !strings.HasPrefix(reference, prefix) {
			return fmt.Errorf("%s unsupported reference %q", path, reference)
		}
		resolved, found := document["components"].(map[string]any)["schemas"].(map[string]any)[strings.TrimPrefix(reference, prefix)]
		if !found {
			return fmt.Errorf("%s unresolved reference %q", path, reference)
		}
		return validatePublicSchema(document, resolved, value, path, depth+1)
	}
	if variants, ok := schema["oneOf"].([]any); ok {
		matches := 0
		for _, variant := range variants {
			if validatePublicSchema(document, variant, value, path, depth+1) == nil {
				matches++
			}
		}
		if matches != 1 {
			return fmt.Errorf("%s matched %d oneOf variants", path, matches)
		}
	}
	if variants, ok := schema["allOf"].([]any); ok {
		for _, variant := range variants {
			if err := validatePublicSchema(document, variant, value, path, depth+1); err != nil {
				return err
			}
		}
	}
	if condition, ok := schema["if"].(map[string]any); ok && validatePublicSchema(document, condition, value, path, depth+1) == nil {
		if thenSchema, exists := schema["then"]; exists {
			if err := validatePublicSchema(document, thenSchema, value, path, depth+1); err != nil {
				return err
			}
		}
	}
	if forbidden, ok := schema["not"]; ok && validatePublicSchema(document, forbidden, value, path, depth+1) == nil {
		return fmt.Errorf("%s matches forbidden schema", path)
	}
	if constant, exists := schema["const"]; exists && !reflect.DeepEqual(constant, value) {
		return fmt.Errorf("%s = %v, want const %v", path, value, constant)
	}
	if values, ok := schema["enum"].([]any); ok {
		matched := false
		for _, candidate := range values {
			matched = matched || reflect.DeepEqual(candidate, value)
		}
		if !matched {
			return fmt.Errorf("%s = %v is not in enum", path, value)
		}
	}

	switch schema["type"] {
	case nil:
		return nil
	case "object":
		objectValue, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s is %T, want object", path, value)
		}
		properties, _ := schema["properties"].(map[string]any)
		if required, ok := schema["required"].([]any); ok {
			for _, item := range required {
				key := item.(string)
				if _, found := objectValue[key]; !found {
					return fmt.Errorf("%s.%s is required", path, key)
				}
			}
		}
		for key, child := range objectValue {
			if childSchema, found := properties[key]; found {
				if err := validatePublicSchema(document, childSchema, child, path+"."+key, depth+1); err != nil {
					return err
				}
				continue
			}
			switch additional := schema["additionalProperties"].(type) {
			case bool:
				if !additional {
					return fmt.Errorf("%s.%s is not declared", path, key)
				}
			case map[string]any:
				if err := validatePublicSchema(document, additional, child, path+"."+key, depth+1); err != nil {
					return err
				}
			}
		}
	case "array":
		items, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s is %T, want array", path, value)
		}
		if min, ok := schema["minItems"].(float64); ok && len(items) < int(min) {
			return fmt.Errorf("%s has %d items, want >= %d", path, len(items), int(min))
		}
		if max, ok := schema["maxItems"].(float64); ok && len(items) > int(max) {
			return fmt.Errorf("%s has %d items, want <= %d", path, len(items), int(max))
		}
		for index, item := range items {
			if err := validatePublicSchema(document, schema["items"], item, fmt.Sprintf("%s[%d]", path, index), depth+1); err != nil {
				return err
			}
		}
	case "string":
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("%s is %T, want string", path, value)
		}
		if pattern, ok := schema["pattern"].(string); ok && !regexp.MustCompile(pattern).MatchString(text) {
			return fmt.Errorf("%s does not match %s", path, pattern)
		}
	case "integer":
		numberValue, ok := value.(float64)
		if !ok || math.Trunc(numberValue) != numberValue {
			return fmt.Errorf("%s is %v, want integer", path, value)
		}
	case "number":
		if _, ok := value.(float64); !ok {
			return fmt.Errorf("%s is %T, want number", path, value)
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s is %T, want boolean", path, value)
		}
	default:
		return fmt.Errorf("%s has unsupported type %v", path, schema["type"])
	}
	return nil
}
