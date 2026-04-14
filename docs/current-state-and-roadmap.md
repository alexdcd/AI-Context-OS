# Current State, Implemented Changes, And Roadmap

## Why this document exists

This file captures the current state of the product after the recent architecture discussion and the first implementation pass.

It has three goals:

- explain what is already true in code
- record the rationale behind recent changes
- make future reviews easier for humans and AI agents

## Recently implemented changes

### 1. Ontology field added to memories

The system now supports an optional `ontology` field in memory frontmatter.

Current values:

- `source`
- `entity`
- `concept`
- `synthesis`

This field is now part of both:

- Rust memory metadata
- TypeScript memory metadata

It is persisted in frontmatter and shown in the memory inspector UI.

### 2. Default ontology assignment

When new memories are created through current app flows, the system assigns a default ontology based on the existing operational `type`.

Current default mapping:

- `resource` -> `source`
- `project`, `context`, `task` -> `entity`
- `skill`, `rule` -> `concept`
- `daily`, `intelligence`, `scratch` -> `synthesis`

This is only a starting point. It is meant to be editable.

### 3. Inbox folder added

The workspace now includes:

```text
00-inbox/
```

It is created during workspace initialization and shown in onboarding and router output.

This folder is the intake zone for future ingestion workflows.

### 4. Explorer behavior updated for inbox

The explorer now treats inbox files as raw documents rather than managed memories by default.

That means:

- inbox files are visible
- inbox `.md` files can be opened as raw files
- inbox files are not treated as indexed memories unless they become actual memories later
- the app avoids offering misleading "memory" operations there

This prevents confusing behavior during the transition period before ingestion is fully implemented.

### 5. Router output updated

The router now communicates:

- the existence of `00-inbox/`
- the existence of the `ontology` field
- ontology information in the generated memory index

This helps external AI tools understand the semantic layer earlier.

## What is working now

Verified in code:

- workspace bootstrap
- numbered workspace folders plus `00-inbox`
- memory CRUD
- frontmatter parse/write
- ontology persistence
- ontology editing in UI
- router regeneration
- graph, governance, observability, journal, tasks
- MCP stdio and MCP HTTP
- connectors view and bridge flows

## What is not implemented yet

Important to keep honest:

- there is no full ingestion command yet
- there is no "process inbox item" workflow yet
- the ontology is not yet deeply used in scoring or governance
- `00-inbox` is structural groundwork, not a complete ingestion feature
- there is still no production Tantivy search index
- there are still no production local embeddings in the app pipeline

## Key product decisions from the discussion

### Decision 1: keep folder freedom for users

We should not force a single rigid life taxonomy onto users.

The intended principle is:

- folders are primarily for humans
- ontology is for AI semantics

This lets someone organize by:

- work
- health
- projects
- family
- finance
- anything else

without losing AI understanding.

### Decision 2: do not overload the current `type`

There was a real design question about whether `type` should become the ontology field.

The current answer is:

- not yet
- the existing `type` is part of the operational system contract today
- changing its meaning all at once would create unnecessary breakage

So the current strategy is:

- keep existing `type`
- add `ontology` beside it
- evolve later if needed

### Decision 3: implement inbox first, then ingestion

This was chosen as the lowest-risk path:

- create the intake zone now
- let users start using the concept immediately
- implement actual ingestion as a next phase

## Recommended next phases

### Related roadmap documents

- [Plan implementacion separacion L1/L2 sin MCP](./roadmap/plan-implementacion-separacion-l1-l2-sin-mcp.md)

### Phase 2: ingestion MVP

Recommended scope:

- list inbox items
- open an inbox item
- trigger "ingest"
- generate summary + ontology suggestion
- suggest target memories to update
- create or update memories
- log what changed

This should be supervised, not fully autonomous, in the first version.

### Phase 3: ontology-aware operations

Once ingestion exists, the next useful step is to make ontology influence behavior:

- bias scoring by ontology
- improve governance heuristics
- separate source vs synthesis treatment
- improve memory suggestions and linking

### Phase 4: stronger search and maintenance

Candidate improvements:

- stronger local lexical search
- possibly Tantivy or equivalent
- semantic duplicate detection
- better merge suggestions
- better source-to-memory traceability

### Phase 5: Tantivy plus local embeddings

This area should be approached in a staged and pragmatic way.

#### Tantivy / stronger lexical retrieval

Recommendation:

- yes, likely yes
- close-to-mid-term roadmap candidate
- especially valuable once ingestion starts increasing file count and memory count

Expected benefits:

- better lexical search quality
- faster retrieval on larger workspaces
- stronger handling of exact technical terms, names, file references, and precise wording
- more reliable candidate generation before the higher-level scoring or LLM reasoning layer acts

Why this matters:

- ingestion will increase both raw sources and derived memories
- simple file scanning and lightweight heuristics will become less competitive as scale grows
- stronger lexical retrieval improves both responsiveness and trust

Product recommendation:

- prioritize robust local lexical retrieval before shipping a more complex semantic retrieval layer

#### Local embeddings

Recommendation:

- yes, but not as the first jump
- after ingestion foundations and stronger lexical retrieval are in place

Where local embeddings add real value:

- detecting duplicates
- suggesting merges
- semantic clustering
- finding related pages when wording differs
- enriching ingestion
- enriching governance and lint workflows

Why not first:

- adds more operational complexity
- requires background indexing and model lifecycle management
- increases CPU, RAM, and disk expectations
- introduces UX questions around model downloads and updates

Implementation philosophy:

1. lexical retrieval first
2. embeddings second
3. embeddings initially used as an assistive maintenance layer, not as the only retrieval backbone

This keeps the system deterministic-first and explainable while still opening the door to semantic power.

### Phase 6: Herramientas MCP Exploratorias / Navegación del Grafo 🌟🌟🌟

**Qué es:** Darme herramientas para recorrer activamente nuestro "Scoring Engine" y el "Grafo" si el contexto automático se queda corto.

**Por qué integrarlo:** Soluciona mi "ceguera". Si necesito saber todo sobre "autenticación", debería poder consultar los registros de esa comunidad directamente. En MemPalace usan herramientas como `mempalace_traverse` o `mempalace_list_rooms`.

**Dificultad de Implementación (Baja):**
AICO ya genera internamente grafos, relaciones y puntuaciones. Solo hay que exponer en el MCP:
- `list_topics()` (lista tags/comunidades detectadas)
- `get_related_memories(id)`
- `search_by_tag(tag)`

## Recommendation on local models

From a PM and engineering perspective, local models are useful, but mainly for maintenance and support tasks at first.

Best near-term use cases:

- classify source type
- propose ontology
- generate ingest summaries
- suggest links
- detect possible duplicates
- suggest governance actions

External AI tools through MCP should remain first-class even if local models are added later.

## Local models inside the app

This is now a meaningful strategic direction for the product.

The point is not to replace Claude, Codex, or other external agents. The point is to add an optional local intelligence layer that helps maintain, clean, enrich, and organize the workspace from inside the app itself.

### Best near-term roles for local models

- classify source type
- propose ontology
- autofill YAML/frontmatter fields
- detect duplicate candidates
- suggest merges
- generate ingestion summaries
- propose links and related pages
- detect contradiction candidates
- support lint and governance passes
- normalize structure and formatting

These are high-value tasks because they improve the knowledge base continuously without requiring a frontier model for every background operation.

### Useful model tiers

#### Small local models

Best for:

- classification
- extraction
- labeling
- format normalization
- metadata suggestions

This tier is useful for lightweight, frequent, low-cost background assistance.

#### Small/medium local models

Best for:

- ingestion summaries
- ontology proposals
- duplicate detection support
- relationship suggestions
- governance proposals
- light synthesis and maintenance

This is likely the practical sweet spot for many advanced users with decent hardware.

#### Large local models

Best for:

- deeper local synthesis
- more autonomous maintenance passes
- stronger private/offline workflows
- users or teams that want local-first intelligence

These should be optional, never baseline assumptions.

### Likely integration direction

The most practical early direction is:

- external tools remain first-class through MCP
- local models act as app-native maintenance workers
- users download models on demand
- the system routes tasks to different local capabilities based on size and purpose

From a practical integration perspective, a local runtime approach such as Ollama is a credible early option because it reduces friction and allows model download on demand, while keeping the app architecture open to future alternatives.

### Product and business opportunity

This capability could become more than an internal technical feature.

Potential product outcomes:

- premium tier for advanced local maintenance features
- paid private/offline workflows for users with stronger hardware
- differentiated prosumer offering for people who want AI maintenance without cloud dependence
- commercial agreements or partnerships around bundled local AI experiences
- stronger enterprise value proposition for privacy-sensitive teams

In product terms, this is one of the clearest paths from "useful tool" to "stronger platform".

## How future AI agents should read this project

If an AI agent needs to review the system in the future, the intended reading order is:

1. root README
2. this `docs/` folder
3. `AGENT.md`
4. `AGENTS.md`
5. `REVISION-TECNICA-ALINEACION-2026-03-29.md`
6. current code

When in doubt:

- trust the code for actual implemented behavior
- trust this folder for current architectural intent
- treat older roadmap ideas as proposals unless confirmed in code
