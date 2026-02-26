pub mod ai_library;
pub mod config_dir;
pub mod engine;
pub mod engine_presets;
pub mod file_system;
pub mod kifu;
pub mod search;

use crate::engine::bridge::AppState;
pub use ai_library::{ensure_engines_dir, scan_ai_root};
pub use config_dir::{load_config, save_config};
pub use engine::bridge::{
    analyze_with_depth, analyze_with_time, apply_engine_settings, get_analysis_result,
    get_analysis_status, get_engine_info, get_engine_settings, get_last_result, initialize_engine,
    set_position, shutdown_engine, start_infinite_analysis, stop_analysis,
};
pub use engine_presets::{load_presets, save_presets};
pub use file_system::{
    create_directory, create_kifu_file, delete_directory, delete_file, get_file_tree,
    import_kifu_file, mv_directory, mv_kifu_file, read_file, rename_directory, rename_kifu_file,
    save_kifu_file,
};
pub use kifu::{convert_jkf_to_format, normalize_jkf, write_kifu_to_file};
use std::sync::Arc;
use tauri::Manager;

use search::api::{open_project, search_position, SearchState};
use search::index_store::IndexStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(IndexStore::new());
    let search_state = SearchState::new(store);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .max_file_size(200_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .level(log::LevelFilter::Info)
                .level_for("obs_shogi::engine", log::LevelFilter::Debug)
                .filter(|m| !m.target().starts_with("tao::"))
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            get_file_tree,
            save_kifu_file,
            create_kifu_file,
            create_directory,
            delete_file,
            delete_directory,
            load_presets,
            save_presets,
            import_kifu_file,
            read_file,
            write_kifu_to_file,
            mv_directory,
            ensure_engines_dir,
            scan_ai_root,
            mv_kifu_file,
            rename_directory,
            rename_kifu_file,
            convert_jkf_to_format,
            normalize_jkf,
            initialize_engine,
            shutdown_engine,
            set_position,
            start_infinite_analysis,
            analyze_with_time,
            analyze_with_depth,
            stop_analysis,
            get_analysis_result,
            get_last_result,
            apply_engine_settings,
            get_engine_settings,
            get_analysis_status,
            get_engine_info,
            open_project,
            search_position
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(search_state)
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();
            let bridge = Arc::clone(&state.bridge);

            tauri::async_runtime::spawn(async move {
                bridge.set_app_handle(app_handle).await;
            });

            let handle = app.handle().clone();
            let query = app.state::<SearchState>().query.clone();
            tauri::async_runtime::spawn(async move {
                query.set_app_handle(handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
