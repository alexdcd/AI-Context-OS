# AI Context OS — Landing Page Blueprint

*Messaging keys, copy hooks, and section structure for the landing page.*
*Tone: confident, technical, direct. No fluff. Audience: senior engineers who use AI tools daily.*

---

## Hero Section

### Headline options (pick one, A/B test)

**A (problem-first):**
> Your AI starts every session with amnesia.
> AI Context OS gives it a memory worth trusting.

**B (solution-first):**
> Persistent, inspectable memory for every AI tool you use.
> Built on files. Owned by you.

**C (contrast-first):**
> Stop re-explaining your codebase every morning.

### Subheadline
> AI Context OS is a desktop app that manages your AI context as structured local files — scored, governed, and delivered to Claude, Cursor, Windsurf, and Codex through a single MCP server.

### Primary CTA
> **Download for Mac** (0.1.0 · free · open source)
> Also available for Windows and Linux

### Secondary CTA
> Read the paper ↗ · View on GitHub ↗

### Hero visual suggestion
Screenshot of the Simulation view: a query typed in, and a list of scored memories appearing with their score breakdown. Shows the "inspectable retrieval" property immediately.

---

## Problem Section

*3 pain points, each one a sentence that engineers will recognize immediately.*

### Pain 1 — The blank slate
> **Every conversation starts from scratch.**
> You've explained your error handling conventions a hundred times. Your AI hasn't retained any of it.

### Pain 2 — The bloated context file
> **CLAUDE.md grows until you stop trusting it.**
> No structure. No scoring. No way to know what the AI actually reads. A 2,000-word file injected wholesale into every query.

### Pain 3 — The tool silo
> **Your Claude context doesn't help Cursor.**
> Every tool has its own memory. You maintain three diverging copies of the same knowledge.

---

## Solution Pillars

*4 pillars. Each has a title, a one-sentence explanation, and a visual/demo suggestion.*

### Pillar 1 — Files you can read

**Title:** Your memory, in plain text.

**Copy:**
> Memories are markdown files with YAML frontmatter. You can open them, edit them, version them with git, and share them with your team. No database. No embeddings. No black box.

**Visual:** Side-by-side of a memory file (`.md` with frontmatter) and the corresponding memory card in the app.

---

### Pillar 2 — Context that earns its token budget

**Title:** Scored, tiered, and token-aware.

**Copy:**
> A 6-signal scoring engine (BM25 + semantic + graph + recency + importance + access frequency) ranks your memories by relevance to each query. A tiered content model (L0 / L1 / L2) loads the right level of detail within your token budget. No over-stuffing. No under-informing.

**Visual:** The Simulation view — showing a query, a ranked list of memories, token counts, and score breakdowns per signal.

---

### Pillar 3 — One workspace, every tool

**Title:** Connect once, works everywhere.

**Copy:**
> AI Context OS runs an MCP server that exposes your memory to Claude Code, Claude Desktop, Cursor, Windsurf, and Codex — simultaneously. A single ground truth. No duplication.

**Visual:** Connectors view showing the four tool tiles with their integration status.

---

### Pillar 4 — Memory you can govern

**Title:** Memory that doesn't rot.

**Copy:**
> A built-in governance layer surfaces stale memories (decay), contradictions (conflicts), redundancy (consolidation candidates), and temporary debris (scratch cleanup). A 0-100 health score keeps you honest about the state of your knowledge base.

**Visual:** Governance view with the four tabs (decay, conflicts, consolidation, scratch). Health badge in the top bar.

---

## How It Works (3-Step Flow)

*Simple, visual. Three steps, each with an icon and 2 sentences.*

### Step 1 — Build your workspace
> Create your first memories: who you are, your stack, your conventions, your architectural decisions. Drop external documents into `inbox/` and promote them to the right category.

### Step 2 — Connect your tools
> Point Claude Desktop, Cursor, or Claude Code at your MCP server. They call `get_context` with every query and receive the most relevant memories, scored and budgeted.

### Step 3 — Let it compound
> Every session adds knowledge. The scoring engine learns what you use. Governance surfaces what needs updating. Your AI gets smarter with your project over time.

---

## Differentiator Section

*One table or comparison block. Keep it factual, not smug.*

| | AI Context OS | RAG / vector DB | Manual CLAUDE.md |
|--|:--:|:--:|:--:|
| You can read the memory | ✓ | ✗ | ✓ |
| You can see what AI will retrieve | ✓ | ✗ | — |
| Works across Claude, Cursor, Codex | ✓ | ✗ | Partial |
| No database infrastructure | ✓ | ✗ | ✓ |
| Scales with project complexity | ✓ | ✓ | ✗ |
| Built-in governance & health | ✓ | ✗ | ✗ |

---

## Technical Credibility Section

*For engineers who want to know what's under the hood before downloading anything.*

**Stack:**
> Built with Tauri v2 (Rust backend, React frontend). The scoring engine is pure Rust — sub-10ms query times. MCP server runs as stdio (CLI) and HTTP/SSE (IDEs) simultaneously. Memory stored as local files — git-friendly, backup-friendly, editor-friendly.

**Open source:**
> MIT licensed. The full source is on GitHub. The file format is human-readable and documented. Your memory is yours.

**Privacy:**
> Nothing leaves your machine. No analytics, no telemetry, no cloud sync. The MCP server binds to `127.0.0.1` only.

---

## Closing CTA Section

### Headline
> Start with what you know. Files.

### Body
> AI Context OS is free, open source, and works with the AI tools you already use. Download the app, set up your workspace in 5 minutes, and stop re-explaining your codebase.

### Primary CTA
> **Download for Mac** — v0.1.0

### Secondary CTAs
> Read the academic paper · Read the technical whitepaper · View on GitHub · Follow @alexdc for updates

---

## Messaging Anti-Patterns to Avoid

- Don't say "AI-powered" — the app itself is not AI; it gives AI better context
- Don't say "revolutionary" or "next-generation" — engineers hate this
- Don't lead with features, lead with the pain
- Don't say "easy to use" — say what it specifically makes easier
- Don't make claims about token savings or productivity improvements without data

---

## SEO / Discoverability Hooks

Primary keywords: AI context management, persistent AI memory, MCP server, claude.md, AI engineering tools, LLM memory, context window management

Long-tail: "how to give Claude persistent memory", "CLAUDE.md alternatives", "AI coding assistant memory", "MCP server for AI context"

Hacker News headline options:
> "Show HN: AI Context OS – filesystem-native persistent memory for AI coding tools"
> "Show HN: I built an MCP server that gives Claude/Cursor/Windsurf persistent, inspectable memory"
