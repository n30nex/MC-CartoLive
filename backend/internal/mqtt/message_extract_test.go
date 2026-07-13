package mqtt

import (
	"testing"
	"time"
)

func TestNormalizeRawRSSISNRAndTimestamp(t *testing.T) {
	receivedAt := time.Date(2025, 3, 16, 0, 7, 12, 0, time.UTC)
	payload := []byte(`{"origin":"YKF Observer","raw":"0900","RSSI":"-93","SNR":"4.5","timestamp":"2025-03-16T00:07:11.191561Z"}`)
	msg, err := Normalize("meshcore/YKF/ABCDEF012345/packets", payload, receivedAt)
	if err != nil {
		t.Fatal(err)
	}
	if msg.RawHex != "0900" {
		t.Fatalf("raw = %s", msg.RawHex)
	}
	if msg.RSSI == nil || *msg.RSSI != -93 {
		t.Fatalf("RSSI = %v", msg.RSSI)
	}
	if msg.SNR == nil || *msg.SNR != 4.5 {
		t.Fatalf("SNR = %v", msg.SNR)
	}
	if msg.ObserverName != "YKF Observer" {
		t.Fatalf("observer name = %s", msg.ObserverName)
	}
	if msg.HeardAtMs == 0 {
		t.Fatal("expected parsed timestamp")
	}
	if msg.ReceivedAtMs != receivedAt.UnixMilli() {
		t.Fatalf("receivedAt = %d, want %d", msg.ReceivedAtMs, receivedAt.UnixMilli())
	}
}

func TestNormalizeFallsBackToReceiveTimeForFutureTimestamp(t *testing.T) {
	receivedAt := time.Date(2026, 5, 22, 12, 0, 0, 0, time.UTC)
	payload := []byte(`{"origin":"YKF Observer","raw":"0900","timestamp":"2037-04-05T22:15:43Z"}`)

	msg, err := Normalize("meshcore/YKF/ABCDEF012345/packets", payload, receivedAt)
	if err != nil {
		t.Fatal(err)
	}

	if msg.HeardAtMs != receivedAt.UnixMilli() {
		t.Fatalf("heardAt = %d, want receive time %d", msg.HeardAtMs, receivedAt.UnixMilli())
	}
}

func TestNormalizeFallsBackToReceiveTimeForStaleTimestamp(t *testing.T) {
	receivedAt := time.Date(2026, 5, 22, 12, 0, 0, 0, time.UTC)
	payload := []byte(`{"origin":"YKF Observer","raw":"0900","timestamp":"2026-05-22T06:00:00Z"}`)

	msg, err := Normalize("meshcore/YKF/ABCDEF012345/packets", payload, receivedAt)
	if err != nil {
		t.Fatal(err)
	}

	if msg.HeardAtMs != receivedAt.UnixMilli() {
		t.Fatalf("heardAt = %d, want receive time %d", msg.HeardAtMs, receivedAt.UnixMilli())
	}
}
