# Adaptive Store Inventory Simulator (PoC)

Frontend PoC built with React + TypeScript to simulate store operations:
- location/zones management on shopfloor map
- RFID and non-RFID inventory flows
- replenishment and receiving task lifecycle
- staff assignment and execution workflow
- sales carts and checkout simulation
- catalog and analytics views
- min-max rules (global + location-specific)

In this project, `SIM` refers to **Store Inventory Management**.

Note: this repository uses anonymized naming and mock data for demonstration purposes.

## Tech stack

- React
- TypeScript
- Vite

## Run locally

```bash
npm install
npm run dev
```

App default URL: `http://localhost:5174`

## Build

```bash
npm run build
npm run preview
```

## Project structure

- App shell and UI: `src/App.tsx`
- Main styles: `src/styles.css`
- Mock API and business simulation: `src/api/mockApi.ts`
- Inventory engine: `src/logic/inventoryEngine.ts`
- Domain models/contracts: `src/domain/models.ts`, `src/domain/contracts.ts`
- Initial mock dataset: `src/data/sampleDataset.ts`
- Documentation and reference artifacts: `src/docs/`

## Deployment

For Render Static Site:
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`

## License

Private/internal PoC.
