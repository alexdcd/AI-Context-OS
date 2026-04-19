use std::path::{Path, PathBuf};

use crate::core::types::{MemoryMeta, SystemRole};

/// Centralized path resolution for the `.ai/` system infrastructure
/// and fixed workspace files. All system paths flow through this struct.
pub struct SystemPaths {
    root: PathBuf,
}

// ── System directory names (relative to workspace root) ──

pub const AI_DIR: &str = ".ai";
pub const INBOX_DIR: &str = "inbox";
pub const SOURCES_DIR: &str = "sources";
pub const RULES_DIR: &str = "rules";
pub const SKILLS_DIR: &str = "skills";

// ── Directories to skip during recursive memory scan ──

pub const SCAN_SKIP_DIRS: &[&str] = &[".git", "node_modules", ".cache"];

/// `.ai/` subdirectories that are system-managed and should NOT be indexed as memories.
/// Rules, skills, and context subdirs ARE scannable (they contain user-authored memory files).
pub const AI_SKIP_SUBDIRS: &[&str] = &["scratch", "journal", "ingest", "proposals"];

impl SystemPaths {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
        }
    }

    // ── .ai/ subtree ──

    pub fn ai_dir(&self) -> PathBuf {
        self.root.join(AI_DIR)
    }

    pub fn config_yaml(&self) -> PathBuf {
        self.root.join(".ai/config.yaml")
    }

    pub fn index_yaml(&self) -> PathBuf {
        self.root.join(".ai/index.yaml")
    }
    pub fn catalog_md(&self) -> PathBuf {
        self.root.join(".ai/catalog.md")
    }

    pub fn rules_dir(&self) -> PathBuf {
        self.root.join(".ai/rules")
    }

    pub fn skills_dir(&self) -> PathBuf {
        self.root.join(".ai/skills")
    }

    pub fn journal_dir(&self) -> PathBuf {
        self.root.join(".ai/journal")
    }

    pub fn sessions_dir(&self) -> PathBuf {
        self.root.join(".ai/journal/sessions")
    }

    pub fn daily_log(&self) -> PathBuf {
        self.root.join(".ai/journal/daily-log.jsonl")
    }

    pub fn scratch_dir(&self) -> PathBuf {
        self.root.join(".ai/scratch")
    }

    pub fn ingest_dir(&self) -> PathBuf {
        self.root.join(".ai/ingest")
    }

    pub fn ingest_manifest(&self) -> PathBuf {
        self.root.join(".ai/ingest/manifest.json")
    }

    pub fn proposals_dir(&self) -> PathBuf {
        self.root.join(".ai/proposals")
    }

    pub fn inference_provider_json(&self) -> PathBuf {
        self.root.join(".ai/inference-provider.json")
    }

    pub fn inbox_attachments_dir(&self) -> PathBuf {
        self.root.join("inbox/_attachments")
    }

    pub fn usage_json(&self) -> PathBuf {
        self.root.join(".cache/memory-usage.json")
    }

    // ── Root-level files ──

    pub fn inbox_dir(&self) -> PathBuf {
        self.root.join(INBOX_DIR)
    }

    pub fn sources_dir(&self) -> PathBuf {
        self.root.join(SOURCES_DIR)
    }

    pub fn claude_md(&self) -> PathBuf {
        self.root.join("claude.md")
    }

    pub fn agents_md(&self) -> PathBuf {
        self.root.join("AGENTS.md")
    }

    pub fn cursorrules(&self) -> PathBuf {
        self.root.join(".cursorrules")
    }

    pub fn windsurfrules(&self) -> PathBuf {
        self.root.join(".windsurfrules")
    }

    /// All system directories that must exist for the workspace to function.
    pub fn system_dirs(&self) -> Vec<PathBuf> {
        vec![
            self.inbox_dir(),
            self.sources_dir(),
            self.ai_dir(),
            self.rules_dir(),
            self.skills_dir(),
            self.journal_dir(),
            self.sessions_dir(),
            self.scratch_dir(),
            self.ingest_dir(),
            self.proposals_dir(),
            self.inbox_attachments_dir(),
        ]
    }
}

/// Expand `~/` prefixes to the actual home directory.
pub fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

pub fn folder_category(path: &Path, root: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut components = relative.components();
    let first = components.next()?.as_os_str().to_string_lossy().to_string();
    if first.is_empty() {
        None
    } else {
        Some(first)
    }
}

pub fn system_role(path: &Path, root: &Path) -> Option<SystemRole> {
    // Primary: read the role from .folder.yaml in the parent directory.
    if let Some(parent) = path.parent() {
        if let Some(contract) = crate::core::folder_contract::load_folder_contract(parent) {
            return match contract.role.as_str() {
                "skill" => Some(SystemRole::Skill),
                "rule" => Some(SystemRole::Rule),
                _ => None,
            };
        }
    }

    // Fallback: hardcoded path-based detection for workspaces without .folder.yaml.
    let relative = path.strip_prefix(root).ok()?;
    let mut components = relative.components();
    let first = components.next()?.as_os_str().to_string_lossy();
    if first != AI_DIR {
        return None;
    }
    let second = components.next()?.as_os_str().to_string_lossy();
    match second.as_ref() {
        RULES_DIR => Some(SystemRole::Rule),
        SKILLS_DIR => Some(SystemRole::Skill),
        _ => None,
    }
}

pub fn enrich_memory_meta(meta: &mut MemoryMeta, path: &Path, root: &Path) {
    meta.folder_category = folder_category(path, root);
    meta.system_role = system_role(path, root);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_category_uses_first_workspace_segment() {
        let root = PathBuf::from("/workspace");
        let path = root.join("ideas/nota.md");
        assert_eq!(folder_category(&path, &root), Some("ideas".to_string()));
    }

    #[test]
    fn system_role_detects_skills_and_rules_by_reserved_folder() {
        let root = PathBuf::from("/workspace");
        assert_eq!(
            system_role(&root.join(".ai/skills/mi-skill.md"), &root),
            Some(SystemRole::Skill)
        );
        assert_eq!(
            system_role(&root.join(".ai/rules/mi-regla.md"), &root),
            Some(SystemRole::Rule)
        );
        assert_eq!(system_role(&root.join("ideas/nota.md"), &root), None);
    }
}
