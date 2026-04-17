# Fix #2 — Caché de Memorias en AppState con Invalidación por Watcher

> Estado: **pendiente** | Prioridad: alta para vaults >100 memorias  
> Investigado: 2026-04-17 | Contexto: rama `algoritmos-y-fixes`

---

## El problema

`execute_context_query` en `engine.rs:96-106` hace un full scan de disco en **cada query**:

```rust
let all_entries = scan_memories(root);          // lista el filesystem completo
for (meta, path) in &all_entries {
    read_memory(root, Path::new(path))           // lee cada fichero .md del vault
}
```

Con N memorias, esto implica:
- **N llamadas I/O** (`read_memory` = parse frontmatter + leer contenido) por query
- Además, `Bm25Corpus::from_documents` tokeniza los N documentos (O(N·L) donde L = longitud media)
- El engine hace **dos passes** de scoring → los N documentos se tokenizaron solo una vez (fix ya aplicado), pero el I/O sigue siendo O(N) por query

Para un vault de 200 memorias con ~2KB/memoria: ~400KB leídos del disco por cada chat o simulación de contexto.

---

## Lo que ya existe (y no se está usando)

### `AppState.memory_index` — ya existe, ya tiene `RwLock`

```rust
// state.rs:17
pub memory_index: MemoryIndex,
// watcher.rs:13
pub type MemoryIndex = Arc<RwLock<HashMap<String, (MemoryMeta, String)>>>;
```

Almacena `(MemoryMeta, file_path)` por ID. `refresh_memory_index()` ya existe y hace el scan. **Problema: solo guarda metadatos, no el contenido completo (`l1_content`, `l2_content`, `raw_content`).**

### El watcher ya está activo pero no actualiza el índice

```rust
// watcher.rs:37
pub fn start_watcher(
    root: PathBuf,
    app_handle: AppHandle,
    _memory_index: Option<MemoryIndex>,   // ← parámetro con underscore, se ignora
    is_recent_write: Arc<dyn Fn(&str) -> bool + Send + Sync>,
)
```

El watcher detecta cambios correctamente (debouncer 500ms, filtra `.cache/`, `claude.md`, etc.) y emite eventos Tauri `"memory-changed"` y `"file-deleted"` — pero **no actualiza `memory_index`**. El `_memory_index` nunca se usa.

### Lo que el watcher ya filtra bien (no tocar)

```rust
// watcher.rs:73-90
if path_str.contains("/.cache/") { continue; }
if path_str.ends_with("/claude.md") { continue; }   // generated
if path_str.ends_with("/.ai/index.yaml") { continue; }
// ... otros artefactos generados
if is_recent_write(&path_str) { continue; }          // evita ciclo: escritura propia → evento
```

Esto es correcto y debe preservarse. La lógica de `is_recent_write` (2 segundos de gracia) previene el ciclo en el que una escritura del propio motor dispara una re-carga.

---

## Diseño propuesto

### Opción A — Snapshot inmutable (`Arc<Vec<Memory>>`) ← **recomendada**

```rust
// Nuevo tipo en state.rs
pub type MemorySnapshot = Arc<RwLock<Arc<Vec<Memory>>>>;
```

- El snapshot es un `Arc<Vec<Memory>>` (inmutable una vez construido)
- El watcher, al detectar un cambio, reconstruye todo el `Vec<Memory>` y hace un swap atómico del `Arc`
- Los handlers de query clonan el `Arc<Vec<Memory>>` al principio (O(1), solo incrementa el refcount) y trabajan sobre su copia sin bloquear

**Pros:**
- Lecturas completamente lockfree (solo `Arc::clone` al inicio)
- Sin posibilidad de leer un snapshot parcialmente actualizado
- Fácil de razonar: un snapshot = estado consistente del vault en un instante

**Contras:**
- Actualización más costosa: reconstruye todo `Vec<Memory>` en cada cambio de fichero
- Con vaults de >1000 memorias y ediciones frecuentes, el rebuild puede solaparse con queries en curso (pero no las bloquea, solo hay una pequeña ventana donde el watcher está reconstruyendo)

### Opción B — Mapa granular (`RwLock<HashMap<String, Memory>>`)

- Solo actualiza la entrada afectada
- Lecturas requieren `RwLock::read()` durante toda la operación → mayor contención
- Más complejo: hay que manejar inserciones, modificaciones, borrados individualmente

**Veredito: usar Opción A.** Para el tamaño actual de vaults (<500 memorias) la reconstrucción completa es ms-level y la semántica snapshot es mucho más simple.

### Campo adicional en AppState

```rust
pub struct AppState {
    // ... campos existentes
    pub memory_snapshot: Arc<RwLock<Arc<Vec<Memory>>>>,
    pub bm25_corpus_cache: Arc<RwLock<Option<(u64, Bm25Corpus)>>>,
    //                                       ^^^^ epoch/version counter
}
```

`bm25_corpus_cache` almacena `Option<(epoch, Bm25Corpus)>`. El epoch se incrementa en cada rebuild del snapshot. Cuando una query ve que el corpus tiene el mismo epoch que el snapshot actual, reutiliza el corpus cacheado en lugar de recalcularlo.

---

## Plan de implementación

### 1. Extender `AppState`

```rust
// state.rs — nuevos campos
pub memory_snapshot: Arc<RwLock<Arc<Vec<Memory>>>>,
pub snapshot_epoch: Arc<std::sync::atomic::AtomicU64>,
```

Inicializar snapshot vacío en `AppState::new()`. Llamar a `refresh_memory_snapshot()` una vez al arrancar (ya existe `refresh_memory_index()` como referencia).

### 2. Método `rebuild_snapshot` en `AppState`

```rust
pub fn rebuild_snapshot(&self) {
    let root = self.get_root();
    let all_entries = scan_memories(&root);
    let mut memories = Vec::with_capacity(all_entries.len());
    for (meta, path) in &all_entries {
        if let Ok(mut mem) = read_memory(&root, Path::new(path)) {
            mem.meta = meta.clone();
            memories.push(mem);
        }
    }
    {
        let mut snap = self.memory_snapshot.write().unwrap();
        *snap = Arc::new(memories);
    }
    self.snapshot_epoch.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}
```

### 3. Conectar el watcher al rebuild

En `watcher.rs`, quitar el underscore de `_memory_index` y añadir un callback o bien pasar un `Arc<AppState>`:

```rust
// Opción simple: pasar un rebuild_fn como Arc<dyn Fn() + Send + Sync>
pub fn start_watcher(
    root: PathBuf,
    app_handle: AppHandle,
    on_vault_change: Arc<dyn Fn() + Send + Sync>,   // ← nuevo
    is_recent_write: Arc<dyn Fn(&str) -> bool + Send + Sync>,
)
```

Dentro del loop del watcher, después de emitir el evento Tauri:
```rust
let _ = app_handle.emit("memory-changed", &path_str);
on_vault_change();   // ← rebuild snapshot en background
```

**Importante:** `on_vault_change` se ejecuta en el thread del watcher. El rebuild puede ser costoso en vaults grandes — evaluar si llamarlo directamente o enviarlo a un `tokio::spawn`.

### 4. Modificar `execute_context_query` para usar el snapshot

```rust
pub fn execute_context_query(
    memories: Arc<Vec<Memory>>,    // ← en lugar de root + scan
    query: &str,
    token_budget: u32,
    config: &Config,
) -> Result<ContextResult, String>
```

El caller (comando Tauri / MCP tool) obtiene el snapshot del `AppState` antes de llamar:
```rust
let memories = {
    let snap = state.memory_snapshot.read().unwrap();
    Arc::clone(&*snap)
};
execute_context_query(memories, query, budget, &config)
```

### 5. Caché del `Bm25Corpus`

```rust
// En execute_context_query, recibir también el epoch actual
// O bien: cachear en AppState con epoch-based invalidation
pub bm25_corpus_cache: Arc<Mutex<Option<(u64, Bm25Corpus)>>>,
```

```rust
let current_epoch = state.snapshot_epoch.load(Ordering::Relaxed);
let corpus = {
    let mut cache = state.bm25_corpus_cache.lock().unwrap();
    match &*cache {
        Some((epoch, corpus)) if *epoch == current_epoch => corpus.clone(),
        _ => {
            let docs: Vec<&str> = memories.iter().map(|m| m.raw_content.as_str()).collect();
            let new_corpus = Bm25Corpus::from_documents(&docs);
            *cache = Some((current_epoch, new_corpus.clone()));
            new_corpus
        }
    }
};
```

Esto amortiza el coste de tokenización O(N·L) entre todas las queries que llegan antes del siguiente cambio de fichero.

---

## Riesgos y consideraciones

### Staleness tolerable
Un snapshot puede quedar stale durante la ventana rebuild (ms a ~1s en vaults grandes). Para un tool de contexto para IAs, esto es completamente aceptable — la coherencia eventual es suficiente.

### Ciclo escritura→invalidación→rebuild
El engine escribe memorias (access_count, last_access). Esto dispara el watcher → rebuild → rebuild incluye la memoria recién escrita. Con `is_recent_write` (2s grace period) esto ya está gestionado para el watcher. Hay que asegurarse de llamar `mark_recent_write` antes de cualquier escritura del motor, no solo de escrituras de usuario.

### Memoria RAM
200 memorias × ~5KB = ~1MB. 500 memorias × ~5KB = ~2.5MB. No es un problema. Si el vault crece a >2000 memorias sería ~10MB — aún aceptable para una app de escritorio.

### `read_memory` vs `memory_index` actual
`memory_index` solo guarda `MemoryMeta`. El rebuild necesita `read_memory` para parsear el contenido completo. Esto es correcto — el rebuild hace lo mismo que el engine hacía per-query, pero una sola vez.

### CLI
`ai-context-cli` no tiene AppState — opera en modo stateless. No se ve afectado por este cambio. Seguirá haciendo scan de disco, lo cual es aceptable para un CLI one-shot.

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/state.rs` | Añadir `memory_snapshot`, `snapshot_epoch`, `bm25_corpus_cache`; añadir `rebuild_snapshot()` |
| `src/core/watcher.rs` | Quitar underscore de `_memory_index`, añadir `on_vault_change` callback; llamarlo tras emitir eventos |
| `src/core/engine.rs` | `execute_context_query` recibe `Arc<Vec<Memory>>` en lugar de `root`; elimina `scan_memories` + `read_memory` internos |
| `src/commands/memory.rs` | Adaptar callers de `execute_context_query` para pasar snapshot desde AppState |
| `src/commands/scoring.rs` | Ídem |
| `src/lib.rs` o `main.rs` | Llamar `rebuild_snapshot()` en el startup, después de inicializar el watcher |

---

## Lo que NO cambia

- PPR (`personalized_pagerank`) — depende de los seeds de la query, no cacheable entre queries
- `Bm25Corpus` por-query ya implementado — queda como fallback si no hay caché de AppState
- La lógica de dos passes del engine — no se toca
- Tests unitarios — el engine puede testearse directamente con `Vec<Memory>` sin AppState
