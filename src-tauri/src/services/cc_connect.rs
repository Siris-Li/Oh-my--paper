//! CC-Connect Integration Service
//!
//! Manages the cc-connect CLI process for bridging local AI agents to
//! messaging platforms (WeChat/Weixin via iLink, Feishu, Telegram, etc.).
//!
//! Lifecycle:
//!   1. detect  → check if `cc-connect` is installed
//!   2. config  → generate `~/.cc-connect/config.toml` for the current project
//!   3. setup   → run `cc-connect weixin setup --project <name>` (interactive QR scan)
//!   4. start   → spawn `cc-connect` as a managed background process
//!   5. stop    → terminate the background process

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::services::enriched_path;

// ── Data Types ──────────────────────────────────────────────

/// Installation / runtime status of cc-connect.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CcConnectStatus {
    /// Whether the `cc-connect` binary is found on PATH.
    pub installed: bool,
    /// Version string (e.g. "1.2.0-beta.3"), if installed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Current process state: "idle", "running", "error".
    pub state: String,
    /// Human-readable status message.
    pub message: String,
}

/// Managed state for the cc-connect background process.
pub struct CcConnectState {
    /// The managed child process.
    pub child: Mutex<Option<Child>>,
    /// Whether the process is running.
    pub running: Arc<AtomicBool>,
    /// Current status info.
    pub status: Arc<Mutex<CcConnectStatus>>,
    /// The `weixin setup` child process (kept alive until scan completes).
    pub setup_child: Mutex<Option<Child>>,
}

impl Default for CcConnectState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            running: Arc::new(AtomicBool::new(false)),
            status: Arc::new(Mutex::new(CcConnectStatus {
                installed: false,
                version: None,
                state: "idle".into(),
                message: "Not started".into(),
            })),
            setup_child: Mutex::new(None),
        }
    }
}

// ── Helper: enriched PATH for process spawning ──────────────

fn enriched_env_path() -> String {
    enriched_path()
}

fn cc_connect_bin() -> String {
    // Allow override via env var for development
    std::env::var("CC_CONNECT_BIN")
        .unwrap_or_else(|_| "cc-connect".to_string())
}

// ── Detection ───────────────────────────────────────────────

/// Check if `cc-connect` is installed and return its version.
pub fn detect() -> CcConnectStatus {
    let bin = cc_connect_bin();
    let path = enriched_env_path();

    // Try `cc-connect --version`
    let output = Command::new(&bin)
        .arg("--version")
        .env("PATH", &path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let version_raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
            // cc-connect --version may output "cc-connect version 1.2.3-beta.1"
            let version = version_raw
                .strip_prefix("cc-connect version ")
                .or_else(|| version_raw.strip_prefix("cc-connect "))
                .unwrap_or(&version_raw)
                .trim()
                .to_string();

            CcConnectStatus {
                installed: true,
                version: if version.is_empty() { None } else { Some(version) },
                state: "idle".into(),
                message: "Installed".into(),
            }
        }
        _ => CcConnectStatus {
            installed: false,
            version: None,
            state: "idle".into(),
            message: "cc-connect not found. Install with: npm install -g cc-connect@beta".into(),
        },
    }
}

/// Install cc-connect beta via npm.
/// Returns the version string on success.
pub fn install_beta() -> Result<String, String> {
    let path = enriched_env_path();

    let output = Command::new("npm")
        .args(["install", "-g", "cc-connect@beta"])
        .env("PATH", &path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run npm: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("npm install failed: {stderr}"));
    }

    // Verify installation
    let status = detect();
    if status.installed {
        Ok(status.version.unwrap_or_else(|| "unknown".into()))
    } else {
        Err("Installation completed but cc-connect binary not found on PATH".into())
    }
}

// ── Config Generation ───────────────────────────────────────

fn config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cc-connect")
}

fn config_path() -> PathBuf {
    config_dir().join("config.toml")
}

/// Generate or update `~/.cc-connect/config.toml` with a project entry
/// configured for the current Viwerleaf project using Weixin (iLink).
pub fn generate_config(
    project_name: &str,
    work_dir: &str,
    agent_type: &str,
) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {e}"))?;

    let path = config_path();

    // Read existing config if present
    let existing = std::fs::read_to_string(&path).unwrap_or_default();

    // Check if this project already has an entry
    let project_marker = format!("name = \"{}\"", project_name);
    if existing.contains(&project_marker) {
        // Project already configured, skip
        return Ok(());
    }

    // Determine agent mode
    let (agent_type_value, mode) = match agent_type {
        "codex" => ("codex", "full-auto"),
        "gemini" => ("gemini", "default"),
        _ => ("claudecode", "default"),
    };

    // Build the new project block
    let project_block = format!(
        r#"
[[projects]]
name = "{project_name}"

[projects.agent]
type = "{agent_type_value}"

[projects.agent.options]
work_dir = "{work_dir}"
mode = "{mode}"

[[projects.platforms]]
type = "weixin"
"#
    );

    // Append to existing config or create new one
    let new_config = if existing.trim().is_empty() {
        format!(
            r#"# cc-connect configuration — generated by ViewerLeaf
# See: https://github.com/chenhg5/cc-connect

[log]
level = "info"
{project_block}"#
        )
    } else {
        format!("{existing}\n{project_block}")
    };

    std::fs::write(&path, &new_config)
        .map_err(|e| format!("Failed to write config.toml: {e}"))?;

    Ok(())
}

// ── Weixin Setup (QR code scan) ─────────────────────────────

/// Run `cc-connect weixin setup --project <name>` and capture the QR URL
/// from its output. The child process is stored in `state.setup_child` so it
/// stays alive while the user scans the QR code. Call `wait_weixin_setup()`
/// after the user confirms they have scanned, or `cancel_weixin_setup()` to
/// abort.
///
/// Returns the QR URL string on success.
pub fn run_weixin_setup(project_name: &str, state: &CcConnectState) -> Result<String, String> {
    // Kill any previous setup child that might still be running
    cancel_weixin_setup(state);

    let bin = cc_connect_bin();
    let path = enriched_env_path();

    let mut child = Command::new(&bin)
        .args(["weixin", "setup", "--project", project_name])
        .env("PATH", &path)
        .env("CLAUDECODE", "") // Unset to avoid nested-session errors
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start weixin setup: {e}"))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let reader = BufReader::new(stdout);

    let mut qr_url: Option<String> = None;

    // Read lines looking for the QR URL
    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read output: {e}"))?;
        eprintln!("[cc-connect setup] {}", line);

        // cc-connect prints the QR URL in various formats:
        // - Direct URL: https://...
        // - "Please scan: https://..."
        // - "QR code URL: https://..."
        if let Some(url) = extract_url(&line) {
            qr_url = Some(url);
            break;
        }
    }

    // Store the child process so it stays alive while user scans
    if qr_url.is_some() {
        if let Ok(mut guard) = state.setup_child.lock() {
            *guard = Some(child);
        }
    } else {
        // No URL found — kill and clean up
        let _ = child.kill();
        let _ = child.wait();
    }

    qr_url.ok_or_else(|| {
        "No QR URL found in cc-connect weixin setup output. Ensure cc-connect@beta is installed."
            .into()
    })
}

/// Wait for the `weixin setup` process to complete (user scanned QR).
/// Returns Ok(true) if the process exited successfully, Ok(false) if still
/// running, or Err on failure.
pub fn wait_weixin_setup(state: &CcConnectState) -> Result<bool, String> {
    let mut guard = state.setup_child.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(exit_status)) => {
                // Process exited — setup complete
                let success = exit_status.success();
                *guard = None;
                if success {
                    Ok(true)
                } else {
                    Err(format!("weixin setup exited with status: {exit_status}"))
                }
            }
            Ok(None) => {
                // Still running — user hasn't scanned yet
                Ok(false)
            }
            Err(e) => {
                *guard = None;
                Err(format!("Failed to check setup process: {e}"))
            }
        }
    } else {
        // No setup process — might have already completed or was never started
        Ok(true)
    }
}

/// Cancel / kill a running `weixin setup` process.
pub fn cancel_weixin_setup(state: &CcConnectState) {
    if let Ok(mut guard) = state.setup_child.lock() {
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
}

/// Extract a URL from a line of cc-connect output.
fn extract_url(line: &str) -> Option<String> {
    // Look for https:// URLs in the line
    for word in line.split_whitespace() {
        let trimmed = word.trim_matches(|c: char| !c.is_alphanumeric() && c != ':' && c != '/' && c != '.' && c != '-' && c != '_' && c != '?' && c != '=' && c != '&' && c != '%');
        if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
            return Some(trimmed.to_string());
        }
    }
    None
}

// ── Process Management ──────────────────────────────────────

/// Start cc-connect as a background process.
///
/// The process uses the config at `~/.cc-connect/config.toml` or
/// a custom path if provided.
pub fn start(
    state: &CcConnectState,
    config_path_override: Option<&str>,
) -> Result<(), String> {
    // Check if already running
    if state.running.load(Ordering::SeqCst) {
        return Ok(());
    }

    let bin = cc_connect_bin();
    let path = enriched_env_path();

    let mut cmd = Command::new(&bin);
    cmd.env("PATH", &path)
        .env("CLAUDECODE", "") // Unset to avoid nested-session errors
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cfg) = config_path_override {
        cmd.args(["-config", cfg]);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start cc-connect: {e}"))?;

    let pid = child.id();

    {
        let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;
        *child_guard = Some(child);
    }

    state.running.store(true, Ordering::SeqCst);

    {
        let mut status = state.status.lock().map_err(|e| e.to_string())?;
        status.state = "running".into();
        status.message = format!("cc-connect running (PID: {})", pid);
    }

    // Spawn a monitor thread that updates status when the process exits
    let running = state.running.clone();
    let status_ref = state.status.clone();
    let child_ref = state.child.lock().map_err(|e| e.to_string())?;
    // We need a second reference for the monitor. Instead, use a thread that
    // periodically checks via the state.
    drop(child_ref);

    let child_mutex = {
        // We can't easily clone a Mutex<Option<Child>>, so we use a different
        // approach: spawn a thread that periodically polls.
        let running_clone = running.clone();
        let status_clone = status_ref.clone();

        std::thread::spawn(move || {
            // Simple polling loop to detect process exit
            loop {
                std::thread::sleep(std::time::Duration::from_secs(2));

                if !running_clone.load(Ordering::SeqCst) {
                    break;
                }

                // Try to check if pid is still alive
                // On unix, send signal 0 to check
                #[cfg(unix)]
                {
                    use std::process::Command as ProcCmd;
                    let result = ProcCmd::new("kill")
                        .args(["-0", &pid.to_string()])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status();

                    if let Ok(status) = result {
                        if !status.success() {
                            // Process has exited
                            running_clone.store(false, Ordering::SeqCst);
                            if let Ok(mut s) = status_clone.lock() {
                                s.state = "idle".into();
                                s.message = "cc-connect process exited".into();
                            }
                            break;
                        }
                    }
                }
            }
        });
    };

    let _ = child_mutex; // suppress unused warning

    Ok(())
}

/// Stop the managed cc-connect process.
pub fn stop(state: &CcConnectState) -> Result<(), String> {
    state.running.store(false, Ordering::SeqCst);

    let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *child_guard {
        let _ = child.kill();
        let _ = child.wait();
    }
    *child_guard = None;

    {
        let mut status = state.status.lock().map_err(|e| e.to_string())?;
        status.state = "idle".into();
        status.message = "Stopped".into();
    }

    Ok(())
}

/// Get current cc-connect status (combines detection + runtime state).
pub fn get_status(state: &CcConnectState) -> CcConnectStatus {
    if let Ok(status) = state.status.lock() {
        let mut s = status.clone();
        // Update installed status dynamically
        if !s.installed {
            let detection = detect();
            s.installed = detection.installed;
            s.version = detection.version;
        }
        s
    } else {
        detect()
    }
}

// ── Unit tests ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_url_from_line() {
        assert_eq!(
            extract_url("Please scan: https://example.com/qr?code=abc123"),
            Some("https://example.com/qr?code=abc123".into())
        );
        assert_eq!(
            extract_url("https://ilinkai.weixin.qq.com/scan/abc"),
            Some("https://ilinkai.weixin.qq.com/scan/abc".into())
        );
        assert_eq!(extract_url("no url here"), None);
    }

    #[test]
    fn default_state() {
        let state = CcConnectState::default();
        assert!(!state.running.load(Ordering::SeqCst));
        let status = state.status.lock().unwrap();
        assert_eq!(status.state, "idle");
    }

    #[test]
    fn config_path_is_correct() {
        let path = config_path();
        assert!(path.to_string_lossy().contains(".cc-connect"));
        assert!(path.to_string_lossy().ends_with("config.toml"));
    }
}
