import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { desktop } from "../lib/desktop";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { 
  ExperimentRunState, 
  ExperimentRunStateStatus,
  ExperimentLoopConfig,
  AgentTaskContext, 
  WorkspaceSnapshot,
  StreamChunk,
} from "../types";

export interface UseAutoExperimentParams {
  projectRoot?: string;
  activeTaskContext?: AgentTaskContext | null;
  snapshot: WorkspaceSnapshot | null;
  profileId: string;
  sessionId: string;
  filePath: string;
}

export interface ExperimentLogEntry {
  timestamp: string;
  level: string;
  message: string;
  iteration: number;
}

interface PreIterationResult {
  shouldContinue: boolean;
  iteration: number;
  maxIterations: number;
  prompt: string;
  status: string;
  paused: boolean;
  syncOutput: string;
}

interface PostIterationResult {
  shouldContinue: boolean;
  status: string;
  metricValue: number | null;
  bestMetricValue: number | null;
  iteration: number;
  goalMet: boolean;
}

export function useAutoExperiment({
  projectRoot,
  activeTaskContext,
  snapshot: _snapshot,
  profileId,
  sessionId,
  filePath,
}: UseAutoExperimentParams) {
  const [runState, setRunState] = useState<ExperimentRunState | null>(null);
  const [experimentLogs, setExperimentLogs] = useState<ExperimentLogEntry[]>([]);
  // Ref to control the frontend-driven experiment loop
  const loopRunningRef = useRef(false);
  const loopConfigRef = useRef<ExperimentLoopConfig | null>(null);

  // Auto-resolve: if no explicit experiment task is active, pick the first
  // non-done experiment-stage task from the snapshot so the user can start
  // the auto-experiment directly from the stage view.
  const resolvedTaskContext = useMemo<AgentTaskContext | null>(() => {
    if (activeTaskContext?.stage === "experiment") return activeTaskContext;
    const tasks = _snapshot?.research?.tasks;
    if (!tasks) return null;
    const fallback = tasks.find(
      (t) => t.stage === "experiment" && t.status !== "done" && t.status !== "cancelled",
    );
    if (!fallback) return null;
    return {
      taskId: fallback.id,
      title: fallback.title,
      stage: fallback.stage,
      description: fallback.description,
      nextActionPrompt: fallback.nextActionPrompt,
      taskPrompt: fallback.taskPrompt,
      contextNotes: fallback.contextNotes,
      suggestedSkills: fallback.suggestedSkills,
      inputsNeeded: fallback.inputsNeeded,
      artifactPaths: fallback.artifactPaths,
    };
  }, [activeTaskContext, _snapshot?.research?.tasks]);

  const isExperimentTask = Boolean(resolvedTaskContext);
  const stateFilePath = projectRoot ? `${projectRoot}/.viewerleaf/research/Experiment/automation/run-state.json` : "";

  const loadState = useCallback(async () => {
    if (!stateFilePath || !isExperimentTask) {
       setRunState(null);
       return;
    }
    try {
      const content = await desktop.readFile(stateFilePath);
      if (content && content.content) {
        const loaded = JSON.parse(content.content) as ExperimentRunState;

        // Detect orphaned running/paused states (daemon died from app restart / crash)
        if (loaded.status === "running" || loaded.status === "paused") {
          // If our frontend loop is running, the state is valid
          if (!loopRunningRef.current) {
            try {
              const alive: boolean = await invoke("is_experiment_running");
              if (!alive) {
                loaded.status = "interrupted" as ExperimentRunStateStatus;
              }
            } catch {
              loaded.status = "interrupted" as ExperimentRunStateStatus;
            }
          }
        }

        setRunState(loaded);
      }
    } catch {
      setRunState(null);
    }
  }, [stateFilePath, isExperimentTask]);

  useEffect(() => {
    void loadState();
    const interval = setInterval(() => void loadState(), 2000);
    return () => clearInterval(interval);
  }, [loadState]);

  // Listen for experiment:log events from the backend
  useEffect(() => {
    let cancelled = false;
    const promise = listen<ExperimentLogEntry>("experiment:log", (event) => {
      if (!cancelled) {
        setExperimentLogs((prev) => [...prev.slice(-199), event.payload]);
      }
    });
    return () => {
      cancelled = true;
      promise.then((fn) => fn());
    };
  }, []);

  const clearLogs = useCallback(() => setExperimentLogs([]), []);

  /** Helper: add a log entry locally */
  const addLog = useCallback((level: string, message: string, iteration: number) => {
    setExperimentLogs((prev) => [...prev.slice(-199), {
      timestamp: String(Date.now()),
      level,
      message,
      iteration,
    }]);
  }, []);

  /**
   * Wait for the current agent run to complete by listening for the "done" 
   * stream event. Also collects the full agent output text.
   */
  const waitForAgentDone = (): Promise<string> => {
    return new Promise((resolve) => {
      let fullOutput = "";
      let unlisten: (() => void) | null = null;
      
      const promise = desktop.onAgentStream((chunk: StreamChunk) => {
        if (chunk.type === "text_delta") {
          fullOutput += (chunk as { content?: string }).content ?? "";
        }
        if (chunk.type === "tool_call_result") {
          fullOutput += "\n" + ((chunk as { output?: string }).output ?? "") + "\n";
        }
        if (chunk.type === "done" || chunk.type === "error") {
          if (unlisten) unlisten();
          resolve(fullOutput);
        }
      });

      promise.then((fn) => {
        unlisten = fn;
      });
    });
  };

  /**
   * Frontend-driven experiment loop.
   * Uses the user's active chat session so everything is visible in the chat panel.
   */
  const runExperimentLoop = async (config: ExperimentLoopConfig) => {
    loopRunningRef.current = true;
    loopConfigRef.current = config;

    const taskId = resolvedTaskContext?.taskId ?? "";

    addLog("info", `🧪 自动实验已启动 (最多 ${config.maxIterations} 轮, 指标: ${config.successMetric} ${config.successDirection} ${config.successThreshold})`, 0);

    try {
      while (loopRunningRef.current) {
        // ── Pre-iteration: check limits, force sync, get prompt ──
        const pre: PreIterationResult = await invoke("experiment_pre_iteration", {
          loopConfig: config,
        });

        // Handle pause: poll until unpaused or stopped
        if (pre.paused) {
          addLog("warn", "⏸ 实验已暂停，等待恢复...", pre.iteration);
          while (loopRunningRef.current) {
            await new Promise((r) => setTimeout(r, 2000));
            const check: PreIterationResult = await invoke("experiment_pre_iteration", { loopConfig: config });
            if (!check.paused) {
              if (!check.shouldContinue) {
                addLog("info", `⏹ 实验结束: ${check.status}`, check.iteration);
                loopRunningRef.current = false;
                return;
              }
              // Unpaused — continue with this check result
              addLog("info", "▶️ 实验已恢复", check.iteration);
              break;
            }
            if (check.status === "stopped") {
              addLog("warn", "⏹ 实验已停止", check.iteration);
              loopRunningRef.current = false;
              return;
            }
          }
          continue; // re-enter loop to get fresh pre-iteration
        }

        if (!pre.shouldContinue) {
          addLog("info", `⏹ 实验结束: ${pre.status}`, pre.iteration);
          break;
        }

        addLog("info", `🚀 开始迭代 ${pre.iteration}/${pre.maxIterations}`, pre.iteration);

        if (pre.syncOutput) {
          addLog("info", `📤 代码同步: ${pre.syncOutput.slice(0, 200)}`, pre.iteration);
        }

        // ── Call agent through the shared chat session ──
        addLog("info", "🤖 调用 AI agent...", pre.iteration);

        // Set up listener BEFORE calling runAgent to avoid race
        const donePromise = waitForAgentDone();

        // Use the existing desktop.runAgent — this sends to the SAME chat session
        // the user is viewing, so all output appears in the chat panel
        await desktop.runAgent(
          profileId,
          filePath,
          "",
          pre.prompt,
          sessionId,
          true,
          resolvedTaskContext,
        );

        // Wait for agent to complete
        const agentOutput = await donePromise;

        addLog("info", "✅ Agent 完成", pre.iteration);

        // Check if we were stopped while agent was running
        if (!loopRunningRef.current) {
          addLog("warn", "⏹ 实验在 agent 运行期间被停止", pre.iteration);
          break;
        }

        // ── Post-iteration: parse metric, update state ──
        const post: PostIterationResult = await invoke("experiment_post_iteration", {
          payload: {
            agentOutput,
            loopConfig: config,
            taskId,
          },
        });

        if (post.metricValue != null) {
          addLog("info", `📈 ${config.successMetric}=${post.metricValue.toFixed(4)} (最优=${post.bestMetricValue?.toFixed(4) ?? "—"}, 阈值=${config.successThreshold})`, post.iteration);
        } else {
          addLog("warn", `⚠️ 未能从 agent 输出中解析指标 '${config.successMetric}'`, post.iteration);
        }

        if (post.goalMet) {
          addLog("info", `🎯 目标达成! ${config.successMetric}=${post.metricValue?.toFixed(4)}`, post.iteration);
        }

        if (!post.shouldContinue) {
          addLog("info", `⏹ 实验结束: ${post.status}`, post.iteration);
          break;
        }

        // Brief pause between iterations
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      addLog("error", `❌ 实验出错: ${err}`, 0);
    } finally {
      loopRunningRef.current = false;
      loopConfigRef.current = null;
      // Tell backend to release the running guard
      try {
        await invoke("finish_experiment_loop");
      } catch { /* best-effort */ }
      void loadState();
    }
  };

  const startExperiment = async (config: ExperimentLoopConfig) => {
    if (!resolvedTaskContext) {
      console.warn("No experiment-stage task found – cannot start auto experiment");
      return;
    }

    // Guard: don't start if an experiment is actively running
    if (loopRunningRef.current) {
      console.warn("An experiment is already running in this frontend, ignoring start request");
      return;
    }
    if (runState && ["running", "paused"].includes(runState.status)) {
      console.warn("An experiment is already active, ignoring start request");
      return;
    }

    // Initialize backend state
    try {
      await invoke("start_experiment_loop", {
        payload: {
          sessionId: runState?.sessionId || sessionId,
          loopConfig: config,
          taskId: resolvedTaskContext.taskId,
        },
      });
    } catch (err) {
      console.error("start_experiment_loop failed:", err);
      return;
    }

    // Clear logs from previous run
    setExperimentLogs([]);

    // Optimistically update UI
    setRunState({
      status: "running",
      iterations: 0,
      runHistory: [],
      currentFailures: 0,
      maxFailures: config.maxFailures,
      startTimeMs: Date.now(),
      sessionId: sessionId || undefined,
    });

    // Start the frontend-driven loop (fire and forget — runs async)
    void runExperimentLoop(config);
  };

  const pauseExperiment = async () => {
    try {
      await invoke("pause_auto_experiment");
    } catch (err) {
      console.error("pause_auto_experiment failed:", err);
    }
  };

  const resumeExperiment = async () => {
    // First, tell the backend to unpause
    try {
      await invoke("resume_auto_experiment");
    } catch (err) {
      console.error("resume_auto_experiment failed:", err);
    }

    // If the frontend loop is dead (app restart), restart it
    if (!loopRunningRef.current) {
      const config = _snapshot?.research?.experimentLoop;
      if (config && resolvedTaskContext) {
        void runExperimentLoop(config);
      }
    }
  };

  const stopExperiment = async () => {
    loopRunningRef.current = false;
    try {
      await invoke("stop_auto_experiment");
    } catch (err) {
      console.error("stop_auto_experiment failed:", err);
    }
  };

  return {
    runState,
    experimentLogs,
    clearLogs,
    startExperiment,
    pauseExperiment,
    resumeExperiment,
    stopExperiment
  };
}
