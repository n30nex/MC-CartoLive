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
	if s.MQTTStatus != nil {
		status := s.MQTTStatus(time.Now())
		ready := 0
		if status.SessionReady {
			ready = 1
		}
		fmt.Fprintf(w, "# HELP meshcore_mqtt_session_ready MQTT connection and subscription readiness\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_session_ready gauge\n")
		fmt.Fprintf(w, "meshcore_mqtt_session_ready %d\n\n", ready)
		fmt.Fprintf(w, "# HELP meshcore_mqtt_queue_depth Current normalized MQTT ingest queue depth\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_queue_depth gauge\n")
		fmt.Fprintf(w, "meshcore_mqtt_queue_depth %d\n\n", status.QueueDepth)
		fmt.Fprintf(w, "# HELP meshcore_mqtt_queue_capacity Configured normalized MQTT ingest queue capacity\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_queue_capacity gauge\n")
		fmt.Fprintf(w, "meshcore_mqtt_queue_capacity %d\n\n", status.QueueCapacity)
		fmt.Fprintf(w, "# HELP meshcore_mqtt_queue_oldest_item_age_ms Age of the oldest accepted normalized message\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_queue_oldest_item_age_ms gauge\n")
		fmt.Fprintf(w, "meshcore_mqtt_queue_oldest_item_age_ms %d\n\n", status.OldestQueueItemAgeMs)
		fmt.Fprintf(w, "# HELP meshcore_mqtt_messages_accepted_total Normalized messages accepted since process start\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_messages_accepted_total counter\n")
		fmt.Fprintf(w, "meshcore_mqtt_messages_accepted_total %d\n\n", status.AcceptedMessages)
		fmt.Fprintf(w, "# HELP meshcore_mqtt_messages_processed_total Normalized messages processed since process start\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_messages_processed_total counter\n")
		fmt.Fprintf(w, "meshcore_mqtt_messages_processed_total %d\n\n", status.ProcessedMessages)
		fmt.Fprintf(w, "# HELP meshcore_mqtt_permanent_rejects_total Normalized messages durably classified as permanent decode rejects\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_permanent_rejects_total counter\n")
		fmt.Fprintf(w, "meshcore_mqtt_permanent_rejects_total %d\n\n", status.PermanentRejected)
		fmt.Fprintf(w, "# HELP meshcore_mqtt_handler_failures_total Accepted messages that did not reach a durable or permanent-reject outcome\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_handler_failures_total counter\n")
		fmt.Fprintf(w, "meshcore_mqtt_handler_failures_total %d\n\n", status.FailedMessages)
		fmt.Fprintf(w, "# HELP meshcore_mqtt_messages_dropped_total Primary queue drops since process start\n")
		fmt.Fprintf(w, "# TYPE meshcore_mqtt_messages_dropped_total counter\n")
		fmt.Fprintf(w, "meshcore_mqtt_messages_dropped_total %d\n\n", status.DroppedMessages)
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

		fmt.Fprintf(w, "# HELP meshcore_store_write_retries_total SQLite write retry attempts\n")
		fmt.Fprintf(w, "# TYPE meshcore_store_write_retries_total counter\n")
		fmt.Fprintf(w, "meshcore_store_write_retries_total %d\n\n", snap.StoreWriteRetries)
		fmt.Fprintf(w, "# HELP meshcore_store_write_failures_total SQLite write failures\n")
		fmt.Fprintf(w, "# TYPE meshcore_store_write_failures_total counter\n")
		fmt.Fprintf(w, "meshcore_store_write_failures_total %d\n\n", snap.StoreWriteFailures)
		fmt.Fprintf(w, "# HELP meshcore_store_write_full_errors_total SQLite full-disk failures\n")
		fmt.Fprintf(w, "# TYPE meshcore_store_write_full_errors_total counter\n")
		fmt.Fprintf(w, "meshcore_store_write_full_errors_total %d\n\n", snap.StoreWriteFullErrors)
		fmt.Fprintf(w, "# HELP meshcore_store_write_busy_errors_total SQLite busy failures since process start\n")
		fmt.Fprintf(w, "# TYPE meshcore_store_write_busy_errors_total counter\n")
		fmt.Fprintf(w, "meshcore_store_write_busy_errors_total %d\n\n", snap.StoreWriteBusyErrors)
		fmt.Fprintf(w, "# HELP meshcore_store_write_last_latency_ms Last SQLite write latency\n")
		fmt.Fprintf(w, "# TYPE meshcore_store_write_last_latency_ms gauge\n")
		fmt.Fprintf(w, "meshcore_store_write_last_latency_ms %d\n\n", snap.StoreWriteLastLatencyMs)
		fmt.Fprintf(w, "# HELP meshcore_ingest_duplicate_suppressions_total Idempotent primary duplicates suppressed since process start\n")
		fmt.Fprintf(w, "# TYPE meshcore_ingest_duplicate_suppressions_total counter\n")
		fmt.Fprintf(w, "meshcore_ingest_duplicate_suppressions_total %d\n\n", snap.IngestDuplicateSuppressions)
		fmt.Fprintf(w, "# HELP meshcore_derived_queue_depth Lower-priority projection queue depth\n")
		fmt.Fprintf(w, "# TYPE meshcore_derived_queue_depth gauge\n")
		fmt.Fprintf(w, "meshcore_derived_queue_depth %d\n\n", snap.DerivedQueueDepth)
		fmt.Fprintf(w, "# HELP meshcore_derived_queue_capacity Configured lower-priority projection queue capacity\n")
		fmt.Fprintf(w, "# TYPE meshcore_derived_queue_capacity gauge\n")
		fmt.Fprintf(w, "meshcore_derived_queue_capacity %d\n\n", snap.DerivedQueueCapacity)
		derivedOldestAge := currentQueueAgeMs(time.Now().UnixMilli(), snap.DerivedOldestAtMs)
		fmt.Fprintf(w, "# HELP meshcore_derived_queue_oldest_item_age_ms Age of the oldest queued lower-priority projection\n")
		fmt.Fprintf(w, "# TYPE meshcore_derived_queue_oldest_item_age_ms gauge\n")
		fmt.Fprintf(w, "meshcore_derived_queue_oldest_item_age_ms %d\n\n", derivedOldestAge)
		fmt.Fprintf(w, "# HELP meshcore_derived_accepted_total Projection jobs accepted since process start\n")
		fmt.Fprintf(w, "# TYPE meshcore_derived_accepted_total counter\n")
		fmt.Fprintf(w, "meshcore_derived_accepted_total %d\n\n", snap.DerivedAccepted)
		fmt.Fprintf(w, "# HELP meshcore_derived_processed_total Projection jobs completed since process start\n")
		fmt.Fprintf(w, "# TYPE meshcore_derived_processed_total counter\n")
		fmt.Fprintf(w, "meshcore_derived_processed_total %d\n\n", snap.DerivedProcessed)
		fmt.Fprintf(w, "# HELP meshcore_derived_dropped_total Lower-priority projection drops since process start\n")
		fmt.Fprintf(w, "# TYPE meshcore_derived_dropped_total counter\n")
		fmt.Fprintf(w, "meshcore_derived_dropped_total %d\n\n", snap.DerivedDropped)
		fmt.Fprintf(w, "# HELP meshcore_derived_failures_total Projection jobs that exceeded their budget or observed a store failure\n")
		fmt.Fprintf(w, "# TYPE meshcore_derived_failures_total counter\n")
		fmt.Fprintf(w, "meshcore_derived_failures_total %d\n\n", snap.DerivedFailures)

		for _, lane := range []struct {
			name                               string
			depth, oldestAt, lastWait, maxWait int64
		}{
			{"primary", snap.WriterPrimaryQueueDepth, snap.WriterPrimaryOldestAtMs, snap.WriterPrimaryLastWaitMs, snap.WriterPrimaryMaxWaitMs},
			{"live_core", snap.WriterLiveCoreQueueDepth, snap.WriterLiveCoreOldestAtMs, snap.WriterLiveCoreLastWaitMs, snap.WriterLiveCoreMaxWaitMs},
			{"background", snap.WriterBackgroundQueueDepth, snap.WriterBackgroundOldestAtMs, snap.WriterBackgroundLastWaitMs, snap.WriterBackgroundMaxWaitMs},
		} {
			fmt.Fprintf(w, "meshcore_writer_queue_depth{lane=%q} %d\n", lane.name, lane.depth)
			fmt.Fprintf(w, "meshcore_writer_queue_oldest_age_ms{lane=%q} %d\n", lane.name, currentQueueAgeMs(time.Now().UnixMilli(), lane.oldestAt))
			fmt.Fprintf(w, "meshcore_writer_last_wait_ms{lane=%q} %d\n", lane.name, lane.lastWait)
			fmt.Fprintf(w, "meshcore_writer_max_wait_ms{lane=%q} %d\n", lane.name, lane.maxWait)
		}
		fmt.Fprintln(w)
		fmt.Fprintf(w, "meshcore_primary_deadline_failures_total %d\n", snap.PrimaryDeadlineFailures)
		fmt.Fprintf(w, "meshcore_primary_persisted_total %d\n", snap.PrimaryPersisted)
		fmt.Fprintf(w, "meshcore_permanent_rejects_total %d\n", snap.PermanentRejects)
		fmt.Fprintf(w, "meshcore_derived_projection_lag_ms %d\n", snap.DerivedProjectionLagMs)
		fmt.Fprintf(w, "meshcore_derived_projection_failures_total %d\n", snap.DerivedProjectionFailures)
		fmt.Fprintf(w, "meshcore_derived_projection_queue_depth %d\n", snap.DerivedProjectionQueueDepth)
		fmt.Fprintf(w, "meshcore_derived_projection_queue_oldest_age_ms %d\n", currentQueueAgeMs(time.Now().UnixMilli(), snap.DerivedProjectionOldestAtMs))
		fmt.Fprintf(w, "meshcore_observation_to_broadcast_latency_ms %d\n", snap.LastBroadcastLatencyMs)
		fmt.Fprintf(w, "meshcore_observation_to_broadcast_max_latency_ms %d\n\n", snap.MaxBroadcastLatencyMs)
	}
	if s.Store != nil {
		storage := s.Store.StorageInfo()
		fmt.Fprintf(w, "# HELP meshcore_storage_free_bytes Current free bytes on the database filesystem\n")
		fmt.Fprintf(w, "# TYPE meshcore_storage_free_bytes gauge\n")
		fmt.Fprintf(w, "meshcore_storage_free_bytes %d\n\n", storage.FreeBytes)
		fmt.Fprintf(w, "# HELP meshcore_storage_free_percent Current free percentage on the database filesystem\n")
		fmt.Fprintf(w, "# TYPE meshcore_storage_free_percent gauge\n")
		fmt.Fprintf(w, "meshcore_storage_free_percent %.2f\n\n", storage.FreePercent)
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
