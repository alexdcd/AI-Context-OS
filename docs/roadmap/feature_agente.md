# Pre-Plan: Marketplace de Agentes (Modelo Freemium)

> **Contexto:** Este documento es un esbozo preliminar de una funcionalidad "Premium" para AI Context OS. La idea es monetizar la aplicación proporcionando agentes/workflows pre-construidos ("Agents as a Service") que se instalan con un clic en el workspace del usuario.

## 1. Visión del Producto (Modelo Freemium)
- **Base:** La app "AI Context OS" se mantiene gratuita, sirviendo como un potente motor para la gestión de memoria y contexto.
- **Premium:** Se habilita una pestaña "Agents". Los usuarios de pago tendrán acceso a agentes especializados (estructuras de carpetas predefinidas, promts optimizados, y scripts).
- **El beneficio para el usuario:** Ahorrar horas de setup iterando en system prompts y organizando estructuras de carpetas. Al hacer clic en un Agente desde el Marketplace, la app reconstruye toda la lógica en un instante.
- **Idea usaurio premium** en el codigo fuente de la app se puede ver que hay una carpeta premium, dentro de esta pestaña se puede pedir logear o redirigir a la web landing page para la venta de agentes. que será la misma web de la app, tambien te puedes logear si ya eres un usaurio prmium y descargar los agentes disponibles.


## 2. Arquitectura Técnica de la Feature

### A) La Interfaz (Marketplace)
1. **AgentsView.tsx:** Una nueva pestaña en el sidebar con tarjetas de agentes.
2. Cada tarjeta contendrá detalles del agente (ej. "SM Agent: Sistema de publicación multi-red").
3. Si el usuario tiene licencia, el botón "Instalar" / "Importar" estará habilitado.

### B) El Motor de Despliegue (Tauri/Rust)
1. Un agente en el contexto de la app no es un proceso corriendo constantemente, sino un **conjunto de archivos y carpetas pre-estructuradas** (el "Andamiaje").
2. Al importar un agente, Tauri ejecuta un comando (ej. `tauri::command install_agent_template`).
3. Este comando generaría en la máquina local del usuario:
   - Carpetas específicas bajo `08-agents/[nombre_agente]/` (configurable).
   - Un archivo principal de instrucciones (ej. `CLAUDE.md`, o `[nombre_agente]_RULES.md`).
   - Archivos y plantillas pre-rellenadas (ej. `estrategia.md`, `voice-dna.md`).

### C) Scripts como Comandos
En el futuro, los scripts asociados al workflow de un agente (ej. validación, purga) podrían integrarse como comandos nativos de Rust invocables desde la UI de la app directamente en la vista o editor de ese agente.

---

## 3. Prueba de Concepto (PoC): El SM Agent (Social Media)

Antes de integrar todo el ecosistema del marketplace, el primer paso será desarrollar y probar iterativamente el Agente de Social Media (SM Agent) de forma "manual". 

### Componentes del SM Agent (A testear localmente)
esto es un ejemplo de lo que se puede hacer con la app - desarrollado por mi en otra carpeta de contexto con skills, script, conectaores, etc. 
- **Ingesta:** URL -> procesado a Markdown.
- **Contexto:** Lee `Voice DNA`, `hooks`, contexto de red.
- **Adaptación:** Re-escribe post por red (LinkedIn, X, Threads, Substack).
- **Métricas:** Sistema basado en comentarios HTML (`<!-- metrics ... -->`).
- **Purga y Aprendizajes:** Script de purga mensual analizando umbrales.



## 4. Próximos Pasos Recomendados

1. **Testear el Workflow SM Agent:** Crear la estructura manual del *SM Agent* e iterar el trabajo desde Claude Desktop para validar el concepto y corregir el prompteo.
2. **Diseño de Interfaz:** Añadir la pestaña `AgentsView` en el front-end con datos simulados (dummies) para analizar la usabilidad.
3. **Rust Template Engine:** Programar la lógica en Rust (`install_agent_template`) que lea una definición JSON y la convierta en los archivos y estructura correctos.
4. **Barrera de Pago:** Simular un estado "Premium" en los settings antes de conectar plataformas de licencias de pago (ej. Stripe / LemonSqueezy).
