package app

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"time"

	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
)

type fixtureLine struct {
	Topic      string          `json:"topic"`
	Payload    json.RawMessage `json:"payload"`
	ReceivedAt int64           `json:"receivedAt"`
}

func (a *Application) replayFixture(ctx context.Context, path string) {
	if delay := time.Duration(max(a.Config.FixtureReplayStartDelayMs, 0)) * time.Millisecond; delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
	f, err := os.Open(path)
	if err != nil {
		a.Log.Warn("fixture replay open failed", "path", path, "error", err)
		return
	}
	defer f.Close()
	interval := 150 * time.Millisecond
	if rate := a.Config.FixtureReplayRatePerSecond; rate > 0 {
		interval = time.Second / time.Duration(rate)
		if interval < time.Millisecond {
			interval = time.Millisecond
		}
	}
	scanner := bufio.NewScanner(f)
	var replayStarted time.Time
	emitted := 0
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}
		var line fixtureLine
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			a.Log.Debug("fixture line invalid", "error", err)
			continue
		}
		received := time.Now()
		if line.ReceivedAt > 0 {
			received = time.UnixMilli(line.ReceivedAt)
		}
		msg, err := imqtt.Normalize(line.Topic, line.Payload, received)
		if err != nil {
			a.Log.Debug("fixture normalize failed", "error", err)
			continue
		}
		if replayStarted.IsZero() {
			replayStarted = time.Now()
		} else if wait := time.Until(replayStarted.Add(time.Duration(emitted) * interval)); wait > 0 {
			timer := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
		a.MQTT.SubmitNormalized(msg)
		emitted++
	}
	if err := scanner.Err(); err != nil {
		a.Log.Warn("fixture replay read failed", "path", path, "error", err)
	}
}
