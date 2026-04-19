# AI Context OS — Arquitectura actual de router, contexto y memorias
Este documento describe el funcionamiento actual del sistema tras la racionalización del router, el endurecimiento de `protected`, la separación entre contexto estático y contexto MCP, y la salida de la telemetría de uso del frontmatter canónico.
Sirve para dos públicos a la vez:
- Personas que necesitan entender cómo funciona la app y cómo deben usarla o documentarla.
- IAs/agentes que necesiten una explicación precisa de las reglas del sistema, de qué archivos son canónicos y de cómo se debe navegar el contexto.
## 1. Objetivo del sistema
AI Context OS organiza conocimiento canónico en memorias Markdown estructuradas. El sistema debe funcionar en dos modos:
- Modo con MCP: el agente usa herramientas del sistema para pedir contexto, guardar memorias y cargar skills.
- Modo sin MCP: el agente sólo dispone de archivos canónicos y de un router estático (`claude.md`, `.cursorrules`, `.windsurfrules`).
El requisito principal del diseño actual es no romper la utilidad del modo sin MCP. Por eso el router estático sigue siendo autosuficiente para descubrimiento básico.
## 2. Qué es una memoria canónica y qué no lo es
Una memoria canónica es un archivo Markdown que el sistema reconoce explícitamente como memoria. Debe tener:
- YAML frontmatter válido
- campo `id`
- campo `type` (ontología)
- campo `l0`
- estructura por niveles mediante `<!-- L1 -->` y `<!-- L2 -->`
Una memoria canónica pertenece al sistema y puede participar en:
- indexado
- scoring
- carga de contexto
- grafo
- router
- MCP
- enforcement de `protected`
Importante:
- No todo `.md` del repositorio es una memoria.
- Los `README.md`, documentación de `docs/` y Markdown del repositorio que no tengan frontmatter canónico no deben tratarse como memorias.
- El escáner ya no auto-inyecta frontmatter en Markdown desnudos. Los documentos normales del repo permanecen intactos.
## 3. Contrato del archivo canónico
Las memorias canónicas siguen usando un único archivo `.md` con esta forma conceptual:
- Frontmatter YAML
- `<!-- L1 -->`
- contenido de resumen expandido
- `<!-- L2 -->`
- contenido detallado
Campos principales del frontmatter actual:
- `id`: identificador estable en kebab-case
- `type`: ontología real de la memoria (`source`, `entity`, `concept`, `synthesis`)
- `l0`: resumen de una línea
- `importance`
- `decay_rate`
- `confidence`
- `tags`
- `related`
- `created`
- `modified`
- `version`
- `triggers`, `requires`, `optional`, `output_format` para skills
- `status` para flujos de inbox/ingestión
- `protected`
- `derived_from`
Campos ya no canónicos:
- `last_access`
- `access_count`
Esos datos siguen existiendo en runtime, pero ya no se serializan al archivo.
Campo retirado del contrato canónico actual:
- `always_load`
Se ha eliminado porque el sistema no podía garantizar esa promesa de forma honesta.
## 4. Enriquecimiento derivado por path
El sistema sigue derivando dos conceptos a partir de la ubicación del archivo:
- `folder_category`
- `system_role`
Esto no se serializa al canónico. Se calcula en runtime para clasificar la memoria sin contaminar el frontmatter.
Reglas actuales:
- `.ai/rules/` => `system_role = rule`
- `.ai/skills/` => `system_role = skill`
- el primer segmento del path relativo se usa como `folder_category`
## 5. Router: de texto monolítico a manifest + renderizados
Antes el router era conceptualmente un bloque único de Markdown reutilizado para:
- `claude.md`
- `.cursorrules`
- `.windsurfrules`
- preludio MCP de `get_context`
Ahora el sistema usa una representación intermedia:
- `RouterManifest`
- `RouterCollection`
- `RouterMemoryEntry`
Desde ese manifest se renderizan varias salidas distintas.
### 5.1 Salidas actuales
1. Router estático
- Se renderiza con `render_static_router(...)`
- Es la base de `claude.md`, `.cursorrules` y `.windsurfrules`
2. Catálogo enriquecido
- `.ai/catalog.md`
- Se renderiza con `render_catalog_markdown(...)`
3. Índice estructurado
- `.ai/index.yaml`
- Se renderiza con `generate_index_yaml(...)`
4. Preludio MCP
- Se renderiza con `render_mcp_prelude(...)`
- Es más corto y más orientado a herramientas que el router estático
## 6. Qué contiene el router estático
El router estático sigue siendo útil por sí mismo, especialmente sin MCP. Su función actual no es contener toda la metadata, sino ofrecer un bootstrap claro y navegable.
Incluye:
- reglas principales del workspace
- explicación general de cómo funciona el sistema
- reglas de lectura y escritura
- estructura del workspace
- índice L0 compacto dentro del propio router
- rutas relativas por memoria
- ontología por memoria
- triggers de skills cuando existen
- referencia a `.ai/catalog.md` y `.ai/index.yaml` para metadata más rica
No intenta contener:
- metadata estructurada pesada por memoria
- telemetría de acceso
- todo el detalle de dependencias/provenance dentro del propio archivo
## 7. Qué contiene el catálogo enriquecido
`.ai/catalog.md` es la vista humana suplementaria. Se usa cuando el router estático no basta.
Puede contener por memoria:
- path
- ontología
- importancia
- role
- `protected`
- `status`
- tags
- related
- derived_from
- triggers
- requires
- optional
- output_format
La idea es:
- `claude.md` para descubrir rápido
- `catalog.md` para profundizar sin necesidad de MCP
## 8. Qué contiene el índice YAML
`.ai/index.yaml` es la salida estructurada orientada a máquina. Expone el manifest en formato serializable.
Su función principal es:
- servir como índice rico alternativo
- soportar inspección estructurada
- permitir un punto de integración más estable que el Markdown libre
## 9. Diferencia entre modo MCP y modo sin MCP
### 9.1 Con MCP
El agente puede usar:
- `get_context`
- `save_memory`
- `get_skill`
- `log_session`
En este modo:
- el engine selecciona memorias por relevancia y presupuesto
- puede devolver L1 o L2 de forma real
- se registra uso runtime
- se respetan dependencias de skills
- `protected` se aplica también en flujos MCP
### 9.2 Sin MCP
El agente sólo ve archivos:
- router estático
- memorias canónicas
- catálogo/index si los abre explícitamente
En este modo:
- el router sigue siendo útil para descubrimiento
- las rutas relativas ayudan a abrir el archivo correcto
- no existe control duro sobre “leer sólo L1”
- las instrucciones del router son orientativas, no enforcement técnico
## 10. Estado real de L1 y L2
Este punto es importante para no documentar una capacidad inexistente.
### Con MCP / engine
Sí existe carga progresiva real:
- el backend parsea el archivo
- separa `L1` y `L2`
- decide cuánto devolver según score y presupuesto
### Sin MCP
No existe garantía fuerte de que una IA lea sólo `L1`.
Aunque el router diga “lee L1 antes de L2”, si la IA abre el archivo canónico completo:
- puede leer el archivo entero
- no hay enforcement físico dentro de un único `.md`
Conclusión:
- El sistema soporta progressive loading real con MCP.
- En modo estático sólo existe una convención bien guiada, no aislamiento duro.
## 11. Scoring y ensamblado de contexto
El engine ejecuta este flujo:
1. escanea memorias canónicas
2. construye manifest para el preludio MCP
3. carga memorias parseadas
4. calcula scoring base
5. selecciona top candidatas
6. vuelve a puntuar con señal de grafo/comunidad
7. aplica force-loads y boosts de dependencias de skills
8. asigna presupuesto por niveles `L0`, `L1`, `L2`
9. monta el paquete final
El paquete MCP contiene:
- reglas MCP compactas arriba
- memorias cargadas para la tarea
- memorias disponibles pero no cargadas
## 12. Telemetría de uso: ya no vive en el canónico
`last_access` y `access_count` ya no se persisten en los archivos Markdown.
Ahora viven en:
- `.cache/memory-usage.json`
Comportamiento actual:
- al leer una memoria desde la app, se actualiza el store runtime
- al servir contexto por MCP, se registran accesos runtime
- al cargar skills por MCP, también se registran accesos
- durante el escaneo, los metadatos runtime se reinyectan en memoria para scoring/grafo/UI
Beneficio:
- se mantiene el canónico limpio
- la telemetría deja de contaminar commits y diffs
## 13. `protected`: ahora es una regla real, no sólo UI
`protected` ya no es sólo una sugerencia visual.
### Enforcement actual
Se impide modificar o borrar memorias protegidas en:
- `save_memory` del backend
- `delete_memory`
- `rename_memory_file`
- `move_memory_file`
- `save_memory` MCP
- comandos raw de filesystem sobre paths protegidos o artefactos generados
Regla especial:
- para editar una memoria protegida, primero debe “desprotegerse”
- el backend acepta como operación válida un cambio cuyo único propósito efectivo sea pasar `protected: true` a `protected: false` sin cambiar el contenido
Esto permite un flujo explícito de unlock antes de editar.
## 14. Protección de artefactos generados y carpetas del sistema
El sistema protege también ciertos paths que no deben mutarse como si fueran contenido de usuario:
- `claude.md`
- `.cursorrules`
- `.windsurfrules`
- `.ai/config.yaml`
- `.ai/index.yaml`
- `.ai/catalog.md`
Además, hay directorios del sistema tratados como gestionados:
- `.ai/`
- `inbox/`
- `sources/`
Los comandos raw de filesystem rechazan escrituras/renames/deletes directos sobre esos targets cuando están clasificados como protegidos o sistema gestionado.
## 15. Reglas actuales de creación y ubicación de memorias
Crear memoria:
- por defecto va a `inbox/`
- también puede crearse en carpetas válidas del workspace
No se permite crear memorias en:
- `sources/`
- `.ai/`
- `.ai/journal`
- `.ai/scratch`
Las únicas ubicaciones MCP válidas dentro de `.ai/` son:
- `.ai/skills`
- `.ai/rules`
## 16. Conectores: modelo honesto actual
La UX de conectores ya no colapsa todo en un único “local native”.
Modelo actual:
- `Native MCP`
- `Remote MCP`
- `Bridge`
### Native MCP
Ejemplos:
- Claude Desktop
- Claude Code
- Codex CLI
- Gemini CLI
Características:
- soporte MCP nativo/stdio
- acceso a herramientas del sistema
### Remote MCP
Ejemplos:
- Cursor
- Windsurf
Características:
- uso de MCP HTTP/SSE cuando la app está abierta
- fallback estático mediante `.cursorrules` o `.windsurfrules`
### Bridge
Ejemplos:
- ChatGPT Web
- Gemini Web
- Copilot
Características:
- no hay MCP real
- se usan snapshots/handoff/copiado de contexto
- el sistema deja claro cuándo el contexto estático es sólo fallback manual
## 17. Qué NO hace el sistema actual
Para evitar sobreprometer, estas limitaciones deben documentarse explícitamente:
- No hay `always_load` real.
- Sin MCP no hay garantía de lectura estricta de sólo `L1`.
- Un `.md` cualquiera del repositorio no se convierte automáticamente en memoria.
- El router estático no contiene toda la metadata rica.
- El catálogo e índice son suplementarios; no sustituyen al router para discovery sin MCP.
## 18. Reglas operativas para humanos
- Usa memorias canónicas sólo cuando el archivo deba formar parte del sistema de contexto.
- No conviertas documentación general del repo en memoria salvo que esa sea una decisión explícita.
- Si una memoria debe ser inmutable salvo desbloqueo explícito, marca `protected: true`.
- Usa `inbox/` como zona de entrada y conversión, no como documentación general del repositorio.
- Usa `.ai/skills` y `.ai/rules` sólo para piezas del sistema, no para docs arbitrarias.
## 19. Reglas operativas para IAs
- No asumas que todo `.md` del repositorio es una memoria.
- Sólo los Markdown con frontmatter canónico son memorias del sistema.
- Si MCP está disponible, úsalo antes que leer archivos manualmente.
- Si MCP no está disponible, empieza por el router estático y luego abre sólo memorias canónicas relevantes.
- Usa `.ai/catalog.md` o `.ai/index.yaml` sólo cuando el router estático no sea suficiente.
- No edites artefactos generados (`claude.md`, `.cursorrules`, `.windsurfrules`, `.ai/index.yaml`, `.ai/catalog.md`) como si fueran fuente canónica.
- No intentes modificar memorias protegidas sin un paso explícito de desbloqueo.
## 20. Resumen ejecutivo
La arquitectura actual ya no trata el router como un bloque monolítico único.
Ahora el sistema se organiza así:
- Memorias canónicas en Markdown con frontmatter + `L1/L2`
- Manifest estructurado en backend
- Router estático compacto y autosuficiente para discovery
- Catálogo e índice ricos como capas suplementarias
- Preludio MCP separado y más corto
- Telemetría de uso en runtime, no en el canónico
- Enforcement real de `protected`
- Conectores clasificados según capacidades reales
Este es el estado que debe usarse como base para explicar, operar y evolucionar AI Context OS.
