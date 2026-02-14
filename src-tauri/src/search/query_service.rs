use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use crate::search::types::FileId;

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
}

impl QueryService {
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            store,
            next_request_id: AtomicU64::new(1),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.write().await = Some(handle);
    }

    pub async fn search_position_impl(&self, input: SearchPositionInput) -> SearchPositionOutput {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);

        let handle = self.app_handle.read().await.clone();
        let Some(handle) = handle else {
            // AppHandle が未注入でも request_id は返す（UIがpollするなら使える）
            return SearchPositionOutput { request_id };
        };

        let stale = {
            let snap = self.store.snapshot();
            snap.state != StoreIndexState::Ready
        };

        let _ = handle.emit(EVT_SEARCH_BEGIN, SearchBeginPayload { request_id, stale });

        let chunk_size = (input.chunk_size.clamp(1, 10_000)) as usize;

        match position_key_from_sfen(&input.sfen) {
            Ok(key) => {
                let hits = self.store.search_by_key(key);

                let snap = self.store.snapshot();
                let ft = snap.file_table.clone();

                for chunk in hits.chunks(chunk_size) {
                    let chunk_vec = chunk.to_vec();

                    let mut map: HashMap<FileId, String> = HashMap::new();
                    for h in &chunk_vec {
                        let fid = h.occ.file_id;
                        if map.contains_key(&fid) {
                            continue;
                        }
                        if let Some(e) = ft.get(fid) {
                            map.insert(fid, e.path.clone());
                        } else {
                            // 通常ここには来ない想定（aliveなら file_table に居るはず）
                            map.insert(fid, String::new());
                        }
                    }

                    let files = map
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
                            chunk: chunk.to_vec(),
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

        SearchPositionOutput { request_id }
    }
}
