use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::core::types::{Config, Memory, MemoryMeta, MemoryOntology, MemoryStatus, SystemRole};

#[derive(Debug, Clone, Serialize)]
pub struct RouterManifest {
    pub root_dir: String,
    pub total_memories: usize,
    pub rules: Vec<RouterMemoryEntry>,
    pub skills: Vec<RouterMemoryEntry>,
    pub collections: Vec<RouterCollection>,
    pub memories: Vec<RouterMemoryEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RouterCollection {
    pub name: String,
    pub memories: Vec<RouterMemoryEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RouterMemoryEntry {
    pub id: String,
    pub path: String,
    pub l0: String,
    pub ontology: MemoryOntology,
    pub importance: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_role: Option<SystemRole>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub related: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub derived_from: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub triggers: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub optional: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<MemoryStatus>,
    #[serde(skip_serializing_if = "is_false")]
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize)]
struct RouterIndex {
    pub root_dir: String,
    pub total_memories: usize,
    pub memories: Vec<RouterMemoryEntry>,
}

pub fn build_router_manifest(
    entries: &[(MemoryMeta, String)],
    root: &Path,
    config: &Config,
) -> RouterManifest {
    let mut rules = Vec::new();
    let mut skills = Vec::new();
    let mut collections: BTreeMap<String, Vec<RouterMemoryEntry>> = BTreeMap::new();
    let mut memories = Vec::new();

    for (meta, path) in entries {
        let entry = RouterMemoryEntry::from_meta(meta, path, root);
        match entry.system_role {
            Some(SystemRole::Rule) => rules.push(entry.clone()),
            Some(SystemRole::Skill) => skills.push(entry.clone()),
            None => {
                let key = entry
                    .folder_category
                    .clone()
                    .unwrap_or_else(|| "uncategorized".to_string());
                collections.entry(key).or_default().push(entry.clone());
            }
        }
        memories.push(entry);
    }

    rules.sort_by(memory_entry_cmp);
    skills.sort_by(memory_entry_cmp);
    memories.sort_by(memory_entry_cmp);

    let mut grouped = collections
        .into_iter()
        .map(|(name, mut memories)| {
            memories.sort_by(memory_entry_cmp);
            RouterCollection { name, memories }
        })
        .collect::<Vec<_>>();
    grouped.sort_by(collection_cmp);

    RouterManifest {
        root_dir: config.root_dir.clone(),
        total_memories: memories.len(),
        rules,
        skills,
        collections: grouped,
        memories,
    }
}

pub fn build_router_manifest_from_memories(
    memories: &[Memory],
    root: &Path,
    config: &Config,
) -> RouterManifest {
    let entries = memories
        .iter()
        .map(|memory| (memory.meta.clone(), memory.file_path.clone()))
        .collect::<Vec<_>>();
    build_router_manifest(&entries, root, config)
}

pub fn render_static_router(manifest: &RouterManifest) -> String {
    let mut out = String::with_capacity(8192);

    out.push_str("# RULES\n\n");
    if manifest.rules.is_empty() {
        out.push_str("_No rules defined yet. Add rules in `.ai/rules/`._\n\n");
    } else {
        for rule in &manifest.rules {
            out.push_str(&format!("- [{}] {} — `{}`\n", rule.id, rule.l0, rule.path));
        }
        out.push('\n');
    }

    out.push_str("# How This Workspace Works\n\n");
    out.push_str("AI Context OS workspace. Canonical knowledge lives in Markdown memories with YAML frontmatter plus `<!-- L1 -->` / `<!-- L2 -->` markers.\n");
    out.push_str("If MCP is available, use the MCP tools first. If MCP is not available, use this file as the discovery map and then open only the canonical files you actually need.\n\n");
    out.push_str("Files like `claude.md`, `AGENTS.md`, `.cursorrules`, and `.windsurfrules` are generated adapter artifacts. They are not canonical memories and must not be used as scratchpads or note files.\n\n");

    out.push_str("# Reading Memories\n\n");
    out.push_str("1. Start from the compact L0 index in this file.\n");
    out.push_str("2. Open only the memories relevant to the current task.\n");
    out.push_str("3. Read L1 first. Open L2 only if L1 is insufficient.\n");
    out.push_str(
        "4. Use the path shown beside each memory to open the right canonical file directly.\n",
    );
    out.push_str("5. If you need richer metadata (links, provenance, dependencies), open `.ai/catalog.md` or `.ai/index.yaml`.\n");
    out.push_str("6. If output gets too large, write scratch output to `.ai/scratch/`.\n\n");

    out.push_str("# Writing Memories\n\n");
    out.push_str("Every memory is a `.md` file with YAML frontmatter and body markers.\n\n");
    out.push_str("Required fields:\n");
    out.push_str("- `id`: kebab-case and must match the filename\n");
    out.push_str("- `type`: ontology (`source`, `entity`, `concept`, `synthesis`)\n");
    out.push_str("- `l0`: one-line summary\n");
    out.push_str("- `importance`: 0.0-1.0\n");
    out.push_str("- `created`, `modified`, `version`\n\n");
    out.push_str("Key rules:\n");
    out.push_str("- Always keep both `<!-- L1 -->` and `<!-- L2 -->` markers\n");
    out.push_str("- Increment `version` and update `modified` when editing\n");
    out.push_str("- `protected: true` memories must be unlocked before editing or deleting\n");
    out.push_str("- Folder meaning is human-oriented; ontology lives in frontmatter\n\n");

    out.push_str("# Workspace Structure\n\n");
    out.push_str("```text\n");
    out.push_str(&format!("{}/\n", manifest.root_dir));
    out.push_str("├── inbox/\n");
    out.push_str("├── sources/\n");
    out.push_str("├── claude.md\n");
    out.push_str("├── AGENTS.md\n");
    out.push_str("├── .cursorrules\n");
    out.push_str("├── .windsurfrules\n");
    out.push_str("├── .ai/\n");
    out.push_str("│   ├── config.yaml\n");
    out.push_str("│   ├── index.yaml      # rich structured index\n");
    out.push_str("│   ├── catalog.md      # human-readable catalog with metadata\n");
    out.push_str("│   ├── rules/\n");
    out.push_str("│   ├── skills/\n");
    out.push_str("│   ├── journal/\n");
    out.push_str("│   └── scratch/\n");
    out.push_str("└── [your folders]/\n");
    out.push_str("```\n\n");

    out.push_str("# Compact Memory Index\n\n");
    if manifest.total_memories == 0 {
        out.push_str("_No memories yet. Create your first memory in `inbox/`._\n\n");
    } else {
        if !manifest.skills.is_empty() {
            out.push_str("## Skills\n");
            for skill in &manifest.skills {
                out.push_str(&format!(
                    "- [{}] {} — `{}` ({})\n",
                    skill.id,
                    skill.l0,
                    skill.path,
                    ontology_label(&skill.ontology)
                ));
            }
            out.push('\n');
        }

        for collection in &manifest.collections {
            out.push_str(&format!("## {}\n", collection.name));
            for memory in &collection.memories {
                out.push_str(&format!(
                    "- [{}] {} — `{}` ({})\n",
                    memory.id,
                    memory.l0,
                    memory.path,
                    ontology_label(&memory.ontology)
                ));
            }
            out.push('\n');
        }
    }

    let triggered_skills = manifest
        .skills
        .iter()
        .filter(|skill| !skill.triggers.is_empty())
        .collect::<Vec<_>>();
    if !triggered_skills.is_empty() {
        out.push_str("# Skill Triggers\n\n");
        for skill in triggered_skills {
            out.push_str(&format!(
                "- {} → [{}]\n",
                skill.triggers.join(", "),
                skill.id
            ));
        }
        out.push('\n');
    }

    out.push_str("# Rich Catalog\n\n");
    out.push_str("For paths, tags, links, provenance, dependencies, and protection state, open `.ai/catalog.md` or `.ai/index.yaml`.\n");

    out
}

pub fn render_catalog_markdown(manifest: &RouterManifest) -> String {
    let mut out = String::with_capacity(8192);
    out.push_str("# AI Context OS — Catalog\n\n");
    out.push_str("Rich catalog generated from canonical memories. Use this when the compact router index is not enough.\n\n");

    if !manifest.rules.is_empty() {
        out.push_str("## Rules\n\n");
        for rule in &manifest.rules {
            render_catalog_entry(&mut out, rule);
        }
    }

    if !manifest.skills.is_empty() {
        out.push_str("## Skills\n\n");
        for skill in &manifest.skills {
            render_catalog_entry(&mut out, skill);
        }
    }

    for collection in &manifest.collections {
        out.push_str(&format!("## {}\n\n", collection.name));
        for memory in &collection.memories {
            render_catalog_entry(&mut out, memory);
        }
    }

    if manifest.total_memories == 0 {
        out.push_str("_No memories yet._\n");
    }

    out
}

pub fn render_mcp_prelude(manifest: &RouterManifest) -> String {
    let mut out = String::with_capacity(2048);
    out.push_str("# MCP WORKSPACE RULES\n\n");
    out.push_str("You are already connected to AI Context OS via MCP.\n");
    out.push_str("Use `get_context` at the start of the task, `save_memory` for canonical memory writes, `get_skill` for skill dependency loading, and `log_session` for session events.\n");
    out.push_str("Canonical memories remain Markdown files with YAML frontmatter plus `<!-- L1 -->` / `<!-- L2 -->` markers.\n");
    out.push_str(
        "Protected memories and generated router artifacts must not be edited directly.\n\n",
    );

    if manifest.rules.is_empty() {
        out.push_str("## Active Rules\n\n_No rules defined yet._\n\n");
    } else {
        out.push_str("## Active Rules\n\n");
        for rule in &manifest.rules {
            out.push_str(&format!("- [{}] {}\n", rule.id, rule.l0));
        }
        out.push('\n');
    }

    let triggered_skills = manifest
        .skills
        .iter()
        .filter(|skill| !skill.triggers.is_empty())
        .collect::<Vec<_>>();
    if !triggered_skills.is_empty() {
        out.push_str("## Skill Triggers\n\n");
        for skill in triggered_skills {
            out.push_str(&format!(
                "- {} → [{}]\n",
                skill.triggers.join(", "),
                skill.id
            ));
        }
        out.push('\n');
    }

    out
}

pub fn generate_index_yaml(manifest: &RouterManifest) -> Result<String, String> {
    let index = RouterIndex {
        root_dir: manifest.root_dir.clone(),
        total_memories: manifest.total_memories,
        memories: manifest.memories.clone(),
    };

    let yaml = serde_yaml::to_string(&index)
        .map_err(|e| format!("Failed to serialize router index: {}", e))?;
    Ok(format!(
        "# AI Context OS — Rich Index (autogenerated)\n# Do not edit manually\n\n{}",
        yaml
    ))
}

impl RouterMemoryEntry {
    fn from_meta(meta: &MemoryMeta, path: &str, root: &Path) -> Self {
        Self {
            id: meta.id.clone(),
            path: relative_path(root, path),
            l0: meta.l0.clone(),
            ontology: meta.ontology.clone(),
            importance: meta.importance,
            folder_category: meta.folder_category.clone(),
            system_role: meta.system_role.clone(),
            tags: meta.tags.clone(),
            related: meta.related.clone(),
            derived_from: meta.derived_from.clone(),
            triggers: meta.triggers.clone(),
            requires: meta.requires.clone(),
            optional: meta.optional.clone(),
            output_format: meta.output_format.clone(),
            status: meta.status.clone(),
            protected: meta.protected,
        }
    }
}

fn render_catalog_entry(out: &mut String, memory: &RouterMemoryEntry) {
    out.push_str(&format!(
        "- [{}] {} — `{}`\n",
        memory.id, memory.l0, memory.path
    ));
    out.push_str(&format!(
        "  - ontology: {} | importance: {:.2}\n",
        ontology_label(&memory.ontology),
        memory.importance
    ));
    if let Some(role) = &memory.system_role {
        out.push_str(&format!("  - role: {}\n", system_role_label(role)));
    }
    if memory.protected {
        out.push_str("  - protected: true\n");
    }
    if let Some(status) = &memory.status {
        out.push_str(&format!("  - status: {}\n", status_label(status)));
    }
    if !memory.tags.is_empty() {
        out.push_str(&format!("  - tags: {}\n", memory.tags.join(", ")));
    }
    if !memory.related.is_empty() {
        out.push_str(&format!("  - related: {}\n", memory.related.join(", ")));
    }
    if !memory.derived_from.is_empty() {
        out.push_str(&format!(
            "  - derived_from: {}\n",
            memory.derived_from.join(", ")
        ));
    }
    if !memory.triggers.is_empty() {
        out.push_str(&format!("  - triggers: {}\n", memory.triggers.join(", ")));
    }
    if !memory.requires.is_empty() {
        out.push_str(&format!("  - requires: {}\n", memory.requires.join(", ")));
    }
    if !memory.optional.is_empty() {
        out.push_str(&format!("  - optional: {}\n", memory.optional.join(", ")));
    }
    if let Some(output_format) = &memory.output_format {
        out.push_str(&format!("  - output_format: {}\n", output_format));
    }
    out.push('\n');
}

fn relative_path(root: &Path, path: &str) -> String {
    let path = Path::new(path);
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn collection_cmp(a: &RouterCollection, b: &RouterCollection) -> Ordering {
    collection_rank(&a.name)
        .cmp(&collection_rank(&b.name))
        .then_with(|| a.name.cmp(&b.name))
}

fn collection_rank(name: &str) -> usize {
    match name {
        "inbox" => 0,
        "sources" => 1,
        _ => 2,
    }
}

fn memory_entry_cmp(a: &RouterMemoryEntry, b: &RouterMemoryEntry) -> Ordering {
    a.path.cmp(&b.path).then_with(|| a.id.cmp(&b.id))
}

fn ontology_label(ontology: &MemoryOntology) -> &str {
    match ontology {
        MemoryOntology::Source => "source",
        MemoryOntology::Entity => "entity",
        MemoryOntology::Concept => "concept",
        MemoryOntology::Synthesis => "synthesis",
        MemoryOntology::Unknown => "unknown",
    }
}

fn system_role_label(role: &SystemRole) -> &str {
    match role {
        SystemRole::Rule => "rule",
        SystemRole::Skill => "skill",
    }
}

fn status_label(status: &MemoryStatus) -> &str {
    match status {
        MemoryStatus::Unprocessed => "unprocessed",
        MemoryStatus::Processed => "processed",
        MemoryStatus::Unknown => "unknown",
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}
