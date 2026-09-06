//! Tauri が持つ検索の持ち物。

use std::sync::Arc;

use tauri::AppHandle;

use crate::search::project_manager::ProjectManager;
use crate::search::query_service::QueryService;
use crate::search::store::index_store::IndexStore;

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
