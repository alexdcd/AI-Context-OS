---
id: chat-context-pipeline-architecture
type: concept
l0: Estado, fallos resueltos y deuda técnica del pipeline que lleva el contexto del vault al LLM en la app Tauri y en MCP.
importance: 0.9
created: 2026-04-17
modified: 2026-04-17
version: 1
---

# Pipeline de contexto del chat — estado, lecciones y refactor

<!-- L1 -->

Este documento captura el pipeline completo que lleva un mensaje del usuario desde el `ChatPanel` hasta el LLM con contexto del vault inyectado, cómo se conecta (o no) con el path de MCP, qué se rompió durante el debug de abril 2026, qué se arregló y qué deuda técnica quedó para limpiar en el siguiente ciclo. Leer antes de tocar `chat_completion`, `build_chat_context`, `execute_context_query` o el `ChatPanel`.

<!-- L2 -->

## 1. Estado actual (post-fix 2026-04-17)

### 1.1 Paths que existen hoy

Hay **tres consumidores** del motor de scoring (`execute_context_query`) y **dos ensambladores** distintos del prompt:

| Consumidor | Handler | Ensamblador | Observabilidad |
|---|---|---|---|
| Chat UI (Tauri) — pre-assembly (legacy) | `commands::scoring::build_chat_context` | `core::engine::assemble_chat_context_package` | ❌ No loguea |
| Chat UI (Tauri) — inferencia | `commands::inbox::chat_completion` | *fallback* al mismo `assemble_chat_context_package` si el request llega sin `context_prompt` | ❌ No loguea |
| MCP externo (Cursor/Claude Code) | `core::mcp::AiContextMcpServer::get_context` | Formato propio (texto semiestructurado para el LLM del cliente) | ✅ `observability.log_context_request` |
| Vista de simulación (UI) | `commands::scoring::simulate_context` | Ninguno — devuelve `ScoredMemory[]` crudo | ❌ No loguea |

Motor compartido: `core::engine::execute_context_query(root, query, budget, config) -> ContextResult`. Devuelve `loaded`, `unloaded`, `held`, `total_memories`, `tokens_used`, `scored_memories`.

Ensamblaje para la app: `core::engine::assemble_chat_context_package(&ContextResult) -> String`. El output es el bloque que se inyecta como **primer `user` turn** en la conversación (tanto en OpenAI-compatible como en Anthropic).

### 1.2 Flujo actual del chat

```
ChatPanel.handleSend(text)
  │
  ├─ invoke buildChatContext(text, 2000)              // pre-assembly en FE
  │    └─► Rust build_chat_context
  │          └─► execute_context_query + assemble_chat_context_package
  │
  └─ invoke chatCompletion({ messages, system_prompt, context_prompt, model })
       └─► Rust chat_completion
             ├─ si context_prompt vacío → execute_context_query + assemble_chat_context_package   ← NUEVO (fallback)
             ├─ build_openai_messages / build_anthropic_messages (inyectan context_prompt)
             └─► provider_chat_completion → HTTP al proveedor
```

El *fallback* del backend es defensa en profundidad: se añadió el 2026-04-17 después de que el WebView de Tauri dev se quedara sirviendo código viejo y nunca llamara a `buildChatContext` desde el FE. Con el fallback, incluso si el FE se olvida o envía mal, el LLM siempre recibe contexto.

### 1.3 Formato del prompt inyectado

Ambos builders (`build_openai_messages`, `build_anthropic_messages`) prependen el `context_prompt` como un mensaje de rol `user` antes de la historia. El `system_prompt` va aparte (en `system` para OpenAI, en `system` top-level para Anthropic). Esta decisión es consciente: Ollama/gemma a veces ignora mensajes `system` largos, y meter el contexto como `user` mejora la adherencia. Documentado en los tests de `build_openai_messages` / `build_anthropic_messages` en `commands/inbox.rs`.

## 2. Qué se rompió (crónica del bug)

Cuando el usuario preguntaba "dame cualquier dato de mi bóveda", el modelo local respondía "no hay contexto". Cinco bugs acumulados, descubiertos por capas:

### Bug 1 — `anthropic_chat` ignoraba `context_prompt`
El builder de OpenAI sí lo inyectaba, el de Anthropic no. Efecto: proveedores Anthropic nunca vieron contexto del vault desde que se añadió el campo. Fix: extraído `build_anthropic_messages` análogo al de OpenAI, con tests que validan que el primer mensaje es el contexto.

### Bug 2 — `env_logger` nunca se inicializaba
La crate `log` estaba enganchada en todo el código (`log::info!`, `log::warn!`), pero `lib.rs::run()` no llamaba a ningún `init`. Todos los logs se descartaban silenciosamente. Este bug escondía los otros cuatro. Fix: `env_logger::Builder::from_env(...).default_filter_or("info").try_init()` al principio de `run()`. Override con `RUST_LOG=ai_context_os=debug`.

### Bug 3 — Parser de frontmatter demasiado estricto
`scan_memories` llamaba a `parse_frontmatter` y descartaba cualquier memoria cuyo `type` o `status` no coincidiera exactamente con las variantes conocidas del enum. El vault real tenía `type: context|skill|project|rule|resource|daily|intelligence` y `status: normalized|promoted|discarded` — todos ellos valores emitidos por la UI pero desconocidos por el parser. Efecto: 23 de 25 memorias se caían del índice en silencio y nunca entraban al scoring.

Fix en `core/types.rs`:
```rust
pub enum MemoryOntology { Source, Entity, Concept, Synthesis, #[serde(other)] Unknown }
pub enum MemoryStatus   { Unprocessed, Processed, #[serde(other)] Unknown }
```
Y todos los campos downstream con `#[serde(default)]` más `default_ontology()` para que las memorias parseen aunque les falten campos. Regla: **nunca rechazar una memoria entera por un campo individual desconocido o ausente.**

Bug 3 también motivó añadir el warning en `core/index.rs` cuando una memoria *tiene* frontmatter pero no parsea — así el silencio histórico se rompe.

### Bug 4 — WebView servía bundle viejo
Con env_logger activo y el resto arreglado, el backend logueaba `context_prompt_len=0` turno tras turno. Tras múltiples HMR de Vite sobre `ChatPanel.tsx`, la `handleSend` memoizada en `useCallback` o el cache del WebView de Tauri seguía ejecutando el código antiguo (el gate de `useVaultContext` cuando estaba OFF). `Cmd+R` no forzaba un reload completo. Nunca llegamos a diagnosticar la causa exacta — HMR de React con `useCallback` y/o el cache del WebView.

### Bug 5 — Camino sin red de seguridad
El FE era el único responsable de ensamblar el contexto. Si el FE fallaba (Bug 4) o el toggle estaba OFF, el LLM respondía sin contexto sin ninguna señal. Fix: fallback en `chat_completion` que re-ejecuta el motor si llega `context_prompt` vacío.

## 3. Deuda técnica que dejó el fix

El fallback del backend funciona pero deja pendientes:

1. **Doble camino** — FE puede pre-ensamblar vía `build_chat_context`, o BE lo hace solo. Dos implementaciones válidas, contrato ambiguo. Un lector nuevo no sabe cuál es la canónica.

2. **Toggle mudo** — `useVaultContext` en el `ChatPanel` ya no tiene efecto. El usuario no puede forzar "responde sin vault" aunque apague la casilla.

3. **Budget inconsistente** — FE hardcodea `DEFAULT_TOKEN_BUDGET = 2_000`; BE usa `config.default_token_budget` (4_000 por defecto). Dos queries idénticas pueden devolver paquetes distintos según quién ensamble.

4. **`chat_completion` hace dos cosas** — Orquesta contexto + proxy al LLM. Viola SRP. Complica añadir streaming, citation stripping, post-processing.

5. **Observabilidad asimétrica** — MCP loguea cada `get_context` con query, budget, memorias cargadas y tokens. El path de chat no loguea nada estructurado. El dashboard de observabilidad solo ve MCP.

6. **Diagnóstico residual en `ChatPanel.tsx`** — `console.log("[chat] send start …")`, `console.log("[chat] buildChatContext OK …")`, comentario TEMP DIAGNOSTIC. Limpiar cuando se confirme estable.

7. **Causa raíz del Bug 4 no diagnosticada** — HMR stale en WebView. Podría volver a morder a cualquier otro componente.

## 4. Solución correcta (arquitectura objetivo)

### 4.1 Principio

Un solo camino canónico para "inferir con contexto del vault". El motor de scoring y ensamblaje son compartidos. Los comandos son finos y componibles.

### 4.2 Diseño propuesto (Option C — orquestador dedicado)

```
ChatPanel.handleSend(text)
  └─ invoke chatWithContext({
       messages,
       system_prompt,
       include_vault_context: useVaultContext,
       token_budget: null,   // opcional; null ⇒ config.default_token_budget
       model: null
     })
       └─► Rust chat_with_context (NUEVO — orquestador)
             ├─ si include_vault_context:
             │     execute_context_query + assemble_chat_context_package
             │     log_context_request(origin="chat")
             ├─ chat_completion(request con context_prompt ya inyectado)  ← queda puro
             └─ devuelve { text, memory_ids, tokens_used }
```

Cambios concretos:

- **Nuevo comando** `commands::chat::chat_with_context` que orquesta. Vive en su propio módulo `commands/chat.rs` (hoy no existe; la lógica está dispersa en `inbox.rs`).
- **`chat_completion` vuelve a ser puro** — solo proxy al proveedor. Elimina el fallback. Tests de builders se mantienen.
- **`ChatCompletionRequest` pierde `context_prompt`** del contrato público FE; pasa a ser interno al orquestador. O se mantiene y se documenta como "avanzado / para tests".
- **`build_chat_context` se conserva** como herramienta de preview/debug (útil para la vista de simulación y la UI de connectors). Nunca es el path de producción del chat.
- **FE unifica**: `ChatPanel` llama solo a `chatWithContext`. Se borra `buildChatContext` del flujo de chat. El toggle `useVaultContext` se mapea directamente a `include_vault_context`.
- **Budget canónico en backend** — FE solo puede *pedir* uno; si no pasa, el BE usa `config.default_token_budget`. Se elimina el `2_000` del FE.
- **Observabilidad igualada** — el orquestador llama a `observability.log_context_request` con `origin="chat"` exactamente como MCP hace con `origin="mcp"`. Así el dashboard ve todos los accesos al contexto.

### 4.3 Contrato público propuesto

```rust
// commands/chat.rs
#[derive(Deserialize)]
pub struct ChatWithContextRequest {
    pub messages: Vec<ChatMessage>,
    pub system_prompt: Option<String>,
    pub include_vault_context: bool,
    pub token_budget: Option<u32>,
    pub model: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Serialize)]
pub struct ChatWithContextResponse {
    pub text: String,
    pub memory_ids: Vec<String>,   // lo que el LLM vio
    pub tokens_used: u32,
    pub context_request_id: Option<i64>, // referencia al log de observabilidad
}

#[tauri::command]
pub async fn chat_with_context(
    request: ChatWithContextRequest,
    state: State<'_, AppState>,
) -> Result<ChatWithContextResponse, String>;
```

### 4.4 Impacto en MCP

**Cero**. MCP tiene su propio flujo (`AiContextMcpServer::get_context`) que:
- Comparte motor (`execute_context_query`).
- Tiene su propio formato de respuesta (no usa `assemble_chat_context_package` — cada cliente MCP mete el texto en su LLM como quiere).
- Ya loguea a observabilidad.

El refactor propuesto ni toca `core::mcp` ni `core::mcp_http`. Lo único que gana MCP es que el dashboard va a ver también los accesos de chat (por fin paridad).

## 5. Plan de refactor por pasos

Orden pensado para que cada paso sea mergeable solo, con tests, sin romper nada.

1. **Limpiar diagnóstico de `ChatPanel.tsx`** — eliminar `console.log`s y el comentario TEMP DIAGNOSTIC; restaurar el gate `if (useVaultContext)` alrededor de la llamada a `buildChatContext` aunque el BE tenga fallback. Verificar que la app sigue respondiendo con contexto.

2. **Añadir `include_vault_context: bool` al `ChatCompletionRequest` y respetarlo en el fallback del BE.** Esto restaura el toggle sin cambiar la forma del API. Defecto `true` para compatibilidad.

3. **Añadir logging de observabilidad al fallback del BE (`origin="chat"`).** Un solo `log_context_request` + loops de `log_memory_served`/`log_memory_not_loaded`. Copia casi literal del de MCP.

4. **Extraer `commands/chat.rs` con `chat_with_context`** que llama al motor y luego a `provider_chat_completion`. Registrar en `lib.rs::invoke_handler`. FE sigue funcionando con `chat_completion` en paralelo.

5. **Migrar `ChatPanel` a `chat_with_context`**, eliminar la llamada a `buildChatContext` del flujo de chat. Borrar `DEFAULT_TOKEN_BUDGET` del FE.

6. **Eliminar el fallback de `chat_completion`** y restaurarlo como proxy puro del proveedor. Actualizar docs de la función.

7. **Mantener `build_chat_context` pero documentarlo** como "solo para preview/simulation/debug. No usar desde chat."

8. **Diagnóstico diferido del Bug 4 (HMR/WebView)** — reproducir en un entorno controlado. Posibles culpables: `useCallback` con deps estables + React Fast Refresh, o cache del webview de Tauri. Puede requerir `vite --force` o `tauri-build --no-cache`.

## 6. Lecciones operativas (para no repetirlas)

- **Nunca confiar en que los logs llegan** hasta verificar que el logger está inicializado. `log::info!` sin `env_logger::init` es un `noop`. En cualquier crate binario Rust, primera comprobación ante silencio de logs.
- **Parsers tolerantes en los bordes, estrictos en el núcleo.** `#[serde(other)]` en enums expuestos a contenido de usuario. `#[serde(default)]` en campos opcionales. Validar semántica en capas superiores, no en la deserialización.
- **Motor compartido, salidas específicas.** `execute_context_query` sirve a tres consumidores distintos; cada uno formatea su salida. No intentar unificar el ensamblaje si las necesidades difieren.
- **Defensa en profundidad vs doble implementación.** Un fallback está bien si está documentado y es inerte cuando el path principal funciona. Dos caminos simétricos son un bug futuro esperando.
- **HMR no es un deploy.** Para bugs de runtime en Tauri, reiniciar el binario antes de asumir que el código nuevo corre.
- **Observabilidad al lado de los efectos laterales.** El path que toca el LLM y el vault es el que hay que loguear, no el motor puro.

## 7. Referencias cruzadas

- Motor: `src-tauri/src/core/engine.rs` — `execute_context_query`, `assemble_chat_context_package`.
- Scoring: `src-tauri/src/core/scoring.rs`.
- Frontmatter tolerante: `src-tauri/src/core/types.rs` (`MemoryOntology`, `MemoryStatus`, `MemoryMeta`).
- Scan con warnings: `src-tauri/src/core/index.rs`.
- Logger init: `src-tauri/src/lib.rs::run`.
- Path de chat actual: `src-tauri/src/commands/inbox.rs::chat_completion` + `build_openai_messages` + `build_anthropic_messages`.
- Path de preview: `src-tauri/src/commands/scoring.rs::build_chat_context`.
- Path de MCP: `src-tauri/src/core/mcp.rs::AiContextMcpServer::get_context`.
- Integración test: `src-tauri/tests/diagnose_vault_query.rs`.
- FE chat: `src/components/chat/ChatPanel.tsx`, `src/lib/tauri.ts` (`buildChatContext`, `chatCompletion`).
