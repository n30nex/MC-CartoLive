package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
)

func TestPublicMetricsAreLoopbackOnlyByDefault(t *testing.T) {
	server := &Server{Config: Config{PublicMode: true}}
	publicRequest := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	publicRequest.RemoteAddr = "203.0.113.20:40000"
	publicResponse := httptest.NewRecorder()
	server.Routes().ServeHTTP(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusNotFound {
		t.Fatalf("public metrics status=%d want 404", publicResponse.Code)
	}

	loopbackRequest := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	loopbackRequest.RemoteAddr = "127.0.0.1:40000"
	loopbackResponse := httptest.NewRecorder()
	server.Routes().ServeHTTP(loopbackResponse, loopbackRequest)
	if loopbackResponse.Code != http.StatusNotFound {
		t.Fatalf("main-listener loopback metrics status=%d want 404", loopbackResponse.Code)
	}
	dedicatedResponse := httptest.NewRecorder()
	server.MetricsRoutes().ServeHTTP(dedicatedResponse, loopbackRequest)
	if dedicatedResponse.Code != http.StatusOK {
		t.Fatalf("dedicated loopback metrics status=%d want 200", dedicatedResponse.Code)
	}
}

func TestDedicatedMetricsUsesListenerBoundary(t *testing.T) {
	server := &Server{Config: Config{PublicMode: true}}
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.RemoteAddr = "203.0.113.20:40000"
	response := httptest.NewRecorder()
	server.metrics(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("dedicated metrics status=%d want 200", response.Code)
	}
}

func TestDetailedMetricsReportConfiguredQueueCapacities(t *testing.T) {
	runtimeStats := live.NewRuntimeStats()
	runtimeStats.UpdateDerivedQueue(0, 1024, 0)
	server := &Server{
		Runtime: runtimeStats,
		MQTTStatus: func(time.Time) imqtt.Status {
			return imqtt.Status{QueueCapacity: 4096}
		},
	}
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	response := httptest.NewRecorder()
	server.metrics(response, request)
	body := response.Body.String()
	for _, metric := range []string{
		"meshcore_mqtt_queue_capacity 4096",
		"meshcore_derived_queue_capacity 1024",
	} {
		if !strings.Contains(body, metric) {
			t.Fatalf("metrics missing %q: %s", metric, body)
		}
	}
}
