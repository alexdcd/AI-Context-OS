use std::fs;

use chrono::Utc;
use tauri::{AppHandle, State};

use crate::core::frontmatter::serialize_frontmatter;
use crate::core::types::{default_ontology_for_memory_type, MemoryMeta, MemoryType};
use crate::state::AppState;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct OnboardingProfile {
    pub name: String,
    pub role: String,
    pub tools: Vec<String>,
    pub language: String,
    pub template: String, // "developer", "creator", "entrepreneur", "custom"
    pub root_dir: Option<String>,
}

/// Run full onboarding: create workspace, profile, template skills/rules, and router.
#[tauri::command]
pub fn run_onboarding(
    profile: OnboardingProfile,
    app: AppHandle,
    state: State<AppState>,
) -> Result<bool, String> {
    // Step 1: Set root directory if custom
    if let Some(ref custom_root) = profile.root_dir {
        let expanded = shellexpand(custom_root);
        let path = std::path::PathBuf::from(&expanded);
        state.set_root(path)?;
    }

    let root = state.get_root();

    // Step 2: Create workspace structure (reuse init_workspace logic)
    let config = crate::commands::config::create_workspace_structure(&root, &profile.tools)?;
    *state.config.write().unwrap() = config;

    // Step 3: Generate perfil-profesional.md
    create_profile_memory(&root, &profile)?;

    // Step 4: Generate template-specific skills and rules
    match profile.template.as_str() {
        "developer" => create_developer_template(&root)?,
        "creator" => create_creator_template(&root)?,
        "entrepreneur" => create_entrepreneur_template(&root)?,
        _ => {} // "custom" = empty
    }

    // Step 5: Regenerate router
    let config = state.config.read().unwrap().clone();
    let all = crate::core::index::scan_memories(&root);
    let metas: Vec<_> = all.iter().map(|(m, _)| m.clone()).collect();
    let neutral = crate::core::router::generate_router_content(&metas, &config);
    let claude_md = crate::core::compat::render_claude_adapter(&neutral);
    fs::write(root.join("claude.md"), &claude_md)
        .map_err(|e| format!("Failed to write claude.md: {}", e))?;

    let paths = crate::core::paths::SystemPaths::new(&root);
    let index_yaml = crate::core::router::generate_index_yaml(&metas);
    fs::write(paths.index_yaml(), &index_yaml)
        .map_err(|e| format!("Failed to write index.yaml: {}", e))?;

    let cursorrules = crate::core::compat::render_cursor_adapter(&neutral);
    fs::write(root.join(".cursorrules"), &cursorrules).ok();
    let windsurfrules = crate::core::compat::render_windsurf_adapter(&neutral);
    fs::write(root.join(".windsurfrules"), &windsurfrules).ok();

    // Persist selected root and refresh runtime bindings for this workspace.
    state.set_root(root.clone())?;
    crate::commands::config::sync_workspace_runtime(state.inner(), Some(&app))?;

    Ok(true)
}

/// Check if onboarding has been completed.
#[tauri::command]
pub fn is_onboarded(state: State<AppState>) -> Result<bool, String> {
    let root = state.get_root();
    let paths = crate::core::paths::SystemPaths::new(&root);
    Ok(root.join("claude.md").exists() && paths.ai_dir().exists())
}

fn shellexpand(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}/{}", home.display(), &path[2..]);
        }
    }
    path.to_string()
}

fn tool_summary(tools: &[String]) -> String {
    if tools.is_empty() {
        "adaptadores auto-generados".to_string()
    } else {
        tools.join(", ")
    }
}

fn create_profile_memory(
    root: &std::path::Path,
    profile: &OnboardingProfile,
) -> Result<(), String> {
    let now = Utc::now();
    let tools_label = tool_summary(&profile.tools);
    let meta = MemoryMeta {
        id: "perfil-profesional".to_string(),
        memory_type: MemoryType::Context,
        l0: format!(
            "{} — {} | Herramientas: {}",
            profile.name, profile.role, tools_label
        ),
        importance: 0.95,
        always_load: true,
        decay_rate: 0.999,
        last_access: now,
        access_count: 0,
        confidence: 1.0,
        tags: vec!["perfil".into(), "identidad".into(), "contexto".into()],
        related: vec![],
        created: now,
        modified: now,
        version: 1,
        triggers: vec![],
        requires: vec![],
        optional: vec![],
        output_format: None,
        ontology: Some(default_ontology_for_memory_type(&MemoryType::Context)),
        status: None,
        protected: false,
        derived_from: vec![],
    };

    let l1 = format!(
        "Nombre: {}. Rol: {}. Herramientas IA: {}. Idioma principal: {}.",
        profile.name, profile.role, tools_label, profile.language
    );

    let l2 = format!(
        "## Perfil Profesional\n\n\
        - **Nombre:** {}\n\
        - **Rol/Profesión:** {}\n\
        - **Herramientas de IA:** {}\n\
        - **Idioma principal:** {}\n\
        - **Template elegido:** {}\n\n\
        ## Notas\n\n\
        _Añade aquí información adicional sobre tu perfil, experiencia, objetivos, etc._\n",
        profile.name, profile.role, tools_label, profile.language, profile.template
    );

    let body = format!("<!-- L1 -->\n{}\n\n<!-- L2 -->\n{}", l1, l2);
    let content = serialize_frontmatter(&meta, &body)
        .map_err(|e| format!("Failed to serialize profile: {}", e))?;

    let paths = crate::core::paths::SystemPaths::new(root);
    let path = paths.inbox_dir().join("perfil-profesional.md");
    fs::write(&path, content).map_err(|e| format!("Failed to write profile: {}", e))?;

    Ok(())
}

fn write_memory_file(
    root: &std::path::Path,
    folder: &str,
    filename: &str,
    id: &str,
    mem_type: MemoryType,
    l0: &str,
    importance: f64,
    tags: &[&str],
    l1: &str,
    l2: &str,
    triggers: &[&str],
    requires: &[&str],
) -> Result<(), String> {
    let now = Utc::now();
    let ontology = default_ontology_for_memory_type(&mem_type);
    let meta = MemoryMeta {
        id: id.to_string(),
        memory_type: mem_type,
        l0: l0.to_string(),
        importance,
        always_load: false,
        decay_rate: 0.998,
        last_access: now,
        access_count: 0,
        confidence: 0.9,
        tags: tags.iter().map(|s| s.to_string()).collect(),
        related: vec![],
        created: now,
        modified: now,
        version: 1,
        triggers: triggers.iter().map(|s| s.to_string()).collect(),
        requires: requires.iter().map(|s| s.to_string()).collect(),
        optional: vec![],
        output_format: None,
        ontology: Some(ontology),
        status: None,
        protected: false,
        derived_from: vec![],
    };

    let body = format!("<!-- L1 -->\n{}\n\n<!-- L2 -->\n{}", l1, l2);
    let content =
        serialize_frontmatter(&meta, &body).map_err(|e| format!("Failed to serialize: {}", e))?;

    let dir = root.join(folder);
    fs::create_dir_all(&dir).ok();
    fs::write(dir.join(filename), content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))?;

    Ok(())
}

fn create_developer_template(root: &std::path::Path) -> Result<(), String> {
    // Skills
    write_memory_file(
        root, ".ai/skills", "code-reviewer.md", "code-reviewer",
        MemoryType::Skill,
        "Skill: Revisor de código con análisis de calidad y seguridad",
        0.85,
        &["código", "review", "calidad", "desarrollo"],
        "Revisa código fuente buscando bugs, vulnerabilidades, code smells y mejoras de rendimiento. Sigue las convenciones del proyecto.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Lee convenciones-codigo si existe\n2. Analiza el código proporcionado\n3. Categoriza los hallazgos: 🔴 Crítico, 🟡 Mejora, 🟢 Sugerencia\n4. Proporciona código corregido para cada hallazgo crítico\n\n### Formato de salida\n- Lista priorizada de hallazgos\n- Cada hallazgo: ubicación, descripción, severidad, solución\n- Resumen ejecutivo al final",
        &["revisar código", "code review", "revisar PR", "analizar código"],
        &["convenciones-codigo"],
    )?;

    write_memory_file(
        root, ".ai/skills", "debugger.md", "debugger",
        MemoryType::Skill,
        "Skill: Debugger sistemático para resolver bugs paso a paso",
        0.85,
        &["debug", "bugs", "errores", "desarrollo"],
        "Guía un proceso de debugging sistemático: reproducir, aislar, diagnosticar, corregir, verificar.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Pide que describan el error y el comportamiento esperado\n2. Solicita logs, stack traces, o mensajes de error\n3. Formula hipótesis ordenadas por probabilidad\n4. Sugiere pasos de verificación para cada hipótesis\n5. Proporciona el fix cuando se identifique la causa\n\n### Formato\n- Hipótesis numeradas con probabilidad estimada\n- Comandos exactos para verificar cada una\n- Fix con explicación de por qué funciona",
        &["debug", "debuggear", "error", "bug", "no funciona"],
        &["stack-tecnologico"],
    )?;

    write_memory_file(
        root, ".ai/skills", "architect.md", "architect",
        MemoryType::Skill,
        "Skill: Arquitecto de software para diseño de sistemas",
        0.80,
        &["arquitectura", "diseño", "sistema", "desarrollo"],
        "Diseña arquitectura de software considerando escalabilidad, mantenibilidad y las restricciones del proyecto.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Lee el stack-tecnologico y el contexto del proyecto\n2. Identifica requisitos funcionales y no funcionales\n3. Propón 2-3 opciones arquitectónicas con pros/contras\n4. Recomienda una opción con justificación\n5. Genera diagrama en Mermaid si es útil\n\n### Formato\n- Diagrama de alto nivel (Mermaid)\n- Componentes principales con responsabilidades\n- Flujo de datos\n- Decisiones clave con justificación",
        &["diseñar arquitectura", "diseño sistema", "arquitectura"],
        &["stack-tecnologico", "perfil-profesional"],
    )?;

    // Rules
    write_memory_file(
        root, ".ai/rules", "convenciones-codigo.md", "convenciones-codigo",
        MemoryType::Rule,
        "Convenciones de código del proyecto",
        0.9,
        &["código", "convenciones", "estilo"],
        "Define las convenciones de código, naming, estructura de archivos y patrones preferidos.",
        "## Convenciones\n\n_Personaliza estas convenciones según tu stack:_\n\n- **Naming:** camelCase para variables/funciones, PascalCase para clases/componentes\n- **Archivos:** kebab-case para nombres de archivo\n- **Commits:** conventional commits (feat:, fix:, refactor:, etc.)\n- **Tests:** colocados junto al código fuente, sufijo .test o .spec\n- **Documentación:** JSDoc/TSDoc para funciones públicas\n\n## Anti-patrones a evitar\n- No usar `any` en TypeScript\n- No commitear secrets o .env files\n- No ignorar errores con catch vacíos",
        &[],
        &[],
    )?;

    // Context
    write_memory_file(
        root, ".ai/context", "stack-tecnologico.md", "stack-tecnologico",
        MemoryType::Context,
        "Stack tecnológico del proyecto principal",
        0.9,
        &["tecnología", "stack", "desarrollo"],
        "Define el stack tecnológico principal. Edita este archivo con tu stack real.",
        "## Stack Tecnológico\n\n_Rellena con tu stack real:_\n\n### Frontend\n- Framework: _ej. React, Vue, Svelte_\n- Lenguaje: _ej. TypeScript_\n- Estilos: _ej. Tailwind CSS_\n\n### Backend\n- Runtime: _ej. Node.js, Python, Rust_\n- Framework: _ej. Express, FastAPI_\n- Base de datos: _ej. PostgreSQL, MongoDB_\n\n### Infraestructura\n- Hosting: _ej. Vercel, AWS_\n- CI/CD: _ej. GitHub Actions_\n- Monitoreo: _ej. Sentry_",
        &[],
        &[],
    )?;

    Ok(())
}

fn create_creator_template(root: &std::path::Path) -> Result<(), String> {
    // Skills
    write_memory_file(
        root, ".ai/skills", "linkedin-post-writer.md", "linkedin-post-writer",
        MemoryType::Skill,
        "Skill: Escritor de posts de LinkedIn en el estilo del usuario",
        0.85,
        &["escritura", "linkedin", "contenido", "marketing"],
        "Genera posts de LinkedIn persuasivos usando el estilo de voz del usuario, optimizados para engagement.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Lee el archivo de marca-y-voz para capturar el tono\n2. Revisa el perfil-profesional para contexto de autoridad\n3. Estructura: Hook (2 líneas) → Desarrollo (5-8 líneas) → CTA\n4. Usa emojis con moderación, máximo 3-4\n5. Longitud ideal: 150-250 palabras\n\n### Formato\n- Hook que genere curiosidad o controversia\n- Párrafos cortos (1-2 líneas)\n- Cierra con pregunta o llamada a la acción\n- Sugiere 3-5 hashtags relevantes",
        &["escribir post", "contenido LinkedIn", "publicación social", "post para redes"],
        &["marca-y-voz", "perfil-profesional"],
    )?;

    write_memory_file(
        root, ".ai/skills", "newsletter-writer.md", "newsletter-writer",
        MemoryType::Skill,
        "Skill: Escritor de newsletters con estructura persuasiva",
        0.80,
        &["escritura", "newsletter", "email", "contenido"],
        "Genera newsletters con estructura de engagement: subject line, intro hook, valor, CTA.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Lee marca-y-voz para el tono\n2. Solicita el tema principal y los puntos clave\n3. Genera 3 opciones de subject line (A/B testing)\n4. Estructura: Saludo → Hook → 3 puntos de valor → CTA → Despedida\n\n### Formato\n- Subject line < 50 caracteres\n- Preview text complementario\n- Párrafos de máximo 3 líneas\n- Al menos un dato o estadística\n- CTA claro y único",
        &["escribir newsletter", "email newsletter", "newsletter"],
        &["marca-y-voz", "perfil-profesional"],
    )?;

    write_memory_file(
        root, ".ai/skills", "content-repurposer.md", "content-repurposer",
        MemoryType::Skill,
        "Skill: Reutilizador de contenido para múltiples plataformas",
        0.75,
        &["contenido", "repurpose", "multiplataforma"],
        "Transforma un contenido largo en múltiples piezas para diferentes plataformas.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Recibe el contenido original (artículo, vídeo transcrito, etc.)\n2. Extrae los 5-7 puntos clave\n3. Genera adaptaciones para cada plataforma:\n   - LinkedIn: post con hook + desarrollo + CTA\n   - Twitter/X: hilo de 5-8 tweets\n   - Instagram: carrusel de 7-10 slides (texto)\n   - Newsletter: resumen con link al original\n\n### Formato\n- Cada pieza etiquetada por plataforma\n- Mantener la voz del usuario en todas",
        &["repurpose", "reutilizar contenido", "adaptar contenido"],
        &["marca-y-voz"],
    )?;

    // Rules
    write_memory_file(
        root, ".ai/rules", "marca-y-voz.md", "marca-y-voz",
        MemoryType::Rule,
        "Guía de marca y tono de voz del usuario",
        0.95,
        &["marca", "voz", "tono", "comunicación"],
        "Define el tono, estilo y personalidad de la comunicación. Se carga siempre en tareas de escritura.",
        "## Guía de Marca y Voz\n\n_Personaliza según tu estilo:_\n\n### Tono\n- **Profesional pero cercano** — no corporativo ni frío\n- Usa analogías y ejemplos concretos\n- Directo, sin rodeos\n\n### Vocabulario\n- Evitar: _jerga excesiva, anglicismos innecesarios_\n- Preferir: _lenguaje claro, frases cortas_\n\n### Personalidad\n- _Describe tu personalidad de marca en 3 adjetivos_\n\n### Ejemplos de tu estilo\n- _Pega aquí 2-3 párrafos que representen tu voz ideal_",
        &[],
        &[],
    )?;

    write_memory_file(
        root, ".ai/rules", "estilo-comunicacion.md", "estilo-comunicacion",
        MemoryType::Rule,
        "Reglas de estilo para toda comunicación escrita",
        0.85,
        &["estilo", "comunicación", "escritura"],
        "Reglas generales de escritura: longitud, formato, audiencia.",
        "## Reglas de Estilo\n\n- **Longitud:** preferir textos concisos. Si puede decirse en 1 párrafo, no usar 3.\n- **Estructura:** usar bullets y subtítulos para contenido largo\n- **Audiencia:** escribir para profesionales del sector, no para principiantes (salvo que se indique)\n- **Datos:** siempre respaldar afirmaciones con datos o ejemplos\n- **Emojis:** usar con moderación, solo en redes sociales",
        &[],
        &[],
    )?;

    Ok(())
}

fn create_entrepreneur_template(root: &std::path::Path) -> Result<(), String> {
    // Skills
    write_memory_file(
        root, ".ai/skills", "strategic-analyzer.md", "strategic-analyzer",
        MemoryType::Skill,
        "Skill: Análisis estratégico de negocio y mercado",
        0.85,
        &["estrategia", "negocio", "análisis", "mercado"],
        "Analiza oportunidades de negocio, competencia y mercado con frameworks estratégicos.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Lee el contexto del proyecto/negocio\n2. Aplica el framework adecuado: SWOT, Porter's 5 Forces, Jobs-to-be-Done\n3. Identifica oportunidades y amenazas clave\n4. Proporciona recomendaciones accionables con prioridad\n\n### Formato\n- Framework visual (tabla o lista)\n- Top 3 oportunidades con justificación\n- Top 3 riesgos con mitigación\n- Próximos pasos concretos",
        &["analizar mercado", "estrategia", "análisis competencia", "SWOT"],
        &["perfil-profesional"],
    )?;

    write_memory_file(
        root, ".ai/skills", "meeting-action-items.md", "meeting-action-items",
        MemoryType::Skill,
        "Skill: Extractor de action items de reuniones",
        0.80,
        &["reuniones", "tareas", "actas", "productividad"],
        "Extrae decisiones, action items y próximos pasos de notas o transcripciones de reuniones.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Recibe notas o transcripción de la reunión\n2. Identifica: decisiones tomadas, tareas asignadas, dudas abiertas\n3. Genera resumen estructurado\n4. Appenda action items al backlog.jsonl\n\n### Formato\n- **Decisiones:** lista numerada\n- **Action Items:** tabla con [Quién] [Qué] [Cuándo]\n- **Dudas abiertas:** para resolver en próxima reunión\n- **Resumen ejecutivo:** 3-5 líneas",
        &["reunión", "meeting", "action items", "acta"],
        &["perfil-profesional"],
    )?;

    write_memory_file(
        root, ".ai/skills", "task-prioritizer.md", "task-prioritizer",
        MemoryType::Skill,
        "Skill: Priorizador de tareas con matriz Eisenhower",
        0.80,
        &["tareas", "priorización", "productividad", "gestión"],
        "Prioriza tareas usando la matriz Eisenhower (urgente/importante) y sugiere un plan de acción.",
        "## Instrucciones para la IA\n\n### Proceso\n1. Lee el backlog actual de tareas\n2. Clasifica cada tarea en la matriz:\n   - 🔴 Urgente + Importante → Hacer ahora\n   - 🟡 No urgente + Importante → Planificar\n   - 🟠 Urgente + No importante → Delegar\n   - ⚪ Ni urgente ni importante → Eliminar\n3. Genera plan de acción para hoy y esta semana\n\n### Formato\n- Matriz visual 2x2\n- Plan de hoy: máximo 3 tareas\n- Plan semanal: 5-7 tareas priorizadas",
        &["priorizar tareas", "qué hacer primero", "plan del día", "organizar tareas"],
        &[],
    )?;

    // Rules
    write_memory_file(
        root, ".ai/rules", "restricciones.md", "restricciones",
        MemoryType::Rule,
        "Restricciones y directrices generales para la IA",
        0.95,
        &["restricciones", "reglas", "límites"],
        "Reglas que la IA debe respetar siempre al trabajar contigo.",
        "## Restricciones Generales\n\n_Personaliza según tus preferencias:_\n\n- **Idioma:** Responder siempre en español salvo que se pida otro idioma\n- **Formato:** Preferir bullets sobre párrafos largos\n- **Decisiones:** No tomar decisiones de negocio sin confirmación explícita\n- **Datos sensibles:** No incluir datos financieros reales en outputs compartibles\n- **Tono:** Profesional pero no formal. Tutear al usuario.\n- **Extensión:** Ser conciso. Si la respuesta puede ser corta, que lo sea.",
        &[],
        &[],
    )?;

    Ok(())
}
