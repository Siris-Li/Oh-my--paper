---
id: research-pipeline-planner
name: Research Pipeline Planner
version: 1.0.0
stages: [survey, ideation, experiment, publication, promotion]
tools: [read_file, write_file, update_pipeline]
---

# Research Pipeline Planner

Use this skill when the user needs to define or revise the project-level research pipeline.

## Goals

- clarify the research topic, target venue, and expected contribution
- set or revise the starting stage
- update `.pipeline/docs/research_brief.json`
- update `.pipeline/tasks/tasks.json`

## Working Rules

1. Read `instance.json`, `.pipeline/docs/research_brief.json`, and `.pipeline/tasks/tasks.json` first if they exist.
2. Keep the pipeline aligned with the five stages: survey, ideation, experiment, publication, promotion.
3. When the user already has results or a draft, move the starting stage forward instead of rebuilding earlier stages.
4. Do not invent citations, datasets, or experimental outcomes.
5. **When entering ideation stage, use the `research-idea-convergence` skill** to generate candidate directions and let the user choose. Never autonomously decide the research direction.
6. Ensure every stage transition involves a user checkpoint — do not skip stages or auto-advance without user confirmation.

## Expected Outputs

- a concise research brief with topic, goal, venue, current stage, and stage notes
- a task list with dependencies, suggested skills, and a concrete `nextActionPrompt`
- for ideation: candidate directions presented via `research-idea-convergence` before any `publishable_angle.md` is written
