package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"meshcore-canada-live-map/backend/internal/live"
)

func TestPublicWebSocketAdmissionLimitsTrustedForwardedClient(t *testing.T) {
	limiter := newWSAdmissionLimiter(5)
	for i := 0; i < 5; i++ {
		if !limiter.acquire("198.51.100.50") {
			t.Fatal("failed to seed websocket admission")
		}
	}
	server := &Server{
		Config: Config{TrustProxyHeaders: true, TrustedProxyCIDRs: []string{"203.0.113.0/24"}},
		PublicHub: live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4),
		wsAdmission: limiter,
	}
	request := httptest.NewRequest(http.MethodGet, "/ws/public", nil)
	request.RemoteAddr = "203.0.113.10:40000"
	request.Header.Set("X-Forwarded-For", "198.51.100.50")
	response := httptest.NewRecorder()
	server.publicWebSocket(response, request)
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("trusted forwarded client status=%d want 429", response.Code)
	}
}
func TestPublicWebSocketAdmissionIgnoresHeadersFromUntrustedPeer(t *testing.T) {
	limiter := newWSAdmissionLimiter(1)
	if !limiter.acquire("198.51.100.50") {
		t.Fatal("failed to seed websocket admission")
	}
	server := &Server{
		Config: Config{TrustProxyHeaders: true, TrustedProxyCIDRs: []string{"203.0.113.0/24"}},
		PublicHub: live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4),
		wsAdmission: limiter,
	}
	request := httptest.NewRequest(http.MethodGet, "/ws/public", nil)
	request.RemoteAddr = "192.0.2.10:40000"
	request.Header.Set("X-Forwarded-For", "198.51.100.50")
	response := httptest.NewRecorder()
	server.publicWebSocket(response, request)
	if response.Code == http.StatusTooManyRequests {
		t.Fatalf("untrusted peer was incorrectly keyed by forwarded header: %s", response.Body.String())
	}
	if !limiter.acquire("192.0.2.10") {
		t.Fatal("untrusted peer admission was not released after failed upgrade")
	}
}
