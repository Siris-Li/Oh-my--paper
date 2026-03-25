use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use std::sync::atomic::{AtomicBool, Ordering};

/// Flag set by stop_auto_experiment to signal the frontend loop to exit.
pub static EXPERIMENT_STOP_FLAG: AtomicBool = AtomicBool::new(false);
/// Flag set by pause_auto_experiment; frontend checks this to pause iteration.
pub static EXPERIMENT_PAUSE_FLAG: AtomicBool = AtomicBool::new(false);
/// Guard: only one experiment can run at a time.
pub static EXPERIMENT_RUNNING: AtomicBool = AtomicBool::new(false);
/// Root path of the project that owns the currently running experiment.
pub static EXPERIMENT_ROOT_PATH: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// Check if an experiment is running for a specific project root.
pub fn is_experiment_running_for(root: &str) -> bool {
    if !EXPERIMENT_RUNNING.load(Ordering::SeqCst) {
        return false;
    }
    if let Ok(lock) = EXPERIMENT_ROOT_PATH.lock() {
        *lock == root
    } else {
        false
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRunState {
    pub status: String,
    pub iterations: u32,
    pub best_metric_value: Option<f64>,
    #[serde(default)]
    pub run_history: Vec<serde_json::Value>,
    #[serde(default)]
    pub max_failures: u32,
    #[serde(default)]
    pub current_failures: u32,
    pub session_id: Option<String>,
    pub start_time_ms: Option<u128>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentLoopConfig {
    pub enabled: bool,
    pub remote_node: String,
    pub eval_command: String,
    pub success_metric: String,
    pub success_direction: String,
    pub success_threshold: f64,
    pub max_iterations: u32,
    pub max_failures: u32,
    pub max_duration_minutes: u32,
    pub result_paths: Vec<String>,
}

// ────────────────────────────────────────────────────────────────
// Frontend-driven experiment loop: start / pre / post / control
// ────────────────────────────────────────────────────────────────

/// Payload for starting an experiment loop (frontend calls once).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StartExperimentPayload {
    pub session_id: String,
    pub loop_config: ExperimentLoopConfig,
    pub task_id: String,
}

/// Result returned by start_experiment_loop.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StartExperimentResult {
    pub success: bool,
    pub message: String,
}

/// Start the experiment loop: initialize state file, set flags.
/// Frontend then drives the iteration by calling pre/post in a loop.
pub fn start_experiment_loop(
    app_handle: &AppHandle,
    payload: StartExperimentPayload,
) -> Result<StartExperimentResult, String> {
    // Single-instance guard
    if EXPERIMENT_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("An experiment is already running".into());
    }

    // Reset flags
    EXPERIMENT_STOP_FLAG.store(false, Ordering::SeqCst);
    EXPERIMENT_PAUSE_FLAG.store(false, Ordering::SeqCst);

    let state = app_handle.state::<AppState>();
    let root_path = {
        let config = state.project_config.read().unwrap();
        config.root_path.clone()
    };

    // Track which project owns this experiment
    if let Ok(mut lock) = EXPERIMENT_ROOT_PATH.lock() {
        *lock = root_path.clone();
    }

    let run_state_path =
        Path::new(&root_path).join(".viewerleaf/research/Experiment/automation/run-state.json");
    if let Some(parent) = run_state_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let initial = ExperimentRunState {
        status: "running".into(),
        iterations: 0,
        best_metric_value: None,
        run_history: Vec::new(),
        max_failures: payload.loop_config.max_failures,
        current_failures: 0,
        session_id: Some(payload.session_id.clone()),
        start_time_ms: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis(),
        ),
    };
    let _ = fs::write(
        &run_state_path,
        serde_json::to_string_pretty(&initial).unwrap(),
    );

    Ok(StartExperimentResult {
        success: true,
        message: format!(
            "Experiment started (max {} iterations, metric: {} {} {})",
            payload.loop_config.max_iterations,
            payload.loop_config.success_metric,
            payload.loop_config.success_direction,
            payload.loop_config.success_threshold,
        ),
    })
}

// ─── Pre-iteration ─────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreIterationResult {
    pub should_continue: bool,
    pub iteration: u32,
    pub max_iterations: u32,
    pub prompt: String,
    pub status: String,
    /// true if paused, frontend should poll until unpaused
    pub paused: bool,
    pub sync_output: String,
}

/// Called by frontend before each iteration.
/// - Checks stop/pause flags and run-state limits
/// - Executes forced `compute-helper sync up`
/// - Builds the iteration prompt
/// Returns PreIterationResult telling frontend whether to proceed.
pub fn experiment_pre_iteration(
    app_handle: &AppHandle,
    loop_config: &ExperimentLoopConfig,
) -> Result<PreIterationResult, String> {
    let state = app_handle.state::<AppState>();
    let root_path = {
        let config = state.project_config.read().unwrap();
        config.root_path.clone()
    };

    // ── Check stop flag ──
    if EXPERIMENT_STOP_FLAG.load(Ordering::SeqCst) {
        update_run_state_status(&root_path, "stopped");
        return Ok(PreIterationResult {
            should_continue: false,
            iteration: 0,
            max_iterations: loop_config.max_iterations,
            prompt: String::new(),
            status: "stopped".into(),
            paused: false,
            sync_output: String::new(),
        });
    }

    // ── Check pause flag ──
    if EXPERIMENT_PAUSE_FLAG.load(Ordering::SeqCst) {
        update_run_state_status(&root_path, "paused");
        return Ok(PreIterationResult {
            should_continue: false,
            iteration: 0,
            max_iterations: loop_config.max_iterations,
            prompt: String::new(),
            status: "paused".into(),
            paused: true,
            sync_output: String::new(),
        });
    }

    // ── Load run-state ──
    let run_state = load_run_state(&root_path);

    if run_state.status != "running" {
        return Ok(PreIterationResult {
            should_continue: false,
            iteration: run_state.iterations,
            max_iterations: loop_config.max_iterations,
            prompt: String::new(),
            status: run_state.status,
            paused: false,
            sync_output: String::new(),
        });
    }

    // ── Check iteration limit ──
    if run_state.iterations >= loop_config.max_iterations {
        update_run_state_status(&root_path, "stopped");
        return Ok(PreIterationResult {
            should_continue: false,
            iteration: run_state.iterations,
            max_iterations: loop_config.max_iterations,
            prompt: String::new(),
            status: "stopped".into(),
            paused: false,
            sync_output: String::new(),
        });
    }

    // ── Check failure limit ──
    if run_state.current_failures >= loop_config.max_failures && loop_config.max_failures > 0 {
        update_run_state_status(&root_path, "failed");
        return Ok(PreIterationResult {
            should_continue: false,
            iteration: run_state.iterations,
            max_iterations: loop_config.max_iterations,
            prompt: String::new(),
            status: "failed".into(),
            paused: false,
            sync_output: String::new(),
        });
    }

    // ── Check duration limit ──
    if let Some(start) = run_state.start_time_ms {
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let elapsed_mins = (current_time.saturating_sub(start)) as f64 / 60000.0;
        if elapsed_mins >= loop_config.max_duration_minutes as f64
            && loop_config.max_duration_minutes > 0
        {
            update_run_state_status(&root_path, "stopped");
            return Ok(PreIterationResult {
                should_continue: false,
                iteration: run_state.iterations,
                max_iterations: loop_config.max_iterations,
                prompt: String::new(),
                status: "stopped".into(),
                paused: false,
                sync_output: String::new(),
            });
        }
    }

    // ── Force sync up ──
    let sync_output = force_sync_up(&state, &root_path);

    // ── Build prompt ──
    let iter_num = run_state.iterations + 1;
    let mut prompt = format!(
        "🧪 自动实验迭代 {}/{}...\n",
        iter_num, loop_config.max_iterations
    );
    if let Some(best) = run_state.best_metric_value {
        prompt.push_str(&format!(
            "当前最佳指标 ({}) 值: {}\n",
            loop_config.success_metric, best
        ));
    }
    prompt.push_str(&format!(
        "目标阈值: {} ({})\n",
        loop_config.success_threshold, loop_config.success_direction
    ));
    prompt.push_str(&format!(
        "评估命令: `{}`\n",
        loop_config.eval_command
    ));
    if !loop_config.result_paths.is_empty() {
        prompt.push_str(&format!(
            "结果路径: {}\n",
            loop_config.result_paths.join(", ")
        ));
    }
    prompt.push_str("\n代码已自动同步到服务器。你的任务：\n");
    prompt.push_str("1. 分析当前代码和之前的实验结果，提出改进方案\n");
    prompt.push_str("2. 修改代码实现改进\n");
    prompt.push_str("3. 使用 `compute-helper sync up` 同步修改后的代码\n");
    prompt.push_str("4. 使用 `compute-helper run` 执行评估命令\n");
    if !loop_config.result_paths.is_empty() {
        prompt.push_str("5. 使用 `compute-helper sync down` 拉回结果文件\n");
    }
    prompt.push_str(&format!(
        "\n重要: 评估命令输出中必须包含一行 JSON: `{{\"{}\": 0.95}}`。\n",
        loop_config.success_metric
    ));

    Ok(PreIterationResult {
        should_continue: true,
        iteration: iter_num,
        max_iterations: loop_config.max_iterations,
        prompt,
        status: "running".into(),
        paused: false,
        sync_output,
    })
}

// ─── Post-iteration ────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PostIterationPayload {
    pub agent_output: String,
    pub loop_config: ExperimentLoopConfig,
    pub task_id: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PostIterationResult {
    pub should_continue: bool,
    pub status: String,
    pub metric_value: Option<f64>,
    pub best_metric_value: Option<f64>,
    pub iteration: u32,
    pub goal_met: bool,
}

/// Called by frontend after agent completes an iteration.
/// - Parses metric from agent output
/// - Updates run-state.json
/// - Returns whether to continue
pub fn experiment_post_iteration(
    app_handle: &AppHandle,
    payload: PostIterationPayload,
) -> Result<PostIterationResult, String> {
    let state = app_handle.state::<AppState>();
    let root_path = {
        let config = state.project_config.read().unwrap();
        config.root_path.clone()
    };

    // ── Check stop flag ──
    if EXPERIMENT_STOP_FLAG.load(Ordering::SeqCst) {
        update_run_state_status(&root_path, "stopped");
        return Ok(PostIterationResult {
            should_continue: false,
            status: "stopped".into(),
            metric_value: None,
            best_metric_value: None,
            iteration: 0,
            goal_met: false,
        });
    }

    let mut run_state = load_run_state(&root_path);
    run_state.iterations += 1;
    let iter_num = run_state.iterations;

    // Parse metric
    let parsed_val = parse_metric_from_output(
        &payload.agent_output,
        &payload.loop_config.success_metric,
    );

    let mut goal_met = false;

    match parsed_val {
        Some(val) => {
            run_state.current_failures = 0;
            let is_better = match (
                run_state.best_metric_value,
                payload.loop_config.success_direction.as_str(),
            ) {
                (None, _) => true,
                (Some(best), "max") => val > best,
                (Some(best), "min") => val < best,
                (Some(_), _) => true,
            };
            if is_better {
                run_state.best_metric_value = Some(val);
            }

            run_state.run_history.push(serde_json::json!({
                "iteration": iter_num,
                "metricValue": val,
                "status": "success"
            }));

            goal_met = if payload.loop_config.success_direction == "max" {
                val >= payload.loop_config.success_threshold
            } else {
                val <= payload.loop_config.success_threshold
            };

            if goal_met {
                run_state.status = "completed".into();
                mark_experiment_task_done(&root_path, &payload.task_id);
            }
        }
        None => {
            run_state.current_failures += 1;
            run_state.run_history.push(serde_json::json!({
                "iteration": iter_num,
                "metricValue": null,
                "status": "parse_error"
            }));
        }
    }

    // Check if should continue
    let should_continue = run_state.status == "running"
        && run_state.iterations < payload.loop_config.max_iterations
        && (run_state.current_failures < payload.loop_config.max_failures
            || payload.loop_config.max_failures == 0);

    if !should_continue && run_state.status == "running" {
        if run_state.iterations >= payload.loop_config.max_iterations {
            run_state.status = "stopped".into();
        } else if run_state.current_failures >= payload.loop_config.max_failures
            && payload.loop_config.max_failures > 0
        {
            run_state.status = "failed".into();
        }
    }

    save_run_state(&root_path, &run_state);

    Ok(PostIterationResult {
        should_continue,
        status: run_state.status,
        metric_value: parsed_val,
        best_metric_value: run_state.best_metric_value,
        iteration: iter_num,
        goal_met,
    })
}

// ─── Control functions ─────────────────────────────────────────

pub fn stop_auto_experiment() {
    EXPERIMENT_STOP_FLAG.store(true, Ordering::SeqCst);
    // Release the running guard so a new experiment can start
    EXPERIMENT_RUNNING.store(false, Ordering::SeqCst);
    if let Ok(mut lock) = EXPERIMENT_ROOT_PATH.lock() {
        lock.clear();
    }
}

pub fn pause_auto_experiment() {
    EXPERIMENT_PAUSE_FLAG.store(true, Ordering::SeqCst);
}

pub fn resume_auto_experiment() {
    EXPERIMENT_PAUSE_FLAG.store(false, Ordering::SeqCst);
}

/// Called by frontend when experiment loop finishes (naturally or via stop).
/// Ensures the running guard is properly released.
pub fn finish_experiment_loop() {
    EXPERIMENT_RUNNING.store(false, Ordering::SeqCst);
    EXPERIMENT_STOP_FLAG.store(false, Ordering::SeqCst);
    EXPERIMENT_PAUSE_FLAG.store(false, Ordering::SeqCst);
    if let Ok(mut lock) = EXPERIMENT_ROOT_PATH.lock() {
        lock.clear();
    }
}

// ─── Internal helpers ──────────────────────────────────────────

fn run_state_path(root_path: &str) -> std::path::PathBuf {
    Path::new(root_path).join(".viewerleaf/research/Experiment/automation/run-state.json")
}

fn load_run_state(root_path: &str) -> ExperimentRunState {
    let path = run_state_path(root_path);
    serde_json::from_str(&fs::read_to_string(&path).unwrap_or_default()).unwrap_or_default()
}

fn save_run_state(root_path: &str, run_state: &ExperimentRunState) {
    let path = run_state_path(root_path);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, serde_json::to_string_pretty(run_state).unwrap());
}

fn update_run_state_status(root_path: &str, status: &str) {
    let mut run_state = load_run_state(root_path);
    run_state.status = status.to_string();
    save_run_state(root_path, &run_state);
}

/// Force sync local code to remote server via compute-helper CLI.
fn force_sync_up(state: &AppState, root_path: &str) -> String {
    let helper_path = {
        let sidecar_dir = state.sidecar_dir.to_string_lossy().to_string();
        if sidecar_dir.is_empty() {
            "compute-helper.mjs".to_string()
        } else {
            format!("{}/bin/compute-helper.mjs", sidecar_dir)
        }
    };

    // Resolve node executable
    let node_path = which_node().unwrap_or_else(|| "node".to_string());

    match Command::new(&node_path)
        .args([&helper_path, "sync", "up", "--cwd", root_path])
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if output.status.success() {
                format!("Sync OK: {}", stdout.trim())
            } else {
                format!("Sync FAILED: {} {}", stdout.trim(), stderr.trim())
            }
        }
        Err(err) => format!("Sync ERROR: {}", err),
    }
}

fn which_node() -> Option<String> {
    Command::new("which")
        .arg("node")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Parse a metric value from agent output text.
/// Scans each line for a JSON object containing the given metric key.
/// Falls back to substring extraction if the metric JSON is embedded in non-JSON text.
fn parse_metric_from_output(output: &str, metric_key: &str) -> Option<f64> {
    let needle = format!("\"{}\"", metric_key);
    for line in output.lines().rev() {
        let trimmed = line.trim();
        // Strategy 1: entire line is a JSON object containing the metric key
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(v) = json.get(metric_key).and_then(|val| val.as_f64()) {
                return Some(v);
            }
        }
        // Strategy 2: metric JSON is embedded in a larger string
        if let Some(pos) = trimmed.find(&needle) {
            if let Some(start) = trimmed[..pos].rfind('{') {
                let candidate = &trimmed[start..];
                if let Some(end) = candidate.find('}') {
                    let snippet = &candidate[..=end];
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(snippet) {
                        if let Some(v) = json.get(metric_key).and_then(|val| val.as_f64()) {
                            return Some(v);
                        }
                    }
                }
            }
        }
    }
    None
}

/// Mark the specific experiment task as done in tasks.json.
fn mark_experiment_task_done(root_path: &str, task_id: &str) {
    let tasks_path = Path::new(root_path).join(".pipeline/tasks/tasks.json");
    if !tasks_path.exists() {
        return;
    }

    let raw = match fs::read_to_string(&tasks_path) {
        Ok(r) => r,
        Err(_) => return,
    };

    let mut doc: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };

    if let Some(tasks) = doc.get_mut("tasks").and_then(|t| t.as_array_mut()) {
        for task in tasks.iter_mut() {
            let id = task.get("id").and_then(|s| s.as_str()).unwrap_or("");
            if id == task_id {
                task.as_object_mut().map(|obj| {
                    obj.insert("status".into(), serde_json::Value::String("done".into()));
                });
                break;
            }
        }
    }

    let _ = fs::write(
        &tasks_path,
        serde_json::to_string_pretty(&doc).unwrap_or_default(),
    );
}
