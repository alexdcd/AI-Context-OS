# Plan implementacion separacion L1/L2 sin MCP

## 1. Problema a resolver

El sistema actual ya soporta carga progresiva real cuando el agente entra por MCP:

- el backend parsea la memoria canónica
- separa `L1` y `L2`
- entrega sólo el nivel necesario según score y presupuesto

Pero en modo estático sin MCP sigue existiendo un hueco importante:

- cada memoria canónica sigue siendo un único `.md`
- si una IA abre ese archivo directamente, puede leerlo entero
- por tanto, `<!-- L1 -->` y `<!-- L2 -->` funcionan como convención semántica, no como frontera real de lectura

El problema de producto original de este branch no era discovery. Ese punto ya se ha mejorado con el router manifest, el índice `L0` compacto y las rutas relativas dentro de `claude.md`.

El problema pendiente es otro:

- en modo sin MCP todavía no existe un primer artefacto de lectura que limite de verdad el acceso a `L2`

## 2. Qué no hay que romper

Este plan debe ser compatible con el estado actual del sistema y no debe deshacer los cambios recientes.

Hay varias invariantes que deben mantenerse:

1. El canónico sigue siendo una única fuente de verdad editable.
2. El router sigue basado en `RouterManifest`, no en un bloque monolítico.
3. `claude.md` sigue siendo autosuficiente para discovery sin MCP.
4. `.ai/catalog.md` y `.ai/index.yaml` siguen siendo capas suplementarias.
5. No se reintroduce `always_load`.
6. No se convierten artefactos derivados en nuevas memorias escaneables.
7. No se vuelve a tratar Markdown arbitrario del repo como memoria canónica.

## 3. Principio de diseño recomendado

La solución más compatible con el sistema actual es separar:

- **fuente de verdad**
- **artefactos de consumo estático**

Eso significa:

- la memoria canónica sigue siendo el `.md` original con frontmatter + `L1/L2`
- el modo sin MCP deja de abrir el canónico como primera parada
- el sistema genera vistas derivadas diseñadas específicamente para lectura progresiva

En otras palabras:

- **el canónico se edita**
- **las vistas derivadas se leen**

Como sugerencia de diseño, conviene estudiar si el modo estático sin MCP debería inspirarse parcialmente en el estándar de uso de skills.

La idea no es imponerlo todavía como requisito, sino evaluarlo porque puede mejorar:

- la navegación de agentes
- la comprensión del field system
- la recuperación de memorias adecuadas

La intuición es que muchas IAs ya están entrenadas para comportarse razonablemente bien con artefactos tipo skill. Si parte de esa gramática se reaprovecha en las vistas estáticas, el comportamiento sin MCP podría mejorar.

## 4. Propuesta recomendada

### 4.1 Mantener el canónico intacto

Cada memoria sigue existiendo como hoy:

- un único archivo Markdown
- YAML frontmatter
- `<!-- L1 -->`
- `<!-- L2 -->`

Ese archivo sigue siendo:

- la fuente de verdad para UI y backend
- la entrada para scoring, governance y grafo
- la base de `get_context`
- el único sitio donde se debe editar el contenido

### 4.2 Generar dos vistas derivadas por memoria

A partir del canónico, el sistema genera dos artefactos estáticos por memoria:

1. **vista resumida**
   - pensada como primer punto de entrada sin MCP
   - contiene `L0` + `L1`
   - incluye metadata mínima útil
   - apunta claramente a la vista de detalle

2. **vista de detalle**
   - contiene el detalle adicional de `L2`
   - puede incluir una referencia clara a la vista resumida/canónica
   - se abre sólo cuando el resumen no basta

La idea clave es que el primer archivo visible para la IA sin MCP ya no contenga `L2`.

## 5. Forma de entrega recomendada

### 5.1 Ubicación

La ubicación más coherente con el sistema actual es bajo `.ai/`, como artefactos generados. Ejemplos razonables:

- `.ai/views/`
- `.ai/cards/`
- `.ai/static/`

La recomendación actual es:

- usar `.ai/views/`

Motivo:

- deja claro que son vistas derivadas
- no compite semánticamente con `rules`, `skills`, `journal`, `tasks` o `scratch`
- encaja con la lógica actual de artefactos generados

### 5.2 Estructura recomendada

La opción más limpia es una carpeta por memoria:

- `.ai/views/<memory-id>/entry.md`
- `.ai/views/<memory-id>/detail.md`

Ventajas:

- evita nombres demasiado largos o ambiguos
- permite añadir artefactos futuros por memoria sin romper naming
- hace más legible el modelo de navegación

### 5.3 Contenido recomendado

#### `entry.md`

Debe contener sólo lo necesario para el primer salto:

- `id`
- `type` / ontología
- `l0`
- path al canónico
- path a `detail.md`
- `L1`

No debería llevar:

- tags extensas
- relaciones largas
- provenance completo
- metadata operacional pesada

Como sugerencia a evaluar, `entry.md` podría incluir una capa ligera de orientación inspirada en el patrón de skills, por ejemplo:

- qué representa esta memoria
- cuándo conviene abrir `L2`
- qué otras memorias podrían ser el siguiente salto lógico

Esto no debería imponerse si acaba inflando demasiado el payload estático, pero merece revisarse en prototipo.

#### `detail.md`

Debe estar optimizado para expansión deliberada. Dos variantes son posibles:

1. **Sólo `L2`**
2. **`L1 + L2` autoportante**

La recomendación actual es:

- usar **`L1 + L2` autoportante**

Razón:

- si una IA o humano abre `detail.md` directamente, no pierde el contexto del resumen
- se reduce dependencia del salto anterior
- mejora robustez en conectores bridge o entornos menos controlados

## 5.4 Sugerencia: patrón de navegación inspirado en skills

Como línea de exploración, puede ser útil que la separación `L1/L2` no se diseñe sólo como “primer archivo” y “segundo archivo”, sino como un patrón de navegación más cercano al que las IAs ya usan con skills.

Eso no significa convertir todas las memorias en skills.

Significa evaluar si algunas propiedades del estándar mental de las skills pueden ayudar también a la recuperación estática:

- encabezado muy explícito
- propósito del archivo
- criterio de uso
- criterio de escalado a `L2`
- relaciones o dependencias mínimas
- formato estable y repetible

De momento esto debe tratarse como sugerencia fuerte de diseño, no como obligación cerrada.

## 6. Cambios necesarios en el manifest y router

El manifest actual ya resuelve discovery y clasificación. No hay que reemplazarlo, sino ampliarlo.

### 6.1 Extensión recomendada de `RouterMemoryEntry`

Añadir campos diferenciados:

- `canonical_path`
- `static_entry_path`
- `static_detail_path`

La semántica sería:

- `canonical_path`: fuente editable y canónica
- `static_entry_path`: primera ruta que debe usar el modo sin MCP
- `static_detail_path`: expansión cuando hace falta más detalle

### 6.2 Comportamiento del router estático

El router estático (`claude.md`, `.cursorrules`, `.windsurfrules`) debe:

- seguir mostrando el índice `L0`
- mantener la utilidad inmediata para discovery
- apuntar en primer lugar a `static_entry_path`
- no apuntar por defecto al canónico cuando la intención sea lectura incremental

### 6.3 Comportamiento del catálogo e índice

`.ai/catalog.md` y `.ai/index.yaml` deberían incluir ambos planos:

- ruta canónica
- ruta de entrada estática
- ruta de detalle estática

Eso permite:

- claridad para humanos
- integraciones más estables
- trazabilidad entre fuente de verdad y vistas derivadas

## 7. Contrato de sistema para las vistas derivadas

Estas vistas no deben entrar en la ontología de “memoria”.

Deben declararse explícitamente como:

- artefactos generados
- no canónicos
- no editables manualmente como fuente de verdad

Eso implica:

1. no deben ser escaneadas por `scan_memories`
2. no deben exponerse como memorias normales en UI
3. deben regenerarse automáticamente cuando cambie el canónico
4. deben protegerse como artefactos del sistema

## 8. Triggers de regeneración

Las vistas derivadas deben regenerarse cuando ocurra cualquiera de estos eventos:

- crear memoria
- editar memoria
- renombrar archivo de memoria
- mover memoria
- borrar memoria
- regenerar router globalmente
- inicializar workspace

En términos prácticos, deben engancharse al mismo flujo de regeneración de artefactos que ya produce:

- `claude.md`
- `.cursorrules`
- `.windsurfrules`
- `.ai/catalog.md`
- `.ai/index.yaml`

## 9. Protección y gobernanza

Las vistas derivadas deben tratarse igual que otros artefactos del sistema.

Eso implica bloquear:

- escritura raw directa
- rename directo
- delete directo

al mismo nivel que hoy se protege:

- `claude.md`
- `.cursorrules`
- `.windsurfrules`
- `.ai/catalog.md`
- `.ai/index.yaml`

## 10. Flujo UX objetivo sin MCP

El flujo deseado debe ser corto y muy explícito:

1. la IA lee `claude.md`
2. ve `L0` + ruta de `entry.md`
3. abre `entry.md`
4. obtiene `L1` sin exponerse a `L2`
5. sólo si necesita más detalle, abre `detail.md`

Este flujo resuelve el problema real:

- no exige demasiados saltos
- no rompe el bootstrap actual
- sí crea una barrera física de lectura mejor que la convención actual

## 11. Impacto por tipo de conector

### Native MCP

No cambia el flujo principal.

Sigue siendo preferible:

- `get_context`
- `get_skill`
- `save_memory`

Las vistas derivadas son principalmente fallback y soporte documental.

### Remote MCP

Cuando MCP está disponible:

- se mantiene el flujo actual

Cuando no lo está o el agente cae al modo estático:

- debe consumir `entry.md` como primera ruta

### Bridge

Aquí el beneficio es más claro.

Los bridges no tienen control fino de carga. Por tanto:

- snapshots
- handoffs
- navegación estática

se benefician directamente de tener una vista `L1` separada del detalle.

## 12. Fases recomendadas de implementación

### Fase 1 — Contrato y estructura

Definir:

- ubicación final (`.ai/views/`)
- naming (`entry.md`, `detail.md`)
- campos nuevos del manifest
- formato exacto de las vistas

No tocar todavía UX ni copy.

### Fase 2 — Generación de vistas

Implementar el compilador de vistas derivadas desde el canónico.

Debe:

- leer memoria canónica
- construir `entry.md`
- construir `detail.md`
- escribirlas como artefactos generados

### Fase 3 — Integración con router y catálogo

Actualizar:

- `RouterMemoryEntry`
- `render_static_router(...)`
- `render_catalog_markdown(...)`
- `generate_index_yaml(...)`

para que publiquen las rutas estáticas y la relación con el canónico.

### Fase 4 — Protección y exclusión del escáner

Asegurar que:

- el escáner no trate estas vistas como memorias
- filesystem las trate como artefactos protegidos
- explorer no las exponga como contenido editable ordinario

### Fase 5 — UX y documentación

Actualizar:

- copy del router estático
- documentación de arquitectura
- documentación de conectores
- onboarding o mensajes de ayuda si aplica

## 13. Riesgos a vigilar

### Riesgo 1 — duplicación confusa

Si no se diferencia bien entre canónico y vista, el usuario puede creer que ambos son editables.

Mitigación:

- naming explícito
- ubicación bajo `.ai/`
- protección dura
- copy claro en los archivos derivados

### Riesgo 2 — inflación de artefactos

Dos archivos por memoria aumentan el volumen del workspace generado.

Mitigación:

- mantener formato mínimo
- no añadir metadata rica innecesaria
- tratarlo como capa de consumo, no de archivo maestro

### Riesgo 3 — volver a mezclar responsabilidades

Si el router vuelve a intentar contener demasiado, se repite el problema del diseño monolítico.

Mitigación:

- el router sólo descubre
- `entry.md` resume
- `detail.md` expande
- catálogo/index documentan

### Riesgo 4 — sobreprometer enforcement

Aunque esta solución mejora mucho el no-MCP, una IA aún podría abrir el canónico si lo ve.

Mitigación:

- documentar honestamente que se mejora el camino principal
- no prometer coerción absoluta

## 14. Decisiones pendientes

Antes de ejecutar conviene cerrar estas decisiones:

1. si `detail.md` será `L2` puro o `L1+L2`
2. si el router muestra sólo `entry.md` o también referencia el canónico
3. si las vistas deben aparecer o no en el explorer
4. si bridges deben usar estas vistas también para handoff/snapshot

La recomendación actual es:

- `detail.md` autoportante con `L1+L2`
- router mostrando principalmente `entry.md`
- vistas visibles pero protegidas, no editables
- bridges usando estas vistas como fallback por defecto

## 15. Resultado esperado

Si se implementa este plan:

- MCP seguirá siendo el camino óptimo
- el canónico seguirá siendo simple y estable
- el router actual mantendrá discovery sin romperse
- el modo estático sin MCP ganará una separación real de lectura
- el primer archivo abierto por una IA ya no arrastrará `L2`

Ésta es la evolución más compatible con los cambios recientes y la mejor continuación del problema original que inició este branch.

## 16. Spec técnica de implementación sugerida

Esta sección no cambia el roadmap. Sólo aterriza la implementación con un nivel de detalle suficiente para que una IA pueda desarrollar la primera versión sin inventar demasiado.

### 16.1 Objetivo de la primera iteración

La primera iteración debe entregar lo siguiente:

- generación automática de vistas derivadas por memoria
- publicación de sus rutas en el router estático y en el índice rico
- protección de esas vistas como artefactos del sistema
- exclusión explícita del escaneo de memorias

No debe intentar en esta iteración:

- cambiar el formato canónico
- rehacer la UI de edición
- introducir un nuevo tipo de memoria
- rediseñar el engine MCP

### 16.2 Paths y naming concretos

Recomendación de contrato estable:

- `.ai/views/<memory-id>/entry.md`
- `.ai/views/<memory-id>/detail.md`

Contrato:

- `entry.md` = artefacto principal de lectura estática
- `detail.md` = expansión de detalle
- el canónico mantiene su path actual y no se mueve

### 16.3 Estructura mínima sugerida de `entry.md`

Formato recomendado:

```md
# [<id>] <l0>

- canonical_path: `<path-canónico-relativo>`
- detail_path: `.ai/views/<id>/detail.md`
- ontology: `<ontology>`

## L1

<l1_content>
```

Objetivo:

- que una IA pueda leer `L1` inmediatamente
- que vea el path canónico sin usarlo como primer salto
- que tenga un enlace explícito a la expansión

### 16.4 Estructura mínima sugerida de `detail.md`

Formato recomendado:

```md
# [<id>] Detailed View

- canonical_path: `<path-canónico-relativo>`
- entry_path: `.ai/views/<id>/entry.md`
- ontology: `<ontology>`

## L1

<l1_content>

## L2

<l2_content>
```

Se recomienda mantener `L1 + L2` aquí para que el archivo sea autoportante.

### 16.4 bis Sugerencia: influencia del estándar de skills

Además de revisar la compatibilidad con las skills reales, conviene valorar si el estándar de skills puede influir en la forma de diseñar todas las vistas estáticas.

Esto debe entenderse como sugerencia, no como requisito definitivo.

Pregunta de diseño recomendada:

- ¿qué partes de la gramática de skills ayudan a una IA a decidir mejor qué leer, cuándo abrirlo y cuándo escalar a más detalle?

Si la respuesta es positiva, una primera adaptación ligera podría reutilizar en `L1` elementos como:

- encabezado estable
- propósito explícito
- criterio de uso
- criterio de escalado a `L2`

Pero sólo si eso demuestra ser compatible con:

- el payload estático actual
- el router manifest
- la simplicidad del canónico
- el comportamiento real de los agentes en este sistema

### 16.5 Módulo backend sugerido

La implementación queda más limpia si se introduce un módulo nuevo, por ejemplo:

- `src-tauri/src/core/static_views.rs`

Responsabilidades de ese módulo:

- construir paths derivados a partir de `memory_id`
- renderizar `entry.md`
- renderizar `detail.md`
- escribir los artefactos
- borrar vistas derivadas cuando una memoria desaparezca o cambie de `id`

API sugerida:

- `build_static_view_paths(root: &Path, memory_id: &str) -> StaticViewPaths`
- `render_entry_view(memory: &Memory, root: &Path) -> String`
- `render_detail_view(memory: &Memory, root: &Path) -> String`
- `write_static_views(root: &Path, memory: &Memory) -> Result<(), String>`
- `remove_static_views(root: &Path, memory_id: &str) -> Result<(), String>`

Struct sugerida:

- `StaticViewPaths { dir, entry_md, detail_md }`

### 16.6 Cambios concretos en el manifest

Ampliar `RouterMemoryEntry` en `src-tauri/src/core/router.rs` con:

- `canonical_path: String`
- `static_entry_path: String`
- `static_detail_path: String`

Regla de compatibilidad:

- `path` puede mantenerse temporalmente por retrocompatibilidad
- pero su semántica debe quedar clara
- si se conserva, debería representar la ruta recomendada de lectura en estático

La opción más limpia a medio plazo sería:

- dejar `canonical_path` explícito
- usar `static_entry_path` como ruta principal mostrada en el router

### 16.7 Cambios concretos en renderizados

#### `render_static_router(...)`

Debe cambiar para que cada entrada publique:

- `id`
- `l0`
- `static_entry_path`
- ontología

Opcionalmente, en una segunda línea:

- referencia breve a `detail.md`

#### `render_catalog_markdown(...)`

Debe añadir por memoria:

- canonical path
- entry view path
- detail view path

#### `generate_index_yaml(...)`

Debe serializar los tres paths para que integraciones o tooling sepan:

- qué se edita
- qué se lee primero
- qué se abre para detalle

### 16.8 Dónde enganchar la regeneración

La regeneración debe ocurrir dentro del mismo flujo que ya genera artefactos de router.

Puntos de integración más probables:

- `src-tauri/src/commands/router.rs`
- `src-tauri/src/commands/config.rs`
- `src-tauri/src/cli.rs`
- flujos de memoria en `src-tauri/src/commands/memory.rs`
- flujo MCP de `save_memory` en `src-tauri/src/core/mcp.rs`

Regla operativa:

- cualquier operación que hoy regenere `claude.md` debe regenerar también `.ai/views/`

### 16.9 Cambios en exclusión y protección

#### Escáner

Actualizar `src-tauri/src/core/index.rs` o la lógica de paths asociada para que ignore:

- `.ai/views/`

Esto debe ser explícito y no depender sólo de que los archivos no tengan frontmatter válido.

#### Filesystem protection

Actualizar `src-tauri/src/commands/filesystem.rs` para tratar como artefacto protegido:

- `.ai/views/`

o, si se prefiere granularidad por archivo:

- cualquier path descendiente de `.ai/views/`

#### Explorer

Actualizar el explorer para una de estas dos políticas:

1. ocultar `.ai/views/`
2. mostrarlo como sistema/protegido/no editable

La recomendación actual es la segunda, por consistencia con otros artefactos generados visibles.
### 16.10 Compatibilidad con las especificaciones de skills

Este punto debe revisarse explícitamente antes de implementar la feature completa.

Motivo:

- las skills no son memorias normales desde el punto de vista operativo
- el sistema ya les da un papel especial mediante `system_role = skill`
- su contrato actual incluye campos específicos como `triggers`, `requires`, `optional` y `output_format`
- el router estático y el catálogo ya exponen parte de esa semántica

Por tanto, la separación estática `L1/L2` no debe diseñarse como si todas las memorias fueran equivalentes.

#### Regla de diseño

Antes de cerrar la implementación hay que revisar cómo se comportan las skills en este nuevo modelo y decidir una de estas dos opciones:

1. **las skills usan la misma separación `l1.md` / `l2.md` que el resto**
2. **las skills mantienen una vista estática específica distinta del resto**

La decisión no debe dejarse implícita.

#### Riesgo concreto si no se revisa

Si la IA abre una vista `L1` de una skill y esa vista ha perdido parte del contrato operativo, puede ocurrir que:

- no vea triggers relevantes
- no vea dependencias `requires` u `optional`
- no entienda el `output_format`
- ejecute la skill como si fuera una memoria informativa y no una instrucción operativa

Eso empeoraría el comportamiento sin MCP precisamente en uno de los tipos de memoria más sensibles.

#### Recomendación actual

En la primera implementación, al menos para skills, la vista estática de primer nivel debe preservar un bloque mínimo de contrato operativo:

- `system_role: skill`
- `triggers`
- `requires`
- `optional`
- `output_format`

Ese bloque debe aparecer aunque el resto de memorias usen una vista `L1` muy minimalista.

#### Nota para implementadores

Antes de escribir código conviene revisar estos puntos del sistema actual:

- `MemoryMeta` en `src-tauri/src/core/types.rs`
- `RouterMemoryEntry` y renderizados en `src-tauri/src/core/router.rs`
- documentación de arquitectura y contrato canónico en `docs/ARQUITECTURA-ACTUAL-ROUTER-CONTEXTO-Y-MEMORIAS.md`

La implementación final debe preservar no sólo progressive loading, sino también la semántica operativa de las skills en modo estático.

Además, como sugerencia de diseño más amplia, conviene revisar si parte del estándar de skills puede reutilizarse para mejorar toda la recuperación estática sin MCP. Eso debe validarse contra el funcionamiento real del sistema antes de consolidarlo como contrato.

### 16.11 Limpieza y borrado

Hay que evitar residuos cuando cambie el `id` de una memoria o cuando una memoria se elimine.

Comportamiento esperado:

- si se borra una memoria, borrar `.ai/views/<old-id>/`
- si se renombra o cambia `id`, borrar las vistas del `old-id` y generar las del `new-id`
- si hay regeneración global, permitir modo “rebuild” que limpie y regenere todo `.ai/views/`
### 16.12 Criterios mínimos de aceptación

La feature se puede considerar implementada cuando se cumpla todo esto:

1. crear o editar una memoria genera `entry.md` y `detail.md`
2. `claude.md` apunta a `entry.md` en vez de al canónico
3. `.ai/catalog.md` y `.ai/index.yaml` exponen rutas canónica/entry/detail
4. `scan_memories` no trata `.ai/views/` como memorias
5. filesystem impide editar o borrar `.ai/views/` directamente
6. borrar/renombrar memorias limpia vistas obsoletas
7. el modo MCP sigue funcionando igual que antes
Además, si la memoria es una skill:

8. la vista estática inicial no pierde su contrato operativo mínimo
### 16.13 Orden sugerido para una IA implementadora
### 16.12 Orden sugerido para una IA implementadora

Orden recomendado de trabajo:

1. crear `static_views.rs`
2. implementar render de `entry.md` y `detail.md`
3. integrarlo en regeneración de router
4. ampliar `RouterMemoryEntry`
5. actualizar `render_static_router`, catálogo e índice
6. excluir `.ai/views/` del escáner
7. proteger `.ai/views/` en filesystem/explorer
8. validar con regeneración completa y revisión manual de artefactos

Este orden reduce riesgo porque primero crea los artefactos, luego los publica y por último endurece los bordes del sistema.
