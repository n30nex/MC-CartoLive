package store

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

func TestPublicEventsInsertListAndLatestSeq(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	now := time.Now().UnixMilli()
	first, err := st.InsertPublicEvent(ctx, live.PublicEvent{
		Type:            "activity",
		At:              now,
		Region:          "ykf",
		PayloadTypeName: "plain_text",
		Message:         true,
		RouteIDs:        []string{"r-a"},
		Data: live.PublicActivity{
			ID:               "activity-1",
			Kind:             "packet",
			PayloadTypeName:  "PLAIN_TEXT",
			Region:           "YKF",
			HeardAt:          now,
			ResolutionBucket: live.PublicBucketObserverOnly,
			AnimationState:   live.PublicAnimationUnmapped,
		},
	})
	if err != nil {
		t.Fatalf("insert first public event: %v", err)
	}
	second, err := st.InsertPublicEvent(ctx, live.PublicEvent{
		Type:            "routePulse",
		At:              now + 1,
		Region:          "YKF",
		PayloadTypeName: "ADVERT",
		Data: live.PublicRoutePulse{
			ID:              "pulse-2",
			PayloadTypeName: "ADVERT",
			Region:          "YKF",
			HeardAt:         now + 1,
		},
	})
	if err != nil {
		t.Fatalf("insert second public event: %v", err)
	}
	if first.Seq <= 0 || second.Seq <= first.Seq {
		t.Fatalf("seq order first=%d second=%d", first.Seq, second.Seq)
	}
	latest, err := st.LatestPublicSeq(ctx)
	if err != nil {
		t.Fatalf("latest seq: %v", err)
	}
	if latest != second.Seq {
		t.Fatalf("latest seq = %d, want %d", latest, second.Seq)
	}

	page, next, err := st.ListPublicEventsAfter(ctx, PublicEventFilter{AfterSeq: 0, Limit: 1})
	if err != nil {
		t.Fatalf("list first page: %v", err)
	}
	if len(page) != 1 || page[0].Seq != first.Seq {
		t.Fatalf("first page = %#v, want first only", page)
	}
	if next != first.Seq {
		t.Fatalf("next cursor = %d, want last returned seq %d", next, first.Seq)
	}

	events, next, err := st.ListPublicEventsAfter(ctx, PublicEventFilter{AfterSeq: first.Seq, Limit: 10})
	if err != nil {
		t.Fatalf("list after first: %v", err)
	}
	if next != 0 {
		t.Fatalf("next cursor = %d, want 0", next)
	}
	if len(events) != 1 || events[0].Seq != second.Seq {
		t.Fatalf("events after first = %#v, want second only", events)
	}
}

func TestPublicEventsFiltersAndJSONPayload(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	now := time.Now().UnixMilli()
	if _, err := st.InsertPublicEvent(ctx, live.PublicEvent{
		Type:            "activity",
		At:              now,
		Region:          "YYZ",
		PayloadTypeName: "TEXT",
		Message:         true,
		Data:            map[string]any{"id": "activity-safe", "text": "hello"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.InsertPublicEvent(ctx, live.PublicEvent{
		Type:            "activity",
		At:              now + 1,
		Region:          "YKF",
		PayloadTypeName: "ADVERT",
		Message:         false,
		Data:            map[string]any{"id": "activity-other"},
	}); err != nil {
		t.Fatal(err)
	}

	events, _, err := st.ListPublicEventsAfter(ctx, PublicEventFilter{Region: "YYZ", PayloadTypeName: "TEXT", MessageOnly: true, Limit: 10})
	if err != nil {
		t.Fatalf("filtered events: %v", err)
	}
	if len(events) != 1 || events[0].Region != "YYZ" || !events[0].Message {
		t.Fatalf("filtered events = %#v, want YYZ message", events)
	}
	raw, ok := events[0].Data.(json.RawMessage)
	if !ok {
		t.Fatalf("event data type = %T, want json.RawMessage", events[0].Data)
	}
	if !json.Valid(raw) {
		t.Fatalf("stored public json is invalid: %s", string(raw))
	}
}
