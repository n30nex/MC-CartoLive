package live

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const maxClients = 512

type Hub struct {
	log           *slog.Logger
	queueSize     int
	mu            sync.RWMutex
	clients       map[*client]struct{}
	upgrader      websocket.Upgrader
	seq           atomic.Int64
	latestSeq     atomic.Int64
	resumeEnabled atomic.Bool
	subsEnabled   atomic.Bool
	totalDropped  atomic.Int64
	queueHigh     atomic.Int64
	pingFailures  atomic.Int64
	displayMu     sync.Mutex
	nextDisplayAt int64
}

type client struct {
	id        string
	conn      *websocket.Conn
	send      chan Envelope
	created   time.Time
	dropped   atomic.Int64
	scopeMu   sync.RWMutex
	scope     *SubscriptionScope
	onClose   func()
	closeOnce sync.Once
	resetting atomic.Bool
}

type SubscriptionScope struct {
	Regions      []string  `json:"regions,omitempty"`
	PayloadTypes []string  `json:"payloadTypes,omitempty"`
	Events       []string  `json:"events,omitempty"`
	BBox         []float64 `json:"bbox,omitempty"`
	MessageOnly  bool      `json:"messageOnly,omitempty"`
}

type clientMessage struct {
	Version  int                `json:"v,omitempty"`
	Type     string             `json:"type"`
	ID       string             `json:"id,omitempty"`
	Scope    *SubscriptionScope `json:"scope,omitempty"`
	AfterSeq int64              `json:"afterSeq,omitempty"`
}

func NewHub(log *slog.Logger, queueSize int, allowedBaseURLs ...string) *Hub {
	if queueSize < 1 {
		queueSize = 128
	}
	allowedHosts := allowedOriginHosts(allowedBaseURLs)
	return &Hub{
		log:       log,
		queueSize: queueSize,
		clients:   map[*client]struct{}{},
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return websocketOriginAllowed(r, allowedHosts)
			},
		},
	}
}

func (h *Hub) SetResumeEnabled(enabled bool) {
	if h != nil {
		h.resumeEnabled.Store(enabled)
	}
}

func (h *Hub) SetSubscriptionsEnabled(enabled bool) {
	if h != nil {
		h.subsEnabled.Store(enabled)
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.ServeHTTPWithClose(w, r, nil)
}

// ServeHTTPWithClose reports whether the WebSocket upgrade succeeded and
// invokes onClose exactly once when that admitted connection is removed.
func (h *Hub) ServeHTTPWithClose(w http.ResponseWriter, r *http.Request, onClose func()) bool {
	h.mu.RLock()
	clientCount := len(h.clients)
	h.mu.RUnlock()
	if clientCount >= maxClients {
		http.Error(w, "too many connections", http.StatusServiceUnavailable)
		return false
	}
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Warn("websocket upgrade failed", "error", err)
		return false
	}
	c := &client{
		id:      uuid.NewString(),
		conn:    conn,
		send:    make(chan Envelope, h.queueSize),
		created: time.Now(),
		onClose: onClose,
	}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()

	now := time.Now().UnixMilli()
	latestSeq := h.LatestSeq()
	helloSeq := latestSeq
	if helloSeq <= 0 {
		helloSeq = h.seq.Add(1)
	}
	c.send <- Envelope{Version: 1, Type: "hello", Seq: helloSeq, LatestSeq: latestSeq, ServerTime: now, ReceivedAt: now, DisplayAt: now, ConnectionID: c.id}
	go h.writePump(c)
	go h.readPump(c)
	return true
}

func (h *Hub) Broadcast(event string, data any) {
	env := h.eventEnvelope(event, data)
	h.mu.Lock()
	clients := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()
	for _, c := range clients {
		safeSend(h, c, env)
	}
}

func (h *Hub) BroadcastPublicEvent(event PublicEvent) {
	if event.Seq > 0 {
		h.SetLatestSeq(event.Seq)
	}
	env := h.publicEventEnvelope(event)
	h.mu.Lock()
	clients := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()
	for _, c := range clients {
		if !clientMatchesPublicEvent(c, event) {
			continue
		}
		safeSend(h, c, env)
	}
}

func safeSend(h *Hub, c *client, env Envelope) {
	defer func() { _ = recover() }()
	h.observeQueueDepth(len(c.send))
	select {
	case c.send <- env:
	default:
		dropped := c.dropped.Add(1)
		h.totalDropped.Add(1)
		if c.resetting.CompareAndSwap(false, true) {
			// A full queue cannot reliably carry a lag marker. Close this client
			// asynchronously so broadcast/ingest never blocks; the reconnecting
			// client resumes from its retained event cursor.
			go h.removeWithReason(c, websocket.CloseTryAgainLater, fmt.Sprintf("client lagged; dropped=%d", dropped))
		}
	}
}

func (h *Hub) publicEventEnvelope(event PublicEvent) Envelope {
	now := time.Now().UnixMilli()
	return Envelope{
		Version:    1,
		Type:       "event",
		Event:      event.Type,
		Seq:        event.Seq,
		LatestSeq:  h.LatestSeq(),
		Data:       event.Data,
		ServerTime: now,
		ReceivedAt: event.ReceivedAt,
		DisplayAt:  h.reserveDisplayAt(now),
	}
}

func (h *Hub) eventEnvelope(event string, data any) Envelope {
	now := time.Now().UnixMilli()
	return Envelope{
		Version:    1,
		Type:       "event",
		Event:      event,
		Seq:        h.seq.Add(1),
		Data:       data,
		ServerTime: now,
		ReceivedAt: now,
		DisplayAt:  h.reserveDisplayAt(now),
	}
}

func (h *Hub) reserveDisplayAt(now int64) int64 {
	const eventSpacingMs = 140
	const maxPaceLagMs = 3500
	h.displayMu.Lock()
	defer h.displayMu.Unlock()
	if h.nextDisplayAt < now {
		h.nextDisplayAt = now
	}
	displayAt := h.nextDisplayAt
	h.nextDisplayAt += eventSpacingMs
	if h.nextDisplayAt-now > maxPaceLagMs {
		h.nextDisplayAt = now + maxPaceLagMs
	}
	return displayAt
}

func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *Hub) SetLatestSeq(seq int64) {
	for {
		current := h.latestSeq.Load()
		if seq <= current {
			return
		}
		if h.latestSeq.CompareAndSwap(current, seq) {
			return
		}
	}
}

func (h *Hub) LatestSeq() int64 {
	if h == nil {
		return 0
	}
	return h.latestSeq.Load()
}

type HubStats struct {
	Clients         int   `json:"clients"`
	QueueSize       int   `json:"queueSize"`
	QueueHighWater  int64 `json:"queueHighWater"`
	DroppedMessages int64 `json:"droppedMessages"`
	PingFailures    int64 `json:"pingFailures"`
	OldestClientMs  int64 `json:"oldestClientMs"`
}

func (h *Hub) Stats() HubStats {
	if h == nil {
		return HubStats{}
	}
	now := time.Now()
	stats := HubStats{
		QueueSize:       h.queueSize,
		QueueHighWater:  h.queueHigh.Load(),
		DroppedMessages: h.totalDropped.Load(),
		PingFailures:    h.pingFailures.Load(),
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	stats.Clients = len(h.clients)
	for c := range h.clients {
		age := now.Sub(c.created).Milliseconds()
		if age > stats.OldestClientMs {
			stats.OldestClientMs = age
		}
	}
	return stats
}

func (h *Hub) observeQueueDepth(depth int) {
	for {
		current := h.queueHigh.Load()
		if int64(depth) <= current {
			return
		}
		if h.queueHigh.CompareAndSwap(current, int64(depth)) {
			return
		}
	}
}

func (h *Hub) remove(c *client) {
	h.removeWithReason(c, websocket.CloseGoingAway, "server shutting down")
}

func (h *Hub) removeWithReason(c *client, closeCode int, reason string) {
	removed := false
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
		removed = true
	}
	h.mu.Unlock()
	if !removed {
		return
	}
	c.closeOnce.Do(func() {
		if c.onClose != nil {
			c.onClose()
		}
	})
	if c.conn != nil {
		_ = c.conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(closeCode, reason),
			time.Now().Add(250*time.Millisecond))
		_ = c.conn.Close()
	}
}

func (h *Hub) writePump(c *client) {
	ticker := time.NewTicker(25 * time.Second)
	defer func() {
		ticker.Stop()
		h.remove(c)
	}()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			data, err := json.Marshal(msg)
			if err != nil {
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				h.pingFailures.Add(1)
				return
			}
		}
	}
}

func (h *Hub) readPump(c *client) {
	defer h.remove(c)
	c.conn.SetReadLimit(4096)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var msg clientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(msg.Type)) {
		case "subscribe":
			if !h.subsEnabled.Load() {
				continue
			}
			c.scopeMu.Lock()
			if msg.Scope == nil {
				c.scope = &SubscriptionScope{}
			} else {
				scope := normalizeSubscriptionScope(*msg.Scope)
				c.scope = &scope
			}
			c.scopeMu.Unlock()
		case "unsubscribe":
			c.scopeMu.Lock()
			c.scope = nil
			c.scopeMu.Unlock()
		case "ping":
			now := time.Now().UnixMilli()
			safeSend(h, c, Envelope{Version: 1, Type: "pong", Seq: h.LatestSeq(), LatestSeq: h.LatestSeq(), ServerTime: now, ReceivedAt: now, DisplayAt: now})
		case "resume":
			if !h.resumeEnabled.Load() {
				continue
			}
			now := time.Now().UnixMilli()
			safeSend(h, c, Envelope{Version: 1, Type: "hello", Seq: h.LatestSeq(), LatestSeq: h.LatestSeq(), FromSeq: msg.AfterSeq, ToSeq: h.LatestSeq(), ServerTime: now, ReceivedAt: now, DisplayAt: now, ConnectionID: c.id})
		}
	}
}

func normalizeSubscriptionScope(scope SubscriptionScope) SubscriptionScope {
	scope.Regions = normalizeScopeStrings(scope.Regions, true)
	scope.PayloadTypes = normalizeScopeStrings(scope.PayloadTypes, true)
	scope.Events = normalizeScopeStrings(scope.Events, false)
	if len(scope.BBox) != 4 || !validScopeBBox(scope.BBox) {
		scope.BBox = nil
	}
	return scope
}

func normalizeScopeStrings(items []string, upper bool) []string {
	out := make([]string, 0, len(items))
	seen := map[string]struct{}{}
	for _, item := range items {
		item = strings.TrimSpace(item)
		if upper {
			item = strings.ToUpper(item)
		}
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func validScopeBBox(bbox []float64) bool {
	if len(bbox) != 4 {
		return false
	}
	for _, value := range bbox {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return bbox[1] >= -90 && bbox[3] <= 90 && bbox[0] >= -180 && bbox[2] <= 180 && bbox[0] < bbox[2] && bbox[1] < bbox[3]
}

func clientMatchesPublicEvent(c *client, event PublicEvent) bool {
	c.scopeMu.RLock()
	scope := c.scope
	c.scopeMu.RUnlock()
	if scope == nil {
		return true
	}
	if !scopeListMatches(scope.Events, event.Type, false) {
		return false
	}
	if !scopeListMatches(scope.Regions, event.Region, true) {
		return false
	}
	if !scopeListMatches(scope.PayloadTypes, event.PayloadTypeName, true) {
		return false
	}
	if scope.MessageOnly && !event.Message {
		return false
	}
	if len(scope.BBox) == 4 && !publicEventIntersectsBBox(event, scope.BBox) {
		return false
	}
	return true
}

func scopeListMatches(list []string, value string, upper bool) bool {
	if list == nil {
		return true
	}
	if len(list) == 0 {
		return false
	}
	value = strings.TrimSpace(value)
	if upper {
		value = strings.ToUpper(value)
	}
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func publicEventIntersectsBBox(event PublicEvent, bbox []float64) bool {
	switch data := event.Data.(type) {
	case PublicNode:
		return pointInBBox(data.Longitude, data.Latitude, bbox)
	case PublicActivity:
		if data.ObserverLocation != nil && pointInBBox(data.ObserverLocation.Lng, data.ObserverLocation.Lat, bbox) {
			return true
		}
		if data.MessageAnchor != nil && pointInBBox(data.MessageAnchor.Lng, data.MessageAnchor.Lat, bbox) {
			return true
		}
	case PublicRoutePulse:
		for _, segment := range data.Segments {
			if pointInBBox(segment.From.Lng, segment.From.Lat, bbox) || pointInBBox(segment.To.Lng, segment.To.Lat, bbox) {
				return true
			}
		}
	}
	return len(bbox) != 4
}

func pointInBBox(lng, lat float64, bbox []float64) bool {
	return len(bbox) == 4 && lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

func allowedOriginHosts(baseURLs []string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, raw := range baseURLs {
		parsed, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || parsed.Host == "" {
			continue
		}
		out[strings.ToLower(parsed.Host)] = struct{}{}
	}
	return out
}

func websocketOriginAllowed(r *http.Request, allowedHosts map[string]struct{}) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	originHost := strings.ToLower(parsed.Host)
	requestHost := strings.ToLower(r.Host)
	if originHost == requestHost {
		return true
	}
	if _, ok := allowedHosts[originHost]; ok {
		return true
	}
	return isLocalHost(parsed.Hostname()) && isLocalHost(hostnameOnly(r.Host))
}

func isLocalHost(hostname string) bool {
	switch strings.ToLower(strings.Trim(hostname, "[]")) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

func hostnameOnly(hostport string) string {
	parsed, err := url.Parse("//" + hostport)
	if err != nil || parsed.Hostname() == "" {
		return hostport
	}
	return parsed.Hostname()
}
