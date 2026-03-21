import type { Edge, Node } from "@xyflow/react";

import type { ResearchCanvasSnapshot, ResearchStage, ResearchStageSummary, ResearchTask } from "../types";

export interface ResearchStageNodeData extends Record<string, unknown> {
  kind: "stage";
  stage: ResearchStageSummary;
}

export interface ResearchTaskNodeData extends Record<string, unknown> {
  kind: "task";
  task: ResearchTask;
}

export type ResearchStageNode = Node<ResearchStageNodeData, "researchStage">;
export type ResearchTaskNode = Node<ResearchTaskNodeData, "researchTask">;
export type ResearchCanvasNode = ResearchStageNode | ResearchTaskNode;

const STAGE_ORDER: ResearchStage[] = [
  "survey",
  "ideation",
  "experiment",
  "publication",
  "promotion",
];

const COLUMN_WIDTH = 320;
const COLUMN_GAP = 36;
const STAGE_Y = 36;
const TASK_Y = 198;
const TASK_GAP = 176;

function stageNodeId(stage: ResearchStage) {
  return `stage:${stage}`;
}

function taskNodeId(taskId: string) {
  return `task:${taskId}`;
}

export function buildResearchCanvasGraph(research: ResearchCanvasSnapshot): {
  nodes: ResearchCanvasNode[];
  edges: Edge[];
} {
  const nodes: ResearchCanvasNode[] = [];
  const edges: Edge[] = [];

  for (const [stageIndex, stage] of STAGE_ORDER.entries()) {
    const summary = research.stageSummaries.find((item) => item.stage === stage);
    if (!summary) {
      continue;
    }

    const x = 48 + stageIndex * (COLUMN_WIDTH + COLUMN_GAP);
    const stageId = stageNodeId(stage);

    nodes.push({
      id: stageId,
      type: "researchStage",
      position: { x, y: STAGE_Y },
      draggable: false,
      selectable: true,
      data: {
        kind: "stage",
        stage: summary,
      },
    });

    if (stageIndex > 0) {
      edges.push({
        id: `flow:${STAGE_ORDER[stageIndex - 1]}:${stage}`,
        source: stageNodeId(STAGE_ORDER[stageIndex - 1]),
        target: stageId,
        type: "smoothstep",
        animated: research.currentStage === stage,
      });
    }

    const tasks = research.tasks.filter((task) => task.stage === stage);
    tasks.forEach((task, taskIndex) => {
      const taskId = taskNodeId(task.id);
      nodes.push({
        id: taskId,
        type: "researchTask",
        position: { x, y: TASK_Y + taskIndex * TASK_GAP },
        draggable: false,
        selectable: true,
        data: {
          kind: "task",
          task,
        },
      });

      if (taskIndex === 0) {
        edges.push({
          id: `stage:${stage}:${task.id}`,
          source: stageId,
          target: taskId,
          type: "smoothstep",
          animated: research.currentStage === stage,
        });
      }

      task.dependencies.forEach((dependencyId) => {
        edges.push({
          id: `dep:${dependencyId}:${task.id}`,
          source: taskNodeId(dependencyId),
          target: taskId,
          type: "smoothstep",
          animated: research.nextTask?.id === task.id,
        });
      });
    });
  }

  return { nodes, edges };
}

export function defaultResearchSelection(research: ResearchCanvasSnapshot): string {
  if (research.nextTask?.id) {
    return taskNodeId(research.nextTask.id);
  }
  return stageNodeId(research.currentStage);
}

export function selectionToEntity(
  research: ResearchCanvasSnapshot,
  selectionId: string | null,
): { stage?: ResearchStageSummary; task?: ResearchTask } {
  if (!selectionId) {
    return {};
  }

  if (selectionId.startsWith("task:")) {
    const taskId = selectionId.slice("task:".length);
    const task = research.tasks.find((item) => item.id === taskId);
    return task ? { task } : {};
  }

  if (selectionId.startsWith("stage:")) {
    const stage = selectionId.slice("stage:".length) as ResearchStage;
    const stageSummary = research.stageSummaries.find((item) => item.stage === stage);
    return stageSummary ? { stage: stageSummary } : {};
  }

  return {};
}
