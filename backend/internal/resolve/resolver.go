package resolve

import (
	"container/list"
	"context"
	"fmt"
	"strings"
	"sync"

	"meshcore-canada-live-map/backend/internal/meshcore"
)

type CandidateProvider interface {
	CandidatesByPrefix(ctx context.Context, iata string, hashSize int, prefix string) ([]Candidate, error)
}

// CandidateGenerationProvider lets a provider invalidate cached candidate sets
// even when a caller forgets to call InvalidateCandidates. Store implements
// this with a monotonic generation that advances after every node mutation
// which can affect resolver truth.
type CandidateGenerationProvider interface {
	CandidateGeneration() uint64
}

// CandidateSnapshotProvider serializes a complete multi-prefix resolution with
// candidate mutations. Store implements this with an RW lock and an odd/even
// generation, so no high-confidence result can be assembled from two different
// candidate snapshots.
type CandidateSnapshotProvider interface {
	BeginCandidateSnapshot() (generation uint64, release func())
}

const defaultCandidateCacheLimit = 4096

type candidateCacheKey struct {
	iata     string
	hashSize int
	prefix   string
}

type candidateCacheEntry struct {
	key        candidateCacheKey
	candidates []Candidate
}

type Resolver struct {
	provider       CandidateProvider
	forwarderRoles map[string]bool

	cacheMu         sync.Mutex
	candidateCache  map[candidateCacheKey]*list.Element
	candidateLRU    *list.List
	cacheLimit      int
	cacheGeneration uint64
	cacheEpoch      uint64
}

func New(provider CandidateProvider, forwarderRoles []string) *Resolver {
	roles := map[string]bool{}
	for _, role := range forwarderRoles {
		roles[role] = true
	}
	if len(roles) == 0 {
		roles["repeater"] = true
		roles["room_server"] = true
	}
	return &Resolver{
		provider:        provider,
		forwarderRoles:  roles,
		candidateCache:  make(map[candidateCacheKey]*list.Element),
		candidateLRU:    list.New(),
		cacheLimit:      defaultCandidateCacheLimit,
		cacheGeneration: providerGeneration(provider),
	}
}

// InvalidateCandidates synchronously drops all cached candidate sets. Callers
// should invoke it after successful node/config mutations. Providers which
// expose CandidateGeneration also protect against a missed caller invalidation.
func (r *Resolver) InvalidateCandidates() {
	if r == nil {
		return
	}
	r.cacheMu.Lock()
	r.clearCandidateCacheLocked(providerGeneration(r.provider))
	r.cacheMu.Unlock()
}

func (r *Resolver) Resolve(ctx context.Context, iata string, parsed meshcore.ParsedPacket) (Result, error) {
	for {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		generation, release := beginProviderSnapshot(r.provider)
		result, err := r.resolveOnce(ctx, iata, parsed)
		stable := providerGeneration(r.provider) == generation
		release()
		if err != nil {
			return Result{}, err
		}
		if stable {
			return result, nil
		}
		// Candidate truth changed after at least one prefix was evaluated. Drop
		// the mixed-generation decision and retry the complete packet fail-closed.
	}
}

func (r *Resolver) resolveOnce(ctx context.Context, iata string, parsed meshcore.ParsedPacket) (Result, error) {
	if parsed.InvalidForMap {
		return Result{Status: StatusInvalidForMap, Reason: parsed.InvalidReason}, nil
	}
	if parsed.HopCount == 0 {
		return Result{Status: StatusNoPath, Reason: "zero_hop_packet"}, nil
	}

	seen := map[string]bool{}
	for _, prefix := range parsed.PathChunks {
		if seen[prefix] {
			return Result{Status: StatusDuplicatePrefix, Reason: fmt.Sprintf("duplicate prefix %s", prefix)}, nil
		}
		seen[prefix] = true
	}

	result := Result{Status: StatusHigh}
	for _, prefix := range parsed.PathChunks {
		candidates, err := r.candidatesByPrefix(ctx, iata, parsed.HashSize, prefix)
		if err != nil {
			return Result{}, err
		}
		if len(candidates) == 0 {
			return Result{Status: StatusUnresolved, Reason: fmt.Sprintf("no candidates for %d-byte prefix %s in %s", parsed.HashSize, prefix, iata)}, nil
		}

		forwarders := make([]Candidate, 0, len(candidates))
		for _, candidate := range candidates {
			if r.forwarderRoles[candidate.Role] {
				forwarders = append(forwarders, candidate)
			}
		}
		if len(forwarders) == 0 {
			return Result{Status: StatusRoleInvalid, Reason: fmt.Sprintf("prefix %s has no forwarder-capable candidates", prefix)}, nil
		}
		if len(forwarders) > 1 {
			return Result{Status: StatusAmbiguous, Reason: fmt.Sprintf("prefix %s maps to %d forwarder candidates", prefix, len(forwarders))}, nil
		}

		result.Hops = append(result.Hops, ResolvedHop{
			Prefix:     prefix,
			Confidence: StatusHigh,
			Candidate:  forwarders[0],
		})
	}

	return result, nil
}

func (r *Resolver) candidatesByPrefix(ctx context.Context, iata string, hashSize int, prefix string) ([]Candidate, error) {
	key := candidateCacheKey{
		iata:     strings.ToUpper(strings.TrimSpace(iata)),
		hashSize: hashSize,
		prefix:   strings.ToUpper(strings.TrimSpace(prefix)),
	}
	for {
		r.cacheMu.Lock()
		generation := providerGeneration(r.provider)
		if generation != r.cacheGeneration {
			r.clearCandidateCacheLocked(generation)
		}
		epoch := r.cacheEpoch
		if elem, ok := r.candidateCache[key]; ok {
			r.candidateLRU.MoveToFront(elem)
			candidates := cloneCandidates(elem.Value.(candidateCacheEntry).candidates)
			r.cacheMu.Unlock()
			if providerGeneration(r.provider) == generation {
				return candidates, nil
			}
			continue
		}
		r.cacheMu.Unlock()

		candidates, err := r.provider.CandidatesByPrefix(ctx, key.iata, key.hashSize, key.prefix)
		if err != nil {
			return nil, err
		}
		// If candidate truth changed while SQLite was being queried, discard the
		// snapshot and retry. This prevents publishing a result under the wrong
		// generation, including cached zero/unique candidate sets.
		if providerGeneration(r.provider) != generation {
			continue
		}
		candidates = cloneCandidates(candidates)
		r.cacheMu.Lock()
		latestGeneration := providerGeneration(r.provider)
		if latestGeneration != generation || epoch != r.cacheEpoch {
			if latestGeneration != r.cacheGeneration {
				r.clearCandidateCacheLocked(latestGeneration)
			}
			r.cacheMu.Unlock()
			continue
		}
		if r.cacheLimit > 0 {
			if elem, ok := r.candidateCache[key]; ok {
				elem.Value = candidateCacheEntry{key: key, candidates: candidates}
				r.candidateLRU.MoveToFront(elem)
			} else {
				elem := r.candidateLRU.PushFront(candidateCacheEntry{key: key, candidates: candidates})
				r.candidateCache[key] = elem
			}
			for r.candidateLRU.Len() > r.cacheLimit {
				oldest := r.candidateLRU.Back()
				if oldest == nil {
					break
				}
				delete(r.candidateCache, oldest.Value.(candidateCacheEntry).key)
				r.candidateLRU.Remove(oldest)
			}
		}
		r.cacheMu.Unlock()
		return cloneCandidates(candidates), nil
	}
}

func (r *Resolver) clearCandidateCacheLocked(generation uint64) {
	r.candidateCache = make(map[candidateCacheKey]*list.Element)
	r.candidateLRU.Init()
	r.cacheGeneration = generation
	r.cacheEpoch++
}

func providerGeneration(provider CandidateProvider) uint64 {
	if versioned, ok := provider.(CandidateGenerationProvider); ok {
		return versioned.CandidateGeneration()
	}
	return 0
}

func beginProviderSnapshot(provider CandidateProvider) (uint64, func()) {
	if snapshot, ok := provider.(CandidateSnapshotProvider); ok {
		generation, release := snapshot.BeginCandidateSnapshot()
		if release == nil {
			release = func() {}
		}
		return generation, release
	}
	return providerGeneration(provider), func() {}
}

func cloneCandidates(candidates []Candidate) []Candidate {
	if candidates == nil {
		return nil
	}
	cloned := make([]Candidate, len(candidates))
	for i, candidate := range candidates {
		cloned[i] = candidate
		if candidate.Latitude != nil {
			latitude := *candidate.Latitude
			cloned[i].Latitude = &latitude
		}
		if candidate.Longitude != nil {
			longitude := *candidate.Longitude
			cloned[i].Longitude = &longitude
		}
	}
	return cloned
}
