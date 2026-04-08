use std::fs;
use std::path::{Path, PathBuf};

use chrono::{NaiveDate, Utc};
use regex::Regex;

use crate::core::paths::SystemPaths;
use crate::core::types::{JournalBlock, JournalDateInfo, JournalPage, TaskPriority, TaskState};

/// Get the path for a journal date file.
pub fn journal_path(root: &Path, date: &str) -> PathBuf {
    SystemPaths::new(root).journal_dir().join(format!("{}.md", date))
}

/// Read a journal page from disk.
pub fn read_journal_page(root: &Path, date: &str) -> Result<JournalPage, String> {
    let path = journal_path(root, date);
    if !path.exists() {
        return Ok(JournalPage {
            date: date.to_string(),
            blocks: Vec::new(),
            raw_content: String::new(),
            file_path: path.to_string_lossy().to_string(),
        });
    }

    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let blocks = parse_blocks(&raw);

    Ok(JournalPage {
        date: date.to_string(),
        blocks,
        raw_content: raw,
        file_path: path.to_string_lossy().to_string(),
    })
}

/// Save a journal page to disk (from raw Markdown content).
pub fn save_journal_page(root: &Path, date: &str, content: &str) -> Result<String, String> {
    let path = journal_path(root, date);

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;

    Ok(path.to_string_lossy().to_string())
}

/// List all journal dates that have files, sorted descending.
pub fn list_journal_dates(root: &Path) -> Result<Vec<JournalDateInfo>, String> {
    let daily_dir = SystemPaths::new(root).journal_dir();
    if !daily_dir.exists() {
        return Ok(Vec::new());
    }

    let date_re = Regex::new(r"^\d{4}-\d{2}-\d{2}\.md$").unwrap();
    let mut dates: Vec<JournalDateInfo> = Vec::new();

    let entries =
        fs::read_dir(&daily_dir).map_err(|e| format!("Failed to read daily dir: {}", e))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !date_re.is_match(&name) {
            continue;
        }
        let date = name.trim_end_matches(".md").to_string();
        // Quick scan to get block count and task presence
        if let Ok(raw) = fs::read_to_string(entry.path()) {
            let blocks = parse_blocks(&raw);
            let has_tasks = blocks.iter().any(|b| b.task_state.is_some());
            dates.push(JournalDateInfo {
                date,
                block_count: blocks.len() as u32,
                has_tasks,
            });
        }
    }

    dates.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(dates)
}

/// Get today's date as YYYY-MM-DD.
pub fn today_str() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Validate that a date string is YYYY-MM-DD format.
pub fn validate_date(date: &str) -> bool {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok()
}

/// Parse Markdown content into JournalBlocks (outliner).
fn parse_blocks(raw: &str) -> Vec<JournalBlock> {
    let mut blocks = Vec::new();
    let mut counter = 0u32;

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }

        // Detect indent level (count leading spaces / 2, or tabs)
        let stripped = line.trim_start();
        let leading_spaces = line.len() - stripped.len();
        let indent = (leading_spaces / 2) as u32;

        // Check for bullet prefix
        let content_str = if stripped.starts_with("- ") {
            &stripped[2..]
        } else if stripped.starts_with("* ") {
            &stripped[2..]
        } else {
            stripped
        };

        // Parse task state and priority
        let (task_state, task_priority, clean_content) = parse_task_markers(content_str);

        counter += 1;
        blocks.push(JournalBlock {
            id: format!("b-{}", counter),
            indent,
            content: clean_content,
            children: Vec::new(),
            task_state,
            task_priority,
        });
    }

    // Build tree structure from flat list based on indent
    nest_blocks(blocks)
}

/// Parse Logseq-style task markers from a line.
/// `TODO [#A] Buy groceries` → (Some(Todo), Some(A), "Buy groceries")
fn parse_task_markers(line: &str) -> (Option<TaskState>, Option<TaskPriority>, String) {
    let mut rest = line.to_string();
    let mut state = None;
    let mut priority = None;

    // Check for task state prefix
    let state_markers = [
        ("TODO ", TaskState::Todo),
        ("IN-PROGRESS ", TaskState::InProgress),
        ("DOING ", TaskState::InProgress),
        ("DONE ", TaskState::Done),
        ("CANCELLED ", TaskState::Cancelled),
        ("CANCELED ", TaskState::Cancelled),
    ];

    for (prefix, s) in &state_markers {
        if rest.starts_with(prefix) {
            state = Some(s.clone());
            rest = rest[prefix.len()..].to_string();
            break;
        }
    }

    // Check for priority marker [#A], [#B], [#C]
    let priority_markers = [
        ("[#A] ", TaskPriority::A),
        ("[#B] ", TaskPriority::B),
        ("[#C] ", TaskPriority::C),
    ];

    for (prefix, p) in &priority_markers {
        if rest.starts_with(prefix) {
            priority = Some(p.clone());
            rest = rest[prefix.len()..].to_string();
            break;
        }
    }

    (state, priority, rest)
}

/// Convert flat indented blocks into nested tree.
fn nest_blocks(flat: Vec<JournalBlock>) -> Vec<JournalBlock> {
    if flat.is_empty() {
        return Vec::new();
    }

    let mut result: Vec<JournalBlock> = Vec::new();
    let mut stack: Vec<(u32, usize)> = Vec::new(); // (indent, index in result)

    for block in flat {
        let indent = block.indent;

        // Pop stack until we find a parent with lower indent
        while let Some(&(parent_indent, _)) = stack.last() {
            if parent_indent >= indent {
                stack.pop();
            } else {
                break;
            }
        }

        if let Some(&(_, _parent_idx)) = stack.last() {
            // This is a child — but for simplicity we flatten with indent info
            // The frontend will handle tree rendering based on indent level
            let mut b = block;
            b.indent = indent;
            result.push(b);
            stack.push((indent, result.len() - 1));
        } else {
            result.push(block);
            stack.push((indent, result.len() - 1));
        }
    }

    result
}

/// Serialize blocks back to Markdown.
pub fn blocks_to_markdown(blocks: &[JournalBlock]) -> String {
    let mut lines: Vec<String> = Vec::new();

    for block in blocks {
        let indent = "  ".repeat(block.indent as usize);
        let mut line = format!("{}- ", indent);

        // Add task state
        if let Some(ref state) = block.task_state {
            let state_str = match state {
                TaskState::Todo => "TODO ",
                TaskState::InProgress => "IN-PROGRESS ",
                TaskState::Done => "DONE ",
                TaskState::Cancelled => "CANCELLED ",
            };
            line.push_str(state_str);
        }

        // Add priority
        if let Some(ref priority) = block.task_priority {
            let p_str = match priority {
                TaskPriority::A => "[#A] ",
                TaskPriority::B => "[#B] ",
                TaskPriority::C => "[#C] ",
            };
            line.push_str(p_str);
        }

        line.push_str(&block.content);
        lines.push(line);
    }

    lines.join("\n")
}
