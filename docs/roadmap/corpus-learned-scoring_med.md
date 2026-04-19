# Corpus-Learned Query Expansion and Intent Detection

**Status:** Proposed  
**Replaces:** Hardcoded synonym lists and intent keyword matching in `src-tauri/src/core/scoring.rs`  
**Dependencies:** `usage.rs`, `watcher.rs`, `.ai/index/`, `.ai/usage/`

---

## Problem

The current scoring pipeline hardcodes two structures:

1. **Intent detection** — keyword `contains()` checks against a fixed ES/EN word list. Typos, morphological variants, and domain-specific terms that aren't in the list silently fall through to the `default` profile.

2. **Query expansion** — 9 synonym clusters matched by substring. Cross-language pairs like `desplegar → deploy` only work if every surface form is manually listed. Domain jargon (`TOCTOU`, `binary_path`, `glyph`) is never covered.

Both structures require manual maintenance and are corpus-agnostic: they know nothing about *this* workspace's vocabulary.

---

## Proposed Solution

Replace both structures with statistics derived from the corpus itself, using distributional semantics (co-occurrence PMI) and lightweight supervised intent classification over past queries.

No GPU, no external model, no network. Pure Rust, fully offline, deterministic per corpus state.

---

## Architecture

### Component A — Co-occurrence Index (replaces `expand_query`)

**Where:** new module `src-tauri/src/core/cooccurrence.rs`

For every pair of stems `(a, b)` that appear in the same document, compute **Normalized PMI**:

```
NPMI(a, b) = PMI(a, b) / -log P(a, b)
           = log( P(a, b) / (P(a) · P(b)) ) / -log P(a, b)
```

NPMI lies in `[-1, 1]`. Values above a threshold (~0.3) with a minimum document co-occurrence count (~3 docs) indicate genuinely related terms.

For each stem, store its top-K neighbors sorted by NPMI. Persist to `.ai/index/synonyms.json`. Rebuild when any memory is modified (hook into the existing `watcher.rs` invalidation path).

`expand_query` becomes a lookup: for each stem in the query, append its top-K NPMI neighbors.

**Cold start:** with fewer than ~20 documents, PMI is noise. Fall back to the current hardcoded clusters as a *prior*, decaying their weight as corpus size grows:

```
weight_prior = max(0, 1 - corpus_size / 50)
```

### Component B — Intent Classification (replaces `detect_intent_weights`)

**Where:** extended `src-tauri/src/core/scoring.rs` + `src-tauri/src/core/usage.rs`

Two sub-phases:

#### B1. Unsupervised (Phases 0–2, no user signal needed)

1. Read past queries from `.ai/usage/queries.jsonl`.
2. Represent each query as a TF-IDF vector over the corpus vocabulary.
3. Cluster with k-means (k=3–5). Centroids map naturally to intent profiles.
4. Assign new query to nearest centroid by cosine similarity → apply that cluster's weight profile.
5. Fallback to `default` profile when query history < 20 entries.

#### B2. Supervised (Phase 3+, requires outcome logging)

1. Log `(query, ranked_results, opened_memory_ids)` to `.ai/usage/queries.jsonl`.
2. For each historical query, the "winning profile" is whichever weight configuration would have ranked the actually-opened memory highest.
3. Train logistic regression over bag-of-stems → winning profile label.
4. Retrain daily or on-demand via a dedicated scoring maintenance command.

**Phase 4 extension:** instead of discrete profiles, learn the six weight dimensions (`semantic`, `bm25`, `graph`, `recency`, `importance`, `access_frequency`) per cluster by optimizing NDCG@10 over the outcome log.

---

## Development Phases

| Phase | Deliverable | Prerequisite | Estimated LOC |
|-------|-------------|--------------|---------------|
| 0 | Outcome logging (`QueryOutcome` struct + `queries.jsonl`) | none | ~80 |
| 1 | Co-occurrence index + NPMI-based `expand_query` | Phase 0 optional | ~150 |
| 2 | Unsupervised k-means intent routing | Phase 0 optional | ~120 |
| 3 | Supervised intent classifier | Phase 0 required | ~200 |
| 4 | Per-cluster weight optimization (NDCG@10) | Phase 3 required | ~200 |

Each phase is independently shippable. Phase 0 has standalone value as an observability improvement regardless of whether learning is implemented.

---

## Data Structures

### `QueryOutcome` (Phase 0)

```rust
struct QueryOutcome {
    query: String,
    timestamp: DateTime<Utc>,
    scored_top_k: Vec<String>,    // memory IDs returned by scoring
    opened: Vec<String>,           // memory IDs the user actually opened/copied
}
```

Persisted as newline-delimited JSON at `.ai/usage/queries.jsonl`. Append-only. Not committed to git by default — add to `.gitignore`.

### Synonym index (Phase 1)

```json
{
  "crash": [["panic", 0.87], ["error", 0.71], ["fallo", 0.68]],
  "deploy": [["desplieg", 0.91], ["releas", 0.76], ["publicar", 0.65]]
}
```

Stored at `.ai/index/synonyms.json`. Rebuilt on memory change events from `watcher.rs`.

---

## Technical Requirements

| Requirement | Crate / Approach | Notes |
|-------------|-----------------|-------|
| Sparse co-occurrence matrix | `HashMap<(String, String), u32>` | Scales to ~10k docs; sample beyond that |
| k-means clustering | `linfa` + `linfa-clustering` | Pure Rust, no BLAS required |
| Logistic regression | `linfa-logistic` | Same crate family |
| Incremental rebuild | hook into existing `watcher.rs` | Invalidate on `MemoryModified` event |
| Evaluation metrics | implement NDCG@10 manually | ~40 LOC, needed for Phase 4 |

---

## Implications

### Now

- Eliminates manual vocabulary maintenance.
- Adapts to workspace-specific jargon without user intervention.
- Enables scoring metrics (NDCG, recall@k) for the first time — currently there is no ground truth.
- **Cold start is real:** below ~20 memories, statistical signal is weak. The existing hardcoded lists must remain as a fallback prior.
- **Reproducibility changes:** two identical queries on different corpus states may produce different rankings. Acceptable for a personal knowledge OS; worth documenting for debugging.
- **Privacy:** `queries.jsonl` contains the user's actual search history. Must be excluded from git commits and any cloud sync by default.

### Future

- **Embeddings path.** Once outcome logging and NDCG evaluation exist, swapping the PMI scorer for a local embedding model (e.g. `fastembed-rs`, ~30MB) is a drop-in change. The surrounding infrastructure stays.
- **Multi-user.** Each user or workspace gets its own synonym index. Alex DC's `MCP` → `binary_path` association doesn't bleed into another user's corpus.
- **Drift detection.** Sudden PMI shifts signal vocabulary changes in the workspace (e.g. `deploy` starts appearing with `rollback` — something broke). The co-occurrence index becomes a passive sensor.
- **Auto-tagging.** NPMI neighbors of existing tags suggest new tags for untagged memories. Same index, different feature surface.
- **Overfitting risk.** If the user switches projects, the old index biases results toward past vocabulary. Temporal decay (weight recent co-occurrences more heavily) mitigates this but adds complexity.

---

## Recommended Implementation Order

**Phase 0 → Phase 1 → measure → decide.**

1. Instrument outcome logging (Phase 0) without changing scoring behavior.
2. Let outcomes accumulate for 2–3 weeks of real usage.
3. Implement NPMI expansion (Phase 1) as a complement alongside current lists, not a replacement.
4. Compare NDCG@10 with and without NPMI expansion on the accumulated outcomes.
5. If NPMI wins clearly, proceed to Phase 2+. Otherwise, keep the instrumentation (valuable regardless) and revisit.

Skipping to Phase 4 without ground truth means tuning blindly.

---

## Related Files

- `src-tauri/src/core/scoring.rs` — current hardcoded implementation this replaces
- `src-tauri/src/core/search.rs` — `tokenize` and `bm25_score`, reused by this design
- `src-tauri/src/core/usage.rs` — existing usage tracking, extended in Phase 0
- `src-tauri/src/core/watcher.rs` — file change events that trigger index rebuilds
- `docs/roadmap/01-knowledge-base-architecture.md` — broader scoring architecture context
