//! 走っている対局セッションの台帳。
//!
//! 対局は同時に複数走りうる（検討しながら指す、エンジン同士を2組回す）。
//! ID で引ける形にしてあるのはそのため。

use std::collections::HashMap;
use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::RwLock;

use crate::engine::registry::EngineRegistry;

use super::session::GameSession;
use super::types::{GameId, GameSettings, GameSnapshot, Side};

const LOGT: &str = "obs_shogi::engine::game::manager";

#[derive(Default)]
pub struct GameManager {
    sessions: RwLock<HashMap<GameId, Arc<GameSession>>>,
}

impl GameManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn start(
        &self,
        registry: Arc<EngineRegistry>,
        app: Option<AppHandle>,
        settings: GameSettings,
    ) -> Result<GameId, String> {
        let session = GameSession::start(registry, app, settings).await?;
        let id = session.id.clone();
        self.sessions
            .write()
            .await
            .insert(id.clone(), Arc::new(session));
        log::info!(target: LOGT, "start: ok game_id={}", id);
        Ok(id)
    }

    /// 対局を閉じ、使っていたエンジンを落とす。
    ///
    /// **終局しただけでは落ちない。** 呼ばないとプロセスが残る
    /// （→ `docs/state-transitions/game-session.md` の不変条件5
    /// 「`close_game` を呼ぶまでエンジンプロセスは落ちない」）。
    pub async fn close(&self, registry: &EngineRegistry, game_id: &str) -> Result<(), String> {
        let session = self.sessions.write().await.remove(game_id);
        let Some(session) = session else {
            return Err(format!("unknown game: {game_id}"));
        };

        // `close` はセッションを消費するので、他に持たれていたら落とせない。
        // 台帳から外した直後のここでは自分しか持っていない
        match Arc::try_unwrap(session) {
            Ok(session) => session.close(registry).await,
            Err(session) => {
                // 誰かが操作中。中断だけ通してエンジンは残す。
                // 残ったプロセスは `close_all` が拾う
                let _ = session.abort().await;
                log::warn!(
                    target: LOGT,
                    "close: session still borrowed, engines left running game_id={}",
                    game_id
                );
            }
        }
        Ok(())
    }

    pub async fn close_all(&self, registry: &EngineRegistry) {
        let ids: Vec<GameId> = self.sessions.read().await.keys().cloned().collect();
        for id in ids {
            let _ = self.close(registry, &id).await;
        }
    }

    pub async fn submit_move(
        &self,
        game_id: &str,
        side: Side,
        usi_move: String,
    ) -> Result<(), String> {
        self.get(game_id).await?.submit_move(side, usi_move).await
    }

    pub async fn continue_game(&self, game_id: &str, moves: Vec<String>) -> Result<(), String> {
        self.get(game_id).await?.continue_game(moves).await
    }

    pub async fn end_by_rule(
        &self,
        game_id: &str,
        winner: Option<Side>,
        detail: Option<String>,
    ) -> Result<(), String> {
        self.get(game_id).await?.end_by_rule(winner, detail).await
    }

    pub async fn resign(&self, game_id: &str, side: Side) -> Result<(), String> {
        self.get(game_id).await?.resign(side).await
    }

    pub async fn abort(&self, game_id: &str) -> Result<(), String> {
        self.get(game_id).await?.abort().await
    }

    pub async fn snapshot(&self, game_id: &str) -> Result<GameSnapshot, String> {
        self.get(game_id).await?.snapshot().await
    }

    pub async fn ids(&self) -> Vec<GameId> {
        self.sessions.read().await.keys().cloned().collect()
    }

    async fn get(&self, game_id: &str) -> Result<Arc<GameSession>, String> {
        self.sessions
            .read()
            .await
            .get(game_id)
            .cloned()
            .ok_or_else(|| format!("unknown game: {game_id}"))
    }
}
