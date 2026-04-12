# AGENT.md

Universal agent orientation for AI Context OS.

## Project identity

AI Context OS is a filesystem-first brain layer for AI agents. It is not a chat product and not tied to a single tool.

Core rule:

- canonical knowledge state lives in workspace files
- tool integrations are adapters

## Canonical memory model

Always preserve progressive memory semantics:

- `L0`: one-line summary in frontmatter
- `L1`: operational summary
- `L2`: full detail

Memory files use YAML frontmatter plus `<!-- L1 -->` and `<!-- L2 -->` markers.

## Storage boundaries

- Source of truth: workspace filesystem (`01-context` ... `09-scratch`)
- Auxiliary telemetry only: `.cache/observability.db` (SQLite)

Do not treat observability DB as memory source of truth.

## Adapter-first integration contract

- Keep neutral core routing logic as primary architecture.
- Keep compatibility artifacts (`claude.md`, `.cursorrules`, `.windsurfrules`) as derived outputs.
- Avoid tool-specific assumptions inside core memory/scoring paths unless unavoidable.

## Critical implementation invariants

- Keep `src/lib/types.ts` aligned with `src-tauri/src/core/types.rs`.
- When adding a Rust command, register it in:
  - `src-tauri/src/core/mod.rs`
  - `src-tauri/src/commands/mod.rs`
  - `src-tauri/src/lib.rs` (`invoke_handler`)
- Preserve Spanish UI text in product screens.
- Preserve CSS-variable-based theming (no hardcoded palette drift).
- Do not collapse `L0/L1/L2` into a 2-level model.
