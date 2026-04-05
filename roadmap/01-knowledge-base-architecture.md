# Arquitectura: Object-Oriented Knowledge Base para AI Context OS

Este documento refleja el rediseño conceptual de la base de datos (basada en el file system) de AI Context OS, basándose en la idea de que una Base de Conocimiento Mantenida por LLMs debe ser persistente, acumulativa y estructurada.

---

## 1. El Paradigma Base: LLM como Mantenedor
El texto original establece un principio vital: romper con los tradicionales sistemas RAG (donde el LLM tiene que leer y descubrir la información cruda cada vez que le haces una consulta). 
En su lugar, el LLM asume el rol de "bibliotecario/programador", leyendo las fuentes crudas e inyectándolas en una **Wiki estructurada**, manteniendo los hipervínculos, comprobando contradicciones y garantizando que el conocimiento es escalable y persistente.

**Flujo Operativo Clave:**
1. **Ingest (Ingesta):** Entra una nueva fuente cruda inmutable, el LLM la lee, extrae conceptos/entidades y *actualiza* las memorias correspondientes en el sistema.
2. **Query (Acumulación):** El análisis inteligente que el humano y el LLM hacen en el chat no se pierde; se guarda de nuevo en la wiki como "síntesis".
3. **Lint (Gobierno/Governance):** El LLM re-analiza nodos en busca de contradicciones y conceptos huérfanos.

## 2. El Desafío UX: El Sistema Híbrido

Un sistema completamente "plano" (sin carpetas, puro meta-dato) es ideal para las bases de datos de IA, pero **terrible para la orientación espacial humana**. Si el usuario humano pierde la brújula de dónde está guardando su proyecto, el "Segundo Cerebro" colapsa.
Además, AI Context OS cuenta con *niveles progresivos de carga de contexto* que dependen del proyecto o archivo que está abierto. 

**La Solución:** Combinar lo físico (ubicación para el humano) con lo semántico (reglas para la IA).
- **Las carpetas** definen tu "Contexto de Ejecución" y la jerarquía visual humana (dónde trabajas).
- **El Frontmatter `type:` (YAML)** define la "Naturaleza Ontológica" de esa información, lo que le indica al Agente IA cómo debe modificar, fusionar o respetar ese archivo.

---

## 3. Implementación Práctica: Los 4 "Super-Niveles"

Bajo el lema *"El File System es la Base de Datos"*, reemplazamos la clasificación temática laxa (`/marketing`, `/finanzas`) por una **clasificación basada en el ciclo de vida de la información**. 

El Workspace se divide en 4 grandes carpetas raíz:

### `01-sources/` (Entradas / Embudo)
Material externo o bruto. Es la capa *inmutable*. El Agente lee de aquí, pero nunca sobreescribe el archivo maestro.
- `/inbox` (Enlaces pegados, braindumps rápidos. El "Ingest Agent" vigila esta carpeta).
- `/articles` (Web clips guardados).
- `/books` (Apuntes o PDF's de terceros).
- `/meetings` (Transcripciones en crudo).
- `/assets` (Imágenes, attachments).

### `02-entities/` (Nodos Reales / En lo que trabajas)
Cosas concretas con un nombre propio. Son las piezas de Lego de tu vida.
- `/projects` (Tus espacios de ejecución activos, ej: `AI_Context_OS`, `Website_DJ_Javi`).
- `/people` (Perfiles y notas sobre clientes, colegas, equipo).
- `/tools_and_organizations` (Fichas actualizables sobre Tauri, Claude, OpenAI).
- `/personal` (Tu información financiera, metas, propiedades).

### `03-concepts/` (La Base Cognitiva / Ideas abstractas)
Metodologías, frameworks transversales y conceptos atómicos de valor universal que alimentan todos tus proyectos.
- `/skills` (Cosas que dominas y nutres: `Rust Backend`, `SEO`, `Prompting`).
- `/frameworks` (Modelos mentales: `Modelo Freemium`, `Agile`).
- `/domains` (Áreas de interés genérico: `Neurociencia`, `Inteligencia Artificial`).
- `/ideas` (Ocurrencias aún no asignadas a un proyecto Entity).

### `04-synthesis/` (Outputs / Tu valor acumulado)
La cúspide del sistema. Documentos creados por tu interacción interactiva con el Agente; información validada, procesada y destilada.
- `/daily_journal` (Tu línea temporal narrativa).
- `/decisiones` (Log de por qué se tomó una decisión arquitectónica en un proyecto).
- `/content_drafts` (Borradores terminados procedentes del SM Agent).
- `/reports` (Fáciles consolidaciones generadas por la Governance).

---

## 4. Ventajas para el Ecosistema Core de AI Context OS

1. **Routing Óptimo (Escalabilidad de Contexto):** Si tienes abierto un proyecto en `02-entities/projects/alpha`, el motor Rust inyecta todos los tokens del super-nivel `/projects`, pero si el contexto es ligero, sabe inteligentemente abrir nodos en `03-concepts/skills` para enriquecer la respuesta.  
2. **Sistema de Permisos Robusto (Marketplace UI):** Esta estructura es la red de seguridad del Mercado de Agentes. Cuando un usuario importe el *Social Media Agent*, Tauri podrá restringir sus accesos para que solo lea de `01-sources` y únicamente tenga permisos de escritura en la subcarpeta `04-synthesis/content_drafts`. Todo queda controlado y sanitizado.
3. **BM25 y Embeddings Locales:** Al clasificar limpiamente los "Concepts" vs "Sources", el sistema híbrido de RAG semántico local (implementado vía Tantivy en Rust) ponderará mucho más los hits léxicos de los "Concepts" o la "Synthesis" frente al raw noise de `01-sources`, actuando como el re-ranking de LLM perfecto.
