//! 走っている対局セッションの台帳。
//!
//! 対局は同時に複数走りうる（検討しながら指す、エンジン同士を2組回す）。
//! ID で引ける形にしてあるのはそのため。

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::engine::registry::EngineRegistry;

use super::events::GameEventSink;
use super::session::GameSession;
use super::types::{GameId, GameSettings, GameSnapshot, Side};

const LOGT: &str = "obs_shogi::engine::game::manager";

pub struct GameManager {
    sessions: RwLock<HashMap<GameId, Arc<GameSession>>>,
    /// 対局のエンジンを起こす／落とす台帳。
    ///
    /// **持つ。** 渡してもらう形にすると、`engine_ids` が「起こしたときの台帳の
    /// 中でだけ意味を持つ値」なのに、その台帳との対応が呼び出し側の記憶だけに
    /// なる。別の台帳を渡すと対局は消え、`shutdown` は知らない ID として
    /// `debug` を1行出して**成功で返り**、プロセスは誰からも参照されずに残る。
    /// `Result` も `warn` も出ないので、アクティビティモニタ以外に手掛かりが無い。
    registry: Arc<EngineRegistry>,
}

impl GameManager {
    pub fn new(registry: Arc<EngineRegistry>) -> Self {
        Self {
            sessions: RwLock::default(),
            registry,
        }
    }

    pub async fn start(
        &self,
        events: Arc<dyn GameEventSink>,
        settings: GameSettings,
    ) -> Result<GameId, String> {
        let session = GameSession::start(&self.registry, events, settings).await?;
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
    ///
    /// # エラー
    ///
    /// 他の操作が同じ対局を掴んでいると閉じられず `Err` を返す。そのとき
    /// **対局は中断済みだが、エンジンは生きたまま台帳に残る。**
    /// そのまま呼び直せる。呼び直さないとプロセスが残る。
    pub async fn close(&self, game_id: &GameId) -> Result<(), String> {
        let session = self.sessions.write().await.remove(game_id);
        let Some(session) = session else {
            return Err(format!("unknown game: {game_id}"));
        };

        // `close` はセッションを消費するので、他に持たれていたら落とせない。
        match Arc::try_unwrap(session) {
            Ok(session) => session.close(&self.registry).await,
            Err(session) => {
                // 誰かが操作中。中断だけ通して、**台帳へ戻す。**
                //
                // 戻さないと、この `Arc` を最後に手放した者がセッションごと
                // drop してエンジンの ID が消え、プロセスを落とす手掛かりが
                // どこにも残らない。`close_all` も台帳しか見ないので拾えない。
                // 戻しておけば、次の `close_game` か `close_all` で落とせる。
                //
                // 中断の上限と失敗の分類は `GameSession` が1箇所で持つ
                session.abort_within_budget().await;
                self.sessions.write().await.insert(game_id.clone(), session);
                log::warn!(
                    target: LOGT,
                    "close: session still borrowed, kept in the ledger game_id={}",
                    game_id
                );
                return Err(format!(
                    "the game is busy and could not be closed: {game_id}"
                ));
            }
        }
        Ok(())
    }

    /// 台帳の全部を閉じる。**閉じられなかったものは残り、1行残す。**
    ///
    /// `close` は操作中の対局を閉じられずに台帳へ戻すので、ここで潰すと
    /// 「一括で閉じたのにエンジンが残っている」が痕跡なしに起きる。
    /// 戻る `Vec` は閉じられなかった対局の ID
    pub async fn close_all(&self) -> Vec<GameId> {
        let ids: Vec<GameId> = self.sessions.read().await.keys().cloned().collect();
        let mut left = Vec::new();
        for id in ids {
            if let Err(e) = self.close(&id).await {
                log::warn!(target: LOGT, "close_all: could not close {id}: {e}");
                left.push(id);
            }
        }
        left
    }

    pub async fn submit_move(
        &self,
        game_id: &GameId,
        side: Side,
        usi_move: String,
    ) -> Result<(), String> {
        self.get(game_id).await?.submit_move(side, usi_move).await
    }

    pub async fn continue_game(&self, game_id: &GameId, moves: Vec<String>) -> Result<(), String> {
        self.get(game_id).await?.continue_game(moves).await
    }

    pub async fn end_by_rule(
        &self,
        game_id: &GameId,
        winner: Option<Side>,
        detail: Option<String>,
    ) -> Result<(), String> {
        self.get(game_id).await?.end_by_rule(winner, detail).await
    }

    pub async fn resign(&self, game_id: &GameId, side: Side) -> Result<(), String> {
        self.get(game_id).await?.resign(side).await
    }

    pub async fn abort(&self, game_id: &GameId) -> Result<(), String> {
        self.get(game_id).await?.abort().await
    }

    pub async fn snapshot(&self, game_id: &GameId) -> Result<GameSnapshot, String> {
        self.get(game_id).await?.snapshot().await
    }

    pub async fn ids(&self) -> Vec<GameId> {
        self.sessions.read().await.keys().cloned().collect()
    }

    async fn get(&self, game_id: &GameId) -> Result<Arc<GameSession>, String> {
        self.sessions
            .read()
            .await
            .get(game_id)
            .cloned()
            .ok_or_else(|| format!("unknown game: {game_id}"))
    }
}
