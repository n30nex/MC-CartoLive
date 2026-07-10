package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"meshcore-canada-live-map/backend/internal/live"
)

func TestPublicStateServesPrecompressedCacheAndStableETag(t *testing.T) {
	cache := live.NewPublicStateCache(live.NewPublicIATAFilter(nil))
	cache.Replace(live.PublicLiveState{
		Stats: live.PublicStats{Packets: 25},
		Nodes: []live.PublicNode{{ID: "safe-node", Label: "Safe", Latitude: 43.6, Longitude: -79.3}},
	}, nil)
	server := &Server{PublicState: cache.Snapshot, PublicStateSerialized: cache.Serialized}
	handler := server.Routes()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/state", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Content-Encoding") != "gzip" || response.Header().Get("ETag") == "" {
		t.Fatalf("cached response status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	reader, err := gzip.NewReader(bytes.NewReader(response.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	_ = reader.Close()
	if !json.Valid(raw) {
		t.Fatalf("decoded state is invalid JSON: %s", raw)
	}

	notModified := httptest.NewRecorder()
	conditional := httptest.NewRequest(http.MethodGet, "/api/v1/public/state", nil)
	conditional.Header.Set("If-None-Match", response.Header().Get("ETag"))
	handler.ServeHTTP(notModified, conditional)
	if notModified.Code != http.StatusNotModified || notModified.Body.Len() != 0 {
		t.Fatalf("conditional response status=%d body=%q", notModified.Code, notModified.Body.String())
	}
}
