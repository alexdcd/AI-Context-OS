use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use tauri::{AppHandle, Emitter};

use crate::core::paths::is_generated_artifact_path;
use crate::core::types::MemoryMeta;

/// Shared memory index type: id -> (meta, file_path)
pub type MemoryIndex = Arc<RwLock<HashMap<String, (MemoryMeta, String)>>>;

pub struct WatcherHandle {
    stop_tx: std::sync::mpsc::Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl WatcherHandle {
    pub fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Start a file watcher on the workspace directory.
/// Emits Tauri events when files change.
/// Ignores generated system artifacts and emits change notifications for real workspace files.
#[allow(dead_code)]
pub fn start_watcher(
    root: PathBuf,
    app_handle: AppHandle,
    _memory_index: Option<MemoryIndex>,
    is_recent_write: Arc<dyn Fn(&str) -> bool + Send + Sync>,
) -> Result<WatcherHandle, String> {
    if !root.exists() {
        return Err(format!(
            "Cannot watch missing directory: {}",
            root.display()
        ));
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
        .map_err(|e| format!("Failed to create debouncer: {}", e))?;

    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    // Spawn a thread to handle events
    let thread = std::thread::spawn(move || {
        // Keep debouncer alive
        let _debouncer = debouncer;

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(events)) => {
                    for event in events {
                        let path_str = event.path.to_string_lossy().to_string();

                        // Skip hidden files and .cache
                        if path_str.contains("/.cache/") || path_str.contains("\\.cache\\") {
                            continue;
                        }
                        if is_generated_artifact_path(&root, &event.path) {
                            continue;
                        }

                        // Determine event type
                        if event.path.exists() {
                            if path_str.ends_with(".md")
                                || path_str.ends_with(".yaml")
                                || path_str.ends_with(".jsonl")
                            {
                                if is_recent_write(&path_str) {
                                    continue;
                                }

                                let _ = app_handle.emit("memory-changed", &path_str);
                            }
                        } else {
                            let _ = app_handle.emit("file-deleted", &path_str);
                        }
                    }
                }
                Ok(Err(_)) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(WatcherHandle {
        stop_tx,
        thread: Some(thread),
    })
}
