import clsx from "clsx";

import type {
  AgentMessage,
  AgentProfile,
  DrawerTab,
  FigureBriefDraft,
  GeneratedAsset,
  ProviderConfig,
  SkillManifest,
} from "../types";

interface BottomDockProps {
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  messages: AgentMessage[];
  profiles: AgentProfile[];
  activeProfileId: string;
  onRunAgent: () => void;
  pendingPatchSummary?: string;
  onApplyPatch: () => void;
  compileLog: string;
  diagnosticsCount: number;
  briefs: FigureBriefDraft[];
  assets: GeneratedAsset[];
  selectedBriefId?: string;
  selectedAssetId?: string;
  onCreateBrief: () => void;
  onRunFigureSkill: () => void;
  onGenerateFigure: () => void;
  onInsertFigure: () => void;
  onSelectBrief: (briefId: string) => void;
  onSelectAsset: (assetId: string) => void;
  skills: SkillManifest[];
  providers: ProviderConfig[];
}

const tabs: { id: DrawerTab; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "logs", label: "Logs" },
  { id: "figures", label: "Figures" },
  { id: "skills", label: "Skills" },
  { id: "providers", label: "Providers" },
];

export function BottomDock({
  tab,
  onTabChange,
  messages,
  profiles,
  activeProfileId,
  onRunAgent,
  pendingPatchSummary,
  onApplyPatch,
  compileLog,
  diagnosticsCount,
  briefs,
  assets,
  selectedBriefId,
  selectedAssetId,
  onCreateBrief,
  onRunFigureSkill,
  onGenerateFigure,
  onInsertFigure,
  onSelectBrief,
  onSelectAsset,
  skills,
  providers,
}: BottomDockProps) {
  return (
    <div className="panel dock">
      <div className="dock-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={clsx("dock-tab", tab === item.id && "is-active")}
            onClick={() => onTabChange(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "ai" && (
        <div className="dock-grid">
          <div className="dock-column">
            <div className="mini-section">
              <p className="eyebrow">Profiles</p>
              <div className="profile-grid">
                {profiles.map((profile) => (
                  <div key={profile.id} className={clsx("profile-card", activeProfileId === profile.id && "is-active")}>
                    <strong>{profile.label}</strong>
                    <span>{profile.summary}</span>
                    <small>
                      {profile.model} · {profile.skillIds.join(", ")}
                    </small>
                  </div>
                ))}
              </div>
            </div>
            <div className="action-row">
              <button className="primary-button" onClick={onRunAgent} type="button">
                Run active profile
              </button>
              <button className="secondary-button" disabled={!pendingPatchSummary} onClick={onApplyPatch} type="button">
                Apply patch
              </button>
            </div>
            {pendingPatchSummary ? <p className="hint-line">{pendingPatchSummary}</p> : null}
          </div>
          <div className="dock-column transcript">
            {messages.map((message) => (
              <article key={message.id} className={`message-card role-${message.role}`}>
                <header>
                  <strong>{message.role}</strong>
                  <span>{message.profileId}</span>
                </header>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div className="dock-grid">
          <div className="dock-column">
            <p className="eyebrow">Compile Diagnostics</p>
            <h3>{diagnosticsCount ? `${diagnosticsCount} issues reported` : "Project is clean"}</h3>
          </div>
          <pre className="log-surface">{compileLog}</pre>
        </div>
      )}

      {tab === "figures" && (
        <div className="dock-grid">
          <div className="dock-column">
            <p className="eyebrow">Figure Workspace</p>
            <div className="action-row">
              <button className="primary-button" onClick={onCreateBrief} type="button">
                Create brief
              </button>
              <button className="secondary-button" disabled={!selectedBriefId} onClick={onRunFigureSkill} type="button">
                Run figure skill
              </button>
              <button className="secondary-button" disabled={!selectedBriefId} onClick={onGenerateFigure} type="button">
                Generate with banana
              </button>
              <button className="secondary-button" disabled={!selectedAssetId} onClick={onInsertFigure} type="button">
                Insert figure
              </button>
            </div>
            <div className="mini-section">
              <p className="eyebrow">Briefs</p>
              <div className="stack-list">
                {briefs.map((brief) => (
                  <button
                    key={brief.id}
                    className={clsx("stack-card interactive-card", selectedBriefId === brief.id && "is-active")}
                    onClick={() => onSelectBrief(brief.id)}
                    type="button"
                  >
                    <strong>{brief.sourceSectionRef}</strong>
                    <span>{brief.status}</span>
                    <small>{brief.promptPayload}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="dock-column">
            <p className="eyebrow">Generated Assets</p>
            <div className="asset-grid">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  className={clsx("asset-card interactive-card", selectedAssetId === asset.id && "is-active")}
                  onClick={() => onSelectAsset(asset.id)}
                  type="button"
                >
                  <img alt={asset.filePath} src={asset.previewUri} />
                  <div>
                    <strong>{asset.filePath}</strong>
                    <small>{asset.metadata.generator}</small>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "skills" && (
        <div className="dock-grid compact-grid">
          {skills.map((skill) => (
            <div key={skill.id} className="stack-card">
              <strong>{skill.name}</strong>
              <span>{skill.enabled ? "enabled" : "disabled"}</span>
              <small>
                {skill.stages.join(", ")} · {skill.source}
              </small>
            </div>
          ))}
        </div>
      )}

      {tab === "providers" && (
        <div className="dock-grid compact-grid">
          {providers.map((provider) => (
            <div key={provider.id} className="stack-card">
              <strong>{provider.vendor}</strong>
              <span>{provider.defaultModel}</span>
              <small>{provider.baseUrl}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
