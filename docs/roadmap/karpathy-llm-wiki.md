# Implementación del Patrón "LLM Wiki" (Basado en Andrej Karpathy)

**Fuente Original:** [A pattern for building personal knowledge bases using LLMs](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (Gist por Andrej Karpathy).

Este documento detalla la implementación técnica e integración directa en **AI Context OS** de las tres mecánicas fundamentales descritas en el patrón de Karpathy para evitar el "RAG amnésico" y construir un verdadero Segundo Cerebro compuesto e inteligente.

---

## 1. El Inbox y el Mecanismo de Ingesta (Ingest Workflow)

Karpathy propone la figura de "Raw Sources" (Fuentes Crudas). Esto significa que **nunca alteras el material original**, pero necesitas que el LLM extraiga todo su valor y actualice la red de conocimiento (tu wiki).

**¿Qué va en el Inbox/Raw?** Todo lo externo:
- Un artículo de blog útil (mediante Obsidian Web Clipper o similares).
- Notas tomadas rápidamente a mano desde el móvil ("braindumps").
- Transcripciones de reuniones o audios.
- PDFs, reportes, o hilos de X.

### El Flujo de Ingesta en AI Context OS:
1. **Lanzamiento:** El usuario mueve (o descarga directamente) el documento crudo a la carpeta raíz `01-sources/inbox/`.
2. **Trigger del Agente:** Se inicializa el "Ingest Agent" desde la interfaz (Marketplace de Agentes).
3. **Lectura y Desglose:** El Agente (controlado desde Rust en el background) lee el texto original que es inmutable.
4. **La magia (Auto-Maintenance):** El Agente ejecuta múltiples operaciones atómicas:
   - Crea un archivo "resumen de la fuente" con metadatos (`type: source`) dentro de la base de datos (ej: `source-articulo-ai.md`).
   - Analiza qué "conceptos" o "entidades" ya tenías en tu app utilizando tu *Router* y *Graph*.
   - **Actualiza directamente esos archivos:** Si el artículo nuevo habla de una estrategia en Rust, el Agente busca tu memoria existente `concepto-rust.md`, escribe un nuevo párrafo integrando ese aprendizaje, y deja una cita relativa apuntando al archivo base.
   - Elimina (o mueve a un archivo pasivo o archivo histórico de `01-sources/`) el ítem original del inbox.
5. **Logging:** Para dar transparencia al usuario de qué ha hecho la IA en su file system, el agente usa IPC para apunatar la acción en el log del día (`04-synthesis/daily/2026-04-05.md`) en forma de bullet point: `[10:30AM] Ingesta procesada: El artículo X actualizó 3 memorias`.

---

## 2. Motor de Búsqueda Híbrido: BM25 + Vectorial Local Ligero

Karpathy explica que para evitar infraestructura pesada de RAG, los LLMs pueden manejarse bien con índices para cientos de notas, pero para escalar es necesario un buscador de calidad que no dependa de bases vectoriales externas ni pierda privacidad (como `qmd`).

En AI Context OS lo implementaremos como el **Motor de Scoring Semántico en Rust**:

*   **BM25 (Búsqueda Léxica Predictiva):** Actúa como un ElasticSearch ligero. Si buscas la frase "Algoritmo de Ingesta Rust", un RAG vectorial puramente semántico puede perder keywords finas. BM25 da una puntuación matemática perfecta basada en qué archivos contienen exactamente esas palabras según su relevancia frente a todo el contenido (TF-IDF moderno).
*   **Vectores Ligeros (Embeddings):** Coge el sentido semántico (ej: "Bajar archivos a mi carpeta" conecta vectorialmente con "Descargas a disco local" aunque no compartan letras).

### Implementación Real en el Backend de Tauri (Rust):
Dado que es una app nativa, podemos prescindir de APIs (como OpenAI Embeddings) y hacerlo 100% On-Device:
1.  **Tantivy:** Usaremos esta librería en Rust (gratuita, ligerísima) para ejecutar el full-text search léxico (BM25).
2.  **rust-bert / ort:** Integraremos un modelo ONNX enano y super optimizado (como `all-MiniLM-L6-v2`, <30MB) empotrado en el binario Tauri. Este modelo calculará los vectores de los archivos Markdown en background cada vez que se guarda un archivo.
3.  **Fusión (Re-ranking):** En el momento de la consulta, Rust tomará lo mejor del BM25 (keyword match) y lo mejor de los vectores (meaning match), fusionará los scores y volcará el Top X directamente al *Context Router* antes de inyectarlo en Claude.

---

## 3. Acumulación (Nuevas Ramas desde el Chat)

El artículo da con la debilidad de herramientas como *ChatGPT File Uploads*: "El LLM lee para responder, y luego todo desaparece". La respuesta no se capitaliza. **Esto es anti-acumulación.**

Karpathy sugiere: *"Las buenas respuestas pueden archivarse de vuelta en la wiki como nuevas páginas. Una comparación, un análisis o una conexión descubierta son valiosas y no deberían desaparecer en el historial del chat."*

### Cómo implementarlo (UI & Feature) en AI Context OS:
Cuando el usuario tiene un chat interactivo, la IA usa el contexto base y genera algo nuevo (una gran síntesis, decisiones arquitectónicas, o comparaciones detalladas).
1.  **Botón de Consolidación:** Añadiremos un botón en la UI de la conversación (o un atajo de slash command `/consolidate`) llamado **"Guardar como Conocimiento"**.
2.  **Destrucción del Chat / Creación de Nodo:** Al pulsarlo, el sistema aísla los mensajes clave, toma esa gran síntesis y genera un nuevo archivo Markdown clasificado ontológicamente (ej: `04-synthesis/conclusiones-arquitectura.md`).
3.  **Extracción Silenciosa:** Se lanza una micro-llamada de LLM interna no bloqueante en background que detecta etiquetas semánticas (`#estrategia`, `#insights`), las inyecta en el YAML Frontmatter (como `type: synthesis`) y lo vincula al grafo.
4.  **Ciclo Cerrado:** De este modo, la próxima vez que el usuario pregunte por `#estrategia`, esta síntesis aprendida *será material de partida real* (enviado por Rust), en lugar de volver a inferirlo de cero. El conocimiento se compone como interés compuesto.
