package live

import (
	"sync/atomic"
	"time"
)

type RuntimeStats struct {
	publicStateRequests             atomic.Int64
	publicStateErrors               atomic.Int64
	publicStateLastLatencyMs        atomic.Int64
	publicHistoryRequests           atomic.Int64
	publicHistoryErrors             atomic.Int64
	publicHistoryLastLatencyMs      atomic.Int64
	publicSummaryRequests           atomic.Int64
	publicSummaryErrors             atomic.Int64
	publicSummaryLastLatencyMs      atomic.Int64
	publicPacketsRequests           atomic.Int64
	publicPacketsErrors             atomic.Int64
	publicPacketsLastLatencyMs      atomic.Int64
	publicPacketsLastScan           atomic.Int64
	publicPacketsScanCapped         atomic.Int64
	publicPacketsProjectionServed   atomic.Int64
	publicPacketsProjectionFallback atomic.Int64
	publicPacketsProjectionErrors   atomic.Int64
	publicPacketsProjectionLastAtMs atomic.Int64
	publicPacketsProjectionComplete atomic.Int64
	cacheRefreshFailures            atomic.Int64
	cacheRefreshLastLatencyMs       atomic.Int64
	cacheRefreshLastAtMs            atomic.Int64
	packetCountRefreshFailures      atomic.Int64
	packetCountRefreshLastLatencyMs atomic.Int64
	packetCountRefreshLastAtMs      atomic.Int64
	packetPathBackfillFailures      atomic.Int64
	packetPathBackfillLastLatencyMs atomic.Int64
	packetPathBackfillLastAtMs      atomic.Int64
	packetPathBackfillLastScanned   atomic.Int64
	packetPathBackfillLastProjected atomic.Int64
	packetPathBackfillLastMappable  atomic.Int64
	packetPathBackfillLastInvalid   atomic.Int64
	packetPathSearchIndexLastSync   atomic.Int64
	packetPathSearchIndexRemaining  atomic.Int64
	packetPathBackfillRemaining     atomic.Int64
}

type RuntimeStatsSnapshot struct {
	PublicStateRequests             int64 `json:"publicStateRequests"`
	PublicStateErrors               int64 `json:"publicStateErrors"`
	PublicStateLastLatencyMs        int64 `json:"publicStateLastLatencyMs"`
	PublicHistoryRequests           int64 `json:"publicHistoryRequests"`
	PublicHistoryErrors             int64 `json:"publicHistoryErrors"`
	PublicHistoryLastLatencyMs      int64 `json:"publicHistoryLastLatencyMs"`
	PublicSummaryRequests           int64 `json:"publicSummaryRequests"`
	PublicSummaryErrors             int64 `json:"publicSummaryErrors"`
	PublicSummaryLastLatencyMs      int64 `json:"publicSummaryLastLatencyMs"`
	PublicPacketsRequests           int64 `json:"publicPacketsRequests"`
	PublicPacketsErrors             int64 `json:"publicPacketsErrors"`
	PublicPacketsLastLatencyMs      int64 `json:"publicPacketsLastLatencyMs"`
	PublicPacketsLastScan           int64 `json:"publicPacketsLastScan"`
	PublicPacketsScanCapped         int64 `json:"publicPacketsScanCapped"`
	PublicPacketsProjectionServed   int64 `json:"publicPacketsProjectionServed"`
	PublicPacketsProjectionFallback int64 `json:"publicPacketsProjectionFallback"`
	PublicPacketsProjectionErrors   int64 `json:"publicPacketsProjectionErrors"`
	PublicPacketsProjectionLastAtMs int64 `json:"publicPacketsProjectionLastAtMs"`
	PublicPacketsProjectionComplete bool  `json:"publicPacketsProjectionComplete"`
	CacheRefreshFailures            int64 `json:"cacheRefreshFailures"`
	CacheRefreshLastLatencyMs       int64 `json:"cacheRefreshLastLatencyMs"`
	CacheRefreshLastAtMs            int64 `json:"cacheRefreshLastAtMs"`
	PacketCountRefreshFailures      int64 `json:"packetCountRefreshFailures"`
	PacketCountRefreshLastLatencyMs int64 `json:"packetCountRefreshLastLatencyMs"`
	PacketCountRefreshLastAtMs      int64 `json:"packetCountRefreshLastAtMs"`
	PacketPathBackfillFailures      int64 `json:"packetPathBackfillFailures"`
	PacketPathBackfillLastLatencyMs int64 `json:"packetPathBackfillLastLatencyMs"`
	PacketPathBackfillLastAtMs      int64 `json:"packetPathBackfillLastAtMs"`
	PacketPathBackfillLastScanned   int64 `json:"packetPathBackfillLastScanned"`
	PacketPathBackfillLastProjected int64 `json:"packetPathBackfillLastProjected"`
	PacketPathBackfillLastMappable  int64 `json:"packetPathBackfillLastMappable"`
	PacketPathBackfillLastInvalid   int64 `json:"packetPathBackfillLastInvalid"`
	PacketPathSearchIndexLastSync   int64 `json:"packetPathSearchIndexLastSync"`
	PacketPathSearchIndexRemaining  bool  `json:"packetPathSearchIndexRemaining"`
	PacketPathBackfillRemaining     bool  `json:"packetPathBackfillRemaining"`
}

func NewRuntimeStats() *RuntimeStats {
	return &RuntimeStats{}
}

func (s *RuntimeStats) RecordPublicState(duration time.Duration, failed bool) {
	if s == nil {
		return
	}
	s.publicStateRequests.Add(1)
	if failed {
		s.publicStateErrors.Add(1)
	}
	s.publicStateLastLatencyMs.Store(duration.Milliseconds())
}

func (s *RuntimeStats) RecordPublicHistory(duration time.Duration, failed bool) {
	if s == nil {
		return
	}
	s.publicHistoryRequests.Add(1)
	if failed {
		s.publicHistoryErrors.Add(1)
	}
	s.publicHistoryLastLatencyMs.Store(duration.Milliseconds())
}

func (s *RuntimeStats) RecordPublicSummary(duration time.Duration, failed bool) {
	if s == nil {
		return
	}
	s.publicSummaryRequests.Add(1)
	if failed {
		s.publicSummaryErrors.Add(1)
	}
	s.publicSummaryLastLatencyMs.Store(duration.Milliseconds())
}

func (s *RuntimeStats) RecordPublicPackets(duration time.Duration, failed bool) {
	if s == nil {
		return
	}
	s.publicPacketsRequests.Add(1)
	if failed {
		s.publicPacketsErrors.Add(1)
	}
	s.publicPacketsLastLatencyMs.Store(duration.Milliseconds())
}

func (s *RuntimeStats) RecordPublicPacketsScan(eventsScanned int, capped bool) {
	if s == nil {
		return
	}
	if eventsScanned < 0 {
		eventsScanned = 0
	}
	s.publicPacketsLastScan.Store(int64(eventsScanned))
	if capped {
		s.publicPacketsScanCapped.Add(1)
	}
}

func (s *RuntimeStats) RecordPublicPacketsProjection(served bool, complete bool, failed bool) {
	if s == nil {
		return
	}
	if served {
		s.publicPacketsProjectionServed.Add(1)
	} else {
		s.publicPacketsProjectionFallback.Add(1)
	}
	if failed {
		s.publicPacketsProjectionErrors.Add(1)
	}
	if complete {
		s.publicPacketsProjectionComplete.Store(1)
	} else {
		s.publicPacketsProjectionComplete.Store(0)
	}
	s.publicPacketsProjectionLastAtMs.Store(time.Now().UnixMilli())
}

func (s *RuntimeStats) RecordCacheRefresh(duration time.Duration, failed bool) {
	if s == nil {
		return
	}
	if failed {
		s.cacheRefreshFailures.Add(1)
	}
	s.cacheRefreshLastLatencyMs.Store(duration.Milliseconds())
	s.cacheRefreshLastAtMs.Store(time.Now().UnixMilli())
}

func (s *RuntimeStats) RecordPacketCountRefresh(duration time.Duration, failed bool) {
	if s == nil {
		return
	}
	if failed {
		s.packetCountRefreshFailures.Add(1)
	}
	s.packetCountRefreshLastLatencyMs.Store(duration.Milliseconds())
	s.packetCountRefreshLastAtMs.Store(time.Now().UnixMilli())
}

func (s *RuntimeStats) RecordPacketPathBackfill(duration time.Duration, failed bool, scanned int, projected int, mappable int, nonMappable int, searchIndexed int, searchRemaining bool, remaining bool) {
	if s == nil {
		return
	}
	if failed {
		s.packetPathBackfillFailures.Add(1)
	}
	s.packetPathBackfillLastLatencyMs.Store(duration.Milliseconds())
	s.packetPathBackfillLastAtMs.Store(time.Now().UnixMilli())
	s.packetPathBackfillLastScanned.Store(int64(maxInt(scanned, 0)))
	s.packetPathBackfillLastProjected.Store(int64(maxInt(projected, 0)))
	s.packetPathBackfillLastMappable.Store(int64(maxInt(mappable, 0)))
	s.packetPathBackfillLastInvalid.Store(int64(maxInt(nonMappable, 0)))
	s.packetPathSearchIndexLastSync.Store(int64(maxInt(searchIndexed, 0)))
	if searchRemaining {
		s.packetPathSearchIndexRemaining.Store(1)
	} else {
		s.packetPathSearchIndexRemaining.Store(0)
	}
	if remaining {
		s.packetPathBackfillRemaining.Store(1)
	} else {
		s.packetPathBackfillRemaining.Store(0)
	}
}

func (s *RuntimeStats) Snapshot() RuntimeStatsSnapshot {
	if s == nil {
		return RuntimeStatsSnapshot{}
	}
	return RuntimeStatsSnapshot{
		PublicStateRequests:             s.publicStateRequests.Load(),
		PublicStateErrors:               s.publicStateErrors.Load(),
		PublicStateLastLatencyMs:        s.publicStateLastLatencyMs.Load(),
		PublicHistoryRequests:           s.publicHistoryRequests.Load(),
		PublicHistoryErrors:             s.publicHistoryErrors.Load(),
		PublicHistoryLastLatencyMs:      s.publicHistoryLastLatencyMs.Load(),
		PublicSummaryRequests:           s.publicSummaryRequests.Load(),
		PublicSummaryErrors:             s.publicSummaryErrors.Load(),
		PublicSummaryLastLatencyMs:      s.publicSummaryLastLatencyMs.Load(),
		PublicPacketsRequests:           s.publicPacketsRequests.Load(),
		PublicPacketsErrors:             s.publicPacketsErrors.Load(),
		PublicPacketsLastLatencyMs:      s.publicPacketsLastLatencyMs.Load(),
		PublicPacketsLastScan:           s.publicPacketsLastScan.Load(),
		PublicPacketsScanCapped:         s.publicPacketsScanCapped.Load(),
		PublicPacketsProjectionServed:   s.publicPacketsProjectionServed.Load(),
		PublicPacketsProjectionFallback: s.publicPacketsProjectionFallback.Load(),
		PublicPacketsProjectionErrors:   s.publicPacketsProjectionErrors.Load(),
		PublicPacketsProjectionLastAtMs: s.publicPacketsProjectionLastAtMs.Load(),
		PublicPacketsProjectionComplete: s.publicPacketsProjectionComplete.Load() == 1,
		CacheRefreshFailures:            s.cacheRefreshFailures.Load(),
		CacheRefreshLastLatencyMs:       s.cacheRefreshLastLatencyMs.Load(),
		CacheRefreshLastAtMs:            s.cacheRefreshLastAtMs.Load(),
		PacketCountRefreshFailures:      s.packetCountRefreshFailures.Load(),
		PacketCountRefreshLastLatencyMs: s.packetCountRefreshLastLatencyMs.Load(),
		PacketCountRefreshLastAtMs:      s.packetCountRefreshLastAtMs.Load(),
		PacketPathBackfillFailures:      s.packetPathBackfillFailures.Load(),
		PacketPathBackfillLastLatencyMs: s.packetPathBackfillLastLatencyMs.Load(),
		PacketPathBackfillLastAtMs:      s.packetPathBackfillLastAtMs.Load(),
		PacketPathBackfillLastScanned:   s.packetPathBackfillLastScanned.Load(),
		PacketPathBackfillLastProjected: s.packetPathBackfillLastProjected.Load(),
		PacketPathBackfillLastMappable:  s.packetPathBackfillLastMappable.Load(),
		PacketPathBackfillLastInvalid:   s.packetPathBackfillLastInvalid.Load(),
		PacketPathSearchIndexLastSync:   s.packetPathSearchIndexLastSync.Load(),
		PacketPathSearchIndexRemaining:  s.packetPathSearchIndexRemaining.Load() == 1,
		PacketPathBackfillRemaining:     s.packetPathBackfillRemaining.Load() == 1,
	}
}

func maxInt(value int, minimum int) int {
	if value < minimum {
		return minimum
	}
	return value
}
