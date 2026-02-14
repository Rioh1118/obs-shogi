use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, State};
use tokio::task;

use crate::search::{
    fs_scan::snapshot_from_records,
    project_manager::ProjectManager,
    query_service::QueryService,
    types::{SearchPositionInput, SearchPositionOutput},
};

use super::{
    fs_scan::{scan_kifu_files, ScanOptions},
    index_builder::{bucketize_entries, build_index_for_jkf, BuildPolicy},
    index_store::IndexStore,
    kifu_reader::read_to_jkf,
    segment::Segment,
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
    // 決定性のためパスでソートして FileId を安定化
    records.sort_by(|a, b| a.path.cmp(&b.path));

    // Step2で使う：scan snapshot（path_keyは snapshot_from_records の実装に従う）
    let scan = snapshot_from_records(&root_dir, records.clone());

    let mut file_table = super::file_table::FileTable::default();
    let mut buckets: [Vec<Arc<Segment>>; 256] = std::array::from_fn(|_| Vec::new());

    // Step2で使う：path_key -> file_id
    let mut path_to_id: HashMap<String, FileId> = HashMap::with_capacity(records.len());

    let mut indexed_ok: u32 = 0;
    let mut last_progress_emit = Instant::now();

    for (i, rec) in records.into_iter().enumerate() {
        let file_id: FileId = (i as u32) + 1;
        let path_str = rec.path.to_string_lossy().to_string();

        let path_key = path_str.clone();
        path_to_id.insert(path_key, file_id);

        let file_entry = FileEntry {
            file_id,
            path: path_str.clone(),
            deleted: false,
            gen: 1,
        };
        file_table.upsert(file_entry.clone());

        // 重い部分は spawn_blocking
        let rec_clone = rec.clone();
        let res = task::spawn_blocking(move || -> Result<_, String> {
            let jkf = read_to_jkf(&rec_clone).map_err(|e| e.to_string())?;
            let built = build_index_for_jkf(file_id, 1, &jkf, BuildPolicy::Loose)
                .map_err(|e| e.to_string())?;
            let by_bucket = bucketize_entries(built.entries);
            Ok((by_bucket, built.warns))
        })
        .await;

        match res {
            Ok(Ok((entries_by_bucket, warns))) => {
                for w in warns {
                    let _ = app.emit(
                        EVT_INDEX_WARN,
                        IndexWarnPayload {
                            path: path_str.clone(),
                            message: format!("{:?}: {}", w.cursor, w.message),
                        },
                    );
                }

                for (b, v) in entries_by_bucket.into_iter().enumerate() {
                    if v.is_empty() {
                        continue;
                    }
                    buckets[b].push(Arc::new(Segment::new_sorted(v)));
                }

                indexed_ok += 1;
            }
            Ok(Err(e)) => {
                let _ = app.emit(
                    EVT_INDEX_WARN,
                    IndexWarnPayload {
                        path: path_str.clone(),
                        message: e,
                    },
                );
            }
            Err(join_err) => {
                let _ = app.emit(
                    EVT_INDEX_WARN,
                    IndexWarnPayload {
                        path: path_str.clone(),
                        message: format!("spawn_blocking join error: {join_err}"),
                    },
                );
            }
        }

        // progress emit（最短100ms）
        if last_progress_emit.elapsed() >= Duration::from_millis(100) {
            let _ = app.emit(
                EVT_INDEX_PROGRESS,
                IndexProgressPayload {
                    current_path: path_str.clone(),
                    done_files: (i as u32) + 1,
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
            last_progress_emit = Instant::now();
        }
    }

    store.commit_full_build(file_table, buckets);

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

    project
        .install_after_full_build(root_dir.clone(), scan, path_to_id, next_file_id)
        .await;

    let _ = project
        .clone()
        .start_watcher_and_debounce(app.clone(), store.clone(), Duration::from_millis(800))
        .await;
}
