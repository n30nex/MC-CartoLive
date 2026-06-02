package tests

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/api"
	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestPublicStateFallbackUsesPacketCountWithoutStats(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	if err := st.UpsertPacket(ctx, meshcore.ParsedPacket{
		PacketHash:      "fallback-packet",
		RawHex:          "AABBCC",
		RouteTypeName:   "FLOOD",
		PayloadTypeName: "ADVERT",
		HashSize:        1,
	}, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}

	server := api.Server{
		Config:    api.Config{PublicMode: true, RecentPacketLimit: 10, RecentEdgeEventLimit: 10},
		Store:     st,
		PublicHub: live.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), 4),
	}

	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/public/state", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("public state status = %d body=%s", response.Code, response.Body.String())
	}

	var payload live.PublicLiveState
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Stats.Packets != 1 {
		t.Fatalf("public state packets = %d, want 1", payload.Stats.Packets)
	}
}
