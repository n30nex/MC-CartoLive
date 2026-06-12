package propagation

import (
	"math"
	"strconv"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/solar"
)

const (
	ClassificationLongDistance  = "long_distance_event"
	ClassificationTropoPossible = "tropo_possible"
)

type Classifier struct {
	MinDistanceKM float64
}

func (c Classifier) Classify(packet live.PublicPacketPath, weather *WeatherSample, solarConditions *solar.Conditions, burstCount int, now time.Time) (live.PublicPropagationEvent, bool) {
	minDistance := c.MinDistanceKM
	if minDistance <= 0 {
		minDistance = 75
	}
	if packet.DistanceKM < minDistance || len(packet.Segments) == 0 || packet.At <= 0 {
		return live.PublicPropagationEvent{}, false
	}
	score := 0.28
	reasons := []string{distanceReason(packet.DistanceKM)}
	if packet.DistanceKM >= minDistance*1.75 {
		score += 0.16
		reasons = append(reasons, "very long verified RF path")
	} else if packet.DistanceKM >= minDistance*1.25 {
		score += 0.09
	}
	if burstCount >= 6 {
		score += 0.18
		reasons = append(reasons, "repeated route burst in the last hour")
	} else if burstCount >= 3 {
		score += 0.11
		reasons = append(reasons, "multiple matching route events nearby")
	}
	if weather != nil {
		score += scoreWeather(weather, packet, now, &reasons)
	} else {
		reasons = append(reasons, "weather model unavailable")
	}
	if solarConditions != nil && solarConditions.FetchedAt > 0 {
		if solarConditions.KpIndex >= 5 {
			reasons = append(reasons, "geomagnetic storm context noted")
		}
		if solarConditions.SolarFluxSFU >= 150 {
			reasons = append(reasons, "elevated solar flux context noted")
		}
	}
	if score > 1 {
		score = 1
	}
	score = math.Round(score*100) / 100
	classification := ClassificationLongDistance
	confidence := "low"
	if score >= 0.62 && weather != nil && weatherEvidenceCount(reasons) >= 2 {
		classification = ClassificationTropoPossible
		confidence = "medium"
	} else if score >= 0.72 {
		confidence = "medium"
	}
	event := live.PublicPropagationEvent{
		ID:             PropagationEventID(packet),
		At:             packet.At,
		Classification: classification,
		Confidence:     confidence,
		Score:          score,
		DistanceKM:     math.Round(packet.DistanceKM*10) / 10,
		Region:         strings.ToUpper(strings.TrimSpace(firstNonEmpty(packet.Region, packet.IATA))),
		RouteIDs:       append([]string{}, packet.RouteIDs...),
		EndpointLabels: append([]string{}, packet.EndpointLabels...),
		Segments:       append([]live.PublicRouteSegment{}, packet.Segments...),
		Reasons:        uniqueReasons(reasons),
		ReplayWindow: live.PublicPropagationReplayWindow{
			From: maxInt64(0, packet.At-10*60_000),
			To:   packet.At + 10*60_000,
		},
	}
	if weather != nil {
		summary := weather.Summary
		event.Weather = &summary
	}
	if solarConditions != nil && solarConditions.FetchedAt > 0 {
		event.Solar = &live.PublicPropagationSolarSummary{
			KpIndex:        solarConditions.KpIndex,
			KpLabel:        solarConditions.KpLabel,
			SolarFluxSfu:   solarConditions.SolarFluxSFU,
			SolarFluxLabel: solarConditions.SolarFluxLabel,
			GeomagActivity: solarConditions.GeomagActivity,
			FetchedAt:      solarConditions.FetchedAt,
		}
	}
	return event, true
}

func PropagationEventID(packet live.PublicPacketPath) string {
	id := strings.TrimSpace(packet.ID)
	id = strings.TrimPrefix(id, "pulse-")
	if id == "" {
		id = strconv.FormatInt(packet.At, 10)
	}
	return "prop-" + id
}

func RouteMidpoint(packet live.PublicPacketPath) (float64, float64, bool) {
	var latSum, lngSum, weightSum float64
	for _, segment := range packet.Segments {
		weight := segment.DistanceKM
		if weight <= 0 {
			weight = 1
		}
		latSum += ((segment.From.Lat + segment.To.Lat) / 2) * weight
		lngSum += ((segment.From.Lng + segment.To.Lng) / 2) * weight
		weightSum += weight
	}
	if weightSum <= 0 {
		return 0, 0, false
	}
	return latSum / weightSum, lngSum / weightSum, true
}

func scoreWeather(weather *WeatherSample, packet live.PublicPacketPath, now time.Time, reasons *[]string) float64 {
	var score float64
	summary := weather.Summary
	if summary.PressureHPa >= 1024 {
		score += 0.15
		*reasons = append(*reasons, "strong high pressure near route")
	} else if summary.PressureHPa >= 1018 {
		score += 0.09
		*reasons = append(*reasons, "high pressure near route")
	}
	spread := summary.TemperatureC - summary.DewPointC
	if spread >= 0 && spread <= 2.5 {
		score += 0.12
		*reasons = append(*reasons, "humid air with low temperature-dewpoint spread")
	} else if spread > 0 && spread <= 5 {
		score += 0.07
		*reasons = append(*reasons, "moderately humid surface layer")
	}
	if summary.RelativeHumidityPct >= 88 {
		score += 0.08
		*reasons = append(*reasons, "very high relative humidity")
	} else if summary.RelativeHumidityPct >= 75 {
		score += 0.04
	}
	switch summary.InversionProxy {
	case "inversion":
		score += 0.18
		*reasons = append(*reasons, "temperature inversion proxy present")
	case "stable_layer":
		score += 0.13
		*reasons = append(*reasons, "stable low-level layer proxy present")
	case "weak_lapse":
		score += 0.06
	}
	if summary.WindSpeedKmh > 0 && summary.WindSpeedKmh <= 10 {
		score += 0.06
		*reasons = append(*reasons, "light surface wind")
	} else if summary.WindSpeedKmh > 0 && summary.WindSpeedKmh <= 18 {
		score += 0.03
	}
	if summary.CloudCoverPct <= 35 && summary.CloudCoverPct >= 0 {
		score += 0.03
		*reasons = append(*reasons, "clear or partly clear sky")
	}
	if summary.VisibilityM > 0 && summary.VisibilityM <= 8000 && summary.RelativeHumidityPct >= 80 {
		score += 0.06
		*reasons = append(*reasons, "haze or fog proxy present")
	}
	if localNightOrShoulder(packet.At, packet.Segments) {
		score += 0.07
		*reasons = append(*reasons, "night or sunrise timing")
	}
	if summary.SampleTime > 0 {
		age := now.UnixMilli() - summary.SampleTime
		if age < 0 {
			age = -age
		}
		if age <= int64(2*time.Hour/time.Millisecond) {
			score += 0.04
		} else {
			*reasons = append(*reasons, "weather sample is stale")
		}
	}
	return score
}

func weatherEvidenceCount(reasons []string) int {
	count := 0
	for _, reason := range reasons {
		switch reason {
		case "strong high pressure near route",
			"high pressure near route",
			"humid air with low temperature-dewpoint spread",
			"moderately humid surface layer",
			"very high relative humidity",
			"temperature inversion proxy present",
			"stable low-level layer proxy present",
			"light surface wind",
			"clear or partly clear sky",
			"haze or fog proxy present",
			"night or sunrise timing":
			count++
		}
	}
	return count
}

func localNightOrShoulder(at int64, segments []live.PublicRouteSegment) bool {
	if at <= 0 {
		return false
	}
	lng := 0.0
	points := 0
	for _, segment := range segments {
		lng += segment.From.Lng + segment.To.Lng
		points += 2
	}
	if points > 0 {
		lng /= float64(points)
	}
	offsetHours := int(math.Round(lng / 15))
	local := time.UnixMilli(at).UTC().Add(time.Duration(offsetHours) * time.Hour)
	hour := local.Hour()
	return hour >= 20 || hour <= 8
}

func distanceReason(distanceKM float64) string {
	return "verified RF path " + strconv.FormatFloat(math.Round(distanceKM), 'f', 0, 64) + " km"
}

func uniqueReasons(reasons []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		reason = strings.TrimSpace(reason)
		if reason == "" {
			continue
		}
		if _, ok := seen[reason]; ok {
			continue
		}
		seen[reason] = struct{}{}
		out = append(out, reason)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
