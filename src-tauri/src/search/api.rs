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
    position_key::PositionKey,
    project_manager::ProjectManager,
    query_service::QueryService,
    types::{PositionHit, SearchPositionInput, SearchPositionOutput},
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
    Ok(state.query.search_position_impl(input).await)
}

#[tauri::command]
pub async fn open_project(
    app: AppHandle,
    state: State<'_, super::api::SearchState>,
    input: OpenProjectInput,
) -> Result<OpenProjectOutput, String> {
    let store = state.store.clone();
    let root_dir = PathBuf::from(input.root_dir);

    // 1) まず Building へ
    store.start_full_build();

    // 2) スキャン
    let records = scan_kifu_files(&root_dir, &ScanOptions::default()).map_err(|e| e.to_string())?;

    let total_files = records.len() as u32;

    // state emit（Building）
    let _ = app.emit(
        EVT_INDEX_STATE,
        IndexStatePayload {
            state: IndexState::Building,
            dirty_count: 0,
            indexed_files: 0,
            total_files,
        },
    );
    let project = state.project.clone();

    // 3) バックグラウンドで構築開始
    tauri::async_runtime::spawn(build_full_index_task(
        app,
        store,
        project,
        root_dir,
        records,
        total_files,
    ));

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
    type BucketEntries = [Vec<(PositionKey, PositionHit)>; 256];
    type BuildItem = (FileId, u32, String, BucketEntries, Vec<String>, bool);
    // 決定性のためパスでソートして FileId を安定化
    records.sort_by(|a, b| a.path.cmp(&b.path));

    // scan snapshot
    let scan = snapshot_from_records(&root_dir, records.clone());

    // let mut file_table = super::file_table::FileTable::default();
    // let mut buckets: [Vec<Arc<Segment>>; 256] = std::array::from_fn(|_| Vec::new());

    // path_key -> file_id
    let mut path_to_id: HashMap<String, FileId> = HashMap::with_capacity(records.len());
    for (i, rec) in records.iter().enumerate() {
        let file_id: FileId = (i as u32) + 1;
        let path_key = rec.path.to_string_lossy().to_string();
        path_to_id.insert(path_key, file_id);
    }

    // 並列数（CPUに合わせて 2..8 程度に制限）
    let conc = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(2, 8);

    let sem = Arc::new(Semaphore::new(conc));
    let mut join: JoinSet<BuildItem> = JoinSet::new();

    store.set_state(StoreIndexState::Building);

    // ---- 設定：コミット頻度 ----
    const COMMIT_BATCH: usize = 64; // まずは 32〜128 で調整
    const EMIT_INTERVAL: Duration = Duration::from_millis(100);

    // batch: insert_many_file_segments 用
    let mut batch: Vec<(FileEntry, BucketEntries)> = Vec::with_capacity(COMMIT_BATCH);

    let mut done_files: u32 = 0;
    let mut indexed_ok: u32 = 0;
    let mut last_emit = Instant::now();

    // タスク投入（file_id/gen はここで確定）
    for (i, rec) in records.into_iter().enumerate() {
        let permit = sem.clone().acquire_owned().await.unwrap();

        let _app2 = app.clone();
        let rec2 = rec.clone();
        let file_id: FileId = (i as u32) + 1;
        let gen: u32 = 1;
        let path_str = rec.path.to_string_lossy().to_string();

        join.spawn(async move {
            let _permit = permit;

            let res = tokio::task::spawn_blocking(
                move || -> Result<(BucketEntries, Vec<String>), String> {
                    let jkf = read_to_jkf(&rec2).map_err(|e| e.to_string())?;
                    let built = build_index_for_jkf(file_id, gen, &jkf, BuildPolicy::Loose)
                        .map_err(|e| e.to_string())?;
                    let by_bucket: BucketEntries = bucketize_entries(built.entries);
                    let warns = built
                        .warns
                        .into_iter()
                        .map(|w| format!("{:?}: {}", w.cursor, w.message))
                        .collect::<Vec<_>>();
                    Ok((by_bucket, warns))
                },
            )
            .await;

            let empty: BucketEntries = std::array::from_fn(|_| Vec::new());

            // ここは BuildItem を返す（Resultにしない）
            let out: BuildItem = match res {
                Ok(Ok((by_bucket, warns))) => (file_id, gen, path_str, by_bucket, warns, true),
                Ok(Err(e)) => (file_id, gen, path_str, empty, vec![e], false),
                Err(e) => (
                    file_id,
                    gen,
                    path_str,
                    empty,
                    vec![format!("spawn_blocking join error: {e}")],
                    false,
                ),
            };

            out
        });
    }

    // 完了したものから回収→batchに積む→一定数でコミット
    while let Some(r) = join.join_next().await {
        let (file_id, gen, path_str, by_bucket, warns, ok) = match r {
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

        batch.push((file_entry, by_bucket));

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

    // 残りをコミット
    if !batch.is_empty() {
        store.insert_many_file_segments(batch);
    }

    // Readyへ
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

    // ProjectManager セットアップ（今まで通り）
    let next_file_id = (total_files as FileId).wrapping_add(1).max(1);

    project
        .install_after_full_build(root_dir.clone(), scan, path_to_id, next_file_id)
        .await;

    let _ = project
        .clone()
        .start_watcher_and_debounce(app.clone(), store.clone(), Duration::from_millis(800))
        .await;
}
