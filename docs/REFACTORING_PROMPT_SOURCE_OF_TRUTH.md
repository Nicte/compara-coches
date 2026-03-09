# Refactoring Prompt: Use Brand/Model Source of Truth to Simplify Metadata Pipeline

## Context

The current codebase has three overlapping metadata systems that scrape and store car data from automobiledimension.com:

1. **`scripts/fetch_brand_models_source_of_truth.py`** → `data/automobiledimension-brand-models.json`
   - Comprehensive catalog of ALL brands/models (53 brands, 493 models)
   - Clean structure with canonical model URLs as identifiers
   - Includes basic dimensions, trunk, images
   - Designed for periodic updates to detect new models

2. **`scripts/fetch_car_metadata.py`** → `data/car-metadata-auto-cache.json` → `src/data/car-metadata-auto.ts`
   - Fetches metadata for Spanish top-100 models from sales rankings
   - Re-scrapes brand pages from automobiledimension.com on every run
   - Complex fuzzy matching logic to map Spanish model IDs to website models
   - Generates TypeScript file for the app

3. **`src/data/car-metadata.ts`** (manual file)
   - Authoritative source with complete metadata
   - Includes Spanish-specific data: `versions[]` arrays with powertrain/transmission/dgtLabel
   - Recently augmented with 41 models from auto file (physical specs only)

## Problems with Current Architecture

### Redundancy

- Both scripts scrape the same website (automobiledimension.com)
- `fetch_car_metadata.py` re-fetches brand pages every time, even for known models
- No reuse of discovered models between runs
- Duplicated HTML parsing logic

### Complexity

- `fetch_car_metadata.py` has 500+ lines with complex fuzzy matching
- Matching logic intertwined with scraping logic
- Brand page URLs constructed dynamically instead of using discovered URLs
- No separation between "finding models" and "fetching metadata"

### Inefficiency

- Network overhead: re-scraping brand pages containing dozens of models just to find one
- Processing overhead: complex token-based matching on every run
- No persistent mapping between Spanish IDs and canonical model URLs

### Maintainability

- Hard to understand which data comes from where
- Matching logic uses stopwords, token normalization, similarity scoring (hard to debug)
- No clear data flow from source → cache → TypeScript

## Proposed Refactored Architecture

### New Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Discover Available Models (weekly/monthly)        │
│  scripts/fetch_brand_models_source_of_truth.py             │
│  → data/automobiledimension-brand-models.json              │
│     (53 brands, 493 models with canonical URLs)            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Match Spanish Sales IDs to Canonical Models       │
│  NEW: scripts/match_spanish_models.py                      │
│  Inputs:                                                    │
│    - src/data/sales-rolling-12m.ts (Spanish model IDs)    │
│    - data/automobiledimension-brand-models.json            │
│  Output:                                                    │
│    → data/spanish-to-canonical-mapping.json                │
│      { "audi-a3-sportback": {                              │
│          "modelUrl": "https://automobiledimension.../a3",  │
│          "matchConfidence": "high",                        │
│          "matchMethod": "exact" } }                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Fetch Detailed Metadata (for matched models only) │
│  REFACTORED: scripts/fetch_car_metadata.py                │
│  Inputs:                                                    │
│    - data/spanish-to-canonical-mapping.json                │
│    - data/car-metadata-auto-cache.json (existing cache)   │
│  Process:                                                   │
│    - Use cached data if model URL already fetched         │
│    - Fetch individual model pages only for new/missing    │
│    - No brand page scraping (already have model URLs)     │
│  Output:                                                    │
│    → data/car-metadata-auto-cache.json (updated)          │
│    → src/data/car-metadata-auto.ts (TypeScript)           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Manual Enrichment (Spanish-specific data)         │
│  src/data/car-metadata.ts (unchanged)                      │
│  - Add versions[] arrays                                   │
│  - Override auto data where needed                         │
│  - Add Spanish market specific info                        │
└─────────────────────────────────────────────────────────────┘
```

### Key Changes

1. **Separate Discovery from Fetching**
   - Discovery: `fetch_brand_models_source_of_truth.py` (run periodically)
   - Matching: NEW `match_spanish_models.py` (run when sales data updates)
   - Fetching: REFACTORED `fetch_car_metadata.py` (only fetch missing metadata)

2. **Persistent Mapping**
   - Store Spanish ID → canonical model URL mapping in `data/spanish-to-canonical-mapping.json`
   - Reuse mapping across runs
   - Review/validate matches manually when confidence is low

3. **Incremental Metadata Fetching**
   - Use model URLs directly (no brand page scraping)
   - Check cache before fetching
   - Fetch only individual model pages for missing data

4. **Clear Data Hierarchy**
   ```
   automobiledimension-brand-models.json (source of truth for available models)
         ↓
   spanish-to-canonical-mapping.json (Spanish IDs → canonical URLs)
         ↓
   car-metadata-auto-cache.json (fetched metadata by canonical URL)
         ↓
   car-metadata-auto.ts (TypeScript for app, keyed by Spanish ID)
         ↓
   car-metadata.ts (manual overrides/enrichment)
   ```

## Refactoring Tasks

### Task 1: Create Spanish Model Matcher

Create `scripts/match_spanish_models.py`:

**Requirements:**

- Read Spanish model IDs from `src/data/sales-rolling-12m.ts`
- Load canonical models from `data/automobiledimension-brand-models.json`
- Implement matching strategies (priority order):
  1. **Exact match**: Normalize and compare brand + model name
  2. **Token overlap**: Brand match + high token overlap in model name
  3. **Manual mapping**: Load manual overrides from config file
  4. **Unmatched**: Report for manual review
- Output `data/spanish-to-canonical-mapping.json` with:
  - Spanish ID (key)
  - Canonical model URL
  - Match confidence (high/medium/low)
  - Match method (exact/token/manual)
- Print summary: matched count, confidence distribution, unmatched models
- Support `--review-low-confidence` flag to interactively confirm matches

**Simplified Matching Logic:**

- No complex stopwords or token scoring needed
- Use the clean model names from source of truth
- Normalize: strip accents, lowercase, remove special chars
- Brand name must match first
- Model name similarity can be simple (token set intersection)

### Task 2: Refactor Metadata Fetcher

Modify `scripts/fetch_car_metadata.py`:

**Remove:**

- Brand page fetching logic (`fetch_brand_models`)
- `parse_brand_models` function
- Complex fuzzy matching (`score_candidate`, `best_candidate_for_model`, etc.)
- `MATCH_STOPWORDS`, `normalize_model_for_match`, `core_match_tokens`
- Brand page URL construction

**Keep:**

- Cache loading/saving logic
- `fetch_body_type` function (fetch individual model pages)
- TypeScript generation logic
- Retry and error handling

**Add:**

- Load `data/spanish-to-canonical-mapping.json` as input
- Load `data/automobiledimension-brand-models.json` for basic metadata
- For each Spanish ID:
  1. Check if cached (by canonical URL, not Spanish ID)
  2. If cached, copy to output with Spanish ID key
  3. If not cached:
     - Copy basic metadata from source of truth (dimensions, trunk, image)
     - Optionally fetch bodyType from individual model page
     - Cache by canonical URL
  4. Write TypeScript output keyed by Spanish ID

**Benefits:**

- Reduces from ~500 lines to ~200 lines
- No brand page scraping (much faster)
- Clear data flow from mapping → cache → TypeScript
- Incremental updates (only fetch missing models)

### Task 3: Update Data Flow Scripts

Update `package.json` scripts:

**Current:**

```json
"data:fetch-metadata": "python scripts/fetch_car_metadata.py"
```

**New:**

```json
"data:refresh-source-of-truth": "python scripts/fetch_brand_models_source_of_truth.py",
"data:match-spanish-models": "python scripts/match_spanish_models.py",
"data:fetch-metadata": "python scripts/fetch_car_metadata.py",
"data:update-all": "pnpm run data:refresh-source-of-truth && pnpm run data:match-spanish-models && pnpm run data:fetch-metadata"
```

### Task 4: Documentation Updates

Update `README.md` main files section to reflect new flow:

```markdown
- `scripts/fetch_brand_models_source_of_truth.py`: scrapes all brands/models from automobiledimension.com (run weekly/monthly)
- `scripts/match_spanish_models.py`: maps Spanish sales model IDs to canonical model URLs
- `scripts/fetch_car_metadata.py`: fetches metadata for matched models only (incremental)
- `data/automobiledimension-brand-models.json`: source of truth with 493 models
- `data/spanish-to-canonical-mapping.json`: Spanish ID → canonical URL mapping
- `data/car-metadata-auto-cache.json`: fetched metadata cache (by canonical URL)
- `src/data/car-metadata-auto.ts`: generated TypeScript (keyed by Spanish ID)
- `src/data/car-metadata.ts`: manual overrides with versions arrays
```

### Task 5: Migration Path

1. Run existing `fetch_car_metadata.py` one final time to ensure cache is current
2. Implement `match_spanish_models.py`
3. Verify mapping quality (high confidence matches %)
4. Refactor `fetch_car_metadata.py` to use mapping
5. Test: run refactored version, compare output with old version
6. Deploy: switch to new data flow

## Testing the Refactored System

### Validation Checklist

1. **Source of Truth Quality**

   ```bash
   python scripts/fetch_brand_models_source_of_truth.py
   # Verify: 493 models, 53 brands, no errors
   ```

2. **Mapping Quality**

   ```bash
   python scripts/match_spanish_models.py
   # Expected: >90% high confidence matches
   # Review: low confidence matches manually
   ```

3. **Metadata Completeness**

   ```bash
   python scripts/fetch_car_metadata.py
   # Compare counts: old cache vs new cache
   # Verify: same models have same dimensions/trunk/images
   ```

4. **TypeScript Output**
   - Compare `src/data/car-metadata-auto.ts` before/after
   - Verify Spanish IDs still work as keys
   - Check app loads and displays correctly

5. **Performance**
   - Measure runtime: old fetch (~30-60s) vs new fetch (~5-10s first run, ~1-2s subsequent)
   - Network requests: old (~60+ requests) vs new (~5-10 for missing models)

## Benefits After Refactoring

### Efficiency

- **10x faster** metadata updates (no brand page re-scraping)
- Incremental fetching: only new models require network requests
- Reusable mapping across runs

### Maintainability

- Clear separation of concerns (discover → match → fetch)
- Simpler matching logic (~50 lines vs ~200 lines)
- Easy to debug: inspect mapping file for incorrect matches
- Each script has single responsibility

### Reliability

- Source of truth updated independently from matching/fetching
- Failed fetches don't affect entire pipeline
- Mapping can be reviewed and corrected manually
- Cache invalidation by canonical URL (more stable)

### Extensibility

- Easy to add new data sources (just update matcher)
- Can switch to different matching algorithms without touching fetcher
- Manual mapping overrides trivial to add
- Can fetch additional metadata from model pages without changing discovery

## Edge Cases to Handle

1. **Spanish model not in source of truth**
   - Log unmatched models
   - Allow manual mapping file for edge cases
   - Continue with partial data (dimensions missing)

2. **Model URL changed on website**
   - Source of truth will have new URL
   - Mapping will fail → requires manual review
   - Old cache entry becomes stale (accept this)

3. **Multiple variants of same model**
   - Spanish data has: "OPEL Corsa Edition", "OPEL Corsa GS"
   - Source of truth has: single "Opel Corsa 2024"
   - Matcher should map both to same canonical model
   - Metadata will be shared (acceptable for base dimensions)

4. **New model appears mid-year**
   - Source of truth refresh detects it (weekly run)
   - Matcher picks it up on next sales data update
   - Fetcher grabs metadata incrementally
   - No manual intervention needed

## Final Architecture Diagram

```
[DGT Sales Data] ──→ sales-rolling-12m.ts (Spanish IDs)
                                ↓
                           match_spanish_models.py
                                ↓
[Source of Truth] ──→ spanish-to-canonical-mapping.json
automobiledimension          ↓
-brand-models.json      fetch_car_metadata.py
        ↓                    ↓
   (basic metadata)    car-metadata-auto-cache.json
                            ↓
                       car-metadata-auto.ts
                            ↓
                     [App uses auto + manual]
                            ↓
                       car-metadata.ts (manual overrides)
```

## Prompt for AI Agent

**You can use this section directly as a prompt:**

---

I need to refactor the car metadata pipeline in this codebase to use a centralized source of truth. Currently, there are three overlapping systems that scrape automobiledimension.com, causing inefficiency and complexity.

**Current State:**

1. `scripts/fetch_brand_models_source_of_truth.py` creates a comprehensive catalog of 493 models in `data/automobiledimension-brand-models.json`
2. `scripts/fetch_car_metadata.py` re-scrapes brand pages and does complex fuzzy matching to map Spanish model IDs to website models
3. `src/data/car-metadata.ts` is the manual authoritative source

**Goal:**
Refactor the code to use `automobiledimension-brand-models.json` as the source of truth, eliminating redundant scraping and simplifying matching logic.

**Tasks:**

1. Create `scripts/match_spanish_models.py` to map Spanish sales IDs (from `sales-rolling-12m.ts`) to canonical model URLs (from `automobiledimension-brand-models.json`). Output should be `data/spanish-to-canonical-mapping.json` with match confidence scores.

2. Refactor `scripts/fetch_car_metadata.py` to:
   - Remove brand page scraping logic
   - Remove complex fuzzy matching (300+ lines)
   - Use `spanish-to-canonical-mapping.json` as input
   - Look up basic metadata from `automobiledimension-brand-models.json`
   - Only fetch individual model pages for missing bodyType data
   - Cache by canonical URL instead of Spanish ID

3. Update documentation and package.json scripts to reflect new flow.

The refactored system should be faster (no brand page re-scraping), simpler (clear data flow), and more maintainable (separation of concerns: discover → match → fetch).

See the full architecture proposal and requirements in this document above.

---

## Success Metrics

- [ ] `fetch_car_metadata.py` reduced from ~500 to ~200 lines
- [ ] Metadata update runtime reduced from 30-60s to 5-10s
- [ ] Network requests reduced from 60+ to <10 per run (after first run)
- [ ] Clear data lineage: source of truth → mapping → cache → TypeScript
- [ ] Matching errors easy to debug (inspect mapping.json)
- [ ] New models detected automatically (weekly source of truth refresh)
- [ ] Zero breaking changes to app (same TypeScript output format)

## Questions to Resolve During Refactoring

1. Should we keep `bodyType` fetching from individual model pages, or use category pages from the source of truth?
2. Should mapping confidence threshold be configurable?
3. Should we support interactive matching review mode?
4. Should cache use canonical URLs or Spanish IDs as keys? (Recommend canonical URLs)
5. Should we invalidate old cache entries when model URL changes?
