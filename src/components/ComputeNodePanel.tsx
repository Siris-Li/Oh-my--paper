import { useState, useEffect } from "react";
import type { AppLocale } from "../types";
import { desktop } from "../lib/desktop";

export interface ComputeNodeConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: "key" | "password";
  keyPath: string;
  password: string;
  workDir: string;
}

interface ComputeNodePanelProps {
  locale: AppLocale;
}

function emptyNode(): ComputeNodeConfig {
  return {
    id: "",
    name: "",
    host: "",
    port: 22,
    user: "",
    authMethod: "key",
    keyPath: "~/.ssh/id_rsa",
    password: "",
    workDir: "~",
  };
}

export function ComputeNodePanel({ locale }: ComputeNodePanelProps) {
  const isZh = locale === "zh-CN";
  const [nodes, setNodes] = useState<ComputeNodeConfig[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [form, setForm] = useState<ComputeNodeConfig>(emptyNode());
  const [testState, setTestState] = useState<Record<string, "testing" | "ok" | "fail">>({});
  const [error, setError] = useState("");

  // Load nodes on mount
  useEffect(() => {
    loadNodes();
  }, []);

  async function loadNodes() {
    try {
      const config = await desktop.loadComputeNodes();
      setNodes(config.nodes || []);
      setActiveNodeId(config.activeNodeId || null);
    } catch {
      // Not yet implemented — start empty
      setNodes([]);
      setActiveNodeId(null);
    }
  }

  function handleStartAdd() {
    setIsAdding(true);
    setEditingNodeId(null);
    setForm(emptyNode());
    setError("");
  }

  function handleStartEdit(nodeId: string) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setEditingNodeId(nodeId);
    setIsAdding(false);
    setForm({ ...node });
    setError("");
  }

  function handleCancelForm() {
    setIsAdding(false);
    setEditingNodeId(null);
    setForm(emptyNode());
    setError("");
  }

  async function handleSave() {
    if (!form.host.trim() || !form.user.trim()) {
      setError(isZh ? "主机和用户名不能为空" : "Host and user are required");
      return;
    }
    if (form.authMethod === "key" && !form.keyPath.trim()) {
      setError(isZh ? "SSH 密钥路径不能为空" : "SSH key path is required");
      return;
    }
    if (form.authMethod === "password" && !form.password.trim()) {
      setError(isZh ? "密码不能为空" : "Password is required");
      return;
    }

    const node: ComputeNodeConfig = {
      ...form,
      id: editingNodeId || `node-${Date.now()}`,
      name: form.name.trim() || `${form.user}@${form.host}`,
    };

    try {
      await desktop.saveComputeNode(node);
      await loadNodes();
      handleCancelForm();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(nodeId: string) {
    try {
      await desktop.deleteComputeNode(nodeId);
      await loadNodes();
    } catch (err) {
      console.error("Failed to delete node:", err);
    }
  }

  async function handleSetActive(nodeId: string) {
    try {
      await desktop.setActiveComputeNode(nodeId);
      setActiveNodeId(nodeId);
    } catch (err) {
      console.error("Failed to set active node:", err);
    }
  }

  async function handleTest(nodeId: string) {
    setTestState((s) => ({ ...s, [nodeId]: "testing" }));
    try {
      await desktop.testComputeNode(nodeId);
      setTestState((s) => ({ ...s, [nodeId]: "ok" }));
    } catch {
      setTestState((s) => ({ ...s, [nodeId]: "fail" }));
    }
  }

  const showForm = isAdding || editingNodeId !== null;

  return (
    <div className="compute-node-panel">
      <div className="settings-section">
        <div className="settings-section__label">
          {isZh ? "SSH 计算节点" : "SSH Compute Nodes"}
        </div>
        <div className="settings-section__desc">
          {isZh
            ? "配置远程 SSH 服务器，AI 会在实验阶段自动通过 SSH 在远程服务器上执行代码。"
            : "Configure remote SSH servers. AI will automatically run experiment code on the remote server via SSH."}
        </div>
      </div>

      {/* Node list */}
      {nodes.length > 0 && (
        <div className="compute-node-list">
          {nodes.map((node) => {
            const isActive = node.id === activeNodeId;
            const test = testState[node.id];
            return (
              <div
                key={node.id}
                className={`compute-node-card ${isActive ? "is-active" : ""}`}
              >
                <div className="compute-node-card__header">
                  <div className="compute-node-card__info">
                    <div className="compute-node-card__name">
                      {isActive && <span className="compute-node-active-dot" />}
                      {node.name || `${node.user}@${node.host}`}
                    </div>
                    <div className="compute-node-card__meta">
                      {node.user}@{node.host}:{node.port} · {node.workDir}
                    </div>
                  </div>
                  <div className="compute-node-card__actions">
                    {!isActive && (
                      <button
                        className="compute-node-action-btn"
                        type="button"
                        title={isZh ? "设为活跃" : "Set active"}
                        onClick={() => void handleSetActive(node.id)}
                      >
                        {isZh ? "激活" : "Activate"}
                      </button>
                    )}
                    <button
                      className="compute-node-action-btn"
                      type="button"
                      onClick={() => void handleTest(node.id)}
                      disabled={test === "testing"}
                    >
                      {test === "testing"
                        ? (isZh ? "测试中…" : "Testing…")
                        : test === "ok"
                          ? "✓ OK"
                          : test === "fail"
                            ? (isZh ? "✗ 失败" : "✗ Fail")
                            : (isZh ? "测试连接" : "Test")}
                    </button>
                    <button
                      className="compute-node-action-btn"
                      type="button"
                      onClick={() => handleStartEdit(node.id)}
                    >
                      {isZh ? "编辑" : "Edit"}
                    </button>
                    <button
                      className="compute-node-action-btn compute-node-action-btn--danger"
                      type="button"
                      onClick={() => void handleDelete(node.id)}
                    >
                      {isZh ? "删除" : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit form */}
      {showForm ? (
        <div className="compute-node-form">
          <div className="compute-node-form__title">
            {editingNodeId
              ? (isZh ? "编辑节点" : "Edit Node")
              : (isZh ? "添加节点" : "Add Node")}
          </div>

          <label className="compute-node-field">
            <span>{isZh ? "名称（可选）" : "Name (optional)"}</span>
            <input
              className="sidebar-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="My GPU Server"
            />
          </label>

          <div className="compute-node-row">
            <label className="compute-node-field" style={{ flex: 2 }}>
              <span>{isZh ? "主机" : "Host"}</span>
              <input
                className="sidebar-input"
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="192.168.1.100"
              />
            </label>
            <label className="compute-node-field" style={{ flex: 1 }}>
              <span>{isZh ? "端口" : "Port"}</span>
              <input
                className="sidebar-input"
                type="number"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value) || 22 }))}
              />
            </label>
          </div>

          <label className="compute-node-field">
            <span>{isZh ? "用户名" : "Username"}</span>
            <input
              className="sidebar-input"
              value={form.user}
              onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
              placeholder="root"
            />
          </label>

          <div className="compute-node-field">
            <span>{isZh ? "认证方式" : "Auth Method"}</span>
            <div className="settings-language-options">
              <button
                type="button"
                className={`settings-lang-btn ${form.authMethod === "key" ? "is-active" : ""}`}
                onClick={() => setForm((f) => ({ ...f, authMethod: "key" }))}
              >
                SSH Key
              </button>
              <button
                type="button"
                className={`settings-lang-btn ${form.authMethod === "password" ? "is-active" : ""}`}
                onClick={() => setForm((f) => ({ ...f, authMethod: "password" }))}
              >
                {isZh ? "密码" : "Password"}
              </button>
            </div>
          </div>

          {form.authMethod === "key" ? (
            <label className="compute-node-field">
              <span>{isZh ? "密钥路径" : "Key Path"}</span>
              <input
                className="sidebar-input"
                value={form.keyPath}
                onChange={(e) => setForm((f) => ({ ...f, keyPath: e.target.value }))}
                placeholder="~/.ssh/id_rsa"
              />
            </label>
          ) : (
            <label className="compute-node-field">
              <span>{isZh ? "密码" : "Password"}</span>
              <input
                className="sidebar-input"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
              />
            </label>
          )}

          <label className="compute-node-field">
            <span>{isZh ? "工作目录" : "Work Directory"}</span>
            <input
              className="sidebar-input"
              value={form.workDir}
              onChange={(e) => setForm((f) => ({ ...f, workDir: e.target.value }))}
              placeholder="~"
            />
          </label>

          {error && <div className="compute-node-error">{error}</div>}

          <div className="compute-node-form__footer">
            <button
              className="btn-secondary"
              type="button"
              onClick={handleCancelForm}
            >
              {isZh ? "取消" : "Cancel"}
            </button>
            <button
              className="btn-primary"
              type="button"
              onClick={() => void handleSave()}
            >
              {isZh ? "保存" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="compute-node-add-btn"
          type="button"
          onClick={handleStartAdd}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {isZh ? "添加计算节点" : "Add Compute Node"}
        </button>
      )}

      {nodes.length === 0 && !showForm && (
        <div className="compute-node-empty">
          <div className="compute-node-empty__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
          </div>
          <div className="compute-node-empty__text">
            {isZh
              ? "尚未配置计算节点。添加一个 SSH 服务器，AI 可以自动在远程服务器上运行实验。"
              : "No compute nodes configured. Add an SSH server so AI can run experiments remotely."}
          </div>
        </div>
      )}
    </div>
  );
}
