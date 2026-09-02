//! Tauri コマンドが共有する持ち物。
//!
//! **解析にも対局にも属さない場所に置く。** 解析側（`engine::bridge`）に
//! 置くと、対局のコマンド（`engine::game::bridge`）がそこを `use` する一方で、
//! 解析側は `engine::game::manager` を持つので、**モジュールが環になる**。
//! 環があると「どちらが土台か」が言えず、片方を読むのにもう片方が要る。
//!
//! ここは型を持つだけで、解析も対局も知らない——両方から見て下にある。

use std::sync::Arc;

use super::bridge::EngineBridge;
use super::game::manager::GameManager;
use super::registry::EngineRegistry;

/// Tauri の `State` に載せる持ち物。
///
/// **台帳は1つ。** 解析と対局で分けると、同じ実行ファイルを二重に起動する
/// （どちらの台帳にも載らないプロセスができ、掃除が届かない）。
pub struct AppState {
    pub bridge: Arc<EngineBridge>,
    pub registry: Arc<EngineRegistry>,
    pub games: Arc<GameManager>,
}

impl AppState {
    pub fn new() -> Self {
        let registry = Arc::new(EngineRegistry::new());
        Self {
            bridge: Arc::new(EngineBridge::new(Arc::clone(&registry))),
            registry,
            games: Arc::new(GameManager::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
