package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicMetricsAreLoopbackOnlyByDefault(t *testing.T) {
	server := &Server{Config: Config{PublicMode: true}}
	publicRequest := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	publicRequest.RemoteAddr = "203.0.113.20:40000"
	publicResponse := httptest.NewRecorder()
	server.metrics(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusNotFound {
		t.Fatalf("public metrics status=%d want 404", publicResponse.Code)
	}

	loopbackRequest := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	loopbackRequest.RemoteAddr = "127.0.0.1:40000"
	loopbackResponse := httptest.NewRecorder()
	server.metrics(loopbackResponse, loopbackRequest)
	if loopbackResponse.Code != http.StatusOK {
		t.Fatalf("loopback metrics status=%d want 200", loopbackResponse.Code)
	}
}
func TestMetricsPublicRequiresExplicitOptIn(t *testing.T) {
	server := &Server{Config: Config{PublicMode: true, MetricsPublic: true}}
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.RemoteAddr = "203.0.113.20:40000"
	response := httptest.NewRecorder()
	server.metrics(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("opted-in public metrics status=%d want 200", response.Code)
	}
}
