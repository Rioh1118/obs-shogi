pub mod config_dir;
pub mod engine;
pub mod file_system;
pub mod kifu;

pub use config_dir::{load_config, save_config};
pub use engine::{
    apply_engine_settings, get_all_pending_analysis_results, get_analysis_status,
    get_engine_ready_status, get_latest_analysis_result, initialize_engine_with_options,
    send_raw_command, shutdown_engine, start_infinite_analysis, stop_analysis, EngineState,
};
pub use file_system::{
    create_directory, create_kifu_file, delete_directory, delete_file, get_file_tree, read_file,
    save_kifu_file,
};
pub use kifu::{convert_jkf_to_format, normalize_jkf, write_kifu_to_file};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EngineState::new())
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
            apply_engine_settings,
            get_all_pending_analysis_results,
            get_analysis_status,
            get_engine_ready_status,
            get_latest_analysis_result,
            initialize_engine_with_options,
            send_raw_command,
            shutdown_engine,
            start_infinite_analysis,
            stop_analysis
        ])
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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
