package live

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	publicCacheMaxNodes            = 2500
	publicCacheMaxRoutes           = 2500
	publicCacheMaxPulses           = 240
	publicCacheMaxActivity         = 240
	publicSerializationMinInterval = 5 * time.Second
)

type PublicIATAFilter struct {
	enabled bool
	exact   map[string]struct{}
}

func NewPublicIATAFilter(items []string) PublicIATAFilter {
	filter := PublicIATAFilter{exact: map[string]struct{}{}}
	for _, item := range items {
		item = strings.ToUpper(strings.TrimSpace(item))
		if item == "" {
			continue
		}
		filter.enabled = true
		filter.exact[item] = struct{}{}
	}
	return filter
}

func (f PublicIATAFilter) Allows(iata string) bool {
	if !f.enabled {
		return true
	}
	iata = strings.ToUpper(strings.TrimSpace(iata))
	if iata == "" {
		return false
	}
	if _, ok := f.exact[iata]; ok {
		return true
	}
	return false
}

func (f PublicIATAFilter) FilterState(state State) (State, map[string]int64) {
	if !f.enabled {
		return state, nil
	}
	excluded := map[string]int64{}
	filtered := state
	filtered.Observers = make([]Observer, 0, len(state.Observers))
	for _, observer := range state.Observers {
		if f.Allows(observer.IATA) {
			filtered.Observers = append(filtered.Observers, observer)
		} else {
			excluded[strings.ToUpper(observer.IATA)]++
		}
	}
	filtered.Nodes = make([]Node, 0, len(state.Nodes))
	for _, node := range state.Nodes {
		originalIATACount := len(node.IATAsHeardIn)
		node.IATAsHeardIn = allowedIATAs(node.IATAsHeardIn, f)
		if originalIATACount == 0 || len(node.IATAsHeardIn) > 0 {
			filtered.Nodes = append(filtered.Nodes, node)
		}
	}
	filtered.RecentPackets = make([]PacketObservation, 0, len(state.RecentPackets))
	for _, packet := range state.RecentPackets {
		if f.Allows(packet.IATA) {
			filtered.RecentPackets = append(filtered.RecentPackets, packet)
		} else {
			excluded[strings.ToUpper(packet.IATA)]++
		}
	}
	filtered.RecentEdgeEvents = make([]EdgeEvent, 0, len(state.RecentEdgeEvents))
	for _, edge := range state.RecentEdgeEvents {
		if f.Allows(edge.IATA) {
			filtered.RecentEdgeEvents = append(filtered.RecentEdgeEvents, edge)
		} else {
			excluded[strings.ToUpper(edge.IATA)]++
		}
	}
	if len(excluded) == 0 {
		return filtered, nil
	}
	return filtered, excluded
}

type PublicStateCache struct {
	mu                  sync.RWMutex
	filter              PublicIATAFilter
	state               PublicLiveState
	ready               bool
	updatedAt           time.Time
	fullReconciledAt    time.Time
	anomalies           map[string]int64
	truncated           PublicCacheTruncation
	serialized          PublicStateSerialization
	serializedAt        time.Time
	mutationGeneration  uint64
	nodeMutations       map[string]uint64
	activityMutations   map[string]uint64
	pulseMutations      map[string]uint64
	packetCountMutation uint64
}

type PublicStateSerialization struct {
	JSON []byte
	Gzip []byte
	ETag string
}

type PublicCacheStatus struct {
	Ready                   bool  `json:"ready"`
	UpdatedAt               int64 `json:"updatedAt"`
	CacheAgeMs              int64 `json:"cacheAgeMs"`
	FullReconciledAt        int64 `json:"fullReconciledAt"`
	FullReconcileAgeMs      int64 `json:"fullReconcileAgeMs"`
	TruncatedNodes          int64 `json:"truncatedNodes"`
	TruncatedRoutes         int64 `json:"truncatedRoutes"`
	TruncatedRecentPulses   int64 `json:"truncatedRecentPulses"`
	TruncatedRecentActivity int64 `json:"truncatedRecentActivity"`
}

type PublicCacheTruncation struct {
	Nodes          int64
	Routes         int64
	RecentPulses   int64
	RecentActivity int64
}

func NewPublicStateCache(filter PublicIATAFilter) *PublicStateCache {
	return &PublicStateCache{
		filter:            filter,
		anomalies:         map[string]int64{},
		nodeMutations:     map[string]uint64{},
		activityMutations: map[string]uint64{},
		pulseMutations:    map[string]uint64{},
	}
}

func (c *PublicStateCache) AllowsIATA(iata string) bool {
	if c == nil {
		return true
	}
	return c.filter.Allows(iata)
}

func (c *PublicStateCache) RestrictsIATA() bool {
	if c == nil {
		return false
	}
	return c.filter.enabled
}

func (c *PublicStateCache) AllowedIATAs(items []string) []string {
	if c == nil {
		return append([]string{}, items...)
	}
	return allowedIATAs(items, c.filter)
}

func (c *PublicStateCache) FilterState(state State) (State, map[string]int64) {
	if c == nil {
		return state, nil
	}
	return c.filter.FilterState(state)
}

// MutationGeneration identifies the cache state observed by a full database
// reconciliation. Incremental live mutations advance it while holding the same
// cache lock used by replacement, allowing reconciliation to preserve updates
// that arrived while SQLite was being read.
func (c *PublicStateCache) MutationGeneration() uint64 {
	if c == nil {
		return 0
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.mutationGeneration
}

func (c *PublicStateCache) RecordExcludedIATA(iata string) {
	if c == nil {
		return
	}
	iata = strings.ToUpper(strings.TrimSpace(iata))
	if iata == "" {
		iata = "UNKNOWN"
	}
	c.mu.Lock()
	c.anomalies[iata]++
	c.mu.Unlock()
}

func (c *PublicStateCache) Replace(state PublicLiveState, excluded map[string]int64) {
	if c == nil {
		return
	}
	c.replace(state, excluded, nil)
}

// ReplacePreservingMutations installs a fresh database snapshot and overlays
// bounded live cache data when the cache changed after expectedGeneration was
// captured. It returns true when such an overlay was required.
func (c *PublicStateCache) ReplacePreservingMutations(state PublicLiveState, excluded map[string]int64, expectedGeneration uint64) bool {
	if c == nil {
		return false
	}
	return c.replace(state, excluded, &expectedGeneration)
}

func (c *PublicStateCache) replace(state PublicLiveState, excluded map[string]int64, expectedGeneration *uint64) bool {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	preserved := expectedGeneration != nil && c.ready && c.mutationGeneration != *expectedGeneration
	if preserved {
		state = c.mergeMutationsAfterLocked(state, *expectedGeneration)
	}
	truncated := PublicCacheTruncation{
		Nodes:          truncatedCount(len(state.Nodes), publicCacheMaxNodes),
		Routes:         truncatedCount(len(state.Routes), publicCacheMaxRoutes),
		RecentPulses:   truncatedCount(len(state.RecentPulses), publicCacheMaxPulses),
		RecentActivity: truncatedCount(len(state.RecentActivity), publicCacheMaxActivity),
	}
	state.Nodes = limitPublicNodes(state.Nodes)
	state.Routes = limitPublicRoutes(state.Routes)
	state.RecentPulses = limitPublicPulses(state.RecentPulses)
	state.RecentActivity = limitPublicActivity(state.RecentActivity)
	state.UpdatedAt = now.UnixMilli()
	state.Stats.ExcludedIATAs = mergeCounters(excluded, c.anomalies)
	state.Stats.ExcludedRegions = copyCounter(state.Stats.ExcludedIATAs)
	c.state = copyPublicState(state)
	c.serialized = serializePublicState(state)
	c.serializedAt = now
	c.ready = true
	c.updatedAt = now
	c.fullReconciledAt = now
	c.truncated = truncated
	c.mutationGeneration++
	c.clearMutationJournalLocked()
	return preserved
}

func (c *PublicStateCache) Serialized() (PublicStateSerialization, bool) {
	if c == nil {
		return PublicStateSerialization{}, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if !c.ready || len(c.serialized.JSON) == 0 {
		return PublicStateSerialization{}, false
	}
	// Serialized buffers are immutable after publication. Returning their slice
	// headers avoids copying the multi-megabyte state on every request.
	return c.serialized, true
}

func serializePublicState(state PublicLiveState) PublicStateSerialization {
	raw, err := json.Marshal(state)
	if err != nil {
		return PublicStateSerialization{}
	}
	var compressed bytes.Buffer
	writer, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
	if err != nil {
		return PublicStateSerialization{JSON: raw, ETag: `W/"` + strconv.FormatInt(state.UpdatedAt, 10) + `"`}
	}
	if _, err := writer.Write(raw); err != nil {
		_ = writer.Close()
		return PublicStateSerialization{JSON: raw, ETag: `W/"` + strconv.FormatInt(state.UpdatedAt, 10) + `"`}
	}
	if err := writer.Close(); err != nil {
		return PublicStateSerialization{JSON: raw, ETag: `W/"` + strconv.FormatInt(state.UpdatedAt, 10) + `"`}
	}
	return PublicStateSerialization{
		JSON: raw,
		Gzip: compressed.Bytes(),
		ETag: `W/"` + strconv.FormatInt(state.UpdatedAt, 10) + `"`,
	}
}

func (c *PublicStateCache) Snapshot() (PublicLiveState, bool) {
	if c == nil {
		return PublicLiveState{}, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if !c.ready {
		return PublicLiveState{}, false
	}
	return copyPublicState(c.state), true
}

func (c *PublicStateCache) Status(now time.Time) PublicCacheStatus {
	if c == nil {
		return PublicCacheStatus{}
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if !c.ready {
		return PublicCacheStatus{}
	}
	if now.IsZero() {
		now = time.Now()
	}
	age := now.Sub(c.updatedAt).Milliseconds()
	if age < 0 {
		age = 0
	}
	fullReconcileAge := now.Sub(c.fullReconciledAt).Milliseconds()
	if fullReconcileAge < 0 {
		fullReconcileAge = 0
	}
	return PublicCacheStatus{
		Ready:                   true,
		UpdatedAt:               c.updatedAt.UnixMilli(),
		CacheAgeMs:              age,
		FullReconciledAt:        c.fullReconciledAt.UnixMilli(),
		FullReconcileAgeMs:      fullReconcileAge,
		TruncatedNodes:          c.truncated.Nodes,
		TruncatedRoutes:         c.truncated.Routes,
		TruncatedRecentPulses:   c.truncated.RecentPulses,
		TruncatedRecentActivity: c.truncated.RecentActivity,
	}
}

func (c *PublicStateCache) ApplyNode(node PublicNode) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.ready {
		return
	}
	next := make([]PublicNode, 0, len(c.state.Nodes)+1)
	next = append(next, node)
	for _, item := range c.state.Nodes {
		if item.ID != node.ID {
			next = append(next, item)
		}
	}
	for _, evicted := range next[min(len(next), publicCacheMaxNodes):] {
		delete(c.nodeMutations, evicted.ID)
	}
	c.state.Nodes = limitPublicNodes(next)
	c.state.Stats.ActiveNodes = int64(len(c.state.Nodes))
	c.advanceLatestSeqLocked(node.Seq)
	generation := c.nextMutationGenerationLocked()
	c.nodeMutations[node.ID] = generation
	c.recordLiveUpdateLocked(time.Now())
}

func (c *PublicStateCache) ApplyActivity(activity PublicActivity) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.ready {
		return
	}
	next := append([]PublicActivity{activity}, c.state.RecentActivity...)
	for _, evicted := range next[min(len(next), publicCacheMaxActivity):] {
		delete(c.activityMutations, evicted.ID)
	}
	c.state.RecentActivity = limitPublicActivity(next)
	c.state.Stats.ResolutionBuckets = PublicResolutionCounters(c.state.RecentActivity)
	if activity.Kind == "packet" || activity.Kind == "route" {
		c.state.Stats.Packets++
	}
	if activity.HeardAt > c.state.ServerTime {
		c.state.ServerTime = activity.HeardAt
		c.state.Stats.ServerTime = activity.HeardAt
	}
	c.advanceLatestSeqLocked(activity.Seq)
	generation := c.nextMutationGenerationLocked()
	c.activityMutations[activity.ID] = generation
	c.recordLiveUpdateLocked(time.Now())
}

func (c *PublicStateCache) ApplyRoutePulse(pulse PublicRoutePulse) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.ready {
		return
	}
	next := append([]PublicRoutePulse{pulse}, c.state.RecentPulses...)
	for _, evicted := range next[min(len(next), publicCacheMaxPulses):] {
		delete(c.pulseMutations, evicted.ID)
	}
	c.state.RecentPulses = limitPublicPulses(next)
	if pulse.HeardAt > c.state.ServerTime {
		c.state.ServerTime = pulse.HeardAt
		c.state.Stats.ServerTime = pulse.HeardAt
	}
	c.advanceLatestSeqLocked(pulse.Seq)
	generation := c.nextMutationGenerationLocked()
	c.pulseMutations[pulse.ID] = generation
	c.recordLiveUpdateLocked(time.Now())
}

func (c *PublicStateCache) advanceLatestSeqLocked(seq int64) {
	if seq > c.state.Stats.LatestSeq {
		c.state.Stats.LatestSeq = seq
	}
}

func (c *PublicStateCache) recordLiveUpdateLocked(now time.Time) {
	c.updatedAt = now
	c.state.UpdatedAt = now.UnixMilli()
	if c.serializedAt.IsZero() || now.Sub(c.serializedAt) >= publicSerializationMinInterval {
		c.serialized = serializePublicState(c.state)
		c.serializedAt = now
	}
}

func (c *PublicStateCache) SetPacketCount(count int64) {
	if c == nil || count < 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.ready {
		return
	}
	c.state.Stats.Packets = count
	c.packetCountMutation = c.nextMutationGenerationLocked()
}

func (c *PublicStateCache) nextMutationGenerationLocked() uint64 {
	c.mutationGeneration++
	return c.mutationGeneration
}

func (c *PublicStateCache) clearMutationJournalLocked() {
	clear(c.nodeMutations)
	clear(c.activityMutations)
	clear(c.pulseMutations)
	c.packetCountMutation = 0
}

// mergeMutationsAfterLocked overlays only live mutations that raced the
// database read. Re-adding the entire previous cache would resurrect nodes and
// activity intentionally omitted by retention or freshness filtering.
func (c *PublicStateCache) mergeMutationsAfterLocked(fresh PublicLiveState, generation uint64) PublicLiveState {
	nodes := make([]PublicNode, 0)
	for _, node := range c.state.Nodes {
		if c.nodeMutations[node.ID] > generation {
			nodes = append(nodes, node)
		}
	}
	activity := make([]PublicActivity, 0)
	for _, item := range c.state.RecentActivity {
		if c.activityMutations[item.ID] > generation {
			activity = append(activity, item)
		}
	}
	pulses := make([]PublicRoutePulse, 0)
	for _, pulse := range c.state.RecentPulses {
		if c.pulseMutations[pulse.ID] > generation {
			pulses = append(pulses, pulse)
		}
	}
	fresh.Nodes = mergeConcurrentPublicNodes(fresh.Nodes, nodes)
	fresh.RecentActivity = mergeConcurrentPublicActivity(fresh.RecentActivity, activity)
	fresh.RecentPulses = mergeConcurrentPublicPulses(fresh.RecentPulses, pulses)
	for _, node := range nodes {
		fresh.Stats.LatestSeq = max(fresh.Stats.LatestSeq, node.Seq)
	}
	for _, item := range activity {
		fresh.ServerTime = max(fresh.ServerTime, item.HeardAt)
		fresh.Stats.ServerTime = max(fresh.Stats.ServerTime, item.HeardAt)
		fresh.Stats.LatestSeq = max(fresh.Stats.LatestSeq, item.Seq)
	}
	for _, pulse := range pulses {
		fresh.ServerTime = max(fresh.ServerTime, pulse.HeardAt)
		fresh.Stats.ServerTime = max(fresh.Stats.ServerTime, pulse.HeardAt)
		fresh.Stats.LatestSeq = max(fresh.Stats.LatestSeq, pulse.Seq)
	}
	if c.packetCountMutation > generation {
		fresh.Stats.Packets = c.state.Stats.Packets
	} else if len(activity) > 0 {
		fresh.Stats.Packets = max(fresh.Stats.Packets, c.state.Stats.Packets)
	}
	fresh.Stats.ActiveNodes = int64(len(fresh.Nodes))
	fresh.Stats.ActiveRoutes = int64(len(fresh.Routes))
	fresh.Stats.ResolutionBuckets = PublicResolutionCounters(fresh.RecentActivity)
	return fresh
}

func mergeConcurrentPublicNodes(fresh []PublicNode, current []PublicNode) []PublicNode {
	byID := make(map[string]PublicNode, len(fresh)+len(current))
	for _, node := range fresh {
		byID[node.ID] = node
	}
	for _, node := range current {
		existing, ok := byID[node.ID]
		if !ok || node.LastSeen > existing.LastSeen || (node.LastSeen == existing.LastSeen && node.Seq >= existing.Seq) {
			byID[node.ID] = node
		}
	}
	out := make([]PublicNode, 0, len(byID))
	for _, node := range byID {
		out = append(out, node)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastSeen == out[j].LastSeen {
			return out[i].ID < out[j].ID
		}
		return out[i].LastSeen > out[j].LastSeen
	})
	return out
}

func mergeConcurrentPublicActivity(fresh []PublicActivity, current []PublicActivity) []PublicActivity {
	byID := make(map[string]PublicActivity, len(fresh)+len(current))
	for _, activity := range fresh {
		byID[activity.ID] = activity
	}
	for _, activity := range current {
		existing, ok := byID[activity.ID]
		if !ok || activity.HeardAt > existing.HeardAt || (activity.HeardAt == existing.HeardAt && activity.Seq >= existing.Seq) {
			byID[activity.ID] = activity
		}
	}
	out := make([]PublicActivity, 0, len(byID))
	for _, activity := range byID {
		out = append(out, activity)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].HeardAt == out[j].HeardAt {
			if out[i].Seq == out[j].Seq {
				return out[i].ID < out[j].ID
			}
			return out[i].Seq > out[j].Seq
		}
		return out[i].HeardAt > out[j].HeardAt
	})
	return out
}

func mergeConcurrentPublicPulses(fresh []PublicRoutePulse, current []PublicRoutePulse) []PublicRoutePulse {
	byID := make(map[string]PublicRoutePulse, len(fresh)+len(current))
	for _, pulse := range fresh {
		byID[pulse.ID] = pulse
	}
	for _, pulse := range current {
		existing, ok := byID[pulse.ID]
		if !ok || pulse.HeardAt > existing.HeardAt || (pulse.HeardAt == existing.HeardAt && pulse.Seq >= existing.Seq) {
			byID[pulse.ID] = pulse
		}
	}
	out := make([]PublicRoutePulse, 0, len(byID))
	for _, pulse := range byID {
		out = append(out, pulse)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].HeardAt == out[j].HeardAt {
			if out[i].Seq == out[j].Seq {
				return out[i].ID < out[j].ID
			}
			return out[i].Seq > out[j].Seq
		}
		return out[i].HeardAt > out[j].HeardAt
	})
	return out
}

func allowedIATAs(items []string, filter PublicIATAFilter) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.ToUpper(strings.TrimSpace(item))
		if item != "" && filter.Allows(item) {
			out = append(out, item)
		}
	}
	return out
}

func copyPublicState(state PublicLiveState) PublicLiveState {
	state.Nodes = append([]PublicNode{}, state.Nodes...)
	state.Routes = append([]PublicRoute{}, state.Routes...)
	state.RecentPulses = append([]PublicRoutePulse{}, state.RecentPulses...)
	state.RecentActivity = append([]PublicActivity{}, state.RecentActivity...)
	state.Stats.ResolutionBuckets = copyNestedCounter(state.Stats.ResolutionBuckets)
	state.Stats.ExcludedIATAs = copyCounter(state.Stats.ExcludedIATAs)
	state.Stats.ExcludedRegions = copyCounter(state.Stats.ExcludedRegions)
	return state
}

func copyNestedCounter(in map[string]map[string]int64) map[string]map[string]int64 {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]map[string]int64, len(in))
	for key, counters := range in {
		out[key] = copyCounter(counters)
	}
	return out
}

func copyCounter(in map[string]int64) map[string]int64 {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]int64, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func mergeCounters(left map[string]int64, right map[string]int64) map[string]int64 {
	out := copyCounter(left)
	if out == nil {
		out = map[string]int64{}
	}
	for key, value := range right {
		if value == 0 {
			continue
		}
		out[key] += value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func limitPublicNodes(items []PublicNode) []PublicNode {
	if len(items) > publicCacheMaxNodes {
		items = items[:publicCacheMaxNodes]
	}
	return append([]PublicNode{}, items...)
}

func limitPublicRoutes(items []PublicRoute) []PublicRoute {
	if len(items) > publicCacheMaxRoutes {
		items = items[:publicCacheMaxRoutes]
	}
	return append([]PublicRoute{}, items...)
}

func limitPublicPulses(items []PublicRoutePulse) []PublicRoutePulse {
	if len(items) > publicCacheMaxPulses {
		items = items[:publicCacheMaxPulses]
	}
	return append([]PublicRoutePulse{}, items...)
}

func limitPublicActivity(items []PublicActivity) []PublicActivity {
	if len(items) > publicCacheMaxActivity {
		items = items[:publicCacheMaxActivity]
	}
	return append([]PublicActivity{}, items...)
}

func truncatedCount(length int, limit int) int64 {
	if length <= limit {
		return 0
	}
	return int64(length - limit)
}
