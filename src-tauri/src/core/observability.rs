use std::path::Path;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// SQLite-backed observability database for tracking context requests.
/// Lives at {workspace}/.cache/observability.db
pub struct ObservabilityDb {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextRequestRecord {
    pub id: i64,
    pub timestamp: String,
    pub query: String,
    pub token_budget: u32,
    pub tokens_used: u32,
    pub memories_loaded: u32,
    pub memories_available: u32,
    pub source: String,
    pub session_id: Option<String>,
    pub task_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryServedRecord {
    pub id: i64,
    pub request_id: i64,
    pub memory_id: String,
    pub memory_title: String,
    pub load_level: String,
    pub token_estimate: u32,
    pub final_score: f64,
    pub was_force_loaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryNotLoadedRecord {
    pub id: i64,
    pub request_id: i64,
    pub memory_id: String,
    pub final_score: f64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservabilityStats {
    pub requests_this_week: u32,
    pub requests_prev_week: u32,
    pub tokens_served_total: u64,
    pub tokens_avg_per_request: u32,
    pub active_memories: u32,
    pub total_memories: u32,
    pub efficiency_percent: f64,
    pub force_rate_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopMemoryRecord {
    pub memory_id: String,
    pub times_served: u32,
    pub typical_level: String,
    pub total_tokens: u64,
    pub pct_of_requests: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnusedMemoryRecord {
    pub memory_id: String,
    pub last_served: Option<String>,
    pub days_since_use: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthScoreSnapshot {
    pub date: String,
    pub score: u32,
    pub breakdown: String, // JSON
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationRecord {
    pub id: i64,
    pub timestamp: String,
    pub optimization_type: String,
    pub target_memory_id: Option<String>,
    pub secondary_memory_id: Option<String>,
    pub description: String,
    pub impact: String,
    pub evidence: String,
    pub estimated_token_saving: Option<u32>,
    pub status: String,
}

impl ObservabilityDb {
    pub fn new(workspace_root: &Path) -> Result<Self, String> {
        let cache_dir = workspace_root.join(".cache");
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create .cache dir: {}", e))?;

        let db_path = cache_dir.join("observability.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open observability DB: {}", e))?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| format!("Failed to set PRAGMA: {}", e))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.create_tables()?;
        Ok(db)
    }

    fn create_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS context_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                query TEXT NOT NULL,
                token_budget INTEGER NOT NULL,
                tokens_used INTEGER NOT NULL,
                memories_loaded INTEGER NOT NULL,
                memories_available INTEGER NOT NULL,
                source TEXT NOT NULL,
                session_id TEXT,
                task_type TEXT NOT NULL DEFAULT 'quick'
            );

            CREATE TABLE IF NOT EXISTS memories_served (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER NOT NULL REFERENCES context_requests(id),
                memory_id TEXT NOT NULL,
                memory_title TEXT NOT NULL DEFAULT '',
                load_level TEXT NOT NULL,
                token_estimate INTEGER NOT NULL,
                final_score REAL NOT NULL,
                was_force_loaded INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS memories_not_loaded (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER NOT NULL REFERENCES context_requests(id),
                memory_id TEXT NOT NULL,
                final_score REAL NOT NULL,
                reason TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS optimizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                optimization_type TEXT NOT NULL,
                target_memory_id TEXT,
                secondary_memory_id TEXT,
                description TEXT NOT NULL,
                impact TEXT NOT NULL DEFAULT 'low',
                evidence TEXT NOT NULL DEFAULT '',
                estimated_token_saving INTEGER,
                status TEXT NOT NULL DEFAULT 'pending'
            );

            CREATE TABLE IF NOT EXISTS health_score_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                score INTEGER NOT NULL,
                breakdown TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cr_timestamp ON context_requests(timestamp);
            CREATE INDEX IF NOT EXISTS idx_ms_request ON memories_served(request_id);
            CREATE INDEX IF NOT EXISTS idx_ms_memory ON memories_served(memory_id);
            CREATE INDEX IF NOT EXISTS idx_mnl_request ON memories_not_loaded(request_id);
            ",
        )
        .map_err(|e| format!("Failed to create tables: {}", e))
    }

    /// Log a context request. Returns the inserted row ID.
    pub fn log_context_request(
        &self,
        query: &str,
        token_budget: u32,
        tokens_used: u32,
        memories_loaded: u32,
        memories_available: u32,
        source: &str,
        session_id: Option<&str>,
        task_type: &str,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO context_requests (timestamp, query, token_budget, tokens_used, memories_loaded, memories_available, source, session_id, task_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                Utc::now().to_rfc3339(),
                query,
                token_budget,
                tokens_used,
                memories_loaded,
                memories_available,
                source,
                session_id,
                task_type,
            ],
        )
        .map_err(|e| format!("Failed to log context request: {}", e))?;
        Ok(conn.last_insert_rowid())
    }

    /// Log a memory that was served in a context request.
    pub fn log_memory_served(
        &self,
        request_id: i64,
        memory_id: &str,
        memory_title: &str,
        load_level: &str,
        token_estimate: u32,
        final_score: f64,
        was_force_loaded: bool,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO memories_served (request_id, memory_id, memory_title, load_level, token_estimate, final_score, was_force_loaded)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                request_id,
                memory_id,
                memory_title,
                load_level,
                token_estimate,
                final_score,
                was_force_loaded as i32,
            ],
        )
        .map_err(|e| format!("Failed to log memory served: {}", e))
    }

    /// Log a memory that was considered but not loaded.
    pub fn log_memory_not_loaded(
        &self,
        request_id: i64,
        memory_id: &str,
        final_score: f64,
        reason: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO memories_not_loaded (request_id, memory_id, final_score, reason)
             VALUES (?1, ?2, ?3, ?4)",
            params![request_id, memory_id, final_score, reason],
        )
        .map_err(|e| format!("Failed to log memory not loaded: {}", e))
    }

    /// Get recent context requests.
    pub fn get_recent_requests(&self, limit: u32) -> Result<Vec<ContextRequestRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, timestamp, query, token_budget, tokens_used, memories_loaded, memories_available, source, session_id, task_type
                 FROM context_requests ORDER BY timestamp DESC LIMIT ?1",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(ContextRequestRecord {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    query: row.get(2)?,
                    token_budget: row.get(3)?,
                    tokens_used: row.get(4)?,
                    memories_loaded: row.get(5)?,
                    memories_available: row.get(6)?,
                    source: row.get(7)?,
                    session_id: row.get(8)?,
                    task_type: row.get(9)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Row error: {}", e))
    }

    /// Get memories served for a specific request.
    pub fn get_memories_for_request(&self, request_id: i64) -> Result<Vec<MemoryServedRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, request_id, memory_id, memory_title, load_level, token_estimate, final_score, was_force_loaded
                 FROM memories_served WHERE request_id = ?1 ORDER BY final_score DESC",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map(params![request_id], |row| {
                Ok(MemoryServedRecord {
                    id: row.get(0)?,
                    request_id: row.get(1)?,
                    memory_id: row.get(2)?,
                    memory_title: row.get(3)?,
                    load_level: row.get(4)?,
                    token_estimate: row.get(5)?,
                    final_score: row.get(6)?,
                    was_force_loaded: row.get::<_, i32>(7)? != 0,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Row error: {}", e))
    }

    /// Get memories that were not loaded for a specific request.
    pub fn get_not_loaded_for_request(&self, request_id: i64) -> Result<Vec<MemoryNotLoadedRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, request_id, memory_id, final_score, reason
                 FROM memories_not_loaded WHERE request_id = ?1 ORDER BY final_score DESC",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map(params![request_id], |row| {
                Ok(MemoryNotLoadedRecord {
                    id: row.get(0)?,
                    request_id: row.get(1)?,
                    memory_id: row.get(2)?,
                    final_score: row.get(3)?,
                    reason: row.get(4)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Row error: {}", e))
    }

    /// Get aggregated stats for the last N days.
    pub fn get_stats(&self, days: u32) -> Result<ObservabilityStats, String> {
        let conn = self.conn.lock().unwrap();

        let this_week: (u32, u64, f64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(tokens_used), 0), COALESCE(AVG(CAST(tokens_used AS REAL) / NULLIF(token_budget, 0) * 100), 0)
                 FROM context_requests WHERE timestamp > datetime('now', ?1)",
                params![format!("-{} days", days)],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| format!("Stats query error: {}", e))?;

        let prev_week: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM context_requests
                 WHERE timestamp > datetime('now', ?1) AND timestamp <= datetime('now', ?2)",
                params![format!("-{} days", days * 2), format!("-{} days", days)],
                |row| row.get(0),
            )
            .map_err(|e| format!("Stats query error: {}", e))?;

        let tokens_avg = if this_week.0 > 0 {
            (this_week.1 / this_week.0 as u64) as u32
        } else {
            0
        };

        let active_memories: u32 = conn
            .query_row(
                "SELECT COUNT(DISTINCT memory_id) FROM memories_served ms
                 JOIN context_requests cr ON ms.request_id = cr.id
                 WHERE cr.timestamp > datetime('now', '-30 days')",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Stats query error: {}", e))?;

        let force_rate: f64 = conn
            .query_row(
                "SELECT COALESCE(AVG(CASE WHEN was_force_loaded THEN 1.0 ELSE 0.0 END) * 100, 0)
                 FROM memories_served ms
                 JOIN context_requests cr ON ms.request_id = cr.id
                 WHERE cr.timestamp > datetime('now', ?1)",
                params![format!("-{} days", days)],
                |row| row.get(0),
            )
            .map_err(|e| format!("Stats query error: {}", e))?;

        Ok(ObservabilityStats {
            requests_this_week: this_week.0,
            requests_prev_week: prev_week,
            tokens_served_total: this_week.1,
            tokens_avg_per_request: tokens_avg,
            active_memories,
            total_memories: 0, // Caller fills this from memory_index
            efficiency_percent: this_week.2,
            force_rate_percent: force_rate,
        })
    }

    /// Get top memories by usage count.
    pub fn get_top_memories(&self, limit: u32, days: u32) -> Result<Vec<TopMemoryRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT ms.memory_id, COUNT(*) as times_served,
                        ms.load_level as typical_level,
                        SUM(ms.token_estimate) as total_tokens,
                        ROUND(COUNT(*) * 100.0 / NULLIF((
                            SELECT COUNT(*) FROM context_requests
                            WHERE timestamp > datetime('now', ?2)
                        ), 0), 1) as pct
                 FROM memories_served ms
                 JOIN context_requests cr ON ms.request_id = cr.id
                 WHERE cr.timestamp > datetime('now', ?2)
                 GROUP BY ms.memory_id
                 ORDER BY times_served DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map(params![limit, format!("-{} days", days)], |row| {
                Ok(TopMemoryRecord {
                    memory_id: row.get(0)?,
                    times_served: row.get(1)?,
                    typical_level: row.get(2)?,
                    total_tokens: row.get(3)?,
                    pct_of_requests: row.get::<_, f64>(4).unwrap_or(0.0),
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Row error: {}", e))
    }

    /// Get memories that haven't been served in N+ days.
    pub fn get_unused_memories(&self, days: u32) -> Result<Vec<UnusedMemoryRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT memory_id, MAX(cr.timestamp) as last_served,
                        CAST(julianday('now') - julianday(MAX(cr.timestamp)) AS INTEGER) as days_since
                 FROM memories_served ms
                 JOIN context_requests cr ON ms.request_id = cr.id
                 GROUP BY memory_id
                 HAVING days_since > ?1
                 ORDER BY days_since DESC",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map(params![days], |row| {
                Ok(UnusedMemoryRecord {
                    memory_id: row.get(0)?,
                    last_served: row.get(1)?,
                    days_since_use: row.get(2)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Row error: {}", e))
    }

    /// Insert or update today's health score.
    pub fn insert_health_score(&self, score: u32, breakdown_json: &str) -> Result<(), String> {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO health_score_history (date, score, breakdown)
             VALUES (?1, ?2, ?3)",
            params![today, score, breakdown_json],
        )
        .map_err(|e| format!("Insert health score error: {}", e))?;
        Ok(())
    }

    /// Get health score history for the last N days.
    pub fn get_health_history(&self, days: u32) -> Result<Vec<HealthScoreSnapshot>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT date, score, breakdown FROM health_score_history
                 WHERE date > date('now', ?1)
                 ORDER BY date ASC",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map(params![format!("-{} days", days)], |row| {
                Ok(HealthScoreSnapshot {
                    date: row.get(0)?,
                    score: row.get(1)?,
                    breakdown: row.get(2)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Row error: {}", e))
    }

    /// Insert a new optimization suggestion.
    pub fn insert_optimization(&self, opt: &OptimizationRecord) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO optimizations (timestamp, optimization_type, target_memory_id, secondary_memory_id, description, impact, evidence, estimated_token_saving, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                Utc::now().to_rfc3339(),
                opt.optimization_type,
                opt.target_memory_id,
                opt.secondary_memory_id,
                opt.description,
                opt.impact,
                opt.evidence,
                opt.estimated_token_saving,
                "pending",
            ],
        )
        .map_err(|e| format!("Insert optimization error: {}", e))?;
        Ok(conn.last_insert_rowid())
    }

    /// Get pending optimizations.
    pub fn get_pending_optimizations(&self) -> Result<Vec<OptimizationRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, timestamp, optimization_type, target_memory_id, secondary_memory_id, description, impact, evidence, estimated_token_saving, status
                 FROM optimizations WHERE status = 'pending'
                 ORDER BY CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, timestamp DESC",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(OptimizationRecord {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    optimization_type: row.get(2)?,
                    target_memory_id: row.get(3)?,
                    secondary_memory_id: row.get(4)?,
                    description: row.get(5)?,
                    impact: row.get(6)?,
                    evidence: row.get(7)?,
                    estimated_token_saving: row.get(8)?,
                    status: row.get(9)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Row error: {}", e))
    }

    /// Update optimization status.
    pub fn update_optimization_status(&self, id: i64, status: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE optimizations SET status = ?1 WHERE id = ?2",
            params![status, id],
        )
        .map_err(|e| format!("Update optimization error: {}", e))?;
        Ok(())
    }

    /// Clear old pending optimizations (before re-running analysis).
    pub fn clear_pending_optimizations(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM optimizations WHERE status = 'pending'", [])
            .map_err(|e| format!("Clear optimizations error: {}", e))?;
        Ok(())
    }
}

/// Classify a task description into a category using keyword matching.
pub fn classify_task(description: &str) -> &'static str {
    let desc = description.to_lowercase();

    if desc.contains("post")
        || desc.contains("escrib")
        || desc.contains("contenido")
        || desc.contains("linkedin")
        || desc.contains("newsletter")
        || desc.contains("email")
        || desc.contains("write")
        || desc.contains("blog")
        || desc.contains("article")
    {
        "writing"
    } else if desc.contains("código")
        || desc.contains("code")
        || desc.contains("review")
        || desc.contains("bug")
        || desc.contains("debug")
        || desc.contains("test")
        || desc.contains("function")
        || desc.contains("api")
    {
        "coding"
    } else if desc.contains("estrategia")
        || desc.contains("análisis")
        || desc.contains("plan")
        || desc.contains("decisión")
        || desc.contains("investig")
        || desc.contains("research")
        || desc.contains("analy")
    {
        "strategy"
    } else {
        "quick"
    }
}
