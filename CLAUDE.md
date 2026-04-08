# AI Context OS

Tauri v2 desktop app. Files ARE the database: ~/AI-Context-OS/ con `inbox/`, `sources/` y 9 carpetas numeradas (`01-context/` a `09-scratch/`), archivos .md con YAML frontmatter + marcadores <!-- L1 --> / <!-- L2 -->.

## Gotchas

- **Nuevo comando Rust → registrar en 3 sitios**: `core/mod.rs`, `commands/mod.rs`, Y `lib.rs` invoke_handler. **Actualizar también la sección IPC de este CLAUDE.md**
- **types.ts debe ser espejo exacto de types.rs** — desajustes causan fallos IPC silenciosos
- **Al añadir/quitar campos de un struct o interface**: grep `NombreStruct {` para encontrar TODOS los constructores (en Rust, `#[serde(default)]` no aplica a struct literals) y buscar funciones que comparen/copien campos manualmente (ej. `toComparableMemoryMeta`). Si no los actualizas todos: error de compilación en Rust, bugs silenciosos en TS.
- **Todos los useState ANTES de cualquier return condicional** — violar esto causa pantalla negra
- **titleBarStyle: "Overlay"** — traffic lights de macOS se solapan; top bar tiene spacer de 72px con data-tauri-drag-region
- **TipTap sin toolbar** — formato markdown solo por atajos de teclado, diseño intencional
- **Journal: 02-daily/YYYY-MM-DD.md** (outliner bullets estilo Logseq). El daily-log.jsonl es SOLO para eventos de sistema
- **Tasks: 07-tasks/task-{id}.md** con frontmatter YAML (state/priority)
- **Ingesta:** `inbox/` es staging, `sources/` guarda fuentes aceptadas. `protected: true` bloquea edición salvo desbloqueo explícito.
- **UI text en inglés** (labels, placeholders, empty states) — inglés es el idioma base de la app; el español u otros idiomas se añaden vía i18n encima
- **CSS variables para todo el theming** (--bg-0..3, --text-0..2, --accent, --border), nunca colores hardcoded

## IPC Commands (tauri.ts ↔ lib.rs)

config: init_workspace, get_config, save_config
memory: list_memories, get_memory, create_memory, save_memory, delete_memory
filesystem: get_file_tree, read_file, write_file
router: regenerate_router, get_router_content
scoring: simulate_context
graph: get_graph_data
governance: get_conflicts, get_decay_candidates, get_consolidation_suggestions, get_scratch_candidates
daily: get_daily_entries, append_daily_entry
journal: get_journal_page, save_journal_page, list_journal_dates, get_today
tasks: list_tasks, create_task, update_task, delete_task, toggle_task_state, generate_task_id
onboarding: run_onboarding, is_onboarded
backup: backup_workspace, restore_workspace

## Zustand stores

**useAppStore** (store.ts): initialized, fileTree, memories, activeMemory, activeRawFile, selectedPath, graphData, explorerOpen, loading, error
**useSettingsStore** (settingsStore.ts): theme (dark/light/system)

## Compilación & Releases (CI/CD)

- **Instaladores automáticos (Mac, Windows, Linux):** a través de GitHub Actions
- **Cómo publicar una versión:** crear un tag git que empiece por `v` y hacer un push.
  ```bash
  git tag v0.1.0
  git push origin v0.1.0
  ```
