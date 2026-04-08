use std::path::{Path, PathBuf};

/// Centralized path resolution for the `.ai/` system infrastructure
/// and fixed workspace files. All system paths flow through this struct.
pub struct SystemPaths {
    root: PathBuf,
}

// ── System directory names (relative to workspace root) ──

pub const AI_DIR: &str = ".ai";
pub const INBOX_DIR: &str = "inbox";
pub const SOURCES_DIR: &str = "sources";

// ── Directories to skip during recursive memory scan ──

pub const SCAN_SKIP_DIRS: &[&str] = &[".git", "node_modules", ".cache"];

/// `.ai/` subdirectories that are system-managed and should NOT be indexed as memories.
/// Rules, skills, and context subdirs ARE scannable (they contain user-authored memory files).
pub const AI_SKIP_SUBDIRS: &[&str] = &["tasks", "scratch", "journal"];

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

    pub fn rules_dir(&self) -> PathBuf {
        self.root.join(".ai/rules")
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

    pub fn tasks_dir(&self) -> PathBuf {
        self.root.join(".ai/tasks")
    }

    pub fn scratch_dir(&self) -> PathBuf {
        self.root.join(".ai/scratch")
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
            self.journal_dir(),
            self.sessions_dir(),
            self.tasks_dir(),
            self.scratch_dir(),
        ]
    }
}
