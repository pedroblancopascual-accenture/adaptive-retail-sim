# Inventory Calculation Pseudocode

```text
CONSTANTS
  DEDUP_WINDOW_SEC = 15
  RFID_PRESENCE_TTL_SEC = 300

function ingestRFIDRead(event)
  validate event + antenna-zone
  if deduplicateReads(epc, antenna, DEDUP_WINDOW_SEC) then ignore
  sku = lookup EPCSkuMapping by epc and active window
  persist read
  upsert EPC presence (last seen)
  calculateZoneInventory(zoneId)

function deduplicateReads(epc, antenna, window)
  read last accepted event with same epc+antenna
  return true if last.timestamp >= event.timestamp - window

function calculateZoneInventory(zoneId)
  RFID qty per sku = count distinct EPC where now - last_seen <= TTL and zone matches
  NON_RFID qty per sku = calculateNonRFIDInventory(sku, zone)
  persist snapshots
  evaluateMinMax(zoneId)

function calculateNonRFIDInventory(sku, zone)
  baseline = latest NON_RFID snapshot
  qty = baseline.qty - sales_since_baseline + returns_since_baseline + confirmed_replenishment_since_baseline
  return max(0, qty)

function evaluateMinMax(zoneId)
  for each active rule in zone
    current = snapshot qty
    if current < min then create/update OPEN task with deficit=(max-current)
    if current >= max then close existing OPEN/IN_PROGRESS task

function generateReplenishmentTask(rule, deficitQty)
  create task with status OPEN and target_qty = rule.max_qty

function closeReplenishmentTask(taskId)
  set status COMPLETED and closed timestamp
```

RFID logic is probabilistic (presence by recency window), non-RFID logic is movement-based (sales and confirmations).
