package resolve

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/meshcore"
)

type mockProvider struct {
	candidates map[string][]Candidate
}

func (m *mockProvider) CandidatesByPrefix(ctx context.Context, iata string, hashSize int, prefix string) ([]Candidate, error) {
	key := fmt.Sprintf("%s/%d/%s", iata, hashSize, prefix)
	return m.candidates[key], nil
}

type countingGenerationProvider struct {
	mu         sync.Mutex
	candidates map[string][]Candidate
	calls      map[string]int
	generation uint64
}

type snapshotCollisionProvider struct {
	gate              sync.RWMutex
	mu                sync.Mutex
	candidates        map[string][]Candidate
	generation        uint64
	snapshotAttempted chan struct{}
	snapshotOnce      sync.Once
}

func (p *snapshotCollisionProvider) BeginCandidateSnapshot() (uint64, func()) {
	p.snapshotOnce.Do(func() { close(p.snapshotAttempted) })
	p.gate.RLock()
	return p.CandidateGeneration(), p.gate.RUnlock
}

func (p *snapshotCollisionProvider) CandidateGeneration() uint64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.generation
}

func (p *snapshotCollisionProvider) CandidatesByPrefix(_ context.Context, iata string, hashSize int, prefix string) ([]Candidate, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return cloneCandidates(p.candidates[fmt.Sprintf("%s/%d/%s", iata, hashSize, prefix)]), nil
}

func (p *snapshotCollisionProvider) beginMutation() {
	p.gate.Lock()
	p.mu.Lock()
	p.generation++
	p.mu.Unlock()
}

func (p *snapshotCollisionProvider) finishMutation(key string, candidates []Candidate) {
	p.mu.Lock()
	p.candidates[key] = cloneCandidates(candidates)
	p.generation++
	p.mu.Unlock()
	p.gate.Unlock()
}

type midResolveMutationProvider struct {
	mu         sync.Mutex
	candidates map[string][]Candidate
	calls      map[string]int
	generation uint64
	mutated    bool
}

func (p *midResolveMutationProvider) CandidateGeneration() uint64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.generation
}

func (p *midResolveMutationProvider) CandidatesByPrefix(_ context.Context, iata string, hashSize int, prefix string) ([]Candidate, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	key := fmt.Sprintf("%s/%d/%s", iata, hashSize, prefix)
	p.calls[key]++
	result := cloneCandidates(p.candidates[key])
	if prefix == "BB" && !p.mutated {
		p.mutated = true
		p.candidates["YKF/1/AA"] = append(p.candidates["YKF/1/AA"], Candidate{
			NodeID: "n-collision", PublicKey: "AA1000", Role: "repeater", IATA: "YKF",
		})
		p.generation++
	}
	return result, nil
}

func (p *countingGenerationProvider) CandidatesByPrefix(_ context.Context, iata string, hashSize int, prefix string) ([]Candidate, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	key := fmt.Sprintf("%s/%d/%s", iata, hashSize, prefix)
	p.calls[key]++
	return cloneCandidates(p.candidates[key]), nil
}

func (p *countingGenerationProvider) CandidateGeneration() uint64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.generation
}

func (p *countingGenerationProvider) set(key string, candidates []Candidate, advanceGeneration bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.candidates[key] = cloneCandidates(candidates)
	if advanceGeneration {
		p.generation++
	}
}

func (p *countingGenerationProvider) callCount(key string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls[key]
}

func newCountingGenerationProvider(candidates map[string][]Candidate) *countingGenerationProvider {
	return &countingGenerationProvider{candidates: candidates, calls: make(map[string]int)}
}

func ptrFloat(v float64) *float64 { return &v }

func TestResolveSingleForwarderHighConfidence(t *testing.T) {
	ctx := context.Background()
	lat, lng := 43.4, -80.4
	provider := &mockProvider{
		candidates: map[string][]Candidate{
			"YKF/1/AA": {{NodeID: "n1", PublicKey: "AA" + "00000000000000000000000000000000000000000000000000000000000000", Name: "Repeater1", Role: "repeater", IATA: "YKF", Latitude: &lat, Longitude: &lng}},
		},
	}
	r := New(provider, []string{"repeater", "room_server"})
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x01, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusHigh {
		t.Fatalf("status = %s, want %s (%s)", result.Status, StatusHigh, result.Reason)
	}
	if len(result.Hops) != 1 {
		t.Fatalf("hops = %d, want 1", len(result.Hops))
	}
}

func TestResolveMultipleCandidatesPicksForwarder(t *testing.T) {
	ctx := context.Background()
	lat, lng := 43.4, -80.4
	lat2, lng2 := 44.0, -79.0
	provider := &mockProvider{
		candidates: map[string][]Candidate{
			"YKF/1/AA": {
				{NodeID: "n1", PublicKey: "AA00000000000000000000000000000000000000000000000000000000000000", Name: "Companion", Role: "companion", IATA: "YKF", Latitude: &lat, Longitude: &lng},
				{NodeID: "n2", PublicKey: "AA10000000000000000000000000000000000000000000000000000000000000", Name: "Repeater", Role: "repeater", IATA: "YKF", Latitude: &lat2, Longitude: &lng2},
			},
		},
	}
	r := New(provider, []string{"repeater", "room_server"})
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x01, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusHigh {
		t.Fatalf("status = %s, want %s (%s)", result.Status, StatusHigh, result.Reason)
	}
	if result.Hops[0].Candidate.Role != "repeater" {
		t.Fatalf("picked role = %s, want repeater", result.Hops[0].Candidate.Role)
	}
}

func TestResolveMultipleForwardersCollision(t *testing.T) {
	ctx := context.Background()
	lat, lng := 43.4, -80.4
	lat2, lng2 := 44.0, -79.0
	provider := &mockProvider{
		candidates: map[string][]Candidate{
			"YKF/1/AA": {
				{NodeID: "n1", PublicKey: "AA00000000000000000000000000000000000000000000000000000000000000", Name: "R1", Role: "repeater", IATA: "YKF", Latitude: &lat, Longitude: &lng},
				{NodeID: "n2", PublicKey: "AA10000000000000000000000000000000000000000000000000000000000000", Name: "R2", Role: "repeater", IATA: "YKF", Latitude: &lat2, Longitude: &lng2},
			},
		},
	}
	r := New(provider, []string{"repeater", "room_server"})
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x01, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusAmbiguous {
		t.Fatalf("status = %s, want %s", result.Status, StatusAmbiguous)
	}
}

func TestResolveZeroCandidatesNoCandidate(t *testing.T) {
	ctx := context.Background()
	provider := &mockProvider{
		candidates: map[string][]Candidate{},
	}
	r := New(provider, []string{"repeater", "room_server"})
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x01, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusUnresolved {
		t.Fatalf("status = %s, want %s", result.Status, StatusUnresolved)
	}
}

func TestResolveNonForwarderOnlyCandidatesRoleInvalid(t *testing.T) {
	ctx := context.Background()
	lat, lng := 43.4, -80.4
	provider := &mockProvider{
		candidates: map[string][]Candidate{
			"YKF/1/AA": {
				{NodeID: "n1", PublicKey: "AA00000000000000000000000000000000000000000000000000000000000000", Name: "Companion", Role: "companion", IATA: "YKF", Latitude: &lat, Longitude: &lng},
				{NodeID: "n2", PublicKey: "AA20000000000000000000000000000000000000000000000000000000000000", Name: "Sensor", Role: "sensor", IATA: "YKF", Latitude: &lat, Longitude: &lng},
			},
		},
	}
	r := New(provider, []string{"repeater", "room_server"})
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x01, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusRoleInvalid {
		t.Fatalf("status = %s, want %s", result.Status, StatusRoleInvalid)
	}
}

func TestResolveDuplicatePrefix(t *testing.T) {
	ctx := context.Background()
	lat, lng := 43.4, -80.4
	provider := &mockProvider{
		candidates: map[string][]Candidate{
			"YKF/1/AA": {{NodeID: "n1", PublicKey: "AA00000000000000000000000000000000000000000000000000000000000000", Name: "R1", Role: "repeater", IATA: "YKF", Latitude: &lat, Longitude: &lng}},
			"YKF/1/BB": {{NodeID: "n2", PublicKey: "BB00000000000000000000000000000000000000000000000000000000000000", Name: "R2", Role: "repeater", IATA: "YKF", Latitude: &lat, Longitude: &lng}},
		},
	}
	r := New(provider, []string{"repeater", "room_server"})
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x02, 0xAA, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusDuplicatePrefix {
		t.Fatalf("status = %s, want %s", result.Status, StatusDuplicatePrefix)
	}
}

func TestShouldRejectDistance(t *testing.T) {
	tests := []struct {
		name           string
		distanceKM     float64
		maxKM          float64
		isTrace        bool
		allowLongTrace bool
		want           bool
	}{
		{name: "zero max allows all", distanceKM: 1000, maxKM: 0, isTrace: false, allowLongTrace: false, want: false},
		{name: "within limit", distanceKM: 5, maxKM: 10, isTrace: false, allowLongTrace: false, want: false},
		{name: "exactly at limit", distanceKM: 10, maxKM: 10, isTrace: false, allowLongTrace: false, want: false},
		{name: "exceeds limit", distanceKM: 15, maxKM: 10, isTrace: false, allowLongTrace: false, want: true},
		{name: "trace allowed with long trace", distanceKM: 100, maxKM: 10, isTrace: true, allowLongTrace: true, want: false},
		{name: "trace rejected without long trace", distanceKM: 100, maxKM: 10, isTrace: true, allowLongTrace: false, want: true},
		{name: "non-trace rejected even with long trace", distanceKM: 100, maxKM: 10, isTrace: false, allowLongTrace: true, want: true},
		{name: "negative distance within limit", distanceKM: -5, maxKM: 10, isTrace: false, allowLongTrace: false, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ShouldRejectDistance(tt.distanceKM, tt.maxKM, tt.isTrace, tt.allowLongTrace, false)
			if got != tt.want {
				t.Fatalf("ShouldRejectDistance() = %t, want %t", got, tt.want)
			}
		})
	}
}

func TestNewResolverDefaultRoles(t *testing.T) {
	r := New(nil, nil)
	if r.forwarderRoles == nil {
		t.Fatal("forwarderRoles is nil")
	}
	if !r.forwarderRoles["repeater"] {
		t.Fatal("repeater not in default forwarder roles")
	}
	if !r.forwarderRoles["room_server"] {
		t.Fatal("room_server not in default forwarder roles")
	}
}

func TestCandidateCacheHitReturnsIndependentCandidateSet(t *testing.T) {
	lat, lng := 43.4, -80.4
	key := "YKF/1/AA"
	provider := newCountingGenerationProvider(map[string][]Candidate{
		key: {{NodeID: "n1", PublicKey: "AA00", Role: "repeater", IATA: "YKF", Latitude: &lat, Longitude: &lng}},
	})
	resolver := New(provider, nil)

	first, err := resolver.candidatesByPrefix(context.Background(), "ykf", 1, "aa")
	if err != nil {
		t.Fatal(err)
	}
	first[0].Role = "companion"
	*first[0].Latitude = 0
	second, err := resolver.candidatesByPrefix(context.Background(), "YKF", 1, "AA")
	if err != nil {
		t.Fatal(err)
	}
	if got := provider.callCount(key); got != 1 {
		t.Fatalf("provider calls = %d, want 1", got)
	}
	if second[0].Role != "repeater" || second[0].Latitude == nil || *second[0].Latitude != lat {
		t.Fatalf("cached candidate was mutated by caller: %+v", second[0])
	}
}

func TestCandidateCacheLRUEvictionIsBounded(t *testing.T) {
	provider := newCountingGenerationProvider(map[string][]Candidate{
		"YKF/1/AA": {},
		"YKF/1/BB": {},
		"YKF/1/CC": {},
	})
	resolver := New(provider, nil)
	resolver.cacheLimit = 2
	ctx := context.Background()
	for _, prefix := range []string{"AA", "BB", "AA", "CC", "BB"} {
		if _, err := resolver.candidatesByPrefix(ctx, "YKF", 1, prefix); err != nil {
			t.Fatal(err)
		}
	}
	if resolver.candidateLRU.Len() != 2 || len(resolver.candidateCache) != 2 {
		t.Fatalf("cache size list=%d map=%d, want 2", resolver.candidateLRU.Len(), len(resolver.candidateCache))
	}
	if got := provider.callCount("YKF/1/AA"); got != 1 {
		t.Fatalf("AA provider calls = %d, want 1", got)
	}
	if got := provider.callCount("YKF/1/BB"); got != 2 {
		t.Fatalf("BB provider calls = %d, want 2 after eviction", got)
	}
}

func TestCandidateCacheExplicitInvalidation(t *testing.T) {
	key := "YKF/1/AA"
	provider := newCountingGenerationProvider(map[string][]Candidate{key: {}})
	resolver := New(provider, nil)
	ctx := context.Background()
	if _, err := resolver.candidatesByPrefix(ctx, "YKF", 1, "AA"); err != nil {
		t.Fatal(err)
	}
	provider.set(key, []Candidate{{NodeID: "n1", PublicKey: "AA00", Role: "repeater", IATA: "YKF"}}, false)
	resolver.InvalidateCandidates()
	candidates, err := resolver.candidatesByPrefix(ctx, "YKF", 1, "AA")
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 || provider.callCount(key) != 2 {
		t.Fatalf("candidates=%d provider calls=%d, want 1 and 2", len(candidates), provider.callCount(key))
	}
}

func TestProviderGenerationCollisionInvalidatesHighConfidence(t *testing.T) {
	ctx := context.Background()
	lat, lng := 43.4, -80.4
	key := "YKF/1/AA"
	first := Candidate{NodeID: "n1", PublicKey: "AA0000", Name: "R1", Role: "repeater", IATA: "YKF", Latitude: &lat, Longitude: &lng}
	provider := newCountingGenerationProvider(map[string][]Candidate{key: {first}})
	resolver := New(provider, []string{"repeater"})
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x01, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	result, err := resolver.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusHigh {
		t.Fatalf("initial status = %s, want %s", result.Status, StatusHigh)
	}

	lat2, lng2 := 44.0, -79.0
	second := Candidate{NodeID: "n2", PublicKey: "AA1000", Name: "R2", Role: "repeater", IATA: "YKF", Latitude: &lat2, Longitude: &lng2}
	// Deliberately omit Resolver.InvalidateCandidates. Store-style generation
	// invalidation must still prevent the stale unique result from staying high.
	provider.set(key, []Candidate{first, second}, true)
	result, err = resolver.Resolve(ctx, "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusAmbiguous {
		t.Fatalf("post-collision status = %s, want %s", result.Status, StatusAmbiguous)
	}
	if got := provider.callCount(key); got != 2 {
		t.Fatalf("provider calls = %d, want 2", got)
	}
}

func TestResolveWaitsForSerializedCandidateMutation(t *testing.T) {
	key := "YKF/1/AA"
	first := Candidate{NodeID: "n1", PublicKey: "AA0000", Role: "repeater", IATA: "YKF"}
	second := Candidate{NodeID: "n2", PublicKey: "AA1000", Role: "repeater", IATA: "YKF"}
	provider := &snapshotCollisionProvider{
		candidates:        map[string][]Candidate{key: {first}},
		snapshotAttempted: make(chan struct{}),
	}
	provider.beginMutation()
	mutationFinished := false
	defer func() {
		if !mutationFinished {
			provider.finishMutation(key, []Candidate{first, second})
		}
	}()

	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x01, 0xAA})
	if err != nil {
		t.Fatal(err)
	}
	type resolveResult struct {
		result Result
		err    error
	}
	resolved := make(chan resolveResult, 1)
	go func() {
		result, err := New(provider, []string{"repeater"}).Resolve(context.Background(), "YKF", parsed)
		resolved <- resolveResult{result: result, err: err}
	}()

	select {
	case <-provider.snapshotAttempted:
	case <-time.After(time.Second):
		t.Fatal("resolver did not request a serialized candidate snapshot")
	}
	provider.finishMutation(key, []Candidate{first, second})
	mutationFinished = true

	select {
	case got := <-resolved:
		if got.err != nil {
			t.Fatal(got.err)
		}
		if got.result.Status != StatusAmbiguous {
			t.Fatalf("status after concurrent collision = %s, want %s", got.result.Status, StatusAmbiguous)
		}
	case <-time.After(time.Second):
		t.Fatal("resolver did not finish after candidate mutation committed")
	}
}

func TestResolveRetriesWholePacketWhenGenerationChangesBetweenPrefixes(t *testing.T) {
	provider := &midResolveMutationProvider{
		candidates: map[string][]Candidate{
			"YKF/1/AA": {{NodeID: "n1", PublicKey: "AA0000", Role: "repeater", IATA: "YKF"}},
			"YKF/1/BB": {{NodeID: "n2", PublicKey: "BB0000", Role: "repeater", IATA: "YKF"}},
		},
		calls: make(map[string]int),
	}
	parsed, err := meshcore.ParsePacket([]byte{byte((meshcore.PayloadPlainText << 2) | meshcore.RouteFlood), 0x02, 0xAA, 0xBB})
	if err != nil {
		t.Fatal(err)
	}
	result, err := New(provider, []string{"repeater"}).Resolve(context.Background(), "YKF", parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusAmbiguous {
		t.Fatalf("mixed-generation status = %s, want retry result %s", result.Status, StatusAmbiguous)
	}
	provider.mu.Lock()
	aaCalls := provider.calls["YKF/1/AA"]
	provider.mu.Unlock()
	if aaCalls < 2 {
		t.Fatalf("AA candidate calls = %d, want whole-packet retry", aaCalls)
	}
}
