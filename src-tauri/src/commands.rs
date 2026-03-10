use tauri::State;

use crate::models::{
    AgentMessage, AgentRunResult, FigureBriefDraft, GeneratedAsset, ProviderConfig, SkillManifest,
    SyncLocation, WorkspaceSnapshot,
};
use crate::services::{agent, compile, figure, project, provider, skill, sync};
use crate::state::AppState;

#[tauri::command]
pub fn open_project(state: State<'_, AppState>) -> Result<WorkspaceSnapshot, String> {
    project::load_project_snapshot(&state).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn save_file(state: State<'_, AppState>, file_path: String, content: String) -> Result<bool, String> {
    project::save_file(&state, &file_path, &content)
        .map(|_| true)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn compile_project(state: State<'_, AppState>, file_path: String) -> Result<crate::models::CompileResult, String> {
    compile::compile_project(&state, &file_path).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn forward_search(state: State<'_, AppState>, file_path: String, line: usize) -> Result<SyncLocation, String> {
    sync::forward_search(&state, &file_path, line).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn reverse_search(state: State<'_, AppState>, page: usize) -> Result<SyncLocation, String> {
    sync::reverse_search(&state, page).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn run_agent(
    state: State<'_, AppState>,
    profile_id: String,
    file_path: String,
    selected_text: String,
) -> Result<AgentRunResult, String> {
    agent::run_agent(&state, &profile_id, &file_path, &selected_text).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn apply_agent_patch(_state: State<'_, AppState>, file_path: String, content: String) -> Result<bool, String> {
    let root_path = _state
        .store
        .read()
        .expect("store lock poisoned")
        .project_config
        .root_path
        .clone();
    agent::apply_agent_patch(&root_path, &file_path, &content)
        .map(|_| true)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_skills(state: State<'_, AppState>) -> Result<Vec<SkillManifest>, String> {
    Ok(skill::list(&state))
}

#[tauri::command]
pub fn install_skill(state: State<'_, AppState>, skill: SkillManifest) -> Result<SkillManifest, String> {
    skill::install(&state, skill).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn enable_skill(state: State<'_, AppState>, skill_id: String, enabled: bool) -> Result<Option<SkillManifest>, String> {
    skill::enable(&state, &skill_id, enabled).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_providers(state: State<'_, AppState>) -> Result<Vec<ProviderConfig>, String> {
    Ok(provider::list(&state))
}

#[tauri::command]
pub fn add_provider(state: State<'_, AppState>, provider: ProviderConfig) -> Result<ProviderConfig, String> {
    provider::add(&state, provider).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_provider(
    state: State<'_, AppState>,
    provider_id: String,
    patch: serde_json::Value,
) -> Result<Option<ProviderConfig>, String> {
    provider::update(&state, &provider_id, patch).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_figure_brief(
    state: State<'_, AppState>,
    section_ref: String,
    selected_text: String,
) -> Result<FigureBriefDraft, String> {
    figure::create_brief(&state, &section_ref, &selected_text).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn run_figure_skill(state: State<'_, AppState>, brief_id: String) -> Result<FigureBriefDraft, String> {
    figure::run_figure_skill(&state, &brief_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn run_banana_generation(state: State<'_, AppState>, brief_id: String) -> Result<GeneratedAsset, String> {
    figure::run_banana_generation(&state, &brief_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn register_generated_asset(state: State<'_, AppState>, asset: GeneratedAsset) -> Result<GeneratedAsset, String> {
    Ok(figure::register_asset(&state, asset))
}

#[tauri::command]
pub fn insert_figure_snippet(
    state: State<'_, AppState>,
    file_path: String,
    asset_id: String,
    caption: String,
    line: usize,
) -> Result<serde_json::Value, String> {
    figure::insert_figure_snippet(&state, &file_path, &asset_id, &caption, line)
        .map(|(file_path, content)| serde_json::json!({ "filePath": file_path, "content": content }))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_agent_messages(state: State<'_, AppState>) -> Result<Vec<AgentMessage>, String> {
    agent::get_agent_messages(&state).map_err(|err| err.to_string())
}
