package tests

import (
	"bufio"
	"encoding/json"
	"os"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/meshcore"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
)

func TestFixturesNormalizeAndParsePackets(t *testing.T) {
	for _, path := range []string{
		"../../examples/fixtures/synthetic-live.ndjson",
		"../../examples/fixtures/worldwide-r1.ndjson",
	} {
		t.Run(path, func(t *testing.T) {
			assertFixtureNormalizesAndParsesPackets(t, path)
		})
	}
}

func assertFixtureNormalizesAndParsesPackets(t *testing.T, path string) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	packetCount := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var line struct {
			Topic   string          `json:"topic"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			t.Fatalf("fixture line is invalid JSON: %v", err)
		}
		msg, err := imqtt.Normalize(line.Topic, line.Payload, time.Unix(0, 0))
		if err != nil {
			t.Fatalf("fixture line failed MQTT normalization: %v", err)
		}
		if msg.TopicInfo.Subtopic == "packets" {
			packetCount++
			if _, err := meshcore.ParseHexPacket(msg.RawHex); err != nil {
				t.Fatalf("fixture packet raw hex failed MeshCore parse: %v", err)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if packetCount == 0 {
		t.Fatalf("fixture should include packet lines")
	}
}
