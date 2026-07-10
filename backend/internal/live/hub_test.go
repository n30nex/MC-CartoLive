package live

import (
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"
)

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
