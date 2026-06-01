package live

import (
	"strings"
	"sync"
	"time"
)

const (
	publicCacheMaxNodes    = 2500
	publicCacheMaxRoutes   = 2500
	publicCacheMaxPulses   = 240
	publicCacheMaxActivity = 240
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
	mu        sync.RWMutex
	filter    PublicIATAFilter
	state     PublicLiveState
	ready     bool
	updatedAt time.Time
	anomalies map[string]int64
	truncated PublicCacheTruncation
}

type PublicCacheStatus struct {
	Ready                   bool  `json:"ready"`
	UpdatedAt               int64 `json:"updatedAt"`
	CacheAgeMs              int64 `json:"cacheAgeMs"`
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
	return &PublicStateCache{filter: filter, anomalies: map[string]int64{}}
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
	c.mu.Lock()
	state.Stats.ExcludedIATAs = mergeCounters(excluded, c.anomalies)
	state.Stats.ExcludedRegions = copyCounter(state.Stats.ExcludedIATAs)
	c.state = copyPublicState(state)
	c.ready = true
	c.updatedAt = time.Now()
	c.truncated = truncated
	c.mu.Unlock()
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
	return PublicCacheStatus{
		Ready:                   true,
		UpdatedAt:               c.updatedAt.UnixMilli(),
		CacheAgeMs:              age,
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
	c.state.Nodes = limitPublicNodes(next)
	c.state.Stats.ActiveNodes = int64(len(c.state.Nodes))
	c.updatedAt = time.Now()
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
	c.state.RecentActivity = limitPublicActivity(append([]PublicActivity{activity}, c.state.RecentActivity...))
	c.state.Stats.ResolutionBuckets = PublicResolutionCounters(c.state.RecentActivity)
	if activity.Kind == "packet" || activity.Kind == "route" {
		c.state.Stats.Packets++
	}
	if activity.HeardAt > c.state.ServerTime {
		c.state.ServerTime = activity.HeardAt
		c.state.Stats.ServerTime = activity.HeardAt
	}
	c.updatedAt = time.Now()
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
	c.state.RecentPulses = limitPublicPulses(append([]PublicRoutePulse{pulse}, c.state.RecentPulses...))
	if pulse.HeardAt > c.state.ServerTime {
		c.state.ServerTime = pulse.HeardAt
		c.state.Stats.ServerTime = pulse.HeardAt
	}
	c.updatedAt = time.Now()
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
	c.updatedAt = time.Now()
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
