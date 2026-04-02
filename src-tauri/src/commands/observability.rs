use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use tauri::State;

use crate::core::health::{compute_health_score, HealthScore};
use crate::core::observability::{
    ContextRequestRecord, HealthScoreSnapshot, ObservabilityStats, OptimizationRecord,
    TopMemoryRecord, UnusedMemoryRecord,
};
use crate::core::optimizer::run_optimizations;
use crate::state::AppState;

#[derive(serde::Serialize)]
pub struct McpConnectionInfo {
    pub http_port: u16,
    pub http_url: String,
    pub workspace_root: String,
    pub binary_path: String,
    pub is_http_running: bool,
}

// ─── Observability queries ───

#[tauri::command]
pub fn get_recent_context_requests(
    limit: u32,
    state: State<AppState>,
) -> Result<Vec<ContextRequestRecord>, String> {
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => db.get_recent_requests(limit),
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub fn get_observability_stats(days: u32, state: State<AppState>) -> Result<ObservabilityStats, String> {
    // Acquire and release Mutex before touching RwLock to prevent deadlock
    let mut stats = {
        let obs = state.observability.lock().unwrap();
        match obs.as_ref() {
            Some(db) => db.get_stats(days)?,
            None => return Ok(ObservabilityStats::default()),
        }
    };
    // Mutex dropped — safe to acquire RwLock
    if let Ok(index) = state.memory_index.read() {
        stats.total_memories = index.len() as u32;
    }
    Ok(stats)
}

#[tauri::command]
pub fn get_top_memories_stats(
    limit: u32,
    days: u32,
    state: State<AppState>,
) -> Result<Vec<TopMemoryRecord>, String> {
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => db.get_top_memories(limit, days),
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub fn get_unused_memories_stats(days: u32, state: State<AppState>) -> Result<Vec<UnusedMemoryRecord>, String> {
    let root = state.get_root();
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => db.get_unused_memories(&root, days),
        None => Ok(vec![]),
    }
}

// ─── Health ───

#[tauri::command]
pub fn get_health_score(state: State<AppState>) -> Result<HealthScore, String> {
    let root = state.get_root();
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => compute_health_score(db, &root),
        None => Err("Observability DB not initialized".to_string()),
    }
}

#[tauri::command]
pub fn get_health_history(days: u32, state: State<AppState>) -> Result<Vec<HealthScoreSnapshot>, String> {
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => db.get_health_history(days),
        None => Ok(vec![]),
    }
}

// ─── Optimizations ───

#[tauri::command]
pub fn get_pending_optimizations(state: State<AppState>) -> Result<Vec<OptimizationRecord>, String> {
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => db.get_pending_optimizations(),
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub fn apply_optimization(id: i64, state: State<AppState>) -> Result<(), String> {
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => db.update_optimization_status(id, "applied"),
        None => Err("Observability DB not initialized".to_string()),
    }
}

#[tauri::command]
pub fn dismiss_optimization(id: i64, state: State<AppState>) -> Result<(), String> {
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => db.update_optimization_status(id, "dismissed"),
        None => Err("Observability DB not initialized".to_string()),
    }
}

#[tauri::command]
pub fn run_optimization_analysis(state: State<AppState>) -> Result<Vec<OptimizationRecord>, String> {
    let root = state.get_root();
    let obs = state.observability.lock().unwrap();
    match obs.as_ref() {
        Some(db) => run_optimizations(db, &root),
        None => Err("Observability DB not initialized".to_string()),
    }
}

// ─── MCP Connection Info ───

#[tauri::command]
pub fn get_mcp_connection_info(state: State<AppState>) -> Result<McpConnectionInfo, String> {
    let root = state.get_root();
    let port = crate::core::mcp_http::MCP_HTTP_PORT;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    // Try to find the CLI binary path
    let binary_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "ai-context-cli".to_string());

    let is_http_running = TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok();

    Ok(McpConnectionInfo {
        http_port: port,
        http_url: format!("http://127.0.0.1:{}/mcp", port),
        workspace_root: root.to_string_lossy().to_string(),
        binary_path,
        is_http_running,
    })
}
