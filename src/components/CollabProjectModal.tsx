import { useEffect, useState } from "react";

import type { CloudProjectSummary } from "../types";

interface CollabProjectModalProps {
  mode: "create" | "link";
  defaultValue: string;
  busy: boolean;
  projects?: CloudProjectSummary[];
  isLoadingProjects?: boolean;
  onRefreshProjects?: () => void;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

function formatUpdatedAt(value: string) {
  if (!value.trim()) {
    return "";
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withTimezone = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
  const date = new Date(withTimezone);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CollabProjectModal({
  mode,
  defaultValue,
  busy,
  projects = [],
  isLoadingProjects = false,
  onRefreshProjects,
  onSubmit,
  onClose,
}: CollabProjectModalProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue, mode]);

  const title = mode === "create" ? "创建云项目" : "关联已有项目";
  const label = mode === "create" ? "云项目名称" : "Project ID 或分享链接";
  const placeholder = mode === "create" ? "输入项目名称" : "粘贴项目 ID 或完整分享链接";
  const submitLabel = mode === "create"
    ? (busy ? "创建中..." : "创建并关联")
    : (busy ? "关联中..." : "关联项目");

  return (
    <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="modal-box">
        <div className="modal-header">
          <span>{title}</span>
          <button className="modal-close" type="button" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="modal-body">
          <label className="modal-label">
            {label}
            <input
              className="sidebar-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              autoFocus
            />
          </label>

          {mode === "link" && (
            <div className="text-subtle text-xs">
              可以直接粘贴 `https://.../join/...` 形式的分享链接。
            </div>
          )}

          {mode === "link" && (
            <div className="sidebar-stack-compact">
              <div className="collab-modal-actions">
                <div className="text-subtle text-xs">当前账号可访问的云项目</div>
                {onRefreshProjects && (
                  <button className="link-btn" type="button" onClick={onRefreshProjects} disabled={busy || isLoadingProjects}>
                    {isLoadingProjects ? "加载中..." : "刷新列表"}
                  </button>
                )}
              </div>
              {projects.length > 0 ? (
                <div className="collab-project-list">
                  {projects.map((project) => {
                    const selected = value.trim() === project.id;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        className={`collab-project-item${selected ? " is-selected" : ""}`}
                        onClick={() => setValue(project.id)}
                        disabled={busy}
                      >
                        <span className="collab-project-meta">
                          <span className="collab-project-name">{project.name}</span>
                          <span className="collab-project-id">{project.id}</span>
                        </span>
                        <span className="text-subtle text-xs">{formatUpdatedAt(project.updatedAt)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-subtle text-xs">
                  {isLoadingProjects ? "正在加载项目列表..." : "还没有读到可关联的项目。你也可以直接输入 Project ID。"}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" type="button" onClick={onClose} disabled={busy}>取消</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => onSubmit(value.trim())}
            disabled={!value.trim() || busy}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
