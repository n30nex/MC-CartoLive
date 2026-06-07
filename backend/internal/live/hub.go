package live

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Hub struct {
	log           *slog.Logger
	queueSize     int
	mu            sync.RWMutex
	clients       map[*client]struct{}
	upgrader      websocket.Upgrader
	seq           atomic.Int64
	totalDropped  atomic.Int64
	queueHigh     atomic.Int64
	pingFailures  atomic.Int64
	displayMu     sync.Mutex
	nextDisplayAt int64
}

type client struct {
	id      string
	conn    *websocket.Conn
	send    chan Envelope
	created time.Time
	dropped int
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

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Warn("websocket upgrade failed", "error", err)
		return
	}
	c := &client{
		id:      uuid.NewString(),
		conn:    conn,
		send:    make(chan Envelope, h.queueSize),
		created: time.Now(),
	}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()

	now := time.Now().UnixMilli()
	c.send <- Envelope{Version: 1, Type: "hello", Seq: h.seq.Add(1), ServerTime: now, ReceivedAt: now, DisplayAt: now, ConnectionID: c.id}
	go h.writePump(c)
	go h.readPump(c)
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
		h.observeQueueDepth(len(c.send))
		select {
		case c.send <- env:
		default:
			c.dropped++
			h.totalDropped.Add(1)
			now := time.Now().UnixMilli()
			lag := Envelope{Version: 1, Type: "lagged", Seq: h.seq.Add(1), ServerTime: now, ReceivedAt: now, DisplayAt: now, DroppedCount: c.dropped, Since: c.created.UnixMilli()}
			select {
			case c.send <- lag:
			default:
			}
		}
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
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
	c.conn.WriteControl(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseGoingAway, "server shutting down"),
		time.Now().Add(2*time.Second))
	_ = c.conn.Close()
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
		var incoming struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &incoming); err != nil {
			continue
		}
	}
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
