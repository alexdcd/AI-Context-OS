use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use crate::core::observability::ObservabilityDb;
use crate::core::types::{Config, MemoryMeta};
use crate::core::watcher::MemoryIndex;

const ROOT_HINT_FILE: &str = ".ai-context-os-root";

pub struct AppState {
    pub root_dir: Arc<RwLock<PathBuf>>,
    pub memory_index: MemoryIndex, // Arc<RwLock<HashMap<id, (meta, file_path)>>>
    pub config: Arc<RwLock<Config>>,
    pub observability: Arc<Mutex<Option<ObservabilityDb>>>,
}

impl AppState {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let default_root = home.join("AI-Context-OS");
        let root = Self::load_persisted_root(&home).unwrap_or(default_root);

        Self {
            root_dir: Arc::new(RwLock::new(root.clone())),
            memory_index: Arc::new(RwLock::new(HashMap::new())),
            config: Arc::new(RwLock::new(Config {
                root_dir: root.to_string_lossy().to_string(),
                default_token_budget: 4000,
                decay_threshold: 0.1,
                scratch_ttl_days: 7,
                active_tools: vec!["claude".to_string()],
            })),
            observability: Arc::new(Mutex::new(None)),
        }
    }

    pub fn get_root(&self) -> PathBuf {
        self.root_dir.read().unwrap().clone()
    }

    pub fn set_root(&self, root: PathBuf) -> Result<(), String> {
        {
            let mut root_dir = self.root_dir.write().unwrap();
            *root_dir = root.clone();
        }

        {
            let mut config = self.config.write().unwrap();
            config.root_dir = root.to_string_lossy().to_string();
        }

        Self::persist_root_hint(&root)
    }

    fn root_hint_path(home: &Path) -> PathBuf {
        home.join(ROOT_HINT_FILE)
    }

    fn load_persisted_root(home: &Path) -> Option<PathBuf> {
        let hint_path = Self::root_hint_path(home);
        let raw = fs::read_to_string(hint_path).ok()?;
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(Self::expand_home(trimmed))
    }

    fn persist_root_hint(root: &Path) -> Result<(), String> {
        let home = dirs::home_dir().ok_or_else(|| "Home directory not available".to_string())?;
        let hint_path = Self::root_hint_path(&home);
        fs::write(&hint_path, root.to_string_lossy().to_string())
            .map_err(|e| format!("Failed to persist workspace root at {}: {}", hint_path.display(), e))
    }

    fn expand_home(path: &str) -> PathBuf {
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
}
