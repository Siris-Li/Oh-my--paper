use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::Deserialize;
use serde_json::{json, Value};
use walkdir::WalkDir;

use crate::models::{
    ResearchBootstrapState, ResearchCanvasSnapshot, ResearchStageSummary, ResearchTask,
    ResearchTaskCounts,
};

const STAGE_ORDER: [&str; 5] = [
    "survey",
    "ideation",
    "experiment",
    "publication",
    "promotion",
];

const RESEARCH_SKILL_FIXTURES: [(&str, &str); 4] = [
    (
        "research-pipeline-planner",
        include_str!("../../../skills/research-pipeline-planner/SKILL.md"),
    ),
    (
        "research-literature-trace",
        include_str!("../../../skills/research-literature-trace/SKILL.md"),
    ),
    (
        "research-experiment-driver",
        include_str!("../../../skills/research-experiment-driver/SKILL.md"),
    ),
    (
        "research-paper-handoff",
        include_str!("../../../skills/research-paper-handoff/SKILL.md"),
    ),
];

const AGENTS_TEMPLATE: &str = include_str!("../../../templates/research/AGENTS.md");
const CLAUDE_TEMPLATE: &str = include_str!("../../../templates/research/CLAUDE.md");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PipelineMeta {
    start_stage: Option<String>,
    current_stage: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BriefMeta {
    topic: Option<String>,
    goal: Option<String>,
    pipeline: Option<PipelineMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TasksEnvelope {
    tasks: Vec<ResearchTask>,
}

fn normalize_stage(stage: Option<&str>) -> String {
    let Some(raw) = stage.map(str::trim).filter(|value| !value.is_empty()) else {
        return "survey".into();
    };
    let lowered = raw.to_ascii_lowercase();
    if STAGE_ORDER.contains(&lowered.as_str()) {
        lowered
    } else {
        "survey".into()
    }
}

fn stage_index(stage: &str) -> usize {
    STAGE_ORDER
        .iter()
        .position(|candidate| *candidate == stage)
        .unwrap_or_default()
}

fn stage_label(stage: &str) -> &'static str {
    match stage {
        "survey" => "Survey",
        "ideation" => "Ideation",
        "experiment" => "Experiment",
        "publication" => "Publication",
        "promotion" => "Promotion",
        _ => "Research",
    }
}

fn stage_description(stage: &str) -> &'static str {
    match stage {
        "survey" => "Collect traceable literature, screen the field, and stabilize the problem boundary.",
        "ideation" => "Turn the survey into a concrete angle, hypothesis, or position worth testing.",
        "experiment" => "Define implementation, datasets, metrics, ablations, and analysis checkpoints.",
        "publication" => "Move the validated state into the main LaTeX workspace and draft the paper.",
        "promotion" => "Prepare follow-up deliverables such as slides, summaries, and release notes.",
        _ => "Research workflow stage.",
    }
}

fn status_rank(status: &str) -> usize {
    match status {
        "in-progress" => 0,
        "pending" => 1,
        "review" => 2,
        "done" => 3,
        "deferred" => 4,
        "cancelled" => 5,
        _ => 6,
    }
}

fn task_is_open(task: &ResearchTask) -> bool {
    matches!(task.status.as_str(), "pending" | "in-progress" | "review" | "")
}

fn task_is_done(task: &ResearchTask) -> bool {
    task.status == "done"
}

fn dependency_satisfied(task: &ResearchTask, done_ids: &BTreeSet<String>) -> bool {
    task.dependencies.iter().all(|dependency| done_ids.contains(dependency))
}

fn research_root(root: &Path) -> PathBuf {
    root.join(".viewerleaf").join("research")
}

fn survey_root(root: &Path) -> PathBuf {
    research_root(root).join("Survey")
}

fn ideation_root(root: &Path) -> PathBuf {
    research_root(root).join("Ideation")
}

fn experiment_root(root: &Path) -> PathBuf {
    research_root(root).join("Experiment")
}

fn promotion_root(root: &Path) -> PathBuf {
    research_root(root).join("Promotion")
}

fn pipeline_root(root: &Path) -> PathBuf {
    root.join(".pipeline")
}

fn write_if_missing(path: &Path, contents: &str) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}

fn write_json_if_missing(path: &Path, value: &Value) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn collect_files_under(root: &Path, dir: &Path) -> Vec<String> {
    if !dir.exists() {
        return Vec::new();
    }
    let mut files = WalkDir::new(dir)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| relative_path(root, entry.path()))
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn collect_publication_files(root: &Path) -> Vec<String> {
    let mut files = WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| {
            if entry.path() == root {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_dir() && name.starts_with('.'))
        })
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let ext = entry
                .path()
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if matches!(ext.as_str(), "tex" | "bib") {
                Some(relative_path(root, entry.path()))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn default_research_brief(project_title: &str, start_stage: &str) -> Value {
    json!({
        "version": 1,
        "topic": project_title,
        "goal": "Turn this topic into a traceable research workflow inside ViewerLeaf.",
        "pipeline": {
            "startStage": start_stage,
            "currentStage": start_stage
        },
        "stageNotes": {
            "survey": "Collect traceable papers and define the research boundary.",
            "ideation": "Extract gaps, candidate contributions, and a viable angle.",
            "experiment": "Plan implementation, metrics, ablations, and analysis.",
            "publication": "Draft the paper in the main LaTeX workspace.",
            "promotion": "Prepare slides, summaries, and follow-up deliverables."
        }
    })
}

fn default_tasks(start_stage: &str) -> Vec<ResearchTask> {
    let all_tasks = vec![
        ResearchTask {
            id: "survey-1".into(),
            title: "Define the survey boundary".into(),
            description: "Clarify topic scope, target venue, and screening criteria.".into(),
            status: "pending".into(),
            stage: "survey".into(),
            priority: "high".into(),
            dependencies: vec![],
            task_type: "planning".into(),
            inputs_needed: vec!["topic boundary".into(), "target venue".into()],
            suggested_skills: vec![
                "research-pipeline-planner".into(),
                "research-literature-trace".into(),
            ],
            next_action_prompt: "Use the research-pipeline-planner and research-literature-trace skills to define the survey scope, collect seed papers, and update the research brief.".into(),
            artifact_paths: vec![],
        },
        ResearchTask {
            id: "survey-2".into(),
            title: "Screen core literature".into(),
            description: "Keep traceable papers, baseline methods, and open gaps.".into(),
            status: "pending".into(),
            stage: "survey".into(),
            priority: "high".into(),
            dependencies: vec!["survey-1".into()],
            task_type: "screening".into(),
            inputs_needed: vec!["seed paper list".into()],
            suggested_skills: vec!["research-literature-trace".into()],
            next_action_prompt: "Use the research-literature-trace skill to screen the collected literature, keep traceable links, and summarize the main gaps.".into(),
            artifact_paths: vec![],
        },
        ResearchTask {
            id: "ideation-1".into(),
            title: "Extract a publishable angle".into(),
            description: "Turn the survey into a concrete hypothesis or contribution.".into(),
            status: "pending".into(),
            stage: "ideation".into(),
            priority: "high".into(),
            dependencies: vec!["survey-2".into()],
            task_type: "ideation".into(),
            inputs_needed: vec!["gap summary".into()],
            suggested_skills: vec![
                "research-pipeline-planner".into(),
                "research-literature-trace".into(),
            ],
            next_action_prompt: "Use the research-pipeline-planner skill to convert the survey findings into a concrete research angle, update the brief, and refine the downstream tasks.".into(),
            artifact_paths: vec![],
        },
        ResearchTask {
            id: "experiment-1".into(),
            title: "Design the experiment plan".into(),
            description: "Define implementation scope, datasets, metrics, and ablations.".into(),
            status: "pending".into(),
            stage: "experiment".into(),
            priority: "high".into(),
            dependencies: vec!["ideation-1".into()],
            task_type: "planning".into(),
            inputs_needed: vec!["chosen idea".into()],
            suggested_skills: vec!["research-experiment-driver".into()],
            next_action_prompt: "Use the research-experiment-driver skill to write an implementation plan with datasets, metrics, ablations, and analysis checkpoints.".into(),
            artifact_paths: vec![],
        },
        ResearchTask {
            id: "experiment-2".into(),
            title: "Prepare implementation and analysis notes".into(),
            description: "Break the experiment plan into build and analysis checkpoints.".into(),
            status: "pending".into(),
            stage: "experiment".into(),
            priority: "medium".into(),
            dependencies: vec!["experiment-1".into()],
            task_type: "execution".into(),
            inputs_needed: vec!["experiment plan".into()],
            suggested_skills: vec!["research-experiment-driver".into()],
            next_action_prompt: "Use the research-experiment-driver skill to turn the plan into execution tasks and analysis notes that can be tracked alongside the paper claims.".into(),
            artifact_paths: vec![],
        },
        ResearchTask {
            id: "publication-1".into(),
            title: "Move into the paper workspace".into(),
            description: "Translate the validated research state into a paper-writing checklist.".into(),
            status: "pending".into(),
            stage: "publication".into(),
            priority: "high".into(),
            dependencies: vec!["experiment-2".into()],
            task_type: "handoff".into(),
            inputs_needed: vec!["validated claims".into(), "figures".into()],
            suggested_skills: vec!["research-paper-handoff".into()],
            next_action_prompt: "Use the research-paper-handoff skill to build a publication checklist for the current LaTeX workspace, map claims to sections, and identify missing figures or references.".into(),
            artifact_paths: vec!["main.tex".into()],
        },
        ResearchTask {
            id: "promotion-1".into(),
            title: "Prepare downstream deliverables".into(),
            description: "Create slides, summaries, or release notes after the paper draft is stable.".into(),
            status: "pending".into(),
            stage: "promotion".into(),
            priority: "medium".into(),
            dependencies: vec!["publication-1".into()],
            task_type: "delivery".into(),
            inputs_needed: vec!["paper draft".into()],
            suggested_skills: vec!["research-paper-handoff".into()],
            next_action_prompt: "Use the research-paper-handoff skill to prepare slide or summary tasks from the current manuscript state.".into(),
            artifact_paths: vec![],
        },
    ];

    let start_index = stage_index(start_stage);
    all_tasks
        .into_iter()
        .filter(|task| stage_index(&task.stage) >= start_index)
        .collect()
}

fn default_pipeline_config(start_stage: &str) -> Value {
    json!({
        "version": 1,
        "startStage": start_stage,
        "intakeCompleted": true,
        "bootstrappedAt": iso_now()
    })
}

fn default_instance(root: &Path) -> Value {
    let root_string = root.to_string_lossy().to_string();
    json!({
        "instanceId": format!("viewerleaf-{}", root.file_name().and_then(|value| value.to_str()).unwrap_or("project")),
        "Survey": {
            "references": survey_root(root).join("references").to_string_lossy().to_string(),
            "reports": survey_root(root).join("reports").to_string_lossy().to_string()
        },
        "Ideation": {
            "ideas": ideation_root(root).join("ideas").to_string_lossy().to_string(),
            "references": ideation_root(root).join("references").to_string_lossy().to_string()
        },
        "Experiment": {
            "code_references": experiment_root(root).join("code_references").to_string_lossy().to_string(),
            "datasets": experiment_root(root).join("datasets").to_string_lossy().to_string(),
            "core_code": experiment_root(root).join("core_code").to_string_lossy().to_string(),
            "analysis": experiment_root(root).join("analysis").to_string_lossy().to_string()
        },
        "Publication": {
            "paper": root_string
        },
        "Promotion": {
            "homepage": promotion_root(root).join("homepage").to_string_lossy().to_string(),
            "slides": promotion_root(root).join("slides").to_string_lossy().to_string(),
            "audio": promotion_root(root).join("audio").to_string_lossy().to_string(),
            "video": promotion_root(root).join("video").to_string_lossy().to_string()
        }
    })
}

fn write_embedded_skills(root: &Path) -> Result<()> {
    let skills_root = root.join("skills");
    fs::create_dir_all(&skills_root)?;

    for (skill_id, contents) in RESEARCH_SKILL_FIXTURES {
        write_if_missing(&skills_root.join(skill_id).join("SKILL.md"), contents)?;
    }

    Ok(())
}

fn write_skill_views(root: &Path) -> Result<()> {
    let skill_dirs = RESEARCH_SKILL_FIXTURES
        .iter()
        .map(|(skill_id, _)| *skill_id)
        .collect::<Vec<_>>();

    let skills_index = {
        let mut lines = vec![
            "# Skills Index".to_string(),
            String::new(),
            "Read only the skill that matches the current task.".to_string(),
            String::new(),
        ];
        for skill_id in &skill_dirs {
            lines.push(format!("- `{skill_id}` -> `./{skill_id}/SKILL.md`"));
        }
        lines.join("\n")
    };

    for base in [root.join(".agents").join("skills"), root.join(".claude").join("skills")] {
        fs::create_dir_all(&base)?;
        write_if_missing(&base.join("skills-index.md"), &skills_index)?;

        for (skill_id, contents) in RESEARCH_SKILL_FIXTURES {
            write_if_missing(&base.join(skill_id).join("SKILL.md"), contents)?;
        }
    }

    Ok(())
}

fn write_templates(root: &Path) -> Result<()> {
    write_if_missing(&root.join("AGENTS.md"), AGENTS_TEMPLATE)?;
    write_if_missing(&root.join("CLAUDE.md"), CLAUDE_TEMPLATE)?;
    Ok(())
}

pub fn project_skill_roots(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join(".agents").join("skills"),
        root.join(".claude").join("skills"),
        root.join("skills"),
    ]
}

pub fn ensure_research_scaffold(root: &Path, start_stage: Option<&str>) -> Result<()> {
    let start_stage = normalize_stage(start_stage);

    fs::create_dir_all(survey_root(root).join("references"))?;
    fs::create_dir_all(survey_root(root).join("reports"))?;
    fs::create_dir_all(ideation_root(root).join("ideas"))?;
    fs::create_dir_all(ideation_root(root).join("references"))?;
    fs::create_dir_all(experiment_root(root).join("code_references"))?;
    fs::create_dir_all(experiment_root(root).join("datasets"))?;
    fs::create_dir_all(experiment_root(root).join("core_code"))?;
    fs::create_dir_all(experiment_root(root).join("analysis"))?;
    fs::create_dir_all(promotion_root(root).join("homepage"))?;
    fs::create_dir_all(promotion_root(root).join("slides"))?;
    fs::create_dir_all(promotion_root(root).join("audio"))?;
    fs::create_dir_all(promotion_root(root).join("video"))?;
    fs::create_dir_all(pipeline_root(root).join("docs"))?;
    fs::create_dir_all(pipeline_root(root).join("tasks"))?;

    write_templates(root)?;
    write_embedded_skills(root)?;
    write_skill_views(root)?;

    let project_title = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("ViewerLeaf Project");

    write_json_if_missing(&root.join("instance.json"), &default_instance(root))?;
    write_json_if_missing(
        &pipeline_root(root).join("config.json"),
        &default_pipeline_config(&start_stage),
    )?;
    write_json_if_missing(
        &pipeline_root(root).join("docs").join("research_brief.json"),
        &default_research_brief(project_title, &start_stage),
    )?;
    write_json_if_missing(
        &pipeline_root(root).join("tasks").join("tasks.json"),
        &json!({
            "version": 1,
            "tasks": default_tasks(&start_stage),
        }),
    )?;

    Ok(())
}

#[cfg(test)]
fn read_json_file(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&raw).ok()
}

fn read_brief(path: &Path) -> Option<(Value, BriefMeta)> {
    let raw = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    let meta = serde_json::from_value::<BriefMeta>(value.clone()).ok()?;
    Some((value, meta))
}

fn read_tasks(path: &Path) -> Vec<ResearchTask> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };

    if let Ok(envelope) = serde_json::from_str::<TasksEnvelope>(&raw) {
        return envelope.tasks;
    }

    serde_json::from_str::<Vec<ResearchTask>>(&raw).unwrap_or_default()
}

pub fn load_research_snapshot(root: &Path) -> Result<ResearchCanvasSnapshot> {
    let brief_path = pipeline_root(root).join("docs").join("research_brief.json");
    let tasks_path = pipeline_root(root).join("tasks").join("tasks.json");
    let has_instance = root.join("instance.json").exists();
    let has_templates = root.join("AGENTS.md").exists() && root.join("CLAUDE.md").exists();
    let has_skill_views = root.join(".agents").join("skills").exists() && root.join(".claude").join("skills").exists();
    let has_brief = brief_path.exists();
    let has_tasks = tasks_path.exists();
    let has_any_scaffold = has_instance || has_templates || has_skill_views || has_brief || has_tasks;

    let bootstrap = {
        let (status, message) = if !has_any_scaffold {
            (
                "needs-bootstrap",
                "This project has no research workflow scaffold yet.",
            )
        } else if !has_brief {
            (
                "missing-brief",
                "The research scaffold exists but the research brief is missing.",
            )
        } else if !has_tasks {
            (
                "missing-tasks",
                "The research scaffold exists but the task list is missing.",
            )
        } else if !has_templates || !has_skill_views || !has_instance {
            (
                "partial",
                "The research scaffold is only partially available and can be repaired.",
            )
        } else {
            ("ready", "Research workflow is ready.")
        };

        ResearchBootstrapState {
            status: status.into(),
            message: message.into(),
            has_instance,
            has_templates,
            has_skill_views,
            has_brief,
            has_tasks,
        }
    };

    let brief = read_brief(&brief_path);
    let brief_value = brief.as_ref().map(|(value, _)| value.clone());
    let brief_topic = brief
        .as_ref()
        .and_then(|(_, meta)| meta.topic.clone())
        .unwrap_or_else(|| {
            root.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("ViewerLeaf Project")
                .to_string()
        });
    let brief_goal = brief
        .as_ref()
        .and_then(|(_, meta)| meta.goal.clone())
        .unwrap_or_else(|| "Turn this topic into a traceable research workflow.".into());
    let start_stage = brief
        .as_ref()
        .and_then(|(_, meta)| meta.pipeline.as_ref())
        .and_then(|pipeline| pipeline.start_stage.as_deref())
        .map(Some)
        .map(normalize_stage)
        .unwrap_or_else(|| "survey".into());

    let mut tasks = read_tasks(&tasks_path)
        .into_iter()
        .map(|mut task| {
            if task.status.trim().is_empty() {
                task.status = "pending".into();
            }
            task.stage = normalize_stage(Some(&task.stage));
            task
        })
        .collect::<Vec<_>>();
    tasks.sort_by(|left, right| {
        stage_index(&left.stage)
            .cmp(&stage_index(&right.stage))
            .then(status_rank(&left.status).cmp(&status_rank(&right.status)))
            .then(left.id.cmp(&right.id))
    });

    let mut artifact_paths = HashMap::new();
    artifact_paths.insert("survey".into(), collect_files_under(root, &survey_root(root)));
    artifact_paths.insert("ideation".into(), collect_files_under(root, &ideation_root(root)));
    artifact_paths.insert(
        "experiment".into(),
        collect_files_under(root, &experiment_root(root)),
    );
    artifact_paths.insert("publication".into(), collect_publication_files(root));
    artifact_paths.insert("promotion".into(), collect_files_under(root, &promotion_root(root)));

    let done_ids = tasks
        .iter()
        .filter(|task| task_is_done(task))
        .map(|task| task.id.clone())
        .collect::<BTreeSet<_>>();

    let next_task = tasks
        .iter()
        .find(|task| task.status == "in-progress")
        .cloned()
        .or_else(|| {
            tasks.iter()
                .find(|task| task.status == "review")
                .cloned()
        })
        .or_else(|| {
            tasks.iter()
                .find(|task| task.status == "pending" && dependency_satisfied(task, &done_ids))
                .cloned()
        })
        .or_else(|| tasks.iter().find(|task| task_is_open(task)).cloned());

    let current_stage = next_task
        .as_ref()
        .map(|task| task.stage.clone())
        .or_else(|| {
            brief.as_ref()
                .and_then(|(_, meta)| meta.pipeline.as_ref())
                .and_then(|pipeline| pipeline.current_stage.as_deref())
                .map(Some)
                .map(normalize_stage)
        })
        .unwrap_or_else(|| start_stage.clone());

    let current_stage_index = stage_index(&current_stage);
    let stage_summaries = STAGE_ORDER
        .iter()
        .map(|stage| {
            let stage_tasks = tasks
                .iter()
                .filter(|task| task.stage == *stage)
                .cloned()
                .collect::<Vec<_>>();
            let mut counts = ResearchTaskCounts::default();
            counts.total = stage_tasks.len();
            for task in &stage_tasks {
                match task.status.as_str() {
                    "done" => counts.done += 1,
                    "in-progress" => counts.in_progress += 1,
                    "review" => counts.review += 1,
                    _ => counts.pending += 1,
                }
            }

            let missing_inputs = stage_tasks
                .iter()
                .flat_map(|task| task.inputs_needed.iter().cloned())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let suggested_skills = stage_tasks
                .iter()
                .flat_map(|task| task.suggested_skills.iter().cloned())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let stage_artifacts = artifact_paths
                .get(*stage)
                .cloned()
                .unwrap_or_default();
            let next_task_id = stage_tasks
                .iter()
                .find(|task| task_is_open(task))
                .map(|task| task.id.clone());
            let stage_status = if counts.total > 0 && counts.done == counts.total {
                "complete"
            } else if *stage == current_stage {
                "active"
            } else if stage_index(stage) < current_stage_index {
                "complete"
            } else if counts.total > 0 {
                "queued"
            } else {
                "idle"
            };

            ResearchStageSummary {
                stage: (*stage).into(),
                label: stage_label(stage).into(),
                description: stage_description(stage).into(),
                status: stage_status.into(),
                total_tasks: counts.total,
                done_tasks: counts.done,
                artifact_count: stage_artifacts.len(),
                artifact_paths: stage_artifacts,
                missing_inputs,
                suggested_skills,
                next_task_id,
                task_counts: counts,
            }
        })
        .collect::<Vec<_>>();

    Ok(ResearchCanvasSnapshot {
        bootstrap,
        brief: brief_value,
        tasks,
        current_stage: current_stage.clone(),
        next_task: next_task.clone(),
        stage_summaries,
        artifact_paths,
        handoff_to_writing: current_stage == "publication"
            || next_task
                .as_ref()
                .map(|task| task.stage == "publication")
                .unwrap_or(false),
        pipeline_root: relative_path(root, &pipeline_root(root)),
        instance_path: root
            .join("instance.json")
            .exists()
            .then(|| "instance.json".to_string()),
        brief_topic,
        brief_goal,
    })
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_temp_project(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("viewerleaf-{name}-{}", iso_now()));
        fs::create_dir_all(&dir).expect("failed to create temp dir");
        dir
    }

    #[test]
    fn scaffold_is_idempotent_and_preserves_main_tex() {
        let root = make_temp_project("research-idempotent");
        fs::create_dir_all(root.join(".viewerleaf")).expect("viewerleaf dir");
        fs::write(root.join("main.tex"), "% existing main tex").expect("main tex");

        ensure_research_scaffold(&root, Some("survey")).expect("first scaffold");
        ensure_research_scaffold(&root, Some("publication")).expect("second scaffold");

        let main_tex = fs::read_to_string(root.join("main.tex")).expect("read main tex");
        assert_eq!(main_tex, "% existing main tex");
        assert!(root.join("AGENTS.md").exists());
        assert!(root.join("CLAUDE.md").exists());
        assert!(root.join(".viewerleaf/research/Survey/references").exists());
        assert!(root.join(".pipeline/docs/research_brief.json").exists());
        assert!(root.join(".pipeline/tasks/tasks.json").exists());
        assert!(root.join("instance.json").exists());
    }

    #[test]
    fn publication_points_to_project_root() {
        let root = make_temp_project("research-instance");
        ensure_research_scaffold(&root, Some("publication")).expect("scaffold");

        let instance = read_json_file(&root.join("instance.json")).expect("instance json");
        let publication = instance
            .get("Publication")
            .and_then(|value| value.get("paper"))
            .and_then(|value| value.as_str())
            .expect("publication paper path");

        assert_eq!(publication, root.to_string_lossy());
    }

    #[test]
    fn snapshot_derives_ready_state_and_stage_summary() {
        let root = make_temp_project("research-snapshot");
        ensure_research_scaffold(&root, Some("publication")).expect("scaffold");

        let snapshot = load_research_snapshot(&root).expect("research snapshot");
        assert_eq!(snapshot.bootstrap.status, "ready");
        assert_eq!(snapshot.current_stage, "publication");
        assert!(snapshot.handoff_to_writing);
        assert_eq!(snapshot.stage_summaries.len(), STAGE_ORDER.len());
    }
}
