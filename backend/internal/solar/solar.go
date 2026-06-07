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
	kpURL        = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
	fluxURL      = "https://services.swpc.noaa.gov/json/f107_cm_flux.json"
	fetchTimeout = 15 * time.Second
)

type Conditions struct {
	ServerTime      int64   `json:"serverTime"`
	KpIndex         float64 `json:"kpIndex"`
	KpLabel         string  `json:"kpLabel"`
	SolarFluxSFU    float64 `json:"solarFluxSfu"`
	SolarFluxLabel  string  `json:"solarFluxLabel"`
	GeomagActivity  string  `json:"geomagActivity"`
	FetchedAt       int64   `json:"fetchedAt"`
}

type Fetcher struct {
	log    *slog.Logger
	client *http.Client
}

func NewFetcher(log *slog.Logger) *Fetcher {
	return &Fetcher{log: log, client: &http.Client{Timeout: fetchTimeout}}
}

func (f *Fetcher) Fetch(ctx context.Context) (Conditions, error) {
	now := time.Now().UnixMilli()
	cond := Conditions{ServerTime: now, FetchedAt: now}
	var kpErr, fluxErr error

	kp, kpErr := f.fetchKp(ctx)
	if kpErr == nil {
		cond.KpIndex = kp
		cond.KpLabel = kpLabel(kp)
		cond.GeomagActivity = geomagLabel(kp)
	} else {
		f.log.Debug("solar kp fetch failed", "error", kpErr)
	}

	flux, fluxErr := f.fetchFlux(ctx)
	if fluxErr == nil {
		cond.SolarFluxSFU = flux
		cond.SolarFluxLabel = fluxLabel(flux)
	} else {
		f.log.Debug("solar flux fetch failed", "error", fluxErr)
	}

	if kpErr != nil && fluxErr != nil {
		return cond, fmt.Errorf("solar: all sources failed")
	}
	return cond, nil
}

func (f *Fetcher) fetchKp(ctx context.Context) (float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, kpURL, nil)
	if err != nil {
		return 0, err
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}
	var rows [][]any
	if err := json.Unmarshal(body, &rows); err != nil {
		return 0, err
	}
	if len(rows) < 2 {
		return 0, fmt.Errorf("kp: too few rows")
	}
	var kp float64
	for i := len(rows) - 1; i >= 1; i-- {
		if len(rows[i]) < 3 {
			continue
		}
		v := toFloat(rows[i][1])
		if v > 0 {
			kp = v
			break
		}
	}
	if kp <= 0 {
		return 0, fmt.Errorf("kp: no valid value")
	}
	return math.Round(kp*10) / 10, nil
}

func (f *Fetcher) fetchFlux(ctx context.Context) (float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fluxURL, nil)
	if err != nil {
		return 0, err
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}
	var data struct {
		Flux float64 `json:"flux"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return 0, err
	}
	if data.Flux <= 0 {
		return 0, fmt.Errorf("flux: zero value")
	}
	return math.Round(data.Flux*10) / 10, nil
}

func kpLabel(kp float64) string {
	switch {
	case kp <= 3:
		return "quiet"
	case kp <= 4:
		return "active"
	case kp <= 5:
		return "storm"
	case kp <= 7:
		return "major_storm"
	default:
		return "severe"
	}
}

func fluxLabel(sfu float64) string {
	switch {
	case sfu <= 100:
		return "low"
	case sfu <= 150:
		return "moderate"
	case sfu <= 200:
		return "high"
	default:
		return "very_high"
	}
}

func geomagLabel(kp float64) string {
	switch {
	case kp <= 3:
		return "quiet"
	case kp <= 4:
		return "unsettled"
	case kp <= 5:
		return "active"
	case kp <= 6:
		return "storm"
	default:
		return "major_storm"
	}
}

func toFloat(v any) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case string:
		var f float64
		fmt.Sscanf(val, "%f", &f)
		return f
	}
	return 0
}
