# Documentation

This folder contains the long-form system documentation for AI Context OS.

It is designed for two audiences at the same time:

- humans who need to understand the product, review decisions, and evolve the system
- future AI agents that need a reliable explanation of how the workspace, memory model, routing, ontology, and ingestion strategy are supposed to work

## Folder Structure

The documentation is now divided into two main areas:

### 1. `Memm wiki/`
Contains the core documentation, architecture specs, and whitepapers:
- [Architecture And Operating Model](./Memm%20wiki/architecture-and-operating-model.md)
- [Technical Paper](./Memm%20wiki/paper.md)
- [Technical Whitepaper](./Memm%20wiki/whitepaper.md)
- [Current Architecture Router](./Memm%20wiki/ARQUITECTURA-ACTUAL-ROUTER-CONTEXTO-Y-MEMORIAS.md)

### Core Technical References In `docs/`
- [Algorithms And Scoring](./algorithms-and-scoring.md)

### 2. `roadmap/`
Contains development plans, technical reviews, and upcoming features:
- [Current State, Implemented Changes, And Roadmap](./roadmap/current-state-and-roadmap.md)
- [Pending Features](./roadmap/FEATURES-PENDIENTES.md)
- [Technical Alignment Review](./roadmap/REVISION-TECNICA-ALINEACION-2026-03-29.md)

### 3. Top-level guides
Focused guides for specific product capabilities:
- [Custom Themes](./themes.md)

## Scope of this folder

These docs intentionally go deeper than the root README:

- system purpose and product thesis
- storage model and canonical boundaries
- progressive memory model (`L0`, `L1`, `L2`)
- ontology layer
- current workspace structure
- adapter-first integrations
- inbox and future ingestion design
- what is already implemented in code
- what is still planned
- constraints and invariants that should not be broken casually

## Maintenance rule

When core architecture changes, update this folder and the corresponding subdirectories in the same change whenever possible.
