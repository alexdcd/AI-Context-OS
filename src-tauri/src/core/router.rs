use crate::core::types::{Config, MemoryMeta, MemoryType};

/// Generate the neutral router content.
/// Order follows attention positioning: RULES at top, L0 index at bottom.
/// This output is consumed by adapters in compat.rs to produce tool-specific files.
pub fn generate_router_content(memories: &[MemoryMeta], config: &Config) -> String {
    let mut out = String::with_capacity(8192);

    // ========== SECTION 1: RULES (top — maximum attention) ==========
    out.push_str("# RULES\n\n");
    let rules: Vec<&MemoryMeta> = memories
        .iter()
        .filter(|m| m.memory_type == MemoryType::Rule)
        .collect();
    if rules.is_empty() {
        out.push_str("_No rules defined yet. Add rules in 08-rules/_\n\n");
    } else {
        for rule in &rules {
            out.push_str(&format!("- **{}**: {}\n", rule.id, rule.l0));
        }
        out.push('\n');
    }

    // ========== SECTION 2: Read/Write Rules ==========
    out.push_str("# Reglas de Lectura y Escritura de Memorias\n\n");
    out.push_str("## Lectura\n");
    out.push_str("1. Lee SOLO los archivos que necesites para la tarea actual\n");
    out.push_str("2. Empieza siempre por el nivel L1 (resumen)\n");
    out.push_str("3. Carga L2 (completo) SOLO si L1 no tiene suficiente detalle\n");
    out.push_str("4. NUNCA cargues más de 5 archivos L2 en una sola consulta\n");
    out.push_str("5. Si la tarea es simple, 2-3 archivos L1 deberían ser suficientes\n");
    out.push_str("6. Prioriza: rules > context > skills > projects > resources\n");
    out.push_str("7. Memorias con always_load: true se cargan SIEMPRE como L1 para su tipo de tarea\n");
    out.push_str("8. Si un output de herramienta supera 2000 tokens, escríbelo en 09-scratch/\n\n");

    out.push_str("## Escritura\n");
    out.push_str("- Usa el frontmatter YAML estándar (id, type, l0, importance, tags, related)\n");
    out.push_str("- Separa contenido con <!-- L1 --> y <!-- L2 -->\n");
    out.push_str("- Incrementa version: y actualiza modified: al editar\n");
    out.push_str("- Archivos temporales van a 09-scratch/ con nombre descriptivo + timestamp\n\n");

    // ========== SECTION 3: Folder Structure ==========
    out.push_str("# Estructura de Carpetas\n\n");
    out.push_str("```\n");
    out.push_str(&format!("{}/\n", config.root_dir));
    out.push_str("├── claude.md                    ← ESTE ARCHIVO (enrutador maestro)\n");
    out.push_str("├── _index.yaml                  ← catálogo L0 autogenerado\n");
    out.push_str("├── _config.yaml                 ← configuración global\n");
    out.push_str("├── 01-context/                  ← información estática del usuario\n");
    out.push_str("├── 02-daily/                    ← registros diarios (JSONL)\n");
    out.push_str("│   ├── daily-log.jsonl\n");
    out.push_str("│   └── sessions/\n");
    out.push_str("├── 03-intelligence/             ← investigación, mercado\n");
    out.push_str("├── 04-projects/                 ← un subdirectorio por proyecto\n");
    out.push_str("├── 05-resources/                ← plantillas, ejemplos\n");
    out.push_str("├── 06-skills/                   ← habilidades/instrucciones IA\n");
    out.push_str("├── 07-tasks/                    ← tareas (JSONL)\n");
    out.push_str("│   └── backlog.jsonl\n");
    out.push_str("├── 08-rules/                    ← restricciones y directrices\n");
    out.push_str("└── 09-scratch/                  ← buffer temporal de la IA\n");
    out.push_str("```\n\n");

    // ========== SECTION 4: Compaction Rule ==========
    out.push_str("# Regla de Compaction de Sesión\n\n");
    out.push_str("Si llevas más de 15-20 intercambios en esta sesión:\n");
    out.push_str("1. Escribe un resumen estructurado en 02-daily/sessions/YYYY-MM-DD-resumen.md\n");
    out.push_str("2. Incluye: decisiones tomadas, hechos nuevos, tareas pendientes\n");
    out.push_str("3. Appenda los hechos clave al daily-log.jsonl\n");
    out.push_str("4. Sugiere al usuario iniciar nueva sesión para tareas no relacionadas\n\n");
    out.push_str("Si generas un output largo (análisis, búsqueda, código):\n");
    out.push_str("1. Escríbelo en 09-scratch/ con nombre descriptivo + timestamp\n");
    out.push_str("2. Referencia la ruta en la conversación\n");
    out.push_str("3. Lee selectivamente cuando necesites datos específicos\n\n");

    // ========== SECTION 5: L0 Memory Index (bottom — high attention) ==========
    out.push_str("# Índice de Memorias Disponibles\n\n");

    // Group by type
    let types_order = [
        MemoryType::Rule,
        MemoryType::Context,
        MemoryType::Skill,
        MemoryType::Project,
        MemoryType::Intelligence,
        MemoryType::Resource,
        MemoryType::Task,
    ];

    for memory_type in &types_order {
        let type_memories: Vec<&MemoryMeta> = memories
            .iter()
            .filter(|m| &m.memory_type == memory_type)
            .collect();

        if type_memories.is_empty() {
            continue;
        }

        out.push_str(&format!("## {}\n", type_label(memory_type)));
        for m in &type_memories {
            let sticky = if m.always_load { " 📌" } else { "" };
            out.push_str(&format!(
                "- [{}] {} (imp:{:.1}){}\n",
                m.id, m.l0, m.importance, sticky
            ));
        }
        out.push('\n');
    }

    // Skills with triggers
    let skills: Vec<&MemoryMeta> = memories
        .iter()
        .filter(|m| m.memory_type == MemoryType::Skill && !m.triggers.is_empty())
        .collect();

    if !skills.is_empty() {
        out.push_str("## Triggers de Skills\n");
        for skill in &skills {
            out.push_str(&format!(
                "- Cuando el usuario diga: {} → usar skill [{}]\n",
                skill.triggers.join(", "),
                skill.id
            ));
        }
        out.push('\n');
    }

    out
}

fn type_label(t: &MemoryType) -> &str {
    match t {
        MemoryType::Rule => "📋 Reglas",
        MemoryType::Context => "👤 Contexto",
        MemoryType::Skill => "⚡ Skills",
        MemoryType::Project => "📁 Proyectos",
        MemoryType::Intelligence => "🔍 Inteligencia",
        MemoryType::Resource => "📦 Recursos",
        MemoryType::Task => "✅ Tareas",
        MemoryType::Daily => "📅 Daily",
        MemoryType::Scratch => "📝 Scratch",
    }
}

/// Generate the _index.yaml catalog from all memory metadata.
pub fn generate_index_yaml(memories: &[MemoryMeta]) -> String {
    let mut out = String::from("# AI Context OS — Index L0 (autogenerated)\n# Do not edit manually\n\nmemories:\n");
    for m in memories {
        out.push_str(&format!(
            "  - id: {}\n    type: {:?}\n    l0: \"{}\"\n    importance: {}\n    tags: [{}]\n",
            m.id,
            m.memory_type,
            m.l0.replace('"', "\\\""),
            m.importance,
            m.tags.join(", ")
        ));
    }
    out
}
