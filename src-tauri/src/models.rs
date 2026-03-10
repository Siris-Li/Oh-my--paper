use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub root_path: String,
    pub main_tex: String,
    pub engine: String,
    pub bib_tool: String,
    pub auto_compile: bool,
    pub forward_sync: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub path: String,
    pub language: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub children: Option<Vec<ProjectNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub file_path: String,
    pub line: usize,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub status: String,
    pub pdf_path: Option<String>,
    pub synctex_path: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
    pub log_path: String,
    pub log_output: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLocation {
    pub file_path: String,
    pub line: usize,
    pub column: usize,
    pub page: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub stages: Vec<String>,
    pub prompt_files: Vec<String>,
    pub tool_allowlist: Vec<String>,
    pub enabled: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub vendor: String,
    pub base_url: String,
    pub auth_ref: String,
    pub default_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FigureBriefDraft {
    pub id: String,
    pub source_section_ref: String,
    pub brief_markdown: String,
    pub prompt_payload: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedAsset {
    pub id: String,
    pub kind: String,
    pub file_path: String,
    pub source_brief_id: String,
    pub metadata: HashMap<String, String>,
    pub preview_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub role: String,
    pub profile_id: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSuggestedPatch {
    pub file_path: String,
    pub content: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub message: AgentMessage,
    pub suggested_patch: Option<AgentSuggestedPatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub project_config: ProjectConfig,
    pub tree: Vec<ProjectNode>,
    pub files: Vec<ProjectFile>,
    pub active_file: String,
    pub providers: Vec<ProviderConfig>,
    pub skills: Vec<SkillManifest>,
    pub profiles: Vec<serde_json::Value>,
    pub compile_result: CompileResult,
    pub figure_briefs: Vec<FigureBriefDraft>,
    pub assets: Vec<GeneratedAsset>,
}
