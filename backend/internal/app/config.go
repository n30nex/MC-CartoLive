package app

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"meshcore-canada-live-map/backend/internal/live"
)

type Config struct {
	ListenAddr                      string
	MetricsListenAddr               string
	AppVersion                      string
	GitSHA                          string
	BuildTime                       string
	PublicBaseURL                   string
	DataDir                         string
	DBPath                          string
	LogLevel                        string
	MQTTEnabled                     bool
	MQTTBrokerURL                   string
	MQTTTopic                       string
	MQTTClientID                    string
	AuthMode                        string
	MQTTUsername                    string
	MQTTPassword                    string
	MeshcorePublicKey               string
	MeshcorePrivateKey              string
	MeshcoreChannelSecrets          []string
	MQTTTokenAudience               string
	StrictRFOnly                    bool
	RequireRSSIOrSNRForEdge         bool
	MaxUnverifiedEdgeKM             float64
	AllowLongTraceEdges             bool
	DefaultCenterLat                float64
	DefaultCenterLng                float64
	DefaultZoom                     float64
	DefaultRegion                   string
	MapRegionPreset                 string
	MapBounds                       live.CoordinateBounds
	PublicMode                      bool
	RecentPacketLimit               int
	RecentEdgeEventLimit            int
	WSClientQueueSize               int
	MQTTIngestQueueSize             int
	DerivedIngestQueueSize          int
	PublicIATAs                     []string
	PublicRegions                   []string
	PublicCacheRefreshSec           int
	PublicPacketPathBackfillEnabled bool
	PublicPacketPathBackfillBatch   int
	PublicPacketPathBackfillHours   int
	PublicEventsEnabled             bool
	PublicWSResumeEnabled           bool
	PublicWSSubscriptionsEnabled    bool
	PublicViewportEnabled           bool
	PublicNOCEnabled                bool
	PublicCoverageEnabled           bool
	PublicLOSEnabled                bool
	PublicSchemaEnabled             bool
	PublicIntegrationsEnabled       bool
	PropagationEnabled              bool
	PropagationMinDistanceKM        float64
	PropagationFetchIntervalSec     int
	PropagationEventRetentionDays   int
	PublicEventRetentionHours       int
	AllowUnboundedRetention         bool
	TrustProxyHeaders               bool
	TrustedProxyCIDRs               []string
	MetricsPublic                   bool
	ConfigYAML                      string
	FixtureReplayPath               string
	FixtureRecordEnabled            bool
	DataRetentionDays               int // 0 = default 7 days; negative requires an explicit non-production override
}

func LoadConfig() (Config, error) {
	if err := loadDotEnv(".env"); err != nil {
		slog.Debug("loadDotEnv failed", "path", ".env", "error", err)
	}
	mapPreset := configuredMapRegionPreset()
	mapBounds := mapBoundsForPreset(mapPreset)
	if parsed, ok := envMapBounds("MAP_BOUNDS"); ok {
		mapBounds = parsed
		mapPreset = "custom"
	}
	defaultCenterLat, defaultCenterLng, defaultZoom, defaultRegion := mapDefaultsForPreset(mapPreset, mapBounds)
	publicRegions := configuredPublicRegions(mapPreset)
	cfg := Config{
		ListenAddr:                      envString("LISTEN_ADDR", ":8080"),
		MetricsListenAddr:               envString("METRICS_LISTEN_ADDR", "127.0.0.1:9090"),
		AppVersion:                      BuildVersion,
		GitSHA:                          BuildGitSHA,
		BuildTime:                       BuildTime,
		PublicBaseURL:                   envString("PUBLIC_BASE_URL", "http://localhost:8080"),
		DataDir:                         envString("DATA_DIR", "./data"),
		DBPath:                          envString("DB_PATH", "./data/meshcore-live.db"),
		LogLevel:                        envString("LOG_LEVEL", "info"),
		MQTTEnabled:                     envBool("MQTT_ENABLED", true),
		MQTTBrokerURL:                   envString("MQTT_BROKER_URL", "wss://mqtt1.meshcore.ca:443/mqtt"),
		MQTTTopic:                       envString("MQTT_TOPIC", "meshcore/#"),
		MQTTClientID:                    envString("MQTT_CLIENT_ID", "meshcore-canada-live-map-local"),
		AuthMode:                        envString("MESHCORE_AUTH_MODE", "subscriber"),
		MQTTUsername:                    os.Getenv("MQTT_USERNAME"),
		MQTTPassword:                    os.Getenv("MQTT_PASSWORD"),
		MeshcorePublicKey:               os.Getenv("MESHCORE_PUBLIC_KEY_HEX"),
		MeshcorePrivateKey:              os.Getenv("MESHCORE_PRIVATE_KEY_HEX"),
		MeshcoreChannelSecrets:          envList("MESHCORE_CHANNEL_SECRETS"),
		MQTTTokenAudience:               envString("MQTT_TOKEN_AUDIENCE", "mqtt1.meshcore.ca"),
		StrictRFOnly:                    envBool("STRICT_RF_ONLY", true),
		RequireRSSIOrSNRForEdge:         envBool("REQUIRE_RSSI_OR_SNR_FOR_EDGE", true),
		MaxUnverifiedEdgeKM:             envFloat("MAX_UNVERIFIED_EDGE_KM", 150),
		AllowLongTraceEdges:             envBool("ALLOW_LONG_TRACE_EDGES", true),
		DefaultCenterLat:                envFloat("DEFAULT_CENTER_LAT", defaultCenterLat),
		DefaultCenterLng:                envFloat("DEFAULT_CENTER_LNG", defaultCenterLng),
		DefaultZoom:                     envFloat("DEFAULT_ZOOM", defaultZoom),
		DefaultRegion:                   envString("DEFAULT_REGION", defaultRegion),
		MapRegionPreset:                 mapPreset,
		MapBounds:                       mapBounds,
		PublicMode:                      envBool("PUBLIC_MODE", true),
		RecentPacketLimit:               envInt("RECENT_PACKET_LIMIT", 1000),
		RecentEdgeEventLimit:            envInt("RECENT_EDGE_EVENT_LIMIT", 2000),
		WSClientQueueSize:               envInt("WS_CLIENT_QUEUE_SIZE", 512),
		MQTTIngestQueueSize:             envInt("MQTT_INGEST_QUEUE_SIZE", 4096),
		DerivedIngestQueueSize:          envInt("DERIVED_INGEST_QUEUE_SIZE", 1024),
		PublicIATAs:                     publicRegions,
		PublicRegions:                   append([]string{}, publicRegions...),
		PublicCacheRefreshSec:           envInt("PUBLIC_CACHE_REFRESH_SECONDS", 10),
		PublicPacketPathBackfillEnabled: envBool("PUBLIC_PACKET_PATH_BACKFILL_ENABLED", true),
		PublicPacketPathBackfillBatch:   envInt("PUBLIC_PACKET_PATH_BACKFILL_BATCH", 500),
		PublicPacketPathBackfillHours:   envInt("PUBLIC_PACKET_PATH_BACKFILL_HOURS", 24),
		PublicEventsEnabled:             envBool("PUBLIC_EVENTS_ENABLED", true),
		PublicWSResumeEnabled:           envBool("PUBLIC_WS_RESUME_ENABLED", true),
		PublicWSSubscriptionsEnabled:    envBool("PUBLIC_WS_SUBSCRIPTIONS_ENABLED", false),
		PublicViewportEnabled:           envBool("PUBLIC_VIEWPORT_ENABLED", true),
		PublicNOCEnabled:                envBool("NOC_MODE_ENABLED", true),
		PublicCoverageEnabled:           envBool("COVERAGE_ENABLED", true),
		PublicLOSEnabled:                envBool("LOS_ENABLED", true),
		PublicSchemaEnabled:             envBool("PUBLIC_SCHEMA_ENABLED", true),
		PublicIntegrationsEnabled:       envBool("PUBLIC_INTEGRATIONS_ENABLED", true),
		PropagationEnabled:              envBool("PROPAGATION_ENABLED", true),
		PropagationMinDistanceKM:        envFloat("PROPAGATION_MIN_DISTANCE_KM", 75),
		PropagationFetchIntervalSec:     envInt("PROPAGATION_FETCH_INTERVAL_SECONDS", 900),
		PropagationEventRetentionDays:   envInt("PROPAGATION_EVENT_RETENTION_DAYS", 7),
		PublicEventRetentionHours:       envInt("PUBLIC_EVENT_RETENTION_HOURS", 24),
		AllowUnboundedRetention:         envBool("ALLOW_UNBOUNDED_RETENTION", false),
		TrustProxyHeaders:               envBool("TRUST_PROXY_HEADERS", false),
		TrustedProxyCIDRs:               envList("TRUSTED_PROXY_CIDRS"),
		MetricsPublic:                   envBool("METRICS_PUBLIC", false),
		ConfigYAML:                      envString("CONFIG_YAML", "./data/config.yaml"),
		FixtureReplayPath:               os.Getenv("FIXTURE_REPLAY_PATH"),
		FixtureRecordEnabled:            envBool("FIXTURE_RECORD_ENABLED", false),
		DataRetentionDays:               envInt("DATA_RETENTION_DAYS", 7),
	}
	if cfg.AuthMode == "subscriber" && cfg.MQTTEnabled && (cfg.MQTTUsername == "" || cfg.MQTTPassword == "") {
		return cfg, fmt.Errorf("MQTT subscriber auth requires MQTT_USERNAME and MQTT_PASSWORD or MQTT_ENABLED=false")
	}
	if cfg.PublicMode && cfg.DataRetentionDays < 0 && !cfg.AllowUnboundedRetention {
		return cfg, fmt.Errorf("negative DATA_RETENTION_DAYS is forbidden in PUBLIC_MODE unless ALLOW_UNBOUNDED_RETENTION=true")
	}
	return cfg, nil
}

func Logger(level string) *slog.Logger {
	var slogLevel slog.Level
	switch strings.ToLower(level) {
	case "debug":
		slogLevel = slog.LevelDebug
	case "warn":
		slogLevel = slog.LevelWarn
	case "error":
		slogLevel = slog.LevelError
	default:
		slogLevel = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slogLevel}))
}

func loadDotEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"`)
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
	return scanner.Err()
}

func envString(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envList(key string) []string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return nil
	}
	fields := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})
	out := make([]string, 0, len(fields))
	for _, field := range fields {
		if item := strings.TrimSpace(field); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func configuredPublicRegions(mapPreset string) []string {
	if regions := envList("PUBLIC_REGIONS"); len(regions) > 0 {
		return normalizeRegionList(regions)
	}
	if legacy := envList("PUBLIC_IATAS"); len(legacy) > 0 {
		return normalizeRegionList(legacy)
	}
	if mapPreset == "canada" {
		return defaultPublicIATAs()
	}
	return nil
}

func configuredMapRegionPreset() string {
	if raw, ok := os.LookupEnv("MAP_REGION_PRESET"); ok {
		if strings.TrimSpace(raw) != "" {
			return normalizeMapRegionPreset(raw)
		}
	}
	if len(envList("PUBLIC_REGIONS")) == 0 && len(envList("PUBLIC_IATAS")) > 0 {
		return "canada"
	}
	return "world"
}

func normalizeRegionList(items []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(items))
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
	return out
}

func normalizeMapRegionPreset(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "canada", "ca":
		return "canada"
	case "custom":
		return "custom"
	default:
		return "world"
	}
}

func mapBoundsForPreset(preset string) live.CoordinateBounds {
	if preset == "canada" {
		return live.CanadaCoordinateBounds()
	}
	return live.WorldCoordinateBounds()
}

func mapDefaultsForPreset(preset string, bounds live.CoordinateBounds) (float64, float64, float64, string) {
	if preset == "canada" {
		return 56.1304, -106.3468, 3.5, "CANADA"
	}
	return (bounds.MinLat + bounds.MaxLat) / 2, (bounds.MinLng + bounds.MaxLng) / 2, 1.8, strings.ToUpper(preset)
}

func envMapBounds(key string) (live.CoordinateBounds, bool) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return live.CoordinateBounds{}, false
	}
	fields := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\t' || r == '\n' || r == '\r'
	})
	if len(fields) != 4 {
		return live.CoordinateBounds{}, false
	}
	values := [4]float64{}
	for i, field := range fields {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(field), 64)
		if err != nil {
			return live.CoordinateBounds{}, false
		}
		values[i] = parsed
	}
	bounds := live.CoordinateBounds{MinLat: values[0], MinLng: values[1], MaxLat: values[2], MaxLng: values[3]}
	policy := live.NewCoordinatePolicy(bounds)
	return policy.Bounds, true
}

func defaultPublicIATAs() []string {
	return []string{
		"YYZ", "YTZ", "YOW", "YHM", "YKF", "YXU", "YOO", "YKZ", "YAM", "YQT", "YSB", "YTS", "YQG", "YYB", "YGK", "YPQ", "YTR", "YHD", "YPL", "YND",
		"YUL", "YMX", "YQB", "YBG", "YVO", "YHU", "YRJ", "YGL", "YSC", "YTQ", "YUY", "YZV", "YGP", "YRQ",
		"YVR", "YYJ", "YXX", "YLW", "YXS", "YPR", "YXT", "YQQ", "YCD", "YYD", "YDQ", "YXJ", "YYF", "YCG", "YKA", "YXC", "YBC",
		"YYC", "YEG", "YMM", "YQU", "YQL", "YXH",
		"YQR", "YXE", "YPA",
		"YWG", "YBR", "YTH", "YDN", "YPG",
		"YFC", "YSJ", "YQM", "ZBF",
		"YHZ", "YQY", "YQI",
		"YYG",
		"YYT", "YQX", "YDF", "YYR", "YWK",
		"YXY", "YZF", "YFB", "YEV", "YHY",
	}
}

func envBool(key string, fallback bool) bool {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		parsed, err := strconv.ParseBool(v)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		parsed, err := strconv.Atoi(v)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		parsed, err := strconv.ParseFloat(v, 64)
		if err == nil {
			return parsed
		}
	}
	return fallback
}
