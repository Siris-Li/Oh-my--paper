use anyhow::{Context, Result};
use std::collections::HashMap;
use std::process::Command;
use uuid::Uuid;

use crate::models::{FigureBriefDraft, GeneratedAsset};
use crate::state::AppState;

pub fn create_brief(
    state: &AppState,
    section_ref: &str,
    selected_text: &str,
) -> Result<FigureBriefDraft> {
    let brief = FigureBriefDraft {
        id: Uuid::new_v4().to_string(),
        source_section_ref: section_ref.into(),
        brief_markdown: format!(
            "# Figure brief for {section_ref}\n\n## Source excerpt\n{selected_text}\n"
        ),
        prompt_payload: format!(
            "Create a paper figure for {section_ref} emphasizing compile-preview-agent-figure flow."
        ),
        status: "draft".into(),
    };
    let mut store = state.store.write().expect("store lock poisoned");
    store.briefs.insert(0, brief.clone());
    Ok(brief)
}

pub fn run_figure_skill(state: &AppState, brief_id: &str) -> Result<FigureBriefDraft> {
    let mut store = state.store.write().expect("store lock poisoned");
    let brief = store
        .briefs
        .iter_mut()
        .find(|item| item.id == brief_id)
        .context("figure brief not found")?;

    let payload = serde_json::json!({
        "briefId": brief.id,
        "promptPayload": brief.prompt_payload,
        "briefMarkdown": brief.brief_markdown
    });

    let output = Command::new("node")
        .args(["sidecar/index.mjs", "figure-skill", &payload.to_string()])
        .current_dir(std::env::current_dir()?)
        .output()
        .context("failed to run figure skill sidecar")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let updated = serde_json::from_str::<FigureBriefDraft>(&stdout)
        .context("failed to parse figure skill response")?;
    *brief = updated.clone();
    Ok(updated)
}

pub fn run_banana_generation(state: &AppState, brief_id: &str) -> Result<GeneratedAsset> {
    let store = state.store.read().expect("store lock poisoned");
    let brief = store
        .briefs
        .iter()
        .find(|item| item.id == brief_id)
        .cloned()
        .context("figure brief not found")?;
    drop(store);

    let payload = serde_json::json!({
        "briefId": brief.id,
        "promptPayload": brief.prompt_payload
    });

    let output = Command::new("node")
        .args(["sidecar/index.mjs", "banana", &payload.to_string()])
        .current_dir(std::env::current_dir()?)
        .output()
        .context("failed to run banana sidecar")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut asset = serde_json::from_str::<GeneratedAsset>(&stdout)
        .context("failed to parse banana response")?;

    if asset.id.is_empty() {
        asset.id = Uuid::new_v4().to_string();
    }
    if asset.metadata.is_empty() {
        asset.metadata = HashMap::new();
    }

    let mut store = state.store.write().expect("store lock poisoned");
    store.assets.insert(0, asset.clone());
    Ok(asset)
}

pub fn register_asset(state: &AppState, asset: GeneratedAsset) -> GeneratedAsset {
    let mut store = state.store.write().expect("store lock poisoned");
    if !store.assets.iter().any(|item| item.id == asset.id) {
        store.assets.insert(0, asset.clone());
    }
    asset
}

pub fn insert_figure_snippet(
    state: &AppState,
    file_path: &str,
    asset_id: &str,
    caption: &str,
    line: usize,
) -> Result<(String, String)> {
    let store = state.store.read().expect("store lock poisoned");
    let root = store.project_config.root_path.clone();
    let asset = store
        .assets
        .iter()
        .find(|item| item.id == asset_id)
        .cloned()
        .context("asset not found")?;
    drop(store);

    let absolute = std::path::Path::new(&root).join(file_path);
    let content = std::fs::read_to_string(&absolute).unwrap_or_default();
    let label = asset
        .file_path
        .replace("assets/figures/", "")
        .replace('.', "-")
        .replace('/', "-");
    let snippet = format!(
        "\\begin{{figure}}[htbp]\n  \\centering\n  \\includegraphics[width=0.82\\linewidth]{{{}}}\n  \\caption{{{}}}\n  \\label{{fig:{}}}\n\\end{{figure}}",
        asset.file_path,
        caption,
        label
    );
    let mut lines = content.lines().map(|line| line.to_string()).collect::<Vec<_>>();
    let target = line.min(lines.len());
    lines.insert(target, String::new());
    lines.insert(target, snippet);
    let updated = lines.join("\n");
    std::fs::write(&absolute, &updated)?;
    Ok((file_path.into(), updated))
}
