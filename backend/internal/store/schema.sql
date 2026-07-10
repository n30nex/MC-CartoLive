CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packets (
  packet_hash TEXT PRIMARY KEY,
  raw_hex TEXT NOT NULL,
  route_type INTEGER NOT NULL,
  route_type_name TEXT NOT NULL,
  payload_type INTEGER NOT NULL,
  payload_type_name TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  hash_size INTEGER NOT NULL,
  hop_count INTEGER NOT NULL,
  path_hex TEXT NOT NULL,
  payload_hex TEXT NOT NULL,
  invalid_for_map INTEGER NOT NULL DEFAULT 0,
  invalid_reason TEXT NOT NULL DEFAULT '',
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS packet_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingest_id TEXT NOT NULL DEFAULT '',
  packet_hash TEXT NOT NULL,
  topic TEXT NOT NULL,
  iata TEXT NOT NULL,
  observer_public_key TEXT NOT NULL,
  observer_name TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  heard_at_ms INTEGER NOT NULL,
  rssi REAL,
  snr REAL,
  score REAL,
  route_type INTEGER NOT NULL,
  route_type_name TEXT NOT NULL,
  payload_type INTEGER NOT NULL,
  payload_type_name TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  hash_size INTEGER NOT NULL,
  hop_count INTEGER NOT NULL,
  path_hex TEXT NOT NULL,
  payload_hex TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'unresolved',
  resolution_reason TEXT NOT NULL DEFAULT '',
  invalid_for_map INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  message_sender TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(packet_hash) REFERENCES packets(packet_hash)
);

CREATE INDEX IF NOT EXISTS idx_observations_recent_id ON packet_observations(heard_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_observations_packet_hash ON packet_observations(packet_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_ingest_id ON packet_observations(ingest_id) WHERE ingest_id != '';
CREATE INDEX IF NOT EXISTS idx_observations_resolution ON packet_observations(resolution_status, heard_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_observations_iata ON packet_observations(iata, heard_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_observations_observer_recent ON packet_observations(observer_public_key, heard_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_observations_message_recent ON packet_observations(heard_at_ms DESC, id DESC) WHERE message_text != '';
CREATE INDEX IF NOT EXISTS idx_observations_iata_message_recent ON packet_observations(iata, heard_at_ms DESC, id DESC) WHERE message_text != '';

CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  node_type INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'unknown',
  latitude REAL,
  longitude REAL,
  location_source TEXT NOT NULL DEFAULT '',
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  supports_multibyte TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS node_iatas (
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(public_key, iata),
  FOREIGN KEY(public_key) REFERENCES nodes(public_key)
);

CREATE INDEX IF NOT EXISTS idx_node_iatas_iata_recent ON node_iatas(iata, last_seen_ms DESC);

CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen_ms DESC);

CREATE TABLE IF NOT EXISTS node_short_ids (
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  hash_size INTEGER NOT NULL,
  prefix_hex TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'unknown',
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(public_key, iata, hash_size, prefix_hex),
  FOREIGN KEY(public_key) REFERENCES nodes(public_key)
);

CREATE INDEX IF NOT EXISTS idx_short_ids_lookup ON node_short_ids(iata, hash_size, prefix_hex);

CREATE TABLE IF NOT EXISTS observers (
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  last_seen_ms INTEGER NOT NULL,
  packet_count INTEGER NOT NULL DEFAULT 0,
  status_json TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(public_key, iata)
);

CREATE INDEX IF NOT EXISTS idx_observers_iata_recent ON observers(iata, last_seen_ms DESC);
CREATE INDEX IF NOT EXISTS idx_observers_last_seen ON observers(last_seen_ms DESC);

CREATE TABLE IF NOT EXISTS observer_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  status_json TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observer_status_recent ON observer_status(received_at_ms DESC);

CREATE TABLE IF NOT EXISTS live_edge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingest_id TEXT NOT NULL DEFAULT '',
  packet_hash TEXT NOT NULL,
  observation_id INTEGER NOT NULL,
  payload_type INTEGER NOT NULL,
  payload_type_name TEXT NOT NULL,
  message_sender TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  message_anchor_json TEXT NOT NULL DEFAULT '',
  heard_at_ms INTEGER NOT NULL,
  segments_json TEXT NOT NULL,
  render_reason TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(observation_id) REFERENCES packet_observations(id)
);

CREATE INDEX IF NOT EXISTS idx_live_edge_events_recent ON live_edge_events(heard_at_ms DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_edge_events_ingest_id ON live_edge_events(ingest_id) WHERE ingest_id != '';
CREATE INDEX IF NOT EXISTS idx_live_edge_events_observation ON live_edge_events(observation_id);
CREATE INDEX IF NOT EXISTS idx_live_edge_events_payload_recent ON live_edge_events(payload_type_name, heard_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_live_edge_events_message_recent ON live_edge_events(heard_at_ms DESC, id DESC) WHERE message_text != '';
CREATE INDEX IF NOT EXISTS idx_live_edge_events_payload_message_recent ON live_edge_events(payload_type_name, heard_at_ms DESC, id DESC) WHERE message_text != '';

CREATE TABLE IF NOT EXISTS public_packet_paths (
  edge_id INTEGER PRIMARY KEY,
  observation_id INTEGER NOT NULL,
  mappable INTEGER NOT NULL DEFAULT 1,
  heard_at_ms INTEGER NOT NULL,
  iata TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  payload_type_name TEXT NOT NULL DEFAULT '',
  message_sender TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  hop_count INTEGER NOT NULL DEFAULT 0,
  segment_count INTEGER NOT NULL DEFAULT 0,
  distance_km REAL NOT NULL DEFAULT 0,
  route_ids_json TEXT NOT NULL DEFAULT '[]',
  endpoint_labels_json TEXT NOT NULL DEFAULT '[]',
  segments_json TEXT NOT NULL DEFAULT '[]',
  search_text TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(edge_id) REFERENCES live_edge_events(id),
  FOREIGN KEY(observation_id) REFERENCES packet_observations(id)
);

CREATE INDEX IF NOT EXISTS idx_public_packet_paths_recent ON public_packet_paths(mappable, heard_at_ms DESC, edge_id DESC);
CREATE INDEX IF NOT EXISTS idx_public_packet_paths_region_recent ON public_packet_paths(region, mappable, heard_at_ms DESC, edge_id DESC);
CREATE INDEX IF NOT EXISTS idx_public_packet_paths_payload_recent ON public_packet_paths(payload_type_name, mappable, heard_at_ms DESC, edge_id DESC);
CREATE INDEX IF NOT EXISTS idx_public_packet_paths_message_recent ON public_packet_paths(mappable, heard_at_ms DESC, edge_id DESC) WHERE message_text != '';

CREATE TABLE IF NOT EXISTS public_route_summaries (
  route_id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  from_label TEXT NOT NULL,
  from_lat REAL NOT NULL,
  from_lng REAL NOT NULL,
  from_path_hash3 TEXT NOT NULL DEFAULT '',
  to_node_id TEXT NOT NULL,
  to_label TEXT NOT NULL,
  to_lat REAL NOT NULL,
  to_lng REAL NOT NULL,
  to_path_hash3 TEXT NOT NULL DEFAULT '',
  distance_km REAL NOT NULL DEFAULT 0,
  packet_count INTEGER NOT NULL DEFAULT 0,
  last_heard_ms INTEGER NOT NULL,
  payload_type_names_json TEXT NOT NULL DEFAULT '[]',
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_route_summaries_last_heard ON public_route_summaries(last_heard_ms DESC);
CREATE INDEX IF NOT EXISTS idx_public_route_summaries_packet_count ON public_route_summaries(packet_count DESC, last_heard_ms DESC);

CREATE TABLE IF NOT EXISTS public_route_summary_edges (
  edge_id INTEGER PRIMARY KEY,
  heard_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_route_summary_edges_heard ON public_route_summary_edges(heard_at_ms DESC);

CREATE TABLE IF NOT EXISTS public_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  iata TEXT NOT NULL DEFAULT '',
  payload_type_name TEXT NOT NULL DEFAULT '',
  message_flag INTEGER NOT NULL DEFAULT 0,
  route_ids_json TEXT NOT NULL DEFAULT '[]',
  node_ids_json TEXT NOT NULL DEFAULT '[]',
  public_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_events_time ON public_events(occurred_at_ms DESC, seq DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_events_dedupe_key ON public_events(dedupe_key) WHERE dedupe_key != '';
CREATE INDEX IF NOT EXISTS idx_public_events_seq_time ON public_events(seq, occurred_at_ms);
CREATE INDEX IF NOT EXISTS idx_public_events_seq ON public_events(seq);
CREATE INDEX IF NOT EXISTS idx_public_events_region_seq ON public_events(region, seq);
CREATE INDEX IF NOT EXISTS idx_public_events_payload_seq ON public_events(payload_type_name, seq);
CREATE INDEX IF NOT EXISTS idx_public_events_type_seq ON public_events(event_type, seq);
CREATE INDEX IF NOT EXISTS idx_public_events_message_seq ON public_events(message_flag, seq);

CREATE TABLE IF NOT EXISTS public_coverage_cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'manual',
  region TEXT NOT NULL DEFAULT '',
  min_lat REAL NOT NULL,
  min_lng REAL NOT NULL,
  max_lat REAL NOT NULL,
  max_lng REAL NOT NULL,
  intensity REAL NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  age_bucket TEXT NOT NULL DEFAULT 'unknown',
  updated_at_ms INTEGER NOT NULL,
  attribution TEXT NOT NULL DEFAULT '',
  precision_bucket TEXT NOT NULL DEFAULT 'coarse'
);

CREATE INDEX IF NOT EXISTS idx_public_coverage_cells_region ON public_coverage_cells(region, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_public_coverage_cells_updated ON public_coverage_cells(updated_at_ms DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS public_packet_paths_fts USING fts5(search_text);

CREATE TRIGGER IF NOT EXISTS public_packet_paths_ai AFTER INSERT ON public_packet_paths BEGIN
  INSERT INTO public_packet_paths_fts(rowid, search_text) VALUES (new.edge_id, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS public_packet_paths_au AFTER UPDATE ON public_packet_paths BEGIN
  DELETE FROM public_packet_paths_fts WHERE rowid=old.edge_id;
  INSERT INTO public_packet_paths_fts(rowid, search_text) VALUES (new.edge_id, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS public_packet_paths_ad AFTER DELETE ON public_packet_paths BEGIN
  DELETE FROM public_packet_paths_fts WHERE rowid=old.edge_id;
END;

CREATE TABLE IF NOT EXISTS solar_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at_ms INTEGER NOT NULL,
  kp_index REAL NOT NULL DEFAULT 0,
  solar_flux_sfu REAL NOT NULL DEFAULT 0,
  geomag_activity TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_solar_snapshots_recent ON solar_snapshots(fetched_at_ms DESC);

CREATE TABLE IF NOT EXISTS propagation_weather_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at_ms INTEGER NOT NULL,
  sample_time_ms INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  latitude REAL NOT NULL DEFAULT 0,
  longitude REAL NOT NULL DEFAULT 0,
  temperature_c REAL NOT NULL DEFAULT 0,
  dew_point_c REAL NOT NULL DEFAULT 0,
  relative_humidity_pct REAL NOT NULL DEFAULT 0,
  pressure_hpa REAL NOT NULL DEFAULT 0,
  cloud_cover_pct REAL NOT NULL DEFAULT 0,
  visibility_m REAL NOT NULL DEFAULT 0,
  wind_speed_kmh REAL NOT NULL DEFAULT 0,
  wind_direction_deg REAL NOT NULL DEFAULT 0,
  temperature_950hpa_c REAL,
  dew_point_950hpa_c REAL,
  relative_humidity_950hpa REAL,
  inversion_proxy TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_propagation_weather_snapshots_recent ON propagation_weather_snapshots(fetched_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_propagation_weather_snapshots_sample ON propagation_weather_snapshots(sample_time_ms DESC, latitude, longitude);

CREATE TABLE IF NOT EXISTS propagation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  edge_id INTEGER NOT NULL UNIQUE,
  at_ms INTEGER NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  distance_km REAL NOT NULL DEFAULT 0,
  route_ids_json TEXT NOT NULL DEFAULT '[]',
  endpoint_labels_json TEXT NOT NULL DEFAULT '[]',
  segments_json TEXT NOT NULL DEFAULT '[]',
  reasons_json TEXT NOT NULL DEFAULT '[]',
  weather_json TEXT NOT NULL DEFAULT '',
  solar_json TEXT NOT NULL DEFAULT '',
  replay_from_ms INTEGER NOT NULL DEFAULT 0,
  replay_to_ms INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(edge_id) REFERENCES public_packet_paths(edge_id)
);
CREATE INDEX IF NOT EXISTS idx_propagation_events_recent ON propagation_events(at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_propagation_events_region_recent ON propagation_events(region, at_ms DESC, id DESC);
