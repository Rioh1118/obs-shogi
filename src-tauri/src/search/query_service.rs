use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::search::types::{CursorLite, FileId, PositionHit, RequestId};

use super::{
    index_store::{IndexState as StoreIndexState, IndexStore},
    sfen_position::position_key_from_sfen,
    types::{
        SearchBeginPayload, SearchChunkPayload, SearchEndPayload, SearchErrorPayload,
        SearchPositionInput, SearchPositionOutput, EVT_SEARCH_BEGIN, EVT_SEARCH_CHUNK,
        EVT_SEARCH_END, EVT_SEARCH_ERROR,
    },
};

#[derive(Debug)]
pub struct QueryService {
    store: Arc<IndexStore>,
    next_request_id: AtomicU64,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    cancellations: Arc<Mutex<HashMap<RequestId, CancellationToken>>>,
}

impl QueryService {
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            store,
            next_request_id: AtomicU64::new(1),
            app_handle: Arc::new(RwLock::new(None)),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.write().await = Some(handle);
    }

    /// Tauri コマンド: 検索を spawn し、request_id を即座に return する。
    /// 旧 search_position_impl と違い invoke はブロックしない (C-H1)。
    pub async fn start_search(
        self: Arc<Self>,
        input: SearchPositionInput,
    ) -> Result<SearchPositionOutput, String> {
        let handle = self.app_handle.read().await.clone();
        let Some(handle) = handle else {
            return Err("search app handle not ready".to_string());
        };

        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let cancel = CancellationToken::new();
        self.cancellations.lock().insert(request_id, cancel.clone());

        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            me.run_search(request_id, input, handle, cancel).await;
        });

        Ok(SearchPositionOutput { request_id })
    }

    /// 進行中の検索をキャンセル (C-H2)。
    pub fn cancel(&self, request_id: RequestId) {
        if let Some(token) = self.cancellations.lock().remove(&request_id) {
            token.cancel();
        }
    }

    async fn run_search(
        &self,
        request_id: RequestId,
        input: SearchPositionInput,
        handle: AppHandle,
        cancel: CancellationToken,
    ) {
        let snap = self.store.snapshot();
        let stale = snap.state != StoreIndexState::Ready;
        let _ = handle.emit(EVT_SEARCH_BEGIN, SearchBeginPayload { request_id, stale });

        let chunk_size = (input.chunk_size.clamp(1, 10_000)) as usize;

        match position_key_from_sfen(&input.sfen) {
            Ok(key) => {
                let occs = snap.search_occurrences_by_key(key);
                let ft = snap.file_table.clone();
                let nts = snap.node_tables.clone();

                for chunk in occs.chunks(chunk_size) {
                    if cancel.is_cancelled() {
                        log::debug!("[query] rid={request_id} cancelled mid-stream");
                        break;
                    }

                    let mut hits: Vec<PositionHit> = Vec::with_capacity(chunk.len());
                    for occ in chunk {
                        let cursor = nts
                            .get(occ.file_id)
                            .and_then(|nt| nt.cursor_lite(occ.node_id))
                            .unwrap_or_else(CursorLite::root);
                        hits.push(PositionHit { occ: *occ, cursor });
                    }

                    let mut file_paths: HashMap<FileId, String> = HashMap::new();
                    for h in &hits {
                        let fid = h.occ.file_id;
                        if file_paths.contains_key(&fid) {
                            continue;
                        }
                        let path = ft.get_path(fid).map(|s| s.to_string()).unwrap_or_default();
                        file_paths.insert(fid, path);
                    }

                    let files = file_paths
                        .into_iter()
                        .map(|(file_id, abs_path)| super::types::FilePathEntry {
                            file_id,
                            abs_path,
                        })
                        .collect::<Vec<_>>();

                    let _ = handle.emit(
                        EVT_SEARCH_CHUNK,
                        SearchChunkPayload {
                            request_id,
                            chunk: hits,
                            files,
                        },
                    );
                }

                let _ = handle.emit(EVT_SEARCH_END, SearchEndPayload { request_id });
            }
            Err(e) => {
                let _ = handle.emit(
                    EVT_SEARCH_ERROR,
                    SearchErrorPayload {
                        request_id,
                        message: e.to_string(),
                    },
                );
            }
        }

        self.cancellations.lock().remove(&request_id);
    }
}
