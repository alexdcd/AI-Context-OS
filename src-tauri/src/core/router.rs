use crate::core::types::{Config, MemoryMeta, MemoryOntology, MemoryType};

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
        out.push_str("_No rules defined yet. Add rules in .ai/rules/_\n\n");
    } else {
        for rule in &rules {
            out.push_str(&format!("- **{}**: {}\n", rule.id, rule.l0));
        }
        out.push('\n');
    }

    // ========== SECTION 2: Read/Write Rules ==========
    out.push_str("# Memory Read/Write Rules\n\n");
    out.push_str("## Reading\n");
    out.push_str("1. Only read the files you need for the current task\n");
    out.push_str("2. Always start with L1 level (summary)\n");
    out.push_str("3. Load L2 (full) ONLY if L1 doesn't have enough detail\n");
    out.push_str("4. NEVER load more than 5 L2 files in a single query\n");
    out.push_str("5. For simple tasks, 2-3 L1 files should be enough\n");
    out.push_str("6. Priority: rules > context > skills > projects > resources\n");
    out.push_str(
        "7. Memories with always_load: true are ALWAYS loaded as L1 for their task type\n",
    );
    out.push_str("8. If a tool output exceeds 2000 tokens, write it to .ai/scratch/\n\n");

    out.push_str("## Writing\n");
    out.push_str("- Use standard YAML frontmatter (id, type, l0, importance, tags, related)\n");
    out.push_str("- Separate content with <!-- L1 --> and <!-- L2 -->\n");
    out.push_str("- Increment version: and update modified: when editing\n");
    out.push_str("- Temporary files go to .ai/scratch/ with descriptive name + timestamp\n");
    out.push_str("- The `type` field in frontmatter determines the memory's semantic category, NOT the folder it lives in\n\n");

    // ========== SECTION 3: Ingestion Rule ==========
    out.push_str("## Ingestion\n");
    out.push_str("- When working with files from `inbox/`, read `inbox/_INGEST.md` first and follow its protocol\n");
    out.push_str("- Protected files (protected: true) must NOT be edited without explicit user unlock\n\n");

    // ========== SECTION 4: Workspace Structure ==========
    out.push_str("# Workspace Structure\n\n");
    out.push_str("This workspace uses a Zero Gravity architecture: the folder structure is free-form.\n");
    out.push_str("Memory type is determined by the `type` field in YAML frontmatter, not by folder location.\n");
    out.push_str("The user can organize files in any folder hierarchy they prefer.\n\n");
    out.push_str("```\n");
    out.push_str(&format!("{}/\n", config.root_dir));
    out.push_str("├── inbox/                  ← staging area for new files\n");
    out.push_str("├── sources/                ← accepted reference material (protected)\n");
    out.push_str("├── claude.md               ← THIS FILE (master router)\n");
    out.push_str("├── .ai/                    ← system infrastructure (do not edit manually)\n");
    out.push_str("│   ├── config.yaml\n");
    out.push_str("│   ├── index.yaml\n");
    out.push_str("│   ├── rules/              ← AI behavior directives\n");
    out.push_str("│   ├── journal/            ← daily log and session notes\n");
    out.push_str("│   ├── tasks/              ← task files\n");
    out.push_str("│   └── scratch/            ← temporary AI outputs\n");
    out.push_str("└── [your folders]/         ← any structure you want\n");
    out.push_str("```\n\n");

    // ========== SECTION 5: Compaction Rule ==========
    out.push_str("# Session Compaction Rule\n\n");
    out.push_str("If you have been exchanging for more than 15-20 turns in this session:\n");
    out.push_str("1. Write a structured summary in .ai/journal/sessions/YYYY-MM-DD-summary.md\n");
    out.push_str("2. Include: decisions made, new facts, pending tasks\n");
    out.push_str("3. Append key facts to the daily-log.jsonl\n");
    out.push_str("4. Suggest the user start a new session for unrelated tasks\n\n");
    out.push_str("If you generate a long output (analysis, search, code):\n");
    out.push_str("1. Write it to .ai/scratch/ with descriptive name + timestamp\n");
    out.push_str("2. Reference the path in the conversation\n");
    out.push_str("3. Read selectively when you need specific data\n\n");

    // ========== SECTION 6: L0 Memory Index (bottom — high attention) ==========
    out.push_str("# Índice de Memorias Disponibles\n\n");

    // Group by type
    let types_order = [
        MemoryType::Rule,
        MemoryType::Context,
        MemoryType::Source,
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
            let ontology = m
                .ontology
                .as_ref()
                .map(ontology_label)
                .unwrap_or("sin-ontologia");
            out.push_str(&format!(
                "- [{}] {} (imp:{:.1}, ont:{}){}\n",
                m.id, m.l0, m.importance, ontology, sticky
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
        MemoryType::Source => "📄 Fuentes",
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
    let mut out = String::from(
        "# AI Context OS — Index L0 (autogenerated)\n# Do not edit manually\n\nmemories:\n",
    );
    for m in memories {
        out.push_str(&format!(
            "  - id: {}\n    type: {:?}\n    ontology: {}\n    l0: \"{}\"\n    importance: {}\n    tags: [{}]\n",
            m.id,
            m.memory_type,
            m.ontology
                .as_ref()
                .map(ontology_label)
                .unwrap_or("sin-ontologia"),
            m.l0.replace('"', "\\\""),
            m.importance,
            m.tags.join(", ")
        ));
    }
    out
}

fn ontology_label(ontology: &MemoryOntology) -> &str {
    match ontology {
        MemoryOntology::Source => "source",
        MemoryOntology::Entity => "entity",
        MemoryOntology::Concept => "concept",
        MemoryOntology::Synthesis => "synthesis",
    }
}
