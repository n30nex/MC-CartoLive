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
	publicPacketsSearchFTS          atomic.Int64
	publicPacketsSearchSubstring    atomic.Int64
	publicPacketsSearchNoQuery      atomic.Int64
	cacheRefreshFailures            atomic.Int64
	cacheRefreshLastLatencyMs       atomic.Int64
	cacheRefreshLastAtMs            atomic.Int64
	cacheRefreshLastFailed          atomic.Int64
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
	storeWriteAttempts              atomic.Int64
	storeWriteRetries               atomic.Int64
	storeWriteFailures              atomic.Int64
	storeWriteBusyErrors            atomic.Int64
	storeWriteFullErrors            atomic.Int64
	storeWriteLastLatencyMs         atomic.Int64
	ingestDuplicateSuppressions     atomic.Int64
	derivedAccepted                 atomic.Int64
	derivedProcessed                atomic.Int64
	derivedDropped                  atomic.Int64
	derivedFailures                 atomic.Int64
	derivedQueueDepth               atomic.Int64
	derivedQueueCapacity            atomic.Int64
	derivedOldestAtMs               atomic.Int64
	derivedLastLatencyMs            atomic.Int64
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
	PublicPacketsSearchFTS          int64 `json:"publicPacketsSearchFTS"`
	PublicPacketsSearchSubstring    int64 `json:"publicPacketsSearchSubstring"`
	PublicPacketsSearchNoQuery      int64 `json:"publicPacketsSearchNoQuery"`
	CacheRefreshFailures            int64 `json:"cacheRefreshFailures"`
	CacheRefreshLastLatencyMs       int64 `json:"cacheRefreshLastLatencyMs"`
	CacheRefreshLastAtMs            int64 `json:"cacheRefreshLastAtMs"`
	CacheRefreshLastFailed          bool  `json:"cacheRefreshLastFailed"`
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
	StoreWriteAttempts              int64 `json:"storeWriteAttempts"`
	StoreWriteRetries               int64 `json:"storeWriteRetries"`
	StoreWriteFailures              int64 `json:"storeWriteFailures"`
	StoreWriteBusyErrors            int64 `json:"storeWriteBusyErrors"`
	StoreWriteFullErrors            int64 `json:"storeWriteFullErrors"`
	StoreWriteLastLatencyMs         int64 `json:"storeWriteLastLatencyMs"`
	IngestDuplicateSuppressions     int64 `json:"ingestDuplicateSuppressions"`
	DerivedAccepted                 int64 `json:"derivedAccepted"`
	DerivedProcessed                int64 `json:"derivedProcessed"`
	DerivedDropped                  int64 `json:"derivedDropped"`
	DerivedFailures                 int64 `json:"derivedFailures"`
	DerivedQueueDepth               int64 `json:"derivedQueueDepth"`
	DerivedQueueCapacity            int64 `json:"derivedQueueCapacity"`
	DerivedOldestAtMs               int64 `json:"derivedOldestAtMs"`
	DerivedLastLatencyMs            int64 `json:"derivedLastLatencyMs"`
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

func (s *RuntimeStats) RecordPublicPacketsSearchMode(mode string) {
	if s == nil {
		return
	}
	switch mode {
	case "projectedFts":
		s.publicPacketsSearchFTS.Add(1)
	case "projectedSubstring":
		s.publicPacketsSearchSubstring.Add(1)
	default:
		s.publicPacketsSearchNoQuery.Add(1)
	}
}

func (s *RuntimeStats) RecordCacheRefresh(duration time.Duration, failed bool) {
	if s == nil {
		return
	}
	if failed {
		s.cacheRefreshFailures.Add(1)
		s.cacheRefreshLastFailed.Store(1)
	} else {
		s.cacheRefreshLastFailed.Store(0)
	}
	s.cacheRefreshLastLatencyMs.Store(duration.Milliseconds())
	s.cacheRefreshLastAtMs.Store(time.Now().UnixMilli())
}

func (s *RuntimeStats) RecordIngestDuplicate() {
	if s != nil {
		s.ingestDuplicateSuppressions.Add(1)
	}
}

func (s *RuntimeStats) RecordDerivedEnqueue(depth int, capacity int, oldestAtMs int64) {
	if s == nil {
		return
	}
	s.derivedAccepted.Add(1)
	s.setDerivedQueue(depth, capacity, oldestAtMs)
}

func (s *RuntimeStats) RecordDerivedDrop(depth int, capacity int, oldestAtMs int64) {
	if s == nil {
		return
	}
	s.derivedDropped.Add(1)
	s.setDerivedQueue(depth, capacity, oldestAtMs)
}

func (s *RuntimeStats) UpdateDerivedQueue(depth int, capacity int, oldestAtMs int64) {
	if s != nil {
		s.setDerivedQueue(depth, capacity, oldestAtMs)
	}
}

func (s *RuntimeStats) RecordDerivedProcessed(duration time.Duration, failed bool, depth int, capacity int, oldestAtMs int64) {
	if s == nil {
		return
	}
	s.derivedProcessed.Add(1)
	if failed {
		s.derivedFailures.Add(1)
	}
	s.derivedLastLatencyMs.Store(duration.Milliseconds())
	s.setDerivedQueue(depth, capacity, oldestAtMs)
}

func (s *RuntimeStats) setDerivedQueue(depth int, capacity int, oldestAtMs int64) {
	s.derivedQueueDepth.Store(int64(max(depth, 0)))
	s.derivedQueueCapacity.Store(int64(max(capacity, 0)))
	s.derivedOldestAtMs.Store(max(oldestAtMs, 0))
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
	s.packetPathBackfillLastScanned.Store(int64(max(scanned, 0)))
	s.packetPathBackfillLastProjected.Store(int64(max(projected, 0)))
	s.packetPathBackfillLastMappable.Store(int64(max(mappable, 0)))
	s.packetPathBackfillLastInvalid.Store(int64(max(nonMappable, 0)))
	s.packetPathSearchIndexLastSync.Store(int64(max(searchIndexed, 0)))
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

func (s *RuntimeStats) RecordStoreWrite(duration time.Duration, retries int, failed bool, busy bool, full bool) {
	if s == nil {
		return
	}
	s.storeWriteAttempts.Add(1)
	if retries > 0 {
		s.storeWriteRetries.Add(int64(retries))
	}
	if failed {
		s.storeWriteFailures.Add(1)
	}
	if busy {
		s.storeWriteBusyErrors.Add(1)
	}
	if full {
		s.storeWriteFullErrors.Add(1)
	}
	s.storeWriteLastLatencyMs.Store(duration.Milliseconds())
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
		PublicPacketsSearchFTS:          s.publicPacketsSearchFTS.Load(),
		PublicPacketsSearchSubstring:    s.publicPacketsSearchSubstring.Load(),
		PublicPacketsSearchNoQuery:      s.publicPacketsSearchNoQuery.Load(),
		CacheRefreshFailures:            s.cacheRefreshFailures.Load(),
		CacheRefreshLastLatencyMs:       s.cacheRefreshLastLatencyMs.Load(),
		CacheRefreshLastAtMs:            s.cacheRefreshLastAtMs.Load(),
		CacheRefreshLastFailed:          s.cacheRefreshLastFailed.Load() == 1,
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
		StoreWriteAttempts:              s.storeWriteAttempts.Load(),
		StoreWriteRetries:               s.storeWriteRetries.Load(),
		StoreWriteFailures:              s.storeWriteFailures.Load(),
		StoreWriteBusyErrors:            s.storeWriteBusyErrors.Load(),
		StoreWriteFullErrors:            s.storeWriteFullErrors.Load(),
		StoreWriteLastLatencyMs:         s.storeWriteLastLatencyMs.Load(),
		IngestDuplicateSuppressions:     s.ingestDuplicateSuppressions.Load(),
		DerivedAccepted:                 s.derivedAccepted.Load(),
		DerivedProcessed:                s.derivedProcessed.Load(),
		DerivedDropped:                  s.derivedDropped.Load(),
		DerivedFailures:                 s.derivedFailures.Load(),
		DerivedQueueDepth:               s.derivedQueueDepth.Load(),
		DerivedQueueCapacity:            s.derivedQueueCapacity.Load(),
		DerivedOldestAtMs:               s.derivedOldestAtMs.Load(),
		DerivedLastLatencyMs:            s.derivedLastLatencyMs.Load(),
	}
}
