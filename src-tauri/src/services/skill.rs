use anyhow::Result;
use dirs::data_dir;
use std::fs;
use std::path::PathBuf;

use crate::models::SkillManifest;
use crate::state::AppState;

fn skills_root() -> PathBuf {
    data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ViewerLeaf")
        .join("skills")
}

fn manifest_store() -> PathBuf {
    skills_root().join("manifest.json")
}

fn persist(skills: &[SkillManifest]) -> Result<()> {
    let path = manifest_store();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(skills)?)?;
    Ok(())
}

pub fn list(state: &AppState) -> Vec<SkillManifest> {
    state
        .store
        .read()
        .expect("store lock poisoned")
        .skills
        .clone()
}

pub fn install(state: &AppState, skill: SkillManifest) -> Result<SkillManifest> {
    let mut store = state.store.write().expect("store lock poisoned");
    store.skills.push(skill.clone());
    persist(&store.skills)?;
    Ok(skill)
}

pub fn enable(state: &AppState, skill_id: &str, enabled: bool) -> Result<Option<SkillManifest>> {
    let mut store = state.store.write().expect("store lock poisoned");
    let mut updated = None;
    if let Some(skill) = store.skills.iter_mut().find(|item| item.id == skill_id) {
        skill.enabled = enabled;
        updated = Some(skill.clone());
    }
    persist(&store.skills)?;
    Ok(updated)
}
