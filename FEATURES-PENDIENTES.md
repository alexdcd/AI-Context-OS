# AI Context OS — Features Pendientes

> Actualizado: 2026-03-26
> ✅ = implementado | ⬚ = pendiente

---

## Scoring & Contexto Inteligente

- ✅ **Auto-update access_count/last_access** — `get_memory` incrementa contador y timestamp en cada lectura, persiste a disco
- ✅ **Skills `requires` force-loaded** — Dependencias de skills se elevan a L1 mínimo en simulate_context
- ✅ **Skills `optional` como boost** — +0.1 bonus en final_score para memorias en `optional` de skills seleccionados
- ✅ **Persistir access_count a disco** — Flush automático al cerrar la app (on_window_event Destroyed)
- ✅ **Watcher trackea accesos externos** — Cambios externos en .md incrementan access_count en el index
- ⬚ **Semantic scoring real** — Actualmente `semantic_free` usa heurística por keywords. Implementar embeddings locales (ej. `rust-bert` o llamada a API) para similitud semántica real
- ⬚ **Compat files diferenciados** — `.cursorrules` y `.windsurfrules` son copias idénticas de `claude.md`. Adaptar formato según convenciones de cada herramienta

## Router (claude.md)

- ⬚ **Secciones por herramienta activa** — Generar secciones diferentes según `active_tools` en config
- ⬚ **Attention positioning configurable** — Permitir al usuario reordenar la prioridad de secciones en el router

## Journal

- ✅ **Journal → daily-log.jsonl** — Bullets con #decision, #idea, #meeting, etc. se extraen automáticamente al JSONL al guardar
- ⬚ **Scroll infinito de días** — Vista tipo Logseq con scroll vertical que carga días anteriores dinámicamente
- ⬚ **Linked references** — Mostrar qué memorias referencian la fecha actual (backlinks)
- ⬚ **Templates de día** — Bloques pre-configurados según el día (ej. lunes = standup, viernes = retrospectiva)
- ⬚ **Extracción automática de tags** — Detectar #tags en bullets y añadirlos al frontmatter de memorias relacionadas

## Tasks

- ✅ **Edición inline de tasks** — Priority, state y notes editables en cards expandibles
- ⬚ **Drag & drop para reordenar** — Priorización visual arrastrando cards
- ⬚ **Vista Kanban** — Columnas por estado (todo/in_progress/done)
- ⬚ **Tasks desde journal** — Checkbox en journal que crea/sincroniza task en 07-tasks/
- ⬚ **Due dates** — Campo de fecha límite con indicador visual de urgencia
- ⬚ **Subtasks** — Jerarquía de tareas con progreso porcentual

## Graph

- ✅ **Decay visual** — Opacidad de nodos según decay_score (ya implementado en MemoryNodeComponent)
- ✅ **Click para editar** — Doble click en nodo navega al editor (onNodeDoubleClick)
- ✅ **Filtros por tipo** — Dropdown de tipo de memoria en la toolbar del graph
- ⬚ **Filtros por importancia/tags** — Sliders y chips para filtrar nodos interactivamente
- ⬚ **Clusters automáticos** — Agrupar memorias por comunidades detectadas en el grafo

## Governance

- ⬚ **Acciones para decay candidates** — Botones para archivar memorias con decay alto
- ⬚ **Consolidación ejecutable** — Aplicar sugerencias de consolidación con un click (merge entries → nueva memoria)
- ⬚ **Historial de governance** — Log de acciones tomadas (archivados, promovidos, etc.)

## Explorer & Editor

- ⬚ **Context menu** — Click derecho en el tree: renombrar, mover, duplicar, eliminar
- ⬚ **Drag & drop entre carpetas** — Mover memorias entre tipos arrastrando en el tree
- ⬚ **Búsqueda global** — Cmd+K para buscar por contenido/tags/id en todas las memorias
- ⬚ **Preview de markdown** — Toggle entre editor y preview renderizado
- ⬚ **TipTap: toolbar opcional** — Opción de mostrar toolbar para usuarios nuevos

## Simulation

- ⬚ **Perfiles de simulación guardados** — Guardar combinaciones de query + budget para reutilizar
- ⬚ **Comparar simulaciones** — Vista side-by-side de dos simulaciones con diferente query/budget

## Infraestructura

- ⬚ **Tests** — Unit tests para scoring, decay, frontmatter parsing, router generation
- ⬚ **Auto-update** — Integrar tauri-plugin-updater para actualizaciones automáticas
- ⬚ **Backup/restore** — Exportar/importar todo el workspace como .zip
- ⬚ **Métricas de uso** — Dashboard con estadísticas: memorias más accedidas, evolución de tokens, efectividad del contexto
- ⬚ **Multi-workspace** — Soporte para múltiples workspaces (ej. uno personal, otro por proyecto)
- ⬚ **Import desde Obsidian/Logseq** — Migrador que convierte vaults existentes al formato AI Context OS

## UX

- ⬚ **Onboarding mejorado** — Tutorial interactivo post-setup que explique el flujo completo
- ⬚ **Responsive sidebar** — Colapsar sidebar icon-only en pantallas pequeñas (ya parcial)
- ⬚ **Temas adicionales** — Más allá de dark/light: variantes de color accent
