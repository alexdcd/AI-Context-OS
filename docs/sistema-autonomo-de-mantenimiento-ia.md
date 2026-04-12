# Sistema Autónomo de Mantenimiento IA

> Estado: propuesta de feature
> Fecha: 2026-04-12
> Objetivo: definir cómo AI Context OS puede mantener la calidad del contexto, la documentación y la higiene del workspace con distintos niveles de autonomía, sin comprometer la gobernanza ni obligar desde el inicio a usar una IA local o una suscripción gestionada.

## 1. Resumen ejecutivo

AI Context OS ya dispone de una base sólida para funcionar como sistema de memoria y gobernanza sin una IA integrada obligatoria.

Hoy el producto ya puede:

- estructurar el workspace de forma determinista
- indexar memorias Markdown con frontmatter
- generar router e índices
- detectar ciertos problemas de gobernanza
- medir uso real del contexto
- servir como capa de contexto para IAs externas mediante MCP

Lo que todavía no puede hacer de forma fiable por sí solo es la parte semántica de alto juicio:

- decidir qué entra desde `inbox/` como conocimiento estable
- resumir con criterio editorial
- elegir ontología correctamente en casos ambiguos
- actualizar documentación con calidad consistente
- consolidar conocimiento nuevo sin supervisión

Por eso, la dirección recomendada es construir un `Sistema Autónomo de Mantenimiento IA` basado en workflows gobernados.

La idea central es:

1. mantener un núcleo útil sin IA obligatoria
2. añadir mantenimiento semántico con IA externa conectada o IA local opcional
3. hacer que la IA proponga cambios, mientras el sistema gobierna y verifica

## 2. Principio de producto

La IA no debe ser la fuente de verdad.

La fuente de verdad sigue siendo el workspace local y su memoria canónica. La IA actúa como:

- copiloto de ingestión
- generador de propuestas
- sintetizador de borradores
- asistente de mantenimiento documental

La gobernanza y la estructura del sistema siguen siendo las barreras de seguridad:

- reglas del router
- contratos `L0/L1/L2`
- ontologías
- frontmatter
- observabilidad
- validaciones y revisiones

## 3. Mapa de capacidades por nivel

### Nivel A: Sin IA externa ni IA local

Este nivel debe seguir aportando valor por sí solo.

#### Capacidades que ya existen o encajan bien con el sistema actual

- creación y mantenimiento de la estructura base del workspace
- generación de `claude.md`, `.cursorrules`, `.windsurfrules` e `index.yaml`
- indexado e identificación de memorias con frontmatter válido
- scoring heurístico y selección de contexto
- detección de conflictos heurísticos simples
- detección de memorias degradadas o de poco uso
- detección de candidatos a limpieza de `scratch`
- observabilidad del uso real del contexto
- sugerencias de optimización basadas en uso
- edición manual y promoción manual de conocimiento

#### Lo que este nivel no puede hacer bien

- leer un texto nuevo y entender si contiene conocimiento duradero
- resumir automáticamente un inbox complejo
- decidir dónde ubicar conocimiento nuevo en la ontología
- redactar documentación de alta calidad a partir de fuentes heterogéneas
- consolidar contenido redundante con juicio semántico

#### Valor real del producto en este nivel

- motor de memoria local y estructurada
- capa de gobernanza y observabilidad
- sistema operativo de contexto para ser usado por humanos o por otras IAs

#### Riesgo principal

El sistema puede conservar la estructura, pero no puede “curar” el conocimiento sin intervención humana.

### Nivel B: Con IA externa conectada por MCP o API del usuario

Este nivel es el más recomendable como siguiente paso de producto.

#### Capacidades que habilita

- procesar `inbox/` con ayuda semántica
- generar propuestas de nuevas memorias
- generar borradores de actualizaciones de documentación
- sugerir consolidaciones con mejor criterio que las heurísticas actuales
- clasificar contenido nuevo por ontología y tags
- sintetizar sesiones largas en memorias o journaling estructurado

#### Qué puede mantenerse con bastante fiabilidad

- un modo copiloto de mantenimiento del contexto
- propuestas semiautomáticas de documentación
- sugerencias de promoción desde `inbox/`
- generación de borradores de memorias listas para revisión

#### Qué no debería hacer todavía sin supervisión

- escribir memoria canónica silenciosamente
- modificar documentos críticos sin diff o propuesta
- reestructurar ontología de forma autónoma
- eliminar o archivar información por criterio exclusivamente generativo

#### Ventajas de producto

- validas valor real sin asumir coste inferencial propio
- permites a usuarios avanzados traer su proveedor o modelo favorito
- reduces riesgo operativo y financiero

#### Fricción

- el usuario necesita conectar una API key o una herramienta local tipo Ollama / LM Studio
- la calidad dependerá del modelo conectado y del nivel de disciplina del workflow

### Nivel C: Con IA local del usuario

Este nivel tiene sentido como acelerador futuro, no como dependencia inicial.

#### Capacidades adicionales

- automatizaciones frecuentes con coste marginal bajo
- digests periódicos del inbox
- compactación de sesiones en background
- generación de propuestas cuando el usuario no está mirando la app
- mejor privacidad para código, estrategia y contenido sensible

#### Dónde aporta más valor

- usuarios técnicos
- usuarios con privacidad alta
- workflows recurrentes de mantenimiento
- trabajo offline o semioffline

#### Limitaciones

- setup más complejo
- resultados desiguales según modelo y hardware
- peor experiencia de onboarding para usuarios no técnicos

### Nivel D: IA gestionada por AI Context OS

Este nivel es el que más reduce fricción, pero también el que más exige a nivel de negocio y operación.

#### Capacidades

- experiencia “funciona ya”
- workflows premium listos para usar
- posibilidad de empaquetar mantenimiento autónomo como valor Pro claro

#### Riesgos

- coste inferencial
- soporte
- expectativa de calidad más alta
- necesidad de control de uso y pricing

## 4. Conclusión del mapa

La recomendación es:

1. mantener el valor base del producto sin IA obligatoria
2. introducir primero workflows con IA externa conectada
3. añadir soporte de IA local como acelerador opcional
4. dejar la IA gestionada como capa comercial posterior

## 5. Explicación del flujo: Inbox -> Proposal -> Governance -> Promote

Este flujo es la forma recomendada de introducir autonomía sin perder control.

### 5.1 Inbox

`inbox/` sigue siendo el área de aterrizaje de información nueva:

- notas nuevas
- research
- transcripciones
- ideas sin procesar
- borradores de sesiones
- material importado desde conectores

En esta fase aún no existe conocimiento canónico. Solo material candidato.

### 5.2 Proposal

Una IA conectada o un workflow asistido analiza el contenido del `inbox/` y genera una propuesta estructurada.

La propuesta debe contener como mínimo:

- tipo de acción sugerida
- justificación
- confianza
- ontología sugerida
- tags sugeridos
- `L0`
- borrador de `L1`
- opcionalmente `L2`
- documentos afectados

Tipos de propuesta recomendados:

- `create_memory`
- `update_memory`
- `merge_memories`
- `update_docs`
- `discard`
- `needs_human_review`

La propuesta no es todavía una escritura definitiva en memoria canónica.

### 5.3 Governance

La gobernanza evalúa la propuesta antes de promoverla.

Validaciones deseables:

- el frontmatter es válido
- la ontología es coherente
- no pisa un documento protegido sin confirmación
- no genera duplicados obvios
- no entra en conflicto con memorias relacionadas
- cumple el contrato `L0/L1/L2`
- tiene trazabilidad respecto al origen

Esta fase puede combinar:

- validaciones deterministas
- heurísticas del sistema
- observabilidad previa
- revisión humana opcional

### 5.4 Promote

Solo después de pasar por la fase de gobernanza, la propuesta se promueve a uno de estos destinos:

- nueva memoria canónica
- actualización de memoria existente
- actualización de documentación
- journal o scratch, si no merece canonización
- descarte explícito

### 5.5 Beneficios del flujo

- evita que la IA escriba conocimiento dudoso como verdad permanente
- mantiene trazabilidad
- permite medir calidad de propuestas
- encaja con el modelo actual del producto
- separa memoria operativa de memoria canónica

## 6. Feature propuesta: Sistema Autónomo de Mantenimiento IA

### 6.1 Definición

El `Sistema Autónomo de Mantenimiento IA` es una capa de workflows asistidos por IA diseñada para mantener la calidad del contexto y la documentación en AI Context OS sin romper la gobernanza ni convertir a la IA en la fuente de verdad.

### 6.2 Problemas que resuelve

- `inbox/` crece pero cuesta consolidarlo
- la documentación se queda atrás respecto al conocimiento real
- hay ideas útiles que no se convierten en memoria estable
- la calidad del contexto depende demasiado de trabajo manual
- el sistema detecta deterioro pero todavía no lo corrige con buen criterio

### 6.3 Objetivos

- reducir trabajo manual repetitivo
- aumentar la calidad del contexto recuperable
- mantener documentación más viva
- convertir ingestión y consolidación en un flujo gobernado
- habilitar futuras automatizaciones premium sin romper el producto base

### 6.4 No objetivos

- no crear múltiples agentes persistentes con memoria propia dentro del core
- no permitir que la IA modifique memoria canónica sin control
- no exigir IA local para usar AI Context OS
- no sustituir la gobernanza por razonamiento generativo opaco

## 7. Workflows recomendados de la feature

### 7.1 Process Inbox

Analiza nuevos elementos de `inbox/` y crea propuestas de:

- descarte
- promoción a memoria
- actualización de memoria existente
- actualización documental

Salida recomendada:

- lista priorizada de propuestas
- rationale por elemento
- borradores de memoria o docs

### 7.2 Propose Memory

Toma material de entrada y lo transforma en un borrador de memoria con:

- ontología sugerida
- `L0`
- `L1`
- `L2` opcional
- tags
- relaciones sugeridas

### 7.3 Propose Docs Update

Revisa cambios recientes y propone actualizaciones en:

- `README`
- docs de arquitectura
- roadmap
- documentos funcionales específicos

Debe priorizar diffs pequeños, explicables y trazables.

### 7.4 Session Compaction

Convierte sesiones largas o material disperso en:

- resumen de sesión
- hechos nuevos
- tareas pendientes
- candidatos de promoción a memoria

### 7.5 Governance Review

Evalúa propuestas pendientes y marca:

- promotable
- conflictive
- redundant
- needs_human_review

## 8. Arquitectura conceptual

### 8.1 Capas

#### Capa 1: Core determinista

- filesystem
- frontmatter
- niveles `L0/L1/L2`
- indexado
- scoring
- governance
- observability

#### Capa 2: IA asistente

- interpreta contenido nuevo
- genera borradores
- sugiere clasificaciones
- propone diffs

#### Capa 3: Orquestación de workflows

- lanza procesos concretos
- gestiona colas o tareas pendientes
- registra resultados
- prepara promociones

#### Capa 4: Revisión y promoción

- valida
- compara
- promueve
- descarta

### 8.2 Regla de seguridad principal

La IA propone; el sistema gobierna; la memoria canónica solo cambia mediante promoción explícita.

## 9. Requisitos funcionales sugeridos

- permitir ejecutar `Process Inbox` manualmente
- permitir ejecutar `Propose Docs Update` manualmente
- almacenar propuestas como artefactos trazables
- mostrar estado de cada propuesta
- permitir aprobar, editar o rechazar
- registrar origen y fecha de cada promoción
- funcionar con `sin IA`, `IA externa`, o `IA local`, degradando con elegancia

## 10. Requisitos no funcionales

- no romper el valor base del producto sin IA
- mantener explicabilidad
- mantener coste controlable
- evitar escritura silenciosa en documentos críticos
- mantener contratos de formato consistentes
- permitir observabilidad del propio sistema autónomo

## 11. UX recomendada

No presentar inicialmente estos workflows como “agentes”.

Presentarlos como acciones claras:

- `Procesar inbox`
- `Proponer memoria`
- `Proponer cambios de documentación`
- `Revisar propuestas pendientes`

Esto mejora la comprensión del usuario y evita vender complejidad interna como feature principal.

## 12. Roadmap recomendado por fases

### Fase 0: Harden core actual

- reforzar tests
- mejorar validaciones de frontmatter
- clarificar promoción manual
- ampliar governance para propuestas

### Fase 1: Proposal layer sin escritura automática

- introducir formato de propuesta
- añadir vista de propuestas pendientes
- permitir `Process Inbox` asistido

### Fase 2: IA externa conectada

- conectar workflows a MCP o proveedores del usuario
- permitir borradores de memorias y docs
- medir calidad y aceptación de propuestas

### Fase 3: IA local opcional

- soportar workflows recurrentes de bajo coste
- activar mantenimientos periódicos en background
- añadir privacidad y funcionamiento local-first más fuerte

### Fase 4: IA gestionada / Premium

- ofrecer experiencia lista para usar
- paquetizar workflows premium de alto ROI
- introducir automatización más proactiva si la calidad observada lo justifica

## 13. Decisiones de producto recomendadas

### Decisión 1: no hacer obligatoria la IA local

La IA local debe ser una ventaja futura, no un peaje de entrada.

### Decisión 2: no construir aún agentes persistentes en el core

La abstracción más útil ahora es `workflow gobernado`

### Decisión 3: priorizar dos workflows

Los primeros candidatos recomendados son:

1. `Process Inbox`
2. `Propose Docs Update`

### Decisión 4: medir antes de automatizar más

Antes de promover full autonomy, conviene medir:

- ratio de propuestas aceptadas
- tipo de errores más frecuentes
- degradación o mejora del retrieval
- impacto real en mantenimiento documental

## 14. Riesgos

- exceso de automatización con mala trazabilidad
- inflación de memorias poco útiles
- documentación generada pero no realmente mantenida
- dependencia de modelos de calidad variable
- UX confusa si se venden “agentes” antes de vender “trabajo resuelto”

## 15. Criterio de éxito

La feature tiene éxito si:

- reduce trabajo manual de mantenimiento
- mejora la calidad del contexto recuperado
- mantiene o mejora la consistencia documental
- no obliga a usar IA para entender el valor del producto
- puede operar con supervisión ligera sin deteriorar la memoria canónica

## 16. Resumen final

AI Context OS ya tiene buena parte del esqueleto necesario para un sistema de mantenimiento autónomo del conocimiento, pero todavía le falta una capa segura de propuestas y promoción.

La forma correcta de evolucionarlo es:

- no meter agentes persistentes en el núcleo
- no exigir IA local desde el inicio
- construir workflows gobernados
- permitir IA externa primero
- añadir IA local después como acelerador

El producto debe seguir siendo útil sin IA. La IA debe aumentar el valor del sistema, no sostener por sí sola su legitimidad.
