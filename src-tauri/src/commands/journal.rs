use chrono::Utc;
use regex::Regex;
use tauri::State;

use crate::core::journal;
use crate::core::jsonl::append_jsonl;
use crate::core::memory;
use crate::core::tasks;
use crate::core::types::{DailyEntry, JournalDateInfo, JournalPage, TaskItem, TaskState};
use crate::state::AppState;

/// Get a journal page for a specific date.
#[tauri::command]
pub fn get_journal_page(date: String, state: State<AppState>) -> Result<JournalPage, String> {
    let root = state.get_root();
    if !journal::validate_date(&date) {
        return Err(format!("Invalid date format: {}", date));
    }
    journal::read_journal_page(&root, &date)
}

/// Save journal page content for a specific date.
/// Also extracts typed bullets (#decision, #idea, #meeting, etc.) → daily-log.jsonl
#[tauri::command]
pub fn save_journal_page(
    date: String,
    content: String,
    state: State<AppState>,
) -> Result<String, String> {
    let root = state.get_root();
    if !journal::validate_date(&date) {
        return Err(format!("Invalid date format: {}", date));
    }
    let result = journal::save_journal_page(&root, &date, &content)?;

    // Extract typed bullets and append to daily-log.jsonl
    let tag_re = Regex::new(r"#(decision|idea|meeting|goal|blocker|insight|question)").unwrap();
    let task_re = Regex::new(r"^-\s*\[\s*\]\s+(.+)$").unwrap();
    let daily_path = crate::core::paths::SystemPaths::new(&root).daily_log();
    let now = Utc::now();

    for line in content.lines() {
        let trimmed = line.trim();

        // Extract tasks from `- [ ] text` checkboxes
        if let Some(caps) = task_re.captures(trimmed) {
            let title = caps[1].trim().to_string();
            if !title.is_empty() {
                // Check if a task with this exact title already exists
                let existing = tasks::list_tasks(&root, &None).unwrap_or_default();
                let already_exists = existing.iter().any(|t| t.title == title);
                if !already_exists {
                    let task = TaskItem {
                        id: tasks::generate_task_id(),
                        title,
                        state: TaskState::Todo,
                        priority: None,
                        tags: vec![],
                        source_date: Some(date.clone()),
                        source_file: None,
                        created: now,
                        modified: now,
                        notes: String::new(),
                        due: None,
                    };
                    let _ = tasks::create_task(&root, &task);
                }
            }
        }

        // Extract typed bullets to JSONL
        let bullet = trimmed.trim_start_matches('-').trim();
        if let Some(caps) = tag_re.find(bullet) {
            let entry_type = caps.as_str().trim_start_matches('#').to_string();
            let summary = tag_re.replace_all(bullet, "").trim().to_string();
            if !summary.is_empty() {
                let entry = DailyEntry {
                    timestamp: now,
                    entry_type,
                    summary,
                    tags: vec![],
                    source: format!("journal:{}", date),
                };
                let _ = append_jsonl(&daily_path, &entry);
            }
        }
    }

    // Extract #tags from content and propagate to matching memories
    let hashtag_re = Regex::new(r"#([a-zA-Z][a-zA-Z0-9_-]*)").unwrap();
    let mut found_tags: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in content.lines() {
        for caps in hashtag_re.captures_iter(line) {
            let tag = caps[1].to_lowercase();
            // Skip the typed bullet tags already handled above
            if !matches!(
                tag.as_str(),
                "decision" | "idea" | "meeting" | "goal" | "blocker" | "insight" | "question"
            ) {
                found_tags.insert(tag);
            }
        }
    }

    if !found_tags.is_empty() {
        let root = state.get_root();
        let index = state.memory_index.read().unwrap();
        for (mem_id, (meta, file_path)) in index.iter() {
            let id_lower = mem_id.to_lowercase();
            let l0_lower = meta.l0.to_lowercase();
            let existing_tags: Vec<String> = meta.tags.iter().map(|t| t.to_lowercase()).collect();

            // Check if any extracted #tag matches this memory's id, l0, or existing tags
            let matching: Vec<&String> = found_tags
                .iter()
                .filter(|tag| {
                    id_lower.contains(tag.as_str())
                        || l0_lower.contains(tag.as_str())
                        || existing_tags.iter().any(|t| t == tag.as_str())
                })
                .collect();

            if !matching.is_empty() {
                // Add the journal date as a tag to this memory if not already present
                let date_tag = date.clone();
                if !meta.tags.contains(&date_tag) {
                    if let Ok(mut mem) = memory::read_memory(&root, std::path::Path::new(file_path))
                    {
                        if !mem.meta.tags.contains(&date_tag) {
                            mem.meta.tags.push(date_tag);
                            mem.meta.modified = now;
                            let _ = memory::write_memory(std::path::Path::new(file_path), &mem);
                        }
                    }
                }
            }
        }
    }

    Ok(result)
}

/// List all journal dates with metadata.
#[tauri::command]
pub fn list_journal_dates(state: State<AppState>) -> Result<Vec<JournalDateInfo>, String> {
    let root = state.get_root();
    journal::list_journal_dates(&root)
}

/// Get today's date string.
#[tauri::command]
pub fn get_today() -> String {
    journal::today_str()
}
