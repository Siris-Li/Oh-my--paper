mod commands;
mod models;
mod services;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::save_file,
            commands::compile_project,
            commands::forward_search,
            commands::reverse_search,
            commands::run_agent,
            commands::apply_agent_patch,
            commands::list_skills,
            commands::install_skill,
            commands::enable_skill,
            commands::list_providers,
            commands::add_provider,
            commands::update_provider,
            commands::create_figure_brief,
            commands::run_figure_skill,
            commands::run_banana_generation,
            commands::register_generated_asset,
            commands::insert_figure_snippet,
            commands::get_agent_messages
        ])
        .run(tauri::generate_context!())
        .expect("failed to start ViewerLeaf");
}
