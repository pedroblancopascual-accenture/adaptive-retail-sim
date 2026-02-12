# blm-sim

React + TypeScript PoC for Store Inventory Management (SIM).

## Run

```bash
cd blm-sim
npm install
npm run dev
```

## Artifacts

- Domain model: `src/domain/models.ts`
- Inventory calculation logic: `src/logic/inventoryEngine.ts` and `src/docs/inventory-pseudocode.md`
- REST API design and mock implementation: `src/api/mockApi.ts` and `src/docs/rest-api.json`
- Database tables: `src/docs/database-schema.sql`
- Sample dataset: `src/data/sampleDataset.ts` and `src/docs/sample-dataset.json`
- Frontend data contracts: `src/domain/contracts.ts` and `src/docs/frontend-contracts.json`
- Execution notes: `src/docs/execution-notes.md`

## Demo behavior

- Loads required dataset (3 zones, 6 antennas, 5 SKUs, 10 EPCs, 2 rules, 8 RFID reads, 4 sales events).
- Generates one replenishment alert for `SKU-NR-1` in `zone-shelf-a`.
- "Confirm First Open Task" closes that task and recalculates inventory.
