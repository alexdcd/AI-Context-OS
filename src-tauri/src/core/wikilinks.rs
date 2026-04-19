// Canonical parser and resolver for [[wikilinks]] in memory bodies.
//
// Identity is always `meta.id`. On disk a wikilink is always `[[id]]`.
// `[[Mi Título]]` is user-friendly input; the backend resolves it to an id
// and rewrites before persistence. Resolution order: exact id → exact l0 →
// case-insensitive l0. Never auto-resolves when more than one candidate
// matches.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::core::types::{Memory, MemoryMeta};

// Match `[[inner]]` where the inner text contains neither `[` nor `]` nor
// a newline. Iterates once per link.
static WIKILINK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[\[([^\[\]\n]+?)\]\]").unwrap());

/// One `[[...]]` occurrence with absolute byte offsets into the source string.
#[derive(Debug, Clone, PartialEq)]
pub struct WikilinkMatch {
    /// Byte offset of the opening `[[`.
    pub start: usize,
    /// Byte offset just past the closing `]]`.
    pub end: usize,
    /// Trimmed text between the brackets.
    pub inner: String,
}

/// Parse all wikilinks in `content` in document order.
pub fn parse_wikilinks(content: &str) -> Vec<WikilinkMatch> {
    WIKILINK_RE
        .captures_iter(content)
        .filter_map(|cap| {
            let full = cap.get(0)?;
            let inner = cap.get(1)?.as_str().trim();
            if inner.is_empty() {
                return None;
            }
            Some(WikilinkMatch {
                start: full.start(),
                end: full.end(),
                inner: inner.to_string(),
            })
        })
        .collect()
}

/// Candidate surfaced when a wikilink resolves to more than one memory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WikilinkCandidate {
    pub id: String,
    pub l0: String,
    /// "exact_l0" | "fuzzy_l0"
    pub match_type: String,
}

/// Outcome of resolving a wikilink text against a memory set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WikilinkResolution {
    /// Matched an existing `meta.id`. Already canonical.
    ExactId { id: String },
    /// Unique match on `meta.l0` (exact casing). Safe to rewrite to `[[id]]`.
    ExactL0 { id: String },
    /// Unique case-insensitive match on `meta.l0`. Safe to rewrite.
    FuzzyL0 { id: String },
    /// Multiple candidates — never auto-resolved.
    Ambiguous { candidates: Vec<WikilinkCandidate> },
    /// No memory matched.
    Unresolved,
}

/// Resolve a single wikilink text.
pub fn resolve_wikilink(text: &str, memories: &[MemoryMeta]) -> WikilinkResolution {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return WikilinkResolution::Unresolved;
    }

    if memories.iter().any(|m| m.id == trimmed) {
        return WikilinkResolution::ExactId {
            id: trimmed.to_string(),
        };
    }

    let exact_l0: Vec<&MemoryMeta> = memories.iter().filter(|m| m.l0 == trimmed).collect();
    match exact_l0.len() {
        1 => {
            return WikilinkResolution::ExactL0 {
                id: exact_l0[0].id.clone(),
            };
        }
        n if n > 1 => {
            return WikilinkResolution::Ambiguous {
                candidates: exact_l0
                    .iter()
                    .map(|m| WikilinkCandidate {
                        id: m.id.clone(),
                        l0: m.l0.clone(),
                        match_type: "exact_l0".to_string(),
                    })
                    .collect(),
            };
        }
        _ => {}
    }

    let lower = trimmed.to_lowercase();
    let fuzzy: Vec<&MemoryMeta> = memories
        .iter()
        .filter(|m| m.l0.to_lowercase() == lower)
        .collect();
    match fuzzy.len() {
        1 => WikilinkResolution::FuzzyL0 {
            id: fuzzy[0].id.clone(),
        },
        n if n > 1 => WikilinkResolution::Ambiguous {
            candidates: fuzzy
                .iter()
                .map(|m| WikilinkCandidate {
                    id: m.id.clone(),
                    l0: m.l0.clone(),
                    match_type: "fuzzy_l0".to_string(),
                })
                .collect(),
        },
        _ => WikilinkResolution::Unresolved,
    }
}

/// Warning produced during body normalization. Surfaced to the UI so the user
/// can act on unresolved / ambiguous links without the save being blocked.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikilinkWarning {
    /// The original text between the brackets (trimmed).
    pub text: String,
    /// Byte offset in the *original* body where the link started.
    pub start: usize,
    pub end: usize,
    #[serde(flatten)]
    pub kind: WikilinkWarningKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WikilinkWarningKind {
    Unresolved,
    Ambiguous { candidates: Vec<WikilinkCandidate> },
}

/// Save-time wikilink warning tagged with which body section it came from.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikilinkSaveWarning {
    /// "l1" or "l2" — identifies which body section the warning applies to.
    pub level: String,
    #[serde(flatten)]
    pub warning: WikilinkWarning,
}

/// Return value of `save_memory`. Warnings are non-fatal — the save still
/// proceeds, but the UI can surface unresolved / ambiguous links to the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveMemoryResult {
    pub memory: Memory,
    #[serde(default)]
    pub wikilink_warnings: Vec<WikilinkSaveWarning>,
    #[serde(default)]
    pub cascade: Option<CascadeRewriteOutcome>,
}

/// Summary of a `[[old_id]]` → `[[new_id]]` cascade across canonical memories.
/// Emitted to the frontend under the `wikilinks-cascade` event so the UI can
/// refresh derived state (graph, file tree, router) and display which memories
/// changed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CascadeRewriteOutcome {
    pub old_id: String,
    pub new_id: String,
    /// Total number of `[[...]]` occurrences rewritten across all files.
    pub rewrite_count: u32,
    /// Ids of canonical memories whose body was rewritten.
    pub affected_ids: Vec<String>,
    /// Ids of protected canonical memories that contain `[[old_id]]` and were
    /// left untouched. The UI should surface these so the user can unprotect
    /// and retry.
    pub skipped_protected_ids: Vec<String>,
}

impl CascadeRewriteOutcome {
    pub fn is_empty(&self) -> bool {
        self.rewrite_count == 0
            && self.affected_ids.is_empty()
            && self.skipped_protected_ids.is_empty()
    }
}

/// Outcome of normalizing a body: canonical form, warnings, and rewrite count.
#[derive(Debug, Clone)]
pub struct NormalizationOutcome {
    pub body: String,
    pub warnings: Vec<WikilinkWarning>,
    pub rewrites: u32,
}

/// Rewrite every `[[text]]` in `body` to `[[id]]` when the resolution is
/// unique. Leaves ambiguous and unresolved links untouched and collects them
/// as warnings. After this the body is canonical for every link that resolved
/// uniquely.
pub fn normalize_wikilinks(body: &str, memories: &[MemoryMeta]) -> NormalizationOutcome {
    let matches = parse_wikilinks(body);
    if matches.is_empty() {
        return NormalizationOutcome {
            body: body.to_string(),
            warnings: Vec::new(),
            rewrites: 0,
        };
    }

    let mut out = String::with_capacity(body.len());
    let mut last_end = 0;
    let mut warnings = Vec::new();
    let mut rewrites = 0;

    for m in &matches {
        out.push_str(&body[last_end..m.start]);

        let resolution = resolve_wikilink(&m.inner, memories);
        let replacement = match resolution {
            WikilinkResolution::ExactId { id } => {
                let canonical = format!("[[{}]]", id);
                if &body[m.start..m.end] != canonical {
                    rewrites += 1;
                }
                canonical
            }
            WikilinkResolution::ExactL0 { id } | WikilinkResolution::FuzzyL0 { id } => {
                rewrites += 1;
                format!("[[{}]]", id)
            }
            WikilinkResolution::Ambiguous { candidates } => {
                warnings.push(WikilinkWarning {
                    text: m.inner.clone(),
                    start: m.start,
                    end: m.end,
                    kind: WikilinkWarningKind::Ambiguous { candidates },
                });
                body[m.start..m.end].to_string()
            }
            WikilinkResolution::Unresolved => {
                warnings.push(WikilinkWarning {
                    text: m.inner.clone(),
                    start: m.start,
                    end: m.end,
                    kind: WikilinkWarningKind::Unresolved,
                });
                body[m.start..m.end].to_string()
            }
        };

        out.push_str(&replacement);
        last_end = m.end;
    }

    out.push_str(&body[last_end..]);

    NormalizationOutcome {
        body: out,
        warnings,
        rewrites,
    }
}

/// Rewrite every `[[old_id]]` in `body` to `[[new_id]]`. Whitespace inside the
/// brackets is tolerated (e.g. `[[ old_id ]]`). Links with a different inner
/// text are untouched.
pub fn rewrite_wikilink_target(body: &str, old_id: &str, new_id: &str) -> (String, u32) {
    let matches = parse_wikilinks(body);
    if matches.is_empty() {
        return (body.to_string(), 0);
    }

    let mut out = String::with_capacity(body.len());
    let mut last_end = 0;
    let mut count = 0;

    for m in &matches {
        out.push_str(&body[last_end..m.start]);
        if m.inner == old_id {
            out.push_str(&format!("[[{}]]", new_id));
            count += 1;
        } else {
            out.push_str(&body[m.start..m.end]);
        }
        last_end = m.end;
    }
    out.push_str(&body[last_end..]);

    (out, count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::{MemoryMeta, MemoryOntology};
    use chrono::Utc;

    fn meta(id: &str, l0: &str) -> MemoryMeta {
        MemoryMeta {
            id: id.to_string(),
            ontology: MemoryOntology::Concept,
            l0: l0.to_string(),
            importance: 0.5,
            decay_rate: 0.998,
            last_access: Utc::now(),
            access_count: 0,
            confidence: 0.9,
            tags: vec![],
            related: vec![],
            created: Utc::now(),
            modified: Utc::now(),
            version: 1,
            triggers: vec![],
            requires: vec![],
            optional: vec![],
            output_format: None,
            status: None,
            protected: false,
            derived_from: vec![],
            folder_category: None,
            system_role: None,
        }
    }

    // ─── parse_wikilinks ───

    #[test]
    fn parses_empty_body() {
        assert!(parse_wikilinks("").is_empty());
    }

    #[test]
    fn parses_single_link_with_offsets() {
        let ms = parse_wikilinks("hello [[foo]] world");
        assert_eq!(ms.len(), 1);
        assert_eq!(ms[0].inner, "foo");
        assert_eq!(&"hello [[foo]] world"[ms[0].start..ms[0].end], "[[foo]]");
    }

    #[test]
    fn parses_multiple_links_preserves_order() {
        let ms = parse_wikilinks("[[a]] then [[b]] and [[c]]");
        assert_eq!(
            ms.iter().map(|m| m.inner.clone()).collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
    }

    #[test]
    fn trims_whitespace_inside_brackets() {
        let ms = parse_wikilinks("[[  foo  ]]");
        assert_eq!(ms.len(), 1);
        assert_eq!(ms[0].inner, "foo");
    }

    #[test]
    fn skips_empty_brackets() {
        assert!(parse_wikilinks("[[]]").is_empty());
        assert!(parse_wikilinks("[[   ]]").is_empty());
    }

    #[test]
    fn does_not_match_single_brackets() {
        assert!(parse_wikilinks("[foo]").is_empty());
        assert!(parse_wikilinks("[foo](url)").is_empty());
    }

    #[test]
    fn does_not_span_newlines() {
        assert!(parse_wikilinks("[[foo\nbar]]").is_empty());
    }

    // ─── resolve_wikilink ───

    #[test]
    fn resolves_exact_id() {
        let ms = vec![meta("mem-a", "Memory A")];
        assert_eq!(
            resolve_wikilink("mem-a", &ms),
            WikilinkResolution::ExactId { id: "mem-a".into() }
        );
    }

    #[test]
    fn resolves_exact_l0_to_id() {
        let ms = vec![meta("mem-a", "Memory A")];
        assert_eq!(
            resolve_wikilink("Memory A", &ms),
            WikilinkResolution::ExactL0 { id: "mem-a".into() }
        );
    }

    #[test]
    fn resolves_fuzzy_l0_when_unique() {
        let ms = vec![meta("mem-a", "Memory A")];
        assert_eq!(
            resolve_wikilink("memory a", &ms),
            WikilinkResolution::FuzzyL0 { id: "mem-a".into() }
        );
    }

    #[test]
    fn id_match_is_preferred_over_l0() {
        // id "memory-a" collides with another memory's l0 "memory-a".
        let ms = vec![meta("memory-a", "Title A"), meta("other", "memory-a")];
        assert_eq!(
            resolve_wikilink("memory-a", &ms),
            WikilinkResolution::ExactId { id: "memory-a".into() }
        );
    }

    #[test]
    fn ambiguous_exact_l0_returns_candidates() {
        let ms = vec![meta("mem-a", "Same"), meta("mem-b", "Same")];
        match resolve_wikilink("Same", &ms) {
            WikilinkResolution::Ambiguous { candidates } => {
                assert_eq!(candidates.len(), 2);
                assert!(candidates.iter().all(|c| c.match_type == "exact_l0"));
            }
            other => panic!("expected ambiguous, got {:?}", other),
        }
    }

    #[test]
    fn ambiguous_fuzzy_l0_returns_candidates() {
        let ms = vec![meta("mem-a", "Same"), meta("mem-b", "SAME")];
        match resolve_wikilink("sAmE", &ms) {
            WikilinkResolution::Ambiguous { candidates } => {
                assert_eq!(candidates.len(), 2);
            }
            other => panic!("expected ambiguous, got {:?}", other),
        }
    }

    #[test]
    fn unresolved_when_no_match() {
        let ms = vec![meta("mem-a", "Memory A")];
        assert_eq!(resolve_wikilink("nothing", &ms), WikilinkResolution::Unresolved);
    }

    #[test]
    fn whitespace_only_text_is_unresolved() {
        let ms = vec![meta("mem-a", "Memory A")];
        assert_eq!(resolve_wikilink("   ", &ms), WikilinkResolution::Unresolved);
    }

    // ─── normalize_wikilinks ───

    #[test]
    fn normalize_noop_when_no_links() {
        let ms = vec![meta("mem-a", "A")];
        let out = normalize_wikilinks("no links here", &ms);
        assert_eq!(out.body, "no links here");
        assert_eq!(out.rewrites, 0);
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn normalize_leaves_canonical_id_links_alone() {
        let ms = vec![meta("mem-a", "Memory A")];
        let out = normalize_wikilinks("see [[mem-a]] now", &ms);
        assert_eq!(out.body, "see [[mem-a]] now");
        assert_eq!(out.rewrites, 0);
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn normalize_tightens_whitespace_around_id() {
        let ms = vec![meta("mem-a", "Memory A")];
        let out = normalize_wikilinks("see [[ mem-a ]] now", &ms);
        assert_eq!(out.body, "see [[mem-a]] now");
        assert_eq!(out.rewrites, 1);
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn normalize_rewrites_exact_l0_to_id() {
        let ms = vec![meta("mem-a", "Memory A")];
        let out = normalize_wikilinks("see [[Memory A]] now", &ms);
        assert_eq!(out.body, "see [[mem-a]] now");
        assert_eq!(out.rewrites, 1);
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn normalize_rewrites_fuzzy_l0_to_id() {
        let ms = vec![meta("mem-a", "Memory A")];
        let out = normalize_wikilinks("see [[memory a]] now", &ms);
        assert_eq!(out.body, "see [[mem-a]] now");
        assert_eq!(out.rewrites, 1);
    }

    #[test]
    fn normalize_preserves_unresolved_and_warns() {
        let ms = vec![meta("mem-a", "Memory A")];
        let out = normalize_wikilinks("see [[ghost]] now", &ms);
        assert_eq!(out.body, "see [[ghost]] now");
        assert_eq!(out.rewrites, 0);
        assert_eq!(out.warnings.len(), 1);
        assert_eq!(out.warnings[0].text, "ghost");
        assert!(matches!(out.warnings[0].kind, WikilinkWarningKind::Unresolved));
    }

    #[test]
    fn normalize_preserves_ambiguous_and_warns() {
        let ms = vec![meta("mem-a", "Same"), meta("mem-b", "Same")];
        let out = normalize_wikilinks("see [[Same]] now", &ms);
        assert_eq!(out.body, "see [[Same]] now");
        assert_eq!(out.rewrites, 0);
        assert_eq!(out.warnings.len(), 1);
        assert!(matches!(
            out.warnings[0].kind,
            WikilinkWarningKind::Ambiguous { .. }
        ));
    }

    #[test]
    fn normalize_mixes_rewrites_and_warnings_in_one_body() {
        let ms = vec![meta("mem-a", "Memory A"), meta("mem-b", "Memory B")];
        let body = "first [[Memory A]] then [[ghost]] last [[mem-b]]";
        let out = normalize_wikilinks(body, &ms);
        assert_eq!(out.body, "first [[mem-a]] then [[ghost]] last [[mem-b]]");
        assert_eq!(out.rewrites, 1);
        assert_eq!(out.warnings.len(), 1);
        assert_eq!(out.warnings[0].text, "ghost");
    }

    #[test]
    fn normalize_handles_multibyte_characters() {
        let ms = vec![meta("cafe-mem", "Café Memory")];
        let body = "¡Sí! [[Café Memory]] está aquí";
        let out = normalize_wikilinks(body, &ms);
        assert_eq!(out.body, "¡Sí! [[cafe-mem]] está aquí");
        assert_eq!(out.rewrites, 1);
    }

    // ─── rewrite_wikilink_target ───

    #[test]
    fn rewrite_noop_when_target_absent() {
        let (body, n) = rewrite_wikilink_target("hello [[foo]]", "bar", "new-bar");
        assert_eq!(body, "hello [[foo]]");
        assert_eq!(n, 0);
    }

    #[test]
    fn rewrite_replaces_single_occurrence() {
        let (body, n) = rewrite_wikilink_target("see [[old]]", "old", "new");
        assert_eq!(body, "see [[new]]");
        assert_eq!(n, 1);
    }

    #[test]
    fn rewrite_replaces_all_occurrences() {
        let (body, n) = rewrite_wikilink_target("[[old]] and [[old]] too", "old", "new");
        assert_eq!(body, "[[new]] and [[new]] too");
        assert_eq!(n, 2);
    }

    #[test]
    fn rewrite_does_not_touch_different_targets() {
        let (body, n) = rewrite_wikilink_target("[[old]] and [[unrelated]]", "old", "new");
        assert_eq!(body, "[[new]] and [[unrelated]]");
        assert_eq!(n, 1);
    }

    #[test]
    fn rewrite_handles_whitespace_in_source_form() {
        let (body, n) = rewrite_wikilink_target("[[ old ]]", "old", "new");
        assert_eq!(body, "[[new]]");
        assert_eq!(n, 1);
    }
}
