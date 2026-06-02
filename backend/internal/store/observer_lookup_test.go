package store

import (
	"context"
	"testing"

	mq "meshcore-canada-live-map/backend/internal/mqtt"
)

func TestObserverByPublicKeyIATAMatchesExactRegion(t *testing.T) {
	ctx := context.Background()
	s, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	if err := s.UpsertObserver(ctx, observerMessageForTest("ABCDEF0123456789", "YOW", "YOW observer", 45.4215, -75.6972, 1000)); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertObserver(ctx, observerMessageForTest("ABCDEF0123456789", "YYZ", "YYZ observer", 43.6532, -79.3832, 2000)); err != nil {
		t.Fatal(err)
	}

	observer, err := s.ObserverByPublicKeyIATA(ctx, "abcdef0123456789", "yow")
	if err != nil {
		t.Fatal(err)
	}
	if observer.IATA != "YOW" || observer.Name != "YOW observer" {
		t.Fatalf("observer = %#v, want exact YOW observer", observer)
	}
	if observer.Latitude == nil || observer.Longitude == nil || *observer.Latitude != 45.4215 || *observer.Longitude != -75.6972 {
		t.Fatalf("observer coordinates = %#v/%#v, want YOW coordinates", observer.Latitude, observer.Longitude)
	}
}

func observerMessageForTest(publicKey, region, name string, lat, lng float64, heardAt int64) mq.NormalizedMessage {
	return mq.NormalizedMessage{
		TopicInfo: mq.TopicInfo{
			IATA:        region,
			Region:      region,
			PublisherPK: publicKey,
			Subtopic:    "status",
		},
		ObserverName: name,
		Payload: map[string]any{
			"lat": lat,
			"lon": lng,
		},
		HeardAtMs: heardAt,
	}
}
