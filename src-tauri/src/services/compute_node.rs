use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// Expand a leading `~` to the user's home directory.
fn expand_tilde(path: &str) -> String {
    if path.starts_with('~') {
        let home = dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| "~".to_string());
        path.replacen('~', &home, 1)
    } else {
        path.to_string()
    }
}

/// A single SSH compute‑node configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeNodeConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: String, // "key" | "password"
    pub key_path: String,
    pub password: String,
    pub work_dir: String,
}

/// Top‑level wrapper stored in the JSON file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeNodeStore {
    pub nodes: Vec<ComputeNodeConfig>,
    pub active_node_id: Option<String>,
}

impl Default for ComputeNodeStore {
    fn default() -> Self {
        Self {
            nodes: Vec::new(),
            active_node_id: None,
        }
    }
}

/// Resolve the path to the compute‑node config file.
fn config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".viewerleaf").join("compute-nodes.json")
}

/// Load the full store from disk (or return default if missing).
pub fn load_store() -> ComputeNodeStore {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => ComputeNodeStore::default(),
    }
}

/// Persist the store to disk with restrictive permissions.
fn save_store(store: &ComputeNodeStore) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    // Set file permissions to 0600 on Unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, perms).ok();
    }
    Ok(())
}

// ─── Public API ────────────────────────────────────────────

pub fn load_compute_nodes() -> Result<ComputeNodeStore, String> {
    Ok(load_store())
}

pub fn save_compute_node(node: ComputeNodeConfig) -> Result<(), String> {
    let mut store = load_store();
    if let Some(existing) = store.nodes.iter_mut().find(|n| n.id == node.id) {
        *existing = node.clone();
    } else {
        store.nodes.push(node.clone());
    }
    if store.active_node_id.is_none() || store.nodes.len() == 1 {
        store.active_node_id = Some(node.id.clone());
    }
    save_store(&store)
}

pub fn delete_compute_node(node_id: &str) -> Result<(), String> {
    let mut store = load_store();
    store.nodes.retain(|n| n.id != node_id);
    if store.active_node_id.as_deref() == Some(node_id) {
        store.active_node_id = store.nodes.first().map(|n| n.id.clone());
    }
    save_store(&store)
}

pub fn set_active_compute_node(node_id: &str) -> Result<(), String> {
    let mut store = load_store();
    if !store.nodes.iter().any(|n| n.id == node_id) {
        return Err(format!("Node \"{}\" not found", node_id));
    }
    store.active_node_id = Some(node_id.to_string());
    save_store(&store)
}

/// Test SSH connectivity by running `echo ok` on the remote host.
pub fn test_compute_node(node_id: &str) -> Result<serde_json::Value, String> {
    let store = load_store();
    let node = store
        .nodes
        .iter()
        .find(|n| n.id == node_id)
        .ok_or_else(|| format!("Node \"{}\" not found", node_id))?;

    let mut ssh_args: Vec<String> = vec![
        "-o".into(),
        "StrictHostKeyChecking=no".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-p".into(),
        node.port.to_string(),
    ];

    if node.auth_method == "key" && !node.key_path.is_empty() {
        let expanded = expand_tilde(&node.key_path);
        ssh_args.push("-i".into());
        ssh_args.push(expanded);
    }

    ssh_args.push(format!("{}@{}", node.user, node.host));
    ssh_args.push("echo ok".into());

    let output = Command::new("ssh")
        .args(&ssh_args)
        .output()
        .map_err(|e| format!("Failed to spawn ssh: {e}"))?;

    if output.status.success() {
        Ok(serde_json::json!({ "success": true, "message": "ok" }))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("SSH connection failed: {}", stderr))
    }
}

/// Get the active compute node config (if any), for injection into agent requests.
pub fn get_active_node() -> Option<ComputeNodeConfig> {
    let store = load_store();
    let active_id = store.active_node_id.as_ref()?;
    store.nodes.into_iter().find(|n| &n.id == active_id)
}
