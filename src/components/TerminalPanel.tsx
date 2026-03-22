import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

import { desktop } from "../lib/desktop";
import type { TerminalEvent, TerminalSessionInfo } from "../types";

interface TerminalPanelProps {
  workspaceRoot: string;
  isVisible: boolean;
  height: number;
  commandRequest?: { id: number; command: string } | null;
  onHide: () => void;
}

function safelyDisposeListener(listener?: (() => void | Promise<void>) | null) {
  if (!listener) {
    return;
  }

  try {
    const result = listener();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      void (result as Promise<unknown>).catch((error) => {
        console.warn("failed to dispose terminal listener", error);
      });
    }
  } catch (error) {
    console.warn("failed to dispose terminal listener", error);
  }
}

export function TerminalPanel({ workspaceRoot, isVisible, height, commandRequest, onHide }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef("");
  const isSessionStartingRef = useRef(false);
  const lastCommandRequestIdRef = useRef(0);
  const commandQueueRef = useRef<string[]>([]);
  const pendingEventsRef = useRef<Map<string, TerminalEvent[]>>(new Map());
  const workspaceRootRef = useRef(workspaceRoot);
  const [sessionInfo, setSessionInfo] = useState<TerminalSessionInfo | null>(null);
  const [statusText, setStatusText] = useState("");
  const [isListenerReady, setIsListenerReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const isDesktop = desktop.isTauriRuntime();

  const fitTerminal = () => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon) {
      return;
    }

    try {
      fitAddon.fit();
    } catch (error) {
      console.warn("failed to fit terminal", error);
    }
  };

  const resetTerminal = (message = "") => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.reset();
    if (message) {
      terminal.writeln(message);
    }
  };

  const flushCommandQueue = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || commandQueueRef.current.length === 0) {
      return;
    }

    const commands = commandQueueRef.current.splice(0, commandQueueRef.current.length);
    for (const command of commands) {
      const payload = command.endsWith("\n") ? command : `${command}\n`;
      void desktop.terminalWrite(sessionId, payload);
    }
  };

  const closeSession = async () => {
    const sessionId = sessionIdRef.current;
    isSessionStartingRef.current = false;
    setIsStarting(false);
    if (!sessionId) {
      return;
    }

    sessionIdRef.current = "";
    pendingEventsRef.current.delete(sessionId);
    setSessionInfo(null);

    try {
      await desktop.closeTerminal(sessionId);
    } catch (error) {
      console.warn("failed to close terminal", error);
    }
  };

  const startSession = async () => {
    if (
      !isDesktop ||
      !isListenerReady ||
      !workspaceRoot.trim() ||
      sessionIdRef.current ||
      isSessionStartingRef.current ||
      !terminalRef.current
    ) {
      return;
    }

    isSessionStartingRef.current = true;
    fitTerminal();
    setIsStarting(true);
    setStatusText("正在启动终端…");

    try {
      const terminal = terminalRef.current;
      const info = await desktop.startTerminal(
        workspaceRoot,
        Math.max(terminal.cols, 24),
        Math.max(terminal.rows, 8),
      );
      sessionIdRef.current = info.sessionId;
      setSessionInfo(info);
      setStatusText(`${info.shell} · ${info.cwd}`);
      setIsStarting(false);
      isSessionStartingRef.current = false;
      const pendingEvents = pendingEventsRef.current.get(info.sessionId) ?? [];
      pendingEventsRef.current.delete(info.sessionId);
      for (const event of pendingEvents) {
        handleTerminalEvent(event);
      }
      terminal.focus();
      flushCommandQueue();
    } catch (error) {
      isSessionStartingRef.current = false;
      setIsStarting(false);
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(message);
      resetTerminal(`[终端启动失败] ${message}`);
    }
  };

  const handleTerminalEvent = (event: TerminalEvent) => {
    if (!sessionIdRef.current) {
      const buffered = pendingEventsRef.current.get(event.sessionId) ?? [];
      pendingEventsRef.current.set(event.sessionId, [...buffered, event].slice(-24));
      return;
    }

    if (event.sessionId !== sessionIdRef.current) {
      return;
    }

    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (event.type === "output") {
      setIsStarting(false);
      terminal.write(event.data);
      return;
    }

    if (event.type === "exit") {
      setIsStarting(false);
      isSessionStartingRef.current = false;
      sessionIdRef.current = "";
      pendingEventsRef.current.delete(event.sessionId);
      setSessionInfo(null);
      const suffix = event.signal
        ? `signal ${event.signal}`
        : typeof event.exitCode === "number"
          ? `code ${event.exitCode}`
          : "shell closed";
      setStatusText(`终端已退出 · ${suffix}`);
      terminal.writeln(`\r\n[终端已退出 · ${suffix}]`);
      return;
    }

    setIsStarting(false);
    isSessionStartingRef.current = false;
    setStatusText(event.message);
    terminal.writeln(`\r\n[终端错误] ${event.message}`);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      cursorWidth: 1,
      fontFamily:
        '"SF Mono", "Monaco", "Cascadia Code", "Menlo", "Consolas", monospace',
      fontSize: 12.5,
      lineHeight: 1.32,
      scrollback: 4000,
      theme: {
        background: "#ffffff",
        foreground: "#111827",
        cursor: "#111827",
        cursorAccent: "#ffffff",
        selectionBackground: "rgba(37, 99, 235, 0.14)",
        black: "#111827",
        red: "#b42318",
        green: "#067647",
        yellow: "#a15c07",
        blue: "#175cd3",
        magenta: "#7a22ce",
        cyan: "#0e7490",
        white: "#d1d5db",
        brightBlack: "#4b5563",
        brightRed: "#d92d20",
        brightGreen: "#039855",
        brightYellow: "#b54708",
        brightBlue: "#1d4ed8",
        brightMagenta: "#9333ea",
        brightCyan: "#0891b2",
        brightWhite: "#f9fafb",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const inputDisposable = terminal.onData((data) => {
      if (!sessionIdRef.current) {
        return;
      }
      void desktop.terminalWrite(sessionIdRef.current, data);
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (!sessionIdRef.current) {
        return;
      }
      void desktop.resizeTerminal(sessionIdRef.current, cols, rows);
    });

    let rafId = 0;
    const scheduleFit = () => {
      if (rafId) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        fitTerminal();
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleFit();
    });
    observer.observe(host);

    queueMicrotask(() => {
      scheduleFit();
    });

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      observer.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      void closeSession();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void | Promise<void>) | null = null;
    let cancelled = false;

    void desktop.onTerminalEvent(handleTerminalEvent).then((listener) => {
      if (cancelled) {
        safelyDisposeListener(listener);
        return;
      }
      unlisten = listener;
      setIsListenerReady(true);
    });

    return () => {
      cancelled = true;
      setIsListenerReady(false);
      safelyDisposeListener(unlisten);
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const timer = window.setTimeout(() => {
      fitTerminal();
      terminalRef.current?.focus();
      if (!sessionIdRef.current) {
        void startSession();
      } else {
        flushCommandQueue();
      }
    }, 40);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startSession reads latest state from refs/current render
  }, [height, isVisible, isListenerReady]);

  useEffect(() => {
    if (workspaceRootRef.current === workspaceRoot) {
      return;
    }

    workspaceRootRef.current = workspaceRoot;

    void (async () => {
      await closeSession();
      setSessionInfo(null);
      setIsStarting(false);
      setStatusText("");
      resetTerminal();
      if (isVisible) {
        await startSession();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startSession reads latest state from refs/current render
  }, [workspaceRoot, isVisible]);

  useEffect(() => {
    if (!commandRequest || commandRequest.id <= lastCommandRequestIdRef.current) {
      return;
    }

    lastCommandRequestIdRef.current = commandRequest.id;
    const command = commandRequest.command.trim();
    if (!command) {
      return;
    }

    commandQueueRef.current.push(command);

    if (!isVisible) {
      return;
    }

    terminalRef.current?.focus();
    if (sessionIdRef.current) {
      flushCommandQueue();
      return;
    }

    if (!isSessionStartingRef.current) {
      void startSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startSession reads latest refs/current render
  }, [commandRequest, isVisible]);

  const handleRestart = async () => {
    await closeSession();
    setIsStarting(false);
    setStatusText("");
    resetTerminal();
    if (isVisible) {
      await startSession();
    }
  };

  const handleClear = () => {
    terminalRef.current?.clear();
  };

  const showOverlay = isDesktop && isVisible && (!isListenerReady || isStarting);
  const shouldShowStartupOverlay = showOverlay && !sessionInfo;
  const overlayText = !isListenerReady
    ? "正在连接终端事件…"
    : statusText || sessionInfo?.cwd || workspaceRoot || "正在启动终端…";

  return (
    <div className="terminal-panel">
      <div className="terminal-panel-header">
        <div className="terminal-panel-tab">终端</div>
        <div className="terminal-panel-meta">
          {isDesktop
            ? statusText || sessionInfo?.cwd || workspaceRoot || "等待启动"
            : "内置终端仅支持桌面版"}
        </div>
        <div className="terminal-panel-actions">
          <button className="terminal-panel-btn" type="button" onClick={handleClear} disabled={!isDesktop}>
            清屏
          </button>
          <button className="terminal-panel-btn" type="button" onClick={() => void handleRestart()} disabled={!isDesktop}>
            重开
          </button>
          <button className="terminal-panel-btn" type="button" onClick={onHide}>
            隐藏
          </button>
        </div>
      </div>

      <div className="terminal-panel-body">
        {isDesktop ? (
          <>
            <div ref={hostRef} className="terminal-canvas" />
            {shouldShowStartupOverlay ? (
              <div className="terminal-panel-overlay" aria-hidden="true">
                <div className="terminal-panel-overlay-label">{overlayText}</div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="terminal-panel-empty">内置终端仅支持桌面版应用。</div>
        )}
      </div>
    </div>
  );
}
