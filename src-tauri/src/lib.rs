pub mod config_dir;
pub mod engine;
pub mod file_system;
pub mod kifu;

use crate::engine::bridge::AppState;
pub use config_dir::{load_config, save_config};
pub use engine::bridge::{
    analyze_with_depth, analyze_with_time, apply_engine_settings, get_analysis_result,
    get_analysis_status, get_engine_info, get_engine_settings, get_last_result, initialize_engine,
    set_position, shutdown_engine, start_infinite_analysis, stop_analysis,
};
pub use file_system::{
    create_directory, create_kifu_file, delete_directory, delete_file, get_file_tree, read_file,
    save_kifu_file,
};
pub use kifu::{convert_jkf_to_format, normalize_jkf, write_kifu_to_file};
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            read_file,
            write_kifu_to_file,
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
        ])
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();
            let bridge = Arc::clone(&state.bridge);

            tauri::async_runtime::spawn(async move {
                bridge.set_app_handle(app_handle).await;
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
