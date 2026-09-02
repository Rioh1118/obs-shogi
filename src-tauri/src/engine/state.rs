//! Tauri コマンドが共有する持ち物。
//!
//! **解析にも対局にも属さない場所に置く。** 解析のファサードと同居させると、
//! 対局のコマンドがそこを `use` する一方で、そのファサードは対局の台帳を
//! 持つので**モジュールが環になる**。環があると「どちらが土台か」が言えず、
//! 片方を読むのにもう片方が要る。
//!
//! **ここは段の上のほう**（`bridge` / `game` / `registry` を束ねる）。
//! 下の段からここを参照しないこと（→ `tests/engine_layering.rs`）。

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
