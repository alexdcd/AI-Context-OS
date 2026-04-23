# Rediseño de Inbox

> Fecha: 2026-04-24
> Estado: propuesta de producto y arquitectura
> Objetivo: convertir `Inbox` en el centro de clasificación y conexión de conocimiento nuevo dentro de AI Context OS

## 1. Resumen ejecutivo

`Inbox` no debe ser una pantalla para "capturar cosas y luego quizá promoverlas".

Debe ser el sistema de entrada principal del conocimiento nuevo:

- aterriza contenido nuevo
- lo normaliza
- lo clasifica
- propone cómo conectarlo al sistema existente
- deja al usuario aprobar, editar, descartar o automatizar

La recomendación es rediseñarlo como un pipeline gobernado de ingestión con tres principios:

1. `Inbox` clasifica y conecta, no solo almacena temporalmente.
2. La IA propone, pero el sistema explica y gobierna.
3. El motor de ejecución debe reutilizar primero la inferencia local ya integrada en la app, después proveedores externos por API, y solo en una fase posterior conectores tipo Claude Code / MCP.

## 2. Diagnóstico del estado actual

### 2.1 Qué existe hoy

Base técnica ya disponible:

- Captura de texto, links y archivos en `inbox/`.
- Runtime de inferencia configurable en la app con presets locales y externos: Ollama, LM Studio, OpenAI/OpenRouter, Anthropic.
- Proposals heurísticas o por LLM para cada item.
- Promoción a memoria o enrutado a `sources/`.
- Infraestructura de `skills` y `get_skill` vía MCP.
- Scoring, grafo, tags, ontologías y `derived_from`.

### 2.2 Problemas reales del diseño actual

El flujo actual está demasiado plano:

- La UI actual es sobre todo una lista + editor + bloque de proposal, no una experiencia de clasificación guiada.
- Cada item tiene como máximo una proposal pendiente, cuando en realidad debería haber varias recomendaciones comparables.
- La proposal actual casi no conecta el item con memorias existentes.
- La acción `update_memory` existe en el modelo pero no está implementada como operación real de actualización.
- La promoción a memoria usa un destino por defecto basado en "la primera carpeta de usuario disponible", lo que no es una decisión de producto aceptable.
- La heurística actual clasifica demasiado por tipo de captura y demasiado poco por significado.
- No existe una fase explícita de "recomendaciones de skills" ni de "cadena de procesamiento".
- El usuario no ve bien por qué la IA recomienda algo, qué contexto ha usado, qué cambiará exactamente, ni qué confianza tiene cada subdecisión.

### 2.3 Evidencia en código

- La UI actual concentra casi todo en una sola vista manual: [src/views/InboxView.tsx](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/views/InboxView.tsx:46)
- La proposal se genera como una única salida final por item: [src-tauri/src/commands/inbox.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/commands/inbox.rs:1477)
- La heurística decide demasiado por `kind`: [src-tauri/src/commands/inbox.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/commands/inbox.rs:980)
- `update_memory` termina como `Processed` sin modificar memoria canónica: [src-tauri/src/commands/inbox.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/commands/inbox.rs:1722)
- El destino por defecto de promoción es la primera carpeta de usuario encontrada: [src-tauri/src/commands/inbox.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/commands/inbox.rs:1557)
- `Inbox` está correctamente fuera del retrieval canónico hasta promoción, y eso debe mantenerse: [src-tauri/src/core/index.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/index.rs:39)
- Ya existe soporte real para skills y dependencias: [src-tauri/src/core/mcp.rs](/Users/alexdc/Documents/GitHub/AI-Context-OS/src-tauri/src/core/mcp.rs:352)
- Ya existe un runtime de inferencia local/externa reutilizable en Settings: [src/views/SettingsView.tsx](/Users/alexdc/Documents/GitHub/AI-Context-OS/src/views/SettingsView.tsx:521)

## 3. North star de producto

La experiencia objetivo es:

> "Todo contenido nuevo entra por Inbox, la app lo entiende, me enseña cómo encaja con mi sistema, me propone el mejor destino y me deja aprobarlo con confianza."

El usuario debe poder trabajar en tres modos:

- `Modo uno a uno`: revisar cada item con máximo detalle.
- `Modo lote guiado`: revisar una cola de recomendaciones y aprobar rápido.
- `Modo automático gobernado`: auto-aplicar solo acciones seguras y dejar el resto en revisión.

## 4. Principios de diseño

### 4.1 Inbox es una torre de control

No debe ser solo un staging area. Debe ser el lugar donde se decide:

- qué tipo de conocimiento es esto
- si merece canonización
- si actualiza conocimiento previo
- qué skill o pipeline lo procesa mejor
- qué vínculos crea con el sistema

### 4.2 La recomendación debe ser explicable

Cada recomendación debe mostrar:

- acción sugerida
- por qué
- skill o pipeline usado
- backend usado
- nivel de confianza por bloque
- memorias relacionadas detectadas
- diff o borrador resultante

### 4.3 El usuario decide el grado de autonomía

Tres niveles:

- `Manual`: nada se aplica sin revisión.
- `Assist`: la app analiza automáticamente pero espera aprobación.
- `Autopilot safe`: aplica solo duplicados obvios, enrutado a `sources/` de material claramente referencial, y mejoras no destructivas.

### 4.4 La infraestructura actual se reutiliza

Orden de prioridad de ejecución:

1. inferencia local ya integrada en la app
2. proveedor externo por API usando el mismo runtime
3. ejecución remota por MCP / Claude Code como capa posterior

## 5. Propuesta de modelo funcional

## 5.1 Nuevo pipeline

Estado conceptual por item:

1. `captured`
2. `normalized`
3. `enriched`
4. `classified`
5. `recommended`
6. `reviewed`
7. `applied`
8. `discarded`
9. `blocked`

Separar claramente:

- `processing_stage`: dónde está el item en el pipeline
- `decision_state`: pendiente, aceptado, editado, rechazado
- `execution_state`: idle, running, failed, done

El `status` actual mezcla estas capas y conviene reemplazarlo o degradarlo a compatibilidad.

## 5.2 Salidas que debe producir Inbox

Cada item debe generar un `Recommendation Bundle` con:

- `classification`
  - ontology sugerida
  - categoría funcional: source, new_memory, update_memory, synthesis, task, journal, discard
  - carpeta destino sugerida
- `knowledge draft`
  - `l0`
  - `l1`
  - `l2`
  - frontmatter completo sugerido
- `linking`
  - memorias relacionadas sugeridas
  - posibles duplicados
  - memoria candidata a actualizar
- `processing plan`
  - skill o skills sugeridos
  - backend recomendado
  - pasos ejecutados
- `governance`
  - confianza
  - warnings
  - riesgos
  - trazabilidad

## 5.3 Acciones posibles

Las acciones finales recomendadas deben ser:

- `create_source`
- `create_memory`
- `update_existing_memory`
- `create_synthesis`
- `create_task`
- `append_journal`
- `discard`
- `needs_human_review`

`update_existing_memory` pasa a ser un caso de primera clase, no una etiqueta decorativa.

## 6. UX recomendada

## 6.1 Vista principal

Rediseñar `Inbox` como una vista de tres capas:

- `Queue`
  - cola con badges por urgencia, tipo, confianza y acción sugerida
- `Recommendation workspace`
  - panel central con propuesta explicada
- `Impact panel`
  - qué archivos se crearán o modificarán y cómo se conectará al grafo

## 6.2 Flujo uno a uno

Para cada item:

1. preview del contenido
2. resumen de clasificación
3. skills sugeridos
4. memorias relacionadas
5. diff final
6. acciones:
   - aceptar
   - aceptar y editar
   - cambiar skill
   - cambiar destino
   - pedir más análisis
   - descartar

## 6.3 Flujo lote guiado

Vista tipo "triage board":

- `Autorizables ahora`
- `Requieren edición`
- `Bloqueados`
- `Posibles duplicados`

Cada card debe permitir:

- aprobar en un click
- expandir detalle
- mover a revisión manual

## 6.4 Transparencia

No ocultar el razonamiento operativo. Mostrar:

- skill ejecutado
- backend usado
- contexto cargado
- memorias candidatas encontradas
- score de similitud
- reglas de gobernanza disparadas

## 7. Arquitectura recomendada

## 7.1 Inbox Orchestrator

Crear un orquestador nuevo, no mezclar toda la lógica en `commands/inbox.rs`.

Módulos recomendados:

- `inbox_capture`
- `inbox_extraction`
- `inbox_classification`
- `inbox_linking`
- `inbox_recommendations`
- `inbox_governance`
- `inbox_apply`
- `inbox_skills`

## 7.2 Skill-based processing

La vía ideal es usar skills como gramática de procesamiento.

Tipos de skill recomendados para Inbox:

- `extract-text-from-file`
- `classify-reference-vs-knowledge`
- `propose-frontmatter`
- `find-related-memories`
- `propose-memory-update`
- `summarize-article`
- `process-meeting-notes`
- `process-research-note`
- `derive-tags-and-links`

Cada skill debe declarar:

- triggers por mime, source kind o patrón
- input contract
- output schema
- si requiere inferencia
- backend compatible

## 7.3 Backends de ejecución

Definir una interfaz común:

- `LocalInferenceBackend`
- `ApiInferenceBackend`
- `ExternalAgentBackend`

Todos devuelven el mismo envelope estructurado.

La selección por defecto debe ser:

- usar local si está disponible y el skill es compatible
- si no, usar API externa configurada
- si no, caer a heurística determinista

`ExternalAgentBackend` debe quedar como fase 3 o 4, no como dependencia del MVP.

## 7.4 Gobernanza determinista

Antes de aplicar cualquier recomendación:

- validar frontmatter
- validar ontología
- validar carpeta destino
- validar `derived_from`
- comprobar duplicados por hash, URL y similitud
- comprobar si el update afecta memoria protegida
- generar diff revisable

## 8. Cambios de modelo de datos

## 8.1 InboxItem

Añadir campos:

- `processing_stage`
- `decision_state`
- `execution_state`
- `recommended_action`
- `recommended_backend`
- `recommended_skill_ids`
- `related_memory_candidates`
- `duplicate_candidates`
- `target_memory_id`
- `extraction_result`
- `classification_result`
- `governance_warnings`
- `last_run_at`
- `run_history`

## 8.2 Recommendation

Sustituir el concepto actual de proposal única por algo más rico:

- `InboxRecommendation`
- `InboxRecommendationVariant`
- `InboxApplyPreview`

Un item puede tener varias variantes:

- crear memoria nueva
- actualizar memoria existente
- guardar como source

El usuario elige entre variantes, no solo aprobar o rechazar una sola salida.

## 9. Roadmap recomendado

## Fase 1. Fundaciones

- Redefinir modelo de datos de Inbox.
- Separar estado de proceso vs decisión.
- Implementar recommendation bundle estructurado.
- Implementar `update_existing_memory` de verdad.

## Fase 2. Single-item review

- Nueva UI de recomendación explicable.
- Vista de memorias relacionadas.
- Diff previo a aplicar.
- Selección de destino real, no inferida por "primera carpeta".

## Fase 3. Skill engine

- Registro de skills de Inbox.
- Matching item -> skill chain.
- Reutilización del runtime local/API actual.
- Logs de ejecución por skill.

## Fase 4. Batch processing

- Cola por prioridad.
- Aprobación múltiple.
- Reglas de auto-aplicación segura.
- Telemetría y observabilidad específicas de Inbox.

## Fase 5. External agent backends

- Conector MCP / Claude Code.
- Ejecución externa manteniendo el mismo envelope de salida.
- Auditoría de trazabilidad de ejecución.

## 10. Decisiones fuertes recomendadas

### 10.1 Qué haría ya

- Mantener `Inbox` fuera del índice canónico hasta promoción.
- Reutilizar el runtime de inferencia ya presente en Settings.
- Apostar por skills como unidad de procesamiento.
- Hacer de `update_existing_memory` la mejor opción cuando encaje.
- Añadir linking explícito con memorias existentes como parte obligatoria de la recomendación.

### 10.2 Qué no haría ahora

- No meter Claude Code / MCP como camino principal del MVP.
- No auto-promover contenido ambiguo sin revisión.
- No decidir destino de memoria por estructura física accidental del workspace.
- No tratar una sola proposal como suficiente para un flujo complejo de clasificación.

## 11. MVP recomendado

Si hubiera que elegir el mejor MVP posible, sería este:

- análisis automático al entrar un item en Inbox
- recomendación estructurada con:
  - ontology
  - acción
  - `l0`, `l1`, tags
  - memoria relacionada candidata
  - skill sugerido
- revisión uno a uno con diff
- aplicación real de:
  - create source
  - create memory
  - update existing memory
  - discard
- uso prioritario de inferencia local
- fallback a heurística o API externa

Ese MVP ya resolvería el problema central de producto: ayudar al usuario a transformar información nueva en conocimiento conectado y gobernado.

## 12. Conclusión

La mejor dirección no es "arreglar Inbox".

La mejor dirección es convertir `Inbox` en el sistema operativo de ingestión del producto.

Eso implica rediseñar:

- la UX
- el modelo de estados
- el motor de recomendaciones
- el uso de skills
- la integración con inferencia local

La base del repo ya permite hacerlo sin cambiar la filosofía de AI Context OS. Lo que falta no es tanto infraestructura, sino un rediseño deliberado del flujo de producto.
