# Architecture And Operating Model

## Purpose

AI Context OS is a filesystem-first memory layer for AI agents.

It is not meant to be a chat product and not meant to be tied to a single external tool. The system is intended to act as a persistent, compounding knowledge base that can be edited and maintained by humans and AI together, while remaining readable and portable as plain files.

The product thesis is:

- files are the source of truth
- context should be routed and maintained, not rediscovered from scratch every time
- integrations should be adapters, not the canonical system
- the memory graph should improve over time as the user works

## Core storage model

The canonical data model lives in the workspace filesystem.

This means:

- memories are Markdown files with YAML frontmatter
- journal pages are files
- tasks are files
- rules are files
- scratch output is files
- router and adapter artifacts are files

The app also uses SQLite locally for observability only:

- location: `{workspace}/.cache/observability.db`
- purpose: telemetry, context-request history, health snapshots, optimization suggestions
- non-canonical: it is not the source of truth for memory content

This distinction is critical. The filesystem is the knowledge base. SQLite is support infrastructure.

## Progressive memory model

Each memory has three levels:

- `L0`: one-line summary in frontmatter
- `L1`: operational summary
- `L2`: full detail

The current system uses explicit markers:

```md
---
id: example-memory
type: context
ontology: entity
l0: "One-line summary"
importance: 0.8
tags: [example]
related: [other-memory]
---

<!-- L1 -->
Operational summary.

<!-- L2 -->
Long-form detail.
```

This model is important because it allows the engine to load just enough context.

## Current memory classification model

### Operational `type`

The existing `type` field is still the system's operational classification. It is part of the current contract and is used across Rust, TypeScript, routing, CRUD, folder inference, and UI behavior.

Current values:

- `context`
- `daily`
- `intelligence`
- `project`
- `resource`
- `skill`
- `task`
- `rule`
- `scratch`

This field should currently be understood as "how the system treats this memory operationally".

### Ontology layer

The system now includes an optional ontology field:

- `source`
- `entity`
- `concept`
- `synthesis`

This layer exists to improve AI reasoning without replacing the current storage model.

The ontology is meant to answer:

- what kind of thing is this file semantically?
- should the AI treat it as raw input, a real-world object, an abstract idea, or a distilled output?

### Why both layers exist

There was an important product decision behind this:

- users should remain free to organize their lives with folders however they want
- the system should not depend only on folder names to understand content
- the AI needs a semantic layer that survives future folder changes

So the intended long-term separation is:

- folders: for human organization
- `type`: currently operational system classification
- `ontology`: semantic classification for AI

## Workspace structure

### Current stable workspace

The workspace uses the new "Zero Gravity" structure, decoupling physical layout from semantic meaning:

```text
workspace/
├── inbox/
├── sources/
├── .ai/
│   ├── rules/
│   ├── journal/
│   ├── tasks/
│   ├── scratch/
│   ├── config.yaml
│   └── index.yaml
├── User_Folders/   ← cosmetic, user-defined
├── claude.md
├── .cursorrules
├── .windsurfrules
└── .cache/
```

### Meaning of `inbox/`

`inbox/` is the intake area for future ingestion workflows.

Its role is:

- hold raw or semi-raw material pending processing
- give the user an obvious drop zone for incoming material
- provide a clean first step for future ingest commands and UI

Important:

- `inbox/` is not currently a full memory folder
- files there can be opened as raw files in the explorer
- but they are not yet part of the regular memory index unless they are moved into a user folder or future ingestion logic promotes them

## Routing model

The router is designed to be neutral-first and adapter-based.

The system generates a neutral routing document and then renders compatibility artifacts like:

- `claude.md`
- `.cursorrules`
- `.windsurfrules`

This matters because the product should not become conceptually owned by one tool.

`claude.md` still exists for compatibility and usefulness, but it should be treated as a derived artifact, not as the source of truth.

## Query and scoring model

The engine currently works by:

1. scanning workspace memories
2. scoring them against a query
3. using budget-aware loading rules
4. deciding `L0`, `L1`, or `L2`
5. returning loaded vs unloaded memory context

Current scoring is deterministic and heuristic-first. It combines:

- heuristic semantic score
- BM25-style lexical score
- recency
- importance
- access frequency
- graph proximity

The system does not currently use Tantivy or production embeddings as its active retrieval core.

The intended future direction is likely:

- stronger local lexical retrieval first
- semantic layers second
- local embeddings used initially for maintenance and assistance, not as the only source of retrieval truth

## Governance model

The system already contains a governance layer that inspects the knowledge base for quality issues.

Current governance areas:

- contradictions between related memories
- decay candidates
- consolidation suggestions
- scratch cleanup candidates

This is conceptually close to the "lint" operation described in LLM-maintained wiki patterns, even though the full ingest-query-lint cycle is not finished yet.

## Ingestion model: intended direction

The intended ingestion workflow is:

1. a source lands in `inbox/`
2. the user triggers ingestion explicitly
3. the system reads the source
4. the system proposes ontology, summary, tags, and affected pages
5. the system creates new knowledge or updates existing memories
6. the source is marked as processed or moved
7. the action is logged

This is not fully implemented yet. Right now, only the first structural piece exists: the inbox itself.

## External AI vs local AI roles

The current system already integrates with external AI tools through adapters and MCP. This is the main collaboration model today.

Longer-term, there is also room for local model support for background maintenance tasks such as:

- classification
- deduplication hints
- ontology suggestions
- ingestion summaries
- update proposals
- governance assistance

That future direction should not replace external-tool integration. It should complement it.

## Product principle about folders

One of the most important decisions reached in the design discussion was this:

- users should keep the freedom to organize their world using folders however they want
- the app should not force a single lifestyle taxonomy onto everyone

Therefore the future architecture should preserve:

- human folder freedom
- AI semantic understanding through frontmatter
- small system-owned zones only where the product truly needs them

## Invariants to preserve

- `src/lib/types.ts` must mirror `src-tauri/src/core/types.rs`
- new Rust commands must be registered in `core/mod.rs`, `commands/mod.rs`, and `lib.rs`
- `L0/L1/L2` should remain explicit
- adapter artifacts are derived, not canonical
- ontology should enhance the system without breaking existing operational behavior
