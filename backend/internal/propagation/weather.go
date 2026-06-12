package propagation

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

const (
	defaultOpenMeteoBaseURL = "https://api.open-meteo.com/v1/gfs"
	openMeteoTimeout        = 12 * time.Second
)

type WeatherSample struct {
	Latitude               float64
	Longitude              float64
	WindDirectionDeg       float64
	Temperature950HPaC     *float64
	DewPoint950HPaC        *float64
	RelativeHumidity950HPa *float64
	Summary                live.PublicPropagationWeatherSummary
}

type WeatherFetcher struct {
	log     *slog.Logger
	client  *http.Client
	baseURL string
}

func NewWeatherFetcher(log *slog.Logger) *WeatherFetcher {
	return &WeatherFetcher{
		log:     log,
		client:  &http.Client{Timeout: openMeteoTimeout},
		baseURL: defaultOpenMeteoBaseURL,
	}
}

func (f *WeatherFetcher) Fetch(ctx context.Context, lat float64, lng float64) (WeatherSample, error) {
	if f == nil {
		f = NewWeatherFetcher(nil)
	}
	client := f.client
	if client == nil {
		client = &http.Client{Timeout: openMeteoTimeout}
	}
	baseURL := strings.TrimSpace(f.baseURL)
	if baseURL == "" {
		baseURL = defaultOpenMeteoBaseURL
	}
	endpoint, err := url.Parse(baseURL)
	if err != nil {
		return WeatherSample{}, err
	}
	query := endpoint.Query()
	query.Set("latitude", strconv.FormatFloat(lat, 'f', 5, 64))
	query.Set("longitude", strconv.FormatFloat(lng, 'f', 5, 64))
	query.Set("timeformat", "unixtime")
	query.Set("timezone", "GMT")
	query.Set("past_hours", "3")
	query.Set("forecast_hours", "2")
	query.Set("wind_speed_unit", "kmh")
	query.Set("hourly", strings.Join([]string{
		"temperature_2m",
		"dew_point_2m",
		"relative_humidity_2m",
		"surface_pressure",
		"pressure_msl",
		"cloud_cover",
		"visibility",
		"wind_speed_10m",
		"wind_direction_10m",
		"temperature_950hPa",
		"dew_point_950hPa",
		"relative_humidity_950hPa",
	}, ","))
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return WeatherSample{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return WeatherSample{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return WeatherSample{}, fmt.Errorf("open-meteo: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return WeatherSample{}, err
	}
	sample, err := parseOpenMeteo(body, time.Now())
	if err != nil {
		return WeatherSample{}, err
	}
	if sample.Latitude == 0 {
		sample.Latitude = lat
	}
	if sample.Longitude == 0 {
		sample.Longitude = lng
	}
	if f.log != nil {
		f.log.Debug("propagation weather fetch", "lat", lat, "lng", lng, "sampleTime", sample.Summary.SampleTime)
	}
	return sample, nil
}

func parseOpenMeteo(body []byte, now time.Time) (WeatherSample, error) {
	var response struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Hourly    struct {
			Time                   []int64   `json:"time"`
			Temperature2M          []float64 `json:"temperature_2m"`
			DewPoint2M             []float64 `json:"dew_point_2m"`
			RelativeHumidity2M     []float64 `json:"relative_humidity_2m"`
			SurfacePressure        []float64 `json:"surface_pressure"`
			PressureMSL            []float64 `json:"pressure_msl"`
			CloudCover             []float64 `json:"cloud_cover"`
			Visibility             []float64 `json:"visibility"`
			WindSpeed10M           []float64 `json:"wind_speed_10m"`
			WindDirection10M       []float64 `json:"wind_direction_10m"`
			Temperature950HPa      []float64 `json:"temperature_950hPa"`
			DewPoint950HPa         []float64 `json:"dew_point_950hPa"`
			RelativeHumidity950HPa []float64 `json:"relative_humidity_950hPa"`
		} `json:"hourly"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return WeatherSample{}, err
	}
	if len(response.Hourly.Time) == 0 {
		return WeatherSample{}, fmt.Errorf("open-meteo: no hourly samples")
	}
	index := nearestWeatherIndex(response.Hourly.Time, now.Unix())
	sampleTime := response.Hourly.Time[index] * 1000
	pressure := valueAt(response.Hourly.SurfacePressure, index)
	if pressure <= 0 {
		pressure = valueAt(response.Hourly.PressureMSL, index)
	}
	temp950 := optionalValueAt(response.Hourly.Temperature950HPa, index)
	dew950 := optionalValueAt(response.Hourly.DewPoint950HPa, index)
	rh950 := optionalValueAt(response.Hourly.RelativeHumidity950HPa, index)
	inversionProxy := inversionProxy(valueAt(response.Hourly.Temperature2M, index), temp950)
	return WeatherSample{
		Latitude:               response.Latitude,
		Longitude:              response.Longitude,
		WindDirectionDeg:       valueAt(response.Hourly.WindDirection10M, index),
		Temperature950HPaC:     temp950,
		DewPoint950HPaC:        dew950,
		RelativeHumidity950HPa: rh950,
		Summary: live.PublicPropagationWeatherSummary{
			Source:              "open-meteo-gfs-hrrr",
			Model:               "best_match",
			SampleTime:          sampleTime,
			FetchedAt:           now.UnixMilli(),
			TemperatureC:        round1(valueAt(response.Hourly.Temperature2M, index)),
			DewPointC:           round1(valueAt(response.Hourly.DewPoint2M, index)),
			RelativeHumidityPct: round1(valueAt(response.Hourly.RelativeHumidity2M, index)),
			PressureHPa:         round1(pressure),
			CloudCoverPct:       round1(valueAt(response.Hourly.CloudCover, index)),
			VisibilityM:         round1(valueAt(response.Hourly.Visibility, index)),
			WindSpeedKmh:        round1(valueAt(response.Hourly.WindSpeed10M, index)),
			InversionProxy:      inversionProxy,
		},
	}, nil
}

func nearestWeatherIndex(times []int64, now int64) int {
	best := 0
	bestDelta := int64(math.MaxInt64)
	for i, t := range times {
		delta := t - now
		if delta < 0 {
			delta = -delta
		}
		if delta < bestDelta {
			best = i
			bestDelta = delta
		}
	}
	return best
}

func valueAt(values []float64, index int) float64 {
	if index < 0 || index >= len(values) {
		return 0
	}
	value := values[index]
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return value
}

func optionalValueAt(values []float64, index int) *float64 {
	if index < 0 || index >= len(values) {
		return nil
	}
	value := values[index]
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return nil
	}
	return &value
}

func inversionProxy(surfaceTempC float64, temp950 *float64) string {
	if temp950 == nil {
		return "surface_only"
	}
	delta := surfaceTempC - *temp950
	switch {
	case delta <= 0:
		return "inversion"
	case delta <= 1.8:
		return "stable_layer"
	case delta <= 3.5:
		return "weak_lapse"
	default:
		return "normal_lapse"
	}
}

func round1(value float64) float64 {
	return math.Round(value*10) / 10
}
