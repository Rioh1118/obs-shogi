pub mod ai_library;
pub mod config_dir;
pub mod engine;
pub mod engine_presets;
pub mod file_system;
pub mod kifu;
pub mod search;
pub mod study_positions;

pub use crate::engine::bridge::AppState;
pub use ai_library::{create_ai_profile_dirs, ensure_engines_dir, scan_ai_root};
pub use config_dir::{backup_broken_config, load_config, save_config};
pub use engine::bridge::{
    analyze_with_depth, analyze_with_time, apply_engine_settings, get_analysis_result,
    get_analysis_status, get_engine_info, get_engine_settings, get_last_result, initialize_engine,
    set_position, shutdown_engine, start_infinite_analysis, stop_analysis,
};
pub use engine::game::bridge::{
    abort_game, close_game, continue_game, end_game_by_rule, get_game_state, list_games,
    resign_game, start_game, submit_game_move,
};
pub use engine_presets::{load_presets, save_presets};
pub use file_system::{
    create_directory, create_kifu_file, delete_directory, delete_file, get_file_tree,
    import_kifu_file, mv_directory, mv_kifu_file, read_file, rename_directory, rename_kifu_file,
    save_kifu_file,
};
pub use kifu::{convert_jkf_to_format, normalize_jkf, write_kifu_to_file};
pub use search::api::{cancel_search, open_project, search_position, SearchState};
pub use search::index_store::IndexStore;
pub use study_positions::{load_study_positions, save_study_positions};

use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

/// 終了時にエンジンを落とすのに使える時間の合計。
///
/// 1本あたりの上限は `registry` 側（`KILL_TIMEOUT`）と書き込みの列
/// （`WRITE_TIMEOUT`）にあるが、**エンジンは複数走りうる**ので全体にも要る。
/// 超えたらプロセスを残したまま終わる。終了が止まるよりましだという判断
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(IndexStore::new());
    let search_state = SearchState::new(store);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            backup_broken_config,
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
            create_ai_profile_dirs,
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
            start_game,
            submit_game_move,
            continue_game,
            end_game_by_rule,
            resign_game,
            abort_game,
            close_game,
            get_game_state,
            list_games,
            open_project,
            search_position,
            cancel_search,
            load_study_positions,
            save_study_positions,
        ])
        .plugin(tauri_plugin_dialog::init())
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // **終了時にエンジンを落とす。** 呼ばないとプロセスが残る
            // （不変条件5）。対局は `close_game` を呼ぶまで落ちない作りなので、
            // ウィンドウを閉じただけでは先手・後手のエンジンが探索したまま残り、
            // 利用者にはアクティビティモニタ以外に手掛かりが無い。
            //
            // `ExitRequested` は「終わる直前」で、まだ非同期を回せる。
            // 全体に上限を置くのは、詰まったエンジン1本で終了が止まらないため
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app.state::<AppState>();
                let games = Arc::clone(&state.games);
                let registry = Arc::clone(&state.registry);

                tauri::async_runtime::block_on(async move {
                    let left = tokio::time::timeout(SHUTDOWN_TIMEOUT, async {
                        let left = games.close_all(&registry).await;
                        registry.shutdown_all().await;
                        left
                    })
                    .await;

                    match left {
                        Ok(left) if left.is_empty() => {}
                        Ok(left) => log::warn!(
                            target: "obs_shogi::lib",
                            "shutdown: {} game(s) could not be closed: {left:?}",
                            left.len()
                        ),
                        Err(_) => log::error!(
                            target: "obs_shogi::lib",
                            "shutdown: timed out; engine processes may be left running"
                        ),
                    }
                });
            }
        });
}
