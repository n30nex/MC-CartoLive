package solar

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"time"
)

const (
	kpURL   = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
	fluxURL = "https://services.swpc.noaa.gov/json/f107_cm_flux.json"
	timeout = 15 * time.Second
)

type Conditions struct {
	ServerTime     int64   `json:"serverTime"`
	KpIndex        float64 `json:"kpIndex"`
	KpLabel        string  `json:"kpLabel"`
	SolarFluxSFU   float64 `json:"solarFluxSfu"`
	SolarFluxLabel string  `json:"solarFluxLabel"`
	GeomagActivity string  `json:"geomagActivity"`
	FetchedAt      int64   `json:"fetchedAt"`
}

type Fetcher struct {
	log    *slog.Logger
	client *http.Client
}

func NewFetcher(log *slog.Logger) *Fetcher {
	return &Fetcher{log: log, client: &http.Client{Timeout: timeout}}
}

func (f *Fetcher) Fetch(ctx context.Context) (Conditions, error) {
	now := time.Now().UnixMilli()
	c := Conditions{ServerTime: now, FetchedAt: now}

	if kp, err := f.fetchKp(ctx); err == nil {
		c.KpIndex = kp
		c.KpLabel = kpLabel(kp)
		c.GeomagActivity = geomagLabel(kp)
	} else {
		f.log.Warn("solar kp failed", "error", err)
	}

	if flux, err := f.fetchFlux(ctx); err == nil {
		c.SolarFluxSFU = flux
		c.SolarFluxLabel = fluxLabel(flux)
	} else {
		f.log.Warn("solar flux failed", "error", err)
	}

	f.log.Info("solar fetch", "kp", c.KpIndex, "flux", c.SolarFluxSFU)

	return c, nil
}

func (f *Fetcher) fetchKp(ctx context.Context) (float64, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, kpURL, nil)
	resp, err := f.client.Do(req)
	if err != nil { return 0, err }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var rows [][]any
	if err := json.Unmarshal(body, &rows); err != nil { return 0, fmt.Errorf("kp parse: %w", err) }
	if len(rows) < 2 { return 0, fmt.Errorf("kp empty: %d rows", len(rows)) }
	for i := len(rows) - 1; i >= 1; i-- {
		if len(rows[i]) < 3 { continue }
		if v := toFloat(rows[i][1]); v > 0 { return math.Round(v*10) / 10, nil }
	}
	return 0, fmt.Errorf("kp no value in %d data rows", len(rows)-1)
}

func (f *Fetcher) fetchFlux(ctx context.Context) (float64, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, fluxURL, nil)
	resp, err := f.client.Do(req)
	if err != nil { return 0, err }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var arr []struct{ Flux float64 `json:"flux"` }
	if err := json.Unmarshal(body, &arr); err == nil && len(arr) > 0 && arr[0].Flux > 0 {
		return math.Round(arr[0].Flux*10) / 10, nil
	}
	var obj struct{ Flux float64 `json:"flux"` }
	if err := json.Unmarshal(body, &obj); err == nil && obj.Flux > 0 {
		return math.Round(obj.Flux*10) / 10, nil
	}
	return 0, fmt.Errorf("zero flux")
}

func kpLabel(kp float64) string {
	switch { case kp <= 3: return "quiet"; case kp <= 4: return "active"; case kp <= 5: return "storm"; case kp <= 7: return "major"; default: return "severe" }
}
func fluxLabel(sfu float64) string {
	switch { case sfu <= 100: return "low"; case sfu <= 150: return "moderate"; case sfu <= 200: return "high"; default: return "very_high" }
}
func geomagLabel(kp float64) string {
	switch { case kp <= 3: return "quiet"; case kp <= 4: return "unsettled"; case kp <= 5: return "active"; default: return "storm" }
}
func toFloat(v any) float64 {
	switch val := v.(type) {
	case float64: return val
	case float32: return float64(val)
	case int: return float64(val)
	case int64: return float64(val)
	case string:
		var f float64
		if _, err := fmt.Sscanf(val, "%f", &f); err == nil { return f }
	}
	return 0
}
