use std::fs;

use chrono::Utc;
use tauri::{AppHandle, State};

use crate::core::frontmatter::serialize_frontmatter;
use crate::core::types::{MemoryMeta, MemoryOntology};
use crate::state::AppState;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct OnboardingProfile {
    pub name: String,
    pub role: String,
    pub tools: Vec<String>,
    pub language: String,
    pub template: String, // "developer", "creator", "entrepreneur", "custom"
    pub root_dir: Option<String>,
    #[serde(default)]
    pub use_existing_root: bool,
}

/// Run full onboarding: create workspace, profile, template skills/rules, and router.
#[tauri::command]
pub fn run_onboarding(
    profile: OnboardingProfile,
    app: AppHandle,
    state: State<AppState>,
) -> Result<bool, String> {
    // Step 1: Set root directory if custom
    if let Some(ref custom_root) = profile.root_dir {
        let expanded = shellexpand(custom_root);
        let path = std::path::PathBuf::from(&expanded);
        state.set_root(path)?;
    }

    let root = state.get_root();

    // Step 2: Create workspace structure (reuse init_workspace logic)
    let config = crate::commands::config::create_workspace_structure(&root, &profile.tools)?;
    *state.config.write().unwrap() = config;

    // Step 3: Create starter folders only for brand new workspaces.
    if !profile.use_existing_root {
        create_starter_folders(&root, &profile.template)?;
    }

    // Step 4: Generate perfil-profesional.md
    create_profile_memory(&root, &profile)?;

    // Step 5: Generate template-specific skills and rules
    match profile.template.as_str() {
        "developer" => create_developer_template(&root)?,
        "creator" => create_creator_template(&root)?,
        "entrepreneur" => create_entrepreneur_template(&root)?,
        _ => {} // "custom" = empty
    }

    // Step 6: Regenerate router
    let config = state.config.read().unwrap().clone();
    let all = crate::core::index::scan_memories(&root);
    let metas: Vec<_> = all.iter().map(|(m, _)| m.clone()).collect();
    let neutral = crate::core::router::generate_router_content(&metas, &config);
    let claude_md = crate::core::compat::render_claude_adapter(&neutral);
    fs::write(root.join("claude.md"), &claude_md)
        .map_err(|e| format!("Failed to write claude.md: {}", e))?;

    let paths = crate::core::paths::SystemPaths::new(&root);
    let index_yaml = crate::core::router::generate_index_yaml(&metas);
    fs::write(paths.index_yaml(), &index_yaml)
        .map_err(|e| format!("Failed to write index.yaml: {}", e))?;

    let cursorrules = crate::core::compat::render_cursor_adapter(&neutral);
    fs::write(root.join(".cursorrules"), &cursorrules).ok();
    let windsurfrules = crate::core::compat::render_windsurf_adapter(&neutral);
    fs::write(root.join(".windsurfrules"), &windsurfrules).ok();

    // Persist selected root and refresh runtime bindings for this workspace.
    state.set_root(root.clone())?;
    crate::commands::config::sync_workspace_runtime(state.inner(), Some(&app))?;

    // Register vault with chosen template so the vault switcher shows the correct template name.
    crate::commands::vault::register_vault_with_template(&root, &profile.template)?;

    Ok(true)
}

/// Check if onboarding has been completed.
#[tauri::command]
pub fn is_onboarded(state: State<AppState>) -> Result<bool, String> {
    let root = state.get_root();
    let paths = crate::core::paths::SystemPaths::new(&root);
    Ok(root.join("claude.md").exists() && paths.ai_dir().exists())
}

fn shellexpand(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}/{}", home.display(), &path[2..]);
        }
    }
    path.to_string()
}

fn tool_summary(tools: &[String]) -> String {
    if tools.is_empty() {
        "adaptadores auto-generados".to_string()
    } else {
        tools.join(", ")
    }
}

fn create_starter_folders(root: &std::path::Path, template: &str) -> Result<(), String> {
    let mut folders = vec!["identity", "strategy", "operations", "decisions"];
    if template == "creator" {
        folders.push("content");
    }
    for folder in &folders {
        fs::create_dir_all(root.join(folder))
            .map_err(|e| format!("Failed to create {}: {}", folder, e))?;
    }
    Ok(())
}

fn create_profile_memory(
    root: &std::path::Path,
    profile: &OnboardingProfile,
) -> Result<(), String> {
    let now = Utc::now();
    let tools_label = tool_summary(&profile.tools);
    let meta = MemoryMeta {
        id: "perfil-profesional".to_string(),
        ontology: MemoryOntology::Entity,
        l0: format!(
            "{} — {} | Herramientas: {}",
            profile.name, profile.role, tools_label
        ),
        importance: 0.95,
        always_load: true,
        decay_rate: 0.999,
        last_access: now,
        access_count: 0,
        confidence: 1.0,
        tags: vec!["perfil".into(), "identidad".into(), "contexto".into()],
        related: vec![],
        created: now,
        modified: now,
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
    };

    let l1 = format!(
        "Nombre: {}. Rol: {}. Herramientas IA: {}. Idioma principal: {}.",
        profile.name, profile.role, tools_label, profile.language
    );

    let l2 = format!(
        "## Perfil Profesional\n\n\
         - **Nombre:** {}\n\
         - **Rol/Profesión:** {}\n\
         - **Herramientas de IA:** {}\n\
         - **Idioma principal:** {}\n\
         - **Template elegido:** {}\n\n\
         ## Notas\n\n\
         _Añade aquí información adicional sobre tu perfil, experiencia, objetivos, etc._\n",
        profile.name, profile.role, tools_label, profile.language, profile.template
    );

    let body = format!("<!-- L1 -->\n{}\n\n<!-- L2 -->\n{}", l1, l2);
    let content = serialize_frontmatter(&meta, &body)
        .map_err(|e| format!("Failed to serialize profile: {}", e))?;

    let paths = crate::core::paths::SystemPaths::new(root);
    let path = paths.inbox_dir().join("perfil-profesional.md");
    fs::write(&path, content).map_err(|e| format!("Failed to write profile: {}", e))?;

    Ok(())
}

fn write_memory_file(
    root: &std::path::Path,
    folder: &str,
    filename: &str,
    id: &str,
    ontology: MemoryOntology,
    l0: &str,
    importance: f64,
    tags: &[&str],
    l1: &str,
    l2: &str,
    triggers: &[&str],
    requires: &[&str],
) -> Result<(), String> {
    let now = Utc::now();
    let meta = MemoryMeta {
        id: id.to_string(),
        ontology,
        l0: l0.to_string(),
        importance,
        always_load: false,
        decay_rate: 0.998,
        last_access: now,
        access_count: 0,
        confidence: 0.9,
        tags: tags.iter().map(|s| s.to_string()).collect(),
        related: vec![],
        created: now,
        modified: now,
        version: 1,
        triggers: triggers.iter().map(|s| s.to_string()).collect(),
        requires: requires.iter().map(|s| s.to_string()).collect(),
        optional: vec![],
        output_format: None,
        status: None,
        protected: false,
        derived_from: vec![],
        folder_category: None,
        system_role: None,
    };

    let body = format!("<!-- L1 -->\n{}\n\n<!-- L2 -->\n{}", l1, l2);
    let body = body.replace("\\n", "\n");
    let content =
        serialize_frontmatter(&meta, &body).map_err(|e| format!("Failed to serialize: {}", e))?;

    let dir = root.join(folder);
    fs::create_dir_all(&dir).ok();
    fs::write(dir.join(filename), content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))?;

    Ok(())
}

fn create_developer_template(root: &std::path::Path) -> Result<(), String> {
    // ── identity/ ─────────────────────────────────────────────────────────
    write_memory_file(
        root, "identity", "bio.md", "dev-bio",
        MemoryOntology::Entity,
        "Developer profile: background, expertise, and tech identity",
        0.95,
        &["bio", "identity", "background", "developer"],
        "Your engineering background, areas of expertise, and how you approach building software.",
        "## Developer Bio\n\n> **What to put here:** Your years of experience, main languages and frameworks, what types of problems you love solving, your current role or projects, and your engineering philosophy.\n\n### One-liner\n_e.g. \"Full-stack engineer with 8 years building [type] products, specializing in [area].\"_\n\n### Background\n_Relevant experience, companies, open-source work, or projects that define you._\n\n### Engineering philosophy\n_e.g. \"I prefer boring technology, optimize for readability, and always ask why before how.\"_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me write my developer profile. Ask me one question at a time about: my main languages and frameworks, what I've built that I'm most proud of, the types of problems I gravitate toward, my engineering values, and my current focus. Generate a complete bio.md.\"",
        &["bio", "my background", "who I am", "developer profile"],
        &[],
    )?;

    write_memory_file(
        root, "identity", "tech-stack.md", "dev-tech-stack",
        MemoryOntology::Entity,
        "Primary tech stack: languages, frameworks, tools, and infrastructure",
        0.95,
        &["stack", "technology", "languages", "frameworks"],
        "Your go-to technology choices — always loaded so AI understands your technical context.",
        "## Tech Stack\n\n> **What to put here:** The technologies you use day-to-day. Be specific: version numbers matter, and 'why' is as important as 'what'.\n\n### Languages\n- Primary: _e.g. TypeScript, Rust_\n- Secondary: _e.g. Python for scripts_\n\n### Frontend\n- Framework: _e.g. React 19, Next.js 15_\n- Styling: _e.g. Tailwind CSS_\n- State: _e.g. Zustand, React Query_\n\n### Backend\n- Runtime: _e.g. Node.js, Bun_\n- Framework: _e.g. Hono, Express_\n- Database: _e.g. PostgreSQL + Drizzle ORM_\n\n### Infrastructure\n- Hosting: _e.g. Vercel, Fly.io_\n- CI/CD: _e.g. GitHub Actions_\n- Observability: _e.g. Sentry, Axiom_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me document my tech stack. Ask me about each layer one by one: frontend, backend, database, infrastructure, and any dev tools I can't live without. For each choice, ask why I use it. Generate a complete tech-stack.md with my full stack and the reasoning behind key choices.\"",
        &["tech stack", "what I use", "my stack", "technologies"],
        &[],
    )?;

    write_memory_file(
        root, "identity", "values.md", "dev-values",
        MemoryOntology::Concept,
        "Engineering principles and non-negotiable development values",
        0.85,
        &["values", "principles", "engineering", "philosophy"],
        "The engineering principles you always apply: what good code means to you, what you refuse to ship, how you make technical decisions.",
        "## Engineering Values\n\n> **What to put here:** Your non-negotiable principles when writing code, the things you always push back on, and the quality bar you hold yourself and your team to.\n\n### Principles I always apply\n- _e.g. Make it work, then make it right, then make it fast_\n- _e.g. Delete code > refactor code > write new code_\n- _e.g. Every function does one thing_\n\n### What I refuse to ship\n- _e.g. Code without tests for critical paths_\n- _e.g. Unexplained magic or clever hacks without comments_\n\n### How I make technical decisions\n_e.g. I pick boring technology for infrastructure and interesting technology at the edges._\n\n---\n## AI Prompt to fill this file\n\n> \"Help me articulate my engineering values. Ask me: a bad codebase experience that taught me something, 3 principles I always try to apply, what I won't compromise on even under deadline pressure, and how I explain technical tradeoffs to non-technical stakeholders. Generate a values.md.\"",
        &["values", "principles", "engineering philosophy", "code quality"],
        &[],
    )?;

    // ── strategy/ ─────────────────────────────────────────────────────────
    write_memory_file(
        root, "strategy", "roadmap.md", "dev-roadmap",
        MemoryOntology::Entity,
        "Technical roadmap: what you're building, learning, and shipping",
        0.80,
        &["roadmap", "goals", "projects", "learning"],
        "Your technical direction: projects in progress, skills to acquire, and milestones for the next 12 months.",
        "## Technical Roadmap\n\n> **What to put here:** Current projects and their status, skills or technologies you want to learn, technical debt you want to pay down, and your goals for the year.\n\n### Active projects\n| Project | Status | Goal |\n|---------|--------|------|\n| _Project name_ | 🔄 In progress | _e.g. Ship v1 by Q3_ |\n\n### Learning queue\n- [ ] _Technology/concept + why_\n\n### Technical debt to address\n- [ ] _Item + impact if ignored_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me build my technical roadmap. Ask me: my main project right now and its biggest open question, 2 things I want to learn this year and why, technical debt I've been meaning to address, and where I want my skills to be in 12 months. Generate a roadmap.md with a milestone table.\"",
        &["roadmap", "projects", "what I'm building", "learning plan"],
        &[],
    )?;

    write_memory_file(
        root, "strategy", "architecture-decisions.md", "dev-architecture-decisions",
        MemoryOntology::Entity,
        "ADR log: architecture decisions with context and tradeoffs",
        0.80,
        &["architecture", "decisions", "ADR", "tradeoffs"],
        "A running log of significant architecture decisions — what you chose, what you rejected, and why. Essential context for future you.",
        "## Architecture Decisions\n\n> **What to put here:** Significant technical decisions using ADR format (Architecture Decision Record). Especially useful for decisions that future-you will question.\n\n### ADR format\n```\n### ADR-001: [Decision title]\n**Date:** YYYY-MM-DD\n**Status:** Accepted / Superseded / Deprecated\n**Context:** Why was this decision needed?\n**Decision:** What was chosen\n**Rejected alternatives:** What else was considered and why rejected\n**Consequences:** What this makes easier/harder going forward\n```\n\n---\n_Log your architecture decisions below:_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me document my architecture decisions. Ask me about 2-3 significant technical choices I've made (or am making now): what the situation was, what I chose, what I almost chose instead, and what tradeoffs I accepted. Format each as an ADR and generate a complete architecture-decisions.md.\"",
        &["architecture", "ADR", "technical decisions", "why we chose"],
        &[],
    )?;

    // ── operations/ ───────────────────────────────────────────────────────
    write_memory_file(
        root, "operations", "code-conventions.md", "dev-code-conventions",
        MemoryOntology::Concept,
        "Code style, naming conventions, and project-specific patterns",
        0.90,
        &["conventions", "style", "naming", "code quality"],
        "The rules AI must follow when writing code for you: naming, structure, patterns you prefer, and anti-patterns to avoid.",
        "## Code Conventions\n\n> **What to put here:** The specific rules for your codebase. The more specific, the more consistently AI will write code that matches your style.\n\n### Naming\n- Variables/functions: _e.g. camelCase_\n- Classes/components: _e.g. PascalCase_\n- Files: _e.g. kebab-case_\n- Constants: _e.g. UPPER_SNAKE_CASE_\n\n### Commits\n- Format: _e.g. conventional commits (feat:, fix:, refactor:)_\n\n### Structure\n- _e.g. Co-locate tests with source files (.test.ts suffix)_\n- _e.g. One export per file for components_\n\n### Anti-patterns to avoid\n- _e.g. No `any` in TypeScript_\n- _e.g. No silent error catches_\n- _e.g. No magic numbers without named constants_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me document my code conventions. Ask me about: naming conventions per case type, commit message format, how I structure tests, folder organization rules, and 3 anti-patterns I hate seeing in code. Generate a complete code-conventions.md I can paste into any AI's context.\"",
        &["conventions", "code style", "how to write code", "naming rules"],
        &[],
    )?;

    write_memory_file(
        root, "operations", "sops.md", "dev-sops",
        MemoryOntology::Concept,
        "Development workflows: PR process, release checklist, debugging runbook",
        0.75,
        &["sops", "workflows", "process", "checklist"],
        "Step-by-step checklists for your recurring dev workflows: feature branches, PR reviews, releases, and incident response.",
        "## Development SOPs\n\n> **What to put here:** Checklists for the workflows you repeat. Eliminates decision fatigue and makes it easy to delegate or onboard.\n\n### Feature development checklist\n- [ ] Branch from main (`feat/description`)\n- [ ] Write failing test first (if applicable)\n- [ ] Implement\n- [ ] Self-review diff before opening PR\n- [ ] PR description: what + why + how to test\n\n### Release checklist\n- [ ] All tests green\n- [ ] Changelog updated\n- [ ] Version bumped\n- [ ] Deployed to staging + smoke test\n- [ ] Production deploy + verify\n\n### Debugging runbook\n1. Reproduce locally\n2. Check recent changes (`git log --oneline -20`)\n3. Isolate: binary search the call stack\n4. Form hypothesis → test → verify fix\n\n---\n## AI Prompt to fill this file\n\n> \"Help me document my development SOPs. Ask me: my typical feature branch workflow, what my PR checklist looks like, how I handle releases, and my go-to debugging approach when stuck. Generate a sops.md with formatted checklists.\"",
        &["sops", "workflow", "checklist", "process", "how to ship"],
        &[],
    )?;

    // ── decisions/ ────────────────────────────────────────────────────────
    write_memory_file(
        root, "decisions", "decision-log.md", "dev-decision-log",
        MemoryOntology::Entity,
        "Log of important technical and project decisions with reasoning",
        0.80,
        &["decisions", "log", "history", "ADR"],
        "Episodic memory for decisions that don't fit formal ADRs: team choices, tooling changes, scope calls, priority pivots.",
        "## Decision Log\n\n> **What to put here:** Decisions that aren't big enough for a full ADR but important enough to remember — tool choices, process changes, scope cuts, priority calls.\n\n### Format\n```\n### [YYYY-MM-DD] [Decision]\n**Context:** Situation that forced the decision\n**Chosen:** What you did\n**Reasoning:** Why\n**Outcome:** [fill in later]\n```\n\n---\n## AI Prompt to fill this file\n\n> \"Help me start my decision log. Ask me about 3 decisions I've made recently in my work (tool choices, architecture calls, scope decisions). For each, capture the date, context, what I chose, and why. Generate a decision-log.md and explain how to keep it updated.\"",
        &["decisions", "why I chose this", "decision history"],
        &[],
    )?;

    // ── .ai/skills/ ───────────────────────────────────────────────────────
    write_memory_file(
        root, ".ai/skills", "code-reviewer.md", "skill-code-reviewer",
        MemoryOntology::Concept,
        "Skill: Code review with quality, security, and convention checks",
        0.85,
        &["code", "review", "quality", "development"],
        "Reviews source code for bugs, vulnerabilities, code smells, and convention violations.",
        "## Instructions for AI\n\n### Process\n1. Load `dev-code-conventions` for project-specific rules\n2. Analyze the provided code\n3. Categorize findings: 🔴 Critical, 🟡 Improvement, 🟢 Suggestion\n4. Provide corrected code for every critical finding\n\n### Output format\n- Prioritized findings list\n- Each finding: location, description, severity, fix\n- Executive summary at the end",
        &["review code", "code review", "check PR", "analyze code"],
        &["dev-code-conventions"],
    )?;

    write_memory_file(
        root, ".ai/skills", "debugger.md", "skill-debugger",
        MemoryOntology::Concept,
        "Skill: Systematic debugger — reproduce, isolate, diagnose, fix",
        0.85,
        &["debug", "bugs", "errors", "development"],
        "Guides a systematic debugging process: reproduce → isolate → hypothesize → verify → fix.",
        "## Instructions for AI\n\n### Process\n1. Ask for error description and expected behavior\n2. Request logs, stack traces, or error messages\n3. Form hypotheses ordered by likelihood\n4. Suggest verification steps for each hypothesis\n5. Provide the fix once root cause is identified\n\n### Output format\n- Numbered hypotheses with estimated probability\n- Exact commands to verify each\n- Fix with explanation of why it works",
        &["debug", "error", "bug", "not working", "crash"],
        &["dev-tech-stack"],
    )?;

    write_memory_file(
        root, ".ai/skills", "architect.md", "skill-architect",
        MemoryOntology::Concept,
        "Skill: Software architect — system design with tradeoffs and Mermaid diagrams",
        0.80,
        &["architecture", "design", "system", "development"],
        "Designs software architecture considering scalability, maintainability, and project constraints.",
        "## Instructions for AI\n\n### Process\n1. Load `dev-tech-stack` and `dev-architecture-decisions`\n2. Identify functional and non-functional requirements\n3. Propose 2-3 architectural options with pros/cons\n4. Recommend one option with justification\n5. Generate Mermaid diagram if helpful\n\n### Output format\n- High-level diagram (Mermaid)\n- Main components with responsibilities\n- Data flow\n- Key decisions with justification",
        &["design architecture", "system design", "architecture", "how to structure"],
        &["dev-tech-stack", "dev-values"],
    )?;

    // ── .ai/rules/ ────────────────────────────────────────────────────────
    write_memory_file(
        root, ".ai/rules", "coding-rules.md", "dev-coding-rules",
        MemoryOntology::Concept,
        "Rules loaded on every coding task: style, security, and quality guardrails",
        0.95,
        &["rules", "coding", "guardrails", "quality"],
        "Non-negotiable coding rules applied to all AI-generated code.",
        "## Coding Rules\n\n_Applied to every code generation or modification. Customize to your preferences._\n\n- **Conventions:** Always follow `dev-code-conventions`\n- **Security:** Never introduce SQL injection, XSS, or command injection vectors\n- **Error handling:** Handle errors at boundaries; don't swallow exceptions silently\n- **Clarity over cleverness:** If it needs a comment to be understood, simplify it first\n- **Don't over-engineer:** Solve what was asked. No speculative abstractions.\n- **Tests:** Suggest tests for any non-trivial logic added\n- **Conciseness:** Don't add docstrings or comments to unchanged code",
        &[],
        &[],
    )?;

    Ok(())
}

fn create_creator_template(root: &std::path::Path) -> Result<(), String> {
    // ── identity/ ──────────────────────────────────────────────────────────
    write_memory_file(
        root, "identity", "bio.md", "creator-bio",
        MemoryOntology::Entity,
        "Creator bio: professional background, story, and positioning",
        0.95,
        &["bio", "identity", "background", "story"],
        "Your professional story, background, and how you present yourself to your audience.",
        "## Bio\n\n> **What to put here:** Your origin story, professional milestones, what you create and for whom, your unique angle in your niche, and how you describe yourself in one sentence.\n\n### One-liner\n_e.g. \"I help [audience] achieve [outcome] through [your method].\"_\n\n### Full bio (150 words)\n_Write your bio in third person for press/collabs, first person for community._\n\n### Origin story\n_What made you start creating? What problem did you face that others share?_\n\n---\n## AI Prompt to fill this file\n\n> Paste this into any AI to build this file collaboratively:\n>\n> \"I want to write my creator bio for my AI second brain. Ask me one question at a time to gather: my background, what I create, who I create for, my unique angle, a memorable origin story, and a strong one-liner. After 6-8 questions, generate the complete bio.md content in markdown.\"",
        &["bio", "about me", "my story", "introduce myself"],
        &[],
    )?;

    write_memory_file(
        root, "identity", "voice-and-style.md", "creator-voice-and-style",
        MemoryOntology::Concept,
        "Voice, tone, and writing style guide — always loaded in writing tasks",
        0.95,
        &["voice", "tone", "style", "writing", "brand"],
        "Your communication personality: tone, vocabulary choices, what to avoid, and examples of your ideal writing.",
        "## Voice & Style Guide\n\n> **What to put here:** Your tone adjectives (e.g. direct, warm, provocative), vocabulary you prefer or avoid, sentence length preference, how you open content, how you close it, and 2-3 examples of your best writing.\n\n### Tone\n- **In 3 words:** _e.g. direct, practical, human_\n- **Not:** _e.g. corporate, preachy, overly casual_\n\n### Vocabulary\n- ✅ Use: _clear verbs, short sentences, concrete examples_\n- ❌ Avoid: _jargon, filler phrases, passive voice_\n\n### Signature moves\n- _How do you open posts? (e.g. bold statement, question, story)_\n- _How do you close? (e.g. question to audience, CTA, reflection)_\n\n### Examples of your voice\n_Paste 2-3 paragraphs or posts you love that represent your ideal tone._\n\n---\n## AI Prompt to fill this file\n\n> \"I want to define my voice and style guide for my AI second brain. Ask me one question at a time about: my tone adjectives, what I want to avoid, my sentence style preference, how I like to open and close content, and my favorite pieces I've written. After 6 questions, generate the complete voice-and-style.md file.\"",
        &["voice", "tone", "how I write", "my style", "brand voice"],
        &[],
    )?;

    write_memory_file(
        root, "identity", "values.md", "creator-values",
        MemoryOntology::Concept,
        "Core values that guide content decisions and brand positioning",
        0.85,
        &["values", "principles", "beliefs", "brand"],
        "The non-negotiable principles behind your work: what you stand for, what you refuse to do, and the beliefs that shape your content.",
        "## Core Values\n\n> **What to put here:** 3-5 values that guide your decisions, what each one means in practice, and lines you won't cross (brand red lines).\n\n### My values\n1. **[Value 1]** — _What it means in practice for your content/business_\n2. **[Value 2]** — _e.g. Transparency: I share numbers, failures, and process openly_\n3. **[Value 3]** — _..._\n\n### Brand red lines (what I never do)\n- _e.g. Never promote products I haven't used myself_\n- _e.g. Never create fear-based content_\n\n### Content lens\n_Every piece of content I create should [your filter]._\n\n---\n## AI Prompt to fill this file\n\n> \"Help me define the core values for my creator brand. Ask me one question at a time about: what I believe strongly in my niche, decisions I've refused to make even when profitable, what I want my audience to feel when consuming my content, and lines I won't cross. After 5 questions, generate a complete values.md file.\"",
        &["values", "principles", "what I believe", "brand guidelines"],
        &[],
    )?;

    // ── content/ ──────────────────────────────────────────────────────────
    write_memory_file(
        root, "content", "successful-posts.md", "creator-successful-posts",
        MemoryOntology::Entity,
        "Library of best-performing content with engagement metrics",
        0.85,
        &["content", "posts", "examples", "performance", "reference"],
        "Your best-performing posts across platforms — use as reference for writing new content in your proven style.",
        "## Successful Posts\n\n> **What to put here:** Posts that got exceptional engagement (likes, shares, comments, DMs). Include the platform, approximate metrics, and why you think it worked.\n\n### Format for each entry\n```\n### [Post title or first line]\n**Platform:** LinkedIn / X / Instagram / Newsletter\n**Metrics:** ~X likes · Y comments · Z shares\n**Why it worked:** [your hypothesis]\n\n[Full post text]\n```\n\n---\n_Add your first 3-5 best posts below:_\n\n---\n## AI Prompt to fill this file\n\n> \"I want to build a library of my best-performing content. I'll share posts one by one. For each one, ask me: what platform it was on, what metrics it got, and what I think made it work. After I've shared all my posts, generate a formatted successful-posts.md with a pattern analysis at the top summarizing what my best content has in common.\"",
        &["best posts", "top content", "what worked", "reference content"],
        &["creator-voice-and-style"],
    )?;

    write_memory_file(
        root, "content", "tested-hooks.md", "creator-tested-hooks",
        MemoryOntology::Concept,
        "Hook formulas and opening lines proven to stop the scroll",
        0.85,
        &["hooks", "openings", "copywriting", "content"],
        "Opening lines and hook structures that have generated strong engagement — your personal copywriting arsenal.",
        "## Tested Hooks\n\n> **What to put here:** Opening lines, hook formulas, and patterns that stopped the scroll. Organized by type so AI can pick the right one per context.\n\n### Controversy / Bold statement\n- _\"[Unpopular opinion]: most [topic] advice is wrong because...\"_\n- _Add your proven examples here_\n\n### Curiosity gap\n- _\"I made X doing [unusual thing]. Here's what nobody talks about:\"_\n- _Add your proven examples here_\n\n### Story / Vulnerability\n- _\"6 months ago I [failure]. Today [result]. Thread:\"_\n- _Add your proven examples here_\n\n### Data / Proof\n- _\"[Stat that surprises]. Most people don't know why. Here's the breakdown:\"_\n- _Add your proven examples here_\n\n### Question\n- _\"What if [common assumption] is actually backwards?\"_\n- _Add your proven examples here_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me build my hook library. Share 3 hook types with me, ask which resonates most with my style, then ask me to share 2-3 opening lines I've written that performed well. Analyze the patterns and generate a complete tested-hooks.md organized by hook type, including a 'my signature hook formula' section at the top.\"",
        &["hooks", "opening lines", "how to start posts", "copywriting"],
        &["creator-voice-and-style"],
    )?;

    write_memory_file(
        root, "content", "content-calendar.md", "creator-content-calendar",
        MemoryOntology::Entity,
        "Content planning: weekly cadence, content pillars, and upcoming ideas",
        0.75,
        &["calendar", "planning", "schedule", "content pillars"],
        "Your content rhythm: how often you post, on which platforms, your core topic pillars, and your pipeline of upcoming ideas.",
        "## Content Calendar\n\n> **What to put here:** Your posting frequency per platform, your 3-5 content pillars (recurring themes), seasonal/campaign dates, and your idea backlog.\n\n### Posting cadence\n| Platform | Frequency | Best time |\n|----------|-----------|----------|\n| LinkedIn | _e.g. 3x/week_ | _e.g. Tue/Thu/Sat 8am_ |\n| Newsletter | _e.g. weekly_ | _e.g. Wednesday_ |\n| X / Twitter | _e.g. daily_ | _e.g. 9am_ |\n\n### Content pillars\n1. **[Pillar 1]** — _e.g. Lessons from X years in [niche]_\n2. **[Pillar 2]** — _e.g. Behind-the-scenes / process_\n3. **[Pillar 3]** — _e.g. Curated insights from [field]_\n\n### Upcoming ideas\n- [ ] _Idea 1_\n- [ ] _Idea 2_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me build my content calendar. Ask me one question at a time about: which platforms I'm active on, how often I want to post on each, the 3-5 topics I always return to, upcoming dates or campaigns that matter to my audience, and my current idea backlog. Generate a complete content-calendar.md with a posting cadence table and content pillars.\"",
        &["content calendar", "what to post", "content plan", "posting schedule"],
        &["creator-successful-posts"],
    )?;

    // ── strategy/ ──────────────────────────────────────────────────────────
    write_memory_file(
        root, "strategy", "roadmap.md", "creator-roadmap",
        MemoryOntology::Entity,
        "Creator business roadmap: milestones, revenue goals, and growth path",
        0.80,
        &["roadmap", "goals", "milestones", "strategy", "growth"],
        "Where you're heading: audience size targets, revenue milestones, products or services you want to launch, and the timeline.",
        "## Creator Roadmap\n\n> **What to put here:** Your 12-month vision, audience growth targets, products/services to launch, revenue goals, and the milestones that tell you you're on track.\n\n### 12-month vision\n_In one paragraph: where do you want to be in 12 months?_\n\n### Key milestones\n| Milestone | Target date | Status |\n|-----------|-------------|--------|\n| _e.g. 10k newsletter subscribers_ | _Q3 2025_ | 🔄 In progress |\n| _e.g. Launch paid community_ | _Q4 2025_ | ⬜ Not started |\n\n### Revenue streams (planned)\n1. _e.g. Sponsorships_\n2. _e.g. Digital product_\n3. _e.g. Consulting / done-with-you_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me build my creator roadmap. Ask me one question at a time about: my current audience size and platforms, where I want to be in 12 months, what products or services I want to create, my revenue goal, and the 3 milestones I'd be most proud of hitting. Generate a complete roadmap.md with a prioritized milestone table.\"",
        &["roadmap", "goals", "where am I going", "business plan"],
        &[],
    )?;

    write_memory_file(
        root, "strategy", "competition.md", "creator-competition",
        MemoryOntology::Entity,
        "Competitor and market analysis: who else plays in your space",
        0.70,
        &["competition", "market", "positioning", "research"],
        "Who else creates content in your niche, how you're positioned relative to them, and the white space you're filling.",
        "## Competition & Positioning\n\n> **What to put here:** 5-10 creators or brands in your space, what they do well, where they fall short, and how you're different. This helps AI position your content strategically.\n\n### Landscape overview\n_Describe your niche in 1-2 sentences: who competes for your audience's attention?_\n\n### Key players\n| Creator/Brand | Strengths | Gaps | My differentiation |\n|---------------|-----------|------|-------------------|\n| _Name_ | _e.g. deep research_ | _e.g. not actionable_ | _I make it practical_ |\n\n### My positioning\n**Unique angle:** _What do I offer that nobody else does exactly like me?_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me map my competitive landscape as a creator. Ask me: what niche I'm in, who the 5 biggest creators in my space are, what they do well, where they disappoint their audience, and what I believe I do differently or better. After 6 questions, generate a competition.md with a positioning analysis and my unique angle clearly defined.\"",
        &["competition", "competitors", "positioning", "niche"],
        &[],
    )?;

    write_memory_file(
        root, "strategy", "goals.md", "creator-goals",
        MemoryOntology::Entity,
        "Current quarter goals: specific, measurable targets with tracking",
        0.85,
        &["goals", "okrs", "quarterly", "targets", "kpis"],
        "Your current focus for this quarter: what you're optimizing for, what success looks like, and what you're NOT doing.",
        "## Current Goals\n\n> **What to put here:** 3-5 goals for this quarter with clear metrics. Use OKR format (Objective + Key Results) or simple goal + metric + deadline.\n\n### This quarter's focus\n**Theme:** _e.g. \"Audience quality over quantity\"_\n\n### Goals\n1. **[Goal 1]**\n   - Metric: _e.g. Grow newsletter to 5,000 subscribers_\n   - Deadline: _End of Q2_\n   - Status: 🔄\n\n2. **[Goal 2]**\n   - Metric: _..._\n\n### Not doing this quarter\n_What are you explicitly deprioritizing to stay focused?_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me define my quarterly goals as a creator. Ask me: what the current date is, my single biggest priority this quarter, the 3-5 metrics that matter most to me right now, and what I'm deliberately NOT doing. Generate a complete goals.md using OKR format, with a 'not doing' section to protect focus.\"",
        &["goals", "this quarter", "OKRs", "targets", "focus"],
        &["creator-roadmap"],
    )?;

    // ── operations/ ───────────────────────────────────────────────────────
    write_memory_file(
        root, "operations", "email-templates.md", "creator-email-templates",
        MemoryOntology::Entity,
        "Reusable email templates for collaborations, pitches, and replies",
        0.75,
        &["email", "templates", "outreach", "operations"],
        "Copy-paste email templates for the situations you face repeatedly: brand pitches, collab requests, audience replies, invoice follow-ups.",
        "## Email Templates\n\n> **What to put here:** Templates for your most common email scenarios. Each template should have a subject line, the email body, and notes on when to use it.\n\n### Brand collaboration pitch\n**Subject:** _Partnership opportunity — [Your name] × [Brand]_\n```\n[Template body here]\n```\n\n### Collab request to another creator\n**Subject:** _..._\n```\n[Template body here]\n```\n\n### Polite no / not a good fit\n```\n[Template body here]\n```\n\n### Rate card follow-up\n```\n[Template body here]\n```\n\n---\n## AI Prompt to fill this file\n\n> \"Help me build an email template library. Ask me: what kinds of emails I send most often, one situation where I always struggle to find the right words, my typical rates or terms for collaborations, and my preferred tone in professional emails. Generate email-templates.md with 5 templates tailored to my creator business, each with subject line and body.\"",
        &["email", "outreach", "pitch", "templates"],
        &["creator-voice-and-style"],
    )?;

    write_memory_file(
        root, "operations", "successful-proposals.md", "creator-successful-proposals",
        MemoryOntology::Entity,
        "Winning proposal structures and sponsorship decks that converted",
        0.75,
        &["proposals", "sponsorships", "sales", "operations"],
        "Templates and frameworks from proposals that actually got a yes — for sponsorships, consulting, or collaborations.",
        "## Successful Proposals\n\n> **What to put here:** The structure, key sections, and language from proposals that converted. Include what the client responded to most, your pricing framing, and any objections you overcame.\n\n### Sponsorship proposal structure\n1. _The hook: why my audience is their audience_\n2. _Social proof: numbers that matter to brands_\n3. _Deliverables + timeline_\n4. _Investment / rates_\n5. _Next step (clear CTA)_\n\n### What makes mine convert\n_e.g. Leading with audience data, showing past results, making it easy to say yes_\n\n### Winning phrases\n_Phrases or framings that resonated with clients:_\n- \"_..._\"\n\n---\n## AI Prompt to fill this file\n\n> \"Help me document my best proposal structures. Ask me: what types of proposals I write (sponsorships, consulting, collabs), a deal I'm proud of winning and what I think clinched it, how I present my rates, and the most common objection I face. Generate a successful-proposals.md with a reusable structure and key language patterns.\"",
        &["proposals", "sponsorship", "pitch deck", "how to sell"],
        &["creator-voice-and-style"],
    )?;

    write_memory_file(
        root, "operations", "sops.md", "creator-sops",
        MemoryOntology::Concept,
        "Standard operating procedures for repeatable creator workflows",
        0.75,
        &["sops", "workflows", "process", "operations"],
        "Step-by-step processes for your recurring tasks: content production, brand deal workflow, newsletter publishing, etc.",
        "## Standard Operating Procedures\n\n> **What to put here:** Step-by-step checklists for the tasks you repeat every week. The goal: any task on this list can be done without thinking — or delegated.\n\n### Content publishing checklist\n- [ ] _Draft written and reviewed_\n- [ ] _Hook tested on 2 people_\n- [ ] _Visual / thumbnail created_\n- [ ] _Posted at optimal time_\n- [ ] _First comment posted_\n- [ ] _Shared to secondary channels_\n\n### Brand deal workflow\n- [ ] _Receive brief → evaluate fit against values.md_\n- [ ] _Send rate card_\n- [ ] _Receive contract → review key clauses_\n- [ ] _Create content → send for approval_\n- [ ] _Publish + send report_\n- [ ] _Invoice sent_\n\n### Weekly review (15 min)\n- [ ] _Check metrics on all platforms_\n- [ ] _Log top-performing post to successful-posts.md_\n- [ ] _Update content calendar for next week_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me document my creator SOPs. Ask me one question at a time about: the 3 tasks I do most often that could use a checklist, my content publishing process from draft to live, how I handle brand deals end-to-end, and my weekly review habit. Generate a sops.md with formatted checklists for each workflow.\"",
        &["sops", "checklist", "workflow", "process", "how to"],
        &[],
    )?;

    // ── decisions/ ────────────────────────────────────────────────────────
    write_memory_file(
        root, "decisions", "decision-log.md", "creator-decision-log",
        MemoryOntology::Entity,
        "Episodic memory: log of important decisions with context and outcomes",
        0.80,
        &["decisions", "log", "history", "episodic"],
        "A running record of your important decisions — platform choices, pricing changes, pivots — with the reasoning and eventual outcome.",
        "## Decision Log\n\n> **What to put here:** Every significant decision you make about your creator business, with the date, context, options considered, why you chose what you chose, and (later) what happened.\n\n### Format for each entry\n```\n### [YYYY-MM-DD] [Decision title]\n**Context:** What situation prompted this decision\n**Options considered:** A, B, C\n**Chosen:** Option X\n**Reasoning:** Why this option\n**Expected outcome:** What you're hoping for\n**Actual outcome:** [fill in later]\n```\n\n---\n_Start logging decisions below:_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me start my decision log. Ask me about 2-3 significant decisions I've made in my creator business in the last 6 months — what happened, what I chose, and whether it worked out. Format each one as a decision log entry with date, context, reasoning, and outcome. Then generate a decision-log.md with those entries plus instructions on how to keep it updated going forward.\"",
        &["decisions", "why I chose", "decision history", "past choices"],
        &[],
    )?;

    // ── .ai/skills/ ───────────────────────────────────────────────────────
    write_memory_file(
        root, ".ai/skills", "post-writer.md", "skill-post-writer",
        MemoryOntology::Concept,
        "Skill: Write social posts in your voice for any platform",
        0.85,
        &["writing", "social media", "posts", "content"],
        "Generates platform-specific posts using your voice-and-style guide and tested hooks.",
        "## Instructions for AI\n\n### Process\n1. Load `creator-voice-and-style` and `creator-tested-hooks`\n2. Ask: target platform, topic or angle, any constraints\n3. Pick a hook type from tested-hooks.md\n4. Write post following platform best practices:\n   - LinkedIn: 150-250 words, short paragraphs, CTA at end\n   - X/Twitter: under 280 chars (or thread format)\n   - Instagram: caption + 5 hashtag suggestions\n5. Offer 2 hook variations for A/B testing\n\n### Output format\n- Hook\n- Body\n- CTA\n- Hashtags (if applicable)\n- Brief note on why the chosen hook fits the topic",
        &["write a post", "social post", "LinkedIn post", "tweet", "Instagram caption"],
        &["creator-voice-and-style", "creator-tested-hooks"],
    )?;

    write_memory_file(
        root, ".ai/skills", "content-repurposer.md", "skill-content-repurposer",
        MemoryOntology::Concept,
        "Skill: Transform one piece of content into assets for all platforms",
        0.80,
        &["repurpose", "content", "multi-platform"],
        "Takes a long-form piece and extracts platform-specific posts, newsletter snippet, and short-form hooks.",
        "## Instructions for AI\n\n### Process\n1. Receive source content (article, transcript, thread)\n2. Extract 5-7 key insights\n3. Generate for each platform:\n   - **LinkedIn:** hook + development + CTA (200 words)\n   - **X/Twitter:** thread of 6-8 tweets\n   - **Newsletter snippet:** 100-word excerpt + link prompt\n   - **Short hook:** one-liner for Stories/Reels caption\n4. Maintain voice from `creator-voice-and-style` across all\n\n### Output format\n- Each platform clearly labeled\n- Insights list at the top\n- Total: ~5 assets per repurpose session",
        &["repurpose", "adapt content", "turn into posts", "content from X"],
        &["creator-voice-and-style"],
    )?;

    write_memory_file(
        root, ".ai/skills", "newsletter-writer.md", "skill-newsletter-writer",
        MemoryOntology::Concept,
        "Skill: Write newsletters with subject lines, hooks, and clear CTAs",
        0.80,
        &["newsletter", "email", "writing"],
        "Produces a full newsletter draft: 3 subject line options, intro hook, body sections, and CTA.",
        "## Instructions for AI\n\n### Process\n1. Load `creator-voice-and-style`\n2. Ask: main topic, key takeaway, desired CTA, any links to include\n3. Generate 3 subject line options (< 50 chars each)\n4. Write newsletter structure:\n   - Opener: personal hook or story (2-3 sentences)\n   - Main value: 3 sections with headers\n   - One data point or quote\n   - CTA: single, clear action\n   - Sign-off in the user's voice\n\n### Output format\n- Subject lines labeled A/B/C\n- Preview text (90 chars)\n- Full newsletter body",
        &["newsletter", "write email", "weekly email"],
        &["creator-voice-and-style"],
    )?;

    // ── .ai/rules/ ────────────────────────────────────────────────────────
    write_memory_file(
        root, ".ai/rules", "writing-rules.md", "creator-writing-rules",
        MemoryOntology::Concept,
        "Writing rules loaded on every content task: format, length, style guardrails",
        0.95,
        &["rules", "writing", "guardrails", "style"],
        "Non-negotiable writing guardrails applied to all AI-generated content.",
        "## Writing Rules\n\n_These rules apply to every piece of content the AI writes for you. Customize to match your preferences._\n\n- **Language:** Match the language the user writes in\n- **Length:** Prefer concise. If it can be said in 1 paragraph, don't use 3.\n- **Structure:** Short paragraphs (1-2 lines for social, 3 max for newsletters)\n- **Emojis:** Use sparingly — only in social posts, max 3 per piece\n- **Voice:** Always defer to `creator-voice-and-style` — never sound generic\n- **CTAs:** One per piece, placed at the end, action-oriented verb\n- **Claims:** Support opinions with examples or data when possible\n- **No fluff:** Don't pad content. Every sentence must earn its place.",
        &[],
        &[],
    )?;

    Ok(())
}

fn create_entrepreneur_template(root: &std::path::Path) -> Result<(), String> {
    // ── identity/ ─────────────────────────────────────────────────────────
    write_memory_file(
        root, "identity", "bio.md", "founder-bio",
        MemoryOntology::Entity,
        "Founder bio: background, ventures, and entrepreneurial identity",
        0.95,
        &["bio", "identity", "founder", "background"],
        "Your entrepreneurial story, past ventures, current focus, and the founder persona you project to investors, partners, and customers.",
        "## Founder Bio\n\n> **What to put here:** Your ventures past and present, what problems you're obsessed with solving, your background before entrepreneurship, and your founding story.\n\n### One-liner\n_e.g. \"I build [type of company] for [audience] — currently working on [current venture].\"_\n\n### Background\n_What did you do before founding? What made you a founder?_\n\n### Current venture\n_Name, what it does, stage, and your role._\n\n### Founding story\n_The specific moment or problem that made you start. Make it concrete and personal._\n\n---\n## AI Prompt to fill this file\n\n> \"Help me write my founder bio. Ask me one question at a time about: my current venture and what it solves, what I did before founding, a specific moment that made me start this company, my biggest win so far, and how I describe myself in one sentence. Generate a complete bio.md.\"",
        &["bio", "founder story", "who I am", "about me"],
        &[],
    )?;

    write_memory_file(
        root, "identity", "brand.md", "founder-brand",
        MemoryOntology::Concept,
        "Company/personal brand: positioning, tone, and messaging pillars",
        0.90,
        &["brand", "positioning", "messaging", "identity"],
        "How your company (or personal brand) speaks, what it stands for, and the consistent message across all channels.",
        "## Brand\n\n> **What to put here:** Your positioning statement, tagline, tone of voice, key messages, and what makes your brand different. This is loaded whenever AI writes anything customer-facing.\n\n### Positioning\n- **For:** _target customer_\n- **Who:** _problem they have_\n- **We are:** _category_\n- **That:** _key benefit_\n- **Unlike:** _alternative_\n- **We:** _differentiation_\n\n### Tagline\n_..._\n\n### Voice in 3 words\n_e.g. Bold, Direct, Human_\n\n### Key messages\n1. _Core message 1_\n2. _Core message 2_\n3. _Core message 3_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me define my brand. Ask me about: who my ideal customer is and what they struggle with, what my company does that no one else does, the 3 things I always want people to feel when they interact with my brand, and how I describe my company in a sentence. Generate a complete brand.md.\"",
        &["brand", "positioning", "messaging", "tagline"],
        &[],
    )?;

    write_memory_file(
        root, "identity", "values.md", "founder-values",
        MemoryOntology::Concept,
        "Company values and principles that guide decisions and culture",
        0.85,
        &["values", "culture", "principles", "company"],
        "The principles behind how you build: what you optimize for, how you treat people, and what you refuse to compromise.",
        "## Company Values\n\n> **What to put here:** 3-5 values that actually guide decisions (not just wall poster material). What each means in practice, and decisions you've made because of them.\n\n### Values\n1. **[Value 1]** — _What it looks like in practice_\n2. **[Value 2]** — _e.g. Default to transparency: we share numbers with the team_\n3. **[Value 3]** — _..._\n\n### Lines we don't cross\n- _e.g. We don't grow through dark patterns_\n- _e.g. We don't ship things we wouldn't use ourselves_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me define my company values. Ask me: a hard decision I made that cost us money but felt right, something we refuse to do even if it would help us grow faster, how I describe our culture to candidates, and the one thing I want our team to be known for. Generate a values.md.\"",
        &["values", "culture", "principles", "what we believe"],
        &[],
    )?;

    // ── strategy/ ─────────────────────────────────────────────────────────
    write_memory_file(
        root, "strategy", "roadmap.md", "founder-roadmap",
        MemoryOntology::Entity,
        "Company roadmap: milestones, fundraising timeline, and product direction",
        0.85,
        &["roadmap", "milestones", "strategy", "product"],
        "Where the company is going: product milestones, fundraising goals, hiring plan, and the bets you're making.",
        "## Company Roadmap\n\n> **What to put here:** Your 12-month vision, key product milestones, revenue targets, fundraising timeline, and the 2-3 big bets you're making.\n\n### Current stage\n_Pre-seed / Seed / Series A / etc. — and what that means for your priorities_\n\n### 12-month milestones\n| Milestone | Target | Status |\n|-----------|--------|--------|\n| _e.g. 100 paying customers_ | Q3 2025 | 🔄 |\n| _e.g. Raise seed round_ | Q4 2025 | ⬜ |\n\n### The big bets\n_The 2-3 hypotheses you're betting the company on this year._\n\n---\n## AI Prompt to fill this file\n\n> \"Help me build my company roadmap. Ask me: what stage we're at, the single metric that matters most right now, our 3 most important milestones for the next 12 months, our fundraising plans, and the 2 biggest assumptions we're trying to validate. Generate a roadmap.md with a milestone table.\"",
        &["roadmap", "milestones", "product plan", "company goals"],
        &[],
    )?;

    write_memory_file(
        root, "strategy", "competition.md", "founder-competition",
        MemoryOntology::Entity,
        "Competitive landscape: alternatives, market position, and moat",
        0.75,
        &["competition", "market", "positioning", "landscape"],
        "Who you compete with, how customers solve the problem today, your differentiation, and how you're building a moat.",
        "## Competitive Landscape\n\n> **What to put here:** Direct and indirect competitors, how customers solve the problem without you, your defensible advantages, and how the competitive map might shift.\n\n### The problem space\n_How do customers solve this today? What are the main alternatives?_\n\n### Competitors\n| Company | Approach | Weakness | Our edge |\n|---------|----------|----------|----------|\n| _Name_ | _..._ | _..._ | _..._ |\n\n### Our moat\n_What will be hard to copy in 3 years?_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me map my competitive landscape. Ask me: who the 5 companies fighting for the same customer are, how customers solve the problem today without any of us, what I think is genuinely hard about what we're building, and the one thing I'm most afraid a competitor could copy. Generate a competition.md.\"",
        &["competition", "competitors", "market", "positioning", "moat"],
        &[],
    )?;

    write_memory_file(
        root, "strategy", "goals.md", "founder-goals",
        MemoryOntology::Entity,
        "Quarterly OKRs: focus, targets, and what you're not doing",
        0.90,
        &["goals", "OKRs", "quarterly", "focus"],
        "This quarter's objectives, key results, and explicit deprioritizations — your operating contract with yourself.",
        "## Quarterly Goals\n\n> **What to put here:** 2-3 objectives for this quarter, with measurable key results. Include what you're NOT doing — it's as important as what you are.\n\n### This quarter's theme\n_One word or phrase that captures the quarter's focus._\n\n### Objectives & Key Results\n**O1: [Objective]**\n- KR1: _Measurable result_\n- KR2: _Measurable result_\n\n**O2: [Objective]**\n- KR1: _..._\n\n### Not doing this quarter\n- _Explicit deprioritization 1_\n- _Explicit deprioritization 2_\n\n---\n## AI Prompt to fill this file\n\n> \"Help me set my quarterly OKRs. Ask me: the current date, what I'm most worried about for this quarter, the 2-3 outcomes that would make it a success, and 2 things I'm deliberately not doing. Format as OKRs and generate a complete goals.md.\"",
        &["goals", "OKRs", "this quarter", "focus", "priorities"],
        &["founder-roadmap"],
    )?;

    // ── operations/ ───────────────────────────────────────────────────────
    write_memory_file(
        root, "operations", "sops.md", "founder-sops",
        MemoryOntology::Concept,
        "Founder SOPs: hiring, investor updates, sales process, and weekly cadence",
        0.75,
        &["sops", "process", "workflows", "operations"],
        "Repeatable playbooks for your most important recurring operations: weekly reviews, investor updates, hiring loops, customer calls.",
        "## Operating Playbooks\n\n> **What to put here:** Step-by-step processes for the things you do over and over. The goal is to make them consistent, delegatable, and improvable.\n\n### Weekly CEO review (30 min)\n- [ ] Review key metrics dashboard\n- [ ] Read customer feedback from the week\n- [ ] Update goals.md progress\n- [ ] 3 priorities for next week\n\n### Investor update (monthly)\n- [ ] Metrics: MRR, growth, burn, runway\n- [ ] Wins: 2-3 things that went well\n- [ ] Challenges: 1-2 honest problems\n- [ ] Asks: specific help needed\n\n### Sales / discovery call\n- [ ] Research prospect before call (5 min)\n- [ ] Open with their problem, not your product\n- [ ] Ask: what have you tried before?\n- [ ] Qualify: timeline, budget, decision maker\n- [ ] Clear next step agreed before hanging up\n\n---\n## AI Prompt to fill this file\n\n> \"Help me document my founder SOPs. Ask me about: how I run my weekly review, how I structure investor updates, my sales call process, and one process that's currently messy that I want to systematize. Generate a sops.md with formatted playbooks.\"",
        &["sops", "process", "playbook", "how to run", "checklist"],
        &[],
    )?;

    write_memory_file(
        root, "operations", "email-templates.md", "founder-email-templates",
        MemoryOntology::Entity,
        "Email templates for fundraising, sales, partnerships, and hiring",
        0.75,
        &["email", "outreach", "templates", "fundraising"],
        "Reusable emails for your highest-leverage situations: investor intros, cold outreach, partnership proposals, rejection responses.",
        "## Email Templates\n\n> **What to put here:** Templates for emails you send repeatedly. Good templates save hours and ensure you never send a mediocre version of an important email.\n\n### Investor cold outreach\n**Subject:** _[Company] — [1-line traction hook]_\n```\n[Template]\n```\n\n### Warm intro request\n```\n[Template]\n```\n\n### Customer discovery outreach\n```\n[Template]\n```\n\n### Partnership proposal\n```\n[Template]\n```\n\n### Graceful no (to inbound requests)\n```\n[Template]\n```\n\n---\n## AI Prompt to fill this file\n\n> \"Help me build an email template library. Ask me: the 3 types of emails I send most often, a fundraising or sales email that got a great response and why I think it worked, my company's traction in one sentence, and my preferred tone in professional outreach. Generate 5 templates tailored to my stage and business.\"",
        &["email", "cold outreach", "investor email", "templates"],
        &["founder-brand"],
    )?;

    // ── decisions/ ────────────────────────────────────────────────────────
    write_memory_file(
        root, "decisions", "decision-log.md", "founder-decision-log",
        MemoryOntology::Entity,
        "Founder episodic memory: pivots, hires, strategy calls, and their outcomes",
        0.85,
        &["decisions", "log", "history", "pivots"],
        "A record of your most important founder decisions — pivots, key hires, pricing changes, partnership calls — with reasoning and outcomes.",
        "## Decision Log\n\n> **What to put here:** Major decisions with the full context: what you knew at the time, what you chose, what you rejected, and what actually happened. Invaluable for board prep, co-founder alignment, and your own learning.\n\n### Format\n```\n### [YYYY-MM-DD] [Decision title]\n**Context:** What situation forced this decision\n**Options:** A vs B vs C\n**Chosen:** X\n**Reasoning:** Why — what did you believe at the time?\n**Rejected because:** Why you didn't pick the others\n**Outcome:** [fill in 3-6 months later]\n```\n\n---\n## AI Prompt to fill this file\n\n> \"Help me start my founder decision log. Ask me about 3 significant decisions I've made in the last year: a product pivot or scope cut, a key hire or firing decision, and a strategic call about pricing, market, or fundraising. Capture each with full context and generate a decision-log.md.\"",
        &["decisions", "pivots", "why I chose", "founder history"],
        &[],
    )?;

    // ── .ai/skills/ ───────────────────────────────────────────────────────
    write_memory_file(
        root, ".ai/skills", "strategic-analyzer.md", "skill-strategic-analyzer",
        MemoryOntology::Concept,
        "Skill: Strategic analysis with SWOT, market opportunity, and actionable recommendations",
        0.85,
        &["strategy", "business", "analysis", "market"],
        "Analyzes business and market opportunities using strategic frameworks with prioritized recommendations.",
        "## Instructions for AI\n\n### Process\n1. Load `founder-competition` and `founder-roadmap` for context\n2. Apply the right framework: SWOT, Porter's 5 Forces, or Jobs-to-be-Done\n3. Identify key opportunities and threats\n4. Provide actionable recommendations with priority\n\n### Output format\n- Visual framework (table or 2x2)\n- Top 3 opportunities with justification\n- Top 3 risks with mitigation\n- Concrete next steps",
        &["analyze market", "strategy", "competitive analysis", "SWOT", "business analysis"],
        &["founder-competition", "founder-roadmap"],
    )?;

    write_memory_file(
        root, ".ai/skills", "meeting-action-items.md", "skill-meeting-action-items",
        MemoryOntology::Concept,
        "Skill: Extract decisions and action items from meeting notes",
        0.80,
        &["meetings", "action items", "notes", "productivity"],
        "Takes raw meeting notes or transcripts and extracts structured decisions, action items, and open questions.",
        "## Instructions for AI\n\n### Process\n1. Receive notes or meeting transcript\n2. Identify: decisions made, tasks assigned, open questions\n3. Generate structured summary\n\n### Output format\n- **Decisions:** numbered list\n- **Action Items:** table with [Who] [What] [By when]\n- **Open questions:** to resolve in next meeting\n- **Executive summary:** 3-5 lines",
        &["meeting", "action items", "extract tasks", "meeting notes"],
        &[],
    )?;

    write_memory_file(
        root, ".ai/skills", "task-prioritizer.md", "skill-task-prioritizer",
        MemoryOntology::Concept,
        "Skill: Prioritize tasks using Eisenhower matrix with daily and weekly plan",
        0.80,
        &["tasks", "prioritization", "productivity", "planning"],
        "Prioritizes a task list using the Eisenhower matrix and produces a today plan and weekly plan.",
        "## Instructions for AI\n\n### Process\n1. Load current tasks or receive a task dump\n2. Classify each task:\n   - 🔴 Urgent + Important → Do now\n   - 🟡 Not urgent + Important → Schedule\n   - 🟠 Urgent + Not important → Delegate\n   - ⚪ Neither → Eliminate\n3. Generate today's plan (max 3 tasks) and weekly plan (5-7 tasks)\n\n### Output format\n- Visual 2x2 matrix\n- Today: 3 tasks max\n- This week: 5-7 prioritized tasks\n- Delegation suggestions",
        &["prioritize tasks", "what to do first", "daily plan", "organize tasks"],
        &[],
    )?;

    // ── .ai/rules/ ────────────────────────────────────────────────────────
    write_memory_file(
        root, ".ai/rules", "business-rules.md", "founder-business-rules",
        MemoryOntology::Concept,
        "Rules loaded on every task: tone, decision authority, and confidentiality",
        0.95,
        &["rules", "guardrails", "business", "confidentiality"],
        "Non-negotiable rules applied to all AI work: what decisions need confirmation, what stays confidential, tone standards.",
        "## Business Rules\n\n_Applied to every task. Customize to your preferences._\n\n- **Language:** Match the user's language in every response\n- **Format:** Prefer bullets over long paragraphs\n- **Decisions:** Do not make business decisions (hires, pivots, pricing) without explicit confirmation\n- **Confidential data:** Never include real financial figures, customer names, or sensitive data in outputs intended to be shared\n- **Tone:** Professional but direct. First-name basis with the user.\n- **Length:** Be concise. If it fits in a bullet list, don't write a paragraph.",
        &[],
        &[],
    )?;

    Ok(())
}
