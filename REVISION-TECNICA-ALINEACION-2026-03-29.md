# Revision Tecnica y Alineacion de Producto

Fecha: 2026-03-29
Proyecto: AI Context OS

## 1. Objetivo de este documento

Este documento revisa el estado actual del producto y del codigo frente a la vision que hemos definido en esta conversacion:

- AI Context OS no debe convertirse en "otro chat"
- el core del producto debe ser un cerebro digital portable para cualquier IA
- la propuesta de valor principal debe ser memoria, contexto, continuidad y ejecucion sobre el workspace del usuario
- las integraciones con herramientas deben reforzar esa capa de cerebro, no sustituirla

El objetivo es responder tres preguntas:

1. En que punto estamos realmente
2. Que partes del producto ya encajan con esa vision
3. Que debemos mejorar para alinear mejor la herramienta

## 2. Resumen ejecutivo

La base tecnica actual esta bastante bien alineada con la tesis de "cerebro/contexto":

- el producto ya esta construido alrededor de archivos, memoria, contexto, scoring y workspace local
- no depende de un chat propio para funcionar
- ya dispone de motor de carga de contexto, router, observabilidad e integracion MCP local

Sin embargo, hay una desalineacion importante entre la vision estrategica y algunas decisiones de producto/UX actuales:

- la interfaz de conexion promete mas compatibilidad de la que realmente existe
- el onboarding menciona herramientas como GPT/ChatGPT o Gemini sin que exista una integracion real equivalente
- el formato canonico del sistema esta demasiado ligado a `claude.md`
- la capa de compatibilidad actual esta pensada mas como "archivos para herramientas concretas" que como un sistema universal de conectores
- falta una abstraccion clara entre "cerebro", "adaptador de herramienta" y "modo de uso"

Conclusion:

AI Context OS ya tiene un buen nucleo de brain layer, pero necesita reorganizar su narrativa, su capa de integracion y varias decisiones tecnicas para consolidarse como "context engine universal" en lugar de parecer una app centrada en Claude con compatibilidades parciales.

## 3. Estado actual del producto

### 3.1 Lo que ya existe y funciona

El producto actual ya tiene estas capacidades principales:

- workspace local con 9 carpetas numeradas y archivos Markdown/YAML como base de datos
- memoria estructurada por tipos: context, daily, intelligence, project, resource, skill, task, rule, scratch
- motor de scoring y carga de contexto con niveles L0/L1/L2
- router generado automaticamente
- observabilidad de peticiones de contexto y memorias servidas
- MCP server local por stdio y HTTP
- compatibilidad basica con Claude, Cursor y Windsurf
- journal, tasks, graph, governance y simulation

Arquitectonicamente, la aplicacion ya se parece mas a un sistema operativo de contexto que a una app de chat.

### 3.2 Evidencias en el codigo

Los puntos mas importantes observados en esta revision:

- `src-tauri/src/core/types.rs`
  Define el modelo de memoria, tipos, niveles de carga, score y configuracion.

- `src-tauri/src/core/engine.rs`
  Implementa el motor de contexto: scoring, seleccion por presupuesto de tokens y ensamblado del paquete de contexto.

- `src-tauri/src/core/scoring.rs`
  Implementa el score hibrido actual.

- `src-tauri/src/core/mcp.rs`
  Expone herramientas MCP como `get_context`, `save_memory`, `get_skill` y `log_session`.

- `src-tauri/src/core/mcp_http.rs`
  Expone el servidor MCP HTTP local en `127.0.0.1`.

- `src-tauri/src/commands/onboarding.rs`
  Genera el workspace inicial, `claude.md` y archivos de compatibilidad.

- `src/views/ObservabilityView.tsx`
  Incluye la pestaña `Conectar IA`, hoy centrada en snippets manuales para Claude/Cursor/Windsurf.

- `src/components/onboarding/OnboardingWizard.tsx`
  Permite elegir varias herramientas de IA, incluyendo GPT/ChatGPT y Gemini.

### 3.3 Fortalezas reales actuales

Estas son las fortalezas mas importantes del producto tal y como esta hoy:

- Modelo local y portable
  El usuario posee su contexto en archivos abiertos y legibles.

- Brain-first
  El sistema existe sin necesidad de un modelo concreto ni de un proveedor concreto.

- Buen acoplamiento entre memoria y ejecucion
  Las memorias, skills, rules y proyectos ya no son notas sueltas, sino contexto operativo.

- Context retrieval explicito
  Existe un motor concreto de seleccion de contexto con presupuesto de tokens, no solo un arbol de carpetas bonito.

- Observabilidad
  El producto ya puede medir que contexto sirve y que se queda fuera.

- Integracion local real
  MCP local y workspace local permiten experiencias utiles con herramientas compatibles.

## 4. Donde estamos desalineados con la vision

### 4.1 Problema principal: la narrativa del producto aun no esta cerrada

La vision deseada es:

"AI Context OS es la memoria, el contexto y la continuidad que puedes llevarte a cualquier IA."

Pero varias partes del producto siguen implicando esto otro:

"AI Context OS genera archivos y configuraciones para unas cuantas herramientas concretas."

La primera narrativa es una categoria nueva y fuerte.
La segunda narrativa suena a utilidad tecnica secundaria.

### 4.2 El core canonico esta demasiado atado a Claude

Hoy `claude.md` actua de facto como router maestro del sistema.
Eso fue util para arrancar, pero limita el posicionamiento futuro.

Problemas:

- el nombre del artefacto central arrastra la identidad de otro producto
- dificulta presentar AI Context OS como capa universal
- empuja a pensar la arquitectura desde una herramienta concreta y no desde un modelo abstracto de contexto

Recomendacion:

- mantener `claude.md` como un adaptador de salida
- introducir un artefacto interno neutral, por ejemplo `_router.md`, `_brain.md` o `_context-router.md`
- generar `claude.md`, `.cursorrules`, `.windsurfrules` y futuros equivalentes desde esa fuente canonica

### 4.3 La UX de "Conectar IA" promete mas de lo que realmente entrega

El onboarding permite seleccionar:

- Claude
- Cursor
- GPT/ChatGPT
- Windsurf
- Copilot
- Gemini

Pero la conexion real mostrada en la UI actual se limita a:

- Claude Desktop
- Claude Code
- Cursor / Windsurf

Y ademas la generacion de compatibilidad actual solo crea:

- `claude.md`
- `.cursorrules`
- `.windsurfrules`

Esto genera una brecha entre promesa y capacidad real.

### 4.4 Falta una abstraccion formal de conectores

Ahora mismo hay varias piezas de compatibilidad, pero no existe una capa explicitamente modelada de:

- conector
- capacidad
- modo de integracion
- nivel de soporte

Eso impide responder bien a preguntas clave del producto:

- que herramientas tienen acceso local real
- que herramientas solo admiten export/handoff
- que herramientas requieren backend remoto
- que herramientas pueden leer, escribir o ambas cosas

### 4.5 Falta una estrategia clara para herramientas cerradas

La vision es "llevar tu cerebro a cualquier IA".

En la practica, hay tres familias distintas:

- herramientas con integracion local fuerte
  Claude Code, Codex, Gemini CLI, modelos locales, etc.

- herramientas con integracion remota o muy condicionada
  ChatGPT web y otras experiencias hosted

- herramientas sin integracion directa pero con handoff posible
  export de contexto, prompts enriquecidos, paquetes de trabajo

Hoy estas tres familias no estan modeladas claramente en producto ni en arquitectura.

## 5. Evaluacion tecnica por eje estrategico

### 5.1 Cerebro / memoria portable

Estado actual: fuerte

Lo que ya existe:

- modelo de memoria bien definido
- almacenamiento portable en archivos
- tipologia clara de memorias
- capacidad de lectura/escritura local

Mejoras necesarias:

- separar mejor memoria permanente vs memoria operacional vs scratch
- definir una fuente de verdad mas neutral que `claude.md`
- mejorar trazabilidad de decisiones y sesiones

### 5.2 Motor de contexto

Estado actual: funcional, pero aun inmaduro

Lo que ya existe:

- scoring hibrido
- presupuesto de tokens
- seleccion de niveles L0/L1/L2
- skill dependencies con `requires` y `optional`

Limitaciones actuales:

- el "semantic scoring" sigue siendo heuristico
- BM25 y reglas simples funcionan, pero aun no hay una capa semantica realmente potente
- no existe una politica por herramienta o por caso de uso
- no hay benchmarking ni tests solidos sobre calidad de recuperacion

Impacto estrategico:

Si el producto quiere ser "el cerebro para cualquier IA", el retrieval tiene que ser una ventaja competitiva real, no una aproximacion aceptable.

### 5.3 Integraciones y conectores

Estado actual: parcial

Lo que ya existe:

- MCP stdio local
- MCP HTTP local
- archivos de compatibilidad para Claude/Cursor/Windsurf

Limitaciones actuales:

- no existe un registry formal de conectores
- las compatibilidades no estan diferenciadas por capacidades reales
- `.cursorrules` y `.windsurfrules` son practicamente copias
- no hay soporte real equivalente para GPT/ChatGPT, Gemini o Copilot

### 5.4 UX y posicionamiento

Estado actual: mixto

Fortalezas:

- la app visualiza bien muchas capas del sistema: explorer, graph, governance, simulation, observability
- no depende de un chat incrustado

Problemas:

- no queda totalmente claro para un usuario nuevo si esto es un sistema de memoria, una app de notas, una herramienta para Claude o un "hub de IA"
- "Conectar IA" sugiere una universalidad que aun no esta resuelta
- el onboarding habla de herramientas, pero no explica capacidades ni limites por herramienta

## 6. Direccion recomendada para alinear mejor el producto

### 6.1 Definir formalmente el producto

Propuesta:

AI Context OS es un brain layer para IA.

Mas concretamente:

- memoria portable
- router de contexto
- workspace operativo
- capa de conectores
- observabilidad de uso del contexto

No es:

- otro chat
- otra app de notas
- una alternativa a ChatGPT

### 6.2 Introducir tres modos oficiales de integracion

En vez de hablar genericamente de "compatibilidad", la app deberia modelar estos modos:

1. Local Native
   La herramienta puede trabajar con el workspace local y/o con MCP local.

2. Bridge / Handoff
   La herramienta no se conecta de forma plena, pero AI Context OS le prepara contexto, archivos y handoff de alta calidad.

3. Remote Hosted
   La herramienta requiere un conector remoto o una capa hospedada adicional.

Esto permite que la promesa "compatible con muchas IA" siga siendo cierta sin engañar al usuario.

### 6.3 Convertir el sistema en adapter-first

Arquitectura recomendada:

- Core canonico
  memoria, scoring, retrieval, reglas, observabilidad

- Connector registry
  lista de herramientas soportadas, capacidades y forma de integracion

- Render adapters
  generar artefactos o configuraciones especificas por herramienta

- Context pack exporters
  generar handoff para herramientas cerradas o sin acceso local

Ejemplo de capacidades por conector:

- `local_read`
- `local_write`
- `mcp_stdio`
- `mcp_http_local`
- `prompt_handoff`
- `remote_connector_required`

### 6.4 Priorizar herramientas con integracion local real

Para mantener el foco y maximizar utilidad, la hoja de ruta deberia priorizar:

- Claude
- Codex
- Gemini CLI
- modelos locales
- futuros entornos con acceso local real

Y tratar de otra manera:

- ChatGPT web
- Gemini web
- herramientas hosted sin puente local claro

La idea no es abandonarlas, sino integrarlas via Bridge/Handoff en lugar de prometer integracion nativa.

## 7. Mejoras tecnicas concretas recomendadas

### 7.1 Crear una fuente canonica neutral del router

Accion:

- introducir un router interno neutral
- convertir `claude.md` en artefacto derivado

Beneficios:

- mejor independencia de herramienta
- mejor posicionamiento
- arquitectura mas limpia para nuevos conectores

### 7.2 Implementar un registry formal de conectores

Accion:

- definir un modelo `ConnectorDefinition`
- declarar para cada herramienta:
  - nombre
  - capacidades
  - modo de integracion
  - nivel de soporte
  - artefactos generables

Beneficios:

- la UI podra decir la verdad
- el onboarding sera consistente
- sera mas facil anadir nuevas herramientas

### 7.3 Redisenar la UX de conexion

Accion:

- cambiar "Conectar IA" de una pantalla de snippets a una pantalla de capacidades y modos

Ejemplo:

- Claude: Local Native
- Codex: Local Native
- Gemini CLI: Local Native
- ChatGPT: Bridge
- Gemini web: Bridge

Cada tarjeta deberia responder:

- que puede hacer
- que no puede hacer
- como se usa
- que artefactos genera AI Context OS para esa herramienta

### 7.4 Mejorar seriamente el retrieval

Accion:

- incorporar semantic scoring real
- crear evaluaciones de retrieval
- testear precision por tipo de tarea
- permitir politicas de carga por conector y por caso de uso

Beneficios:

- refuerza la ventaja competitiva del producto
- mejora resultados en cualquier herramienta
- evita que la diferenciacion del producto dependa solo de UX o formato de archivos

### 7.5 Elevar MCP de "endpoint util" a "API de cerebro"

Accion:

- evolucionar las herramientas MCP hacia una capa mas generica y reusable

Posibles grupos:

- contexto
  `get_context`, `search_context`, `fetch_memory`

- workspace
  `list_files`, `read_file`, `search_files`

- escritura
  `save_memory`, `write_file`, `create_file`, `propose_patch`

- sesion
  `log_session`, `save_summary`, `record_decision`

Beneficios:

- mejor compatibilidad futura
- mejor capacidad de integracion con herramientas externas
- mejor claridad de producto

### 7.6 Corregir la promesa del onboarding

Accion:

- no listar herramientas como si todas tuvieran el mismo soporte
- reflejar el soporte real por tipo de integracion

Propuesta:

- mover la seleccion de herramientas del onboarding a una fase de "Conectores"
- mostrar badges:
  - Nativo
  - Bridge
  - Experimental
  - Proximamente

### 7.7 Endurecer infraestructura y calidad

Accion:

- tests para scoring
- tests para router/adapters
- tests para comandos MCP
- pruebas de regresion sobre retrieval

Esto es especialmente importante si el producto quiere ser el backend cognitivo de multiples herramientas.

## 8. Roadmap recomendado

### Fase 1. Consolidar la tesis de producto

- definir mensaje oficial del producto
- introducir terminologia de brain layer
- corregir UX y copy para no sobreprometer conectores

### Fase 2. Desacoplar el nucleo de Claude

- crear router interno neutral
- mantener adapters de salida por herramienta
- formalizar connector registry

### Fase 3. Mejorar conectores locales

- reforzar Claude
- anadir Codex
- anadir Gemini CLI
- modelar bien Local Native vs Bridge

### Fase 4. Mejorar el motor de contexto

- semantic scoring real
- evaluacion de retrieval
- politicas por herramienta

### Fase 5. Bridge universal para herramientas cerradas

- export de contexto
- paquetes de handoff
- prompts enriquecidos
- flujos de continuidad entre herramientas

## 9. Decisiones estrategicas recomendadas

1. No introducir ahora un chat nativo como centro del producto

2. Reforzar la identidad de AI Context OS como cerebro/contexto universal

3. Tratar Claude, Codex y Gemini CLI como integraciones de primera clase

4. Tratar ChatGPT web y herramientas cerradas como modo Bridge, no como integracion nativa falsa

5. Convertir el motor de contexto y la capa de conectores en la principal ventaja competitiva

## 10. Conclusiones

El producto ya tiene una base tecnica coherente con la idea de "cerebro digital para IA".

Lo mas importante no es cambiar radicalmente el producto, sino:

- explicarlo mejor
- abstraerlo mejor
- modularizar mejor la capa de conectores
- mejorar el motor de contexto
- dejar de centrar la narrativa en artefactos o herramientas concretas

La oportunidad de AI Context OS no esta en competir como chat.
Esta en ser la capa de memoria, contexto, continuidad y ejecucion que hace mas utiles a todas las demas herramientas.

Si alineamos arquitectura, UX y mensaje en torno a esa idea, el producto gana claridad, utilidad y longevidad.
