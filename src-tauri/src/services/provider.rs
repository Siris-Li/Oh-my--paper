use anyhow::Result;
use dirs::data_dir;
use std::fs;
use std::path::PathBuf;

use crate::models::ProviderConfig;
use crate::state::AppState;

fn provider_store_path() -> PathBuf {
    data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ViewerLeaf")
        .join("providers.json")
}

fn persist(providers: &[ProviderConfig]) -> Result<()> {
    let path = provider_store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(providers)?)?;
    Ok(())
}

pub fn list(state: &AppState) -> Vec<ProviderConfig> {
    state
        .store
        .read()
        .expect("store lock poisoned")
        .providers
        .clone()
}

pub fn add(state: &AppState, provider: ProviderConfig) -> Result<ProviderConfig> {
    let mut store = state.store.write().expect("store lock poisoned");
    store.providers.push(provider.clone());
    persist(&store.providers)?;
    Ok(provider)
}

pub fn update(
    state: &AppState,
    provider_id: &str,
    patch: serde_json::Value,
) -> Result<Option<ProviderConfig>> {
    let mut store = state.store.write().expect("store lock poisoned");
    let mut updated = None;
    if let Some(provider) = store.providers.iter_mut().find(|item| item.id == provider_id) {
        if let Some(vendor) = patch.get("vendor").and_then(|value| value.as_str()) {
            provider.vendor = vendor.into();
        }
        if let Some(base_url) = patch.get("baseUrl").and_then(|value| value.as_str()) {
            provider.base_url = base_url.into();
        }
        if let Some(auth_ref) = patch.get("authRef").and_then(|value| value.as_str()) {
            provider.auth_ref = auth_ref.into();
        }
        if let Some(default_model) = patch.get("defaultModel").and_then(|value| value.as_str()) {
            provider.default_model = default_model.into();
        }
        updated = Some(provider.clone());
    }
    persist(&store.providers)?;
    Ok(updated)
}
