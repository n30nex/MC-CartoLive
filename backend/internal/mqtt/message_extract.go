package mqtt

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const maxAcceptedTimestampSkew = 5 * time.Minute

type NormalizedMessage struct {
	IngestID     string         `json:"-"`
	Topic        string         `json:"topic"`
	TopicInfo    TopicInfo      `json:"topicInfo"`
	RawHex       string         `json:"rawHex,omitempty"`
	Payload      map[string]any `json:"payload,omitempty"`
	RawJSON      string         `json:"rawJson,omitempty"`
	ObserverName string         `json:"observerName,omitempty"`
	ObserverID   string         `json:"observerId,omitempty"`
	RSSI         *float64       `json:"rssi,omitempty"`
	SNR          *float64       `json:"snr,omitempty"`
	Score        *float64       `json:"score,omitempty"`
	HeardAtMs    int64          `json:"heardAt"`
}

func Normalize(topic string, payload []byte, receivedAt time.Time) (NormalizedMessage, error) {
	info, err := ParseTopic(topic)
	if err != nil {
		return NormalizedMessage{}, err
	}

	msg := NormalizedMessage{
		Topic:     topic,
		TopicInfo: info,
		HeardAtMs: receivedAt.UnixMilli(),
	}

	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 {
		return msg, nil
	}

	var object map[string]any
	if err := json.Unmarshal(trimmed, &object); err != nil {
		raw := strings.TrimSpace(string(trimmed))
		msg.RawHex = raw
		msg.RawJSON = strconv.Quote(raw)
		return msg, nil
	}

	msg.Payload = object
	if rawJSON, err := json.Marshal(object); err == nil {
		msg.RawJSON = string(rawJSON)
	}
	msg.RawHex = firstString(object, "raw", "packet", "packet_raw", "packetHex", "payloadHex", "payload_hex", "data", "raw_hex")
	msg.ObserverName = firstString(object, "origin", "observer", "observer_name", "name", "node_name")
	msg.ObserverID = firstString(object, "origin_id", "observer_id", "public_key", "pubkey")
	msg.RSSI = firstNumber(object, "RSSI", "rssi", "last_rssi")
	msg.SNR = firstNumber(object, "SNR", "snr", "last_snr")
	msg.Score = firstNumber(object, "score", "Score")
	if t := firstTime(object, "timestamp", "time", "received_at", "heard_at", "ts"); !t.IsZero() {
		msg.HeardAtMs = normalizedHeardAt(t, receivedAt).UnixMilli()
	}

	return msg, nil
}

func normalizedHeardAt(parsed time.Time, receivedAt time.Time) time.Time {
	if parsed.IsZero() {
		return receivedAt
	}
	if receivedAt.IsZero() {
		return parsed
	}
	if parsed.After(receivedAt.Add(maxAcceptedTimestampSkew)) || parsed.Before(receivedAt.Add(-maxAcceptedTimestampSkew)) {
		return receivedAt
	}
	return parsed
}

func firstString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			switch typed := v.(type) {
			case string:
				if strings.TrimSpace(typed) != "" {
					return strings.TrimSpace(typed)
				}
			case float64:
				return strconv.FormatFloat(typed, 'f', -1, 64)
			}
		}
	}
	return ""
}

func firstNumber(m map[string]any, keys ...string) *float64 {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			switch typed := v.(type) {
			case float64:
				return &typed
			case string:
				if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
					return &parsed
				}
			case int:
				f := float64(typed)
				return &f
			}
		}
	}
	return nil
}

func firstTime(m map[string]any, keys ...string) time.Time {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			switch typed := v.(type) {
			case string:
				s := strings.TrimSpace(typed)
				if s == "" {
					continue
				}
				formats := []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999999", "2006-01-02 15:04:05"}
				for _, layout := range formats {
					if t, err := time.Parse(layout, s); err == nil {
						return t
					}
				}
				if n, err := strconv.ParseInt(s, 10, 64); err == nil {
					return epochGuess(n)
				}
			case float64:
				return epochGuess(int64(typed))
			}
		}
	}
	return time.Time{}
}

func epochGuess(n int64) time.Time {
	if n > 9_999_999_999 {
		return time.UnixMilli(n)
	}
	return time.Unix(n, 0)
}

func StatusLatLng(payload map[string]any) (*float64, *float64) {
	if payload == nil {
		return nil, nil
	}
	lat := firstNumber(payload, "latitude", "lat", "gps_latitude")
	lng := firstNumber(payload, "longitude", "lon", "lng", "gps_longitude")
	if lat == nil || lng == nil {
		return nil, nil
	}
	if *lat < -90 || *lat > 90 || *lng < -180 || *lng > 180 {
		return nil, nil
	}
	return lat, lng
}

func (m NormalizedMessage) String() string {
	return fmt.Sprintf("%s/%s raw=%t", m.TopicInfo.IATA, m.TopicInfo.Subtopic, m.RawHex != "")
}
