package api

import (
	"testing"
	"time"
)

func TestRateLimiterRefillsFractionalTokens(t *testing.T) {
	limiter := newRateLimiter(60, 2)
	defer limiter.stop()
	start := time.Unix(1_700_000_000, 0)

	if !limiter.allowAt("203.0.113.10", start) || !limiter.allowAt("203.0.113.10", start) {
		t.Fatal("initial burst was not available")
	}
	if limiter.allowAt("203.0.113.10", start) {
		t.Fatal("request beyond initial burst was allowed")
	}
	if limiter.allowAt("203.0.113.10", start.Add(500*time.Millisecond)) {
		t.Fatal("half token was treated as a full token")
	}
	if !limiter.allowAt("203.0.113.10", start.Add(time.Second)) {
		t.Fatal("fractional refill did not accumulate to one token")
	}
}

func TestRateLimiterCapsRefillAndIsolatesClients(t *testing.T) {
	limiter := newRateLimiter(60, 2)
	defer limiter.stop()
	start := time.Unix(1_700_000_000, 0)

	if !limiter.allowAt("203.0.113.11", start) {
		t.Fatal("first client was denied its burst")
	}
	if !limiter.allowAt("203.0.113.12", start) {
		t.Fatal("second client did not receive an independent bucket")
	}
	later := start.Add(10 * time.Minute)
	if !limiter.allowAt("203.0.113.11", later) || !limiter.allowAt("203.0.113.11", later) {
		t.Fatal("idle refill did not restore the capped burst")
	}
	if limiter.allowAt("203.0.113.11", later) {
		t.Fatal("idle refill exceeded the burst cap")
	}
}
