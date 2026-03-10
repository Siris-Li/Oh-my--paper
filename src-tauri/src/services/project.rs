use anyhow::{Context, Result};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use crate::models::{ProjectConfig, ProjectFile, ProjectNode, WorkspaceSnapshot};
use crate::state::{default_profiles, AppState};

fn detect_language(path: &str) -> String {
    if path.ends_with(".tex") || path.ends_with(".sty") || path.ends_with(".cls") {
        "latex".into()
    } else if path.ends_with(".bib") {
        "bib".into()
    } else if path.ends_with(".json") {
        "json".into()
    } else {
        "text".into()
    }
}

fn build_tree(paths: &[String]) -> Vec<ProjectNode> {
    let mut roots: Vec<ProjectNode> = Vec::new();

    for full_path in paths {
        let parts: Vec<&str> = full_path.split('/').collect();
        insert_node(&mut roots, &parts, full_path);
    }

    sort_nodes(&mut roots);
    roots
}

fn insert_node(nodes: &mut Vec<ProjectNode>, parts: &[&str], full_path: &str) {
    if parts.is_empty() {
        return;
    }

    let head = parts[0];
    let joined = full_path
        .split('/')
        .take(full_path.split('/').count() - parts.len() + 1)
        .collect::<Vec<_>>()
        .join("/");

    let idx = nodes.iter().position(|node| node.name == head);
    let entry = if let Some(idx) = idx {
        &mut nodes[idx]
    } else {
        nodes.push(ProjectNode {
            id: joined.clone(),
            name: head.into(),
            path: joined.clone(),
            kind: if parts.len() == 1 {
                if full_path.starts_with("assets/") {
                    "asset".into()
                } else {
                    "file".into()
                }
            } else {
                "directory".into()
            },
            children: if parts.len() == 1 { None } else { Some(Vec::new()) },
        });
        nodes.last_mut().expect("node inserted")
    };

    if parts.len() > 1 {
        if entry.children.is_none() {
          entry.children = Some(Vec::new());
        }
        insert_node(entry.children.as_mut().expect("children present"), &parts[1..], full_path);
    }
}

fn sort_nodes(nodes: &mut [ProjectNode]) {
    nodes.sort_by(|left, right| match (left.kind.as_str(), right.kind.as_str()) {
        ("directory", "directory") | ("file", "file") | ("asset", "asset") => left.name.cmp(&right.name),
        ("directory", _) => std::cmp::Ordering::Less,
        (_, "directory") => std::cmp::Ordering::Greater,
        ("file", "asset") => std::cmp::Ordering::Less,
        ("asset", "file") => std::cmp::Ordering::Greater,
        _ => left.name.cmp(&right.name),
    });

    for node in nodes.iter_mut() {
        if let Some(children) = node.children.as_mut() {
            sort_nodes(children);
        }
    }
}

pub fn load_project_snapshot(state: &AppState) -> Result<WorkspaceSnapshot> {
    let mut store = state.store.write().expect("store lock poisoned");
    let root_path = store.project_config.root_path.clone();
    let root = Path::new(&root_path);
    let config_path = root.join(".viewerleaf").join("project.json");

    if config_path.exists() {
        let raw = fs::read_to_string(&config_path).context("failed to read project config")?;
        store.project_config = serde_json::from_str::<ProjectConfig>(&raw)
            .context("failed to parse project config")?;
    }

    let root_path = store.project_config.root_path.clone();
    let root = Path::new(&root_path);

    let mut files = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        if rel.starts_with(".git/")
            || rel.starts_with("node_modules/")
            || rel.starts_with("dist/")
            || rel.starts_with("src-tauri/target/")
        {
            continue;
        }

        let is_text = matches!(
            path.extension().and_then(|ext| ext.to_str()),
            Some("tex" | "bib" | "sty" | "cls" | "json" | "md" | "txt")
        );
        if !is_text {
            continue;
        }

        let content = fs::read_to_string(path).unwrap_or_default();
        files.push(ProjectFile {
            path: rel.clone(),
            language: detect_language(&rel),
            content,
        });
    }

    if files.is_empty() {
        files.push(ProjectFile {
            path: store.project_config.main_tex.clone(),
            language: "latex".into(),
            content: String::new(),
        });
    }

    let mut tree_paths = files.iter().map(|file| file.path.clone()).collect::<Vec<_>>();
    tree_paths.extend(store.assets.iter().map(|asset| asset.file_path.clone()));
    let active = files
        .iter()
        .find(|file| file.path.ends_with("introduction.tex"))
        .map(|file| file.path.clone())
        .unwrap_or_else(|| files[0].path.clone());

    Ok(WorkspaceSnapshot {
        project_config: store.project_config.clone(),
        tree: build_tree(&tree_paths),
        files,
        active_file: active,
        providers: store.providers.clone(),
        skills: store.skills.clone(),
        profiles: default_profiles(),
        compile_result: store.last_compile.clone(),
        figure_briefs: store.briefs.clone(),
        assets: store.assets.clone(),
    })
}

pub fn save_file(state: &AppState, file_path: &str, content: &str) -> Result<()> {
    let root = state
        .store
        .read()
        .expect("store lock poisoned")
        .project_config
        .root_path
        .clone();
    let absolute = Path::new(&root).join(file_path);
    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent).context("failed to create parent directory")?;
    }
    fs::write(absolute, content).context("failed to write project file")?;
    Ok(())
}
