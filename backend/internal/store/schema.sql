PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

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

CREATE INDEX IF NOT EXISTS idx_observations_recent ON packet_observations(heard_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_observations_recent_id ON packet_observations(heard_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_observations_resolution ON packet_observations(resolution_status, heard_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_observations_iata ON packet_observations(iata, heard_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_observations_observer_recent ON packet_observations(observer_public_key, heard_at_ms DESC);

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

CREATE TABLE IF NOT EXISTS observer_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key TEXT NOT NULL,
  iata TEXT NOT NULL,
  status_json TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observer_status_recent ON observer_status(received_at_ms DESC);

CREATE TABLE IF NOT EXISTS path_resolution_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iata TEXT NOT NULL,
  hash_size INTEGER NOT NULL,
  prefix_hex TEXT NOT NULL,
  status TEXT NOT NULL,
  candidate_count INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS live_edge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
CREATE INDEX IF NOT EXISTS idx_live_edge_events_observation ON live_edge_events(observation_id);
CREATE INDEX IF NOT EXISTS idx_live_edge_events_payload_recent ON live_edge_events(payload_type_name, heard_at_ms DESC, id DESC);
