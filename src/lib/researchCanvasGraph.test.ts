import { describe, expect, it } from "vitest";

import type { ResearchCanvasSnapshot } from "../types";
import {
  buildResearchCanvasGraph,
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
  it("builds stage and task nodes for the workflow", () => {
    const graph = buildResearchCanvasGraph(sampleResearch);
    expect(graph.nodes.some((node) => node.id === "stage:publication")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "task:publication-1")).toBe(true);
    expect(graph.edges.some((edge) => edge.id === "dep:survey-1:publication-1")).toBe(true);
  });

  it("defaults selection to the next task", () => {
    expect(defaultResearchSelection(sampleResearch)).toBe("task:publication-1");
  });

  it("resolves task selections back to entities", () => {
    const resolved = selectionToEntity(sampleResearch, "task:publication-1");
    expect(resolved.task?.title).toBe("Write");
  });
});
