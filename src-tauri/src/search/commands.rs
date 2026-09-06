//! 検索とプロジェクトを開くコマンドの入口。

use std::{path::PathBuf, sync::Arc, time::Duration};

use tauri::{AppHandle, Emitter, State};

use crate::search::announce::{
    announce_state, scan_failure, warn_scan_failed, warn_unreadable, IndexUiState,
};
use crate::search::build::{build_full_index_task, FullBuild};
use crate::search::cache::format;
use crate::search::read::fs_scan::{scan_kifu_files, ScanError, ScanOptions};
use crate::search::state::SearchState;
use crate::search::store::snapshot::{IndexState as StoreIndexState, Restart};
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
    let _ = store.restart(Restart::Restoring);
    let _ = app.emit(
        EVT_INDEX_STATE,
        IndexStatePayload::of(IndexState::Restoring, 0),
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
        match tauri::async_runtime::spawn_blocking(move || {
            let store = crate::storage::app_cache(&app2, "index").map_err(|e| e.to_string())?;
            format::try_restore(&store, &root2)
        })
        .await
        {
            Ok(v) => v,
            Err(e) => Err(format!("索引の復元を実行できませんでした: {e}")),
        }
    };

    match restored {
        Ok(mut restored) => {
            // 念のため（decode側でroot_dirを入れてるなら不要だが安全）
            restored.scan.snapshot.root_dir = root_dir.clone();

            let total_files = restored.scan.snapshot.by_path.len() as u32;

            log::info!(
                "[open_project] RESTORE OK total_files={} next_file_id={}",
                total_files,
                restored.scan.next_file_id
            );

            // restore 直後は Updating として install する。
            // watcher 差分反映の前に「Ready」を出すと stale=false の検索結果が
            // 古い snapshot を見るので、 UI が「再スキャン中」を認識できるよう
            // Updating で開示する。
            let restore_epoch = store.install_restored(
                restored.index.file_table,
                restored.index.node_tables,
                restored.index.buckets,
            );

            // 据え直されていたら、帳簿も watcher も据えずに引き下がる
            if !project
                .install_after_full_build(
                    restore_epoch,
                    root_dir.clone(),
                    restored.scan.snapshot,
                    restored.scan.path_to_id,
                    restored.scan.next_file_id,
                )
                .await
            {
                log::info!("[open_project] 据え直されたので復元した帳簿を据えない");
                return Ok(OpenProjectOutput { total_files });
            }

            let _ = app.emit(
                EVT_INDEX_STATE,
                IndexStatePayload::of(IndexState::Updating, total_files).indexed(total_files),
            );

            // watcher 起動（失敗してもopen自体は成功扱いにして良い）
            if let Err(e) = project
                .clone()
                .start_watcher_and_debounce(
                    app.clone(),
                    store.clone(),
                    Duration::from_millis(800),
                    restore_epoch,
                )
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
                let outcome = pm.run_rescan_diff_apply(app2.clone(), st.clone()).await;
                // **据え直されたときだけ `Ready` を止める。** 走査が失敗しただけなら
                // 索引は最後に読めたときのまま健全で、差分が当たっていないだけ
                // ——ここで止めると `Updating` が最後の状態になり、検索は永久に
                // `stale`、設定はスピナーのまま。再試行の導線は無いので開き直しても同じ
                // 差分が無くて run_rescan_diff_apply が早期 return した場合、
                // store の state は Updating のまま。 Ready に確実に上げ直す。
                if !st.update_if_epoch(restore_epoch, |s| s.with_state(StoreIndexState::Ready)) {
                    log::warn!("[open_project] 索引が別の代に差し替わったので Ready にしない");
                    return;
                }
                // **状態を出す口は1つ。** 旗を知っているのは結末だけなので、
                // 自分で組むと知らない側が伏せた旗で塗り潰す
                announce_state(&app2, &st, restore_epoch, IndexUiState::Rescanned(outcome));
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
    let build_epoch = store.restart(Restart::Building);

    // **走査も逃がす。** ファイル1件ごとに `metadata` の syscall を回すので、
    // 5万件・ネットワーク越しなら秒の単位。復元を逃がした理由
    // （同じスレッドの `cancel_search` が動かなくなる）がそのまま当てはまる
    let scanned = {
        let root2 = root_dir.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            scan_kifu_files(&root2, &ScanOptions::default())
        })
        .await
        {
            Ok(v) => v,
            Err(e) => {
                // 逃がした先が落ちた場合も、走査できなかったこととして同じ口から出す
                log::warn!("[open_project] 走査を起こせなかった: {e}");
                Err(ScanError::Io(std::io::Error::other("join failed")))
            }
        }
    };
    // **索引を空の `Building` に置き去りにしない。** `restart` が中身を捨てた後
    // なので、ここで抜けると検索は永久に `stale` かつ0件、バッジはスピナーのまま。
    // 再試行の導線は無いので開き直しても同じところで止まる
    let scanned = match scanned {
        Ok(v) => v,
        Err(e) => {
            warn_scan_failed(&app, &root_dir, &e);
            // **`Ready` にしない。** `restart` が中身を捨てた後なので索引は空で、
            // `query_service` の `stale` は段だけを見る——空を `Ready` にすると
            // **0件が「最新」として並ぶ**（`store/index_store.rs` の `//!`）
            announce_state(&app, &store, build_epoch, IndexUiState::BuildFailed);
            // **内部の綴りを返さない。** `openError` に読み手が付いたとき
            // （#403）、`root directory is not readable: /Users/…` が画面に出る
            return Err(scan_failure(&e));
        }
    };
    // **読めなかった場所を黙らせない。** 全件構築では引き継ぐ前回が無いので、
    // その下の棋譜は索引に入らない——検索に出ないことの理由が要る
    // 全件構築には引き継ぐ前回が無いので `carried` は 0
    warn_unreadable(&app, &scanned.unreadable, scanned.unknown_gaps, 0);
    let partial = scanned.is_partial();
    let records = scanned.files;
    let total_files = records.len() as u32;

    log::info!(
        "[open_project] FULL BUILD start total_files={}",
        total_files
    );

    let _ = app.emit(
        EVT_INDEX_STATE,
        // 読めなかった場所があったことを状態にも載せる。警告だけだと
        // 設定タブを開かないかぎり届かず、局面検索は0件を裸で断言する
        IndexStatePayload::of(IndexState::Building, total_files).partially_unreadable(partial),
    );

    tauri::async_runtime::spawn(build_full_index_task(
        app,
        store,
        Arc::clone(&project),
        FullBuild {
            root_dir,
            records,
            total_files,
            epoch: build_epoch,
            partially_unreadable: partial,
        },
    ));

    log::info!("[open_project] END (full build path) total_files={total_files}");
    Ok(OpenProjectOutput { total_files })
}
