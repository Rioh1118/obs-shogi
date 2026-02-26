use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, State};
use tokio::{sync::Semaphore, task::JoinSet};

use crate::search::{
    fs_scan::snapshot_from_records,
    node_table::NodeTable,
    position_key::PositionKey,
    project_manager::ProjectManager,
    query_service::QueryService,
    types::{Occurrence, SearchPositionInput, SearchPositionOutput},
};

use super::{
    fs_scan::{scan_kifu_files, ScanOptions},
    index_builder::{bucketize_entries, build_index_for_jkf, BuildPolicy},
    index_store::{IndexState as StoreIndexState, IndexStore},
    kifu_reader::read_to_jkf,
    types::{
        FileEntry, FileId, IndexProgressPayload, IndexState, IndexStatePayload, IndexWarnPayload,
        OpenProjectInput, OpenProjectOutput, EVT_INDEX_PROGRESS, EVT_INDEX_STATE, EVT_INDEX_WARN,
    },
};

/// search モジュールの Tauri State
///
/// - QueryService が emit するために AppHandle を保持する
/// - IndexStore は QueryService が参照する
pub struct SearchState {
    pub store: Arc<IndexStore>,
    pub query: Arc<QueryService>,
    pub project: Arc<ProjectManager>,
}

impl SearchState {
    pub fn new(store: Arc<IndexStore>) -> Self {
        let query = Arc::new(QueryService::new(store.clone()));
        let project = Arc::new(ProjectManager::new());
        Self {
            store,
            query,
            project,
        }
    }

    /// setup で AppHandle を流し込む用
    pub async fn set_app_handle(&self, handle: AppHandle) {
        self.query.set_app_handle(handle).await;
    }
}

/// 局面検索コマンド（イベントで結果を返す）
///
/// 戻り値は request_id のみ（結果は EVT_* で push）
#[tauri::command]
pub async fn search_position(
    state: State<'_, SearchState>,
    input: SearchPositionInput,
) -> Result<SearchPositionOutput, String> {
    log::debug!("[cmd] search_position invoked");
    Ok(state.query.search_position_impl(input).await)
}

#[tauri::command]
pub async fn open_project(
    app: AppHandle,
    state: State<'_, crate::search::api::SearchState>,
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
    match crate::search::index_cache::try_restore(&app, &root_dir) {
        Ok(mut restored) => {
            // 念のため（decode側でroot_dirを入れてるなら不要だが安全）
            restored.scan.root_dir = root_dir.clone();

            let total_files = restored.scan.by_path.len() as u32;

            log::info!(
                "[open_project] RESTORE OK total_files={} next_file_id={}",
                total_files,
                restored.next_file_id
            );

            // restore直後は Ready として install する（検索がすぐ動く）
            store.install_restored(
                StoreIndexState::Ready,
                restored.file_table,
                restored.node_tables,
                restored.buckets,
            );

            // ProjectManager にも復元状態を入れる（watcher/run_rescan_diff_applyが必要）
            project
                .install_after_full_build(
                    root_dir.clone(),
                    restored.scan,
                    restored.path_to_id,
                    restored.next_file_id,
                )
                .await;

            // UIへ Ready を通知（モーダルを後から開いても final refresh が走る）
            let _ = app.emit(
                EVT_INDEX_STATE,
                IndexStatePayload {
                    state: IndexState::Ready,
                    dirty_count: 0,
                    indexed_files: total_files, // 325とか
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

            // 裏で差分反映（必要なら Updating→Ready が飛ぶ）
            // dirty=0 なら何もせず return するが、すでに Ready を emit 済みなので問題なし
            let pm = project.clone();
            let st = store.clone();
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                log::debug!("[open_project] spawn run_rescan_diff_apply");
                pm.run_rescan_diff_apply(app2, st).await;
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
        project,
        root_dir,
        records,
        total_files,
    ));

    log::info!("[open_project] END (full build path) total_files={total_files}");
    Ok(OpenProjectOutput { total_files })
}

async fn build_full_index_task(
    app: AppHandle,
    store: Arc<IndexStore>,
    project: Arc<ProjectManager>,
    root_dir: PathBuf,
    mut records: Vec<super::fs_scan::FileRecord>,
    total_files: u32,
) {
    type BucketEntries = [Vec<(PositionKey, Occurrence)>; 256];
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

    store.set_state(StoreIndexState::Building);

    const COMMIT_BATCH: usize = 64;
    const EMIT_INTERVAL: Duration = Duration::from_millis(100);

    let mut batch: Vec<(FileEntry, Arc<NodeTable>, BucketEntries)> =
        Vec::with_capacity(COMMIT_BATCH);

    let mut done_files: u32 = 0;
    let mut indexed_ok: u32 = 0;
    let mut last_emit = Instant::now();

    for (i, rec) in records.into_iter().enumerate() {
        let permit = sem.clone().acquire_owned().await.unwrap();

        let rec2 = rec.clone();
        let file_id: FileId = (i as u32) + 1;
        let gen: u32 = 1;
        let path_str = rec.path.to_string_lossy().to_string();

        join.spawn(async move {
            let _permit = permit;

            let res = tokio::task::spawn_blocking(
                move || -> Result<(BucketEntries, Arc<NodeTable>, Vec<String>), String> {
                    let jkf = read_to_jkf(&rec2).map_err(|e| e.to_string())?;
                    let built = build_index_for_jkf(file_id, gen, &jkf, BuildPolicy::Loose)
                        .map_err(|e| e.to_string())?;

                    let by_bucket: BucketEntries = bucketize_entries(built.entries);

                    let warns = built
                        .warns
                        .into_iter()
                        .map(|w| format!("{:?}: {}", w.cursor, w.message))
                        .collect::<Vec<_>>();

                    Ok((by_bucket, built.node_table, warns))
                },
            )
            .await;

            let empty: BucketEntries = std::array::from_fn(|_| Vec::new());
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
            store.insert_many_file_segments(std::mem::take(&mut batch));
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
        store.insert_many_file_segments(batch);
    }

    store.set_state(StoreIndexState::Ready);

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
            let _ = crate::search::index_cache::save_checkpoint(
                &app2,
                &root2,
                &snap,
                &scan2,
                &path_to_id2,
                next2,
            );
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
