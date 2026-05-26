package api

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestCanonicalHistorySummaryWindowRoundsDownToStableBuckets(t *testing.T) {
	from, to := canonicalHistorySummaryWindow(125_999, 188_123)
	if from != 120_000 || to != 180_000 {
		t.Fatalf("canonical window = %d..%d, want 120000..180000", from, to)
	}
}

func TestHistorySummaryCacheReturnsCopiesAndExpires(t *testing.T) {
	cache := newHistorySummaryCache(20 * time.Millisecond)
	response := live.PublicHistorySummaryResponse{
		ServerTime: 10,
		From:       0,
		To:         60_000,
		BucketMs:   30_000,
		Buckets: []live.PublicHistorySummaryBucket{
			{Start: 0, End: 30_000, Count: 3},
		},
	}
	cache.Set(response.From, response.To, response.BucketMs, response)

	got, ok := cache.Get(response.From, response.To, response.BucketMs)
	if !ok {
		t.Fatalf("summary cache miss")
	}
	got.Buckets[0].Count = 99
	gotAgain, ok := cache.Get(response.From, response.To, response.BucketMs)
	if !ok || gotAgain.Buckets[0].Count != 3 {
		t.Fatalf("summary cache did not preserve immutable copy: %#v ok=%v", gotAgain, ok)
	}

	time.Sleep(30 * time.Millisecond)
	if _, ok := cache.Get(response.From, response.To, response.BucketMs); ok {
		t.Fatalf("summary cache entry should expire")
	}
}

func TestPublicPacketsNextCursorTokenContinuesWhenRawScanIsCapped(t *testing.T) {
	cursor := &store.HistoryCursor{At: time.Now().UnixMilli(), TypeOrder: 2, ID: 42}
	token := publicPacketsNextCursorToken(cursor, false, 0, 1000, publicPacketsMaxRawScan)
	if token == "" {
		t.Fatalf("expected cursor token when rare filters hit raw scan cap")
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	var decoded store.HistoryCursor
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal cursor: %v", err)
	}
	if decoded != *cursor {
		t.Fatalf("decoded cursor = %#v, want %#v", decoded, *cursor)
	}
	if got := publicPacketsNextCursorToken(cursor, true, 0, 1000, publicPacketsMaxRawScan); got != "" {
		t.Fatalf("exhausted scan cursor = %q, want empty", got)
	}
}

func TestPublicPacketsRawPageSizeKeepsDefaultPagesBounded(t *testing.T) {
	if got := publicPacketsRawPageSize(1000, publicPacketFilters{}); got != 1000 {
		t.Fatalf("default raw page size = %d, want 1000", got)
	}
	if got := publicPacketsRawPageSize(1000, publicPacketFilters{query: "ottawa"}); got != 1200 {
		t.Fatalf("filtered raw page size = %d, want 1200", got)
	}
	if got := publicPacketsRawPageSize(20, publicPacketFilters{}); got != 200 {
		t.Fatalf("small raw page size = %d, want 200", got)
	}
}
