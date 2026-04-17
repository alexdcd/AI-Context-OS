# Algorithms And Scoring

This document explains the main retrieval, scoring, and graph algorithms used by AI Context OS.

It is intended for future developers who need to understand how a query becomes:

- a ranked list of memories
- a graph-informed relevance score
- a token-budgeted context package

## Source Files

The current implementation is concentrated in these files:

- `src-tauri/src/core/search.rs`
- `src-tauri/src/core/scoring.rs`
- `src-tauri/src/core/graph.rs`
- `src-tauri/src/core/engine.rs`

## End-To-End Flow

The current context retrieval pipeline works like this:

1. Scan the workspace and load memory metadata and content.
2. Build a shared BM25 corpus for the query.
3. Run a first scoring pass without graph proximity.
4. Take the top 5 memories from that first pass as graph seeds.
5. Run Personalized PageRank (PPR) over the memory graph.
6. Run a second scoring pass using the precomputed PPR scores.
7. Apply skill dependency force-loads and optional boosts.
8. Greedily assign `L0`, `L1`, or `L2` within the token budget.

The orchestration entry point is `execute_context_query()`.

## Lexical Normalization

Most matching logic depends on `tokenize()`.

### Pipeline

The tokenizer currently does the following:

1. lowercase the text
2. split on non-alphanumeric characters, while preserving `-` and `_`
3. remove common Spanish and English stopwords
4. apply stemming

### Bilingual Stemming

The system tries both an English and a Spanish Snowball stemmer for each token.

The current selection logic is:

- if only one stemmer changes the token, use that result
- if both change it, prefer the shorter stem, as long as it remains at least 3 characters long
- if only the Spanish stemmer changes the token, require at least a 2-character reduction to avoid false positives on English words

This lets the system normalize mixed-language corpora without full language detection.

Examples:

- `deploy`, `deploying`, `deployment`
- `desplegar`, `desplegando`

can collapse to shared stem forms and improve recall.

## Intent Detection

Before combining score components, the system classifies the query into one of three intent profiles:

- `debug`
- `brainstorm`
- `default`

Intent is detected by checking stem overlap between the query and curated vocabularies.

### Current Weight Profiles

#### Debug

Used for queries about bugs, failures, exceptions, crashes, and diagnosis.

- semantic: `0.20`
- bm25: `0.30`
- graph: `0.30`
- recency: `0.10`
- importance: `0.05`
- access_frequency: `0.05`

#### Brainstorm

Used for ideation, proposals, suggestions, and exploration.

- semantic: `0.30`
- bm25: `0.05`
- graph: `0.05`
- recency: `0.25`
- importance: `0.30`
- access_frequency: `0.05`

#### Default

Balanced profile for all other queries.

- semantic: `0.30`
- bm25: `0.15`
- graph: `0.10`
- recency: `0.15`
- importance: `0.20`
- access_frequency: `0.10`

## Query Expansion

The system supports query expansion through stem-aware synonym clusters.

Examples of cluster themes include:

- bugs and errors
- fixes and corrections
- ideas and proposals
- deploy and release
- tests and validation

If the query intersects a cluster at the stem level, the full cluster is appended to the expanded query.

### Important Rule

Query expansion is currently used for lexical recall, especially BM25.

It is deliberately **not** used for the semantic heuristic score.

Current behavior in `compute_score()` is:

- `semantic_score_free()` uses the original user query
- `compute_bm25()` uses the expanded query

This matters because semantic overlap scores normalize by query term count. Expanding the semantic query would dilute exact matches.

## Score Components

The final hybrid score combines 6 signals:

- `semantic`
- `bm25`
- `recency`
- `importance`
- `access_frequency`
- `graph_proximity`

Each memory gets a full `ScoreBreakdown`, which is important for observability and debugging.

## Semantic Heuristic Score

`semantic_score_free()` is an interpretable heuristic, not an embedding-based score.

### Current Formula

- 40% tag overlap
- 35% `L0` keyword overlap
- 25% ontology bonus

### Ontology Bonus

The ontology bonus tries to reward memories whose knowledge shape fits the query.

Examples:

- `Skill` and `Rule` memories get extra weight for coding or writing-like queries
- `Synthesis` gets extra weight for analysis-like queries
- `Entity`, `Concept`, `Source`, and `Unknown` each have different base heuristics

This is intentionally simple and explainable.

## BM25

BM25 provides lexical precision over memory content.

### Parameters

- `k1 = 1.2`
- `b = 0.75`

### Shared Corpus

The engine precomputes a shared `Bm25Corpus` once per query. It stores:

- `doc_freq`
- `avg_doc_len`
- `total_docs`

This avoids recomputing corpus-wide statistics for every memory.

### Current Implementation Detail

At the time of writing, there is an important asymmetry:

- the BM25 corpus is built from `raw_content`
- the per-memory BM25 score is computed against `l0 + l1 + l2`

This is the current implementation, not a typo in this document. Any future attempt to unify these two representations should be treated as a behavior change and validated carefully.

## Time And Priority Signals

### Recency

Recency uses an exponential decay curve:

`exp(-0.05 * days_since_last_access)`

This gives a smooth decay instead of a hard freshness cutoff.

### Importance

`importance` comes from memory frontmatter. It is an editorial signal representing how important the author believes a memory is.

### Access Frequency

Access frequency is normalized with a logarithmic scale:

`log(1 + count) / log(1 + max_count)`

This prevents a few heavily accessed memories from dominating the ranking too aggressively.

## Graph Construction

The graph is built from `collect_typed_edges()`, which is the single source of truth for graph edge semantics.

### Edge Types And Weights

- `requires`: `1.0`
- `related`: `0.7`
- `wikilink`: `0.5`
- `optional`: `0.4`
- `tag strong` (2 or more shared tags): `0.3`
- `tag weak` (exactly 1 shared tag): `0.1`

### Deduplication Rule

If two memories are connected in multiple ways, only the strongest edge is kept for that pair.

Example:

- if `A related B`
- and `A requires B`

the graph keeps the `requires` relation for that pair.

This keeps the graph compact and avoids double-counting parallel relationships.

### Direction

The declared direction is preserved for frontend rendering and author intent, but the current community and PPR computations treat the graph as undirected.

## Community Detection

Communities are computed with a weighted label propagation algorithm.

Instead of counting neighbors equally, the algorithm sums edge weights per label. That means a `requires` edge can pull a node much more strongly than a weak tag-only relation.

### Properties

- deterministic tie-breaking
- maximum 20 iterations
- isolated nodes become singleton communities

These communities mainly support graph understanding and visualization.

## Graph Proximity With Personalized PageRank

Graph proximity now uses Personalized PageRank (PPR).

### Why Two Passes

Graph scoring is not available at the start of ranking. The system first needs candidate seeds.

So the engine does this:

1. rank memories without graph proximity
2. choose the top 5 as seeds
3. compute PPR from those seeds
4. rank again with `graph_proximity`

### Current PPR Behavior

The implementation now has two layers:

- a raw PPR distribution
- a normalized graph proximity score derived from that raw distribution

Important current rules:

- seeds receive `0.0` graph bonus, because they already define the active context
- dangling mass from isolated seed nodes is redirected back through the teleport distribution instead of being lost
- non-seed nodes are normalized by the highest-scoring non-seed node so `graph_proximity` stays in `[0, 1]`

### Interpretation

`graph_proximity` is best understood as a **relative neighbor relevance signal within the current query**, not as a universal graph distance metric.

That distinction matters:

- edge weights matter strongly when multiple outgoing paths compete
- but in very small local structures, weighted random walks behave relatively rather than absolutely

This is one reason the graph score is only one component of the final hybrid score.

## Skill Dependency Behavior

After the second pass, the engine inspects the top results again.

If a top-ranked memory is a `Skill` and its score is above `0.15`:

- `requires` dependencies become force-loaded
- `optional` dependencies receive a small final score boost of `+0.1`, capped at `1.0`

This lets strongly relevant skills pull in their required support context.

## Load Level Selection And Token Budgeting

Once memories are ranked, the engine decides how much of each memory to load:

- `L0`: title only
- `L1`: summary
- `L2`: full detailed content

### Current Threshold Logic

Given the current `top_score`:

- `L2` threshold = `max(top_score * 0.9, 0.3)`
- `L1` threshold = `max(top_score * 0.65, 0.15)`

Additional rules:

- at most 3 memories can be loaded at `L2`
- force-loaded dependencies can enter at `L1` even when they would not naturally qualify
- allocation is greedy and stops when the token budget is exhausted

### Practical Effect

This means the ranking algorithm does not just decide relevance. It also shapes the final context package structure and granularity.

## Key Developer Invariants

These are the most important invariants to keep in mind when changing this subsystem:

- semantic scoring should stay interpretable and debuggable
- query expansion should not silently distort semantic exact matches
- graph proximity should not self-boost seed memories
- dangling seed nodes should not cause probability mass loss in PPR
- `ScoreBreakdown` should remain inspectable for each ranked memory
- token budget selection should stay downstream of scoring, not fused into scoring itself

## What To Read First When Modifying Behavior

If you are changing this subsystem, read these functions first:

- `tokenize()`
- `detect_intent_weights()`
- `expand_query()`
- `compute_score()`
- `collect_typed_edges()`
- `compute_community_map()`
- `personalized_pagerank()`
- `execute_context_query()`

That set is the minimum mental model for changing retrieval safely.
