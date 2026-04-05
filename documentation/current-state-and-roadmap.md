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

## How future AI agents should read this project

If an AI agent needs to review the system in the future, the intended reading order is:

1. root README
2. this `documentation/` folder
3. `AGENT.md`
4. `AGENTS.md`
5. `REVISION-TECNICA-ALINEACION-2026-03-29.md`
6. current code

When in doubt:

- trust the code for actual implemented behavior
- trust this folder for current architectural intent
- treat older roadmap ideas as proposals unless confirmed in code
