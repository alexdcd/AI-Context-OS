# Inbox, Sources & Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-stage ingestion pipeline (00-inbox → 01-sources) with folder renumbering, new metadata fields (protected, status, derived_from), UI protection controls, and an LLM-driven ingestion protocol.

**Architecture:** Renumber all workspace folders (+1 offset, insert 01-sources). Add `MemoryStatus` enum and three new fields to `MemoryMeta`. Update explorer with custom icons, lock indicators, and status badges. Add `_INGEST.md` as onboarding artifact and router ingestion rule.

**Tech Stack:** Rust (Tauri v2 backend), React + TypeScript (frontend), TipTap (editor), Lucide icons, CSS variables

---

## File Map

### Rust files to modify

| File | Responsibility |
|------|---------------|
| `src-tauri/src/core/types.rs` | Add `Source` variant, `MemoryStatus` enum, new fields on `MemoryMeta` |
| `src-tauri/src/core/index.rs` | Update scanned folder list to include `01-sources` and new numbers |
| `src-tauri/src/core/router.rs` | Update folder structure text, folder references, add ingestion rule, add `Source` to index |
| `src-tauri/src/core/governance.rs` | Update folder references (`04-projects` → `05-projects`, etc.) |
| `src-tauri/src/core/journal.rs` | Update `02-daily` → `03-daily` |
| `src-tauri/src/core/tasks.rs` | Update `07-tasks` → `08-tasks` |
| `src-tauri/src/core/mcp.rs` | Update `02-daily` → `03-daily` session log path |
| `src-tauri/src/commands/config.rs` | Update `create_workspace_structure` dirs array and all hardcoded paths |
| `src-tauri/src/commands/onboarding.rs` | Update folder refs, create `_INGEST.md`, update `is_onboarded` check |
| `src-tauri/src/commands/daily.rs` | Update `02-daily` → `03-daily` |
| `src-tauri/src/commands/journal.rs` | Update `02-daily` → `03-daily` |
| `src-tauri/src/commands/governance.rs` | Update `09-scratch` → `10-scratch` |
| `src-tauri/src/cli.rs` | Update dirs array in `Init` command |

### TypeScript files to modify

| File | Responsibility |
|------|---------------|
| `src/lib/types.ts` | Add `"source"` to `MemoryType`, add `MemoryStatus`, new fields on `MemoryMeta`, new color/label entries |
| `src/components/explorer/FileExplorer.tsx` | Update `folderToType` map, `INBOX_FOLDER_NAME`, add sources folder constant, custom icons, lock indicator, status badge |
| `src/components/editor/MemoryEditor.tsx` | Respect `protected` flag: readonly mode, disable delete button |
| `src/components/editor/TipTapEditor.tsx` | Accept `editable` prop to support readonly |
| `src/components/editor/FrontmatterForm.tsx` | Add "Protect" toggle, `derived_from` chip editor, `status` display |
| `src/components/onboarding/OnboardingWizard.tsx` | Update folder listing text |
| `src/views/ConnectorsView.tsx` | Update `09-scratch` → `10-scratch` reference |

---

## Task 1: Renumber folders in Rust types

**Files:**
- Modify: `src-tauri/src/core/types.rs:4-47` (MemoryType enum, folder_name, from_folder)
- Modify: `src-tauri/src/core/types.rs:58-67` (default_ontology_for_memory_type)

- [ ] **Step 1: Add `Source` variant and update `folder_name()`**

In `src-tauri/src/core/types.rs`, add `Source` to the enum and update the match:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MemoryType {
    Source,
    Context,
    Daily,
    Intelligence,
    Project,
    Resource,
    Skill,
    Task,
    Rule,
    Scratch,
}

impl MemoryType {
    pub fn folder_name(&self) -> &str {
        match self {
            MemoryType::Source => "01-sources",
            MemoryType::Context => "02-context",
            MemoryType::Daily => "03-daily",
            MemoryType::Intelligence => "04-intelligence",
            MemoryType::Project => "05-projects",
            MemoryType::Resource => "06-resources",
            MemoryType::Skill => "07-skills",
            MemoryType::Task => "08-tasks",
            MemoryType::Rule => "09-rules",
            MemoryType::Scratch => "10-scratch",
        }
    }

    pub fn from_folder(folder: &str) -> Option<Self> {
        match folder {
            "01-sources" => Some(MemoryType::Source),
            "02-context" => Some(MemoryType::Context),
            "03-daily" => Some(MemoryType::Daily),
            "04-intelligence" => Some(MemoryType::Intelligence),
            "05-projects" => Some(MemoryType::Project),
            "06-resources" => Some(MemoryType::Resource),
            "07-skills" => Some(MemoryType::Skill),
            "08-tasks" => Some(MemoryType::Task),
            "09-rules" => Some(MemoryType::Rule),
            "10-scratch" => Some(MemoryType::Scratch),
            _ => None,
        }
    }
}
```

- [ ] **Step 2: Update `default_ontology_for_memory_type`**

```rust
pub fn default_ontology_for_memory_type(memory_type: &MemoryType) -> MemoryOntology {
    match memory_type {
        MemoryType::Source | MemoryType::Resource => MemoryOntology::Source,
        MemoryType::Project | MemoryType::Context | MemoryType::Task => MemoryOntology::Entity,
        MemoryType::Skill | MemoryType::Rule => MemoryOntology::Concept,
        MemoryType::Daily | MemoryType::Intelligence | MemoryType::Scratch => {
            MemoryOntology::Synthesis
        }
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`

Expected: Compilation errors in other files referencing old folder names (this is expected — we fix them next).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/core/types.rs
git commit -m "refactor: add Source variant to MemoryType and renumber folders"
```

---

## Task 2: Add new metadata fields to Rust types

**Files:**
- Modify: `src-tauri/src/core/types.rs:49-108` (MemoryStatus enum, MemoryMeta struct)
- Modify: `src-tauri/src/core/mcp.rs:216-236` (MemoryMeta constructor — add new fields)
- Modify: `src-tauri/src/commands/memory.rs:331-351` (MemoryMeta constructor in rename — add new fields)
- Modify: `src-tauri/src/commands/memory.rs:461-481` (MemoryMeta constructor in create — add new fields)
- Modify: `src-tauri/src/commands/onboarding.rs:103-123,169-189` (MemoryMeta constructors — add new fields)

- [ ] **Step 1: Add `MemoryStatus` enum after `MemoryOntology`**

Add this right after the `MemoryOntology` enum (after line 56):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MemoryStatus {
    Unprocessed,
    Processed,
}
```

- [ ] **Step 2: Add three new fields to `MemoryMeta`**

Add these fields at the end of the struct, before the closing brace:

```rust
    #[serde(default)]
    pub ontology: Option<MemoryOntology>,
    #[serde(default)]
    pub status: Option<MemoryStatus>,
    #[serde(default)]
    pub protected: bool,
    #[serde(default)]
    pub derived_from: Vec<String>,
```

Note: `ontology` already exists — just add `status`, `protected`, and `derived_from` after it.

- [ ] **Step 3: Add new fields to ALL MemoryMeta constructors**

Every place that constructs `MemoryMeta { ... }` with struct literal syntax needs the 3 new fields. Serde defaults only apply to deserialization, not to Rust struct literals. Add these three lines to each constructor:

```rust
            status: None,
            protected: false,
            derived_from: vec![],
```

**Locations (5 constructors):**

1. `src-tauri/src/core/mcp.rs:216-236` — In the `create_memory` MCP tool, after `ontology: Some(ontology),` add the 3 fields.

2. `src-tauri/src/commands/memory.rs:461-481` — In the `create_memory` command, after `ontology: Some(ontology),` add the 3 fields.

3. `src-tauri/src/commands/memory.rs:331-351` — In the rename/copy constructor, after `ontology: source.meta.ontology,` add:
```rust
            status: source.meta.status,
            protected: source.meta.protected,
            derived_from: source.meta.derived_from.clone(),
```
(This one copies from the source memory instead of defaulting.)

4. `src-tauri/src/commands/onboarding.rs:103-123` — In `create_profile_memory`, after `ontology: Some(default_ontology_for_memory_type(&MemoryType::Context)),` add the 3 default fields.

5. `src-tauri/src/commands/onboarding.rs:169-189` — In `write_memory_file`, after `ontology: Some(ontology),` add the 3 default fields.

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`

Expected: Folder-rename errors from old paths (fixed in Task 3), but NO missing-field errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/types.rs src-tauri/src/core/mcp.rs src-tauri/src/commands/memory.rs src-tauri/src/commands/onboarding.rs
git commit -m "feat: add MemoryStatus enum and protected/status/derived_from fields to MemoryMeta"
```

---

## Task 3: Update all Rust folder references

**Files:**
- Modify: `src-tauri/src/core/index.rs:11-20`
- Modify: `src-tauri/src/core/router.rs:16,34,40,46-61,67,72`
- Modify: `src-tauri/src/core/governance.rs:136,145`
- Modify: `src-tauri/src/core/journal.rs:11,57`
- Modify: `src-tauri/src/core/tasks.rs:10-12,74,141-143,158,169`
- Modify: `src-tauri/src/core/mcp.rs:345`
- Modify: `src-tauri/src/commands/config.rs:15-27,61,86,90,115,120`
- Modify: `src-tauri/src/commands/onboarding.rs:80,146,206,218,230,243,256,273,285,297,310,322,339,351,363,376`
- Modify: `src-tauri/src/commands/daily.rs:14,32`
- Modify: `src-tauri/src/commands/journal.rs:40`
- Modify: `src-tauri/src/commands/governance.rs:42,53`
- Modify: `src-tauri/src/cli.rs:122-126`

This task is a bulk find-and-replace. Here's the complete mapping:

```
"01-context"      → "02-context"
"02-daily"        → "03-daily"
"03-intelligence" → "04-intelligence"
"04-projects"     → "05-projects"
"05-resources"    → "06-resources"
"06-skills"       → "07-skills"
"07-tasks"        → "08-tasks"
"08-rules"        → "09-rules"
"09-scratch"      → "10-scratch"
```

**IMPORTANT:** Do the replacements in reverse order (09→10 first, then 08→09, etc.) to avoid double-renaming. "00-inbox" stays as-is. After all renames, add "01-sources" where folder lists appear.

- [ ] **Step 1: Update `core/index.rs` — scan_memories folder list**

Replace the folders array (lines 11-20):

```rust
    let folders = [
        "01-sources",
        "02-context",
        "03-daily",
        "04-intelligence",
        "05-projects",
        "06-resources",
        "07-skills",
        "08-tasks",
        "09-rules",
        "10-scratch",
    ];
```

- [ ] **Step 2: Update `core/router.rs`**

Update the rules empty message (line 16):
```rust
        out.push_str("_No rules defined yet. Add rules in 09-rules/_\n\n");
```

Update scratch reference (line 34):
```rust
    out.push_str("8. Si un output de herramienta supera 2000 tokens, escríbelo en 10-scratch/\n\n");
```

Update scratch in writing rules (line 40):
```rust
    out.push_str("- Archivos temporales van a 10-scratch/ con nombre descriptivo + timestamp\n\n");
```

Replace the entire folder structure block (lines 46-61):
```rust
    out.push_str("├── 00-inbox/                    ← zona temporal de captura\n");
    out.push_str("├── 01-sources/                  ← fuentes aceptadas (protegidas)\n");
    out.push_str("├── claude.md                    ← ESTE ARCHIVO (enrutador maestro)\n");
    out.push_str("├── _index.yaml                  ← catálogo L0 autogenerado\n");
    out.push_str("├── _config.yaml                 ← configuración global\n");
    out.push_str("├── 02-context/                  ← información estática del usuario\n");
    out.push_str("├── 03-daily/                    ← registros diarios (JSONL)\n");
    out.push_str("│   ├── daily-log.jsonl\n");
    out.push_str("│   └── sessions/\n");
    out.push_str("├── 04-intelligence/             ← investigación, mercado\n");
    out.push_str("├── 05-projects/                 ← un subdirectorio por proyecto\n");
    out.push_str("├── 06-resources/                ← plantillas, ejemplos\n");
    out.push_str("├── 07-skills/                   ← habilidades/instrucciones IA\n");
    out.push_str("├── 08-tasks/                    ← tareas (JSONL)\n");
    out.push_str("│   └── backlog.jsonl\n");
    out.push_str("├── 09-rules/                    ← restricciones y directrices\n");
    out.push_str("└── 10-scratch/                  ← buffer temporal de la IA\n");
```

Update compaction rule references (lines 67, 72):
```rust
    out.push_str("1. Escribe un resumen estructurado en 03-daily/sessions/YYYY-MM-DD-resumen.md\n");
```
```rust
    out.push_str("1. Escríbelo en 10-scratch/ con nombre descriptivo + timestamp\n");
```

Add `MemoryType::Source` to `types_order` array (line 80-88):
```rust
    let types_order = [
        MemoryType::Rule,
        MemoryType::Context,
        MemoryType::Source,
        MemoryType::Skill,
        MemoryType::Project,
        MemoryType::Intelligence,
        MemoryType::Resource,
        MemoryType::Task,
    ];
```

Add `Source` arm to `type_label` function (line 137-149):
```rust
fn type_label(t: &MemoryType) -> &str {
    match t {
        MemoryType::Rule => "📋 Reglas",
        MemoryType::Context => "👤 Contexto",
        MemoryType::Source => "📄 Fuentes",
        MemoryType::Skill => "⚡ Skills",
        MemoryType::Project => "📁 Proyectos",
        MemoryType::Intelligence => "🔍 Inteligencia",
        MemoryType::Resource => "📦 Recursos",
        MemoryType::Task => "✅ Tareas",
        MemoryType::Daily => "📅 Daily",
        MemoryType::Scratch => "📝 Scratch",
    }
}
```

Add ingestion rule to router content. After the "Escritura" section and before the folder structure section, add:

```rust
    // ========== SECTION: Ingestion Rule ==========
    out.push_str("## Ingesta\n");
    out.push_str("- Si trabajas con archivos de `00-inbox/`, lee primero `00-inbox/_INGEST.md` y sigue su protocolo\n");
    out.push_str("- Archivos protegidos (protected: true) NO deben editarse sin desbloqueo explícito del usuario\n\n");
```

- [ ] **Step 3: Update `core/governance.rs`**

Line 136: `"04-projects"` → `"05-projects"`
Line 145: `"03-intelligence"` → `"04-intelligence"`

- [ ] **Step 4: Update `core/journal.rs`**

Line 11: `root.join("02-daily")` → `root.join("03-daily")`
Line 57: `root.join("02-daily")` → `root.join("03-daily")`

- [ ] **Step 5: Update `core/tasks.rs`**

All occurrences of `"07-tasks"` → `"08-tasks"` (lines 12, 143, 158, 169 and the doc comments on lines 10, 74, 141).

- [ ] **Step 6: Update `core/mcp.rs`**

Line 345: `root.join("02-daily")` → `root.join("03-daily")`

- [ ] **Step 7: Update `commands/config.rs`**

Replace the dirs array (lines 15-27):
```rust
    let dirs = [
        "00-inbox",
        "01-sources",
        "02-context",
        "03-daily",
        "03-daily/sessions",
        "04-intelligence",
        "05-projects",
        "06-resources",
        "07-skills",
        "08-tasks",
        "09-rules",
        "10-scratch",
        ".cache",
    ];
```

Update line 61: `08-rules` → `09-rules`
Update line 86: `02-daily/daily-log.jsonl` → `03-daily/daily-log.jsonl`
Update line 90: `07-tasks/backlog.jsonl` → `08-tasks/backlog.jsonl`
Update line 115: `06-skills/` → `07-skills/`
Update line 120: `06-skills/_skill-instructions.md` → `07-skills/_skill-instructions.md`

- [ ] **Step 8: Update `commands/onboarding.rs`**

Line 80: `01-context/perfil-profesional.md` → `02-context/perfil-profesional.md`
Line 146: `01-context/perfil-profesional.md` → `02-context/perfil-profesional.md`
Line 206: `"06-skills"` → `"07-skills"`
Line 218: `"06-skills"` → `"07-skills"`
Line 230: `"06-skills"` → `"07-skills"`
Line 243: `"08-rules"` → `"09-rules"`
Line 256: `"01-context"` → `"02-context"`
Line 273: `"06-skills"` → `"07-skills"`
Line 285: `"06-skills"` → `"07-skills"`
Line 297: `"06-skills"` → `"07-skills"`
Line 310: `"08-rules"` → `"09-rules"`
Line 322: `"08-rules"` → `"09-rules"`
Line 339: `"06-skills"` → `"07-skills"`
Line 351: `"06-skills"` → `"07-skills"`
Line 363: `"06-skills"` → `"07-skills"`
Line 376: `"08-rules"` → `"09-rules"`

- [ ] **Step 9: Update `commands/daily.rs`**

Line 14: `02-daily/daily-log.jsonl` → `03-daily/daily-log.jsonl`
Line 32: `02-daily/daily-log.jsonl` → `03-daily/daily-log.jsonl`

- [ ] **Step 10: Update `commands/journal.rs`**

Line 40: `02-daily/daily-log.jsonl` → `03-daily/daily-log.jsonl`

- [ ] **Step 11: Update `commands/governance.rs`**

Line 42: `02-daily/daily-log.jsonl` → `03-daily/daily-log.jsonl`
Line 53: `"09-scratch"` → `"10-scratch"`

- [ ] **Step 12: Update `cli.rs`**

Replace dirs array (lines 122-125):
```rust
            let dirs = [
                "00-inbox", "01-sources", "02-context", "03-daily", "03-daily/sessions",
                "04-intelligence", "05-projects", "06-resources", "07-skills", "08-tasks",
                "09-rules", "10-scratch", ".cache",
            ];
```

- [ ] **Step 13: Verify full Rust compilation**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`

Expected: `Finished` with no errors.

- [ ] **Step 14: Commit**

```bash
git add src-tauri/
git commit -m "refactor: renumber all workspace folders (01-sources inserted, everything shifts +1)"
```

---

## Task 4: Update TypeScript types

**Files:**
- Modify: `src/lib/types.ts:1-10` (MemoryType), `src/lib/types.ts:18-38` (MemoryMeta), `src/lib/types.ts:317-346` (colors, labels)

- [ ] **Step 1: Add `"source"` to MemoryType union**

```typescript
export type MemoryType =
  | "source"
  | "context"
  | "daily"
  | "intelligence"
  | "project"
  | "resource"
  | "skill"
  | "task"
  | "rule"
  | "scratch";
```

- [ ] **Step 2: Add `MemoryStatus` type after `MemoryOntology`**

```typescript
export type MemoryStatus = "unprocessed" | "processed";
```

- [ ] **Step 3: Add new fields to `MemoryMeta`**

Add after the `ontology` field:

```typescript
  status: MemoryStatus | null;
  protected: boolean;
  derived_from: string[];
```

- [ ] **Step 4: Add color and label entries for `source`**

In `MEMORY_TYPE_COLORS`:
```typescript
export const MEMORY_TYPE_COLORS: Record<MemoryType, string> = {
  source: "#0ea5e9",      // sky
  context: "#3b82f6",     // blue
  daily: "#f59e0b",       // amber
  intelligence: "#8b5cf6", // violet
  project: "#10b981",     // emerald
  resource: "#6366f1",    // indigo
  skill: "#22c55e",       // green
  task: "#ef4444",        // red
  rule: "#f43f5e",        // rose
  scratch: "#71717a",     // zinc
};
```

In `MEMORY_TYPE_LABELS`:
```typescript
export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  source: "Fuente",
  context: "Contexto",
  daily: "Daily",
  intelligence: "Inteligencia",
  project: "Proyecto",
  resource: "Recurso",
  skill: "Skill",
  task: "Tarea",
  rule: "Regla",
  scratch: "Scratch",
};
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && npx tsc --noEmit 2>&1 | head -20`

Expected: Possible errors in components referencing old folder names (fixed in next tasks).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add source type, MemoryStatus, and new metadata fields to TypeScript types"
```

---

## Task 5: Update FileExplorer — folder map, icons, lock, status badge

**Files:**
- Modify: `src/components/explorer/FileExplorer.tsx:183-196` (folderToType map)
- Modify: `src/components/explorer/FileExplorer.tsx:486` (INBOX_FOLDER_NAME)
- Add icon imports and rendering logic

- [ ] **Step 1: Update `folderToType` map**

Replace the map (lines 184-194):

```typescript
  const map: Record<string, MemoryType> = {
    "01-sources": "source",
    "02-context": "context",
    "03-daily": "daily",
    "04-intelligence": "intelligence",
    "05-projects": "project",
    "06-resources": "resource",
    "07-skills": "skill",
    "08-tasks": "task",
    "09-rules": "rule",
    "10-scratch": "scratch",
  };
```

- [ ] **Step 2: Add sources folder constant and icon imports**

Near the existing `INBOX_FOLDER_NAME` constant (line 486), add:

```typescript
const SOURCES_FOLDER_NAME = "01-sources";
```

Add to the lucide-react imports at the top of the file:

```typescript
import { Inbox, BookOpen, Lock } from "lucide-react";
```

(Check existing imports first — add only what's missing.)

- [ ] **Step 3: Add `isSourcesPath` helper**

Near the existing `isInboxPath`/`isInboxNode` helpers:

```typescript
function isSourcesPath(path: string): boolean {
  return pathSegments(path).includes(SOURCES_FOLDER_NAME);
}

function isSourcesNode(node: FileNode): boolean {
  return node.name === SOURCES_FOLDER_NAME || isSourcesPath(node.path);
}
```

- [ ] **Step 4: Add custom folder icons**

Find where folder icons are rendered in the tree node component. Replace the generic folder icon with conditional rendering:

```typescript
{node.is_dir && isInboxNode(node) ? (
  <Inbox className="h-3.5 w-3.5 text-[color:var(--text-2)]" />
) : node.is_dir && isSourcesNode(node) ? (
  <BookOpen className="h-3.5 w-3.5 text-[color:var(--text-2)]" />
) : node.is_dir ? (
  /* existing folder icon */
) : (
  /* existing file icon */
)}
```

(Exact integration depends on the tree node JSX — adapt to the existing pattern.)

- [ ] **Step 5: Add lock indicator for protected files**

In the tree node rendering, after the file/folder name, add a lock icon when the file's memory has `protected: true`:

This requires checking the memory metadata. Since the explorer already has access to `memories` via the store, look up the memory by filename:

```typescript
{isProtectedMemory && (
  <Lock className="ml-0.5 h-2.5 w-2.5 text-[color:var(--text-2)]" />
)}
```

Where `isProtectedMemory` is derived from checking if the file's corresponding memory has `protected === true`.

- [ ] **Step 6: Add status badge for inbox files**

For files inside `00-inbox/` that are memories, show a colored dot based on status:

```typescript
{isInboxPath(node.path) && memoryStatus && (
  <span
    className={clsx(
      "ml-1 inline-block h-1.5 w-1.5 rounded-full",
      memoryStatus === "unprocessed" ? "bg-amber-500" : "bg-emerald-500"
    )}
    title={memoryStatus === "unprocessed" ? "Sin procesar" : "Procesado"}
  />
)}
```

- [ ] **Step 7: Verify it compiles and renders**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && npx tsc --noEmit 2>&1 | head -20`

Expected: Clean or only unrelated warnings.

- [ ] **Step 8: Commit**

```bash
git add src/components/explorer/FileExplorer.tsx
git commit -m "feat: add inbox/sources icons, lock indicator, and status badge to explorer"
```

---

## Task 6: Update editor — protection enforcement

**Files:**
- Modify: `src/components/editor/TipTapEditor.tsx:7-14,20-27` (add editable prop)
- Modify: `src/components/editor/MemoryEditor.tsx:299-320` (readonly when protected, disable delete)
- Modify: `src/components/editor/FrontmatterForm.tsx:79-241` (add Protect toggle, derived_from editor)

- [ ] **Step 1: Add `editable` prop to TipTapEditor**

In `src/components/editor/TipTapEditor.tsx`, add to the Props interface:

```typescript
interface Props {
  documentKey?: string;
  content: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
}
```

Pass it to `useEditor`:

```typescript
export function TipTapEditor({
  documentKey,
  content,
  onChange,
  onBlur,
  placeholder,
  className,
  editable = true,
}: Props) {
```

Add `editable` to the useEditor config:

```typescript
  const editor = useEditor({
    extensions: [ /* ... existing ... */ ],
    editable,
    editorProps: { /* ... existing ... */ },
    // ... rest
  });
```

- [ ] **Step 2: Update MemoryEditor to respect protected flag**

In `src/components/editor/MemoryEditor.tsx`, derive `isProtected` from meta:

```typescript
  const isProtected = meta?.protected ?? false;
```

Pass `editable={!isProtected}` to both TipTapEditor instances:

```typescript
<TipTapEditor
  key={`${activeMemory.meta.id}-l2`}
  documentKey={`${activeMemory.meta.id}-l2`}
  content={l2}
  onChange={(val) => { /* ... */ }}
  onBlur={() => void handleSave()}
  className="min-h-[400px]"
  placeholder="Escribe aqui..."
  editable={!isProtected}
/>
```

Same for the L1 TipTapEditor.

Make the L0 title input readonly when protected:

```typescript
<input
  type="text"
  value={meta.l0}
  onChange={(e) => { handleMetaChange({ ...meta, l0: e.target.value }); }}
  readOnly={isProtected}
  placeholder="Sin titulo"
  className="..."
/>
```

Disable the delete button when protected:

```typescript
<button
  type="button"
  onClick={handleDelete}
  disabled={loading || isProtected}
  className="..."
  title={isProtected ? "Archivo protegido" : "Eliminar memoria"}
>
```

- [ ] **Step 3: Add Protect toggle and derived_from to FrontmatterForm**

In `src/components/editor/FrontmatterForm.tsx`, add the Protect toggle right after the "Always load" checkbox:

```typescript
      <label className="flex items-center gap-2 text-xs text-[color:var(--text-1)]">
        <input
          type="checkbox"
          checked={meta.protected}
          onChange={(e) => update({ protected: e.target.checked })}
          className="accent-[color:var(--accent)]"
        />
        Protect
      </label>
```

Add a `derived_from` ChipEditor after the Related chip editor:

```typescript
      <ChipEditor
        label="Derived From"
        values={meta.derived_from}
        placeholder="source-id..."
        onAdd={(value) => update({ derived_from: addUnique(meta.derived_from, value) })}
        onRemove={(value) => update({ derived_from: meta.derived_from.filter((item) => item !== value) })}
      />
```

If status is set, show it as a read-only display after the Type selector:

```typescript
      {meta.status && (
        <Field label="Status">
          <span className={clsx(
            "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
            meta.status === "unprocessed"
              ? "bg-amber-500/20 text-amber-400"
              : "bg-emerald-500/20 text-emerald-400"
          )}>
            {meta.status === "unprocessed" ? "Sin procesar" : "Procesado"}
          </span>
        </Field>
      )}
```

- [ ] **Step 4: Update `toComparableMemoryMeta` in MemoryEditor**

In `src/components/editor/MemoryEditor.tsx`, the function `toComparableMemoryMeta` (around line 871) compares metadata to detect changes that need a derived state refresh. Add the new fields:

```typescript
function toComparableMemoryMeta(meta: MemoryMeta) {
  return {
    id: meta.id,
    memory_type: meta.memory_type,
    l0: meta.l0,
    importance: meta.importance,
    always_load: meta.always_load,
    decay_rate: meta.decay_rate,
    confidence: meta.confidence,
    tags: meta.tags,
    related: meta.related,
    triggers: meta.triggers,
    requires: meta.requires,
    optional: meta.optional,
    output_format: meta.output_format,
    status: meta.status,
    protected: meta.protected,
    derived_from: meta.derived_from,
  };
}
```

Without this, toggling `protected` or changing `status`/`derived_from` in the inspector would not trigger a save.

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && npx tsc --noEmit 2>&1 | head -20`

Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/
git commit -m "feat: add protection enforcement, Protect toggle, derived_from editor, and status display"
```

---

## Task 7: Update remaining TypeScript references

**Files:**
- Modify: `src/components/onboarding/OnboardingWizard.tsx:145`
- Modify: `src/views/ConnectorsView.tsx:160,162`

- [ ] **Step 1: Update OnboardingWizard folder listing**

Line 145, replace:
```
00-inbox/ · 01-context/ · 02-daily/ · 03-intelligence/ · 04-projects/ · 05-resources/ · 06-skills/ · 07-tasks/ · 08-rules/ · 09-scratch/
```
with:
```
00-inbox/ · 01-sources/ · 02-context/ · 03-daily/ · 04-intelligence/ · 05-projects/ · 06-resources/ · 07-skills/ · 08-tasks/ · 09-rules/ · 10-scratch/
```

- [ ] **Step 2: Update ConnectorsView scratch reference**

Line 160: `09-scratch/handoff.md` → `10-scratch/handoff.md`
Line 162: `09-scratch/handoff.md` → `10-scratch/handoff.md`

- [ ] **Step 3: Verify full TypeScript compilation**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && npx tsc --noEmit 2>&1 | tail -5`

Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/onboarding/OnboardingWizard.tsx src/views/ConnectorsView.tsx
git commit -m "refactor: update remaining TypeScript folder references to new numbering"
```

---

## Task 8: Add `_INGEST.md` to onboarding and router ingestion rule

**Files:**
- Modify: `src-tauri/src/commands/onboarding.rs` (add _INGEST.md creation)
- Modify: `src-tauri/src/commands/config.rs` (add _INGEST.md creation in workspace init)

- [ ] **Step 1: Add `_INGEST.md` creation in `create_workspace_structure`**

In `src-tauri/src/commands/config.rs`, after the skill instructions file creation (after line 121), add:

```rust
    // Create inbox ingestion protocol
    let ingest_instructions = r#"# Instrucciones de Ingesta — AI Context OS

Cuando proceses archivos de 00-inbox/, sigue este protocolo:

## 1. Analisis
- Lee el archivo completo
- Identifica: tipo de contenido, tema, idioma, relevancia

## 2. Preguntas al usuario (si esta disponible)
- A que proyecto o area pertenece esto?
- Que nivel de importancia le asignas?
- Hay algun tag o relacion con memorias existentes?
Si el usuario no responde, clasifica autonomamente con tu mejor criterio.

## 3. Procesamiento
- Genera frontmatter YAML completo (id, type, l0, importance, tags, ontology, etc.)
- Estructura el contenido con marcadores <!-- L1 --> y <!-- L2 -->
- L1: resumen ejecutivo (2-3 lineas)
- L2: contenido completo procesado

## 4. Clasificacion y destino
- Si es material de referencia original -> mover a 01-sources/ con protected: true
- Si es conocimiento a integrar -> crear/actualizar memoria en la carpeta correspondiente, anadir derived_from
- Si no tiene valor -> marcar como processed y dejar en inbox (el usuario decide si borrar)

## 5. Post-proceso
- Actualizar status: processed en el archivo original del inbox
- Si genero nuevas memorias, asegurar que derived_from apunte al source
"#;
    fs::write(root.join("00-inbox/_INGEST.md"), ingest_instructions)
        .map_err(|e| format!("Failed to write _INGEST.md: {}", e))?;
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`

Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/config.rs
git commit -m "feat: add _INGEST.md ingestion protocol to workspace initialization"
```

---

## Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update folder references in CLAUDE.md**

Update the IPC section, gotchas, and any folder references to reflect the new numbering. Key changes:

- Journal path: `03-daily/YYYY-MM-DD.md`
- Tasks path: `08-tasks/task-{id}.md`
- Update the folder structure if documented
- Add mention of `01-sources/` and protected field

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with new folder numbering and ingestion system"
```

---

## Task 10: Full build verification

- [ ] **Step 1: Run Rust compilation**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`

Expected: Clean build.

- [ ] **Step 2: Run TypeScript compilation**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && npx tsc --noEmit 2>&1 | tail -10`

Expected: Clean.

- [ ] **Step 3: Run full dev build**

Run: `cd /Users/alexdc/Documents/GitHub/AI-Context-OS && npm run build 2>&1 | tail -20`

Expected: Successful build.

- [ ] **Step 4: Fix any remaining issues**

If any compilation errors remain, fix them. Common issues:
- Missed folder rename in a string literal
- TypeScript type mismatch from new fields
- Missing match arm for `MemoryType::Source`

- [ ] **Step 5: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: resolve remaining build issues from inbox/sources refactor"
```
