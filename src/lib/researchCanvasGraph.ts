import type { ResearchCanvasSnapshot, ResearchStage, ResearchStageSummary, ResearchTask } from "../types";

export const STAGE_ORDER: ResearchStage[] = [
  "survey",
  "ideation",
  "experiment",
  "publication",
  "promotion",
];

export interface TaskTreeStageGroup {
  stage: ResearchStage;
  summary: ResearchStageSummary;
  tasks: ResearchTask[];
}

/**
 * Flatten the research snapshot into an ordered list of stage groups,
 * each containing its tasks sorted by dependency depth then title.
 */
export function flattenTasksForTree(research: ResearchCanvasSnapshot): TaskTreeStageGroup[] {
  return STAGE_ORDER
    .map((stage) => {
      const summary = research.stageSummaries.find((s) => s.stage === stage);
      if (!summary) {
        return null;
      }
      const tasks = research.tasks
        .filter((t) => t.stage === stage)
        .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
      return { stage, summary, tasks };
    })
    .filter((g): g is TaskTreeStageGroup => g !== null);
}

export function defaultResearchSelection(research: ResearchCanvasSnapshot): string {
  if (research.nextTask?.id) {
    return `task:${research.nextTask.id}`;
  }
  return `stage:${research.currentStage}`;
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
