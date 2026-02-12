CREATE TABLE zones (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  map_polygon JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_zones_active ON zones(is_active);

CREATE TABLE antennas (
  id VARCHAR(64) PRIMARY KEY,
  zone_id VARCHAR(64) NOT NULL REFERENCES zones(id),
  name VARCHAR(128) NOT NULL,
  x NUMERIC(10,2) NOT NULL,
  y NUMERIC(10,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_antennas_zone ON antennas(zone_id);

CREATE TABLE rfid_read_events (
  id VARCHAR(64) PRIMARY KEY,
  epc VARCHAR(128) NOT NULL,
  antenna_id VARCHAR(64) NOT NULL REFERENCES antennas(id),
  zone_id VARCHAR(64) NOT NULL REFERENCES zones(id),
  event_ts TIMESTAMP NOT NULL,
  rssi NUMERIC(8,2),
  ingested_at TIMESTAMP NOT NULL,
  dedup_bucket_ts TIMESTAMP NOT NULL
);
CREATE INDEX idx_rfid_epc_ts ON rfid_read_events(epc, event_ts DESC);
CREATE INDEX idx_rfid_zone_ts ON rfid_read_events(zone_id, event_ts DESC);
CREATE UNIQUE INDEX ux_rfid_dedup ON rfid_read_events(epc, antenna_id, dedup_bucket_ts);

CREATE TABLE epc_sku_mapping (
  id VARCHAR(64) PRIMARY KEY,
  epc VARCHAR(128) NOT NULL,
  sku_id VARCHAR(64) NOT NULL,
  sku_name VARCHAR(128),
  active_from TIMESTAMP NOT NULL,
  active_to TIMESTAMP
);
CREATE INDEX idx_mapping_epc_active ON epc_sku_mapping(epc, active_from, active_to);

CREATE TABLE inventory_snapshots (
  id VARCHAR(64) PRIMARY KEY,
  zone_id VARCHAR(64) NOT NULL REFERENCES zones(id),
  sku_id VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('RFID', 'NON_RFID')),
  qty INTEGER NOT NULL CHECK (qty >= 0),
  confidence NUMERIC(4,3),
  version INTEGER NOT NULL DEFAULT 1,
  last_calculated_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_inventory_zone ON inventory_snapshots(zone_id);
CREATE INDEX idx_inventory_zone_sku_source ON inventory_snapshots(zone_id, sku_id, source);

CREATE TABLE replenishment_rules (
  id VARCHAR(64) PRIMARY KEY,
  zone_id VARCHAR(64) NOT NULL REFERENCES zones(id),
  sku_id VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('RFID', 'NON_RFID')),
  min_qty INTEGER NOT NULL CHECK (min_qty >= 0),
  max_qty INTEGER NOT NULL CHECK (max_qty >= min_qty),
  priority INTEGER NOT NULL DEFAULT 3,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_rules_zone_active ON replenishment_rules(zone_id, is_active);

CREATE TABLE replenishment_tasks (
  id VARCHAR(64) PRIMARY KEY,
  rule_id VARCHAR(64) NOT NULL REFERENCES replenishment_rules(id),
  zone_id VARCHAR(64) NOT NULL REFERENCES zones(id),
  sku_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  trigger_qty INTEGER NOT NULL,
  deficit_qty INTEGER NOT NULL,
  target_qty INTEGER NOT NULL,
  confirmed_qty INTEGER,
  confirmed_by VARCHAR(64),
  close_reason VARCHAR(64),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  closed_at TIMESTAMP
);
CREATE INDEX idx_tasks_status ON replenishment_tasks(status);
CREATE INDEX idx_tasks_zone_status ON replenishment_tasks(zone_id, status);
CREATE UNIQUE INDEX ux_open_task_per_rule ON replenishment_tasks(rule_id, status) WHERE status IN ('OPEN', 'IN_PROGRESS');

CREATE TABLE sales_events (
  id VARCHAR(64) PRIMARY KEY,
  sku_id VARCHAR(64) NOT NULL,
  zone_id VARCHAR(64) NOT NULL REFERENCES zones(id),
  event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('SALE', 'RETURN')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  event_ts TIMESTAMP NOT NULL,
  pos_txn_id VARCHAR(64),
  ingested_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_sales_zone_sku_ts ON sales_events(zone_id, sku_id, event_ts DESC);
