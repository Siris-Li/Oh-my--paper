import { describe, expect, it } from "vitest";

import type { ResearchCanvasSnapshot } from "../types";
import {
  flattenTasksForTree,
  defaultResearchSelection,
  selectionToEntity,
} from "./researchCanvasGraph";

const sampleResearch: ResearchCanvasSnapshot = {
  bootstrap: {
    status: "ready",
    message: "ready",
    hasInstance: true,
    hasTemplates: true,
    hasSkillViews: true,
    hasBrief: true,
    hasTasks: true,
  },
  brief: { topic: "Test" },
  tasks: [
    {
      id: "survey-1",
      title: "Survey",
      description: "Survey",
      status: "done",
      stage: "survey",
      priority: "high",
      dependencies: [],
      taskType: "planning",
      inputsNeeded: [],
      suggestedSkills: ["research-pipeline-planner"],
      nextActionPrompt: "Survey prompt",
      artifactPaths: [],
    },
    {
      id: "publication-1",
      title: "Write",
      description: "Write",
      status: "pending",
      stage: "publication",
      priority: "high",
      dependencies: ["survey-1"],
      taskType: "handoff",
      inputsNeeded: ["claims"],
      suggestedSkills: ["research-paper-handoff"],
      nextActionPrompt: "Write prompt",
      artifactPaths: ["main.tex"],
    },
  ],
  currentStage: "publication",
  nextTask: {
    id: "publication-1",
    title: "Write",
    description: "Write",
    status: "pending",
    stage: "publication",
    priority: "high",
    dependencies: ["survey-1"],
    taskType: "handoff",
    inputsNeeded: ["claims"],
    suggestedSkills: ["research-paper-handoff"],
    nextActionPrompt: "Write prompt",
    artifactPaths: ["main.tex"],
  },
  stageSummaries: [
    {
      stage: "survey",
      label: "Survey",
      description: "Survey",
      status: "complete",
      totalTasks: 1,
      doneTasks: 1,
      artifactCount: 0,
      artifactPaths: [],
      missingInputs: [],
      suggestedSkills: ["research-pipeline-planner"],
      nextTaskId: null,
      taskCounts: { total: 1, pending: 0, inProgress: 0, done: 1, review: 0 },
    },
    {
      stage: "ideation",
      label: "Ideation",
      description: "Ideation",
      status: "queued",
      totalTasks: 0,
      doneTasks: 0,
      artifactCount: 0,
      artifactPaths: [],
      missingInputs: [],
      suggestedSkills: [],
      nextTaskId: null,
      taskCounts: { total: 0, pending: 0, inProgress: 0, done: 0, review: 0 },
    },
    {
      stage: "experiment",
      label: "Experiment",
      description: "Experiment",
      status: "queued",
      totalTasks: 0,
      doneTasks: 0,
      artifactCount: 0,
      artifactPaths: [],
      missingInputs: [],
      suggestedSkills: [],
      nextTaskId: null,
      taskCounts: { total: 0, pending: 0, inProgress: 0, done: 0, review: 0 },
    },
    {
      stage: "publication",
      label: "Publication",
      description: "Publication",
      status: "active",
      totalTasks: 1,
      doneTasks: 0,
      artifactCount: 1,
      artifactPaths: ["main.tex"],
      missingInputs: ["claims"],
      suggestedSkills: ["research-paper-handoff"],
      nextTaskId: "publication-1",
      taskCounts: { total: 1, pending: 1, inProgress: 0, done: 0, review: 0 },
    },
    {
      stage: "promotion",
      label: "Promotion",
      description: "Promotion",
      status: "queued",
      totalTasks: 0,
      doneTasks: 0,
      artifactCount: 0,
      artifactPaths: [],
      missingInputs: [],
      suggestedSkills: [],
      nextTaskId: null,
      taskCounts: { total: 0, pending: 0, inProgress: 0, done: 0, review: 0 },
    },
  ],
  artifactPaths: {
    survey: [],
    ideation: [],
    experiment: [],
    publication: ["main.tex"],
    promotion: [],
  },
  handoffToWriting: true,
  pipelineRoot: ".pipeline",
  instancePath: "instance.json",
  briefTopic: "Test",
  briefGoal: "Goal",
};

describe("research canvas graph", () => {
  it("flattenTasksForTree returns stage groups with tasks", () => {
    const groups = flattenTasksForTree(sampleResearch);
    expect(groups.length).toBe(5);

    const surveyGroup = groups.find((g) => g.stage === "survey");
    expect(surveyGroup).toBeDefined();
    expect(surveyGroup?.tasks.length).toBe(1);
    expect(surveyGroup?.tasks[0].id).toBe("survey-1");

    const publicationGroup = groups.find((g) => g.stage === "publication");
    expect(publicationGroup).toBeDefined();
    expect(publicationGroup?.tasks.length).toBe(1);

    const ideationGroup = groups.find((g) => g.stage === "ideation");
    expect(ideationGroup).toBeDefined();
    expect(ideationGroup?.tasks.length).toBe(0);
  });

  it("stage groups are in STAGE_ORDER", () => {
    const groups = flattenTasksForTree(sampleResearch);
    const stages = groups.map((g) => g.stage);
    expect(stages).toEqual(["survey", "ideation", "experiment", "publication", "promotion"]);
  });

  it("defaults selection to the next task", () => {
    expect(defaultResearchSelection(sampleResearch)).toBe("task:publication-1");
  });

  it("resolves task selections back to entities", () => {
    const resolved = selectionToEntity(sampleResearch, "task:publication-1");
    expect(resolved.task?.title).toBe("Write");
  });

  it("resolves stage selections back to entities", () => {
    const resolved = selectionToEntity(sampleResearch, "stage:survey");
    expect(resolved.stage?.label).toBe("Survey");
  });

  it("returns empty for null selection", () => {
    const resolved = selectionToEntity(sampleResearch, null);
    expect(resolved.task).toBeUndefined();
    expect(resolved.stage).toBeUndefined();
  });

  it("defaults selection to current stage when no next task", () => {
    const noNextTask = { ...sampleResearch, nextTask: null };
    expect(defaultResearchSelection(noNextTask)).toBe("stage:publication");
  });
});
