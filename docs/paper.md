# Files as Memory: A Filesystem-Native Architecture for Persistent AI Agent Context

**Alex DC** · MAFIA LABS
*April 2026*

---

## Abstract

Large language models exhibit a fundamental architectural limitation: they are stateless across sessions. Every conversation begins without memory of prior interactions, decisions, code written, or domain knowledge accumulated. The engineering community has converged on two dominant responses to this limitation — retrieval-augmented generation (RAG) with vector databases, and manually maintained context files — each carrying significant costs in transparency, portability, and cognitive overhead. This paper proposes a third approach: treating the local filesystem as the native substrate for AI agent memory, structured through a principled ontology of typed memory files, hierarchical content tiers, and a hybrid multi-signal scoring engine that selects and delivers context adaptively within token budgets. We describe the architecture of AI Context OS, a desktop application implementing this model, and argue that filesystem-native memory is not merely a pragmatic compromise but a theoretically superior primitive for human-AI collaborative work: it is inspectable, versionable, portable, composable, and simultaneously legible by both humans and machines. We discuss the governance problem (memory aging, conflict, consolidation), the MCP integration layer that exposes memory to any AI tool, and compare the approach against existing alternatives along dimensions of transparency, control, and scalability.

---

## 1. Introduction

The promise of AI-assisted software engineering rests on a fundamental assumption that turns out to be false in practice: that the AI has meaningful memory of the work being done. In reality, every session with a large language model begins from a blank slate. The developer must re-explain the project architecture, re-establish conventions, re-describe the problem domain, and re-provide the context that was so painstakingly established in the previous session. This is not a minor inconvenience. For engineers working on complex, long-running projects, the overhead of context re-establishment can consume a substantial fraction of the productive session.

The problem is structural. Transformer-based language models process a fixed-length context window and produce a response; the context window is not preserved between sessions in any meaningful sense. Conversation history can be stored and re-injected, but this approach degrades rapidly: injecting full conversation history consumes the context window, dilutes signal with noise, and fails to distinguish durable knowledge from ephemeral discussion.

The engineering community has developed coping mechanisms. The most technically sophisticated is retrieval-augmented generation: maintaining a vector database of embeddings and retrieving semantically relevant chunks at query time. This is powerful but comes with severe costs: the memory is opaque (the engineer cannot directly inspect what the AI will retrieve), the infrastructure is heavyweight (requiring a vector database, embedding model, and retrieval pipeline), and the system is fragile to semantic drift (embeddings trained at one point in time may not faithfully serve queries in a different framing).

The most common practical approach is simpler and more honest: engineers maintain a manually written context file — a `CLAUDE.md`, a `AGENTS.md`, or a `.cursorrules` — that they update by hand. This is transparent and portable but does not scale. As projects grow, these files become unwieldy. There is no structure for distinguishing stable architectural decisions from volatile task state. There is no mechanism for decay (old information aging out), no governance for conflicts, no awareness of what the AI actually reads.

This paper describes a third approach, instantiated in AI Context OS: treating the local filesystem as the primary substrate for AI agent memory, structured through a typed ontology, a tiered content model, and a multi-signal scoring engine. The central thesis is that **the file, not the vector, is the optimal primitive for human-AI collaborative memory** — not because it is technically superior in every dimension, but because it is the primitive that best serves the entire system, including the human engineer who must understand, curate, and trust the memory.

We make the following contributions:

1. A theoretical argument for filesystem-native memory as the superior primitive for AI agent context management in human-AI collaborative settings.
2. A concrete architecture — the AI Context OS workspace model — implementing this thesis, including ontology design, tiered loading, hybrid scoring, governance, and multi-tool delivery.
3. A comparative analysis against RAG, conversation history, and manual context files.
4. A discussion of current limitations and directions for future work.

---

## 2. Background and Related Work

### 2.1 The Statefulness Problem in LLMs

The statefulness problem in large language models is well understood at the systems level but its practical consequences for software engineering workflows are underappreciated in the research literature. A language model, at inference time, processes a sequence of tokens and produces a probability distribution over the next token. The model itself carries no state between calls; all relevant information must be present in the context window at the time of the call.

This architectural property has driven two lines of work: (1) long-context models, which extend the number of tokens processable in a single call, and (2) external memory systems, which augment the model with persistent storage. Long-context models are relevant but insufficient — even models with million-token context windows face the practical constraint that injecting a million tokens is expensive, slow, and produces diminishing returns due to the well-documented "lost in the middle" phenomenon (Liu et al., 2023), where models attend poorly to information in the middle of very long contexts.

External memory systems are therefore the more tractable direction for persistent memory, and they have received substantial research attention.

### 2.2 Retrieval-Augmented Generation and Its Limitations for Persistent Memory

Retrieval-augmented generation (Lewis et al., 2020) was proposed as a mechanism for grounding language model responses in retrieved documents, addressing hallucination and enabling knowledge updates without retraining. The standard architecture involves an embedding model that converts text chunks to dense vectors, a vector database storing these embeddings, and a retrieval step that queries the database with the user's input and injects the top-k retrieved chunks into the context window.

RAG has proven highly effective for question-answering over large document corpora. Its application to persistent AI agent memory, however, reveals several structural problems:

**Opacity.** The engineer cannot directly observe what the model will retrieve for a given query. The retrieval is mediated by an embedding model that operates in a high-dimensional space that is not human-interpretable. This makes debugging and curation difficult: if the model retrieves the wrong memory, the engineer cannot easily understand why, nor can they reliably predict what will be retrieved for future queries.

**Semantic brittleness.** Embedding-based similarity is sensitive to the framing of queries. The same conceptual content expressed differently may retrieve very different results. For AI agents operating across varied task types (debugging, feature development, architecture discussion), this variability introduces unreliability precisely where reliability is most needed.

**Infrastructure overhead.** A complete RAG system requires an embedding model (either a local model or an API call), a vector database (Pinecone, Weaviate, Chroma, pgvector, or similar), and a retrieval pipeline. For an individual engineer or a small team, this infrastructure represents substantial setup and maintenance overhead.

**No human-readable memory.** The memory stored in a vector database is not directly readable by the engineer. If the engineer wants to review, edit, or delete a memory, they must do so through an interface that mediates access to an opaque embedding space. This breaks the intuitive property that memory should be something the engineer can directly inspect and control.

**Weak governance primitives.** Vector databases typically do not have built-in mechanisms for memory decay, conflict detection, or structured importance metadata. Adding these requires building on top of the raw storage layer.

### 2.3 Conversation History as Memory

The most commonly used memory approach in practice is the simplest: storing conversation history and re-injecting it into the context window for subsequent sessions. This approach is transparent — the engineer can read the history — but fails to scale along two axes.

First, conversation history is dense with noise. A typical engineering conversation includes exploratory dead ends, erroneous hypotheses, abandoned approaches, and verbose explanations that were useful once but add no value on re-reading. Injecting full history consumes tokens with low-value content.

Second, conversation history does not distinguish types of information by durability. A decision about the project architecture that should persist for months appears in the same format as a transient debugging hypothesis that is irrelevant after the session. There is no mechanism for the system to know which information should be retained long-term and which should expire.

Third, conversation history is tool-specific. The history stored in Claude Desktop is not available in Cursor, and vice versa. As engineers use multiple AI tools in their workflow — which is increasingly the norm — conversation-history memory creates isolated silos that cannot be shared across the toolchain.

### 2.4 Manual Context Files

The practical solution adopted by most engineers using AI tools seriously is the manual context file: a markdown file (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`) that the engineer maintains by hand, placed in the project root where the AI tool will read it automatically.

This approach has genuine virtues: it is transparent (the engineer reads exactly what the AI reads), portable (the file travels with the project), and human-editable (the engineer can add, remove, and revise memories directly). It is, in many ways, the honest acknowledgment that the engineer is the memory system.

But it does not scale. As projects grow in complexity, the context file grows to become a sprawling document that is difficult to navigate and maintain. There is no structure for distinguishing different types of information: architectural decisions, coding conventions, project history, task state, and debugging notes all appear as undifferentiated prose. There is no mechanism for information to age out as it becomes stale. There is no tooling for detecting contradictions. There is no way to simulate what context the AI will actually use for a given task.

Perhaps most fundamentally, the manual context file is entirely passive: it does not participate in the AI's operation; it is simply injected at the top of every conversation regardless of relevance. For a small project, this is acceptable. For a mature project with months of accumulated knowledge, injecting the entire context file for every query — including information that is irrelevant to the current task — is wasteful and potentially counterproductive.

### 2.5 Note-Taking Systems as Knowledge Primitives

A parallel tradition in personal knowledge management — instantiated in tools like Obsidian, Logseq, and Roam Research, and theorized in the Zettelkasten method (Luhmann, 1981) — treats individual linked notes as the fundamental unit of knowledge. These systems share with our approach the intuition that granular, linked, typed notes are a superior substrate for knowledge management compared to monolithic documents.

However, note-taking systems are designed for human knowledge management, not for AI agent consumption. They lack the structured metadata (importance scores, decay parameters, access frequency tracking) that an AI system needs to make informed decisions about what to load and at what level of detail. They do not expose their content through machine-readable APIs suitable for AI tool integration. They have no concept of token budgets or tiered loading. And they are not designed to serve as the memory substrate for an autonomous agent executing tasks.

AI Context OS inherits the insight of note-taking systems — that granular, typed, linked notes are the right primitive — and extends it with the infrastructure needed to make that primitive useful for AI agents.

---

## 3. The Core Thesis: Files as the Optimal Primitive for AI Agent Memory

Before describing the architecture, we articulate the theoretical argument for filesystem-native memory.

### 3.1 What a Memory Primitive Must Support

A memory primitive for AI agent context management must support, at minimum, the following operations:

- **Write**: an agent or engineer can record a memory
- **Read**: an agent can retrieve a memory
- **Update**: a memory can be revised as understanding evolves
- **Delete**: a memory can be removed when obsolete
- **Query**: relevant memories can be identified given a task description
- **Budget**: memories can be selected to fit within a token limit
- **Inspect**: a human can directly read and understand the memory
- **Curate**: a human can add, remove, and edit memories directly

Additionally, for robust operation in a real engineering environment, a memory system should support:

- **Governance**: detecting and resolving conflicts, aging out stale memories
- **Portability**: the memory travels with the project, not with a cloud service
- **Composability**: the memory can be read by multiple AI tools without duplication
- **Versionability**: changes to memory can be tracked over time

### 3.2 Why Files Excel on These Dimensions

The local file — specifically, a structured plain-text file with machine-readable metadata — satisfies all of the above requirements in a way that is deeply compatible with the engineering workflow.

**Transparency is absolute.** A file is something the engineer already knows how to read, edit, and reason about. There is no abstraction layer between the memory and the engineer's understanding of it. When the engineer asks "what does the AI know about this project?", they can answer the question by reading files — something they can do without specialized tooling.

**Portability is free.** Files live in the filesystem. They travel with `git clone`. They sync with Dropbox. They backup with Time Machine. No infrastructure is required to move them, and they are not dependent on any external service.

**Versionability is free.** Files are the native substrate of version control. Every change to a memory file is trackable, diffable, and revertable. The history of the memory is the git history of the file.

**Composability is natural.** A single file can be read by Claude Desktop, Claude Code, Cursor, Windsurf, and any other AI tool — simultaneously, without duplication. The file is the single source of truth; different tools get different views of the same ground truth.

**Inspectability enables trust.** Perhaps most importantly, filesystem-native memory allows the engineer to develop an accurate mental model of what the AI knows. This is not a minor convenience — it is foundational to the human-AI collaborative relationship. An engineer who trusts their AI tool is one who understands what it knows and does not know. An opaque memory system undermines this trust.

### 3.3 The Missing Layer: Structure

The limitation of raw files as memory is the absence of structure. A directory full of markdown files is not a memory system; it is a documentation dump. What transforms files into a memory system is:

1. **A typed ontology** that distinguishes different categories of memory by their semantic role and durability characteristics
2. **Structured metadata** embedded in each file that the system can use for scoring and governance
3. **A tiered content model** that allows files to expose different amounts of detail depending on the token budget
4. **A scoring engine** that can rank files by relevance to a given task
5. **A governance layer** that detects conflicts, manages decay, and suggests consolidation
6. **A delivery layer** that formats and positions selected memories for optimal AI attention

AI Context OS provides all of these layers on top of the file primitive.

---

## 4. Architecture of AI Context OS

### 4.1 The Workspace as a Structured Filesystem

The AI Context OS workspace is a directory on the local filesystem, typically located at `~/AI-Context-OS/`. Its structure is defined by a fixed ontology of typed subdirectories:

```
~/AI-Context-OS/
├── inbox/          ← temporary capture zone (staging)
├── sources/        ← accepted sources (protected, read-only by default)
├── 01-context/     ← static user/project information
├── 02-daily/       ← daily logs and journal (Logseq-style outliner)
├── 03-projects/    ← project-specific memories
├── 04-skills/      ← reusable procedures and how-tos
├── 05-resources/   ← reference materials
├── 06-decisions/   ← architectural and design decisions
├── 07-tasks/       ← task tracking
├── 08-rules/       ← behavioral rules for AI agents
├── 09-scratch/     ← temporary workspace (TTL-based expiry)
├── claude.md       ← master router (auto-generated)
├── _index.yaml     ← auto-generated L0 catalog
└── _config.yaml    ← workspace configuration
```

The numbering of directories is significant: it encodes a default priority order that the delivery layer uses for attention positioning. Rules (08) always appear first in the generated context; scratch (09) is deprioritized.

The `inbox/` directory serves as a capture staging area. External files, web content, or documents can be dropped here for human review before being promoted to a permanent location in the typed hierarchy. The `sources/` directory stores accepted reference materials that are protected from accidental modification.

### 4.2 YAML Frontmatter as the Metadata Layer

Each memory file is a markdown document with a YAML frontmatter header that carries the structured metadata the system needs for scoring and governance:

```yaml
---
id: memory-identifier
type: skill          # context | daily | project | skill | resource | decision | task | rule | scratch
l0: "One-line summary of this memory"
importance: 0.8      # 0.0-1.0, set by the engineer
tags: [rust, architecture, performance]
related: [other-memory-id, another-memory-id]
created: 2026-03-01
modified: 2026-04-08
version: 3
always_load: false   # if true, always included regardless of query
protected: false     # if true, requires explicit unlock to edit
---
```

The `type` field encodes the memory's position in the ontology, which determines its default scoring profile, its decay characteristics, and its rendering in the router. The `importance` field is set by the engineer and carries their assessment of the memory's centrality — high-importance memories are loaded even when less directly relevant. The `l0` field contains the one-line summary that is always available without loading the full file. The `related` field enables graph-based connectivity scoring.

### 4.3 The L0/L1/L2 Tiered Content Model

The most distinctive structural element of the AI Context OS file format is the tiered content model. Each memory file can contain up to three tiers of content, separated by special markers:

```markdown
---
[frontmatter]
---

L0 content is in the frontmatter (the `l0` field) — always available.

<!-- L1 -->
A paragraph-length summary of the memory. Suitable for giving the AI
awareness of this memory's content without loading the full detail.
This is what gets loaded when the token budget is tight.

<!-- L2 -->
The complete, detailed content of the memory. Loaded only when the
scoring engine determines this memory is highly relevant and the
token budget permits full loading.
```

This tiered model is the solution to the token budget problem. For a complex project with hundreds of memories, loading the full content of every memory would be prohibitively expensive. The L0 tier (a single line) gives the AI a catalog-level awareness of all memories without loading any content. The L1 tier gives paragraph-level awareness for promising memories. The L2 tier provides full detail for the most relevant memories.

The scoring engine determines which tier to load for each memory based on the memory's relevance score and the remaining token budget, as described in the next section.

### 4.4 The Scoring Engine: Hybrid Multi-Signal Ranking

The core algorithmic contribution of AI Context OS is the hybrid multi-signal scoring engine that ranks memories by relevance to a given query. Six signals are combined into a composite score:

**Semantic score (S_sem)**: A heuristic approximation of semantic similarity based on keyword matching and phrase overlap between the query and the memory content. In the current implementation, this uses a keyword-expansion approach rather than embedding-based similarity; the roadmap includes integration of local embedding models (rust-bert or similar) for true semantic similarity.

**BM25 score (S_bm25)**: A classical information retrieval signal based on term frequency and inverse document frequency. BM25 is well-suited for precise term matching and performs reliably across diverse query types. Document frequencies are computed across the full memory corpus.

**Graph score (S_graph)**: A connectivity signal derived from the explicit `related` links between memories. A memory that is linked to from many other highly-scored memories receives a higher graph score. This is a simplified variant of PageRank-style authority scoring applied to the memory graph.

**Recency score (S_rec)**: A temporal signal based on the `modified` timestamp of the memory, decayed exponentially with a half-life tuned to the expected pace of knowledge evolution in software projects.

**Importance score (S_imp)**: The engineer-assigned importance weight, passed through directly. This allows the engineer to override algorithmic signals for memories they know to be central.

**Access frequency score (S_freq)**: A signal derived from the observability database, tracking how often each memory has been loaded in recent context queries. High access frequency is a proxy for relevance.

These six signals are combined with weights that vary by detected intent:

```
S_composite = w_sem·S_sem + w_bm25·S_bm25 + w_graph·S_graph
            + w_rec·S_rec + w_imp·S_imp + w_freq·S_freq
```

The weight vector is not fixed; it is modulated by the intent detection system described in the next section.

### 4.5 Intent-Adaptive Weight Profiles

A key insight in the scoring design is that the relative importance of different signals depends on the nature of the task being performed. A debugging query ("why is this crashing") benefits from precise term matching (BM25) and graph connectivity (finding related error-handling code). A brainstorming query ("what should we build next") benefits more from importance weighting and recency (surfacing the most relevant recent strategic context). A recall query ("what was the decision about X") benefits from semantic similarity and recency.

AI Context OS detects intent from the query text and applies a corresponding weight profile:

| Signal | Debug | Brainstorm | Default |
|--------|-------|------------|---------|
| Semantic | 0.20 | 0.30 | 0.30 |
| BM25 | 0.30 | 0.05 | 0.15 |
| Graph | 0.30 | 0.05 | 0.10 |
| Recency | 0.10 | 0.25 | 0.15 |
| Importance | 0.05 | 0.30 | 0.20 |
| Access freq | 0.05 | 0.05 | 0.10 |

The current intent detection is lexical (keyword-based triggers). Future work will integrate classifier-based intent detection for more nuanced profiling.

Additionally, the query undergoes expansion before scoring: a set of synonym mappings enriches the query with related terms, improving lexical recall. "Bug" expands to "bug error fix exception failure"; "deploy" expands to "deploy release publish CI CD"; etc.

### 4.6 Community Detection and the Graph Proximity Signal

A key limitation of pure explicit-link graph scoring is that it only activates when the engineer has manually added `related` fields between memories. In practice, engineers often maintain consistent tagging discipline but inconsistently write cross-references. A memory about Rust error handling may share three tags with a memory about API design without the engineer having linked them.

AI Context OS addresses this through a community detection pass (using algorithms like Leiden or advanced Label Propagation) that runs over an enriched graph. This graph includes both explicit links (the `related`, `requires`, and `optional` frontmatter fields) and implicit edges derived from tag co-occurrence: two memories sharing two or more tags are connected by an implicit edge.

Unlike traditional K-means clustering—which requires specifying the number of clusters over abstract spatial vectors—graph-native algorithms like Leiden detect communities naturally based on edge density and modularity optimization. This partitions the graph into topical communities of varying sizes, structurally grouping memories that are semantically related.

The community membership is used in two ways. First, the graph proximity signal includes a community bonus: if a memory belongs to the same topical community as any of the top-scored memories for a given query, it receives a +0.08 boost to its graph proximity score. This surfaces memories that belong to the same knowledge cluster as highly relevant memories, even without an explicit link. Second, community assignments are transmitted to the visualization layer and can be used to color nodes by cluster rather than by memory type, making the topical structure of the knowledge base visually apparent based on true structural connectivity.

These community detection algorithms run efficiently in Rust (leveraging libraries like `petgraph` or `leiden-rs`) as background maintenance jobs, updating the cluster map of the workspace gracefully.

### 4.7 The Router: Attention-Positioned Context Delivery

The output of the scoring engine is a ranked, token-budgeted selection of memories at appropriate tiers. This selection must be formatted for delivery to the AI tool. The router layer handles this formatting.

The design of the router is informed by the "lost in the middle" phenomenon (Liu et al., 2023): language models attend most reliably to content at the beginning and end of their context window. The router exploits this by using a principled attention positioning strategy:

1. **Rules** appear first — these are the behavioral constraints the AI should always follow
2. **L0 index** appears last — giving the AI a full catalog of available memories it can request

The router generates a neutral intermediate representation (`claude.md`, `_index.yaml`) that is then adapted by tool-specific adapters:

- **Claude Desktop / Claude Code**: `claude.md` with MCP stdio configuration
- **Cursor**: `.cursorrules` with MCP HTTP configuration
- **Windsurf**: `.windsurfrules` with MCP HTTP configuration
- **Codex / ChatGPT**: stdio or manual handoff

This adapter-first architecture means that adding support for a new AI tool requires only a new adapter function, without touching the core router logic.

### 4.8 MCP as the Agent Interface Layer

The Model Context Protocol (MCP) is an open standard for exposing tools and resources to AI agents. AI Context OS implements an MCP server that exposes four tools to connected AI agents:

- **`get_context`**: Execute a context query against the workspace, returning a token-budgeted selection of relevant memories. This is the primary tool for on-demand context retrieval.
- **`save_memory`**: Write a new memory file to the workspace, with appropriate frontmatter, from within an AI session.
- **`get_skill`**: Retrieve a specific skill (reusable procedure) from the workspace.
- **`log_session`**: Append a session event to the daily log.

The MCP server runs in two transport modes simultaneously:
- **stdio**: For local CLI-based tools (Claude Code, Codex CLI) — the tool spawns the server as a subprocess.
- **HTTP/SSE**: For tools that prefer network-based MCP (Cursor, Windsurf) — the server listens on `127.0.0.1:3847`.

The shared engine that powers both the Tauri `simulate_context` command and the MCP `get_context` tool is `execute_context_query()` — a single Rust function that ensures the simulation view and the actual MCP responses are always consistent.

---

## 5. Memory Governance

### 5.1 The Memory Aging Problem

Memory systems face a problem that human memory solves imperfectly and AI memory systems often ignore entirely: memories age. A decision recorded in the project context six months ago may have been superseded, partially modified, or rendered irrelevant by subsequent development. A task recorded in the task list may have been completed without the task file being updated. A skill recorded as the canonical approach to a problem may have been replaced by a better approach.

If a memory system does not address aging, it accumulates stale information that degrades the quality of context delivered to the AI. The AI receives outdated information with no indication that it is outdated, potentially leading to incorrect responses or subtly wrong suggestions.

### 5.2 The Governance System

AI Context OS implements a governance layer that monitors the memory corpus and flags candidates for human review:

**Decay candidates**: Memories whose `modified` timestamp is older than a configurable threshold (default: 90 days) and whose access frequency is low. These are presented to the engineer for review — they may be updated, archived, or deleted.

**Conflict detection**: Memories that contain contradictory information, detected through a combination of tag overlap and semantic similarity. Two memories with high semantic similarity but marked as different types, or with high token overlap and different importance scores, are flagged as potential conflicts.

**Consolidation suggestions**: Clusters of memories with high topical overlap that might be merged into a single, more comprehensive memory. This addresses the accumulation of redundant information across multiple files.

**God nodes**: A structural analysis of the memory graph identifies nodes with high degree centrality — memories that many other memories link to. These are compared against the engineer-assigned importance score. A memory with high degree centrality but low importance score represents a calibration mismatch: the graph structure indicates the memory is central to the knowledge base, but the engineer has not recognized this in their explicit importance assignment. These candidates are surfaced in the governance view for importance recalibration, helping the scoring engine better reflect structural reality.

**Scratch TTL**: The `09-scratch/` directory is a temporary workspace for volatile content (large tool outputs, exploratory notes, intermediate computations). Files here automatically become candidates for cleanup after a configurable TTL, preventing the accumulation of debris.

### 5.3 The Health Score

The health of the memory corpus is quantified by a composite health score (0-100) computed from five components:

**Coverage (25%)**: The fraction of memories that have been accessed in recent context queries (14-day window). Low coverage indicates that much of the memory is not being used — potentially stale or irrelevant.

**Efficiency (25%)**: The ratio of tokens used to tokens budgeted, averaged over recent queries. Ideal efficiency is 50-80%: the system is using the budget effectively without over-stuffing the context.

**Freshness (20%)**: The fraction of memories with recent modification timestamps. A corpus where most memories are old is likely accumulating stale information.

**Balance (15%)**: The distribution of memories across the type ontology. A well-balanced corpus has representation across all memory types; an imbalanced corpus may indicate structural gaps in the knowledge.

**Cleanliness (15%)**: The fraction of memories that are not governance candidates (no conflict, not decayed, not scratch-overdue). High cleanliness indicates a well-maintained corpus.

The health score is displayed as a persistent badge in the application interface, giving the engineer immediate visibility into the state of their memory system.

---

## 6. Evaluation and Discussion

### 6.1 Comparative Analysis

We compare AI Context OS against the three alternatives discussed in Section 2 along the dimensions established in Section 3.1.

| Dimension | AI Context OS | RAG/Vector | Conversation History | Manual Context File |
|-----------|:---:|:---:|:---:|:---:|
| Human-readable | ✓ | ✗ | ✓ | ✓ |
| Inspectable retrieval | ✓ | ✗ | N/A | N/A |
| Token budget control | ✓ | Partial | ✗ | ✗ |
| Multi-tool portable | ✓ | ✗ | ✗ | Partial |
| Git-versionable | ✓ | ✗ | ✗ | ✓ |
| Memory governance | ✓ | ✗ | ✗ | ✗ |
| Zero infrastructure | ✓ | ✗ | ✓ | ✓ |
| Agent-writable memory | ✓ | ✓ | ✓ | ✗ |
| Typed ontology | ✓ | Partial | ✗ | ✗ |
| Scales with project size | ✓ | ✓ | ✗ | ✗ |

The most significant differentiators are inspectable retrieval and zero infrastructure. RAG systems are powerful but opaque and heavyweight. Conversation history is transparent but fails to scale and is tool-specific. Manual context files are transparent and portable but do not scale and have no dynamic retrieval. AI Context OS combines the transparency of manual files with dynamic, scored retrieval and multi-tool portability.

### 6.2 The Transparency Advantage

We argue that inspectable retrieval — the ability for the engineer to directly observe and predict what the AI will retrieve for a given query — is not merely a quality-of-life feature but a foundational requirement for trust in human-AI collaborative systems.

The simulation view in AI Context OS makes this concrete. Before running a task with an AI agent, the engineer can type the query they intend to give the agent and observe exactly which memories will be loaded, at which tier, with what score breakdown. If the simulation reveals that an important memory is not being retrieved, the engineer can adjust the memory's importance score, update its content, or add relevant tags. The memory system is fully transparent to the engineer who must rely on it.

This stands in stark contrast to RAG-based memory, where the engineer cannot reliably predict what will be retrieved. They may know that a particular embedding model tends to retrieve semantically similar content, but they cannot observe the actual retrieval without running the full pipeline. This opacity creates a fundamental asymmetry: the AI has access to memories the engineer does not know it has, and may fail to retrieve memories the engineer believes are relevant.

### 6.3 Current Limitations

**Semantic scoring is heuristic.** The current implementation approximates semantic similarity through keyword matching and query expansion. True embedding-based semantic similarity would improve retrieval quality, particularly for queries that do not share lexical overlap with the relevant memories. The architecture is designed to accommodate a local embedding model (rust-bert or similar) as a drop-in replacement for the current heuristic.

**Scale limits are untested.** The current implementation has been designed and tested for workspaces with hundreds of memories. Workspaces with tens of thousands of memories would require index-level optimizations to maintain acceptable query latency.

**Single-workspace model.** The current implementation supports a single workspace per installation. Multi-workspace support (e.g., one workspace per project, or per client) is on the roadmap but not yet implemented.

**MCP executable path issue.** The current implementation of `get_mcp_connection_info` returns the Tauri application binary path, which points to the GUI application. The actual MCP server binary is `ai-context-cli`. This means the auto-generated MCP configuration snippets require manual correction before use.

**No conflict auto-resolution.** The governance layer detects conflicts but does not attempt to resolve them. Resolution requires human judgment. Future work could explore LLM-assisted conflict resolution, using the AI to propose a merged version of conflicting memories.

### 6.4 Future Work

Several directions for future work are apparent from the current implementation:

**Real semantic embeddings.** Replacing the keyword-based semantic heuristic with a local embedding model (e.g., `all-MiniLM-L6-v2` via rust-bert) would substantially improve recall for semantically related queries.

**Agent-initiated governance.** Currently, governance is human-initiated. An AI agent could be given tools to flag stale memories, propose consolidations, and suggest new memories based on the content of sessions — making the memory system self-maintaining.

**Agents marketplace.** A library of specialized agent templates — each pre-configured with an appropriate memory ontology, scoring profile, and skill set — would allow engineers to quickly bootstrap memory systems for common engineering roles (senior engineer, debugging specialist, architecture advisor).

**Multi-workspace federation.** Allowing multiple workspaces to share certain memory categories (e.g., global skills shared across all projects) would enable more sophisticated knowledge management for engineers working across multiple projects.

**Import from existing systems.** Migrators from Obsidian vaults, Logseq databases, and other note-taking systems would lower the barrier to adoption for engineers who already maintain structured notes.

---

## 7. Conclusion

We have argued that the local file is the optimal primitive for AI agent memory in human-AI collaborative software engineering. The argument rests not on technical superiority in every dimension — vector databases are more scalable, conversation history is simpler — but on the holistic requirements of the system, including the human engineer who must understand, trust, and maintain the memory.

The AI Context OS architecture demonstrates that filesystem-native memory, structured through a typed ontology, tiered content model, and hybrid scoring engine, can support dynamic, query-adaptive, token-budgeted context delivery without sacrificing the transparency and portability that make files the natural substrate for engineering knowledge.

The memory system that best serves the human-AI pair is not the most technically sophisticated one. It is the one that both members of the pair can understand and rely on. Files, structured thoughtfully, are that system.

---

## References

Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., Küttler, H., Lewis, M., Yih, W.-t., Rocktäschel, T., Riedel, S., & Kiela, D. (2020). Retrieval-augmented generation for knowledge-intensive NLP tasks. *Advances in Neural Information Processing Systems*, 33, 9459–9474.

Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., & Liang, P. (2023). Lost in the middle: How language models use long contexts. *Transactions of the Association for Computational Linguistics*, 12, 157–173.

Luhmann, N. (1981). Kommunikation mit Zettelkästen. In H. Baier, H. M. Kepplinger, & K. Reumann (Eds.), *Öffentliche Meinung und sozialer Wandel*. Westdeutscher Verlag.

Robertson, S., & Zaragoza, H. (2009). The probabilistic relevance framework: BM25 and beyond. *Foundations and Trends in Information Retrieval*, 3(4), 333–389.

Anthropic. (2024). Model Context Protocol specification. https://modelcontextprotocol.io

Page, L., Brin, S., Motwani, R., & Winograd, T. (1999). The PageRank citation ranking: Bringing order to the web. *Stanford InfoLab Technical Report*.

Matuschak, A. (2020). *Evergreen notes*. https://notes.andymatuschak.org/Evergreen_notes

Ahrens, S. (2017). *How to Take Smart Notes: One Simple Technique to Boost Writing, Learning and Thinking*. CreateSpace.
