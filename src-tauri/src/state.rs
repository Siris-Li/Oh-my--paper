use std::sync::RwLock;

use serde_json::json;

use crate::models::{
    AgentMessage, CompileResult, FigureBriefDraft, GeneratedAsset, ProjectConfig, ProviderConfig,
    SkillManifest,
};

pub struct AppStore {
    pub project_config: ProjectConfig,
    pub providers: Vec<ProviderConfig>,
    pub skills: Vec<SkillManifest>,
    pub briefs: Vec<FigureBriefDraft>,
    pub assets: Vec<GeneratedAsset>,
    pub agent_messages: Vec<AgentMessage>,
    pub last_compile: CompileResult,
}

pub struct AppState {
    pub store: RwLock<AppStore>,
}

impl Default for AppState {
    fn default() -> Self {
        let project_config = ProjectConfig {
            root_path: std::env::current_dir()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|_| ".".into()),
            main_tex: "main.tex".into(),
            engine: "xelatex".into(),
            bib_tool: "biber".into(),
            auto_compile: true,
            forward_sync: true,
        };

        let last_compile = CompileResult {
            status: "idle".into(),
            pdf_path: None,
            synctex_path: None,
            diagnostics: vec![],
            log_path: ".viewerleaf/logs/latest.log".into(),
            log_output: "Compile service is idle.".into(),
            timestamp: chrono_like_now(),
        };

        Self {
            store: RwLock::new(AppStore {
                project_config,
                providers: vec![
                    ProviderConfig {
                        id: "openai-main".into(),
                        vendor: "OpenAI".into(),
                        base_url: "https://api.openai.com/v1".into(),
                        auth_ref: "keychain://viewerleaf/openai-main".into(),
                        default_model: "gpt-4.1".into(),
                    },
                    ProviderConfig {
                        id: "anthropic-main".into(),
                        vendor: "Anthropic".into(),
                        base_url: "https://api.anthropic.com".into(),
                        auth_ref: "keychain://viewerleaf/anthropic-main".into(),
                        default_model: "claude-sonnet-4".into(),
                    },
                ],
                skills: vec![
                    SkillManifest {
                        id: "academic-outline".into(),
                        name: "Academic Outline".into(),
                        version: "1.0.0".into(),
                        stages: vec!["planning".into()],
                        prompt_files: vec!["outline.md".into()],
                        tool_allowlist: vec!["read_section".into(), "insert_outline_into_section".into()],
                        enabled: true,
                        source: "local".into(),
                    },
                    SkillManifest {
                        id: "banana-figure-workflow".into(),
                        name: "Banana Figure Workflow".into(),
                        version: "1.0.0".into(),
                        stages: vec!["figures".into()],
                        prompt_files: vec!["figure-brief.md".into(), "banana-payload.md".into()],
                        tool_allowlist: vec!["create_figure_brief".into(), "run_banana_generation".into()],
                        enabled: true,
                        source: "local".into(),
                    },
                ],
                briefs: vec![],
                assets: vec![],
                agent_messages: vec![AgentMessage {
                    id: "boot".into(),
                    role: "system".into(),
                    profile_id: "outline".into(),
                    content: "ViewerLeaf runtime ready.".into(),
                    timestamp: chrono_like_now(),
                }],
                last_compile,
            }),
        }
    }
}

pub fn default_profiles() -> Vec<serde_json::Value> {
    vec![
        json!({
          "id": "outline",
          "label": "Outline",
          "summary": "Generate section structure and section-level claims.",
          "stage": "planning",
          "providerId": "openai-main",
          "model": "gpt-4.1",
          "skillIds": ["academic-outline"],
          "toolAllowlist": ["read_section", "insert_outline_into_section"],
          "outputMode": "outline"
        }),
        json!({
          "id": "draft",
          "label": "Draft",
          "summary": "Expand notes into prose while keeping the paper voice stable.",
          "stage": "drafting",
          "providerId": "anthropic-main",
          "model": "claude-sonnet-4",
          "skillIds": ["academic-draft"],
          "toolAllowlist": ["read_section", "apply_text_patch"],
          "outputMode": "rewrite"
        }),
        json!({
          "id": "polish",
          "label": "Polish",
          "summary": "Tighten academic style and compress repeated phrasing.",
          "stage": "revision",
          "providerId": "openrouter-lab",
          "model": "claude-3.7-sonnet",
          "skillIds": ["academic-polish"],
          "toolAllowlist": ["read_section", "apply_text_patch"],
          "outputMode": "rewrite"
        }),
        json!({
          "id": "de_ai",
          "label": "De-AI",
          "summary": "Remove generic AI rhythms and over-explained transitions.",
          "stage": "revision",
          "providerId": "openai-main",
          "model": "gpt-4.1-mini",
          "skillIds": ["academic-de-ai"],
          "toolAllowlist": ["read_section", "apply_text_patch"],
          "outputMode": "rewrite"
        }),
        json!({
          "id": "review",
          "label": "Review",
          "summary": "Review the argument structure like a hard reviewer.",
          "stage": "submission",
          "providerId": "anthropic-main",
          "model": "claude-sonnet-4",
          "skillIds": ["academic-review"],
          "toolAllowlist": ["read_section", "search_project"],
          "outputMode": "review"
        }),
    ]
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|dur| dur.as_secs())
        .unwrap_or_default();
    secs.to_string()
}
