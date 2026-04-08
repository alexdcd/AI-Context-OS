use crate::core::types::MemoryMeta;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FrontmatterError {
    #[error("No frontmatter found (missing --- delimiters)")]
    NotFound,
    #[error("YAML parse error: {0}")]
    YamlError(#[from] serde_yaml::Error),
}

/// Parse YAML frontmatter from a Markdown file.
/// Returns (MemoryMeta, body_content).
pub fn parse_frontmatter(raw: &str) -> Result<(MemoryMeta, String), FrontmatterError> {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return Err(FrontmatterError::NotFound);
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let end_pos = after_first
        .find("\n---")
        .ok_or(FrontmatterError::NotFound)?;

    let yaml_str = &after_first[..end_pos];
    let body_start = 3 + end_pos + 4; // skip past closing ---\n
    let body = if body_start < trimmed.len() {
        trimmed[body_start..].trim_start_matches('\n').to_string()
    } else {
        String::new()
    };

    let meta: MemoryMeta = serde_yaml::from_str(yaml_str)?;
    Ok((meta, body))
}

/// Serialize MemoryMeta + body back into a full file string.
pub fn serialize_frontmatter(meta: &MemoryMeta, body: &str) -> Result<String, serde_yaml::Error> {
    let yaml = serde_yaml::to_string(meta)?;
    Ok(format!("---\n{}---\n\n{}", yaml, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_roundtrip() {
        let raw = r#"---
id: test-memory
type: entity
l0: "Test memory for unit testing"
importance: 0.8
tags: [test, unit]
---

<!-- L1 -->
This is the L1 summary.

<!-- L2 -->
## Full Details
This is the complete content.
"#;
        let (meta, body) = parse_frontmatter(raw).unwrap();
        assert_eq!(meta.id, "test-memory");
        assert_eq!(meta.ontology, crate::core::types::MemoryOntology::Entity);
        assert_eq!(meta.l0, "Test memory for unit testing");
        assert!((meta.importance - 0.8).abs() < 0.001);
        assert!(body.contains("<!-- L1 -->"));
        assert!(body.contains("<!-- L2 -->"));
    }

    #[test]
    fn test_serialize_skips_derived_runtime_fields() {
        let meta = MemoryMeta {
            id: "test-memory".to_string(),
            ontology: crate::core::types::MemoryOntology::Concept,
            l0: "Serialized memory".to_string(),
            importance: 0.5,
            always_load: false,
            decay_rate: 0.998,
            last_access: chrono::Utc::now(),
            access_count: 0,
            confidence: 0.9,
            tags: vec!["tag".to_string()],
            related: vec![],
            created: chrono::Utc::now(),
            modified: chrono::Utc::now(),
            version: 1,
            triggers: vec![],
            requires: vec![],
            optional: vec![],
            output_format: None,
            status: None,
            protected: false,
            derived_from: vec![],
            folder_category: Some("ideas".to_string()),
            system_role: Some(crate::core::types::SystemRole::Skill),
        };

        let serialized = serialize_frontmatter(&meta, "<!-- L1 -->\nBody").unwrap();
        assert!(serialized.contains("type: concept"));
        assert!(!serialized.contains("folder_category"));
        assert!(!serialized.contains("system_role"));
    }
}
