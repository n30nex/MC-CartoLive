package api

import (
	"fmt"
	"net/http"
	"runtime"
	"time"
)

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	fmt.Fprintf(w, "# HELP meshcore_goroutines Number of goroutines\n")
	fmt.Fprintf(w, "# TYPE meshcore_goroutines gauge\n")
	fmt.Fprintf(w, "meshcore_goroutines %d\n\n", runtime.NumGoroutine())

	fmt.Fprintf(w, "# HELP meshcore_memory_alloc_bytes Current memory allocation\n")
	fmt.Fprintf(w, "# TYPE meshcore_memory_alloc_bytes gauge\n")
	fmt.Fprintf(w, "meshcore_memory_alloc_bytes %d\n\n", m.Alloc)

	fmt.Fprintf(w, "# HELP meshcore_memory_sys_bytes Total system memory\n")
	fmt.Fprintf(w, "# TYPE meshcore_memory_sys_bytes gauge\n")
	fmt.Fprintf(w, "meshcore_memory_sys_bytes %d\n\n", m.Sys)

	fmt.Fprintf(w, "# HELP meshcore_memory_gc_cycles Total GC cycles\n")
	fmt.Fprintf(w, "# TYPE meshcore_memory_gc_cycles counter\n")
	fmt.Fprintf(w, "meshcore_memory_gc_cycles %d\n\n", m.NumGC)

	if s.MQTTConnected != nil {
		connected := 0
		if s.MQTTConnected() {
			connected = 1
		}
		fmt.Fprintf(w, "# HELP meshcore_mqtt_connected MQTT broker connection status\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_connected gauge\n")
		fmt.Fprintf(w, "meshcore_mqtt_connected %d\n\n", connected)
	}

	if s.MQTTTotal != nil {
		fmt.Fprintf(w, "# HELP meshcore_mqtt_messages_total Total MQTT messages received\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_messages_total counter\n")
		fmt.Fprintf(w, "meshcore_mqtt_messages_total %d\n\n", s.MQTTTotal())
	}

	fmt.Fprintf(w, "# HELP meshcore_ws_clients Current WebSocket client count\n")
	fmt.Fprintf(w, "# TYPE meshcore_ws_clients gauge\n")
	fmt.Fprintf(w, "meshcore_ws_clients %d\n\n", s.wsClientCount())

	if s.Runtime != nil {
		snap := s.Runtime.Snapshot()
		fmt.Fprintf(w, "# HELP meshcore_public_state_requests_total Public state API requests\n")
		fmt.Fprintf(w, "# TYPE meshcore_public_state_requests_total counter\n")
		fmt.Fprintf(w, "meshcore_public_state_requests_total %d\n\n", snap.PublicStateRequests)

		fmt.Fprintf(w, "# HELP meshcore_public_history_requests_total Public history API requests\n")
		fmt.Fprintf(w, "# TYPE meshcore_public_history_requests_total counter\n")
		fmt.Fprintf(w, "meshcore_public_history_requests_total %d\n\n", snap.PublicHistoryRequests)

		fmt.Fprintf(w, "# HELP meshcore_cache_refresh_failures_total Cache refresh failures\n")
		fmt.Fprintf(w, "# TYPE meshcore_cache_refresh_failures_total counter\n")
		fmt.Fprintf(w, "meshcore_cache_refresh_failures_total %d\n\n", snap.CacheRefreshFailures)
	}

	if s.PublicState != nil {
		if state, ok := s.PublicState(); ok {
			fmt.Fprintf(w, "# HELP meshcore_public_nodes Active public nodes\n")
			fmt.Fprintf(w, "# TYPE meshcore_public_nodes gauge\n")
			fmt.Fprintf(w, "meshcore_public_nodes %d\n\n", len(state.Nodes))

			fmt.Fprintf(w, "# HELP meshcore_public_routes Active public routes\n")
			fmt.Fprintf(w, "# TYPE meshcore_public_routes gauge\n")
			fmt.Fprintf(w, "meshcore_public_routes %d\n\n", len(state.Routes))

			fmt.Fprintf(w, "# HELP meshcore_public_packets_total Total packets\n")
			fmt.Fprintf(w, "# TYPE meshcore_public_packets_total gauge\n")
			fmt.Fprintf(w, "meshcore_public_packets_total %d\n\n", state.Stats.Packets)
		}
	}

	fmt.Fprintf(w, "# HELP meshcore_uptime_seconds Server uptime\n")
	fmt.Fprintf(w, "# TYPE meshcore_uptime_seconds gauge\n")
	fmt.Fprintf(w, "meshcore_uptime_seconds %.0f\n", time.Since(s.startTime).Seconds())
}
