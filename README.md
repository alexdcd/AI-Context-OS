# AI Context OS

Sistema operativo de contexto para trabajar con IAs desde archivos locales.

`AI Context OS` es una app desktop construida con `Tauri v2 + React + TypeScript + Rust` que convierte una carpeta del usuario en una base de conocimiento operativa para asistentes como Claude, Cursor, Windsurf, ChatGPT/Codex y otros flujos MCP.

La idea central del proyecto es simple:

- Los archivos son la base de datos.
- El contexto no se improvisa, se enruta.
- La memoria útil se escribe en Markdown con estructura.
- El sistema debe poder observar qué contexto sirve, qué sobra y qué se está degradando.

## Qué estamos construyendo

No es solo un editor de notas.

Es un runtime local para:

- guardar memoria persistente para IAs,
- recuperar solo el contexto relevante para cada tarea,
- visualizar relaciones entre memorias,
- gobernar conflicto, decaimiento y consolidación,
- integrar ese contexto con herramientas externas vía archivos y MCP,
- y mantener trazabilidad/observabilidad sobre cómo se usa el sistema.

En la práctica, AI Context OS mezcla 4 capas:

1. `Workspace filesystem-first`
   Una carpeta real del usuario (`~/AI-Context-OS` por defecto) contiene memorias, diario, tareas, scratch y configuración.
2. `App desktop`
   La interfaz permite explorar, editar, simular, observar y gobernar ese workspace.
3. `Motor de contexto`
   Rust calcula relevancia, nivel de carga y ensamblado del contexto.
4. `Capa de integración`
   Adaptadores como `claude.md`, `.cursorrules`, `.windsurfrules` y un servidor `MCP` exponen el sistema a otras herramientas.

## Principios del sistema

- `Files as database`: la verdad vive en archivos legibles y portables.
- `Human-readable by default`: Markdown + YAML, nada opaco.
- `Progressive loading`: primero `L1`, luego `L2` solo si hace falta.
- `Tool-agnostic core`: el núcleo genera un router neutral y luego lo adapta a cada herramienta.
- `Observability built-in`: no solo cargamos contexto; medimos si sirve.
- `Governance over accumulation`: memoria sin mantenimiento se degrada.

## Modelo conceptual

### 1. Memoria

La unidad principal es una `memory`, almacenada como `.md` con `YAML frontmatter` y dos niveles de detalle:

- `L0`: resumen ultra corto en metadata (`l0`)
- `L1`: resumen operativo
- `L2`: detalle completo

Separadores obligatorios:

```md
---
id: ejemplo
type: context
l0: "Resumen corto"
importance: 0.8
tags: [tag1, tag2]
related: [otra-memoria]
---

<!-- L1 -->
Resumen operativo.

<!-- L2 -->
Detalle completo.
```

Tipos de memoria soportados:

- `context`
- `daily`
- `intelligence`
- `project`
- `resource`
- `skill`
- `task`
- `rule`
- `scratch`

### 2. Workspace

El workspace tiene una estructura fija:

```text
~/AI-Context-OS/
├── 01-context/
├── 02-daily/
│   ├── YYYY-MM-DD.md
│   ├── daily-log.jsonl
│   └── sessions/
├── 03-intelligence/
├── 04-projects/
├── 05-resources/
├── 06-skills/
├── 07-tasks/
│   ├── task-xxxx.md
│   └── backlog.jsonl
├── 08-rules/
├── 09-scratch/
├── .cache/
├── _config.yaml
├── _index.yaml
├── claude.md
├── .cursorrules
└── .windsurfrules
```

Notas importantes:

- `02-daily/YYYY-MM-DD.md` es el journal diario real, estilo outliner/Logseq.
- `02-daily/daily-log.jsonl` se usa para eventos de sistema y consolidación, no como journal principal.
- `07-tasks/task-{id}.md` contiene tareas con frontmatter YAML.
- `09-scratch/` es buffer temporal para outputs largos o material descartable.

### 3. Router

El sistema genera un router neutral con:

- reglas globales,
- pautas de lectura/escritura,
- estructura del workspace,
- política de compaction,
- índice L0 de memorias disponibles,
- triggers de skills.

Ese router luego se adapta a:

- `claude.md`
- `.cursorrules`
- `.windsurfrules`

### 4. Skills

Los `skills` son memorias especiales reutilizables que pueden declarar:

- `triggers`
- `requires`
- `optional`
- `output_format`

Esto permite que una IA no solo reciba contexto, sino instrucciones operativas y dependencias relacionadas.

### 5. Context Engine

Cuando una herramienta pide contexto, el motor:

1. escanea las memorias,
2. detecta intención de la query,
3. ajusta pesos del scoring,
4. expande términos de búsqueda,
5. calcula relevancia híbrida,
6. decide nivel de carga `L0/L1/L2`,
7. ensambla el paquete final dentro del budget de tokens,
8. registra qué memorias entraron, cuáles quedaron fuera y por qué.

## Cómo selecciona contexto

El scoring actual es híbrido y combina:

- similitud semántica heurística,
- `BM25`,
- recencia,
- importancia,
- frecuencia de acceso,
- proximidad en el grafo.

Además, la query se clasifica de forma heurística:

- `debug`: sube el peso de `BM25` y del grafo
- `brainstorm`: sube recencia e importancia
- `default`: balance general

Esto permite que el sistema no cargue el mismo tipo de memoria para una tarea de debugging que para una tarea estratégica o creativa.

## Observabilidad y salud del workspace

Uno de los rasgos más valiosos del proyecto es que instrumenta el uso del contexto.

Se guarda una base SQLite en:

```text
{workspace}/.cache/observability.db
```

Se registran, entre otras cosas:

- requests de contexto,
- memorias servidas,
- memorias consideradas pero no cargadas,
- optimizaciones sugeridas,
- histórico de health score.

La app calcula además un `health score` del workspace usando:

- cobertura,
- eficiencia,
- frescura,
- balance entre tipos,
- limpieza.

Esto convierte el sistema en algo más cercano a una infraestructura de conocimiento viva que a un simple repositorio de notas.

## Governance

La vista de governance trabaja sobre 4 problemas reales:

- `Conflicts`: memorias relacionadas con señales contradictorias
- `Decay`: memorias candidatas a archivado por uso/decaimiento
- `Consolidation`: eventos del diario que deberían cristalizar en memoria estable
- `Scratch TTL`: basura temporal que debería limpiarse

La filosofía aquí es clara: acumular contexto sin gobierno empeora el sistema.

## Journal y tareas

### Journal

El journal diario se guarda como Markdown en:

```text
02-daily/YYYY-MM-DD.md
```

Se parsea como outliner con:

- indentación por niveles,
- bullets,
- estados de tarea tipo `TODO`, `IN-PROGRESS`, `DONE`, `CANCELLED`,
- prioridades `[#A]`, `[#B]`, `[#C]`.

### Tasks

Las tareas persistentes viven en:

```text
07-tasks/task-xxxxxxxx.md
```

Cada tarea incluye:

- `id`
- `title`
- `state`
- `priority`
- `tags`
- `source_date`
- `source_file`
- `created`
- `modified`
- `due`
- `notes`

## Integraciones y conectores

El sistema ya contempla varios modos de integración:

- `Claude Desktop`
- `Claude Code`
- `Cursor`
- `Windsurf`
- `ChatGPT / Codex`
- `Gemini Web`
- `GitHub Copilot`

Hay dos niveles:

- `Local Native`: integración directa vía archivos y/o MCP
- `Bridge`: transferencia manual de contexto o handoff

### MCP

El proyecto expone:

- servidor `MCP stdio`
- servidor `MCP HTTP` en `127.0.0.1:3847/mcp`

Herramientas principales del servidor MCP:

- `get_context`
- `save_memory`
- `get_skill`
- `log_session`

Esto permite usar AI Context OS como backend local de contexto para herramientas externas.

## Vistas actuales de la app

- `Explorer`: explorador de memorias y editor principal
- `Journal`: diario estilo outliner
- `Tasks`: gestión de tareas persistentes
- `Graph`: grafo de memorias y relaciones
- `Simulation`: simulador de carga de contexto y budget de tokens
- `Governance`: conflictos, decay, consolidación y scratch cleanup
- `Observability`: requests, stats, top memories y optimizaciones
- `Connectors`: estado MCP y bridges con herramientas externas
- `Settings`: tema, modo experto, backup y restore

## Stack técnico

### Frontend

- `React 19`
- `TypeScript`
- `React Router`
- `Zustand`
- `TipTap`
- `React Flow`
- `ELK.js`
- `Tailwind CSS v4`

### Backend

- `Tauri v2`
- `Rust`
- `Axum`
- `rmcp`
- `rusqlite`
- `chrono`

## Arquitectura del código

### Frontend

```text
src/
├── components/
├── hooks/
├── lib/
└── views/
```

Piezas clave:

- [`src/App.tsx`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/App.tsx): shell principal, rutas, title bar y onboarding gate
- [`src/lib/store.ts`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/lib/store.ts): store principal de la app
- [`src/lib/tauri.ts`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/lib/tauri.ts): puente IPC frontend ↔ Tauri
- [`src/lib/types.ts`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/lib/types.ts): contrato TypeScript del sistema

### Backend

```text
src-tauri/src/
├── commands/
├── core/
├── lib.rs
└── state.rs
```

Piezas clave:

- [`src-tauri/src/lib.rs`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/lib.rs): bootstrap Tauri, `invoke_handler`, setup y servidores MCP
- [`src-tauri/src/state.rs`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/state.rs): estado compartido del runtime
- [`src-tauri/src/core/types.rs`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/types.rs): tipos fuente del dominio
- [`src-tauri/src/core/router.rs`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/router.rs): router neutral e índice autogenerado
- [`src-tauri/src/core/scoring.rs`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/scoring.rs): scoring híbrido
- [`src-tauri/src/core/observability.rs`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/observability.rs): telemetría local y analytics
- [`src-tauri/src/core/mcp.rs`](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/mcp.rs): servidor MCP

## Invariantes importantes del repo

Estas reglas importan de verdad:

- `src/lib/types.ts` debe reflejar exactamente `src-tauri/src/core/types.rs`
- si añades un comando Rust, hay que registrarlo en:
  - `src-tauri/src/core/mod.rs`
  - `src-tauri/src/commands/mod.rs`
  - `src-tauri/src/lib.rs` en `invoke_handler`
- todo el texto visible en UI debe ir en español
- el theming debe usar variables CSS, no colores hardcodeados
- todos los `useState` deben declararse antes de cualquier `return` condicional
- la title bar usa `Overlay` y necesita spacer de `72px` para macOS traffic lights
- TipTap no tiene toolbar por diseño; el formato es por atajos

## Estado actual del producto

Hoy el proyecto ya tiene:

- workspace inicializable automáticamente,
- onboarding con templates,
- CRUD de memorias,
- editor y explorador,
- grafo relacional,
- simulación de contexto,
- governance básica,
- observabilidad persistente,
- journal diario,
- tareas en archivos,
- backup/restore,
- conectores y exposición MCP.

Todavía se nota que algunas partes están en evolución:

- hay labels puntuales en inglés en algunas vistas,
- parte del sistema de optimización/gobierno aún es heurístico,
- el producto ya tiene una base fuerte, pero sigue consolidando UX, naming y consistencia entre capas.

## Desarrollo local

### Requisitos

- `Node.js`
- `npm`
- toolchain de `Rust`
- dependencias de sistema necesarias para `Tauri v2`

### Instalar

```bash
npm install
```

### Desarrollo frontend

```bash
npm run dev
```

### Ejecutar la app Tauri

```bash
npm run tauri dev
```

### Build de frontend

```bash
npm run build
```

## Publicación

La release de instaladores se dispara desde GitHub Actions al empujar un tag que empiece por `v`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Qué hace especial a este proyecto

Hay muchas apps de notas. Hay muchos wrappers de LLM. Hay muchos experimentos de RAG.

Lo interesante aquí es la combinación:

- memoria estructurada pero editable a mano,
- contexto dinámico en vez de prompt estático,
- conectores concretos con herramientas reales,
- observabilidad local del uso del contexto,
- y una capa explícita de gobierno del conocimiento.

Ese cruce es la tesis del producto.

No queremos solo “guardar cosas para la IA”.
Queremos un sistema local donde el contexto sea una infraestructura mantenible.
