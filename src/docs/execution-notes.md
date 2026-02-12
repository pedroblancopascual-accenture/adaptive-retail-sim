# Execution Notes

- Streaming (near real-time): `POST /rfid/read`, `POST /sales/event`, and `evaluateMinMax` after each event.
- Batch: TTL cleanup for stale EPC presence, daily snapshot compaction, and periodic confidence recalculation.
- Eventual consistency acceptable: dashboard totals and cross-zone aggregates with a few seconds lag.
- Mocked in this PoC: auth/user directory for `confirmedBy`, external SKU master service, message broker, and physical RFID triangulation.
