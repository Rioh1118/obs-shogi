pub mod ai_library;
pub mod engine;
pub mod kifu;
pub mod search;
pub mod workspace;

pub use crate::engine::state::AppState;
pub use search::state::SearchState;
pub use search::store::index_store::IndexStore;

use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

/// 終了時に対局を閉じるのに使える時間。
///
/// **1局を閉じ切る最悪値より短い。** 最悪値は `CLOSE_ABORT_TIMEOUT`
/// ＋ `CLOSE_IDLE_TIMEOUT` に、エンジン1本ごとの `WRITE_TIMEOUT`
/// （`quit` を列に通す1件ぶん）＋ `QUIT_GRACE` ＋ `KILL_TIMEOUT` が積まれ、
/// 対局が増えれば伸びる。書き込みの列に先客が居ればさらに伸びるので、
/// 積み上げた値も下限でしかない。
///
/// **式で持つ。** 内訳を散文で数えると、上限を1つ増やしたときに数え直す口が無い。
/// 「合わせに行かない」ことは `src-tauri/tests/engine_timeouts.rs` が固定する
/// （モジュールを跨ぐ関係なので、`#[cfg(test)] mod tests` からは見られない）。
///
/// **合わせに行かない。** 合わせると終了が十数秒待たされる。
/// ここで切り上げた分は下の掃除が拾う。
pub const CLOSE_TIMEOUT: Duration = Duration::from_secs(4);

/// 台帳に残ったプロセスを落とすのに使える時間。
///
/// **`CLOSE_TIMEOUT` と分ける。** 1つの `timeout` で包むと、対局を閉じるのに
/// 使い切ったときに掃除の future が1度も poll されない。
/// **解析用エンジンは掃除からしか届かない**ので、それだけで必ず残る。
pub const SWEEP_TIMEOUT: Duration = Duration::from_secs(4);

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
                .max_file_size(engine::utils::LOG_FILE_BUDGET)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .level(log::LevelFilter::Info)
                .level_for("obs_shogi::engine", log::LevelFilter::Debug)
                .filter(|m| !m.target().starts_with("tao::"))
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            settings::commands::backup_broken_config,
            settings::commands::load_config,
            settings::commands::save_config,
            crate::workspace::commands::tree::get_file_tree,
            crate::workspace::commands::kifu::save_kifu_file,
            crate::workspace::commands::kifu::create_kifu_file,
            crate::workspace::commands::entry::create_directory,
            crate::workspace::commands::entry::delete_file,
            crate::workspace::commands::entry::delete_directory,
            settings::commands::load_presets,
            settings::commands::save_presets,
            crate::workspace::commands::kifu::import_kifu_file,
            crate::workspace::commands::kifu::read_file,
            crate::kifu::commands::write_kifu_to_file,
            crate::workspace::commands::mv::mv_directory,
            crate::ai_library::commands::ensure_engines_dir,
            crate::ai_library::commands::create_ai_profile_dirs,
            crate::ai_library::commands::scan_ai_root,
            crate::workspace::commands::mv::mv_kifu_file,
            crate::workspace::commands::mv::rename_directory,
            crate::workspace::commands::mv::rename_kifu_file,
            crate::kifu::commands::convert_jkf_to_format,
            crate::kifu::commands::normalize_jkf,
            crate::engine::commands::analysis::initialize_engine,
            crate::engine::commands::analysis::shutdown_engine,
            crate::engine::commands::analysis::set_position,
            crate::engine::commands::analysis::start_infinite_analysis,
            crate::engine::commands::analysis::analyze_with_time,
            crate::engine::commands::analysis::analyze_with_depth,
            crate::engine::commands::analysis::stop_analysis,
            crate::engine::commands::analysis::get_analysis_result,
            crate::engine::commands::analysis::get_last_result,
            crate::engine::commands::analysis::apply_engine_settings,
            crate::engine::commands::analysis::get_engine_settings,
            crate::engine::commands::analysis::get_analysis_status,
            crate::engine::commands::analysis::get_engine_info,
            crate::engine::commands::game::start_game,
            crate::engine::commands::game::submit_game_move,
            crate::engine::commands::game::continue_game,
            crate::engine::commands::game::end_game_by_rule,
            crate::engine::commands::game::resign_game,
            crate::engine::commands::game::abort_game,
            crate::engine::commands::game::close_game,
            crate::engine::commands::game::get_game_state,
            crate::engine::commands::game::list_games,
            crate::search::commands::open_project,
            crate::search::commands::search_position,
            crate::search::commands::cancel_search,
            settings::commands::load_study_positions,
            settings::commands::save_study_positions,
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
            // 閉じただけでは先手・後手のエンジンが探索したまま残り、
            // 利用者にはアクティビティモニタ以外に手掛かりが無い。
            //
            // **2つのイベントを両方受ける。** macOS の Cmd+Q は
            // `NSApp terminate:` で、ウィンドウに close を送らずに
            // `applicationWillTerminate:` へ進むので `ExitRequested` が出ない。
            // 届くのは `Exit` だけ。ウィンドウの × は逆に `ExitRequested` を通る。
            // `match` にしてあるのは、バリアントが増えたときに数え直させるため
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    shut_down_engines(app);
                }
                _ => {}
            }
        });
}

/// 起動しているエンジンを全部落とす。**2回目以降は何もしない。**
///
/// **利用者にはこの待ちが見えない。** イベントループを止めて回すので、
/// その間ウィンドウは何も応答しない（最大 `CLOSE_TIMEOUT` ＋ `SWEEP_TIMEOUT`）。
/// 進捗も取り消しも出ない。
/// 落としきれなかったことは `warn` と `error` のログにしか出ない（→ 台帳の F-25）。
///
/// `ExitRequested` と `Exit` は片方だけのことも両方来ることもあるので、
/// 1回に絞る。2回走らせても台帳が空なので害は無いが、
/// **`Exit` の経路では上限を丸ごと使う。** macOS の Cmd+Q は
/// `applicationWillTerminate:` の中でここへ来るので、OS の猶予を超えると
/// 強制終了されうる。`Once` は二重実行を避けるためだけで、この懸念には効かない。
fn shut_down_engines(app: &tauri::AppHandle) {
    static DONE: std::sync::Once = std::sync::Once::new();

    DONE.call_once(|| {
        let state = app.state::<AppState>();
        let games = Arc::clone(&state.games);
        let registry = Arc::clone(&state.registry);

        tauri::async_runtime::block_on(async move {
            // 対局を閉じる。**切り上げてもよい。** 残りは下の掃除が拾う
            match tokio::time::timeout(CLOSE_TIMEOUT, games.close_all()).await {
                Ok(left) if left.is_empty() => {}
                Ok(left) => log::warn!(
                    target: "obs_shogi::lib",
                    "shutdown: {} game(s) could not be closed: {left:?}",
                    left.len()
                ),
                Err(_) => log::warn!(
                    target: "obs_shogi::lib",
                    "shutdown: closing games timed out; falling through to the sweep"
                ),
            }

            // **対局の閉じ方に関わらず必ず走らせる。**
            // 解析用エンジンはここからしか届かない
            if tokio::time::timeout(SWEEP_TIMEOUT, registry.shutdown_all())
                .await
                .is_err()
            {
                log::error!(
                    target: "obs_shogi::lib",
                    "shutdown: sweep timed out; engine processes are left running"
                );
            }
        });
    });
}
