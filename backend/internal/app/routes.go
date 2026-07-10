package app

import (
	"net/http"

	"meshcore-canada-live-map/backend/internal/api"
	"meshcore-canada-live-map/backend/internal/solar"
)

func (a *Application) Routes() http.Handler {
	a.apiServer = &api.Server{
		Config: api.Config{
			RecentPacketLimit:         a.Config.RecentPacketLimit,
			RecentEdgeEventLimit:      a.Config.RecentEdgeEventLimit,
			DefaultCenterLat:          a.Config.DefaultCenterLat,
			DefaultCenterLng:          a.Config.DefaultCenterLng,
			DefaultZoom:               a.Config.DefaultZoom,
			DefaultRegion:             a.Config.DefaultRegion,
			MapRegionPreset:           a.Config.MapRegionPreset,
			MapBounds:                 a.Config.MapBounds,
			PublicMode:                a.Config.PublicMode,
			StrictRFOnly:              a.Config.StrictRFOnly,
			MaxUnverifiedEdgeKM:       a.Config.MaxUnverifiedEdgeKM,
			AppVersion:                a.Config.AppVersion,
			GitSHA:                    a.Config.GitSHA,
			BuildTime:                 a.Config.BuildTime,
			PublicIATARestricted:      a.PublicCache.RestrictsIATA(),
			PublicRegionRestricted:    a.PublicCache.RestrictsIATA(),
			PublicIATAs:               a.Config.PublicIATAs,
			TrustProxyHeaders:         a.Config.TrustProxyHeaders,
			TrustedProxyCIDRs:         a.Config.TrustedProxyCIDRs,
			MetricsPublic:             a.Config.MetricsPublic,
			PublicEventsEnabled:       a.Config.PublicEventsEnabled,
			PublicViewportEnabled:     a.Config.PublicViewportEnabled,
			PublicNOCEnabled:          a.Config.PublicNOCEnabled,
			PublicCoverageEnabled:     a.Config.PublicCoverageEnabled,
			PublicLOSEnabled:          a.Config.PublicLOSEnabled,
			PublicSchemaEnabled:       a.Config.PublicSchemaEnabled,
			PublicIntegrationsEnabled: a.Config.PublicIntegrationsEnabled,
			UnboundedRetention:        a.Config.PublicMode && a.Config.DataRetentionDays < 0,
		},
		Store:                 a.Store,
		Hub:                   a.Hub,
		PublicHub:             a.PublicHub,
		Runtime:               a.Runtime,
		Log:                   a.Log,
		MQTTConnected:         a.MQTT.Connected,
		MQTTTotal:             a.MQTT.TotalMessages,
		MQTTStatus:            a.MQTT.Status,
		PublicState:           a.PublicCache.Snapshot,
		PublicStateSerialized: a.PublicCache.Serialized,
		PublicCacheStatus:     a.PublicCache.Status,
		PublicAllowsIATA:      a.PublicCache.AllowsIATA,
		SolarConditions:       func() *solar.Conditions { return a.solarSnapshot.Load() },
	}
	return a.apiServer.Routes()
}
