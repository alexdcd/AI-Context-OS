use std::fs;
use std::path::Path;

use uuid::Uuid;

use crate::core::paths::SystemPaths;
use crate::core::types::{TaskFilter, TaskItem, TaskPriority, TaskState};

/// List all task files from .ai/tasks/ directory.
pub fn list_tasks(root: &Path, filter: &Option<TaskFilter>) -> Result<Vec<TaskItem>, String> {
    let tasks_dir = SystemPaths::new(root).tasks_dir();
    if !tasks_dir.exists() {
        return Ok(Vec::new());
    }

    let mut tasks: Vec<TaskItem> = Vec::new();

    let entries =
        fs::read_dir(&tasks_dir).map_err(|e| format!("Failed to read tasks dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(true, |ext| ext != "md") {
            continue;
        }
        if let Ok(task) = read_task_file(&path) {
            // Apply filter
            if let Some(ref f) = filter {
                if let Some(ref state) = f.state {
                    if &task.state != state {
                        continue;
                    }
                }
                if let Some(ref priority) = f.priority {
                    if task.priority.as_ref() != Some(priority) {
                        continue;
                    }
                }
                if let Some(ref tag) = f.tag {
                    if !task.tags.contains(tag) {
                        continue;
                    }
                }
            }
            tasks.push(task);
        }
    }

    // Sort: in-progress first, then todo, then done/cancelled; within each, by priority
    tasks.sort_by(|a, b| {
        let state_order = |s: &TaskState| -> u8 {
            match s {
                TaskState::InProgress => 0,
                TaskState::Todo => 1,
                TaskState::Done => 2,
                TaskState::Cancelled => 3,
            }
        };
        let sa = state_order(&a.state);
        let sb = state_order(&b.state);
        if sa != sb {
            return sa.cmp(&sb);
        }
        // Higher priority first
        let pa = a.priority.as_ref().map(|p| p.importance()).unwrap_or(0.5);
        let pb = b.priority.as_ref().map(|p| p.importance()).unwrap_or(0.5);
        pb.partial_cmp(&pa).unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(tasks)
}

/// Read a single task from a Markdown file in .ai/tasks/.
fn read_task_file(path: &Path) -> Result<TaskItem, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read task: {}", e))?;

    parse_task_md(&raw, path)
}

/// Parse a task .md file with YAML frontmatter.
fn parse_task_md(raw: &str, _path: &Path) -> Result<TaskItem, String> {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return Err("No frontmatter".to_string());
    }

    let after_first = &trimmed[3..];
    let end_pos = after_first.find("\n---").ok_or("No closing frontmatter")?;

    let yaml_str = &after_first[..end_pos];
    let body_start = 3 + end_pos + 4;
    let body = if body_start < trimmed.len() {
        trimmed[body_start..].trim().to_string()
    } else {
        String::new()
    };

    let meta: TaskMeta =
        serde_yaml::from_str(yaml_str).map_err(|e| format!("YAML parse error: {}", e))?;

    Ok(TaskItem {
        id: meta.id,
        title: meta.title,
        state: meta.state,
        priority: meta.priority,
        tags: meta.tags,
        source_date: meta.source_date,
        source_file: meta.source_file,
        created: meta.created,
        modified: meta.modified,
        notes: body,
        due: meta.due,
    })
}

/// Internal frontmatter-only struct for task files.
#[derive(Debug, serde::Deserialize)]
struct TaskMeta {
    id: String,
    title: String,
    state: TaskState,
    #[serde(default)]
    priority: Option<TaskPriority>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    source_date: Option<String>,
    #[serde(default)]
    source_file: Option<String>,
    #[serde(default = "chrono::Utc::now")]
    created: chrono::DateTime<chrono::Utc>,
    #[serde(default = "chrono::Utc::now")]
    modified: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    due: Option<String>,
}

/// Create a new task and write it to .ai/tasks/.
pub fn create_task(root: &Path, task: &TaskItem) -> Result<String, String> {
    let tasks_dir = SystemPaths::new(root).tasks_dir();
    fs::create_dir_all(&tasks_dir).map_err(|e| format!("Failed to create tasks dir: {}", e))?;

    let file_path = tasks_dir.join(format!("{}.md", &task.id));
    let content = serialize_task(task);

    fs::write(&file_path, &content).map_err(|e| format!("Failed to write task: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Update an existing task.
pub fn update_task(root: &Path, task: &TaskItem) -> Result<String, String> {
    let file_path = SystemPaths::new(root)
        .tasks_dir()
        .join(format!("{}.md", &task.id));
    let content = serialize_task(task);

    fs::write(&file_path, &content).map_err(|e| format!("Failed to write task: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Delete a task file.
pub fn delete_task(root: &Path, id: &str) -> Result<(), String> {
    let file_path = SystemPaths::new(root)
        .tasks_dir()
        .join(format!("{}.md", id));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| format!("Failed to delete task: {}", e))?;
    }
    Ok(())
}

/// Generate a short task ID.
pub fn generate_task_id() -> String {
    let uuid = Uuid::new_v4().to_string();
    format!("task-{}", &uuid[..8])
}

/// Serialize a TaskItem to Markdown with YAML frontmatter.
fn serialize_task(task: &TaskItem) -> String {
    let state_str = match task.state {
        TaskState::Todo => "todo",
        TaskState::InProgress => "in_progress",
        TaskState::Done => "done",
        TaskState::Cancelled => "cancelled",
    };

    let priority_str = task.priority.as_ref().map(|p| match p {
        TaskPriority::A => "a",
        TaskPriority::B => "b",
        TaskPriority::C => "c",
    });

    let tags_str = if task.tags.is_empty() {
        "[]".to_string()
    } else {
        format!(
            "[{}]",
            task.tags
                .iter()
                .map(|t| format!("\"{}\"", t))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    let mut yaml = format!(
        "---\nid: \"{}\"\ntitle: \"{}\"\nstate: {}\n",
        task.id,
        task.title.replace('"', "\\\""),
        state_str,
    );

    if let Some(p) = &priority_str {
        yaml.push_str(&format!("priority: {}\n", p));
    }

    yaml.push_str(&format!("tags: {}\n", tags_str));

    if let Some(ref sd) = task.source_date {
        yaml.push_str(&format!("source_date: \"{}\"\n", sd));
    }
    if let Some(ref sf) = task.source_file {
        yaml.push_str(&format!("source_file: \"{}\"\n", sf));
    }

    if let Some(ref due) = task.due {
        yaml.push_str(&format!("due: \"{}\"\n", due));
    }

    yaml.push_str(&format!(
        "created: \"{}\"\nmodified: \"{}\"\n---\n\n{}",
        task.created.to_rfc3339(),
        task.modified.to_rfc3339(),
        task.notes,
    ));

    yaml
}
