# Car Comparison (Spain)

A React + TypeScript app to compare popular car models in Spain with:

- rolling registration ranking (last 12 full months),
- technical and practical attributes (body type, dimensions, trunk, powertrains),
- URL-persisted filters and sorting.

The ranking data comes from official DGT monthly microdata, replacing static scraped sales values.

## Data model

- Monthly DGT files are downloaded into `data/dgt/monthly`.
- Sales ranking for the app is generated from those ZIP files into `src/data/sales-rolling-12m.ts`.
- `src/data/cars-es.ts` combines:
  - generated rolling sales/rank values,
  - cached model metadata from `src/data/car-metadata.ts` (currently filled for top 20 models).

The app currently aggregates registrations for vehicle category `M1` over the latest 12 available monthly files.

## Run locally

```bash
pnpm install
pnpm dev
```

Build:

```bash
pnpm build
```

## Update official data (incremental)

Download only missing monthly files for the latest 12-month window (and prune older local files), then regenerate rolling ranking:

```bash
pnpm run data:update-rolling-sales
```

This command does not re-download files that already exist in `data/dgt/monthly` for the current 12-month window.

### Individual data commands

Download missing monthly DGT files:

```bash
pnpm run data:download-dgt
```

Rebuild rolling 12-month sales from local ZIP files:

```bash
pnpm run data:build-rolling-sales
```

## Main files

- `scripts/dgt_matriculaciones.py`: DGT listing fetch + downloader (supports missing-only mode).
- `scripts/build_sales_rolling_12m.py`: generates rolling sales/rank map from local monthly ZIP files and keeps official Top 100 models with a 1000-unit floor.
- `src/data/sales-rolling-12m.ts`: generated rolling sales dataset used by the UI.
- `src/data/car-metadata.ts`: persistent metadata cache keyed by model id (dimensions, labels, versions, image).
- `src/data/cars-es.ts`: app car catalog + data source metadata.
- `src/App.tsx`: filters, sorting, cards/table views.

## Notes

- The rolling window updates automatically when a new monthly DGT file appears and you run `pnpm run data:update-rolling-sales`.
- Older local monthly files are pruned automatically to keep only the latest 12 monthly ZIPs.
- When a new model appears without cached metadata, it still shows in the ranking with `N/D` fields; add that model to `src/data/car-metadata.ts` when you want to enrich it.
