pub mod config_dir;
pub mod file_system;
pub mod kifu;

pub use config_dir::{load_config, save_config};
pub use file_system::{
    create_directory, create_kifu_file, delete_directory, delete_file, get_file_tree, read_file,
    save_kifu_file,
};
pub use kifu::{convert_jkf_to_format, normalize_jkf, write_kifu_to_file};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            normalize_jkf
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
