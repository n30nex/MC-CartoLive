package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
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

func TestClientIPRequiresTrustedProxyHeaders(t *testing.T) {
	request, err := http.NewRequest(http.MethodGet, "/", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.RemoteAddr = "203.0.113.10:49152"
	request.Header.Set("X-Forwarded-For", "198.51.100.77, 10.0.0.10")
	request.Header.Set("X-Real-IP", "198.51.100.88")

	if got := clientIP(request, false); got != "203.0.113.10" {
		t.Fatalf("untrusted proxy client IP = %q, want remote addr", got)
	}
	if got := clientIP(request, true); got != "198.51.100.77" {
		t.Fatalf("trusted proxy client IP = %q, want first XFF address", got)
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
