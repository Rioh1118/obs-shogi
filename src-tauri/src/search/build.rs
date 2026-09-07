//! 全件構築を1回まわす。
//!
//! **警告と進捗をどう出すかはここが持つ。** 差分更新（`project_manager`）とは
//! 呼び手が違うだけで、1ファイルを索引に入れる手順は `index::file_build` を共有する。

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};
use tokio::{sync::Semaphore, task::JoinSet};

use crate::search::announce::{
    announce_progress, announce_state, build_failure, warn_build_not_started, IndexAnnouncement,
    IndexProgress,
};
use crate::search::cache::format;
use crate::search::index::file_build::build_file_index;
use crate::search::project_manager::ProjectManager;
use crate::search::read::fs_scan::{snapshot_from_records, FileRecord};
use crate::search::store::bucket::{empty_buckets, BucketEntries};
use crate::search::store::index_store::IndexStore;
use crate::search::store::node_table::NodeTable;
use crate::search::store::snapshot::IndexState as StoreIndexState;
use crate::search::types::{
    FileEntry, FileId, IndexProgressPayload, IndexWarnPayload, EVT_INDEX_PROGRESS, EVT_INDEX_WARN,
};

/// 全件構築のタスクに渡すもの。
///
/// **走査の結果と、据え直しの代を1つにまとめる。** どれも構築の末尾まで
/// 持ち回る必要があり、引数に並べると呼び手が順を取り違える。
pub struct FullBuild {
    pub root_dir: PathBuf,
    pub records: Vec<FileRecord>,
    pub total_files: u32,
    /// `IndexStore::restart` が返した代。**据え終わるまで持ち回る**
    pub epoch: u64,
    /// 走査で読めなかった場所があったか。**構築の結末まで持ち回る**
    /// ——`Building` にだけ載せると、`Ready` が上書きして画面から消える
    pub partially_unreadable: bool,
}

/// 棋譜を1つずつ読んで索引を全件作る。
///
/// **空の `Building` から呼ぶこと。** 直前に `store.restart(Restart::Building)` を
/// 通す（いまの呼び手は `search/commands.rs` の `open_project`）。
///
/// **2回目の `open` が来ても、この構築は止まらない。** そのとき索引は別のものへ
/// 差し替わっているので、書き込みは全部 `IndexStore::update_if_epoch` を通し、
/// **代が変わっていたら書かずに抜ける。**
///
/// **代（`epoch`）は呼び手が渡す。** ここで `snapshot().epoch` を拾うと、
/// `restart` から spawn までの間（`open_project` は全走査を挟む）に
/// 別の `open` が入ったとき**他人の代を掴む。**
///
/// 前提が破れて始められなかったときは `EVT_INDEX_WARN` を出して帰る
/// （段は動かさない —— そのとき索引の持ち主は別のタスク）。
///
/// 中身の残った索引に流すと壊れる。`file_id` を 1 から振り直し `gen` は常に 1 なので、
/// 前の索引の同じ `file_id` の出現が桶に残ったまま**生きている扱いで**新しい節表に
/// 当たり、**押すと違う局面が出るヒット**になる（`search/query_service.rs` の
/// `cursor_lite` の腕）。`stale` も構築中ずっと `false` のままになる。
pub async fn build_full_index_task(
    app: AppHandle,
    store: Arc<IndexStore>,
    project: Arc<ProjectManager>,
    build: FullBuild,
) {
    let FullBuild {
        root_dir,
        mut records,
        total_files,
        epoch,
        partially_unreadable,
    } = build;
    type BuildItem = (
        FileId,
        u32,
        String,
        BucketEntries,
        Arc<NodeTable>,
        Vec<String>,
        bool,
    );

    records.sort_by(|a, b| a.path.cmp(&b.path));
    let scan = snapshot_from_records(&root_dir, records.clone());

    let mut path_to_id: HashMap<String, FileId> = HashMap::with_capacity(records.len());
    for (i, rec) in records.iter().enumerate() {
        let file_id: FileId = (i as u32) + 1;
        let path_key = rec.path.to_string_lossy().to_string();
        path_to_id.insert(path_key, file_id);
    }

    // 呼び手が渡した代の、空の `Building` であること。**破れたら書かずに帰る。**
    //
    // 半端に書き込むと `file_id` が衝突して、違う局面のヒットが黙って出る。
    // 索引が作られない方が観測できる。
    {
        let Some(snap) = store.snapshot_if_epoch(epoch) else {
            log::error!("[build] 索引が別の代に差し替わっている。索引は作らない");
            return;
        };
        if snap.state != StoreIndexState::Building || !snap.file_table.is_empty() {
            log::error!(
                "[build] 全件構築を空の Building 以外から始めようとした (state={:?} files={})",
                snap.state,
                snap.file_table.len()
            );
            warn_build_not_started(&app, &root_dir);
            return;
        }
    }

    let conc = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(2, 8);

    let sem = Arc::new(Semaphore::new(conc));
    let mut join: JoinSet<BuildItem> = JoinSet::new();

    const COMMIT_BATCH: usize = 64;

    let mut batch: Vec<(FileEntry, Arc<NodeTable>, BucketEntries)> =
        Vec::with_capacity(COMMIT_BATCH);

    let mut done_files: u32 = 0;
    let mut indexed_ok: u32 = 0;
    let mut last_emit = Instant::now();

    for (i, rec) in records.into_iter().enumerate() {
        let permit = match sem.clone().acquire_owned().await {
            Ok(p) => p,
            Err(e) => {
                log::error!("[open_project] semaphore closed: {e}");
                break;
            }
        };

        let rec2 = rec.clone();
        let file_id: FileId = (i as u32) + 1;
        let gen: u32 = 1;
        let path_str = rec.path.to_string_lossy().to_string();

        join.spawn(async move {
            let _permit = permit;

            let res = tokio::task::spawn_blocking(
                move || -> Result<(BucketEntries, Arc<NodeTable>, Vec<String>, bool), String> {
                    let built = build_file_index(&rec2, file_id, gen)?;
                    Ok((
                        built.by_bucket,
                        built.node_table,
                        built.warns,
                        built.indexed,
                    ))
                },
            )
            .await;

            let empty: BucketEntries = empty_buckets();
            let empty_nt = Arc::new(NodeTable::empty());

            let out: BuildItem = match res {
                Ok(Ok((by_bucket, node_table, warns, indexed))) => {
                    // **`Ok` を「入った」と読まない。** 読めたが入れる局面が
                    // 無い棋譜も `Ok` で返る（`FileBuild::indexed` の doc）
                    (
                        file_id, gen, path_str, by_bucket, node_table, warns, indexed,
                    )
                }
                Ok(Err(e)) => (file_id, gen, path_str, empty, empty_nt, vec![e], false),
                Err(e) => {
                    // **理由はログへ。** 画面には内部の綴りを出さない
                    log::warn!("[index] 索引を組む仕事が落ちた（file_id={file_id}）: {e}");
                    (
                        file_id,
                        gen,
                        path_str,
                        empty,
                        empty_nt,
                        vec![build_failure()],
                        false,
                    )
                }
            };

            out
        });
    }

    while let Some(r) = join.join_next().await {
        let (file_id, gen, path_str, by_bucket, node_table, warns, ok) = match r {
            Ok(v) => v,
            Err(_join_err) => {
                done_files += 1;
                continue;
            }
        };

        done_files += 1;
        if ok {
            indexed_ok += 1;
        }

        for w in warns {
            let _ = app.emit(EVT_INDEX_WARN, IndexWarnPayload::file(path_str.clone(), w));
        }

        let file_entry = FileEntry {
            file_id,
            path: path_str.clone(),
            deleted: false,
            // 組めなかった棋譜も表には載る。**見分けはこの欄だけ**
            // （`FileEntry::indexed` の doc）
            indexed: ok,
            gen,
        };

        batch.push((file_entry, node_table, by_bucket));

        if batch.len() >= COMMIT_BATCH {
            let items = std::mem::take(&mut batch);
            if !store.update_if_epoch(epoch, |s| s.with_files(items)) {
                log::warn!("[build] 索引が別の代に差し替わったので、全件構築をやめる");
                return;
            }
        }

        if last_emit.elapsed() >= crate::search::announce::EMIT_INTERVAL {
            let _ = app.emit(
                EVT_INDEX_PROGRESS,
                IndexProgressPayload {
                    current_path: path_str.clone(),
                    done_files,
                    total_files,
                },
            );
            announce_progress(
                &app,
                &store,
                epoch,
                IndexProgress::Building {
                    total: total_files,
                    indexed: indexed_ok,
                    partially_unreadable,
                },
            );
            last_emit = Instant::now();
        }
    }

    if !batch.is_empty() && !store.update_if_epoch(epoch, |s| s.with_files(batch)) {
        log::warn!("[build] 索引が別の代に差し替わったので、全件構築をやめる");
        return;
    }

    if !store.update_if_epoch(epoch, |s| s.with_state(StoreIndexState::Ready)) {
        log::warn!("[build] 索引が別の代に差し替わったので、全件構築をやめる");
        return;
    }

    // 最終 progress を必ず 1 回 emit する。 EMIT_INTERVAL の谷で
    // 取りこぼした場合、 reducer の doneFiles が total_files に達しないまま
    // Ready に飛ぶことを防ぐ。
    let _ = app.emit(
        EVT_INDEX_PROGRESS,
        IndexProgressPayload {
            current_path: String::new(),
            done_files,
            total_files,
        },
    );

    // **状態を出す口は1つ。** 自分で組むと、旗が増えたときにここが伏せて出す
    announce_state(
        &app,
        &store,
        epoch,
        // **件数は渡さない。** 組めた数は `FileEntry::indexed` として索引が
        // 覚えているので、`announce_state` が数える
        IndexAnnouncement::Built {
            partially_unreadable,
        },
    );

    let next_file_id = (total_files as FileId).wrapping_add(1).max(1);

    {
        // **保存も代を見る。** 拾い直すと、別の `open` が差し替えた索引を
        // このプロジェクトの名前で焼いてしまう
        let Some(snap) = store.snapshot_if_epoch(epoch) else {
            log::warn!("[build] 索引が別の代に差し替わったので、チェックポイントを書かない");
            return;
        };
        let scan2 = scan.clone(); // ScanSnapshot (clone ok)
        let path_to_id2 = path_to_id.clone(); // HashMap clone
        let root2 = root_dir.clone();
        let app2 = app.clone();
        let next2 = next_file_id;

        tauri::async_runtime::spawn_blocking(move || {
            match crate::storage::app_cache(&app2, "index") {
                Ok(blobs) => {
                    let _ =
                        format::save_checkpoint(&blobs, &root2, &snap, &scan2, &path_to_id2, next2);
                }
                Err(e) => log::error!("[index cache] チェックポイントの置き場を作れない: {e}"),
            }
        });
    }

    // **据えられなかったら、watcher も起こさない。** 据え直された後に
    // 起こすと、新しいプロジェクトの根を前のプロジェクトの watcher が見張る
    if !project
        .install_after_full_build(epoch, root_dir.clone(), scan, path_to_id, next_file_id)
        .await
    {
        return;
    }

    let _ = project
        .clone()
        .start_watcher_and_debounce(
            app.clone(),
            store.clone(),
            Duration::from_millis(800),
            epoch,
        )
        .await;
}
