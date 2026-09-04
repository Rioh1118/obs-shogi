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

use crate::search::cache::index_cache;
use crate::search::index::file_build::build_file_index;
use crate::search::project_manager::ProjectManager;
use crate::search::read::fs_scan::{snapshot_from_records, FileRecord};
use crate::search::store::bucket::{empty_buckets, BucketEntries};
use crate::search::store::index_store::IndexStore;
use crate::search::store::node_table::NodeTable;
use crate::search::store::snapshot::IndexState as StoreIndexState;
use crate::search::types::{
    FileEntry, FileId, IndexProgressPayload, IndexState, IndexStatePayload, IndexWarnPayload,
    EVT_INDEX_PROGRESS, EVT_INDEX_STATE, EVT_INDEX_WARN,
};

pub async fn build_full_index_task(
    app: AppHandle,
    store: Arc<IndexStore>,
    project: Arc<ProjectManager>,
    root_dir: PathBuf,
    mut records: Vec<FileRecord>,
    total_files: u32,
) {
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

    let conc = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(2, 8);

    let sem = Arc::new(Semaphore::new(conc));
    let mut join: JoinSet<BuildItem> = JoinSet::new();

    store.update(|s| s.with_state(StoreIndexState::Building));

    const COMMIT_BATCH: usize = 64;
    const EMIT_INTERVAL: Duration = Duration::from_millis(100);

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
                move || -> Result<(BucketEntries, Arc<NodeTable>, Vec<String>), String> {
                    let built = build_file_index(&rec2, file_id, gen)?;
                    Ok((built.by_bucket, built.node_table, built.warns))
                },
            )
            .await;

            let empty: BucketEntries = empty_buckets();
            let empty_nt = Arc::new(NodeTable::empty());

            let out: BuildItem = match res {
                Ok(Ok((by_bucket, node_table, warns))) => {
                    (file_id, gen, path_str, by_bucket, node_table, warns, true)
                }
                Ok(Err(e)) => (file_id, gen, path_str, empty, empty_nt, vec![e], false),
                Err(e) => (
                    file_id,
                    gen,
                    path_str,
                    empty,
                    empty_nt,
                    vec![format!("spawn_blocking join error: {e}")],
                    false,
                ),
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
            let _ = app.emit(
                EVT_INDEX_WARN,
                IndexWarnPayload {
                    path: path_str.clone(),
                    message: w,
                },
            );
        }

        let file_entry = FileEntry {
            file_id,
            path: path_str.clone(),
            deleted: false,
            gen,
        };

        batch.push((file_entry, node_table, by_bucket));

        if batch.len() >= COMMIT_BATCH {
            let items = std::mem::take(&mut batch);
            store.update(|s| s.with_files(items));
        }

        if last_emit.elapsed() >= EMIT_INTERVAL {
            let _ = app.emit(
                EVT_INDEX_PROGRESS,
                IndexProgressPayload {
                    current_path: path_str.clone(),
                    done_files,
                    total_files,
                },
            );
            let _ = app.emit(
                EVT_INDEX_STATE,
                IndexStatePayload {
                    state: IndexState::Building,
                    dirty_count: 0,
                    indexed_files: indexed_ok,
                    total_files,
                },
            );
            last_emit = Instant::now();
        }
    }

    if !batch.is_empty() {
        store.update(|s| s.with_files(batch));
    }

    store.update(|s| s.with_state(StoreIndexState::Ready));

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

    let _ = app.emit(
        EVT_INDEX_STATE,
        IndexStatePayload {
            state: IndexState::Ready,
            dirty_count: 0,
            indexed_files: indexed_ok,
            total_files,
        },
    );

    let next_file_id = (total_files as FileId).wrapping_add(1).max(1);

    {
        let snap = store.snapshot(); // Arc<IndexSnapshot>
        let scan2 = scan.clone(); // ScanSnapshot (clone ok)
        let path_to_id2 = path_to_id.clone(); // HashMap clone
        let root2 = root_dir.clone();
        let app2 = app.clone();
        let next2 = next_file_id;

        tauri::async_runtime::spawn_blocking(move || {
            let _ = index_cache::save_checkpoint(&app2, &root2, &snap, &scan2, &path_to_id2, next2);
        });
    }

    project
        .install_after_full_build(root_dir.clone(), scan, path_to_id, next_file_id)
        .await;

    let _ = project
        .clone()
        .start_watcher_and_debounce(app.clone(), store.clone(), Duration::from_millis(800))
        .await;
}
