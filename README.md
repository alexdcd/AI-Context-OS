# MEMM - Memory Master AI Context OS

Translations:
- [ES](/Users/alexdc/Documents/GitHub/AI-Context-OS/README.es.md)

Extended system docs:
- [Documentation Index](/Users/alexdc/Documents/GitHub/AI-Context-OS/documentation/README.md)

AI Context OS is a desktop app (`Tauri v2 + React + TypeScript + Rust`) that turns a local folder into a universal, tool-agnostic memory layer for AI agents.

This project is not a chat UI and not a wrapper around one provider. It is a filesystem-first brain layer with deterministic context loading (`L0/L1/L2`) and adapter-based integrations.

## Core thesis

- Canonical state lives in files.
- Context is routed, not improvised.
- Integrations are adapters, never the source of truth.
- UX should only promise real capabilities.
- Context quality must be observable and governable.

## Storage model (important clarification)

AI Context OS is filesystem-first:

- Memories, journal pages, tasks, rules, router artifacts, and scratch output are plain files in the workspace.
- The canonical source of truth is the workspace file tree.

AI Context OS also uses a local SQLite DB for observability:

- Path: `{workspace}/.cache/observability.db`
- Purpose: telemetry and optimization signals (requests served, usage stats, health snapshots, pending optimizations)
- Non-canonical: it does not replace or own your memory data model

## Progressive memory model: L0, L1, L2

Every memory has 3 levels:

- `L0`: one-line summary in frontmatter (`l0`)
- `L1`: operational summary body
- `L2`: full detail body

Memory files are Markdown with YAML frontmatter and level markers:

```md
---
id: stack-tecnologico
type: context
l0: "Project tech stack and conventions"
importance: 0.9
tags: [stack, architecture]
related: [convenciones-codigo]
---

<!-- L1 -->
Short operational summary.

<!-- L2 -->
Long-form detailed content.
```

## Workspace structure

```text
~/AI-Context-OS/
├── 01-context/
├── 02-daily/
│   ├── YYYY-MM-DD.md
│   ├── daily-log.jsonl
│   └── sessions/
├── 03-intelligence/
├── 04-projects/
├── 05-resources/
├── 06-skills/
├── 07-tasks/
│   ├── task-xxxxxxxx.md
│   └── backlog.jsonl
├── 08-rules/
├── 09-scratch/
├── .cache/
├── _config.yaml
├── _index.yaml
├── claude.md
├── .cursorrules
└── .windsurfrules
```

Key notes:

- Journal pages are `02-daily/YYYY-MM-DD.md` (Logseq-style outline).
- `daily-log.jsonl` is for system-style entries, not the primary daily editor.
- Tasks are markdown files in `07-tasks/` with YAML frontmatter.
- `claude.md` exists for compatibility, but the architecture target is adapter-first with neutral core output.

## Architecture

### Frontend

- React app shell and routes in [src/App.tsx](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/App.tsx)
- State in [src/lib/store.ts](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/lib/store.ts) and [src/lib/settingsStore.ts](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/lib/settingsStore.ts)
- IPC bridge in [src/lib/tauri.ts](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/lib/tauri.ts)
- TS contracts in [src/lib/types.ts](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/lib/types.ts)

### Backend

- Tauri bootstrap and command registry in [src-tauri/src/lib.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/lib.rs)
- Shared runtime state in [src-tauri/src/state.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/state.rs)
- Domain types in [src-tauri/src/core/types.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/types.rs)
- Scoring in [src-tauri/src/core/scoring.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/scoring.rs)
- Router + adapters in [src-tauri/src/core/router.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/router.rs) and [src-tauri/src/core/compat.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/compat.rs)
- Observability in [src-tauri/src/core/observability.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/observability.rs)
- MCP servers in [src-tauri/src/core/mcp.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/mcp.rs) and [src-tauri/src/core/mcp_http.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/mcp_http.rs)

## What is working right now (verified from code)

Implemented and wired:

- Workspace initialization, config load/save, and watcher rebind
- Memory CRUD (create/read/update/delete + file operations like rename/duplicate/move)
- File tree and raw file read/write from UI
- Router regeneration and adapter artifact writing (`claude.md`, `.cursorrules`, `.windsurfrules`)
- Context simulation endpoint and scoring pipeline
- Graph data generation and graph view
- Governance checks: conflicts, decay candidates, consolidation suggestions, scratch TTL candidates
- Journal pages (`get/save/list/get_today`)
- Task CRUD and task-state toggle
- Onboarding flow and template bootstrap
- Backup/restore commands
- Observability queries + health score + optimization suggestion flow
- MCP stdio server and MCP HTTP server (`127.0.0.1:3847/mcp`)
- Connectors page with local status and bridge actions (copy context, generate handoff file)

Working with limitations (important):

- Bridge tier currently supports copy/handoff flows, not full remote-native integration.
- Connector capabilities vary by tool; “universal” means universal core model + adapters, not identical feature depth everywhere.
- Some UX labels/copy still need consistency polish.

## Roadmap

This roadmap reflects the current codebase plus the alignment doc (`REVISION-TECNICA-ALINEACION-2026-03-29.md`).

### 1. Adapter-first hardening

- Keep neutral core generation as primary architecture.
- Preserve compatibility artifacts (`claude.md`) without letting them become canonical.
- Continue reducing implicit tool-specific assumptions in core flows.

### 2. Connector honesty and tier clarity

- Keep clear tiers (`Local Native`, `Bridge`, future `Remote`).
- Match UI copy to real capabilities per connector.
- Expand bridge handoff ergonomics without over-claiming.

### 3. Deterministic scoring evolution

- Continue conservative improvements in lexical expansion and intent weighting.
- Improve graph proximity in bounded, interpretable steps.
- Avoid opaque retrieval dependencies that break portability.

### 4. Governance + observability loop

- Turn optimization suggestions into safer guided actions.
- Improve health score explainability and user trust.
- Use telemetry to reduce context overloading and stale memory accumulation.

## Invariants (do not break)

- `src/lib/types.ts` must mirror `src-tauri/src/core/types.rs`
- New Rust command must be registered in:
  - `src-tauri/src/core/mod.rs`
  - `src-tauri/src/commands/mod.rs`
  - `src-tauri/src/lib.rs` (`invoke_handler`)
- UI text should be Spanish by default in product screens
- Theme must use CSS variables, no hardcoded ad-hoc colors
- Keep `L0/L1/L2` memory semantics explicit across docs and code

## Development

Requirements:

- Node.js + npm
- Rust toolchain
- Tauri v2 system dependencies

Commands:

```bash
npm install
npm run dev
npm run tauri dev
npm run build
```

Release by Git tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```
