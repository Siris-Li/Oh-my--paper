import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";

import { EditorPane } from "./components/EditorPane";
import { PdfPane } from "./components/PdfPane";
import { ProjectTree } from "./components/ProjectTree";
import { Sidebar } from "./components/Sidebar";
import { desktop } from "./lib/desktop";
import type {
  AgentMessage,
  AgentProfileId,
  DrawerTab,
  FigureBriefDraft,
  GeneratedAsset,
  ProjectFile,
  WorkspaceSnapshot,
} from "./types";

function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [highlightedPage, setHighlightedPage] = useState(1);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("explorer");
  const [cursorLine, setCursorLine] = useState(1);
  const [selectedText, setSelectedText] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<AgentProfileId>("outline");
  const [pendingPatch, setPendingPatch] = useState<{ filePath: string; content: string; summary: string } | null>(null);
  const [selectedBrief, setSelectedBrief] = useState<FigureBriefDraft | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<GeneratedAsset | null>(null);

  const activeFile = useMemo<ProjectFile | null>(() => {
    if (!snapshot) {
      return null;
    }
    return snapshot.files.find((file) => file.path === activeFilePath) ?? snapshot.files[0] ?? null;
  }, [activeFilePath, snapshot]);

  const activeProfile = useMemo(
    () => snapshot?.profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, snapshot?.profiles],
  );

  const deferredActiveFile = useDeferredValue(activeFile);

  useEffect(() => {
    void (async () => {
      try {
        const nextSnapshot = await desktop.openProject();
        const nextMessages = await desktop.getAgentMessages();
        setSnapshot(nextSnapshot);
        setOpenTabs([nextSnapshot.activeFile, nextSnapshot.projectConfig.mainTex]);
        setActiveFilePath(nextSnapshot.activeFile);
        setMessages(nextMessages);

        if (nextSnapshot.projectConfig.autoCompile && nextSnapshot.compileResult.status === "idle") {
          const compileResult = await desktop.compileProject(nextSnapshot.activeFile);
          setSnapshot((current) =>
            current
              ? {
                ...current,
                compileResult,
              }
              : current,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setBootstrapError(message);
      }
    })();
  }, []);

  const runForwardSync = useEffectEvent(async (filePath: string, line: number) => {
    if (!snapshot?.projectConfig.forwardSync || snapshot.compileResult.status !== "success") {
      return;
    }
    try {
      const location = await desktop.forwardSearch(filePath, line);
      setHighlightedPage(location.page);
    } catch (error) {
      console.warn("forward sync failed", error);
    }
  });

  useEffect(() => {
    if (!deferredActiveFile) {
      return;
    }
    const timer = window.setTimeout(() => {
      void runForwardSync(deferredActiveFile.path, cursorLine);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [cursorLine, deferredActiveFile, snapshot?.compileResult.status]);

  async function saveAndCompile(filePath: string, content: string) {
    await desktop.saveFile(filePath, content);
    if (!snapshot?.projectConfig.autoCompile) {
      return;
    }
    setSnapshot((current) =>
      current
        ? {
          ...current,
          compileResult: {
            ...current.compileResult,
            status: "running",
            logOutput: "Compile queued…",
            diagnostics: current.compileResult.diagnostics,
            logPath: current.compileResult.logPath,
            timestamp: new Date().toISOString(),
          },
        }
        : current,
    );

    const compileResult = await desktop.compileProject(filePath);
    setSnapshot((current) =>
      current
        ? {
          ...current,
          compileResult,
        }
        : current,
    );
  }

  function replaceFileContent(filePath: string, content: string) {
    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        files: current.files.map((file) => (file.path === filePath ? { ...file, content } : file)),
      };
    });
  }

  function handleFileChange(content: string) {
    if (!activeFile) {
      return;
    }
    replaceFileContent(activeFile.path, content);
    void saveAndCompile(activeFile.path, content);
  }

  function handleOpenFile(path: string) {
    startTransition(() => {
      setActiveFilePath(path);
      setOpenTabs((current) => (current.includes(path) ? current : [...current, path]));
    });
  }

  async function handleRunAgent() {
    if (!activeFile) {
      return;
    }
    const result = await desktop.runAgent(activeProfileId, activeFile.path, selectedText);
    const nextMessages = await desktop.getAgentMessages();
    setMessages(nextMessages);
    setPendingPatch(result.suggestedPatch ?? null);
  }

  async function handleApplyPatch() {
    if (!pendingPatch) {
      return;
    }
    await desktop.applyAgentPatch(pendingPatch.filePath, pendingPatch.content);
    replaceFileContent(pendingPatch.filePath, pendingPatch.content);
    setPendingPatch(null);
  }

  async function handleCreateBrief() {
    if (!activeFile) {
      return;
    }
    const brief = await desktop.createFigureBrief(activeFile.path, selectedText);
    setSnapshot((current) =>
      current
        ? {
          ...current,
          figureBriefs: [brief, ...current.figureBriefs.filter((item) => item.id !== brief.id)],
        }
        : current,
    );
    setSelectedBrief(brief);
    setDrawerTab("figures");
  }

  async function handleRunFigureSkill() {
    if (!selectedBrief) {
      return;
    }
    const updated = await desktop.runFigureSkill(selectedBrief.id);
    setSelectedBrief(updated);
    setSnapshot((current) =>
      current
        ? {
          ...current,
          figureBriefs: current.figureBriefs.map((item) => (item.id === updated.id ? updated : item)),
        }
        : current,
    );
  }

  async function handleGenerateFigure() {
    if (!selectedBrief) {
      return;
    }
    const asset = await desktop.runBananaGeneration(selectedBrief.id);
    await desktop.registerGeneratedAsset(asset);
    setSelectedAsset(asset);
    setSnapshot((current) =>
      current
        ? {
          ...current,
          assets: [asset, ...current.assets.filter((item) => item.id !== asset.id)],
        }
        : current,
    );
  }

  async function handleInsertFigure() {
    if (!activeFile || !selectedAsset) {
      return;
    }
    const result = await desktop.insertFigureSnippet(
      activeFile.path,
      selectedAsset.id,
      "Workflow overview of ViewerLeaf.",
      cursorLine + 1,
    );
    replaceFileContent(result.filePath, result.content);
  }

  async function handlePageJump(page: number) {
    if (snapshot?.compileResult.status !== "success") {
      return;
    }
    setHighlightedPage(page);
    try {
      const location = await desktop.reverseSearch(page);
      handleOpenFile(location.filePath);
      setCursorLine(location.line);
    } catch (error) {
      console.warn("reverse sync failed", error);
    }
  }

  if (bootstrapError) {
    return <div className="app-shell loading-shell">ViewerLeaf failed to start: {bootstrapError}</div>;
  }

  if (!snapshot || !deferredActiveFile) {
    return <div className="app-shell loading-shell">正在启动 ViewerLeaf…</div>;
  }

  return (
    <div className="app-shell fade-in">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand-title">ViewerLeaf 工作台</span>
        </div>
        <div className="topbar-center">
          <span className="topbar-metric">排版引擎 <strong>{snapshot.projectConfig.engine}</strong></span>
          <span className="topbar-metric">
            编译状态
            <strong>
              {snapshot.compileResult.status === "success" ? "成功" :
                snapshot.compileResult.status === "failed" ? "失败" :
                  snapshot.compileResult.status === "running" ? "正在编译" : "空闲"}
            </strong>
          </span>
        </div>
        <div className="topbar-right">
          <span className="topbar-metric">诊断结果 <strong>{snapshot.compileResult.diagnostics.length} 项</strong></span>
          <button className="btn-primary hover-spring" onClick={handleRunAgent} type="button">
            执行 {activeProfile?.label ?? "当前配置"}
          </button>
        </div>
      </header>

      <div className="workspace-container">
        <div className="activity-bar">
          <button
            className={`activity-icon hover-spring ${drawerTab === "explorer" ? "is-active" : ""}`}
            onClick={() => setDrawerTab("explorer")}
            title="项目资源 (Explorer)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          </button>
          <button
            className={`activity-icon hover-spring ${drawerTab === "ai" ? "is-active" : ""}`}
            onClick={() => setDrawerTab("ai")}
            title="AI 智能体助手"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>
          </button>
          <button
            className={`activity-icon hover-spring ${drawerTab === "figures" ? "is-active" : ""}`}
            onClick={() => setDrawerTab("figures")}
            title="图表工作区 (Figures)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          </button>
          <button
            className={`activity-icon hover-spring ${drawerTab === "skills" ? "is-active" : ""}`}
            onClick={() => setDrawerTab("skills")}
            title="应用与技能 (App Store)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </button>
          <button
            className={`activity-icon hover-spring ${drawerTab === "providers" ? "is-active" : ""}`}
            onClick={() => setDrawerTab("providers")}
            title="API 配置区 (Providers)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>

          <div style={{ flex: 1 }}></div>

          <button
            className={`activity-icon hover-spring ${drawerTab === "logs" ? "is-active" : ""}`}
            onClick={() => setDrawerTab("logs")}
            title="编译日志"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            {snapshot.compileResult.diagnostics.length > 0 && <span style={{ position: "absolute", top: 2, right: 2, width: 8, height: 8, borderRadius: "50%", background: "var(--danger)" }}></span>}
          </button>
        </div>

        <Sidebar
          tab={drawerTab}
          messages={messages}
          profiles={snapshot.profiles}
          activeProfileId={activeProfileId}
          onSelectProfile={(profileId) => setActiveProfileId(profileId as AgentProfileId)}
          onRunAgent={handleRunAgent}
          pendingPatchSummary={pendingPatch?.summary}
          onApplyPatch={handleApplyPatch}
          compileLog={snapshot.compileResult.logOutput}
          diagnosticsCount={snapshot.compileResult.diagnostics.length}
          briefs={snapshot.figureBriefs}
          assets={snapshot.assets}
          selectedBriefId={selectedBrief?.id}
          selectedAssetId={selectedAsset?.id}
          onCreateBrief={handleCreateBrief}
          onRunFigureSkill={handleRunFigureSkill}
          onGenerateFigure={handleGenerateFigure}
          onInsertFigure={handleInsertFigure}
          onSelectBrief={(briefId) => setSelectedBrief(snapshot.figureBriefs.find(b => b.id === briefId) ?? null)}
          onSelectAsset={(assetId) => setSelectedAsset(snapshot.assets.find(a => a.id === assetId) ?? null)}
          skills={snapshot.skills}
          providers={snapshot.providers}
          explorerNode={
            <ProjectTree nodes={snapshot.tree} activeFile={activeFilePath} onOpenFile={handleOpenFile} />
          }
        />

        <div className="editor-area">
          <div className="editor-tabs">
            {openTabs.map((tab) => (
              <button
                key={tab}
                className={`editor-tab ${tab === activeFilePath ? "is-active" : ""}`}
                onClick={() => handleOpenFile(tab)}
                type="button"
              >
                <span style={{ marginRight: 8 }}>{tab.split("/").at(-1)}</span>
                <span className="icon-btn" style={{ width: 16, height: 16 }} onClick={(e) => {
                  e.stopPropagation();
                  setOpenTabs(current => current.filter(t => t !== tab));
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </span>
              </button>
            ))}
          </div>
          <div className="editor-content">
            <EditorPane
              file={deferredActiveFile}
              openTabs={openTabs}
              onChange={handleFileChange}
              onCursorChange={(line, selection) => {
                setCursorLine(line);
                setSelectedText(selection);
              }}
              onSelectTab={handleOpenFile}
            />
          </div>
        </div>

        <div className="preview-area">
          <PdfPane compileResult={snapshot.compileResult} highlightedPage={highlightedPage} onPageJump={handlePageJump} />
        </div>
      </div>
    </div>
  );
}

export default App;
