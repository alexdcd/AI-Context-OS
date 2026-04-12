# AI Context OS — Features Pendientes

> Actualizado: 2026-04-09
> ✅ = implementado | ⬚ = pendiente

---

## Scoring & Contexto Inteligente

- ⬚ **Semantic scoring real** — Actualmente `semantic_free` usa heurística por keywords. Implementar embeddings locales (ej. `rust-bert` o llamada a API) para similitud semántica real
- ⬚ **Compat files diferenciados** — `.cursorrules` y `.windsurfrules` son copias idénticas de `claude.md`. Adaptar formato según convenciones de cada herramienta

## Router (claude.md)

- ⬚ **Secciones por herramienta activa** — Generar secciones diferentes según `active_tools` en config
- ⬚ **Attention positioning configurable** — Permitir al usuario reordenar la prioridad de secciones en el router

## Journal

- ⬚ **Scroll infinito de días** — Vista tipo Logseq con scroll vertical que carga días anteriores dinámicamente
- ⬚ **Templates de día** — Bloques pre-configurados según el día (ej. lunes = standup, viernes = retrospectiva)
- ✅ **Extracción automática de tags** — Detectar #tags en bullets y añadirlos al frontmatter de memorias relacionadas

## Tasks

- ⬚ **Drag & drop para reordenar** — Priorización visual arrastrando cards
- ⬚ **Vista Kanban** — Columnas por estado (todo/in_progress/done)
- ⬚ **Subtasks** — Jerarquía de tareas con progreso porcentual

## Graph


- ⬚ **Clusters automáticos (Leiden)** — Agrupar memorias visual y lógicamente usando el algoritmo de Leiden (por densidad de aristas, superando a K-means) para detectar comunidades topológicas en el grafo

## Observability

- ⬚ **Unificar Governance + Observability en una vista "Health"** — La separación actual es arbitraria desde el punto de vista del usuario. Una sola vista con resumen ejecutivo arriba y tabs específicos daría una imagen completa del estado del sistema sin saltar entre secciones. *Pendiente de decisión de producto.*
- ⬚ **Badge proactivo en la nav de Observability** — Mostrar un contador cuando hay optimizaciones de impacto alto pendientes (similar al badge existente en Governance). El usuario no debería tener que entrar para saber si hay algo que hacer.
- ⬚ **Memory IDs clicables** — En Top Memories, Unused Memories y Unused de Intelligence, los IDs deberían ser enlaces directos al editor de esa memoria. Actualmente son texto muerto.
- ⬚ **Breakdown por source (herramienta)** — Desglose de requests por fuente (Claude, Cursor, etc.) para saber qué herramientas están usando más el contexto y si la integración MCP de alguna no está tirando.
- ⬚ **Rango de tiempo seleccionable** — Intelligence actualmente está hardcodeado a 7/30 días. Permitir al usuario elegir la ventana de análisis.
- ✅ **Health score global** — Banner con score 0-100, breakdown por dimensión (coverage, efficiency, freshness, balance, cleanliness) y tendencia vs día anterior.
- ✅ **Trend de eficiencia** — Indicador visual (TrendingUp/Down) en la card de Efficiency + texto explicativo contextual.
- ✅ **Live tab reactiva** — Dot pulsante verde + contador "updated X sec ago" que ticks cada segundo para dar sensación de actividad real.
- ✅ **Auto-análisis en Optimizations** — Al entrar en la pestaña se carga el estado pendiente y se lanza análisis automático si no hay items. Muestra "Last analyzed X min ago" con botón de re-análisis.

## Governance

- ⬚ **Consolidación ejecutable** — Aplicar sugerencias de consolidación con un click (merge entries → nueva memoria). Botón "Create memory from this" que pre-rellena el editor con el contenido consolidado y el ontology sugerido.
- ⬚ **Resolución de conflictos** — Añadir acciones por cada conflicto detectado: "Edit A", "Edit B", "Mark as intentional" (suprime el conflicto para no volver a verlo). Actualmente los conflictos son read-only sin camino de salida.
- ⬚ **Historial de governance** — Log de acciones tomadas (archivados, promovidos, etc.)
- ✅ **God nodes** — Detección de "Code Smells de contexto" comparando la alta centralidad de grado (Degree Centrality) vs baja importancia asignada.
- ✅ **Badge de issues en sidebar** — Contador visible en el icono de Governance con el total de issues activos (conflictos + decaimiento + scratch expirado). Se refresca cada 5 minutos en background.
- ✅ **Confirmación en bulk deletes** — Modal de confirmación antes de "Archive all" y "Clear all". Incluye confirmación también en archivado/borrado individual.
- ✅ **God Nodes: lenguaje accionable** — Reemplazado "mismatch score" opaco por etiqueta legible ("Undervalued — boost it") y botón "Boost importance" que incrementa el score directamente.
- ✅ **Auto-refresh de datos** — Governance recarga datos en background cada 5 minutos sin necesidad de navegar a la sección.

## Explorer & Editor

- ⬚ **Drag & drop entre carpetas** — Mover memorias entre tipos arrastrando en el tree
- ⬚ **Preview de markdown** — Toggle entre editor y preview renderizado
- ⬚ **TipTap: toolbar opcional** — Opción de mostrar toolbar para usuarios nuevos

## Simulation

- ⬚ **Perfiles de simulación guardados** — Guardar combinaciones de query + budget para reutilizar
- ⬚ **Comparar simulaciones** — Vista side-by-side de dos simulaciones con diferente query/budget

## Workflows / Agentes

- ⬚ **Marketplace de Agentes (Premium)** — Funcionalidad Freemium para importar plantillas de agentes especializados (ej. SM Agent). [Ver plan detallado](./feature_agente.md)

## Infraestructura

- ⬚ **Tests** — Unit tests para scoring, decay, frontmatter parsing, router generation
- ⬚ **Auto-update** — Integrar tauri-plugin-updater para actualizaciones automáticas
- ✅ **Backup/restore** — Exportar/importar todo el workspace como .zip
- ⬚ **Métricas de uso** — Dashboard con estadísticas: memorias más accedidas, evolución de tokens, efectividad del contexto
- ⬚ **Multi-workspace** — Soporte para múltiples workspaces (ej. uno personal, otro por proyecto)
- ⬚ **Import desde Obsidian/Logseq** — Migrador que convierte vaults existentes al formato AI Context OS

## UX

- ⬚ **Onboarding mejorado** — Tutorial interactivo post-setup que explique el flujo completo
- ✅ **Responsive sidebar** — Colapsar sidebar icon-only en pantallas pequeñas

## Herramientas MCP

- ⬚ **Herramientas MCP Exploratorias / Navegación del Grafo** 🌟🌟🌟 — Darle al usuario herramientas para recorrer activamente el Scoring Engine y el Grafo si el contexto automático se queda corto.
    - `list_topics()`: Lista tags/comunidades detectadas.
    - `get_related_memories(id)`: Devuelve memorias relacionadas con un ID.
    - `search_by_tag(tag)`: Búsqueda directa por tag.
