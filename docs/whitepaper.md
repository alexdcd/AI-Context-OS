# AI Context OS — Technical Whitepaper

**Version 1.0 · April 2026**

---

## Executive Summary

AI Context OS is a desktop application that solves the persistent memory problem for AI-assisted software engineering. Every time you open a new conversation with Claude, Cursor, or any other AI tool, you start from scratch. AI Context OS gives those tools persistent, structured, scored memory — stored entirely as local files that you own, inspect, and control.

The system works in three layers:

1. **A structured workspace** of typed markdown files that serve as the memory corpus
2. **A scoring engine** (Rust, ~sub-10ms per query) that ranks memories by relevance and loads them within a token budget
3. **An MCP server** that exposes the memory to any connected AI tool via a standard protocol

No vector database. No cloud dependency. No opaque embeddings. Your memory, in files you can read.

---

## The Problem

As an AI engineer, you face a compounding context problem:

**Problem 1: Every session starts blank.** Claude doesn't remember what you decided yesterday. Cursor doesn't know the architectural pattern you established last week. You spend the first minutes of every session re-establishing context that you've already explained ten times.

**Problem 2: Manual context files don't scale.** You've probably tried maintaining a `CLAUDE.md` or `.cursorrules`. It works until it doesn't — the file grows, becomes unwieldy, gets stale, and eventually you stop trusting it. There's no structure, no scoring, no way to know what the AI actually reads.

**Problem 3: RAG is overkill and opaque.** Setting up a vector database for personal project memory is infrastructure overhead most engineers don't want to maintain. And even if you do, you can't easily inspect what the model will retrieve for a given query.

**Problem 4: Your memory is tool-specific.** The context you've built for Claude Desktop doesn't help Cursor. You maintain separate, diverging context across tools.

AI Context OS addresses all four problems with a single, file-based memory workspace that integrates with all your AI tools simultaneously.

---

## How It Works

### The Workspace

The workspace is a directory (`~/AI-Context-OS/` by default) with a structure divided between fixed system infrastructure and completely free user space:

```
~/AI-Context-OS/
├── inbox/          ← temporary capture zone (landing pad)
├── sources/        ← external references (read-only by default)
├── .ai/            ← hidden system infrastructure
│   ├── rules/      ← behavioral rules for AI agents (top attention)
│   ├── journal/    ← daily logs and sessions
│   ├── tasks/      ← subsystem for task tracking
│   ├── scratch/    ← temporary AI output buffer (TTL-based)
│   ├── config.yaml ← workspace configuration
│   └── index.yaml  ← auto-generated L0 catalog
├── User_Folders/   ← cosmetic, user-defined structure (e.g., Projects, Notes)
├── claude.md       ← master router (auto-generated)
└── .cursorrules    ← tool-specific adapter
```

The system infrastructure is completely contained within the fixed `inbox/`, `sources/`, and the hidden `.ai/` directory. Everything else in the workspace is cosmetically structured by the user. The system uses a recursive scanner to find markdown files across all user-created directories (ignoring `.git` or `node_modules`), ensuring the engineer has absolute freedom to organize their files without breaking the AI's memory.

### Memory Files

Each memory is a `.md` file with YAML frontmatter:

```markdown
---
id: rust-error-handling-conventions
type: skill
l0: "Prefer Result<T, AppError> with thiserror; never unwrap in handlers"
importance: 0.9
tags: [rust, error-handling, conventions]
related: [rust-architecture, api-design]
created: 2026-03-01
modified: 2026-04-08
version: 4
---

<!-- L1 -->
We use `thiserror` for defining structured error types. All Tauri commands
return `Result<T, String>` for IPC compatibility; internal functions use
`Result<T, AppError>`. Never use `.unwrap()` in command handlers — always
propagate with `?` or convert explicitly.

<!-- L2 -->
Full detail: enum definitions, conversion implementations, logging conventions,
examples of correct and incorrect usage across the codebase...
```

The `l0` field (one line) is always available. `<!-- L1 -->` is a paragraph summary. `<!-- L2 -->` is the full content. The scoring engine decides which tier to load based on relevance and token budget.

### The Scoring Engine

When an AI tool calls `get_context` with a query (e.g., "implement error handling for the new API endpoint"), the engine:

1. Scans all memory files and reads their metadata
2. Expands the query with synonyms ("error" → "error bug exception failure")
3. Detects intent (debug / brainstorm / default) and selects a weight profile
4. Scores every memory across 6 signals:

| Signal | What it measures |
|--------|-----------------|
| Semantic | Keyword overlap with query |
| BM25 | Term frequency / inverse document frequency |
| Graph | Link connectivity + community membership |
| Recency | How recently the memory was modified |
| Importance | Engineer-assigned weight (0.0–1.0) |
| Access frequency | How often this memory has been used recently |

5. Ranks memories by composite score
6. Greedily loads memories within the token budget, choosing L1 or L2 based on remaining budget and score

**Community detection:** Before scoring, the engine leverages structural graph algorithms (like Leiden or LPA) over an enriched graph — explicit `related`/`requires`/`optional` links plus implicit edges between memories sharing ≥2 tags. Unlike K-means over embeddings, these detect communities purely by edge density and modularity without needing predefined 'K' clusters. This accurately assigns each memory to a topical cluster. During scoring, a memory in the same community as any top-5 match gets a +0.08 graph proximity bonus. This activates the graph signal even when engineers haven't written explicit cross-references.

The entire pipeline runs in Rust and completes in single-digit milliseconds for typical workspaces (< 500 memories).

### The Router

The selected memories are assembled into a context document (`claude.md`) using attention positioning:

- **Top**: System Rules (`.ai/rules/`) — the router is hardcoded to extract these behavioral constraints and inject them at the absolute top of the prompt window, guaranteeing maximum attention regardless of token budgets
- **Middle**: Selected memories at appropriate tiers, injected based strictly on their hybrid multi-signal score, entirely ignoring where files are stored on disk
- **Bottom**: L0 index — full catalog of available memories for agent reference

This document is auto-generated and auto-regenerated whenever the workspace changes. Tool-specific adapters render variants for different tools:

- `claude.md` — for Claude Desktop and Claude Code
- `.cursorrules` — for Cursor
- `.windsurfrules` — for Windsurf

### The MCP Layer

AI Context OS runs an MCP server in two transport modes:

**stdio** (for Claude Code, Codex CLI):
```json
{
  "mcpServers": {
    "ai-context": {
      "command": "ai-context-cli",
      "args": ["mcp-server"]
    }
  }
}
```

**HTTP/SSE** (for Cursor, Windsurf):
```
http://127.0.0.1:3847
```

Four tools are exposed:

| Tool | Description |
|------|-------------|
| `get_context` | Query the memory corpus with a task description. Returns token-budgeted, scored memories. |
| `save_memory` | Write a new memory to the workspace from within an AI session. |
| `get_skill` | Retrieve a specific skill by ID. |
| `log_session` | Append an event to the daily log. |

---

## Key Technical Decisions

### Why Rust for the scoring engine?

The scoring engine needs to be fast — it runs on every context query, and slow context loading breaks the AI interaction flow. Rust gives us sub-10ms query times on typical workspaces without a persistent server process. The engine is compiled into both the Tauri desktop app and the `ai-context-cli` binary, sharing 100% of the scoring logic.

### Why files instead of SQLite or a vector database?

SQLite would be faster for large corpora and would support more complex queries. A vector database would enable true semantic similarity. We chose files because:

1. **Transparency**: The engineer can read, edit, and understand every memory directly
2. **Portability**: Files travel with git clone, backup natively, sync with any tool
3. **Versionability**: Git history is the memory history
4. **Zero infrastructure**: No database server, no embedding model required to get started
5. **Composability**: The same files are readable by humans, AI tools, and any other software

The scoring engine compensates for the lack of true semantic embeddings through query expansion and multi-signal ranking. The roadmap includes local embedding support as an optional enhancement.

### Why YAML frontmatter instead of a sidecar metadata file?

Keeping metadata in the same file as content ensures that the memory is always a self-contained unit. There is no synchronization problem between a content file and a separate metadata file. The file can be moved, copied, or edited without losing its metadata.

### Why a typed ontology instead of tags-only?

Tags are useful but insufficient for memory management. The type of a memory determines:
- Its default decay characteristics (rules decay slowly; scratch expires quickly)
- Its priority in the router (rules are always loaded first)
- Its scoring profile (daily entries are scored differently from architectural decisions)
- Its governance behavior (scratch files are cleanup candidates; sources are protected)

Tags augment type; they do not replace it.

---

## Token Budget Management

The token budget is a first-class constraint in the scoring engine. A typical Claude session might have a budget of 4,000–8,000 tokens for context. The engine must select the most relevant content without exceeding the budget.

The selection algorithm:

1. Sort all memories by composite score (descending)
2. For each memory, try to load at L2; if L2 exceeds remaining budget, try L1; if L1 exceeds budget, load L0 (from frontmatter — no file read required)
3. Stop when budget is exhausted

This produces a context window that is maximally informative within the budget constraint.

You can simulate this process in the app's Simulation view: enter a query and token budget, and see exactly which memories would be loaded, at which tier, with what score breakdown. This is the transparency property that distinguishes AI Context OS from opaque retrieval systems.

---

## Memory Governance

Left unmanaged, any memory system accumulates stale information. AI Context OS includes a governance layer that surfaces:

**Decay candidates**: Memories not modified in 90+ days with low access frequency. Review and update or archive.

**Conflicts**: Memories with high semantic overlap but inconsistent content — potential contradictions in your knowledge base.

**Consolidation suggestions**: Clusters of related memories that could be merged into a single, more comprehensive entry.

**God nodes**: Memories with high graph degree (many explicit links) but low engineer-assigned importance. This mismatch — the graph says it's central, the engineer hasn't reflected that — surfaces in a dedicated tab. Resolving it means bumping the importance score so the scoring engine reflects the structural reality of your knowledge base.

**Scratch cleanup**: Files in `.ai/scratch/` older than their TTL — temporary AI outputs that should be archived or deleted.

**Health score**: A 0-100 composite metric visible in the app header at all times:

| Component | Weight | Measures |
|-----------|--------|----------|
| Coverage | 25% | % of memories accessed in last 14 days |
| Efficiency | 25% | Token budget utilization (ideal: 50-80%) |
| Freshness | 20% | % of memories modified recently |
| Balance | 15% | Distribution across memory types |
| Cleanliness | 15% | % of memories not flagged by governance (includes god node mismatches) |

---

## Integration Guide

### Claude Desktop

1. Open AI Context OS and complete workspace setup
2. Go to Connectors → Claude Desktop
3. Copy the generated MCP configuration snippet
4. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
5. Restart Claude Desktop
6. Claude now has access to `get_context`, `save_memory`, `get_skill`, `log_session`

### Claude Code

1. In your project root: `claude mcp add ai-context -- ai-context-cli mcp-server`
2. Or add to `.claude/settings.json`:
```json
{
  "mcpServers": {
    "ai-context": {
      "command": "ai-context-cli",
      "args": ["mcp-server"]
    }
  }
}
```
3. Claude Code will now call `get_context` automatically when it needs project context.

### Cursor / Windsurf

These tools use HTTP/SSE MCP. Ensure AI Context OS is running, then add to your tool's MCP settings:

```
http://127.0.0.1:3847
```

The `.cursorrules` and `.windsurfrules` files in your project root are also auto-generated with static context that is available even without MCP.

---

## Observability

Every context query is logged to a SQLite database at `{workspace}/.cache/observability.db`. The Observability view in the app shows:

- Query history with timestamps
- Which memories were loaded vs. not loaded for each query
- Token usage trends over time
- Health score history

This gives you a complete audit trail of what your AI tools have been reading — something no other context management system provides.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│                  AI Context OS Desktop               │
│  ┌─────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  File       │  │ Scoring  │  │  Governance   │  │
│  │  Explorer   │  │ Engine   │  │  & Health     │  │
│  └──────┬──────┘  └────┬─────┘  └───────┬───────┘  │
│         │              │                │            │
│  ┌──────▼──────────────▼────────────────▼───────┐   │
│  │              Workspace (~/AI-Context-OS/)      │   │
│  │  inbox/  sources/  .ai/  User_Folders/        │   │
│  │  claude.md  .cursorrules  .cache/             │   │
│  └──────────────────────────┬────────────────────┘   │
└─────────────────────────────┼──────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    ┌─────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
    │ MCP stdio  │    │  MCP HTTP   │    │   Static    │
    │ (CLI tools)│    │ :3847 (IDE) │    │  .md files  │
    └─────┬──────┘    └──────┬──────┘    └──────┬──────┘
          │                  │                   │
    ┌─────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
    │Claude Code │    │   Cursor    │    │   Any AI    │
    │  Codex CLI │    │  Windsurf   │    │   reading   │
    └────────────┘    └─────────────┘    │ claude.md   │
                                         └─────────────┘
```

---

## Current Status

AI Context OS is in active development. Core features are stable and in daily use:

- ✅ Workspace setup and file ontology
- ✅ YAML frontmatter + L0/L1/L2 tiered content
- ✅ Hybrid 6-signal scoring engine (Rust)
- ✅ Intent-adaptive weight profiles
- ✅ Query expansion
- ✅ MCP server (stdio + HTTP/SSE)
- ✅ Multi-tool router with adapters (Claude, Cursor, Windsurf, Codex)
- ✅ Governance (decay, conflicts, consolidation, scratch TTL)
- ✅ Health score (5-component)
- ✅ Observability (SQLite, query history)
- ✅ Simulation view (preview context for any query)
- ✅ Journal (daily outliner, Logseq-style)
- ✅ Tasks (YAML-frontmatter tasks with state/priority)
- ✅ Graph visualization (memory connectivity) with community coloring
- ✅ Community detection (LPA + tag co-occurrence) feeding graph proximity score
- ✅ God nodes governance tab (importance mismatch detection)
- ✅ Backup/restore

On the roadmap:
- ⬚ Local embedding model for true semantic scoring
- ⬚ Agents marketplace (installable agent templates)
- ⬚ Multi-workspace support
- ⬚ Import from Obsidian/Logseq

---

*Built with Tauri v2, React, TypeScript (frontend) and Rust (backend). Packaged as a native desktop app for macOS, Windows, and Linux.*
