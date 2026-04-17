//! Diagnostic integration test: reproduces the exact flow that the chat panel
//! triggers when a user types a query, against a real vault on disk.
//!
//! Run with:
//!   cd src-tauri
//!   DIAG_VAULT_ROOT=/Users/alexdc/Documents/GitHub/AI-Context-OS \
//!   DIAG_QUERY="¿Me das cualquier dato de mi bóveda?" \
//!   cargo test --test diagnose_vault_query -- --ignored --nocapture

use std::path::PathBuf;

use ai_context_os::core::engine::{assemble_chat_context_package, execute_context_query};
use ai_context_os::core::frontmatter::parse_frontmatter;
use ai_context_os::core::types::Config;

fn load_config(root: &PathBuf) -> Config {
    let ai_config = root.join(".ai").join("config.yaml");
    let legacy_config = root.join("_config.yaml");
    let config_path = if ai_config.exists() {
        ai_config
    } else {
        legacy_config
    };

    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).unwrap_or_default();
        serde_yaml::from_str(&content).unwrap_or_else(|_| default_config(root))
    } else {
        default_config(root)
    }
}

fn default_config(root: &PathBuf) -> Config {
    Config {
        root_dir: root.to_string_lossy().to_string(),
        default_token_budget: 4000,
        decay_threshold: 0.1,
        scratch_ttl_days: 7,
        active_tools: vec!["claude".to_string()],
    }
}

#[test]
#[ignore]
fn diagnose_chat_context_for_query() {
    let root = PathBuf::from(
        std::env::var("DIAG_VAULT_ROOT")
            .unwrap_or_else(|_| "/Users/alexdc/Documents/GitHub/AI-Context-OS".to_string()),
    );
    let query = std::env::var("DIAG_QUERY")
        .unwrap_or_else(|_| "¿Me das cualquier dato de mi bóveda?".to_string());
    let budget: u32 = std::env::var("DIAG_BUDGET")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4000);

    println!("\n=== CHAT CONTEXT DIAGNOSTIC ===");
    println!("vault_root : {}", root.display());
    println!("query      : {:?}", query);
    println!("budget     : {}", budget);
    println!();

    let config = load_config(&root);
    let result = execute_context_query(&root, &query, budget, &config)
        .expect("execute_context_query failed");

    println!("-- Summary --");
    println!("total_memories : {}", result.total_memories);
    println!("scored         : {}", result.scored_memories.len());
    println!("loaded         : {}", result.loaded.len());
    println!("unloaded       : {}", result.unloaded.len());
    println!(
        "tokens_used    : {}/{}",
        result.tokens_used, result.tokens_budget
    );
    println!();

    println!("-- Top 10 scored memories --");
    for (i, m) in result.scored_memories.iter().take(10).enumerate() {
        println!(
            "  {:>2}. [{:.3}] lvl={:?} ~{}tok | {} — {}",
            i + 1,
            m.score.final_score,
            m.load_level,
            m.token_estimate,
            m.memory_id,
            m.l0,
        );
    }
    if result.scored_memories.is_empty() {
        println!("  (no memories were scored at all)");
    }
    println!();

    println!("-- Loaded memories (these reach the LLM) --");
    if result.loaded.is_empty() {
        println!("  *** EMPTY — the LLM receives NO vault context ***");
    } else {
        for m in &result.loaded {
            println!(
                "  [{:?}] score={:.3} tokens={} id={} l0={:?}",
                m.load_level, m.score.final_score, m.token_estimate, m.memory_id, m.l0
            );
        }
    }
    println!();

    println!("-- Unloaded (with reason) --");
    for m in result.unloaded.iter().take(5) {
        println!(
            "  [{:.3}] {} — reason={} — {}",
            m.score, m.memory_id, m.reason, m.l0
        );
    }
    println!();

    let prompt_context = assemble_chat_context_package(&result);
    println!("-- assemble_chat_context_package --");
    println!("prompt_context_len   : {}", prompt_context.len());
    println!(
        "prompt_context_empty : {}",
        prompt_context.trim().is_empty()
    );
    println!();
    println!("-- Prompt context (first 2000 chars) --");
    let preview: String = prompt_context.chars().take(2000).collect();
    println!("{}", preview);
    if prompt_context.len() > 2000 {
        println!("... [truncated, total {} chars]", prompt_context.len());
    }
    println!("\n=== END DIAGNOSTIC ===\n");
}

#[test]
#[ignore]
fn diagnose_frontmatter_parse_failures() {
    let root = PathBuf::from(
        std::env::var("DIAG_VAULT_ROOT")
            .unwrap_or_else(|_| "/Users/alexdc/AI-Context-OS".to_string()),
    );

    println!("\n=== FRONTMATTER PARSE AUDIT ===");
    println!("vault_root: {}\n", root.display());

    let mut ok = 0;
    let mut fail = 0;
    let mut no_fm = 0;
    let mut failures: Vec<(PathBuf, String)> = Vec::new();

    fn walk(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if path.is_dir() {
                if matches!(
                    name.as_str(),
                    ".git" | ".cache" | "node_modules" | "target" | ".obsidian"
                ) {
                    continue;
                }
                walk(&path, out);
            } else if path.extension().map_or(false, |e| e == "md") {
                out.push(path);
            }
        }
    }

    let mut md_files = Vec::new();
    walk(&root, &mut md_files);

    for path in &md_files {
        let Ok(raw) = std::fs::read_to_string(path) else {
            continue;
        };
        match parse_frontmatter(&raw) {
            Ok((meta, _body)) => {
                ok += 1;
                println!(
                    "  OK   id={:<32} l0={:?} importance={:.2} type={:?}",
                    meta.id, meta.l0, meta.importance, meta.ontology
                );
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("No frontmatter") {
                    no_fm += 1;
                } else {
                    fail += 1;
                    failures.push((path.clone(), msg));
                }
            }
        }
    }

    println!("\n-- Summary --");
    println!("  total .md scanned : {}", md_files.len());
    println!("  parsed OK         : {}", ok);
    println!("  no frontmatter    : {}", no_fm);
    println!("  parse FAILURES    : {}", fail);

    if !failures.is_empty() {
        println!("\n-- Parse failures (first 30) --");
        for (path, err) in failures.iter().take(30) {
            println!(
                "  FAIL {}\n       {}",
                path.strip_prefix(&root).unwrap_or(path).display(),
                err
            );
        }
    }
    println!("\n=== END FRONTMATTER AUDIT ===\n");
}
