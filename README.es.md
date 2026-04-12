<p align="center">
  <img src="assets/Memm_logo0.png" width="600" alt="AI Context OS Logo">
</p>

<h1 align="center">MEMM — AI Context OS</h1>

<p align="center">
  <strong>Capa de memoria universal para agentes de IA.</strong><br>
  Filesystem-first • Contexto Determinista (L0/L1/L2) • Agnóstico de Herramienta
</p>

<p align="center">
  <a href="https://memm.dev/"><b>Sitio Web</b></a> •
  <a href="./README.md"><b>English</b></a> •
  <a href="./docs/README.md"><b>Documentación</b></a>
</p>

---

[README.md](./README.md) en Inglés.

AI Context OS es una app desktop (`Tauri v2 + React + TypeScript + Rust`) que convierte una carpeta local en una capa de memoria universal y agnóstica de herramienta para agentes de IA.

No es un chat ni un wrapper de un proveedor concreto. Es un brain layer filesystem-first con carga de contexto determinista (`L0/L1/L2`) e integraciones por adapters.

## Tesis del sistema

- El estado canónico vive en archivos.
- El contexto se enruta, no se improvisa.
- Las integraciones externas son adapters, no fuente de verdad.
- La UX no debe prometer capacidades inexistentes.
- La calidad del contexto debe ser observable y gobernable.

## Modelo de almacenamiento (aclaración)

AI Context OS es filesystem-first:

- Memorias, journal, tareas, reglas, router y scratch viven como archivos en el workspace.
- La fuente canónica es el árbol de archivos.

AI Context OS también usa SQLite local para observabilidad:

- Ruta: `{workspace}/.cache/observability.db`
- Uso: telemetría y señales de optimización (peticiones servidas, estadísticas, health snapshots, optimizaciones pendientes)
- No canónico: no sustituye el modelo de memoria basado en archivos

## Memoria progresiva: L0, L1, L2

Cada memoria tiene 3 niveles:

- `L0`: resumen de una línea en frontmatter (`l0`)
- `L1`: resumen operativo
- `L2`: detalle completo

Formato:

```md
---
id: stack-tecnologico
type: context
l0: "Stack y convenciones del proyecto"
importance: 0.9
tags: [stack, arquitectura]
related: [convenciones-codigo]
---

<!-- L1 -->
Resumen operativo corto.

<!-- L2 -->
Contenido largo y detallado.
```

## Estructura del workspace

AI Context OS utiliza una arquitectura "Zero Gravity": la carpeta física donde reside un archivo tiene **impacto cero** en su clasificación semántica. El sistema escanea recursivamente y clasifica todo a través del frontmatter YAML.

```text
~/AI-Context-OS/
├── inbox/          ← zona de captura temporal (landing pad)
├── sources/        ← referencias externas (solo lectura por defecto)
├── .ai/            ← infraestructura oculta del sistema
│   ├── rules/      ← reglas de comportamiento para agentes (máxima atención)
│   ├── journal/    ← registros diarios y sesiones
│   ├── tasks/      ← subsistema de seguimiento de tareas
│   ├── scratch/    ← buffer temporal de salida de IA (basado en TTL)
│   ├── config.yaml ← configuración del workspace
│   └── index.yaml  ← catálogo L0 autogenerado
├── User_Folders/   ← estructura cosmética del usuario (ej. Proyectos/, Notas/)
├── .cache/
├── claude.md       ← master router (autogenerado)
├── .cursorrules
└── .windsurfrules
```

Notas:

- La infraestructura del sistema es fija: `inbox/`, `sources/` y `.ai/`. Todo lo demás es definido por el usuario.
- Las páginas del Journal viven en `.ai/journal/YYYY-MM-DD.md`.
- Las tareas son archivos markdown en `.ai/tasks/` con frontmatter YAML.
- `claude.md` existe por compatibilidad, pero el objetivo arquitectónico es core neutral + adapters.
- Mover un archivo de memoria entre carpetas de usuario **no** rompe la indexación — la clasificación viene del campo `type:` en el frontmatter.

## Qué está funcionando hoy (verificado)

Implementado y conectado:

- Inicialización de workspace, carga/guardado de config y watcher
- CRUD de memorias y operaciones de archivo asociadas
- Árbol de archivos + lectura/escritura de archivos raw en UI
- Regeneración de router y escritura de adapters (`claude.md`, `.cursorrules`, `.windsurfrules`)
- Simulación de contexto y pipeline de scoring
- Grafo de memorias
- Governance: conflictos, decay, consolidación y scratch TTL
- Journal diario (`get/save/list/get_today`)
- CRUD de tareas + toggle de estado
- Onboarding y templates
- Backup/restore
- Observabilidad, health score y sugerencias de optimización
- MCP stdio y MCP HTTP (`127.0.0.1:3847/mcp`)
- Vista de conectores con estado local y acciones bridge (copiar contexto, generar handoff)

Con limitaciones:

- Bridge hoy cubre flujos de transferencia manual, no integración remota nativa.
- “Universal” significa modelo central universal + adapters, no paridad total de features en cada herramienta.

## Roadmap

Alineado con el estado actual y con `REVISION-TECNICA-ALINEACION-2026-03-29.md`.

### 1. Endurecer adapter-first

- Mantener el core neutral como base.
- Conservar `claude.md` por compatibilidad sin volverlo fuente de verdad.
- Reducir acoplamientos específicos de herramienta en el núcleo.

### 2. Honestidad de conectores

- Mantener tiers claros (`Local Native`, `Bridge`, futuro `Remote`).
- Alinear copy de UI con capacidades reales por conector.
- Mejorar handoff bridge sin sobreprometer integración.

### 3. Evolución determinista del scoring

- Mejoras conservadoras en expansión léxica e intención.
- Mejoras acotadas en proximidad de grafo.
- Evitar dependencias opacas que rompan portabilidad.

### 4. Loop governance + observabilidad

- Convertir sugerencias de optimización en acciones guiadas y seguras.
- Mejorar explicabilidad del health score.
- Reducir sobrecarga de contexto y memoria estancada.

## Invariantes

- `src/lib/types.ts` debe reflejar `src-tauri/src/core/types.rs`
- Nuevo comando Rust: registrar en:
  - `src-tauri/src/core/mod.rs`
  - `src-tauri/src/commands/mod.rs`
  - `src-tauri/src/lib.rs` (`invoke_handler`)
- Texto UI en español
- Theming vía variables CSS
- Mantener explícito `L0/L1/L2` en documentación y código

## Desarrollo

```bash
npm install
npm run dev
npm run tauri dev
npm run build
```
