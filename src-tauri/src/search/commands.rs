//! 検索とプロジェクトを開くコマンドの入口。

use std::{path::PathBuf, sync::Arc, time::Duration};

use tauri::{AppHandle, Emitter, State};

use crate::search::build::build_full_index_task;
use crate::search::cache::index_cache;
use crate::search::read::fs_scan::{scan_kifu_files, ScanOptions};
use crate::search::state::SearchState;
use crate::search::store::index_store::IndexState as StoreIndexState;
use crate::search::types::{
    CancelSearchInput, IndexState, IndexStatePayload, OpenProjectInput, OpenProjectOutput,
    SearchPositionInput, SearchPositionOutput, EVT_INDEX_STATE,
};

/// 局面検索コマンド（イベントで結果を返す）。
///
/// `request_id` を即 return し、検索本体は background spawn する。結果と進捗は
/// `EVT_SEARCH_*` で push される。
#[tauri::command]
pub async fn search_position(
    state: State<'_, SearchState>,
    input: SearchPositionInput,
) -> Result<SearchPositionOutput, String> {
    log::debug!("[cmd] search_position invoked");
    state.query.clone().start_search(input).await
}

/// 進行中の検索をキャンセル。フロントの cleanup で呼ぶ。
#[tauri::command]
pub async fn cancel_search(
    state: State<'_, SearchState>,
    input: CancelSearchInput,
) -> Result<(), String> {
    log::debug!("[cmd] cancel_search rid={}", input.request_id);
    state.query.cancel(input.request_id);
    Ok(())
}

#[tauri::command]
// TODO(#215): `input.root_dir` を無検証で受け、その下を歩いて棋譜を読む。
// ワークスペースの root を決める前に呼ばれるので `validate_under_root` を掛けられない。
// 免除は `tests/root_guard.rs` の EXEMPT に理由つきで並べてある
pub async fn open_project(
    app: AppHandle,
    state: State<'_, SearchState>,
    input: OpenProjectInput,
) -> Result<OpenProjectOutput, String> {
    let store = state.store.clone();
    let project = state.project.clone();

    let root_dir = PathBuf::from(input.root_dir);

    log::info!("[open_project] BEGIN root_dir={}", root_dir.display());

    // 0) Restoring state (UIに「復元中」を見せる)
    store.start_restoring();
    let _ = app.emit(
        EVT_INDEX_STATE,
        IndexStatePayload {
            state: IndexState::Restoring,
            dirty_count: 0,
            indexed_files: 0,
            total_files: 0,
        },
    );

    // 1) try restore (cache)
    //
    // 復元はファイルの全読み + zstd の伸長 + 総当たりの復号で、
    // 5万ファイルの索引なら数百ミリ秒 CPU を握る。`async fn` の中で直に呼ぶと
    // その間 tokio のワーカースレッドが1本止まり、同じスレッドに載っている
    // 他のコマンド（`cancel_search` など）が動かない。書き出し側
    // （`save_checkpoint`）は既に逃がしてあるので、読み込み側も揃える
    //
    // 逃がした先が落ちても `open_project` は失敗させない。復元は元来
    // 「だめなら全件作り直す」設計で、**作り直せる以上プロジェクトは開ける**
    let restored = {
        let app2 = app.clone();
        let root2 = root_dir.clone();
        match tauri::async_runtime::spawn_blocking(move || index_cache::try_restore(&app2, &root2))
            .await
        {
            Ok(v) => v,
            Err(e) => Err(format!("索引の復元を実行できませんでした: {e}")),
        }
    };

    match restored {
        Ok(mut restored) => {
            // 念のため（decode側でroot_dirを入れてるなら不要だが安全）
            restored.scan.root_dir = root_dir.clone();

            let total_files = restored.scan.by_path.len() as u32;

            log::info!(
                "[open_project] RESTORE OK total_files={} next_file_id={}",
                total_files,
                restored.next_file_id
            );

            // restore 直後は Updating として install する。
            // watcher 差分反映の前に「Ready」を出すと stale=false の検索結果が
            // 古い snapshot を見るので、 UI が「再スキャン中」を認識できるよう
            // Updating で開示する。
            store.install_restored(
                StoreIndexState::Updating,
                restored.file_table,
                restored.node_tables,
                restored.buckets,
            );

            project
                .install_after_full_build(
                    root_dir.clone(),
                    restored.scan,
                    restored.path_to_id,
                    restored.next_file_id,
                )
                .await;

            let _ = app.emit(
                EVT_INDEX_STATE,
                IndexStatePayload {
                    state: IndexState::Updating,
                    dirty_count: 0,
                    indexed_files: total_files,
                    total_files,
                },
            );

            // watcher 起動（失敗してもopen自体は成功扱いにして良い）
            if let Err(e) = project
                .clone()
                .start_watcher_and_debounce(app.clone(), store.clone(), Duration::from_millis(800))
                .await
            {
                log::warn!("[open_project] watcher start FAILED: {e}");
            } else {
                log::info!("[open_project] watcher started");
            }

            // 裏で差分反映 — 完了時に Ready (または変化なしなら即 Ready) を emit する。
            let pm = project.clone();
            let st = store.clone();
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                log::debug!("[open_project] spawn run_rescan_diff_apply");
                pm.run_rescan_diff_apply(app2.clone(), st.clone()).await;
                // 差分が無くて run_rescan_diff_apply が早期 return した場合、
                // store の state は Updating のまま。 Ready に確実に上げ直す。
                st.set_state(StoreIndexState::Ready);
                let total_files = st.snapshot().file_table.len() as u32;
                let _ = app2.emit(
                    EVT_INDEX_STATE,
                    IndexStatePayload {
                        state: IndexState::Ready,
                        dirty_count: 0,
                        indexed_files: total_files,
                        total_files,
                    },
                );
                log::debug!("[open_project] run_rescan_diff_apply done");
            });

            log::info!("[open_project] END (restore path) total_files={total_files}");
            return Ok(OpenProjectOutput { total_files });
        }
        Err(e) => {
            log::warn!("[open_project] RESTORE FAILED: {e} -> fallback full build");
        }
    }

    // 2) restore 失敗 → full build
    store.start_full_build();

    let records = scan_kifu_files(&root_dir, &ScanOptions::default()).map_err(|e| e.to_string())?;
    let total_files = records.len() as u32;

    log::info!(
        "[open_project] FULL BUILD start total_files={}",
        total_files
    );

    let _ = app.emit(
        EVT_INDEX_STATE,
        IndexStatePayload {
            state: IndexState::Building,
            dirty_count: 0,
            indexed_files: 0,
            total_files,
        },
    );

    tauri::async_runtime::spawn(build_full_index_task(
        app,
        store,
        Arc::clone(&project),
        root_dir,
        records,
        total_files,
    ));

    log::info!("[open_project] END (full build path) total_files={total_files}");
    Ok(OpenProjectOutput { total_files })
}
