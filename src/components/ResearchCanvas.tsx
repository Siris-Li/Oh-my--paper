import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  buildResearchCanvasGraph,
  defaultResearchSelection,
  selectionToEntity,
  type ResearchStageNode,
  type ResearchTaskNode,
} from "../lib/researchCanvasGraph";
import type {
  ResearchCanvasSnapshot,
  ResearchStageSummary,
  ResearchTask,
} from "../types";

interface ResearchCanvasProps {
  research: ResearchCanvasSnapshot | null | undefined;
  isBusy?: boolean;
  onBootstrap: () => Promise<void> | void;
  onOpenArtifact: (path: string) => void;
  onUseTaskInChat: (task: ResearchTask) => Promise<void> | void;
  onOpenWriting: () => void;
}

function StageNode({ data }: NodeProps<ResearchStageNode>) {
  const stage = data.stage;
  return (
    <div className={`research-stage-node is-${stage.status}`}>
      <Handle type="target" position={Position.Top} className="research-node-handle" />
      <div className="research-stage-node__eyebrow">{stage.label}</div>
      <div className="research-stage-node__title">{stage.description}</div>
      <div className="research-stage-node__stats">
        <span>{stage.doneTasks}/{stage.totalTasks || 0} tasks</span>
        <span>{stage.artifactCount} artifacts</span>
      </div>
      {stage.suggestedSkills.length > 0 ? (
        <div className="research-node-chips">
          {stage.suggestedSkills.slice(0, 2).map((skill: string) => (
            <span key={skill} className="research-node-chip">{skill}</span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="research-node-handle" />
    </div>
  );
}

function TaskNode({ data }: NodeProps<ResearchTaskNode>) {
  const task = data.task;
  return (
    <div className={`research-task-node is-${task.status}`}>
      <Handle type="target" position={Position.Top} className="research-node-handle" />
      <div className="research-task-node__header">
        <span className="research-task-node__status">{task.status}</span>
        <span className="research-task-node__priority">{task.priority}</span>
      </div>
      <div className="research-task-node__title">{task.title}</div>
      <div className="research-task-node__body">{task.description}</div>
      {task.suggestedSkills.length > 0 ? (
        <div className="research-node-chips">
          {task.suggestedSkills.slice(0, 2).map((skill: string) => (
            <span key={skill} className="research-node-chip">{skill}</span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="research-node-handle" />
    </div>
  );
}

const nodeTypes = {
  researchStage: StageNode,
  researchTask: TaskNode,
} satisfies NodeTypes;

function ResearchOnboarding({
  research,
  isBusy,
  onBootstrap,
}: {
  research: ResearchCanvasSnapshot | null | undefined;
  isBusy?: boolean;
  onBootstrap: () => Promise<void> | void;
}) {
  const status = research?.bootstrap.status ?? "needs-bootstrap";
  const title =
    status === "missing-brief" || status === "missing-tasks" || status === "partial"
      ? "Repair the research canvas scaffold"
      : "Enable the research canvas";
  const buttonLabel =
    status === "missing-brief" || status === "missing-tasks" || status === "partial"
      ? "Repair workflow"
      : "Initialize workflow";

  return (
    <div className="research-onboarding">
      <div className="research-onboarding__card">
        <div className="research-onboarding__eyebrow">Research Canvas</div>
        <h2>{title}</h2>
        <p>{research?.bootstrap.message || "Initialize the research workflow for this project."}</p>
        <div className="research-onboarding__checklist">
          <span>Project prompts: `AGENTS.md`, `CLAUDE.md`</span>
          <span>Workflow state: `instance.json`, `.pipeline/*`</span>
          <span>Hidden research workspace: `.viewerleaf/research/*`</span>
          <span>Project skills and agent skill views</span>
        </div>
        <button
          type="button"
          className="research-primary-btn"
          onClick={() => void onBootstrap()}
          disabled={isBusy}
        >
          {isBusy ? "Working..." : buttonLabel}
        </button>
      </div>
    </div>
  );
}

function TaskInspector({
  task,
  onOpenArtifact,
  onUseTaskInChat,
  onOpenWriting,
}: {
  task: ResearchTask;
  onOpenArtifact: (path: string) => void;
  onUseTaskInChat: (task: ResearchTask) => Promise<void> | void;
  onOpenWriting: () => void;
}) {
  return (
    <div className="research-inspector__section">
      <div className="research-inspector__eyebrow">{task.stage}</div>
      <h3>{task.title}</h3>
      <p>{task.description}</p>
      <div className="research-inspector__meta">
        <span>Status: {task.status}</span>
        <span>Priority: {task.priority}</span>
      </div>
      {task.inputsNeeded.length > 0 ? (
        <>
          <div className="research-inspector__label">Missing inputs</div>
          <div className="research-inspector__list">
            {task.inputsNeeded.map((item) => <span key={item}>{item}</span>)}
          </div>
        </>
      ) : null}
      {task.suggestedSkills.length > 0 ? (
        <>
          <div className="research-inspector__label">Suggested skills</div>
          <div className="research-inspector__list">
            {task.suggestedSkills.map((item) => <span key={item}>{item}</span>)}
          </div>
        </>
      ) : null}
      <div className="research-inspector__actions">
        <button type="button" className="research-primary-btn" onClick={() => void onUseTaskInChat(task)}>
          Use in Chat
        </button>
        {task.stage === "publication" ? (
          <button type="button" className="research-secondary-btn" onClick={onOpenWriting}>
            Enter Writing Desk
          </button>
        ) : null}
      </div>
      {task.artifactPaths.length > 0 ? (
        <>
          <div className="research-inspector__label">Artifacts</div>
          <div className="research-artifact-list">
            {task.artifactPaths.map((path) => (
              <button key={path} type="button" onClick={() => onOpenArtifact(path)}>
                {path}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="research-inspector__prompt">{task.nextActionPrompt}</div>
    </div>
  );
}

function StageInspector({
  stage,
  onOpenArtifact,
  onOpenWriting,
}: {
  stage: ResearchStageSummary;
  onOpenArtifact: (path: string) => void;
  onOpenWriting: () => void;
}) {
  return (
    <div className="research-inspector__section">
      <div className="research-inspector__eyebrow">{stage.label}</div>
      <h3>{stage.description}</h3>
      <div className="research-inspector__meta">
        <span>Status: {stage.status}</span>
        <span>{stage.doneTasks}/{stage.totalTasks || 0} tasks done</span>
      </div>
      {stage.missingInputs.length > 0 ? (
        <>
          <div className="research-inspector__label">Open questions</div>
          <div className="research-inspector__list">
            {stage.missingInputs.map((item) => <span key={item}>{item}</span>)}
          </div>
        </>
      ) : null}
      {stage.suggestedSkills.length > 0 ? (
        <>
          <div className="research-inspector__label">Suggested skills</div>
          <div className="research-inspector__list">
            {stage.suggestedSkills.map((item) => <span key={item}>{item}</span>)}
          </div>
        </>
      ) : null}
      {stage.stage === "publication" ? (
        <div className="research-inspector__actions">
          <button type="button" className="research-primary-btn" onClick={onOpenWriting}>
            Enter Writing Desk
          </button>
        </div>
      ) : null}
      {stage.artifactPaths.length > 0 ? (
        <>
          <div className="research-inspector__label">Artifacts</div>
          <div className="research-artifact-list">
            {stage.artifactPaths.map((path) => (
              <button key={path} type="button" onClick={() => onOpenArtifact(path)}>
                {path}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ResearchCanvas({
  research,
  isBusy = false,
  onBootstrap,
  onOpenArtifact,
  onUseTaskInChat,
  onOpenWriting,
}: ResearchCanvasProps) {
  const needsBootstrap = !research || research.bootstrap.status !== "ready";
  const graph = useMemo(
    () => (research ? buildResearchCanvasGraph(research) : { nodes: [], edges: [] }),
    [research],
  );
  const [selectionId, setSelectionId] = useState<string | null>(research ? defaultResearchSelection(research) : null);

  useEffect(() => {
    setSelectionId(research ? defaultResearchSelection(research) : null);
  }, [research]);

  if (needsBootstrap) {
    return <ResearchOnboarding research={research} isBusy={isBusy} onBootstrap={onBootstrap} />;
  }

  const resolved = selectionToEntity(research, selectionId);

  return (
    <div className="research-canvas-shell">
      <div className="research-canvas__board">
        <div className="research-canvas__header">
          <div>
            <div className="research-canvas__eyebrow">Research Workflow</div>
            <h2>{research.briefTopic}</h2>
            <p>{research.briefGoal}</p>
          </div>
          <div className="research-canvas__header-meta">
            <span>Current stage: {research.currentStage}</span>
            {research.nextTask ? <span>Next task: {research.nextTask.title}</span> : null}
          </div>
        </div>
        <div className="research-canvas__flow">
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            fitView
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_event, node) => setSelectionId(node.id)}
          >
            <Background color="#d7dee8" gap={20} size={1.5} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>

      <aside className="research-inspector">
        <div className="research-inspector__header">
          <div className="research-inspector__eyebrow">Inspector</div>
          <h3>{resolved.task ? "Task Detail" : "Stage Detail"}</h3>
        </div>
        {resolved.task ? (
          <TaskInspector
            task={resolved.task}
            onOpenArtifact={onOpenArtifact}
            onUseTaskInChat={onUseTaskInChat}
            onOpenWriting={onOpenWriting}
          />
        ) : resolved.stage ? (
          <StageInspector
            stage={resolved.stage}
            onOpenArtifact={onOpenArtifact}
            onOpenWriting={onOpenWriting}
          />
        ) : (
          <div className="research-inspector__empty">
            Select a stage or task node to inspect its next action.
          </div>
        )}
      </aside>
    </div>
  );
}
