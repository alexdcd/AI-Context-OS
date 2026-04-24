use std::collections::{hash_map::DefaultHasher, HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use chrono::Utc;
use regex::Regex;
use reqwest::{header, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::core::folder_contract::load_folder_contract;
use crate::core::jsonl::read_jsonl;
use crate::core::levels::join_levels;
use crate::core::memory::{read_memory, write_memory};
use crate::core::paths::SystemPaths;
use crate::core::search::{bm25_score, l0_keyword_score, tag_match_score, Bm25Corpus};
use crate::core::types::{
    ApplyIngestProposalInput, ChatCompletionRequest, ChatCompletionResponse, ChatContextDebug,
    ChatContextDebugMemory, ChatMessage, CreateInboxLinkInput, CreateInboxTextInput, DailyEntry,
    DiscoveredProvider, InboxAttachment, InboxDestinationCandidate, InboxDuplicateCandidate,
    InboxItem, InboxItemKind, InboxItemStatus, InboxRecommendationScore,
    InboxRelatedMemoryCandidate, InferenceCapability, InferenceProviderConfig,
    InferenceProviderKind, InferenceProviderPreset, InferenceProviderStatus, IngestProposal,
    Memory, MemoryMeta, MemoryOntology, ProposalAction, ProposalState, ProviderModel,
    RecentOperationalContext, UpdateInboxItemInput,
};
use crate::core::wikilinks::{parse_wikilinks, resolve_wikilink, WikilinkResolution};
use crate::state::AppState;

const MAX_FETCH_BYTES: usize = 256 * 1024;
const MAX_REDIRECTS: usize = 5;
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const DEFAULT_OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434/v1";
const DEFAULT_LM_STUDIO_BASE_URL: &str = "http://127.0.0.1:1234/v1";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct InboxFrontmatter {
    id: String,
    kind: Option<InboxItemKind>,
    status: Option<InboxItemStatus>,
    #[serde(default)]
    capture_state: Option<String>,
    #[serde(default)]
    proposal_state: Option<ProposalState>,
    #[serde(default)]
    content_hash: Option<String>,
    #[serde(default)]
    created: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    modified: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    original_file: Option<String>,
    #[serde(default)]
    mime: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    derived_from: Vec<String>,
    #[serde(default)]
    needs_extraction: bool,
    #[serde(default)]
    needs_inference: bool,
    #[serde(default)]
    attachments: Vec<InboxAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IngestManifestEntry {
    item_id: String,
    path: String,
    kind: String,
    status: String,
    content_hash: String,
    #[serde(default)]
    source_url: Option<String>,
    updated: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IngestManifest {
    updated: Option<chrono::DateTime<Utc>>,
    items: Vec<IngestManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProposalModelResponse {
    action: ProposalAction,
    confidence: f64,
    rationale: String,
    #[serde(default)]
    destination: Option<String>,
    #[serde(default)]
    target_memory_id: Option<String>,
    #[serde(default)]
    ontology: Option<MemoryOntology>,
    #[serde(default)]
    l0: Option<String>,
    #[serde(default)]
    l1_content: Option<String>,
    #[serde(default)]
    l2_content: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Debug, Clone)]
struct MemoryCorpusEntry {
    meta: MemoryMeta,
    path: String,
    document: String,
    preview: String,
    source_urls: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct InboxEnrichment {
    related_memory_candidates: Vec<InboxRelatedMemoryCandidate>,
    duplicate_candidates: Vec<InboxDuplicateCandidate>,
    destination_candidates: Vec<InboxDestinationCandidate>,
    context_memory_ids: Vec<String>,
    context_prompt: Option<String>,
    inferred_destination: Option<String>,
    suggested_target_memory_id: Option<String>,
    suggested_target_memory_path: Option<String>,
}

fn hash_str(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("sip64:{:x}", hasher.finish())
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("sip64:{:x}", hasher.finish())
}

fn slugify(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut last_dash = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if (ch.is_whitespace() || ch == '-' || ch == '_') && !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn fallback_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.replace('-', " "))
        .unwrap_or_else(|| "Inbox item".to_string())
}

fn infer_mime_from_path(path: &Path) -> Option<String> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("md") | Some("txt") => Some("text/markdown".to_string()),
        Some("json") => Some("application/json".to_string()),
        Some("yaml") | Some("yml") => Some("application/yaml".to_string()),
        Some("pdf") => Some("application/pdf".to_string()),
        Some("png") => Some("image/png".to_string()),
        Some("jpg") | Some("jpeg") => Some("image/jpeg".to_string()),
        Some("gif") => Some("image/gif".to_string()),
        Some("webp") => Some("image/webp".to_string()),
        _ => None,
    }
}

fn is_text_like(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("txt") | Some("json") | Some("yaml") | Some("yml")
    )
}

/// Strip markdown code fences that LLMs often wrap around JSON responses.
/// Handles ```json ... ```, ``` ... ```, and plain JSON.
fn strip_markdown_json(raw: &str) -> String {
    let trimmed = raw.trim();
    // Try to extract content between ```json ... ``` or ``` ... ```
    if let Some(rest) = trimmed.strip_prefix("```json") {
        if let Some(inner) = rest.strip_suffix("```") {
            return inner.trim().to_string();
        }
    }
    if let Some(rest) = trimmed.strip_prefix("```") {
        if let Some(inner) = rest.strip_suffix("```") {
            return inner.trim().to_string();
        }
    }
    // Fallback: find the first { and last } to extract JSON object
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            return trimmed[start..=end].to_string();
        }
    }
    trimmed.to_string()
}

fn strip_html_tags(value: &str) -> String {
    Regex::new(r"<[^>]+>")
        .ok()
        .map(|re| re.replace_all(value, " ").to_string())
        .unwrap_or_else(|| value.to_string())
}

fn extract_title_from_html(value: &str) -> Option<String> {
    let re = Regex::new(r"(?is)<title[^>]*>(.*?)</title>").ok()?;
    let captures = re.captures(value)?;
    let title = captures.get(1)?.as_str().trim();
    if title.is_empty() {
        None
    } else {
        Some(strip_html_tags(title).trim().to_string())
    }
}

fn preview_text(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(280).collect()
}

fn trim_chars(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    value.chars().take(max_chars).collect()
}

fn unique_strings<I>(values: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        let owned = normalized.to_string();
        if seen.insert(owned.clone()) {
            out.push(owned);
        }
    }
    out
}

fn union_string_vectors(primary: &[String], secondary: &[String]) -> Vec<String> {
    unique_strings(
        primary
            .iter()
            .cloned()
            .chain(secondary.iter().cloned())
            .collect::<Vec<_>>(),
    )
}

fn combine_query_parts(parts: &[String]) -> String {
    parts
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn item_query_text(item: &InboxItem) -> String {
    combine_query_parts(&[
        item.title.clone(),
        item.summary.clone(),
        item.l1_content.clone(),
        trim_chars(&item.l2_content, 1200),
        item.tags.join(" "),
    ])
}

fn extract_http_urls(value: &str) -> Vec<String> {
    let Some(re) = Regex::new(r#"https?://[^\s<>"\])]+"#).ok() else {
        return Vec::new();
    };
    unique_strings(
        re.find_iter(value)
            .map(|m| m.as_str().trim_end_matches(&['.', ',', ';', ':'][..]).to_string())
            .collect::<Vec<_>>(),
    )
}

fn memory_index_snapshot(state: &AppState) -> Vec<(MemoryMeta, String)> {
    let needs_refresh = { state.memory_index.read().unwrap().is_empty() };
    if needs_refresh {
        state.refresh_memory_index();
    }

    state
        .memory_index
        .read()
        .unwrap()
        .values()
        .map(|(meta, path)| (meta.clone(), path.clone()))
        .collect()
}

fn build_memory_corpus(root: &Path, state: &AppState) -> Vec<MemoryCorpusEntry> {
    memory_index_snapshot(state)
        .into_iter()
        .map(|(meta, path)| {
            let (document, preview, source_urls) = match read_memory(root, Path::new(&path)) {
                Ok(memory) => {
                    let preview = preview_text(&memory.l1_content);
                    let document = combine_query_parts(&[
                        meta.l0.clone(),
                        memory.l1_content.clone(),
                        trim_chars(&memory.l2_content, 600),
                        meta.tags.join(" "),
                    ]);
                    let source_urls =
                        extract_http_urls(&format!("{}\n\n{}", memory.l1_content, memory.l2_content));
                    (document, preview, source_urls)
                }
                Err(_) => {
                    let preview = preview_text(&meta.l0);
                    let document = combine_query_parts(&[meta.l0.clone(), meta.tags.join(" ")]);
                    (document, preview, Vec::new())
                }
            };

            MemoryCorpusEntry {
                meta,
                path,
                document,
                preview,
                source_urls,
            }
        })
        .collect()
}

fn detect_item_wikilink_targets(item: &InboxItem, memories: &[MemoryMeta]) -> HashSet<String> {
    let mut targets = HashSet::new();
    let content = combine_query_parts(&[item.l1_content.clone(), item.l2_content.clone()]);
    for link in parse_wikilinks(&content) {
        match resolve_wikilink(&link.inner, memories) {
            WikilinkResolution::ExactId { id }
            | WikilinkResolution::ExactL0 { id }
            | WikilinkResolution::FuzzyL0 { id } => {
                targets.insert(id);
            }
            WikilinkResolution::Ambiguous { .. } | WikilinkResolution::Unresolved => {}
        }
    }
    targets
}

fn find_inbox_duplicate_candidates(
    item: &InboxItem,
    all_items: &[InboxItem],
) -> Vec<InboxDuplicateCandidate> {
    all_items
        .iter()
        .filter(|other| other.id != item.id)
        .filter_map(|other| {
            let same_hash = other.content_hash == item.content_hash;
            let same_url = item.source_url.is_some() && other.source_url == item.source_url;
            if !same_hash && !same_url {
                return None;
            }

            let (kind, confidence, rationale) = if same_url {
                (
                    "inbox_source_url".to_string(),
                    0.97,
                    format!("Shares the same source URL as inbox item '{}'.", other.title),
                )
            } else {
                (
                    "inbox_content_hash".to_string(),
                    0.95,
                    format!("Shares the same content hash as inbox item '{}'.", other.title),
                )
            };

            Some(InboxDuplicateCandidate {
                kind,
                target_id: other.id.clone(),
                target_title: other.title.clone(),
                file_path: Some(other.path.clone()),
                confidence,
                rationale,
            })
        })
        .collect()
}

fn is_allowed_destination_dir(root: &Path, dir: &Path) -> bool {
    let normalized_root = match fs::canonicalize(root) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let normalized_dir = match fs::canonicalize(dir) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let paths = SystemPaths::new(&normalized_root);

    normalized_dir.starts_with(&normalized_root)
        && normalized_dir != paths.inbox_dir()
        && normalized_dir != paths.sources_dir()
        && normalized_dir != paths.ai_dir()
        && !normalized_dir.starts_with(paths.journal_dir())
        && !normalized_dir.starts_with(paths.scratch_dir())
}

fn folder_category_for_dir(root: &Path, dir: &Path) -> Option<String> {
    dir.strip_prefix(root)
        .ok()?
        .components()
        .next()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
}

fn infer_destination_candidates(
    root: &Path,
    related: &[InboxRelatedMemoryCandidate],
) -> Vec<InboxDestinationCandidate> {
    let mut grouped: HashMap<String, Vec<&InboxRelatedMemoryCandidate>> = HashMap::new();
    for candidate in related {
        let Some(parent) = Path::new(&candidate.file_path).parent() else {
            continue;
        };
        if !is_allowed_destination_dir(root, parent) {
            continue;
        }
        grouped
            .entry(parent.to_string_lossy().to_string())
            .or_default()
            .push(candidate);
    }

    let mut destinations: Vec<InboxDestinationCandidate> = grouped
        .into_iter()
        .map(|(path, candidates)| {
            let candidate_path = PathBuf::from(&path);
            let score = candidates
                .iter()
                .take(3)
                .map(|candidate| candidate.final_score)
                .sum::<f64>()
                .min(1.0);
            let strongest = candidates
                .iter()
                .max_by(|left, right| left.final_score.total_cmp(&right.final_score))
                .map(|candidate| candidate.l0.clone())
                .unwrap_or_else(|| "related memory".to_string());
            let mut reasons = vec![format!(
                "{} related memor{} already live here.",
                candidates.len(),
                if candidates.len() == 1 { "y" } else { "ies" }
            )];
            reasons.push(format!("Strongest match in this folder: '{}'.", strongest));
            let contract_role = load_folder_contract(&candidate_path).map(|contract| contract.role);
            if let Some(role) = &contract_role {
                reasons.push(format!("Folder contract role: {}.", role));
            }

            InboxDestinationCandidate {
                path,
                folder_category: folder_category_for_dir(root, &candidate_path),
                score,
                contract_role,
                reasons,
            }
        })
        .collect();

    if let Ok(default_path) = default_memory_destination(root) {
        let default_path = default_path.to_string_lossy().to_string();
        if !destinations.iter().any(|candidate| candidate.path == default_path) {
            let default_dir = PathBuf::from(&default_path);
            destinations.push(InboxDestinationCandidate {
                path: default_path,
                folder_category: folder_category_for_dir(root, &default_dir),
                score: 0.15,
                contract_role: load_folder_contract(&default_dir).map(|contract| contract.role),
                reasons: vec![
                    "Fallback destination when no stronger folder signal exists.".to_string(),
                ],
            });
        }
    }

    destinations.sort_by(|left, right| right.score.total_cmp(&left.score));
    destinations
}

fn build_enrichment_context_prompt(
    item: &InboxItem,
    related: &[InboxRelatedMemoryCandidate],
    duplicates: &[InboxDuplicateCandidate],
    destinations: &[InboxDestinationCandidate],
    memory_corpus: &[MemoryCorpusEntry],
) -> Option<String> {
    if related.is_empty() && duplicates.is_empty() && destinations.is_empty() {
        return None;
    }

    let preview_map: HashMap<String, String> = memory_corpus
        .iter()
        .map(|entry| (entry.meta.id.clone(), entry.preview.clone()))
        .collect();

    let mut lines = vec![format!(
        "Workspace enrichment for inbox item '{}'. Use only this vetted context when deciding update_memory or destination.",
        item.title
    )];

    if !duplicates.is_empty() {
        lines.push("Possible duplicates:".to_string());
        for duplicate in duplicates.iter().take(4) {
            lines.push(format!(
                "- [{}] {} | confidence {:.2} | {}",
                duplicate.target_id, duplicate.target_title, duplicate.confidence, duplicate.rationale
            ));
        }
    }

    if !destinations.is_empty() {
        lines.push("Candidate destinations for promote_memory:".to_string());
        for destination in destinations.iter().take(4) {
            lines.push(format!(
                "- {} | score {:.2} | {}",
                destination.path,
                destination.score,
                destination.reasons.join(" ")
            ));
        }
    }

    if !related.is_empty() {
        lines.push("Most related existing memories. If you choose update_memory, target_memory_id must be one of these ids:".to_string());
        for candidate in related.iter().take(5) {
            let ontology = format!("{:?}", candidate.ontology).to_lowercase();
            let preview = preview_map
                .get(&candidate.memory_id)
                .cloned()
                .unwrap_or_else(String::new);
            lines.push(format!(
                "- [{}] {} | ontology={} | protected={} | folder={} | score {:.2} | preview={} | reasons={}",
                candidate.memory_id,
                candidate.l0,
                ontology,
                candidate.protected,
                candidate
                    .folder_category
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                candidate.final_score,
                preview,
                candidate.reasons.join(" ")
            ));
        }
    }

    Some(lines.join("\n"))
}

fn exact_duplicate_candidate(duplicates: &[InboxDuplicateCandidate]) -> Option<&InboxDuplicateCandidate> {
    duplicates.iter().find(|candidate| {
        matches!(
            candidate.kind.as_str(),
            "inbox_source_url" | "inbox_content_hash" | "memory_source_url"
        )
    })
}

fn attach_enrichment(mut proposal: IngestProposal, enrichment: &InboxEnrichment) -> IngestProposal {
    proposal.context_memory_ids = enrichment.context_memory_ids.clone();
    proposal.related_memory_candidates = enrichment.related_memory_candidates.clone();
    proposal.duplicate_candidates = enrichment.duplicate_candidates.clone();
    proposal.destination_candidates = enrichment.destination_candidates.clone();

    if proposal.target_memory_id.is_none() {
        proposal.target_memory_id = enrichment.suggested_target_memory_id.clone();
    }
    if proposal.target_memory_path.is_none() {
        proposal.target_memory_path = enrichment.suggested_target_memory_path.clone();
    }
    if proposal.destination.is_none() && matches!(proposal.action, ProposalAction::PromoteMemory) {
        proposal.destination = enrichment.inferred_destination.clone();
    }

    proposal
}

fn apply_exact_duplicate_guard(mut proposal: IngestProposal) -> IngestProposal {
    if let Some(duplicate) = exact_duplicate_candidate(&proposal.duplicate_candidates) {
        proposal.action = ProposalAction::Discard;
        proposal.confidence = proposal.confidence.max(duplicate.confidence);
        proposal.target_memory_id = None;
        proposal.target_memory_path = None;
        proposal.destination = None;
        proposal.rationale = format!(
            "Exact duplicate detected: {}",
            duplicate.rationale
        );
    }
    proposal
}

fn apply_heuristic_enrichment(
    mut proposal: IngestProposal,
    item: &InboxItem,
    enrichment: &InboxEnrichment,
) -> IngestProposal {
    proposal = attach_enrichment(proposal, enrichment);
    proposal = apply_exact_duplicate_guard(proposal);

    if matches!(proposal.action, ProposalAction::Discard) {
        return proposal;
    }

    if matches!(item.kind, InboxItemKind::Text)
        && matches!(
            proposal.action,
            ProposalAction::PromoteMemory | ProposalAction::NeedsReview
        )
        && proposal.target_memory_id.is_some()
    {
        proposal.action = ProposalAction::UpdateMemory;
        proposal.ontology = proposal
            .related_memory_candidates
            .iter()
            .find(|candidate| Some(&candidate.memory_id) == proposal.target_memory_id.as_ref())
            .map(|candidate| candidate.ontology.clone())
            .or(proposal.ontology);
        proposal.confidence = proposal.confidence.max(0.78);
        if let Some(target_id) = &proposal.target_memory_id {
            let target_title = proposal
                .related_memory_candidates
                .iter()
                .find(|candidate| &candidate.memory_id == target_id)
                .map(|candidate| candidate.l0.clone())
                .unwrap_or_else(|| target_id.clone());
            proposal.rationale = format!(
                "Strong match with existing memory '{}'; updating it is safer than creating a near-duplicate.",
                target_title
            );
        }
    } else if matches!(proposal.action, ProposalAction::PromoteMemory) {
        proposal.destination = proposal
            .destination
            .clone()
            .or_else(|| enrichment.inferred_destination.clone());
    }

    proposal
}

fn apply_inferred_enrichment(mut proposal: IngestProposal, enrichment: &InboxEnrichment) -> IngestProposal {
    let candidate_ids: HashSet<String> = enrichment
        .related_memory_candidates
        .iter()
        .map(|candidate| candidate.memory_id.clone())
        .collect();
    let candidate_paths: HashSet<String> = enrichment
        .destination_candidates
        .iter()
        .map(|candidate| candidate.path.clone())
        .collect();

    proposal = attach_enrichment(proposal, enrichment);

    if matches!(proposal.action, ProposalAction::UpdateMemory)
        && proposal
            .target_memory_id
            .as_ref()
            .map(|id| !candidate_ids.contains(id))
            .unwrap_or(true)
    {
        if let Some(fallback_id) = &enrichment.suggested_target_memory_id {
            proposal.target_memory_id = Some(fallback_id.clone());
            proposal.target_memory_path = enrichment.suggested_target_memory_path.clone();
            proposal.rationale = format!(
                "{} Fallbacked to the strongest vetted related memory.",
                proposal.rationale
            );
        } else {
            proposal.action = ProposalAction::NeedsReview;
            proposal.target_memory_id = None;
            proposal.target_memory_path = None;
            proposal.rationale = format!(
                "{} No valid target_memory_id was provided from the vetted related-memory set.",
                proposal.rationale
            );
        }
    }

    if matches!(proposal.action, ProposalAction::PromoteMemory)
        && proposal
            .destination
            .as_ref()
            .map(|destination| !candidate_paths.contains(destination))
            .unwrap_or(true)
    {
        proposal.destination = enrichment.inferred_destination.clone();
    }

    apply_exact_duplicate_guard(proposal)
}

fn inbox_frontmatter_to_item(
    frontmatter: InboxFrontmatter,
    body: String,
    path: &Path,
) -> InboxItem {
    let (l1, l2) = crate::core::levels::split_levels(&body);
    let title = frontmatter
        .title
        .clone()
        .or_else(|| frontmatter.summary.clone())
        .unwrap_or_else(|| fallback_title_from_path(path));
    let summary = frontmatter
        .summary
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| preview_text(if l1.trim().is_empty() { &l2 } else { &l1 }));

    InboxItem {
        id: if frontmatter.id.trim().is_empty() {
            slugify(&title)
        } else {
            frontmatter.id
        },
        kind: frontmatter.kind.unwrap_or(InboxItemKind::Text),
        status: frontmatter.status.unwrap_or(InboxItemStatus::New),
        capture_state: frontmatter
            .capture_state
            .unwrap_or_else(|| "raw".to_string()),
        proposal_state: frontmatter.proposal_state.unwrap_or(ProposalState::Pending),
        content_hash: frontmatter
            .content_hash
            .unwrap_or_else(|| hash_str(&(title.clone() + &body))),
        created: frontmatter.created.unwrap_or_else(Utc::now),
        modified: frontmatter.modified.unwrap_or_else(Utc::now),
        path: path.to_string_lossy().to_string(),
        title,
        summary,
        l1_content: l1,
        l2_content: l2,
        source_url: frontmatter.source_url,
        original_file: frontmatter.original_file,
        mime: frontmatter.mime,
        tags: frontmatter.tags,
        derived_from: frontmatter.derived_from,
        needs_extraction: frontmatter.needs_extraction,
        needs_inference: frontmatter.needs_inference,
        attachments: frontmatter.attachments,
    }
}

fn serialize_frontmatter<T: Serialize>(frontmatter: &T, body: &str) -> Result<String, String> {
    let yaml = serde_yaml::to_string(frontmatter)
        .map_err(|e| format!("Failed to serialize frontmatter: {}", e))?;
    Ok(format!("---\n{}---\n\n{}", yaml, body))
}

fn build_frontmatter(item: &InboxItem) -> InboxFrontmatter {
    InboxFrontmatter {
        id: item.id.clone(),
        kind: Some(item.kind.clone()),
        status: Some(item.status.clone()),
        capture_state: Some(item.capture_state.clone()),
        proposal_state: Some(item.proposal_state.clone()),
        content_hash: Some(item.content_hash.clone()),
        created: Some(item.created),
        modified: Some(item.modified),
        title: Some(item.title.clone()),
        summary: Some(item.summary.clone()),
        source_url: item.source_url.clone(),
        original_file: item.original_file.clone(),
        mime: item.mime.clone(),
        tags: item.tags.clone(),
        derived_from: item.derived_from.clone(),
        needs_extraction: item.needs_extraction,
        needs_inference: item.needs_inference,
        attachments: item.attachments.clone(),
    }
}

fn write_inbox_item(item: &InboxItem) -> Result<(), String> {
    let path = PathBuf::from(&item.path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
    }
    let body = join_levels(&item.l1_content, &item.l2_content);
    let raw = serialize_frontmatter(&build_frontmatter(item), &body)?;
    fs::write(&path, raw).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn parse_inbox_markdown(path: &Path) -> Result<InboxItem, String> {
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let trimmed = raw.trim_start();
    if trimmed.starts_with("---") {
        let after_first = &trimmed[3..];
        if let Some(end_pos) = after_first.find("\n---") {
            let yaml_str = &after_first[..end_pos];
            let body_start = 3 + end_pos + 4;
            let body = if body_start < trimmed.len() {
                trimmed[body_start..].trim_start_matches('\n').to_string()
            } else {
                String::new()
            };
            if let Ok(frontmatter) = serde_yaml::from_str::<InboxFrontmatter>(yaml_str) {
                return Ok(inbox_frontmatter_to_item(frontmatter, body, path));
            }
        }
    }

    let title = fallback_title_from_path(path);
    let body = raw;
    Ok(InboxItem {
        id: slugify(&title),
        kind: InboxItemKind::Text,
        status: InboxItemStatus::New,
        capture_state: "raw".to_string(),
        proposal_state: ProposalState::Pending,
        content_hash: hash_str(&body),
        created: Utc::now(),
        modified: Utc::now(),
        path: path.to_string_lossy().to_string(),
        title: title.clone(),
        summary: preview_text(&body),
        l1_content: body.clone(),
        l2_content: String::new(),
        source_url: None,
        original_file: None,
        mime: Some("text/markdown".to_string()),
        tags: Vec::new(),
        derived_from: Vec::new(),
        needs_extraction: false,
        needs_inference: false,
        attachments: Vec::new(),
    })
}

fn read_inbox_dir_recursive(dir: &Path, items: &mut Vec<InboxItem>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in
        fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if name == "_attachments" {
                continue;
            }
            read_inbox_dir_recursive(&path, items)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        if name.starts_with('_') {
            continue;
        }
        if let Ok(item) = parse_inbox_markdown(&path) {
            items.push(item);
        }
    }
    Ok(())
}

fn load_inbox_items(root: &Path) -> Result<Vec<InboxItem>, String> {
    let inbox_dir = SystemPaths::new(root).inbox_dir();
    let mut items = Vec::new();
    read_inbox_dir_recursive(&inbox_dir, &mut items)?;
    items.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(items)
}

fn persist_manifest(root: &Path, items: &[InboxItem]) -> Result<(), String> {
    let paths = SystemPaths::new(root);
    let manifest = IngestManifest {
        updated: Some(Utc::now()),
        items: items
            .iter()
            .map(|item| IngestManifestEntry {
                item_id: item.id.clone(),
                path: item.path.clone(),
                kind: format!("{:?}", item.kind).to_lowercase(),
                status: format!("{:?}", item.status).to_lowercase(),
                content_hash: item.content_hash.clone(),
                source_url: item.source_url.clone(),
                updated: item.modified,
            })
            .collect(),
    };

    if let Some(parent) = paths.ingest_manifest().parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create ingest directory: {}", e))?;
    }
    let content = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    fs::write(paths.ingest_manifest(), content)
        .map_err(|e| format!("Failed to write ingest manifest: {}", e))
}

fn update_manifest_from_disk(root: &Path) -> Result<(), String> {
    let items = load_inbox_items(root)?;
    persist_manifest(root, &items)
}

fn proposal_path(root: &Path, proposal_id: &str) -> PathBuf {
    SystemPaths::new(root)
        .proposals_dir()
        .join(format!("{}.json", proposal_id))
}

fn write_proposal(root: &Path, proposal: &IngestProposal) -> Result<(), String> {
    let path = proposal_path(root, &proposal.id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create proposals directory: {}", e))?;
    }
    let content = serde_json::to_string_pretty(proposal)
        .map_err(|e| format!("Failed to serialize proposal: {}", e))?;
    fs::write(path, content).map_err(|e| format!("Failed to write proposal: {}", e))
}

fn load_proposals(root: &Path) -> Result<Vec<IngestProposal>, String> {
    let dir = SystemPaths::new(root).proposals_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut proposals = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read proposals dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read proposals entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read proposal {}: {}", path.display(), e))?;
        if let Ok(proposal) = serde_json::from_str::<IngestProposal>(&raw) {
            proposals.push(proposal);
        }
    }
    proposals.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(proposals)
}

fn load_provider_config(root: &Path) -> Result<Option<InferenceProviderConfig>, String> {
    let path = SystemPaths::new(root).inference_provider_json();
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read inference provider config: {}", e))?;
    let config = serde_json::from_str::<InferenceProviderConfig>(&raw)
        .map_err(|e| format!("Failed to parse inference provider config: {}", e))?;
    Ok(Some(normalize_provider_config(config)))
}

fn persist_provider_config(
    root: &Path,
    config: &InferenceProviderConfig,
) -> Result<InferenceProviderConfig, String> {
    let path = SystemPaths::new(root).inference_provider_json();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create provider config directory: {}", e))?;
    }
    let normalized = normalize_provider_config(config.clone());
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Failed to serialize provider config: {}", e))?;
    fs::write(path, content).map_err(|e| format!("Failed to persist provider config: {}", e))?;
    Ok(normalized)
}

fn default_capabilities(
    preset: &InferenceProviderPreset,
    kind: &InferenceProviderKind,
) -> Vec<InferenceCapability> {
    let mut caps = vec![
        InferenceCapability::Proposal,
        InferenceCapability::Classification,
        InferenceCapability::Summary,
        InferenceCapability::Chat,
        InferenceCapability::Streaming,
    ];
    match (kind, preset) {
        (InferenceProviderKind::Anthropic, _) => caps.push(InferenceCapability::Vision),
        (InferenceProviderKind::OpenAiCompatible, InferenceProviderPreset::OpenAi)
        | (InferenceProviderKind::OpenAiCompatible, InferenceProviderPreset::OpenRouter) => {
            caps.push(InferenceCapability::Vision)
        }
        _ => {}
    }
    caps
}

fn default_base_url(
    kind: &InferenceProviderKind,
    preset: &InferenceProviderPreset,
) -> Option<String> {
    match (kind, preset) {
        (InferenceProviderKind::Anthropic, _) => Some(DEFAULT_ANTHROPIC_BASE_URL.to_string()),
        (InferenceProviderKind::OpenAiCompatible, InferenceProviderPreset::OpenAi) => {
            Some(DEFAULT_OPENAI_BASE_URL.to_string())
        }
        (InferenceProviderKind::OpenAiCompatible, InferenceProviderPreset::OpenRouter) => {
            Some(DEFAULT_OPENROUTER_BASE_URL.to_string())
        }
        (InferenceProviderKind::OpenAiCompatible, InferenceProviderPreset::Ollama) => {
            Some(DEFAULT_OLLAMA_BASE_URL.to_string())
        }
        (InferenceProviderKind::OpenAiCompatible, InferenceProviderPreset::LmStudio) => {
            Some(DEFAULT_LM_STUDIO_BASE_URL.to_string())
        }
        _ => None,
    }
}

fn normalize_provider_config(mut config: InferenceProviderConfig) -> InferenceProviderConfig {
    if config
        .base_url
        .as_ref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        config.base_url = default_base_url(&config.kind, &config.preset);
    }
    if config.capabilities.is_empty() {
        config.capabilities = default_capabilities(&config.preset, &config.kind);
    }
    config
}

fn config_to_status(config: Option<&InferenceProviderConfig>) -> InferenceProviderStatus {
    match config {
        Some(config) => InferenceProviderStatus {
            configured: true,
            enabled: config.enabled,
            healthy: false,
            kind: Some(config.kind.clone()),
            preset: Some(config.preset.clone()),
            base_url: config.base_url.clone(),
            model: Some(config.model.clone()),
            capabilities: config.capabilities.clone(),
            message: if config.enabled {
                "Provider configured. Running live inference is optional and can fall back to heuristics.".to_string()
            } else {
                "Provider saved but disabled. Inbox will use heuristic proposals.".to_string()
            },
        },
        None => InferenceProviderStatus {
            configured: false,
            enabled: false,
            healthy: false,
            kind: None,
            preset: None,
            base_url: None,
            model: None,
            capabilities: Vec::new(),
            message: "No provider configured. Inbox uses deterministic heuristic proposals."
                .to_string(),
        },
    }
}

fn is_private_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    if matches!(host.as_str(), "localhost" | "0.0.0.0") || host.ends_with(".local") {
        return true;
    }
    if host.starts_with("127.") || host.starts_with("10.") || host.starts_with("192.168.") {
        return true;
    }
    if let Some(rest) = host.strip_prefix("172.") {
        if let Some(octet) = rest.split('.').next() {
            if let Ok(value) = octet.parse::<u8>() {
                return (16..=31).contains(&value);
            }
        }
    }
    false
}

fn validate_public_http_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|e| format!("Invalid URL: {}", e))?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http/https URLs are supported in inbox links".to_string()),
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL must include a host".to_string())?;
    if is_private_host(host) {
        return Err(
            "Private or local network URLs are not allowed for inbox link ingestion".to_string(),
        );
    }
    Ok(url)
}

async fn fetch_link_preview(url: &Url) -> Result<(Option<String>, String), String> {
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .get(url.clone())
        .header(header::USER_AGENT, "AI-Context-OS/0.1 inbox-ingest")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch link preview: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Link preview fetch failed with status {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read link preview body: {}", e))?;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_FETCH_BYTES)]).to_string();
    let title = extract_title_from_html(&text);
    let preview = preview_text(&strip_html_tags(&text));
    Ok((title, preview))
}

fn lm_studio_api_base(base_url: &str, api_path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if let Some(prefix) = trimmed.strip_suffix("/v1") {
        format!("{}/{}", prefix, api_path)
    } else if trimmed.ends_with(api_path) {
        trimmed.to_string()
    } else {
        format!("{}/{}", trimmed, api_path)
    }
}

async fn lm_studio_model_state(base_url: &str, model: &str) -> Result<Option<String>, String> {
    let mut endpoint = Url::parse(&format!(
        "{}/models",
        lm_studio_api_base(base_url, "api/v0")
    ))
    .map_err(|e| format!("Invalid LM Studio base URL: {}", e))?;
    endpoint
        .path_segments_mut()
        .map_err(|_| "Invalid LM Studio model state endpoint".to_string())?
        .push(model);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let response = client.get(endpoint).send().await;
    let Ok(response) = response else {
        return Ok(None);
    };
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Ok(None);
    }

    let body: Value = response.json().await.unwrap_or(json!({}));
    Ok(body
        .get("state")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string()))
}

async fn probe_lm_studio_model_states(
    base_url: &str,
    timeout_secs: u64,
) -> Result<HashMap<String, bool>, String> {
    let endpoint = format!("{}/models", lm_studio_api_base(base_url, "api/v0"));
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Unreachable: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Status {}", response.status()));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    let states = body
        .get("data")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").and_then(|value| value.as_str())?.to_string();
                    let loaded = item
                        .get("state")
                        .and_then(|value| value.as_str())
                        .map(|state| state == "loaded")?;
                    Some((id, loaded))
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    Ok(states)
}

async fn probe_lm_studio_models(
    base_url: &str,
    timeout_secs: u64,
) -> Result<Vec<ProviderModel>, String> {
    let mut models = probe_openai_compatible(base_url, timeout_secs).await?;
    let model_states = probe_lm_studio_model_states(base_url, timeout_secs)
        .await
        .unwrap_or_default();

    for model in &mut models {
        model.loaded = model_states.get(&model.id).copied();
    }

    models.sort_by(|left, right| {
        right
            .loaded
            .unwrap_or(false)
            .cmp(&left.loaded.unwrap_or(false))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(models)
}

/// For LM Studio, try to load the model into memory before inference.
/// Ollama auto-loads on first request, so this is a no-op for Ollama.
async fn ensure_model_loaded(config: &InferenceProviderConfig) -> Result<(), String> {
    if config.preset != InferenceProviderPreset::LmStudio {
        return Ok(());
    }
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or(DEFAULT_LM_STUDIO_BASE_URL);
    if matches!(lm_studio_model_state(base_url, &config.model).await?, Some(state) if state == "loaded")
    {
        return Ok(());
    }

    // LM Studio native API lives under /api/v1, not /v1
    let native_base = lm_studio_api_base(base_url, "api/v1");
    let endpoint = format!("{}/models/load", native_base);
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let response = client
        .post(&endpoint)
        .json(&json!({ "model": config.model }))
        .send()
        .await
        .map_err(|e| format!("Failed to load model in LM Studio: {}", e))?;
    if !response.status().is_success() {
        let body: Value = response.json().await.unwrap_or(json!({}));
        let msg = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("LM Studio model load failed: {}", msg));
    }
    Ok(())
}

async fn provider_chat_completion(
    config: &InferenceProviderConfig,
    request: &ChatCompletionRequest,
) -> Result<ChatCompletionResponse, String> {
    let normalized = normalize_provider_config(config.clone());
    if !normalized.enabled {
        return Err("Provider is disabled".to_string());
    }
    // Ensure model is loaded (LM Studio needs explicit loading)
    ensure_model_loaded(&normalized).await?;
    match normalized.kind {
        InferenceProviderKind::OpenAiCompatible => {
            openai_compatible_chat(&normalized, request).await
        }
        InferenceProviderKind::Anthropic => anthropic_chat(&normalized, request).await,
    }
}

fn latest_user_query(messages: &[ChatMessage]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.clone())
}

fn build_context_debug_from_request(request: &ChatCompletionRequest) -> Option<ChatContextDebug> {
    let prompt = request.context_prompt.as_deref()?.trim();
    if prompt.is_empty() && request.context_memory_ids.is_empty() {
        return None;
    }

    Some(ChatContextDebug {
        prompt_chars: prompt.len() as u32,
        token_budget: 0,
        tokens_used: 0,
        memory_count: request.context_memory_ids.len() as u32,
        memories: request
            .context_memory_ids
            .iter()
            .map(|id| ChatContextDebugMemory {
                id: id.clone(),
                score: None,
                token_estimate: None,
                load_level: None,
            })
            .collect(),
    })
}

fn build_context_debug_from_result(
    prompt_chars: usize,
    token_budget: u32,
    result: &crate::core::engine::ContextResult,
) -> ChatContextDebug {
    ChatContextDebug {
        prompt_chars: prompt_chars as u32,
        token_budget,
        tokens_used: result.tokens_used,
        memory_count: result.loaded.len() as u32,
        memories: result
            .loaded
            .iter()
            .map(|memory| ChatContextDebugMemory {
                id: memory.memory_id.clone(),
                score: Some(memory.score.final_score),
                token_estimate: Some(memory.token_estimate),
                load_level: Some(memory.load_level.clone()),
            })
            .collect(),
    }
}

/// Builds the `messages` array to send to an OpenAI-compatible API.
///
/// Layout:
///   1. `system` message — from `request.system_prompt` (if any)
///   2. `user` message  — from `request.context_prompt`, injected as loaded
///      memory / context so the model can answer questions about it (if any)
///   3. All `request.messages` in order
pub(super) fn build_openai_messages(request: &ChatCompletionRequest) -> Vec<Value> {
    let mut messages: Vec<Value> = Vec::new();

    if let Some(system_prompt) = &request.system_prompt {
        messages.push(json!({ "role": "system", "content": system_prompt }));
    }

    // Inject loaded context as a conversation message so the model treats it
    // as background knowledge for the current session.
    if let Some(ctx) = &request.context_prompt {
        messages.push(json!({ "role": "user", "content": ctx }));
    }

    messages.extend(
        request
            .messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content })),
    );

    messages
}

/// Builds the `messages` array for Anthropic's `/v1/messages` endpoint.
///
/// Anthropic takes the system prompt as a top-level `system` field (handled by
/// the caller), so this function only emits conversation turns. Layout:
///   1. `user` turn — from `request.context_prompt`, injected as loaded vault
///      context so the model treats it as background knowledge (if any)
///   2. All `request.messages` in order, normalized to `user`/`assistant`
pub(super) fn build_anthropic_messages(request: &ChatCompletionRequest) -> Vec<Value> {
    let mut messages: Vec<Value> = Vec::new();

    if let Some(ctx) = &request.context_prompt {
        messages.push(json!({
            "role": "user",
            "content": [{ "type": "text", "text": ctx }]
        }));
    }

    messages.extend(request.messages.iter().map(|message| {
        json!({
            "role": if message.role == "assistant" { "assistant" } else { "user" },
            "content": [{ "type": "text", "text": message.content }]
        })
    }));

    messages
}

async fn openai_compatible_chat(
    config: &InferenceProviderConfig,
    request: &ChatCompletionRequest,
) -> Result<ChatCompletionResponse, String> {
    let base_url = config
        .base_url
        .clone()
        .ok_or_else(|| "Missing base URL for OpenAI-compatible provider".to_string())?;
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    // Local models (Ollama/LM Studio) can be slow on first inference
    let timeout_secs = match config.preset {
        InferenceProviderPreset::Ollama | InferenceProviderPreset::LmStudio => 120,
        _ => 30,
    };
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let messages = build_openai_messages(request);

    let payload = json!({
        "model": request.model.clone().unwrap_or_else(|| config.model.clone()),
        "messages": messages,
        "temperature": 0.2,
    });

    let mut req = client.post(endpoint).json(&payload);
    if let Some(api_key) = &config.api_key {
        if !api_key.trim().is_empty() {
            req = req.bearer_auth(api_key);
        }
    }
    if matches!(config.preset, InferenceProviderPreset::OpenRouter) {
        req = req.header("HTTP-Referer", "https://github.com/alexdcd/AI-Context-OS");
        req = req.header("X-Title", "AI Context OS");
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Chat request failed: {}", e))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse chat response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Provider error {}: {}", status, body));
    }

    let text = body
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .unwrap_or_default()
        .to_string();

    Ok(ChatCompletionResponse {
        text,
        model: body
            .get("model")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .or_else(|| Some(config.model.clone())),
        context_memory_ids: Vec::new(),
        context_debug: None,
    })
}

async fn anthropic_chat(
    config: &InferenceProviderConfig,
    request: &ChatCompletionRequest,
) -> Result<ChatCompletionResponse, String> {
    let base_url = config
        .base_url
        .clone()
        .unwrap_or_else(|| DEFAULT_ANTHROPIC_BASE_URL.to_string());
    let endpoint = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let api_key = config
        .api_key
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Anthropic requires an API key".to_string())?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let payload = json!({
        "model": request.model.clone().unwrap_or_else(|| config.model.clone()),
        "max_tokens": 1024,
        "temperature": 0.2,
        "system": request.system_prompt.clone().unwrap_or_default(),
        "messages": build_anthropic_messages(request),
    });

    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Chat request failed: {}", e))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse chat response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Provider error {}: {}", status, body));
    }

    let text = body
        .get("content")
        .and_then(|content| content.as_array())
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .and_then(|text| text.as_str())
        .unwrap_or_default()
        .to_string();

    Ok(ChatCompletionResponse {
        text,
        model: body
            .get("model")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .or_else(|| Some(config.model.clone())),
        context_memory_ids: Vec::new(),
        context_debug: None,
    })
}

async fn health_check(config: &InferenceProviderConfig) -> Result<String, String> {
    let normalized = normalize_provider_config(config.clone());
    match normalized.kind {
        InferenceProviderKind::OpenAiCompatible => {
            let base_url = normalized
                .base_url
                .clone()
                .ok_or_else(|| "Missing base URL".to_string())?;
            let endpoint = format!("{}/models", base_url.trim_end_matches('/'));
            let client = Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
            let mut req = client.get(endpoint);
            if let Some(api_key) = &normalized.api_key {
                if !api_key.trim().is_empty() {
                    req = req.bearer_auth(api_key);
                }
            }
            let response = req
                .send()
                .await
                .map_err(|e| format!("Health check failed: {}", e))?;
            if !response.status().is_success() {
                return Err(format!(
                    "Health check returned status {}",
                    response.status()
                ));
            }
            let body: Value = response.json().await.unwrap_or(json!({}));
            let model_count = body
                .get("data")
                .and_then(|d| d.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            // For LM Studio: also try to load the selected model so it's ready
            let load_msg = if normalized.preset == InferenceProviderPreset::LmStudio
                && !normalized.model.is_empty()
            {
                match ensure_model_loaded(&normalized).await {
                    Ok(()) => format!(" — model '{}' loaded", normalized.model),
                    Err(e) => format!(" — warning: {}", e),
                }
            } else {
                String::new()
            };
            Ok(format!(
                "Connection successful — {} model{} available{}",
                model_count,
                if model_count == 1 { "" } else { "s" },
                load_msg
            ))
        }
        InferenceProviderKind::Anthropic => {
            let _ = anthropic_chat(
                &normalized,
                &ChatCompletionRequest {
                    system_prompt: Some("Reply with OK.".to_string()),
                    include_vault_context: false,
                    context_prompt: None,
                    context_memory_ids: Vec::new(),
                    model: Some(normalized.model.clone()),
                    messages: vec![ChatMessage {
                        role: "user".to_string(),
                        content: "OK".to_string(),
                    }],
                },
            )
            .await?;
            Ok("Connection successful".to_string())
        }
    }
}

async fn probe_openai_compatible(
    base_url: &str,
    timeout_secs: u64,
) -> Result<Vec<ProviderModel>, String> {
    let endpoint = format!("{}/models", base_url.trim_end_matches('/'));
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Unreachable: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Status {}", response.status()));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    let models = body
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let id = m.get("id").and_then(|v| v.as_str())?.to_string();
                    let name = m
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or_else(|| m.get("id").and_then(|v| v.as_str()).unwrap_or(""))
                        .to_string();
                    let size = m
                        .get("size")
                        .or_else(|| m.get("vram_required"))
                        .and_then(|v| v.as_u64());
                    let family = m
                        .get("family")
                        .or_else(|| m.get("owned_by"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    Some(ProviderModel {
                        id,
                        name,
                        size,
                        family,
                        loaded: None,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(models)
}

async fn discover_providers() -> Vec<DiscoveredProvider> {
    let probes = vec![
        (
            InferenceProviderPreset::Ollama,
            "Ollama",
            DEFAULT_OLLAMA_BASE_URL,
        ),
        (
            InferenceProviderPreset::LmStudio,
            "LM Studio",
            DEFAULT_LM_STUDIO_BASE_URL,
        ),
    ];
    let mut results = Vec::new();
    for (preset, name, base_url) in probes {
        let models_result = match preset {
            InferenceProviderPreset::LmStudio => probe_lm_studio_models(base_url, 3).await,
            _ => probe_openai_compatible(base_url, 3).await,
        };
        match models_result {
            Ok(models) => results.push(DiscoveredProvider {
                preset,
                name: name.to_string(),
                base_url: base_url.to_string(),
                reachable: true,
                models,
            }),
            Err(_) => results.push(DiscoveredProvider {
                preset,
                name: name.to_string(),
                base_url: base_url.to_string(),
                reachable: false,
                models: Vec::new(),
            }),
        }
    }
    results
}

async fn fetch_models_for_config(
    config: &InferenceProviderConfig,
) -> Result<Vec<ProviderModel>, String> {
    let normalized = normalize_provider_config(config.clone());
    let base_url = normalized
        .base_url
        .ok_or_else(|| "Missing base URL".to_string())?;
    match normalized.kind {
        InferenceProviderKind::OpenAiCompatible => match normalized.preset {
            InferenceProviderPreset::LmStudio => probe_lm_studio_models(&base_url, 10).await,
            _ => probe_openai_compatible(&base_url, 10).await,
        },
        InferenceProviderKind::Anthropic => {
            // Anthropic doesn't have a public models list endpoint;
            // return a curated list of common models.
            Ok(vec![
                ProviderModel {
                    id: "claude-sonnet-4-20250514".to_string(),
                    name: "Claude Sonnet 4".to_string(),
                    size: None,
                    family: Some("claude-4".to_string()),
                    loaded: None,
                },
                ProviderModel {
                    id: "claude-haiku-4-20250414".to_string(),
                    name: "Claude Haiku 4".to_string(),
                    size: None,
                    family: Some("claude-4".to_string()),
                    loaded: None,
                },
                ProviderModel {
                    id: "claude-3-5-haiku-20241022".to_string(),
                    name: "Claude 3.5 Haiku".to_string(),
                    size: None,
                    family: Some("claude-3.5".to_string()),
                    loaded: None,
                },
            ])
        }
    }
}

fn build_inbox_enrichment(
    root: &Path,
    item: &InboxItem,
    memory_corpus: &[MemoryCorpusEntry],
    inbox_duplicates: Vec<InboxDuplicateCandidate>,
) -> InboxEnrichment {
    let mut enrichment = InboxEnrichment {
        duplicate_candidates: inbox_duplicates,
        ..InboxEnrichment::default()
    };

    if memory_corpus.is_empty() {
        enrichment.destination_candidates = infer_destination_candidates(root, &[]);
        enrichment.inferred_destination = enrichment
            .destination_candidates
            .first()
            .map(|candidate| candidate.path.clone());
        enrichment.context_prompt = build_enrichment_context_prompt(
            item,
            &enrichment.related_memory_candidates,
            &enrichment.duplicate_candidates,
            &enrichment.destination_candidates,
            memory_corpus,
        );
        return enrichment;
    }

    let query = item_query_text(item);
    let documents: Vec<&str> = memory_corpus
        .iter()
        .map(|entry| entry.document.as_str())
        .collect();
    let bm25_corpus = Bm25Corpus::from_documents(&documents);
    let memory_metas: Vec<MemoryMeta> = memory_corpus.iter().map(|entry| entry.meta.clone()).collect();
    let wikilink_targets = detect_item_wikilink_targets(item, &memory_metas);
    let source_url = item.source_url.clone().unwrap_or_default();
    let tag_query = combine_query_parts(&[item.tags.join(" "), query.clone()]);

    let raw_bm25_scores: Vec<f64> = memory_corpus
        .iter()
        .map(|entry| {
            if bm25_corpus.total_docs == 0 {
                0.0
            } else {
                bm25_score(
                    &query,
                    &entry.document,
                    bm25_corpus.avg_doc_len.max(1.0),
                    bm25_corpus.total_docs,
                    &bm25_corpus.doc_freq,
                )
            }
        })
        .collect();
    let max_bm25 = raw_bm25_scores
        .iter()
        .copied()
        .fold(0.0_f64, f64::max);

    let mut related_candidates = Vec::new();
    let mut duplicate_candidates = enrichment.duplicate_candidates.clone();
    let mut seen_duplicate_keys = HashSet::new();

    for (index, entry) in memory_corpus.iter().enumerate() {
        let normalized_bm25 = if max_bm25 > 0.0 {
            raw_bm25_scores[index] / max_bm25
        } else {
            0.0
        };
        let tag_overlap = tag_match_score(&tag_query, &entry.meta.tags);
        let l0_keyword = l0_keyword_score(&query, &entry.meta.l0);
        let wikilink = if wikilink_targets.contains(&entry.meta.id) {
            1.0
        } else {
            0.0
        };
        let source_url_score = if !source_url.is_empty()
            && entry.source_urls.iter().any(|candidate| candidate == &source_url)
        {
            1.0
        } else {
            0.0
        };

        let mut final_score = normalized_bm25 * 0.45
            + tag_overlap * 0.20
            + l0_keyword * 0.15
            + wikilink * 0.10
            + source_url_score * 0.10;
        if wikilink > 0.0 {
            final_score = final_score.max(0.82);
        }
        if source_url_score > 0.0 {
            final_score = final_score.max(0.98);
            let key = format!("memory_source_url:{}", entry.meta.id);
            if seen_duplicate_keys.insert(key) {
                duplicate_candidates.push(InboxDuplicateCandidate {
                    kind: "memory_source_url".to_string(),
                    target_id: entry.meta.id.clone(),
                    target_title: entry.meta.l0.clone(),
                    file_path: Some(entry.path.clone()),
                    confidence: 0.98,
                    rationale: format!(
                        "Matches the same source URL already captured by memory '{}'.",
                        entry.meta.l0
                    ),
                });
            }
        }

        let mut reasons = Vec::new();
        if normalized_bm25 >= 0.35 {
            reasons.push(format!("Strong lexical match (BM25 {:.2}).", normalized_bm25));
        }
        if tag_overlap >= 0.25 {
            reasons.push(format!("Tag overlap {:.2}.", tag_overlap));
        }
        if l0_keyword >= 0.25 {
            reasons.push(format!("L0 keyword overlap {:.2}.", l0_keyword));
        }
        if wikilink > 0.0 {
            reasons.push("Explicit wikilink from the inbox content.".to_string());
        }
        if source_url_score > 0.0 {
            reasons.push("Exact source URL match.".to_string());
        }

        if final_score >= 0.18 || wikilink > 0.0 || source_url_score > 0.0 {
            related_candidates.push(InboxRelatedMemoryCandidate {
                memory_id: entry.meta.id.clone(),
                l0: entry.meta.l0.clone(),
                ontology: entry.meta.ontology.clone(),
                file_path: entry.path.clone(),
                folder_category: entry.meta.folder_category.clone(),
                protected: entry.meta.protected,
                score: InboxRecommendationScore {
                    bm25: normalized_bm25,
                    tag_overlap,
                    l0_keyword,
                    wikilink,
                    source_url: source_url_score,
                },
                final_score,
                reasons,
            });
        }
    }

    related_candidates.sort_by(|left, right| right.final_score.total_cmp(&left.final_score));
    related_candidates.truncate(8);

    duplicate_candidates.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    enrichment.duplicate_candidates = duplicate_candidates;
    enrichment.related_memory_candidates = related_candidates;
    enrichment.destination_candidates =
        infer_destination_candidates(root, &enrichment.related_memory_candidates);
    enrichment.inferred_destination = enrichment
        .destination_candidates
        .first()
        .map(|candidate| candidate.path.clone());
    enrichment.context_memory_ids = enrichment
        .related_memory_candidates
        .iter()
        .take(5)
        .map(|candidate| candidate.memory_id.clone())
        .collect();

    if let Some(target) = enrichment.related_memory_candidates.iter().find(|candidate| {
        !candidate.protected
            && (candidate.score.source_url >= 0.99
                || candidate.score.wikilink >= 0.99
                || candidate.final_score >= 0.72)
    }) {
        enrichment.suggested_target_memory_id = Some(target.memory_id.clone());
        enrichment.suggested_target_memory_path = Some(target.file_path.clone());
    }

    enrichment.context_prompt = build_enrichment_context_prompt(
        item,
        &enrichment.related_memory_candidates,
        &enrichment.duplicate_candidates,
        &enrichment.destination_candidates,
        memory_corpus,
    );

    enrichment
}

fn heuristic_proposal(item: &InboxItem) -> IngestProposal {
    let now = Utc::now();
    let (action, ontology, rationale, l0, l1, l2, confidence) = match item.kind {
        InboxItemKind::Link => (
            ProposalAction::RouteToSources,
            Some(MemoryOntology::Source),
            "Link captures usually belong in sources/ first so they stay protected and traceable."
                .to_string(),
            Some(item.title.clone()),
            Some(item.summary.clone()),
            Some(item.l2_content.clone()),
            0.76,
        ),
        InboxItemKind::File if item.needs_extraction => (
            ProposalAction::NeedsReview,
            None,
            "This file needs extraction or OCR before it can be promoted safely.".to_string(),
            Some(item.title.clone()),
            Some(item.summary.clone()),
            Some(item.l2_content.clone()),
            0.58,
        ),
        InboxItemKind::File => (
            ProposalAction::RouteToSources,
            Some(MemoryOntology::Source),
            "Reference files are routed to sources/ by default to preserve the original artifact."
                .to_string(),
            Some(item.title.clone()),
            Some(item.summary.clone()),
            Some(item.l2_content.clone()),
            0.74,
        ),
        InboxItemKind::Text => {
            let structured = !item.l1_content.trim().is_empty() && item.l1_content.contains('\n');
            if structured {
                (
                    ProposalAction::PromoteMemory,
                    Some(MemoryOntology::Concept),
                    "Structured text with a meaningful summary is a good candidate for promotion into canonical memory.".to_string(),
                    Some(item.title.clone()),
                    Some(item.summary.clone()),
                    Some(item.l2_content.clone()),
                    0.67,
                )
            } else {
                (
                    ProposalAction::NeedsReview,
                    None,
                    "Freeform text stays in review until a stronger ontology or destination is chosen.".to_string(),
                    Some(item.title.clone()),
                    Some(item.summary.clone()),
                    Some(item.l2_content.clone()),
                    0.52,
                )
            }
        }
    };

    IngestProposal {
        id: format!("proposal-{}", Uuid::new_v4().simple()),
        item_id: item.id.clone(),
        item_path: item.path.clone(),
        action,
        state: ProposalState::Pending,
        confidence,
        rationale,
        created: now,
        modified: now,
        destination: None,
        target_memory_id: None,
        target_memory_path: None,
        ontology,
        l0,
        l1_content: l1,
        l2_content: l2,
        tags: item.tags.clone(),
        derived_from: vec![item.id.clone()],
        context_memory_ids: Vec::new(),
        related_memory_candidates: Vec::new(),
        duplicate_candidates: Vec::new(),
        destination_candidates: Vec::new(),
        inference_provider: None,
        inference_preset: None,
        origin: "heuristic".to_string(),
    }
}

fn duplicate_proposal(item: &InboxItem, duplicate_of: &InboxItem) -> IngestProposal {
    let now = Utc::now();
    IngestProposal {
        id: format!("proposal-{}", Uuid::new_v4().simple()),
        item_id: item.id.clone(),
        item_path: item.path.clone(),
        action: ProposalAction::Discard,
        state: ProposalState::Pending,
        confidence: 0.95,
        rationale: format!(
            "This inbox item appears to duplicate '{}' by content hash or source URL.",
            duplicate_of.title
        ),
        created: now,
        modified: now,
        destination: None,
        target_memory_id: None,
        target_memory_path: None,
        ontology: None,
        l0: Some(item.title.clone()),
        l1_content: Some(item.summary.clone()),
        l2_content: Some(item.l2_content.clone()),
        tags: item.tags.clone(),
        derived_from: vec![item.id.clone(), duplicate_of.id.clone()],
        context_memory_ids: Vec::new(),
        related_memory_candidates: Vec::new(),
        duplicate_candidates: Vec::new(),
        destination_candidates: Vec::new(),
        inference_provider: None,
        inference_preset: None,
        origin: "heuristic".to_string(),
    }
}

async fn infer_proposal(root: &Path, item: &InboxItem) -> Result<IngestProposal, String> {
    let config = load_provider_config(root)?.ok_or_else(|| "No provider configured".to_string())?;
    if !config.enabled {
        return Err("Provider is disabled".to_string());
    }

    let system_prompt = "You are generating governed ingestion proposals for AI Context OS. Reply with JSON only. Allowed action values: promote_memory, route_to_sources, update_memory, discard, needs_review. Allowed ontology values: source, entity, concept, synthesis. Keep proposals conservative.";
    let user_payload = json!({
        "item": {
            "id": item.id,
            "kind": item.kind,
            "title": item.title,
            "summary": item.summary,
            "l1_content": item.l1_content,
            "l2_content": item.l2_content,
            "source_url": item.source_url,
            "tags": item.tags,
            "needs_extraction": item.needs_extraction,
            "needs_inference": item.needs_inference
        },
        "response_schema": {
            "action": "promote_memory|route_to_sources|update_memory|discard|needs_review",
            "confidence": 0.0,
            "rationale": "short rationale",
            "ontology": "source|entity|concept|synthesis|null",
            "l0": "string|null",
            "l1_content": "string|null",
            "l2_content": "string|null",
            "tags": ["tag"]
        }
    });

    let response = provider_chat_completion(
        &config,
        &ChatCompletionRequest {
            system_prompt: Some(system_prompt.to_string()),
            include_vault_context: false,
            context_prompt: None,
            context_memory_ids: Vec::new(),
            model: Some(config.model.clone()),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: user_payload.to_string(),
            }],
        },
    )
    .await?;

    let raw_text = strip_markdown_json(&response.text);
    let parsed: ProposalModelResponse = serde_json::from_str(&raw_text).map_err(|e| {
        format!(
            "Failed to parse proposal JSON: {} — raw response: {}",
            e,
            &response.text[..response.text.len().min(500)]
        )
    })?;
    let now = Utc::now();

    Ok(IngestProposal {
        id: format!("proposal-{}", Uuid::new_v4().simple()),
        item_id: item.id.clone(),
        item_path: item.path.clone(),
        action: parsed.action,
        state: ProposalState::Pending,
        confidence: parsed.confidence.clamp(0.0, 1.0),
        rationale: parsed.rationale,
        created: now,
        modified: now,
        destination: None,
        ontology: parsed.ontology,
        l0: parsed.l0.or_else(|| Some(item.title.clone())),
        l1_content: parsed.l1_content.or_else(|| Some(item.summary.clone())),
        l2_content: parsed.l2_content.or_else(|| Some(item.l2_content.clone())),
        tags: if parsed.tags.is_empty() {
            item.tags.clone()
        } else {
            parsed.tags
        },
        derived_from: vec![item.id.clone()],
        inference_provider: Some(config.kind.clone()),
        inference_preset: Some(config.preset.clone()),
        origin: "inferred".to_string(),
    })
}

fn update_item_status(
    root: &Path,
    item_id: &str,
    status: InboxItemStatus,
    proposal_state: ProposalState,
) -> Result<InboxItem, String> {
    let mut items = load_inbox_items(root)?;
    let item = items
        .iter_mut()
        .find(|item| item.id == item_id)
        .ok_or_else(|| format!("Inbox item not found: {}", item_id))?;
    item.status = status;
    item.proposal_state = proposal_state;
    item.modified = Utc::now();
    write_inbox_item(item)?;
    let updated = item.clone();
    let _ = item;
    persist_manifest(root, &items)?;
    Ok(updated)
}

fn append_daily_log(
    root: &Path,
    entry_type: &str,
    summary: String,
    tags: Vec<String>,
    source: String,
) -> Result<(), String> {
    let paths = SystemPaths::new(root);
    crate::core::jsonl::append_jsonl(
        &paths.daily_log(),
        &DailyEntry {
            timestamp: Utc::now(),
            entry_type: entry_type.to_string(),
            summary,
            tags,
            source,
        },
    )
}

#[tauri::command]
pub fn list_inbox_items(state: State<AppState>) -> Result<Vec<InboxItem>, String> {
    let root = state.get_root();
    let items = load_inbox_items(&root)?;
    persist_manifest(&root, &items)?;
    Ok(items)
}

#[tauri::command]
pub fn get_inbox_item(id: String, state: State<AppState>) -> Result<InboxItem, String> {
    let root = state.get_root();
    load_inbox_items(&root)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("Inbox item not found: {}", id))
}

#[tauri::command]
pub fn create_inbox_text(
    input: CreateInboxTextInput,
    app: AppHandle,
    state: State<AppState>,
) -> Result<InboxItem, String> {
    let root = state.get_root();
    let paths = SystemPaths::new(&root);
    fs::create_dir_all(paths.inbox_dir())
        .map_err(|e| format!("Failed to create inbox dir: {}", e))?;

    let title = if input.title.trim().is_empty() {
        "Inbox note".to_string()
    } else {
        input.title.trim().to_string()
    };
    let id = format!(
        "{}-{}",
        slugify(&title),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let path = paths.inbox_dir().join(format!("{}.md", id));
    let now = Utc::now();
    let l1 = if input.content.trim().is_empty() {
        title.clone()
    } else {
        input.content.trim().to_string()
    };
    let item = InboxItem {
        id: id.clone(),
        kind: InboxItemKind::Text,
        status: InboxItemStatus::New,
        capture_state: "raw".to_string(),
        proposal_state: ProposalState::Pending,
        content_hash: hash_str(&l1),
        created: now,
        modified: now,
        path: path.to_string_lossy().to_string(),
        title: title.clone(),
        summary: preview_text(&l1),
        l1_content: l1,
        l2_content: String::new(),
        source_url: None,
        original_file: None,
        mime: Some("text/markdown".to_string()),
        tags: input.tags,
        derived_from: Vec::new(),
        needs_extraction: false,
        needs_inference: false,
        attachments: Vec::new(),
    };
    write_inbox_item(&item)?;
    update_manifest_from_disk(&root)?;
    append_daily_log(
        &root,
        "inbox_created",
        format!("Created inbox text '{}'", item.title),
        item.tags.clone(),
        item.id.clone(),
    )?;
    state.mark_recent_write(Path::new(&item.path));
    let _ = app.emit("inbox-changed", &item.id);
    Ok(item)
}

#[tauri::command]
pub async fn create_inbox_link(
    input: CreateInboxLinkInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<InboxItem, String> {
    let root = state.get_root();
    let paths = SystemPaths::new(&root);
    fs::create_dir_all(paths.inbox_dir())
        .map_err(|e| format!("Failed to create inbox dir: {}", e))?;

    let url = validate_public_http_url(&input.url)?;
    let (fetched_title, fetched_preview) = fetch_link_preview(&url)
        .await
        .unwrap_or((None, String::new()));
    let title = input
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(fetched_title)
        .unwrap_or_else(|| url.host_str().unwrap_or("Link").to_string());
    let id = format!(
        "{}-{}",
        slugify(&title),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let path = paths.inbox_dir().join(format!("{}.md", id));
    let notes = input.notes.unwrap_or_default();
    let l1 = if fetched_preview.is_empty() {
        format!("{}\n\n{}", url.as_str(), notes).trim().to_string()
    } else {
        format!("{}\n\n{}", fetched_preview, notes)
            .trim()
            .to_string()
    };
    let now = Utc::now();
    let item = InboxItem {
        id: id.clone(),
        kind: InboxItemKind::Link,
        status: InboxItemStatus::Normalized,
        capture_state: "fetched".to_string(),
        proposal_state: ProposalState::Pending,
        content_hash: hash_str(url.as_str()),
        created: now,
        modified: now,
        path: path.to_string_lossy().to_string(),
        title: title.clone(),
        summary: if fetched_preview.is_empty() {
            url.to_string()
        } else {
            fetched_preview.clone()
        },
        l1_content: l1,
        l2_content: format!("Source URL: {}", url),
        source_url: Some(url.to_string()),
        original_file: None,
        mime: Some("text/uri-list".to_string()),
        tags: input.tags,
        derived_from: Vec::new(),
        needs_extraction: false,
        needs_inference: false,
        attachments: Vec::new(),
    };
    write_inbox_item(&item)?;
    update_manifest_from_disk(&root)?;
    append_daily_log(
        &root,
        "inbox_created",
        format!("Captured inbox link '{}'", item.title),
        item.tags.clone(),
        item.id.clone(),
    )?;
    state.mark_recent_write(Path::new(&item.path));
    let _ = app.emit("inbox-changed", &item.id);
    Ok(item)
}

#[tauri::command]
pub fn import_inbox_files(
    paths_to_import: Vec<String>,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Vec<InboxItem>, String> {
    let root = state.get_root();
    let paths = SystemPaths::new(&root);
    fs::create_dir_all(paths.inbox_attachments_dir())
        .map_err(|e| format!("Failed to create inbox attachments dir: {}", e))?;

    let mut created = Vec::new();
    for import_path in paths_to_import {
        let source = PathBuf::from(&import_path);
        if !source.exists() || source.is_dir() {
            continue;
        }
        let original_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file")
            .to_string();
        let stem = slugify(
            source
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("file"),
        );
        let suffix = &Uuid::new_v4().simple().to_string()[..8];
        let attachment_name = format!("{}-{}-{}", stem, suffix, original_name);
        let attachment_path = paths.inbox_attachments_dir().join(&attachment_name);
        fs::copy(&source, &attachment_path)
            .map_err(|e| format!("Failed to import {}: {}", source.display(), e))?;

        let bytes = fs::read(&attachment_path).map_err(|e| {
            format!(
                "Failed to read imported file {}: {}",
                attachment_path.display(),
                e
            )
        })?;
        let text_preview = if is_text_like(&source) {
            String::from_utf8_lossy(&bytes).to_string()
        } else {
            String::new()
        };
        let id = format!("{}-{}", stem, suffix);
        let sidecar_path = paths.inbox_dir().join(format!("{}.md", id));
        let needs_extraction = !is_text_like(&source);
        let l1 = if text_preview.trim().is_empty() {
            format!("Imported file: {}", original_name)
        } else {
            preview_text(&text_preview)
        };
        let item = InboxItem {
            id: id.clone(),
            kind: InboxItemKind::File,
            status: if needs_extraction {
                InboxItemStatus::New
            } else {
                InboxItemStatus::Normalized
            },
            capture_state: "imported".to_string(),
            proposal_state: ProposalState::Pending,
            content_hash: hash_bytes(&bytes),
            created: Utc::now(),
            modified: Utc::now(),
            path: sidecar_path.to_string_lossy().to_string(),
            title: fallback_title_from_path(&source),
            summary: preview_text(&l1),
            l1_content: l1,
            l2_content: if text_preview.trim().is_empty() {
                String::new()
            } else {
                text_preview
            },
            source_url: None,
            original_file: Some(source.to_string_lossy().to_string()),
            mime: infer_mime_from_path(&source),
            tags: Vec::new(),
            derived_from: Vec::new(),
            needs_extraction,
            needs_inference: needs_extraction,
            attachments: vec![InboxAttachment {
                path: attachment_path.to_string_lossy().to_string(),
                original_name,
                mime: infer_mime_from_path(&source),
                size: bytes.len() as u64,
                hash: hash_bytes(&bytes),
            }],
        };
        write_inbox_item(&item)?;
        state.mark_recent_write(Path::new(&item.path));
        created.push(item.clone());
        append_daily_log(
            &root,
            "inbox_created",
            format!("Imported file '{}' into inbox", item.title),
            vec![],
            item.id.clone(),
        )?;
    }

    update_manifest_from_disk(&root)?;
    let _ = app.emit("inbox-changed", ());
    Ok(created)
}

#[tauri::command]
pub fn update_inbox_item(
    input: UpdateInboxItemInput,
    app: AppHandle,
    state: State<AppState>,
) -> Result<InboxItem, String> {
    let root = state.get_root();
    let mut item = load_inbox_items(&root)?
        .into_iter()
        .find(|item| item.id == input.id)
        .ok_or_else(|| format!("Inbox item not found: {}", input.id))?;

    if let Some(title) = input.title {
        item.title = title.trim().to_string();
    }
    if let Some(l1) = input.l1_content {
        item.l1_content = l1;
    }
    if let Some(l2) = input.l2_content {
        item.l2_content = l2;
    }
    if let Some(tags) = input.tags {
        item.tags = tags;
    }
    if let Some(status) = input.status {
        item.status = status;
    }
    item.summary = preview_text(if item.l1_content.trim().is_empty() {
        &item.l2_content
    } else {
        &item.l1_content
    });
    item.modified = Utc::now();
    item.content_hash = hash_str(&(item.title.clone() + &item.l1_content + &item.l2_content));
    write_inbox_item(&item)?;
    update_manifest_from_disk(&root)?;
    state.mark_recent_write(Path::new(&item.path));
    let _ = app.emit("inbox-changed", &item.id);
    Ok(item)
}

#[tauri::command]
pub fn normalize_inbox_item(
    id: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<InboxItem, String> {
    let root = state.get_root();
    let mut item = load_inbox_items(&root)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("Inbox item not found: {}", id))?;
    item.status = InboxItemStatus::Normalized;
    item.capture_state = "normalized".to_string();
    item.modified = Utc::now();
    if item.summary.trim().is_empty() {
        item.summary = preview_text(if item.l1_content.trim().is_empty() {
            &item.l2_content
        } else {
            &item.l1_content
        });
    }
    write_inbox_item(&item)?;
    update_manifest_from_disk(&root)?;
    let _ = app.emit("inbox-changed", &item.id);
    Ok(item)
}

#[tauri::command]
pub fn normalize_inbox_batch(
    ids: Vec<String>,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Vec<InboxItem>, String> {
    let mut out = Vec::new();
    let root = state.get_root();
    for id in ids {
        let mut item = load_inbox_items(&root)?
            .into_iter()
            .find(|item| item.id == id)
            .ok_or_else(|| format!("Inbox item not found: {}", id))?;
        item.status = InboxItemStatus::Normalized;
        item.capture_state = "normalized".to_string();
        item.modified = Utc::now();
        if item.summary.trim().is_empty() {
            item.summary = preview_text(if item.l1_content.trim().is_empty() {
                &item.l2_content
            } else {
                &item.l1_content
            });
        }
        write_inbox_item(&item)?;
        out.push(item);
    }
    update_manifest_from_disk(&root)?;
    let _ = app.emit("inbox-changed", ());
    Ok(out)
}

#[tauri::command]
pub fn list_ingest_proposals(state: State<AppState>) -> Result<Vec<IngestProposal>, String> {
    load_proposals(&state.get_root())
}

#[tauri::command]
pub async fn generate_ingest_proposals(
    item_ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<IngestProposal>, String> {
    let root = state.get_root();
    let items = load_inbox_items(&root)?;
    let all_items = if item_ids.is_empty() {
        items.clone()
    } else {
        items
            .iter()
            .filter(|item| item_ids.contains(&item.id))
            .cloned()
            .collect()
    };

    let mut existing = load_proposals(&root)?;
    let mut out = Vec::new();
    let total = all_items.len();
    for (idx, item) in all_items.into_iter().enumerate() {
        if existing
            .iter()
            .any(|proposal| proposal.item_id == item.id && proposal.state == ProposalState::Pending)
        {
            continue;
        }
        let _ = app.emit(
            "inference-progress",
            json!({
                "phase": "inferring",
                "item_title": item.title,
                "current": idx + 1,
                "total": total,
            }),
        );
        let mut proposal = items
            .iter()
            .find(|other| {
                other.id != item.id
                    && (other.content_hash == item.content_hash
                        || (item.source_url.is_some() && other.source_url == item.source_url))
            })
            .map(|duplicate_of| duplicate_proposal(&item, duplicate_of))
            .unwrap_or_else(|| heuristic_proposal(&item));
        match infer_proposal(&root, &item).await {
            Ok(inferred) => {
                if !matches!(proposal.action, ProposalAction::Discard) {
                    proposal = inferred;
                }
            }
            Err(e) => {
                eprintln!(
                    "[inference] Fallback to heuristic for '{}': {}",
                    item.title, e
                );
                let _ = app.emit("inference-error", format!("{}: {}", item.title, e));
            }
        }
        write_proposal(&root, &proposal)?;
        existing.push(proposal.clone());
        let _ = update_item_status(
            &root,
            &item.id,
            InboxItemStatus::ProposalReady,
            ProposalState::Pending,
        );
        out.push(proposal);
    }
    let _ = app.emit(
        "inference-progress",
        json!({ "phase": "done", "current": total, "total": total }),
    );
    let _ = app.emit("proposals-changed", ());
    Ok(out)
}

#[tauri::command]
pub fn reject_ingest_proposal(
    proposal_id: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<IngestProposal, String> {
    let root = state.get_root();
    let mut proposal = load_proposals(&root)?
        .into_iter()
        .find(|proposal| proposal.id == proposal_id)
        .ok_or_else(|| format!("Proposal not found: {}", proposal_id))?;
    proposal.state = ProposalState::Rejected;
    proposal.modified = Utc::now();
    write_proposal(&root, &proposal)?;
    let _ = update_item_status(
        &root,
        &proposal.item_id,
        InboxItemStatus::Processed,
        ProposalState::Rejected,
    );
    append_daily_log(
        &root,
        "inbox_proposal_rejected",
        format!("Rejected proposal {} for {}", proposal.id, proposal.item_id),
        vec![],
        proposal.item_id.clone(),
    )?;
    let _ = app.emit("proposals-changed", &proposal.id);
    Ok(proposal)
}

fn default_memory_destination(root: &Path) -> Result<PathBuf, String> {
    let paths = SystemPaths::new(root);
    for entry in fs::read_dir(root).map_err(|e| format!("Failed to read workspace root: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read workspace entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path == paths.inbox_dir() || path == paths.sources_dir() || path == paths.ai_dir() {
            continue;
        }
        return Ok(path);
    }
    Ok(root.to_path_buf())
}

fn ensure_valid_destination(root: &Path, destination: Option<String>) -> Result<PathBuf, String> {
    let candidate = if let Some(destination) = destination {
        PathBuf::from(destination)
    } else {
        default_memory_destination(root)?
    };
    if !candidate.exists() {
        fs::create_dir_all(&candidate).map_err(|e| {
            format!(
                "Failed to create destination {}: {}",
                candidate.display(),
                e
            )
        })?;
    }
    let normalized_root = fs::canonicalize(root)
        .map_err(|e| format!("Failed to resolve workspace root {}: {}", root.display(), e))?;
    let normalized_destination = fs::canonicalize(&candidate).map_err(|e| {
        format!(
            "Failed to resolve destination {}: {}",
            candidate.display(),
            e
        )
    })?;
    let paths = SystemPaths::new(&normalized_root);
    if normalized_destination == paths.inbox_dir()
        || normalized_destination == paths.sources_dir()
        || normalized_destination == paths.ai_dir()
    {
        return Err(
            "Destination must be a user directory outside inbox/, sources/ and .ai/".to_string(),
        );
    }
    if !normalized_destination.starts_with(&normalized_root) {
        return Err("Destination must stay inside the workspace".to_string());
    }
    Ok(normalized_destination)
}

fn build_memory_from_proposal(
    item: &InboxItem,
    proposal: &IngestProposal,
    destination: &Path,
    memory_id_override: Option<String>,
) -> Result<Memory, String> {
    let memory_id = memory_id_override
        .unwrap_or_else(|| slugify(proposal.l0.as_deref().unwrap_or(&item.title)));
    let l0 = proposal.l0.clone().unwrap_or_else(|| item.title.clone());
    let ontology = proposal.ontology.clone().unwrap_or(MemoryOntology::Concept);
    let path = destination.join(format!("{}.md", memory_id));
    Ok(Memory {
        meta: MemoryMeta {
            id: memory_id,
            ontology,
            l0,
            importance: 0.5,
            decay_rate: 0.998,
            last_access: Utc::now(),
            access_count: 0,
            confidence: proposal.confidence,
            tags: if proposal.tags.is_empty() {
                item.tags.clone()
            } else {
                proposal.tags.clone()
            },
            related: Vec::new(),
            created: Utc::now(),
            modified: Utc::now(),
            version: 1,
            triggers: Vec::new(),
            requires: Vec::new(),
            optional: Vec::new(),
            output_format: None,
            status: None,
            protected: false,
            derived_from: vec![item.id.clone()],
            folder_category: None,
            system_role: None,
        },
        l1_content: proposal
            .l1_content
            .clone()
            .unwrap_or_else(|| item.summary.clone()),
        l2_content: proposal
            .l2_content
            .clone()
            .unwrap_or_else(|| item.l2_content.clone()),
        raw_content: String::new(),
        file_path: path.to_string_lossy().to_string(),
    })
}

fn build_source_memory(item: &InboxItem, proposal: &IngestProposal, root: &Path) -> Memory {
    let source_id = slugify(proposal.l0.as_deref().unwrap_or(&item.title));
    let target_path = SystemPaths::new(root)
        .sources_dir()
        .join(format!("{}.md", source_id));
    let mut l2 = proposal
        .l2_content
        .clone()
        .unwrap_or_else(|| item.l2_content.clone());
    if let Some(url) = &item.source_url {
        if !l2.is_empty() {
            l2.push_str("\n\n");
        }
        l2.push_str(&format!("Original URL: {}", url));
    }
    if let Some(original_file) = &item.original_file {
        if !l2.is_empty() {
            l2.push_str("\n\n");
        }
        l2.push_str(&format!("Imported file: {}", original_file));
    }
    Memory {
        meta: MemoryMeta {
            id: source_id,
            ontology: MemoryOntology::Source,
            l0: proposal.l0.clone().unwrap_or_else(|| item.title.clone()),
            importance: 0.45,
            decay_rate: 0.998,
            last_access: Utc::now(),
            access_count: 0,
            confidence: proposal.confidence,
            tags: if proposal.tags.is_empty() {
                item.tags.clone()
            } else {
                proposal.tags.clone()
            },
            related: Vec::new(),
            created: Utc::now(),
            modified: Utc::now(),
            version: 1,
            triggers: Vec::new(),
            requires: Vec::new(),
            optional: Vec::new(),
            output_format: None,
            status: None,
            protected: true,
            derived_from: vec![item.id.clone()],
            folder_category: None,
            system_role: None,
        },
        l1_content: proposal
            .l1_content
            .clone()
            .unwrap_or_else(|| item.summary.clone()),
        l2_content: l2,
        raw_content: String::new(),
        file_path: target_path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn apply_ingest_proposal(
    input: ApplyIngestProposalInput,
    app: AppHandle,
    state: State<AppState>,
) -> Result<IngestProposal, String> {
    let root = state.get_root();
    let mut proposal = load_proposals(&root)?
        .into_iter()
        .find(|proposal| proposal.id == input.proposal_id)
        .ok_or_else(|| format!("Proposal not found: {}", input.proposal_id))?;
    let item = load_inbox_items(&root)?
        .into_iter()
        .find(|item| item.id == proposal.item_id)
        .ok_or_else(|| format!("Inbox item not found: {}", proposal.item_id))?;

    match proposal.action {
        ProposalAction::PromoteMemory => {
            let destination = ensure_valid_destination(&root, input.destination_dir.clone())?;
            let memory = build_memory_from_proposal(
                &item,
                &proposal,
                &destination,
                input.memory_id_override,
            )?;
            write_memory(Path::new(&memory.file_path), &memory)?;
        }
        ProposalAction::RouteToSources => {
            let memory = build_source_memory(&item, &proposal, &root);
            write_memory(Path::new(&memory.file_path), &memory)?;
            for attachment in &item.attachments {
                let source_path = PathBuf::from(&attachment.path);
                if source_path.exists() {
                    let dest_name =
                        format!("{}--{}", slugify(&item.title), attachment.original_name);
                    let dest_path = SystemPaths::new(&root).sources_dir().join(dest_name);
                    if !dest_path.exists() {
                        fs::copy(&source_path, &dest_path).map_err(|e| {
                            format!(
                                "Failed to copy source attachment {}: {}",
                                source_path.display(),
                                e
                            )
                        })?;
                    }
                }
            }
        }
        ProposalAction::Discard => {
            let _ = update_item_status(
                &root,
                &item.id,
                InboxItemStatus::Discarded,
                ProposalState::Applied,
            )?;
        }
        ProposalAction::NeedsReview | ProposalAction::UpdateMemory => {
            let _ = update_item_status(
                &root,
                &item.id,
                InboxItemStatus::Processed,
                ProposalState::Applied,
            )?;
        }
    }

    proposal.state = ProposalState::Applied;
    proposal.modified = Utc::now();
    write_proposal(&root, &proposal)?;

    if matches!(
        proposal.action,
        ProposalAction::PromoteMemory | ProposalAction::RouteToSources
    ) {
        let _ = update_item_status(
            &root,
            &item.id,
            InboxItemStatus::Promoted,
            ProposalState::Applied,
        )?;
        state.refresh_memory_index();
        let _ = crate::commands::router::regenerate_router_internal(&app, &state);
    }

    append_daily_log(
        &root,
        "inbox_proposal_applied",
        format!("Applied proposal {} for {}", proposal.id, item.title),
        proposal.tags.clone(),
        item.id.clone(),
    )?;
    let _ = app.emit("proposals-changed", &proposal.id);
    let _ = app.emit("inbox-changed", &item.id);
    Ok(proposal)
}

#[tauri::command]
pub fn get_recent_operational_context(
    state: State<AppState>,
) -> Result<RecentOperationalContext, String> {
    let root = state.get_root();
    let daily_path = SystemPaths::new(&root).daily_log();
    let mut daily_entries: Vec<DailyEntry> = read_jsonl(&daily_path)?;
    daily_entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let proposals = load_proposals(&root)?;
    let pending_proposals = proposals
        .iter()
        .filter(|proposal| proposal.state == ProposalState::Pending)
        .take(10)
        .cloned()
        .collect::<Vec<_>>();
    let recently_promoted = proposals
        .iter()
        .filter(|proposal| proposal.state == ProposalState::Applied)
        .take(10)
        .cloned()
        .collect::<Vec<_>>();

    Ok(RecentOperationalContext {
        recent_daily_entries: daily_entries.into_iter().take(20).collect(),
        pending_proposals,
        recently_promoted,
    })
}

#[tauri::command]
pub fn get_inference_provider_config(
    state: State<AppState>,
) -> Result<Option<InferenceProviderConfig>, String> {
    load_provider_config(&state.get_root())
}

#[tauri::command]
pub fn save_inference_provider_config(
    config: InferenceProviderConfig,
    state: State<AppState>,
) -> Result<InferenceProviderConfig, String> {
    persist_provider_config(&state.get_root(), &config)
}

#[tauri::command]
pub fn get_inference_provider_status(
    state: State<AppState>,
) -> Result<InferenceProviderStatus, String> {
    let root = state.get_root();
    let config = load_provider_config(&root)?;
    Ok(config_to_status(config.as_ref()))
}

#[tauri::command]
pub async fn test_inference_provider(
    config: Option<InferenceProviderConfig>,
    state: State<'_, AppState>,
) -> Result<InferenceProviderStatus, String> {
    let root = state.get_root();
    let config = match config {
        Some(config) => normalize_provider_config(config),
        None => load_provider_config(&root)?.ok_or_else(|| "No provider configured".to_string())?,
    };
    let message = health_check(&config).await?;
    Ok(InferenceProviderStatus {
        configured: true,
        enabled: config.enabled,
        healthy: true,
        kind: Some(config.kind.clone()),
        preset: Some(config.preset.clone()),
        base_url: config.base_url.clone(),
        model: Some(config.model.clone()),
        capabilities: config.capabilities.clone(),
        message,
    })
}

#[tauri::command]
pub async fn chat_completion(
    mut request: ChatCompletionRequest,
    state: State<'_, AppState>,
) -> Result<ChatCompletionResponse, String> {
    let root = state.get_root();
    let config =
        load_provider_config(&root)?.ok_or_else(|| "No provider configured".to_string())?;
    let mut context_memory_ids = if request.include_vault_context {
        request.context_memory_ids.clone()
    } else {
        Vec::new()
    };
    let mut context_debug = build_context_debug_from_request(&request);

    if !request.include_vault_context {
        request.context_prompt = None;
        request.context_memory_ids.clear();
        context_memory_ids.clear();
    }

    // Fallback: when vault context is enabled but the frontend did not
    // pre-assemble it, do it here so the provider still receives grounding.
    let latest_user_query = latest_user_query(&request.messages);
    let incoming_ctx_len = request
        .context_prompt
        .as_deref()
        .map(|s| s.trim().len())
        .unwrap_or(0);
    if request.include_vault_context && incoming_ctx_len == 0 {
        if let Some(query) = latest_user_query {
            let trimmed = query.trim();
            if !trimmed.is_empty() {
                let scoring_config = state.config.read().unwrap().clone();
                let budget = scoring_config.default_token_budget.max(1000);
                match crate::core::engine::execute_context_query(
                    &root,
                    trimmed,
                    budget,
                    &scoring_config,
                ) {
                    Ok(result) => {
                        let assembled = crate::core::engine::assemble_chat_context_package(&result);
                        log::info!(
                            "chat_completion auto-assembled vault context — query={:?} budget={} loaded={} total={} assembled_len={}",
                            trimmed,
                            budget,
                            result.loaded.len(),
                            result.total_memories,
                            assembled.len(),
                        );
                        context_memory_ids = result
                            .loaded
                            .iter()
                            .map(|memory| memory.memory_id.clone())
                            .collect();
                        context_debug = Some(build_context_debug_from_result(
                            assembled.len(),
                            budget,
                            &result,
                        ));
                        if !assembled.trim().is_empty() {
                            request.context_prompt = Some(assembled);
                        } else {
                            context_memory_ids.clear();
                            context_debug = None;
                        }
                    }
                    Err(err) => {
                        log::warn!(
                            "chat_completion auto-assembly of vault context FAILED: {}",
                            err
                        );
                    }
                }
            }
        }
    }

    let ctx_len = request
        .context_prompt
        .as_deref()
        .map(|s| s.len())
        .unwrap_or(0);
    log::info!(
        "chat_completion provider={:?} preset={:?} model={:?} messages={} system_prompt={} include_vault_context={} context_prompt_len={} context_prompt_empty={}",
        config.kind,
        config.preset,
        request.model.as_deref().unwrap_or(&config.model),
        request.messages.len(),
        request.system_prompt.is_some(),
        request.include_vault_context,
        ctx_len,
        ctx_len == 0,
    );
    if request.include_vault_context && ctx_len == 0 {
        log::warn!(
            "chat_completion received NO context_prompt even after auto-assembly fallback — the LLM will answer without vault context."
        );
    }
    let mut response = provider_chat_completion(&config, &request).await?;
    response.context_memory_ids = context_memory_ids;
    response.context_debug = context_debug;
    Ok(response)
}

#[tauri::command]
pub async fn discover_local_providers() -> Result<Vec<DiscoveredProvider>, String> {
    Ok(discover_providers().await)
}

#[tauri::command]
pub async fn list_provider_models(
    config: Option<InferenceProviderConfig>,
    state: State<'_, AppState>,
) -> Result<Vec<ProviderModel>, String> {
    let config = match config {
        Some(c) => normalize_provider_config(c),
        None => {
            let root = state.get_root();
            load_provider_config(&root)?.ok_or_else(|| "No provider configured".to_string())?
        }
    };
    fetch_models_for_config(&config).await
}

#[tauri::command]
pub async fn pull_ollama_model(model_name: String) -> Result<String, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let response = client
        .post("http://127.0.0.1:11434/api/pull")
        .json(&json!({ "model": model_name, "stream": false }))
        .send()
        .await
        .map_err(|e| format!("Failed to pull model: {}", e))?;
    if !response.status().is_success() {
        let body: Value = response.json().await.unwrap_or(json!({}));
        let msg = body
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Ollama pull failed: {}", msg));
    }
    Ok(format!("Model '{}' pulled successfully", model_name))
}

#[tauri::command]
pub async fn delete_ollama_model(model_name: String) -> Result<(), String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let response = client
        .delete("http://127.0.0.1:11434/api/delete")
        .json(&json!({ "model": model_name }))
        .send()
        .await
        .map_err(|e| format!("Failed to delete model: {}", e))?;
    if !response.status().is_success() {
        let body: Value = response.json().await.unwrap_or(json!({}));
        let msg = body
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Ollama delete failed: {}", msg));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use axum::{
        extract::{Path as AxumPath, State as AxumState},
        routing::{get, post},
        Json, Router,
    };

    #[derive(Clone)]
    struct TestLmStudioState {
        load_calls: Arc<AtomicUsize>,
        model_state: &'static str,
    }

    async fn lm_studio_model_state(
        AxumPath(model): AxumPath<String>,
        AxumState(state): AxumState<TestLmStudioState>,
    ) -> Json<Value> {
        Json(json!({
            "id": model,
            "object": "model",
            "state": state.model_state,
        }))
    }

    async fn lm_studio_load_model(AxumState(state): AxumState<TestLmStudioState>) -> Json<Value> {
        state.load_calls.fetch_add(1, Ordering::SeqCst);
        Json(json!({ "status": "loaded" }))
    }

    async fn spawn_test_lm_studio(model_state: &'static str) -> (String, Arc<AtomicUsize>) {
        let load_calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/api/v0/models/{*model}", get(lm_studio_model_state))
            .route("/api/v1/models/load", post(lm_studio_load_model))
            .with_state(TestLmStudioState {
                load_calls: load_calls.clone(),
                model_state,
            });

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let addr = listener.local_addr().expect("test server addr");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve test lm studio");
        });

        (format!("http://{}", addr), load_calls)
    }

    fn lm_studio_test_config(base_url: String) -> InferenceProviderConfig {
        InferenceProviderConfig {
            enabled: true,
            kind: InferenceProviderKind::OpenAiCompatible,
            preset: InferenceProviderPreset::LmStudio,
            model: "openai/gpt-oss-20b".to_string(),
            base_url: Some(format!("{}/v1", base_url.trim_end_matches('/'))),
            api_key: None,
            capabilities: vec![InferenceCapability::Chat],
        }
    }

    #[tokio::test]
    async fn ensure_model_loaded_skips_reload_for_loaded_lm_studio_models() {
        let (base_url, load_calls) = spawn_test_lm_studio("loaded").await;

        ensure_model_loaded(&lm_studio_test_config(base_url))
            .await
            .expect("already loaded model should not error");

        assert_eq!(load_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn ensure_model_loaded_loads_unloaded_lm_studio_models() {
        let (base_url, load_calls) = spawn_test_lm_studio("not-loaded").await;

        ensure_model_loaded(&lm_studio_test_config(base_url))
            .await
            .expect("unloaded model should be loaded");

        assert_eq!(load_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn build_openai_messages_includes_context_as_conversation_message() {
        let messages = build_openai_messages(&ChatCompletionRequest {
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "como me llamo?".to_string(),
            }],
            system_prompt: Some("system rules".to_string()),
            include_vault_context: true,
            context_prompt: Some("## [quien-soy-yo] Yo soy alex dc".to_string()),
            context_memory_ids: vec!["quien-soy-yo".to_string()],
            model: None,
        });

        assert_eq!(messages.len(), 3);
        assert_eq!(
            messages[0].get("role").and_then(|v| v.as_str()),
            Some("system")
        );
        assert_eq!(
            messages[1].get("role").and_then(|v| v.as_str()),
            Some("user")
        );
        assert!(messages[1]
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .contains("Yo soy alex dc"));
        assert_eq!(
            messages[2].get("content").and_then(|v| v.as_str()),
            Some("como me llamo?")
        );
    }

    #[test]
    fn build_anthropic_messages_includes_context_as_first_user_turn() {
        let messages = build_anthropic_messages(&ChatCompletionRequest {
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "como me llamo?".to_string(),
            }],
            system_prompt: Some("system rules".to_string()),
            include_vault_context: true,
            context_prompt: Some("## [quien-soy-yo] Yo soy alex dc".to_string()),
            context_memory_ids: vec!["quien-soy-yo".to_string()],
            model: None,
        });

        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[0].get("role").and_then(|v| v.as_str()),
            Some("user")
        );
        let ctx_text = messages[0]
            .pointer("/content/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert!(ctx_text.contains("Yo soy alex dc"));

        assert_eq!(
            messages[1].get("role").and_then(|v| v.as_str()),
            Some("user")
        );
        let user_text = messages[1]
            .pointer("/content/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert_eq!(user_text, "como me llamo?");
    }

    #[test]
    fn build_anthropic_messages_without_context_only_emits_history() {
        let messages = build_anthropic_messages(&ChatCompletionRequest {
            messages: vec![
                ChatMessage {
                    role: "user".to_string(),
                    content: "hola".to_string(),
                },
                ChatMessage {
                    role: "assistant".to_string(),
                    content: "hey".to_string(),
                },
            ],
            system_prompt: None,
            include_vault_context: true,
            context_prompt: None,
            context_memory_ids: Vec::new(),
            model: None,
        });

        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[0].get("role").and_then(|v| v.as_str()),
            Some("user")
        );
        assert_eq!(
            messages[1].get("role").and_then(|v| v.as_str()),
            Some("assistant")
        );
    }
}
