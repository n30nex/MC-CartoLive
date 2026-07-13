package live

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPublicFallbackEnvelopeIsExplicitlyUnsequenced(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4)
	hub.SetLatestSeq(12_345)
	envelope := hub.unsequencedEventEnvelope("activity", map[string]any{"id": "live-fallback"})
	if envelope.Seq != 0 || envelope.LatestSeq != 12_345 {
		t.Fatalf("generic envelope seq/latest=%d/%d, want 0/12345", envelope.Seq, envelope.LatestSeq)
	}
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	if _, exists := document["seq"]; exists {
		t.Fatalf("non-durable envelope exposed a sequence: %s", raw)
	}
	if document["latestSeq"] != float64(12_345) {
		t.Fatalf("latest durable cursor missing from envelope: %s", raw)
	}
}

func TestInternalBroadcastEnvelopeKeepsProcessLocalSequence(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4)
	first := hub.eventEnvelope("packetObservation", map[string]any{"id": "one"})
	second := hub.eventEnvelope("edgeAnimation", map[string]any{"id": "two"})
	if first.Seq <= 0 || second.Seq != first.Seq+1 {
		t.Fatalf("internal envelope sequences=%d/%d, want positive consecutive values", first.Seq, second.Seq)
	}
}

func TestLiveEnvelopesAreImmediatelyDisplayable(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4)
	first := hub.eventEnvelope("activity", map[string]any{"id": "one"})
	second := hub.eventEnvelope("routePulse", map[string]any{"id": "two"})
	if first.DisplayAt != first.ServerTime || second.DisplayAt != second.ServerTime {
		t.Fatalf("display/server first=%d/%d second=%d/%d", first.DisplayAt, first.ServerTime, second.DisplayAt, second.ServerTime)
	}
	if second.DisplayAt-first.DisplayAt > 100 {
		t.Fatalf("live envelopes retained cinematic pacing: delta=%dms", second.DisplayAt-first.DisplayAt)
	}
}

func TestWebsocketOriginAllowed(t *testing.T) {
	allowedHosts := allowedOriginHosts([]string{"http://routes.canadaverse.org"})

	tests := []struct {
		name   string
		host   string
		origin string
		want   bool
	}{
		{name: "same public host", host: "routes.canadaverse.org", origin: "http://routes.canadaverse.org", want: true},
		{name: "configured public origin through localhost proxy", host: "localhost:39476", origin: "http://routes.canadaverse.org", want: true},
		{name: "same local host", host: "localhost:39476", origin: "http://localhost:39476", want: true},
		{name: "local hostnames may differ", host: "127.0.0.1:39476", origin: "http://localhost:39476", want: true},
		{name: "missing origin", host: "localhost:39476", origin: "", want: false},
		{name: "foreign origin rejected", host: "localhost:39476", origin: "https://example.com", want: false},
		{name: "bad origin rejected", host: "localhost:39476", origin: "://bad", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "http://"+tt.host+"/ws/public", nil)
			request.Host = tt.host
			if tt.origin != "" {
				request.Header.Set("Origin", tt.origin)
			}
			if got := websocketOriginAllowed(request, allowedHosts); got != tt.want {
				t.Fatalf("websocketOriginAllowed() = %t, want %t", got, tt.want)
			}
		})
	}
}

func TestSafeSendDropAccountingIsAtomic(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 1)
	client := &client{send: make(chan Envelope, 1), created: time.Now()}
	client.send <- Envelope{Version: 1, Type: "event"}

	safeSend(hub, client, Envelope{Version: 1, Type: "event"})
	safeSend(hub, client, Envelope{Version: 1, Type: "event"})

	if got := hub.Stats().DroppedMessages; got != 2 {
		t.Fatalf("dropped messages = %d, want 2", got)
	}
	if got := client.dropped.Load(); got != 2 {
		t.Fatalf("client dropped count = %d, want 2", got)
	}
}

func TestSafeSendOverflowRemovesRegisteredSlowClient(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 1)
	client := &client{send: make(chan Envelope, 1), created: time.Now()}
	client.send <- Envelope{Version: 1, Type: "event"}
	hub.clients[client] = struct{}{}

	safeSend(hub, client, Envelope{Version: 1, Type: "event"})
	deadline := time.Now().Add(time.Second)
	for hub.ClientCount() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := hub.ClientCount(); got != 0 {
		t.Fatalf("slow client remained registered: %d", got)
	}
	if !client.resetting.Load() {
		t.Fatal("slow client was not marked for reset")
	}
}
