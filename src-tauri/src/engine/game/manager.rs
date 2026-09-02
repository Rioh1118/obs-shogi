//! 走っている対局セッションの台帳。
//!
//! 対局は同時に複数走りうる（検討しながら指す、エンジン同士を2組回す）。
//! ID で引ける形にしてあるのはそのため。

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

use crate::engine::registry::EngineRegistry;

use super::events::GameEventSink;
use super::session::GameSession;
use super::types::{GameId, GameSettings, GameSnapshot, Side};

const LOGT: &str = "obs_shogi::engine::game::manager";

pub struct GameManager {
    sessions: RwLock<HashMap<GameId, Arc<GameSession>>>,
    /// いま閉じている最中の対局。
    ///
    /// **台帳から外れている窓を埋める。** 無いと、その窓の `close_game` が
    /// 「知らない対局」として返り、呼び出し側は「何も起きていない」と読む。
    closing: Mutex<BTreeSet<GameId>>,
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
            closing: Mutex::default(),
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
    /// 断り方は3つあり、**呼び直す意味があるのは1つだけ**。
    ///
    /// - `the game is busy` — 他の操作が同じ対局を掴んでいる。**中断は試みたが、
    ///   通ったかは保証しない**（`CLOSE_ABORT_TIMEOUT` を超えると warn を1行残して
    ///   先へ進む＝探索も時計も続いている）。**エンジンは生きたまま台帳に残る**。
    ///   そのまま呼び直せる。呼び直さないとプロセスが残る
    /// - `the game is being closed` — 別の呼び出しがいま閉じている最中。待つこと
    /// - `unknown game` — 台帳に無い。何も起きていない
    pub async fn close(&self, game_id: &GameId) -> Result<(), String> {
        // **「知らない」と「いま閉じている」を分ける。** `close` は台帳から
        // 外してから最大十数秒待つので、その窓に2本目が入ると `unknown game` を
        // 受け取る。受けた側が「何も起きていない」と読むと、直後に台帳へ戻る
        // セッション（エンジンは生きている）を誰も閉じないまま置き去りにする。
        {
            let mut closing = self.closing.lock().await;
            if closing.contains(game_id) {
                return Err(format!("the game is being closed: {game_id}"));
            }
            if !self.sessions.read().await.contains_key(game_id) {
                return Err(format!("unknown game: {game_id}"));
            }
            closing.insert(game_id.clone());
        }

        let guard = ClosingGuard {
            closing: &self.closing,
            game_id: game_id.clone(),
        };
        let result = self.take_and_close(game_id).await;
        drop(guard);
        // `Drop` が `try_lock` に失敗していても、ここで確実に外す
        self.closing.lock().await.remove(game_id);
        result
    }

    async fn take_and_close(&self, game_id: &GameId) -> Result<(), String> {
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

    /// 開いている対局の ID。**閉じている最中のものも含める。**
    ///
    /// 含めないと、`close` が台帳から外している数秒のあいだ、
    /// 「閉じ忘れを拾う」ためのこの口から、まさに閉じ損ねようとしている対局が消える。
    pub async fn ids(&self) -> Vec<GameId> {
        let mut ids: BTreeSet<GameId> = self.sessions.read().await.keys().cloned().collect();
        ids.extend(self.closing.lock().await.iter().cloned());
        ids.into_iter().collect()
    }

    /// **「知らない」と「いま閉じている」を分ける。**
    ///
    /// `close` は台帳から外してから最大十数秒待つ。その窓で `unknown game` を返すと、
    /// 生きている対局への `get_game_state`（取りこぼし後の突き合わせ）や
    /// `submit_game_move` が「無い対局」として断られる。
    async fn get(&self, game_id: &GameId) -> Result<Arc<GameSession>, String> {
        if let Some(session) = self.sessions.read().await.get(game_id).cloned() {
            return Ok(session);
        }
        if self.closing.lock().await.contains(game_id) {
            return Err(format!("the game is being closed: {game_id}"));
        }
        Err(format!("unknown game: {game_id}"))
    }
}

/// `closing` から必ず外すための番人。
///
/// **戻り値に頼らない。** `insert` と `remove` の間で future が drop されるか
/// panic すると ID が残り続け、以後その対局は `the game is being closed` を
/// 返し続ける——`close_all` も `close` を通るので拾えず、落とす口が
/// 終了時の `shutdown_all` だけになる。このコードベースは待ちを `timeout` で
/// 包む習慣なので、`close_game` 側に包みが1つ増えた時点で本番の穴になる。
struct ClosingGuard<'a> {
    closing: &'a Mutex<BTreeSet<GameId>>,
    game_id: GameId,
}

impl Drop for ClosingGuard<'_> {
    fn drop(&mut self) {
        // `Drop` は async になれないので `try_lock` しかできない。
        //
        // **失敗したら黙って諦めない。** 外せなかった ID を消す口はどこにも無く、
        // その対局は以後ずっと `the game is being closed` を返し続ける——
        // `close_all` も `close` を通るので拾えず、落とす口が終了時の掃除だけになる。
        // せめて追える形で残す
        if let Ok(mut closing) = self.closing.try_lock() {
            closing.remove(&self.game_id);
            return;
        }
        log::error!(
            target: LOGT,
            "close: could not clear the closing mark game_id={}; \
             the game will keep reporting `being closed`",
            self.game_id
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::game::events::DiscardEvents;
    use crate::engine::game::types::{PlayerSpec, TimeLimit};

    fn two_humans() -> GameSettings {
        let limit = TimeLimit {
            main_ms: 60_000,
            byoyomi_ms: 0,
            increment_ms: 0,
        };
        GameSettings {
            black: PlayerSpec::Human {
                name: "先手".to_string(),
            },
            white: PlayerSpec::Human {
                name: "後手".to_string(),
            },
            black_time: limit,
            white_time: limit,
            start_sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"
                .to_string(),
            initial_moves: Vec::new(),
            enforce_engine_timeout: false,
        }
    }

    /// 閉じている最中の対局を「知らない対局」と言わないこと。
    ///
    /// **`close` は台帳から外してから待つ。** その窓で `unknown game` を返すと、
    /// 生きている対局への `get_game_state`（取りこぼし後の突き合わせ）が
    /// 「無い対局」として断られ、`list_games`（閉じ忘れを拾う口）からも消える。
    #[tokio::test]
    async fn a_game_being_closed_is_not_reported_as_unknown() {
        let registry = Arc::new(EngineRegistry::new());
        let games = GameManager::new(registry);
        let id = games
            .start(Arc::new(DiscardEvents), two_humans())
            .await
            .expect("人間だけの対局は起動できるはず");

        // 台帳から外した状態を作る（`take_and_close` の中の窓）
        let session = games
            .sessions
            .write()
            .await
            .remove(&id)
            .expect("台帳にある");
        games.closing.lock().await.insert(id.clone());

        let error = games
            .snapshot(&id)
            .await
            .expect_err("閉じている最中に状態を返している");
        assert!(
            error.contains("being closed"),
            "「知らない対局」と言っている: {error}"
        );
        assert!(
            games.ids().await.contains(&id),
            "閉じ忘れを拾う口から、閉じ損ねている対局が消えている"
        );

        // 後始末
        games.closing.lock().await.remove(&id);
        games.sessions.write().await.insert(id, session);
    }
}
