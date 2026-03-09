# Brand/Model Source of Truth Scraper

## Overview

This script crawls [automobiledimension.com](https://www.automobiledimension.com/) to build a comprehensive, canonical list of all car brands and models available on the site. It's designed to run periodically to detect newly added or removed models.

## Purpose

- **Source of Truth**: Creates a clean, structured catalog of all brands and models
- **Change Detection**: Reports new/removed models compared to the previous run
- **Periodic Updates**: Designed to run on a schedule (e.g., weekly/monthly) to stay current
- **Metadata Capture**: Includes dimensions, trunk capacity, and image URLs for each model

## Output File

**Location**: `data/automobiledimension-brand-models.json`

**Schema**:

```json
{
  "generatedAt": "2026-03-09T14:48:31.375366+00:00",
  "source": "https://www.automobiledimension.com/",
  "stats": {
    "brandCount": 53,
    "modelCount": 493
  },
  "brands": [
    {
      "brand": "AUDI",
      "brandUrl": "https://www.automobiledimension.com/audi-car-dimensions.html",
      "models": [
        {
          "name": "Audi A3 Sportback 2024",
          "modelUrl": "https://www.automobiledimension.com/model/audi/a3-sportback",
          "imageUrl": "https://www.automobiledimension.com/photos/audi-a3-sportback-2024.jpg",
          "lengthMm": 4352,
          "widthMm": 1816,
          "heightMm": 1426,
          "trunkLiters": 380
        }
      ]
    }
  ],
  "modelUrls": [
    "https://www.automobiledimension.com/model/audi/a3-sportback",
    "..."
  ],
  "changesFromPreviousRun": {
    "addedCount": 0,
    "removedCount": 0,
    "addedModelUrls": [],
    "removedModelUrls": []
  },
  "errors": []
}
```

**Key Fields**:

- `generatedAt`: ISO 8601 timestamp of crawl
- `stats`: Quick summary of brands/models discovered
- `brands[]`: Array of brand objects with nested models
  - `brand`: Brand name (e.g., "AUDI", "BMW")
  - `brandUrl`: Link to brand page
  - `models[]`: All models for this brand
    - `name`: Model display name
    - `modelUrl`: Canonical URL for the model (used as unique identifier)
    - `imageUrl`: Photo URL (optional)
    - `lengthMm`, `widthMm`, `heightMm`: Dimensions in millimeters (optional)
    - `trunkLiters`: Boot capacity in liters (optional)
- `modelUrls[]`: Flat sorted list of all model URLs for quick lookups
- `changesFromPreviousRun`: Diff vs previous JSON file
  - `addedCount`/`removedCount`: Summary counts
  - `addedModelUrls[]`: New model URLs detected
  - `removedModelUrls[]`: Model URLs no longer present
- `errors[]`: Brand pages that failed to fetch (if any)

## Usage

### Basic Run (All Brands)

```bash
python scripts/fetch_brand_models_source_of_truth.py
```

### With Options

```bash
python scripts/fetch_brand_models_source_of_truth.py \
  --output data/my-custom-output.json \
  --workers 16 \
  --timeout 60 \
  --retries 3
```

### Development/Testing (Limited Brands)

```bash
python scripts/fetch_brand_models_source_of_truth.py --limit-brands 5
```

## Command-Line Options

| Option           | Default                                      | Description                        |
| ---------------- | -------------------------------------------- | ---------------------------------- |
| `--output`       | `data/automobiledimension-brand-models.json` | Output JSON file path              |
| `--workers`      | `12`                                         | Concurrent brand-page requests     |
| `--timeout`      | `30`                                         | HTTP timeout in seconds            |
| `--retries`      | `2`                                          | Retries per failed HTTP request    |
| `--limit-brands` | `0`                                          | Limit brands for testing (0 = all) |

## How It Works

1. **Fetch Homepage**: Scrapes the homepage to discover all brand page links
2. **Parallel Crawl**: Fetches brand pages concurrently (default: 12 workers)
3. **Parse Models**: Extracts model cards from each brand page HTML
4. **Capture Metadata**: Parses dimensions, trunk capacity, image URLs
5. **Detect Changes**: Compares model URLs to previous run's output file
6. **Write JSON**: Saves comprehensive catalog with change report

## Change Detection

On the **first run**, all models are reported as "added":

```
- new model URLs vs previous run: 493
- removed model URLs vs previous run: 0
```

On **subsequent runs**, only deltas are reported:

```
- new model URLs vs previous run: 3
- removed model URLs vs previous run: 1
```

The `changesFromPreviousRun` section in the JSON provides the full list of added/removed model URLs for automated processing.

## Scheduling Periodic Runs

### Cron (Linux/macOS)

```bash
# Run every Monday at 3 AM
0 3 * * 1 cd /path/to/car-comparison && /path/to/.venv/bin/python scripts/fetch_brand_models_source_of_truth.py
```

### GitHub Actions

```yaml
name: Update Brand/Model Catalog
on:
  schedule:
    - cron: "0 3 * * 1" # Weekly on Mondays
  workflow_dispatch: # Manual trigger

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: python scripts/fetch_brand_models_source_of_truth.py
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: update brand/model catalog"
```

## Typical Output

```
Brand/model source-of-truth refresh
- output: data/automobiledimension-brand-models.json
- brands crawled: 53
- models discovered: 493
- new model URLs vs previous run: 0
- removed model URLs vs previous run: 0
```

## Error Handling

- **Automatic Retries**: Each HTTP request retries 2 times by default
- **Partial Success**: If some brand pages fail, the script continues and reports errors
- **Error Reporting**: Failed brand pages are logged in the `errors[]` array in JSON output

## Performance

- **Typical Runtime**: ~15-30 seconds with 12 workers
- **Network Requests**: ~54 requests (1 homepage + 53 brand pages)
- **Output Size**: ~234 KB JSON (~5,658 lines)

## Integration with Existing Scripts

This script complements `fetch_car_metadata.py`:

- **This script** (`fetch_brand_models_source_of_truth.py`):
  - Builds comprehensive brand/model catalog
  - Tracks all models on the site (not just top 100)
  - Detects new models over time
  - Provides clean model names and URLs

- **Existing script** (`fetch_car_metadata.py`):
  - Fetches detailed metadata for Spanish top-100 models
  - Matches local model IDs to automobiledimension models
  - Includes bodyType detection via category pages
  - Writes TypeScript files for the app

## Future Enhancements

- **Diff Notifications**: Email/Slack alerts when new models are detected
- **Historical Tracking**: Archive snapshots to track model lifecycle
- **Model Matching**: Auto-suggest matches between Spanish IDs and catalog entries
- **Category Data**: Extract model categories (city car, SUV, etc.)
- **Specification Enrichment**: Fetch engine, fuel type, transmission from model pages

## Maintenance

- **Selectors**: If the site's HTML structure changes, update regex patterns at the top of the script
- **Rate Limiting**: Adjust `--workers` if the site rate-limits requests
- **Timeout**: Increase `--timeout` if the site is slow to respond
