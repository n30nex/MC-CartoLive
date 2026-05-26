package live

import (
	"fmt"
	"math"
	"strings"
	"sync"
)

type CoordinateBounds struct {
	MinLat float64 `json:"minLat"`
	MaxLat float64 `json:"maxLat"`
	MinLng float64 `json:"minLng"`
	MaxLng float64 `json:"maxLng"`
}

type CoordinatePolicy struct {
	Bounds CoordinateBounds `json:"bounds"`
}

var (
	coordinatePolicyMu sync.RWMutex
	coordinatePolicy   = NewCoordinatePolicy(WorldCoordinateBounds())
)

func WorldCoordinateBounds() CoordinateBounds {
	return CoordinateBounds{MinLat: -85, MaxLat: 85, MinLng: -180, MaxLng: 180}
}

func CanadaCoordinateBounds() CoordinateBounds {
	return CoordinateBounds{MinLat: 41, MaxLat: 84, MinLng: -142, MaxLng: -52}
}

func NewCoordinatePolicy(bounds CoordinateBounds) CoordinatePolicy {
	if !bounds.valid() {
		bounds = WorldCoordinateBounds()
	}
	return CoordinatePolicy{Bounds: bounds}
}

func CurrentCoordinatePolicy() CoordinatePolicy {
	coordinatePolicyMu.RLock()
	defer coordinatePolicyMu.RUnlock()
	return coordinatePolicy
}

func SetCoordinatePolicy(policy CoordinatePolicy) {
	policy = NewCoordinatePolicy(policy.Bounds)
	coordinatePolicyMu.Lock()
	coordinatePolicy = policy
	coordinatePolicyMu.Unlock()
}

func ValidPublicCoords(lat float64, lng float64) bool {
	return CurrentCoordinatePolicy().Valid(lat, lng)
}

func (p CoordinatePolicy) Valid(lat float64, lng float64) bool {
	return !math.IsNaN(lat) &&
		!math.IsNaN(lng) &&
		!math.IsInf(lat, 0) &&
		!math.IsInf(lng, 0) &&
		lat != 0 &&
		lng != 0 &&
		lat >= p.Bounds.MinLat &&
		lat <= p.Bounds.MaxLat &&
		lng >= p.Bounds.MinLng &&
		lng <= p.Bounds.MaxLng
}

func (p CoordinatePolicy) Inclusion(lat *float64, lng *float64, positionSource string) PublicMapInclusion {
	if lat == nil || lng == nil {
		return PublicMapInclusion{Reason: MapIncludeMissingCoords}
	}
	if *lat == 0 || *lng == 0 {
		return PublicMapInclusion{Reason: MapIncludeZeroCoords}
	}
	if !p.Valid(*lat, *lng) {
		return PublicMapInclusion{Reason: MapIncludeOutsideBounds}
	}
	return PublicMapInclusion{
		Mappable:       true,
		Reason:         MapIncludeMappable,
		PositionSource: strings.TrimSpace(positionSource),
	}
}

func (p CoordinatePolicy) SQL(latitudeColumn string, longitudeColumn string) string {
	return fmt.Sprintf(
		`%s IS NOT NULL AND %s IS NOT NULL AND %s != 0 AND %s != 0 AND %s BETWEEN %g AND %g AND %s BETWEEN %g AND %g`,
		latitudeColumn,
		longitudeColumn,
		latitudeColumn,
		longitudeColumn,
		latitudeColumn,
		p.Bounds.MinLat,
		p.Bounds.MaxLat,
		longitudeColumn,
		p.Bounds.MinLng,
		p.Bounds.MaxLng,
	)
}

func (b CoordinateBounds) valid() bool {
	return !math.IsNaN(b.MinLat) &&
		!math.IsNaN(b.MaxLat) &&
		!math.IsNaN(b.MinLng) &&
		!math.IsNaN(b.MaxLng) &&
		!math.IsInf(b.MinLat, 0) &&
		!math.IsInf(b.MaxLat, 0) &&
		!math.IsInf(b.MinLng, 0) &&
		!math.IsInf(b.MaxLng, 0) &&
		b.MinLat < b.MaxLat &&
		b.MinLng < b.MaxLng &&
		b.MinLat >= -90 &&
		b.MaxLat <= 90 &&
		b.MinLng >= -180 &&
		b.MaxLng <= 180
}
