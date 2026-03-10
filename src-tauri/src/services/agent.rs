use anyhow::{Context, Result};
use std::process::Command;

use crate::models::{AgentMessage, AgentRunResult};
use crate::state::AppState;

pub fn run_agent(
    state: &AppState,
    profile_id: &str,
    file_path: &str,
    selected_text: &str,
) -> Result<AgentRunResult> {
    let payload = serde_json::json!({
        "profileId": profile_id,
        "filePath": file_path,
        "selectedText": selected_text
    });

    let output = Command::new("node")
        .args(["sidecar/index.mjs", "agent", &payload.to_string()])
        .current_dir(
            std::env::current_dir().context("unable to determine current working directory")?,
        )
        .output()
        .context("failed to run agent sidecar")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result = serde_json::from_str::<AgentRunResult>(&stdout)
        .context("failed to parse agent sidecar response")?;

    let mut store = state.store.write().expect("store lock poisoned");
    store.agent_messages.push(result.message.clone());
    Ok(result)
}

pub fn apply_agent_patch(root_path: &str, file_path: &str, content: &str) -> Result<()> {
    let absolute = std::path::Path::new(root_path).join(file_path);
    std::fs::write(absolute, content).context("failed to apply agent patch")?;
    Ok(())
}

pub fn get_agent_messages(state: &AppState) -> Result<Vec<AgentMessage>> {
    let store = state.store.read().expect("store lock poisoned");
    Ok(store.agent_messages.clone())
}
