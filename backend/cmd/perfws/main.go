// Command perfws runs the real public WebSocket handler with many loopback
// clients. It proves normal-client delivery, slow-client isolation, quiet
// connection stability, and goroutine cleanup without external services.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"meshcore-canada-live-map/backend/internal/api"
	"meshcore-canada-live-map/backend/internal/live"
)

type receiver struct {
	conn   *websocket.Conn
	events atomic.Int64
	lagged atomic.Int64
	active atomic.Bool
}

type report struct {
	Passed               bool     `json:"passed"`
	Clients              int      `json:"clients"`
	NormalClients        int      `json:"normalClients"`
	DurationSeconds      float64  `json:"durationSeconds"`
	QuietSeconds         float64  `json:"quietSeconds"`
	BroadcastEvents      int64    `json:"broadcastEvents"`
	NormalEventsMin      int64    `json:"normalEventsMin"`
	NormalEventsMax      int64    `json:"normalEventsMax"`
	NormalLaggedMessages int64    `json:"normalLaggedMessages"`
	SlowClientDrops      int64    `json:"slowClientDrops"`
	SlowClientReset      bool     `json:"slowClientReset"`
	QuietClientsBefore   int      `json:"quietClientsBefore"`
	QuietClientsAfter    int      `json:"quietClientsAfter"`
	Reconnects           int      `json:"reconnects"`
	GoroutinesBefore     int      `json:"goroutinesBefore"`
	GoroutinesAfter      int      `json:"goroutinesAfter"`
	GoroutineGrowth      int      `json:"goroutineGrowth"`
	HubQueueHighWater    int64    `json:"hubQueueHighWater"`
	HubPingFailures      int64    `json:"hubPingFailures"`
	Assertions           []string `json:"assertions"`
	Failures             []string `json:"failures,omitempty"`
}

func main() {
	clients := flag.Int("clients", 250, "public WebSocket clients including one slow client")
	duration := flag.Duration("duration", 30*time.Minute, "total connection duration")
	quiet := flag.Duration("quiet", 70*time.Second, "traffic-free tail interval")
	queue := flag.Int("queue", 64, "per-client server queue for the isolation phase")
	isolationEvents := flag.Int("isolation-events", 1000, "large events used to isolate the slow client")
	isolationRate := flag.Int("isolation-rate", 100, "isolation events per second")
	isolationBytes := flag.Int("isolation-bytes", 4096, "payload bytes per isolation event")
	flag.Parse()

	result := run(*clients, *duration, *quiet, *queue, *isolationEvents, *isolationRate, *isolationBytes)
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(result)
	if !result.Passed {
		os.Exit(1)
	}
}

func run(clientCount int, duration, quiet time.Duration, queueSize, isolationEvents, isolationRate, isolationBytes int) report {
	r := report{
		Clients:         clientCount,
		NormalClients:   clientCount - 1,
		DurationSeconds: duration.Seconds(),
		QuietSeconds:    quiet.Seconds(),
		Assertions: []string{
			"all normal clients receive every event without lagged frames",
			"the intentionally slow client alone causes bounded queue drops/reset",
			"quiet traffic causes no normal-client disconnect or reconnect",
			"all WebSocket goroutines are reclaimed after cleanup",
		},
	}
	if clientCount < 2 || clientCount > 500 {
		r.Failures = append(r.Failures, "clients must be between 2 and 500")
		return r
	}
	if duration <= 0 || quiet < 0 || quiet >= duration {
		r.Failures = append(r.Failures, "duration must be positive and greater than quiet interval")
		return r
	}
	if queueSize < 1 || isolationEvents < 1 || isolationRate < 1 || isolationBytes < 256 {
		r.Failures = append(r.Failures, "invalid isolation configuration")
		return r
	}
	isolationDuration := time.Duration(isolationEvents) * time.Second / time.Duration(isolationRate)
	if isolationDuration+quiet >= duration {
		r.Failures = append(r.Failures, "duration must include time for isolation and quiet phases")
		return r
	}

	r.GoroutinesBefore = runtime.NumGoroutine()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := live.NewHub(log, queueSize)
	hub.SetResumeEnabled(true)
	server := &api.Server{
		Config: api.Config{
			PublicMode:          true,
			TrustProxyHeaders:   true,
			TrustedProxyCIDRs:   []string{"127.0.0.0/8", "::1/128"},
			PublicEventsEnabled: true,
		},
		PublicHub: hub,
		Log:       log,
	}
	httpServer := httptest.NewServer(server.Routes())
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws/public"

	receivers := make([]*receiver, clientCount)
	var dialWG sync.WaitGroup
	dialErrs := make(chan error, clientCount)
	for i := 0; i < clientCount; i++ {
		dialWG.Add(1)
		go func(index int) {
			defer dialWG.Done()
			header := http.Header{}
			header.Set("Origin", httpServer.URL)
			header.Set("X-Forwarded-For", syntheticIP(index))
			dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
			conn, response, err := dialer.Dial(wsURL, header)
			if response != nil && response.Body != nil {
				_ = response.Body.Close()
			}
			if err != nil {
				dialErrs <- fmt.Errorf("client %d: %w", index, err)
				return
			}
			receiver := &receiver{conn: conn}
			receiver.active.Store(true)
			receivers[index] = receiver
		}(i)
	}
	dialWG.Wait()
	close(dialErrs)
	for err := range dialErrs {
		r.Failures = append(r.Failures, err.Error())
	}
	if len(r.Failures) > 0 {
		closeReceivers(receivers)
		httpServer.Close()
		server.Shutdown()
		return r
	}

	// Read the slow client's hello frame, then deliberately stop consuming its
	// socket. A small TCP receive buffer makes queue isolation deterministic.
	slow := receivers[0]
	_ = slow.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	if _, _, err := slow.conn.ReadMessage(); err != nil {
		r.Failures = append(r.Failures, "slow client did not receive hello: "+err.Error())
	}
	_ = slow.conn.SetReadDeadline(time.Time{})
	if tcp, ok := slow.conn.UnderlyingConn().(*net.TCPConn); ok {
		_ = tcp.SetReadBuffer(1024)
	}

	var readersWG sync.WaitGroup
	for i := 1; i < len(receivers); i++ {
		readersWG.Add(1)
		go readNormal(receivers[i], &readersWG)
	}
	deadline := time.Now().Add(10 * time.Second)
	for hub.ClientCount() != clientCount && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if hub.ClientCount() != clientCount {
		r.Failures = append(r.Failures, fmt.Sprintf("hub clients=%d want=%d", hub.ClientCount(), clientCount))
	}

	started := time.Now()
	largePayload := strings.Repeat("x", isolationBytes)
	isolationTicker := time.NewTicker(time.Second / time.Duration(isolationRate))
	for i := 0; i < isolationEvents; i++ {
		<-isolationTicker.C
		hub.Broadcast("load", map[string]any{"phase": "slow-isolation", "index": i, "payload": largePayload})
		r.BroadcastEvents++
	}
	isolationTicker.Stop()

	quietStartAt := started.Add(duration - quiet)
	regularTicker := time.NewTicker(time.Second)
	quietTimer := time.NewTimer(time.Until(quietStartAt))
steady:
	for {
		select {
		case <-regularTicker.C:
			hub.Broadcast("load", map[string]any{"phase": "steady"})
			r.BroadcastEvents++
		case <-quietTimer.C:
			break steady
		}
	}
	regularTicker.Stop()
	r.QuietClientsBefore = activeNormal(receivers)
	time.Sleep(time.Until(started.Add(duration)))
	r.QuietClientsAfter = activeNormal(receivers)

	// Give normal readers a bounded drain window before evaluating delivery.
	drainDeadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(drainDeadline) {
		if allNormalAt(receivers, r.BroadcastEvents) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	r.NormalEventsMin, r.NormalEventsMax = normalEventBounds(receivers)
	for i := 1; i < len(receivers); i++ {
		r.NormalLaggedMessages += receivers[i].lagged.Load()
	}
	hubStats := hub.Stats()
	r.SlowClientDrops = hubStats.DroppedMessages
	r.SlowClientReset = hubStats.DroppedMessages > 0 || hubStats.Clients < clientCount
	r.HubQueueHighWater = hubStats.QueueHighWater
	r.HubPingFailures = hubStats.PingFailures

	if r.NormalEventsMin != r.BroadcastEvents || r.NormalEventsMax != r.BroadcastEvents {
		r.Failures = append(r.Failures, fmt.Sprintf("normal delivery range=%d..%d want=%d", r.NormalEventsMin, r.NormalEventsMax, r.BroadcastEvents))
	}
	if r.NormalLaggedMessages != 0 {
		r.Failures = append(r.Failures, fmt.Sprintf("normal clients received %d lagged frames", r.NormalLaggedMessages))
	}
	if !r.SlowClientReset {
		r.Failures = append(r.Failures, "slow client did not trigger queue isolation/reset")
	}
	if r.QuietClientsBefore != clientCount-1 || r.QuietClientsAfter != r.QuietClientsBefore {
		r.Failures = append(r.Failures, fmt.Sprintf("normal clients changed during quiet interval: %d -> %d", r.QuietClientsBefore, r.QuietClientsAfter))
	}
	if hubStats.PingFailures != 0 {
		r.Failures = append(r.Failures, fmt.Sprintf("hub ping failures=%d", hubStats.PingFailures))
	}

	closeReceivers(receivers)
	httpServer.Close()
	server.Shutdown()
	readersWG.Wait()
	cleanupDeadline := time.Now().Add(10 * time.Second)
	for hub.ClientCount() != 0 && time.Now().Before(cleanupDeadline) {
		time.Sleep(20 * time.Millisecond)
	}
	runtime.GC()
	time.Sleep(250 * time.Millisecond)
	r.GoroutinesAfter = runtime.NumGoroutine()
	r.GoroutineGrowth = r.GoroutinesAfter - r.GoroutinesBefore
	if hub.ClientCount() != 0 {
		r.Failures = append(r.Failures, fmt.Sprintf("hub retained %d clients after cleanup", hub.ClientCount()))
	}
	if r.GoroutineGrowth > 0 {
		r.Failures = append(r.Failures, fmt.Sprintf("goroutines grew by %d", r.GoroutineGrowth))
	}
	r.Passed = len(r.Failures) == 0
	return r
}

func readNormal(receiver *receiver, wg *sync.WaitGroup) {
	defer wg.Done()
	defer receiver.active.Store(false)
	for {
		var envelope live.Envelope
		if err := receiver.conn.ReadJSON(&envelope); err != nil {
			return
		}
		switch envelope.Type {
		case "event":
			receiver.events.Add(1)
		case "lagged":
			receiver.lagged.Add(1)
		}
	}
}

func activeNormal(receivers []*receiver) int {
	count := 0
	for i := 1; i < len(receivers); i++ {
		if receivers[i] != nil && receivers[i].active.Load() {
			count++
		}
	}
	return count
}

func allNormalAt(receivers []*receiver, expected int64) bool {
	for i := 1; i < len(receivers); i++ {
		if receivers[i] == nil || receivers[i].events.Load() != expected || receivers[i].lagged.Load() != 0 {
			return false
		}
	}
	return true
}

func normalEventBounds(receivers []*receiver) (int64, int64) {
	minValue := int64(^uint64(0) >> 1)
	maxValue := int64(0)
	for i := 1; i < len(receivers); i++ {
		value := receivers[i].events.Load()
		if value < minValue {
			minValue = value
		}
		if value > maxValue {
			maxValue = value
		}
	}
	if minValue == int64(^uint64(0)>>1) {
		minValue = 0
	}
	return minValue, maxValue
}

func closeReceivers(receivers []*receiver) {
	for _, receiver := range receivers {
		if receiver != nil && receiver.conn != nil {
			_ = receiver.conn.Close()
		}
	}
}

func syntheticIP(index int) string {
	return fmt.Sprintf("198.18.%d.%d", index/250, index%250+1)
}
