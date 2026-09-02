//! 対局セッションの状態機械。
//!
//! 状態を1つのタスクが持ち、外からの要求も探索タスクからの通知も同じ
//! チャンネルに流す。**ロックを持ったまま USI を送る経路を作らない**ための形で、
//! 「止めたはずのエンジンから届いた `bestmove` を今の手番の着手として採る」
//! 類の取り違えが起きる場所を1箇所に閉じ込める。
//!
//! # 責任の切れ目
//!
//! **ここは将棋のルールを持たない。** 合法手・詰み・千日手・持将棋・最大手数は
//! フロントの `ShogiMoveValidator` 側にあり、盤の表示にも要るので消せない。
//! Rust に重ねて持つと合法手判定が2実装になる。
//!
//! そのため、手が決まっても**次の `go` を自分では出さない**。
//! `AwaitingRuling` で止まり、フロントが `continue_game` を返してはじめて進む。
//! 指し手列の権威もフロント側にあり、`continue_game` が毎手それを運んでくる。
//!
//! 表は `docs/state-transitions/game-session.md`。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use usi::{GameOverKind, GuiCommand};

use crate::engine::protocol::UsiProtocol;
use crate::engine::registry::{EngineId, EngineProcess, EngineRegistry};
use crate::engine::types::AnalysisResult;
use crate::engine::{READY_TIMEOUT, USI_OK_TIMEOUT};

use super::clock::{ClockOutcome, GameClocks};
use super::search::{run_search, SearchKind, SearchMessage, SearchOutcome, SearchRequest};
use super::types::*;

const LOGT: &str = "obs_shogi::engine::game";

/// 時計を見る間隔。時間切れの検出はこの粒度になる
const TICK: Duration = Duration::from_millis(100);

/// 時計だけの更新を送る最短間隔。
/// tick ごとに送ると1秒に10回 IPC を叩くが、秒の表示にその分解能は要らない
const CLOCK_EMIT_INTERVAL: Duration = Duration::from_millis(500);

/// `MoveDecided` を出してから裁定が返るまで待つ上限。
///
/// 裁定は同期的な計算なので、これに掛かるのは**フロントが答えられなくなった
/// とき**（listener が死んだ、画面が落ちた）だけ。待ち続けると、対局が
/// 進みも終わりもしないまま残る。この間は時計が止まっているので、
/// 打ち切りが対局者の持ち時間を削ることはない。
const RULING_TIMEOUT: Duration = Duration::from_secs(30);

/// フロントへ流すイベントの名前
const EVENT: &str = "game-event";

// ===== 外から呼ぶ口 =====

/// 起動中の対局1つ。
pub struct GameSession {
    pub id: GameId,
    tx: mpsc::UnboundedSender<Command>,
    /// この対局のために起動したエンジン。`close` で落とす
    engine_ids: Vec<EngineId>,
}

impl GameSession {
    /// 対局を始める。
    ///
    /// `setoption` → `isready` → `readyok` → `usinewgame` → 最初の `go` までを
    /// ここで済ませる。**呼び出し側は USI の段取りを知らない。**
    /// 返ったときには、手番がエンジンなら既に考え始めている。
    pub async fn start(
        registry: Arc<EngineRegistry>,
        app: Option<AppHandle>,
        settings: GameSettings,
    ) -> Result<GameSession, String> {
        validate_settings(&settings)?;
        let side_to_move = derive_side_after(&settings, settings.initial_moves.len());

        let (engine_ids, engines) = spawn_players(&registry, &settings).await?;

        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::unbounded_channel();
        let [black_engine, white_engine] = engines;

        let mut runner = Runner {
            id: id.clone(),
            app,
            clocks: GameClocks::new(settings.black_time, settings.white_time),
            players: [
                Player::new(settings.black.clone(), black_engine),
                Player::new(settings.white.clone(), white_engine),
            ],
            moves: settings.initial_moves.clone(),
            settings,
            phase: Phase::Thinking { side: side_to_move },
            turn_started: Instant::now(),
            next_req: 0,
            last_clock_emit: Instant::now(),
            tx: tx.clone(),
        };

        runner.emit(GameEvent::TurnChanged {
            game_id: id.clone(),
            side: side_to_move,
            clocks: runner.clocks_view(),
        });
        runner.start_search(side_to_move);

        tokio::spawn(run_loop(runner, rx));
        tokio::spawn(tick_loop(tx.clone()));

        Ok(GameSession { id, tx, engine_ids })
    }

    /// 人間の着手。エンジンの手は `bestmove` から入るのでここは通らない。
    ///
    /// 受け付けた後は `MoveDecided` が出て `AwaitingRuling` で止まる。
    /// **エンジンの手と同じ関門を通す。** 分けると、詰みの判定が
    /// 「人が指したとき」と「エンジンが指したとき」で別経路になる。
    pub async fn submit_move(&self, side: Side, usi_move: String) -> Result<(), String> {
        self.request(|reply| Command::SubmitMove {
            side,
            usi_move,
            reply,
        })
        .await
    }

    /// 裁定の結果「まだ続く」。**`moves` が指し手列の権威**で、Rust の写しを上書きする。
    pub async fn continue_game(&self, moves: Vec<String>) -> Result<(), String> {
        self.request(|reply| Command::Continue { moves, reply })
            .await
    }

    /// 裁定の結果「終局」。詰み・千日手・持将棋・最大手数・反則はどれもここから入る
    pub async fn end_by_rule(
        &self,
        winner: Option<Side>,
        detail: Option<String>,
    ) -> Result<(), String> {
        self.request(|reply| Command::EndByRule {
            winner,
            detail,
            reply,
        })
        .await
    }

    pub async fn resign(&self, side: Side) -> Result<(), String> {
        self.request(|reply| Command::Resign { side, reply }).await
    }

    pub async fn abort(&self) -> Result<(), String> {
        self.request(|reply| Command::Abort { reply }).await
    }

    pub async fn snapshot(&self) -> Result<GameSnapshot, String> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(Command::Snapshot { reply })
            .map_err(|_| ENDED.to_string())?;
        rx.await.map_err(|_| ENDED.to_string())
    }

    /// 対局を閉じ、使っていたエンジンを落とす。
    ///
    /// **終局しただけではプロセスは落ちない。** `gameover` の後に
    /// `usinewgame` で指し直せるようにしてある（USI がそういう作りのため）。
    /// 呼ばないとプロセスが残る。
    pub async fn close(self, registry: &EngineRegistry) {
        let _ = self.abort().await;
        for id in &self.engine_ids {
            registry.shutdown(id).await;
        }
    }

    async fn request<F>(&self, build: F) -> Result<(), String>
    where
        F: FnOnce(oneshot::Sender<Result<(), String>>) -> Command,
    {
        let (reply, rx) = oneshot::channel();
        self.tx.send(build(reply)).map_err(|_| ENDED.to_string())?;
        rx.await.map_err(|_| ENDED.to_string())?
    }
}

const ENDED: &str = "game session has ended";

// ===== 内部 =====

enum Command {
    SubmitMove {
        side: Side,
        usi_move: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Continue {
        moves: Vec<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    EndByRule {
        winner: Option<Side>,
        detail: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Resign {
        side: Side,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Abort {
        reply: oneshot::Sender<Result<(), String>>,
    },
    Snapshot {
        reply: oneshot::Sender<GameSnapshot>,
    },
    Search(SearchMessage),
    Tick,
}

/// 対局者の実行時の姿。
struct Player {
    spec: PlayerSpec,
    /// 人間なら `None`
    engine: Option<Arc<EngineProcess>>,
    activity: Activity,
    /// 先読みを打ち切った。捨てる `bestmove` が返ったら本番の思考を始める
    restart_after_abort: bool,
}

impl Player {
    fn new(spec: PlayerSpec, engine: Option<Arc<EngineProcess>>) -> Self {
        Self {
            spec,
            engine,
            activity: Activity::Idle,
            restart_after_abort: false,
        }
    }

    fn ponder_enabled(&self) -> bool {
        matches!(self.spec, PlayerSpec::Engine { ponder: true, .. })
    }
}

/// エンジンプロセスが USI 上でいまどの状態にあるか。
///
/// **セッションの段（`Phase`）と別に持つ。** 一致させ損ねたときに何が
/// 起きるかは `docs/state-transitions/game-session.md` の不変条件2。
enum Activity {
    Idle,
    Busy {
        req: u64,
        kind: SearchKind,
        cancel: CancellationToken,
    },
}

enum Phase {
    /// `side` が考えている。時計が動いている
    Thinking {
        side: Side,
    },
    /// 手が決まり、フロントの裁定を待っている。時計は止まっている
    AwaitingRuling {
        last_mover: Side,
        usi_move: String,
        /// エンジンが添えてきた次の手。裁定が通ったら先読みに使う
        ponder_move: Option<String>,
        since: Instant,
    },
    Over {
        result: GameResult,
    },
}

struct Runner {
    id: GameId,
    app: Option<AppHandle>,
    settings: GameSettings,
    players: [Player; 2],
    clocks: GameClocks,
    /// 指し手列の**写し**。権威はフロントにあり、`continue_game` が上書きする
    moves: Vec<String>,
    phase: Phase,
    /// いまの手番の時計が動き出した時刻。`AwaitingRuling` / `Over` では見ない
    turn_started: Instant,
    next_req: u64,
    last_clock_emit: Instant,
    tx: mpsc::UnboundedSender<Command>,
}

async fn run_loop(mut runner: Runner, mut rx: mpsc::UnboundedReceiver<Command>) {
    while let Some(command) = rx.recv().await {
        runner.handle(command).await;
    }
    log::debug!(target: LOGT, "run_loop: ended game_id={}", runner.id);
}

async fn tick_loop(tx: mpsc::UnboundedSender<Command>) {
    let mut interval = tokio::time::interval(TICK);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        if tx.send(Command::Tick).is_err() {
            return;
        }
    }
}

impl Runner {
    async fn handle(&mut self, command: Command) {
        match command {
            Command::SubmitMove {
                side,
                usi_move,
                reply,
            } => {
                let result = self.accept_human_move(side, usi_move).await;
                let _ = reply.send(result);
            }
            Command::Continue { moves, reply } => {
                let result = self.accept_continue(moves).await;
                let _ = reply.send(result);
            }
            Command::EndByRule {
                winner,
                detail,
                reply,
            } => {
                let result = self.accept_rule_end(winner, detail).await;
                let _ = reply.send(result);
            }
            Command::Resign { side, reply } => {
                let result = self.accept_resign(side).await;
                let _ = reply.send(result);
            }
            Command::Abort { reply } => {
                if !self.is_over() {
                    self.finish(GameResult {
                        winner: None,
                        reason: GameOverReason::Aborted,
                        detail: None,
                    })
                    .await;
                }
                let _ = reply.send(Ok(()));
            }
            Command::Snapshot { reply } => {
                let _ = reply.send(self.snapshot());
            }
            Command::Search(SearchMessage::Info { side, result }) => {
                self.on_search_info(side, result)
            }
            Command::Search(SearchMessage::Outcome { side, req, outcome }) => {
                self.on_search_outcome(side, req, outcome).await
            }
            Command::Tick => self.on_tick().await,
        }
    }

    // --- フロントからの要求 ---

    async fn accept_human_move(&mut self, side: Side, usi_move: String) -> Result<(), String> {
        let Phase::Thinking { side: to_move } = self.phase else {
            return Err("not waiting for a move".to_string());
        };
        if to_move != side {
            return Err(format!("it is not {side:?}'s turn"));
        }
        if self.player(side).spec.is_engine() {
            return Err("this side is played by an engine".to_string());
        }
        validate_usi_move(&usi_move)?;

        self.decide_move(side, usi_move, None).await;
        Ok(())
    }

    /// 裁定「続く」。`moves` で写しを上書きし、次の手番を始める
    async fn accept_continue(&mut self, moves: Vec<String>) -> Result<(), String> {
        let Phase::AwaitingRuling {
            last_mover,
            usi_move,
            ponder_move,
            ..
        } = &self.phase
        else {
            return Err("not awaiting a ruling".to_string());
        };
        let (last_mover, usi_move, ponder_move) =
            (*last_mover, usi_move.clone(), ponder_move.clone());

        // 権威はフロントだが、**受け取ったものが直前の手の続きであることは確かめる。**
        // 確かめないと、食い違いに気付く経路がどこにも無くなる
        if moves.last() != Some(&usi_move) {
            return Err(format!(
                "move list does not end with the move just decided ({usi_move})"
            ));
        }
        let next = last_mover.opponent();
        if derive_side_after(&self.settings, moves.len()) != next {
            return Err(format!(
                "move list length {} does not put {next:?} to move",
                moves.len()
            ));
        }
        for mv in &moves {
            validate_usi_move(mv)?;
        }

        self.moves = moves;
        self.phase = Phase::Thinking { side: next };
        self.turn_started = Instant::now();

        self.hand_turn_to(next, &usi_move).await;

        // 指した側は、相手が考えている間に先読みへ入る。
        // 裁定が通った後に始めるので、**指せない手の上で読ませることが無い**
        if let Some(ponder_move) = ponder_move {
            self.start_ponder(last_mover, ponder_move);
        }

        self.emit(GameEvent::TurnChanged {
            game_id: self.id.clone(),
            side: next,
            clocks: self.clocks_view(),
        });
        Ok(())
    }

    async fn accept_rule_end(
        &mut self,
        winner: Option<Side>,
        detail: Option<String>,
    ) -> Result<(), String> {
        if self.is_over() {
            return Err("game is already over".to_string());
        }
        self.finish(GameResult {
            winner,
            reason: GameOverReason::Rule,
            detail,
        })
        .await;
        Ok(())
    }

    async fn accept_resign(&mut self, side: Side) -> Result<(), String> {
        if self.is_over() {
            return Err("game is already over".to_string());
        }
        if self.player(side).spec.is_engine() {
            return Err("this side is played by an engine".to_string());
        }
        self.finish(GameResult {
            winner: Some(side.opponent()),
            reason: GameOverReason::Resign,
            detail: None,
        })
        .await;
        Ok(())
    }

    // --- 探索タスクからの通知 ---

    fn on_search_info(&mut self, side: Side, result: AnalysisResult) {
        // 手番が変わった後に届いた読み筋は、いまの局面のものではない
        if !self.is_to_move(side) {
            return;
        }
        self.emit(GameEvent::SearchInfo {
            game_id: self.id.clone(),
            side,
            result,
        });
    }

    async fn on_search_outcome(&mut self, side: Side, req: u64, outcome: SearchOutcome) {
        match &self.player(side).activity {
            Activity::Busy { req: current, .. } if *current == req => {}
            _ => {
                // 世代が合わない。前の `go` の後始末が遅れて届いただけ
                log::debug!(target: LOGT, "stale search outcome side={side:?} req={req}");
                return;
            }
        }
        self.player_mut(side).activity = Activity::Idle;

        // 終局後に返ってきた `bestmove` は、`gameover` を送るための合図にだけ使う。
        // 探索中のエンジンへ `gameover` を送るのはプロトコル違反なので、
        // idle に戻ったここまで待つ
        if let Phase::Over { result } = &self.phase {
            let result = result.clone();
            self.send_gameover(side, &result).await;
            return;
        }

        if std::mem::take(&mut self.player_mut(side).restart_after_abort) {
            // 先読みが外れて止めた分。改めていまの局面で考えさせる
            if self.is_to_move(side) {
                self.start_search(side);
            }
            return;
        }

        match outcome {
            SearchOutcome::Aborted => {}
            SearchOutcome::Failed(message) => {
                log::error!(target: LOGT, "engine failed side={side:?}: {message}");
                self.finish(GameResult {
                    winner: Some(side.opponent()),
                    reason: GameOverReason::EngineFailure,
                    detail: Some(message),
                })
                .await;
            }
            SearchOutcome::Move { usi, ponder } => {
                // 先読みが自分から終わることがある（詰みを見つけた等）。
                // その `bestmove` は相手の手番に対する答えなので採らない
                if !self.is_to_move(side) {
                    return;
                }
                if let Err(e) = validate_usi_move(&usi) {
                    self.finish(GameResult {
                        winner: Some(side.opponent()),
                        reason: GameOverReason::EngineFailure,
                        detail: Some(format!("engine returned an unusable bestmove: {e}")),
                    })
                    .await;
                    return;
                }
                let ponder = ponder.filter(|m| validate_usi_move(m).is_ok());
                self.decide_move(side, usi, ponder).await;
            }
            SearchOutcome::Resign => {
                if self.is_to_move(side) {
                    self.finish(GameResult {
                        winner: Some(side.opponent()),
                        reason: GameOverReason::Resign,
                        detail: None,
                    })
                    .await;
                }
            }
            SearchOutcome::DeclareWin => {
                if self.is_to_move(side) {
                    self.finish(GameResult {
                        winner: Some(side),
                        reason: GameOverReason::DeclareWin,
                        detail: None,
                    })
                    .await;
                }
            }
        }
    }

    async fn on_tick(&mut self) {
        match &self.phase {
            Phase::Thinking { side } => {
                let side = *side;
                let elapsed = self.elapsed_ms();
                if self.clocks.get(side).has_expired(elapsed) && self.timeout_enforced(side) {
                    self.finish(GameResult {
                        winner: Some(side.opponent()),
                        reason: GameOverReason::Timeout,
                        detail: None,
                    })
                    .await;
                    return;
                }
            }
            Phase::AwaitingRuling { since, .. } => {
                if since.elapsed() >= RULING_TIMEOUT {
                    self.finish(GameResult {
                        winner: None,
                        reason: GameOverReason::Aborted,
                        detail: Some("no ruling came back from the app".to_string()),
                    })
                    .await;
                }
                return;
            }
            Phase::Over { .. } => return,
        }

        if self.last_clock_emit.elapsed() >= CLOCK_EMIT_INTERVAL {
            self.last_clock_emit = Instant::now();
            self.emit(GameEvent::ClockUpdated {
                game_id: self.id.clone(),
                clocks: self.clocks_view(),
            });
        }
    }

    // --- 進行 ---

    /// 手が決まった。**ここでは進めない。** 時計を締めて裁定を待つ
    async fn decide_move(&mut self, mover: Side, usi_move: String, ponder_move: Option<String>) {
        let elapsed = self.elapsed_ms();
        let expired = self.clocks.get_mut(mover).consume(elapsed) == ClockOutcome::Expired;

        // 使い切ってから返ってきた手は指されなかったものとして扱う。
        // 時間切れの判定にルールは要らないので、裁定を待たずにここで終局にする。
        // 普段はこの経路より `on_tick` の側が先に当たり、ここに来るのは
        // 手が届くのと時計が尽きるのが同じ tick に入ったときだけ
        if expired && self.timeout_enforced(mover) {
            self.finish(GameResult {
                winner: Some(mover.opponent()),
                reason: GameOverReason::Timeout,
                detail: None,
            })
            .await;
            return;
        }

        self.phase = Phase::AwaitingRuling {
            last_mover: mover,
            usi_move: usi_move.clone(),
            ponder_move,
            since: Instant::now(),
        };

        self.emit(GameEvent::MoveDecided {
            game_id: self.id.clone(),
            side: mover,
            usi_move,
            elapsed_ms: elapsed,
            clocks: self.clocks_view(),
        });
    }

    /// 手番を渡す。相手が先読み中なら、当たったか外れたかで分かれる
    async fn hand_turn_to(&mut self, side: Side, last_move: &str) {
        let hit = match &self.player(side).activity {
            Activity::Busy {
                kind: SearchKind::Ponder { ponder_move },
                ..
            } => Some(ponder_move == last_move),
            Activity::Busy {
                kind: SearchKind::Search,
                ..
            } => {
                // 手番でない側が本番の思考をしている。組み立てを間違えている
                log::warn!(target: LOGT, "unexpected live search on idle side={side:?}");
                None
            }
            Activity::Idle => None,
        };

        match hit {
            // 読み当たり。エンジンはそのまま考え続ける。ここから時計が動く
            Some(true) => {
                if let Some(protocol) = self.protocol(side) {
                    if let Err(e) = protocol.send_command(&GuiCommand::Ponderhit).await {
                        log::warn!(target: LOGT, "ponderhit failed side={side:?}: {e}");
                    }
                }
                if let Activity::Busy { kind, .. } = &mut self.player_mut(side).activity {
                    *kind = SearchKind::Search;
                }
            }
            // 外れ。止めて、捨てる `bestmove` が返ってから改めて考えさせる
            Some(false) => {
                if let Activity::Busy { cancel, .. } = &self.player(side).activity {
                    cancel.cancel();
                }
                self.player_mut(side).restart_after_abort = true;
            }
            None => self.start_search(side),
        }
    }

    fn start_search(&mut self, side: Side) {
        if self.player(side).engine.is_none() {
            return;
        }
        self.spawn_search(side, SearchKind::Search);
    }

    fn start_ponder(&mut self, side: Side, ponder_move: String) {
        if self.player(side).engine.is_none() || !self.player(side).ponder_enabled() {
            return;
        }
        if !matches!(self.player(side).activity, Activity::Idle) {
            return;
        }
        self.spawn_search(side, SearchKind::Ponder { ponder_move });
    }

    fn spawn_search(&mut self, side: Side, kind: SearchKind) {
        self.next_req += 1;
        let req = self.next_req;
        let cancel = CancellationToken::new();

        let mut moves = self.moves.clone();
        let ponder = match &kind {
            SearchKind::Ponder { ponder_move } => {
                moves.push(ponder_move.clone());
                true
            }
            SearchKind::Search => false,
        };

        let mut params = self.clocks.think_params(side);
        if ponder {
            params = params.ponder();
        }

        let request = SearchRequest {
            protocol: self
                .protocol(side)
                .expect("spawn_search は engine を持つ側にだけ呼ぶ"),
            side,
            req,
            position: position_argument(&self.settings.start_sfen, &moves),
            params,
            ponder,
            cancel: cancel.clone(),
        };

        let tx = self.tx.clone();
        tokio::spawn(async move {
            let (search_tx, mut search_rx) = mpsc::unbounded_channel();
            let forward = tokio::spawn(async move {
                while let Some(message) = search_rx.recv().await {
                    if tx.send(Command::Search(message)).is_err() {
                        return;
                    }
                }
            });
            run_search(request, search_tx).await;
            let _ = forward.await;
        });

        self.player_mut(side).activity = Activity::Busy { req, kind, cancel };
    }

    async fn finish(&mut self, result: GameResult) {
        if self.is_over() {
            return;
        }

        // 走っている思考を止める。`gameover` はエンジンが idle に戻ってから
        // （`on_search_outcome` の Over 分岐）送る
        let mut idle_sides = Vec::new();
        for side in [Side::Black, Side::White] {
            match &self.player(side).activity {
                Activity::Busy { cancel, .. } => cancel.cancel(),
                Activity::Idle => idle_sides.push(side),
            }
            self.player_mut(side).restart_after_abort = false;
        }

        self.phase = Phase::Over {
            result: result.clone(),
        };

        for side in idle_sides {
            self.send_gameover(side, &result).await;
        }

        self.emit(GameEvent::Over {
            game_id: self.id.clone(),
            result,
            clocks: self.clocks_view(),
        });
    }

    async fn send_gameover(&self, side: Side, result: &GameResult) {
        let Some(protocol) = self.protocol(side) else {
            return;
        };
        let kind = match result.winner {
            None => GameOverKind::Draw,
            Some(winner) if winner == side => GameOverKind::Win,
            Some(_) => GameOverKind::Lose,
        };
        if let Err(e) = protocol.send_command(&GuiCommand::GameOver(kind)).await {
            log::warn!(target: LOGT, "gameover failed side={side:?}: {e}");
        }
    }

    // --- 小物 ---

    fn player(&self, side: Side) -> &Player {
        &self.players[side.index()]
    }

    fn player_mut(&mut self, side: Side) -> &mut Player {
        &mut self.players[side.index()]
    }

    fn protocol(&self, side: Side) -> Option<Arc<UsiProtocol>> {
        self.player(side).engine.as_ref().map(|e| e.protocol())
    }

    fn is_over(&self) -> bool {
        matches!(self.phase, Phase::Over { .. })
    }

    fn is_to_move(&self, side: Side) -> bool {
        matches!(self.phase, Phase::Thinking { side: s } if s == side)
    }

    fn timeout_enforced(&self, side: Side) -> bool {
        !self.player(side).spec.is_engine() || self.settings.enforce_engine_timeout
    }

    fn elapsed_ms(&self) -> u64 {
        match self.phase {
            Phase::Thinking { .. } => self.turn_started.elapsed().as_millis() as u64,
            // 裁定待ちと終局後は時計が止まっている
            _ => 0,
        }
    }

    fn clocks_view(&self) -> ClocksView {
        match self.phase {
            Phase::Thinking { side } => self.clocks.view(Some((side, self.elapsed_ms()))),
            _ => self.clocks.view(None),
        }
    }

    fn snapshot(&self) -> GameSnapshot {
        let phase = match &self.phase {
            Phase::Thinking { side } => GamePhaseView::Thinking { side: *side },
            Phase::AwaitingRuling {
                last_mover,
                usi_move,
                ..
            } => GamePhaseView::AwaitingRuling {
                last_mover: *last_mover,
                usi_move: usi_move.clone(),
            },
            Phase::Over { result } => GamePhaseView::Over {
                result: result.clone(),
            },
        };

        GameSnapshot {
            game_id: self.id.clone(),
            black_name: self.settings.black.name().to_string(),
            white_name: self.settings.white.name().to_string(),
            phase,
            moves: self.moves.clone(),
            clocks: self.clocks_view(),
        }
    }

    fn emit(&self, event: GameEvent) {
        let Some(app) = &self.app else {
            return;
        };
        if let Err(e) = app.emit(EVENT, event) {
            log::warn!(target: LOGT, "emit failed game_id={}: {e}", self.id);
        }
    }
}

// ===== 起動時の段取り =====

/// エンジン側の対局者を全部起動する。
/// 途中で失敗したら、それまでに起動したものを道連れに落とす
async fn spawn_players(
    registry: &EngineRegistry,
    settings: &GameSettings,
) -> Result<(Vec<EngineId>, [Option<Arc<EngineProcess>>; 2]), String> {
    let mut ids = Vec::new();
    let mut engines: [Option<Arc<EngineProcess>>; 2] = [None, None];

    for side in [Side::Black, Side::White] {
        let spec = settings.spec(side);
        let PlayerSpec::Engine {
            engine_path,
            work_dir,
            options,
            ..
        } = spec
        else {
            continue;
        };

        match prepare_engine(registry, engine_path, work_dir.as_deref(), options).await {
            Ok(process) => {
                ids.push(process.id.clone());
                engines[side.index()] = Some(process);
            }
            Err(e) => {
                for id in &ids {
                    registry.shutdown(id).await;
                }
                return Err(format!("failed to start {}: {e}", spec.name()));
            }
        }
    }

    Ok((ids, engines))
}

async fn prepare_engine(
    registry: &EngineRegistry,
    engine_path: &str,
    work_dir: Option<&str>,
    options: &HashMap<String, String>,
) -> Result<Arc<EngineProcess>, String> {
    let process = registry
        .spawn(engine_path, work_dir, USI_OK_TIMEOUT)
        .await
        .map_err(|e| e.to_string())?;

    let prepared = send_setup(&process, options).await;
    if let Err(e) = prepared {
        registry.shutdown(&process.id).await;
        return Err(e);
    }
    Ok(process)
}

async fn send_setup(
    process: &EngineProcess,
    options: &HashMap<String, String>,
) -> Result<(), String> {
    let protocol = process.protocol();

    for (name, value) in options {
        // USI は行指向なので、改行を混ぜられると別のコマンドを注入できる
        if contains_usi_breaking_char(name) || contains_usi_breaking_char(value) {
            return Err(format!(
                "option '{name}' contains a forbidden control character"
            ));
        }
        protocol
            .send_command(&GuiCommand::SetOption(name.clone(), Some(value.clone())))
            .await
            .map_err(|e| e.to_string())?;
    }

    // `readyok` まで待ってから `usinewgame` を出す。待たずに積むと、
    // 呼び出し側は「対局が始まった」と思ったまま何も起きない状態になりうる
    protocol
        .ensure_ready(READY_TIMEOUT)
        .await
        .map_err(|e| e.to_string())?;

    protocol
        .send_command(&GuiCommand::UsiNewGame)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

impl GameSettings {
    fn spec(&self, side: Side) -> &PlayerSpec {
        match side {
            Side::Black => &self.black,
            Side::White => &self.white,
        }
    }
}

pub(super) fn validate_settings(settings: &GameSettings) -> Result<(), String> {
    settings
        .black_time
        .validate()
        .map_err(|e| format!("black: {e}"))?;
    settings
        .white_time
        .validate()
        .map_err(|e| format!("white: {e}"))?;

    if contains_usi_breaking_char(&settings.start_sfen) {
        return Err("start_sfen contains a forbidden control character".to_string());
    }
    // `startpos` は受け取らない。`GuiCommand::Position` が `position sfen` を
    // 前置するので、`position sfen startpos moves ...` という壊れた行になる
    let mut fields = settings.start_sfen.split_whitespace();
    if fields.next() == Some("startpos") {
        return Err("start_sfen must be a full SFEN, not \"startpos\"".to_string());
    }
    if fields.next().and_then(Side::from_sfen_token).is_none() {
        return Err("start_sfen must have \"b\" or \"w\" as its second field".to_string());
    }
    for mv in &settings.initial_moves {
        validate_usi_move(mv)?;
    }
    Ok(())
}

/// `played` 手が指された後の手番。SFEN の2番目のフィールドを手数の偶奇で反転させる
pub(super) fn derive_side_after(settings: &GameSettings, played: usize) -> Side {
    let root = settings
        .start_sfen
        .split_whitespace()
        .nth(1)
        .and_then(Side::from_sfen_token)
        .unwrap_or(Side::Black);

    if played % 2 == 0 {
        root
    } else {
        root.opponent()
    }
}

pub(super) fn position_argument(start_sfen: &str, moves: &[String]) -> String {
    if moves.is_empty() {
        start_sfen.to_string()
    } else {
        format!("{start_sfen} moves {}", moves.join(" "))
    }
}

/// USI の指し手として**形が**通るか。合法かどうかは見ない（ルールは持たない）
pub(super) fn validate_usi_move(usi_move: &str) -> Result<(), String> {
    if usi_move.is_empty() {
        return Err("move is empty".to_string());
    }
    if usi_move.len() > 8 {
        return Err(format!("move is too long: {usi_move}"));
    }
    if !usi_move.is_ascii()
        || usi_move
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!("move has an unusable shape: {usi_move}"));
    }
    Ok(())
}

fn contains_usi_breaking_char(s: &str) -> bool {
    s.chars().any(|c| c == '\n' || c == '\r' || c == '\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 平手。`GuiCommand::Position` が `position sfen` を前置するので、
    /// `startpos` ではなく完全な SFEN を持つ
    const HIRATE: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

    fn minutes(n: u64) -> TimeLimit {
        TimeLimit {
            main_ms: n * 60_000,
            byoyomi_ms: 0,
            increment_ms: 0,
        }
    }

    /// 先後とも人間の設定。
    ///
    /// **エンジンを1つも起動しないので、実プロセス無しで状態機械を踏める。**
    /// `spawn_players` は人間側を飛ばすため、`registry` は空のまま使われない。
    fn two_humans(initial_moves: Vec<&str>) -> GameSettings {
        GameSettings {
            black: PlayerSpec::Human {
                name: "先手".to_string(),
            },
            white: PlayerSpec::Human {
                name: "後手".to_string(),
            },
            black_time: minutes(10),
            white_time: minutes(10),
            start_sfen: HIRATE.to_string(),
            initial_moves: initial_moves.into_iter().map(String::from).collect(),
            enforce_engine_timeout: false,
        }
    }

    async fn start(settings: GameSettings) -> GameSession {
        GameSession::start(Arc::new(EngineRegistry::new()), None, settings)
            .await
            .expect("人間だけの対局は起動できるはず")
    }

    fn phase_of(snapshot: &GameSnapshot) -> &GamePhaseView {
        &snapshot.phase
    }

    #[tokio::test]
    async fn side_to_move_comes_from_the_sfen() {
        let game = start(two_humans(vec![])).await;
        let snapshot = game.snapshot().await.unwrap();
        assert!(matches!(
            phase_of(&snapshot),
            GamePhaseView::Thinking { side: Side::Black }
        ));
    }

    #[tokio::test]
    async fn initial_moves_flip_the_side_to_move() {
        let game = start(two_humans(vec!["7g7f"])).await;
        let snapshot = game.snapshot().await.unwrap();
        assert!(matches!(
            phase_of(&snapshot),
            GamePhaseView::Thinking { side: Side::White }
        ));
        assert_eq!(snapshot.moves, vec!["7g7f".to_string()]);
    }

    #[tokio::test]
    async fn a_decided_move_stops_the_game_until_the_app_rules_on_it() {
        let game = start(two_humans(vec![])).await;
        game.submit_move(Side::Black, "7g7f".to_string())
            .await
            .unwrap();

        let snapshot = game.snapshot().await.unwrap();
        match phase_of(&snapshot) {
            GamePhaseView::AwaitingRuling {
                last_mover,
                usi_move,
            } => {
                assert_eq!(*last_mover, Side::Black);
                assert_eq!(usi_move, "7g7f");
            }
            other => panic!("裁定待ちに入っていない: {other:?}"),
        }

        // 裁定が返るまでは次の手を受け付けない
        assert!(game
            .submit_move(Side::White, "3c3d".to_string())
            .await
            .is_err());

        // 指し手列は裁定を通るまで増えない。権威はフロント側
        assert!(snapshot.moves.is_empty());
    }

    #[tokio::test]
    async fn continue_hands_the_turn_over_and_takes_the_app_move_list() {
        let game = start(two_humans(vec![])).await;
        game.submit_move(Side::Black, "7g7f".to_string())
            .await
            .unwrap();
        game.continue_game(vec!["7g7f".to_string()]).await.unwrap();

        let snapshot = game.snapshot().await.unwrap();
        assert!(matches!(
            phase_of(&snapshot),
            GamePhaseView::Thinking { side: Side::White }
        ));
        assert_eq!(snapshot.moves, vec!["7g7f".to_string()]);
    }

    #[tokio::test]
    async fn continue_is_refused_when_the_list_does_not_end_with_the_decided_move() {
        let game = start(two_humans(vec![])).await;
        game.submit_move(Side::Black, "7g7f".to_string())
            .await
            .unwrap();

        // 直前に決まった手で終わっていない
        assert!(game.continue_game(vec!["2g2f".to_string()]).await.is_err());
        // 裁定待ちのまま留まる
        assert!(matches!(
            phase_of(&game.snapshot().await.unwrap()),
            GamePhaseView::AwaitingRuling { .. }
        ));
    }

    #[tokio::test]
    async fn continue_is_refused_when_the_move_count_does_not_match_the_next_side() {
        let game = start(two_humans(vec![])).await;
        game.submit_move(Side::Black, "7g7f".to_string())
            .await
            .unwrap();

        // 末尾は合っているが手数が偶数なので、次の手番が先手になってしまう
        assert!(game
            .continue_game(vec![
                "2g2f".to_string(),
                "3c3d".to_string(),
                "2f2e".to_string(),
                "7g7f".to_string()
            ])
            .await
            .is_err());
    }

    #[tokio::test]
    async fn continue_is_refused_outside_a_ruling() {
        let game = start(two_humans(vec![])).await;
        assert!(game.continue_game(vec!["7g7f".to_string()]).await.is_err());
    }

    #[tokio::test]
    async fn a_move_from_the_side_not_to_move_is_refused() {
        let game = start(two_humans(vec![])).await;
        assert!(game
            .submit_move(Side::White, "3c3d".to_string())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn end_by_rule_finishes_and_records_who_won() {
        let game = start(two_humans(vec![])).await;
        game.submit_move(Side::Black, "7g7f".to_string())
            .await
            .unwrap();
        game.end_by_rule(Some(Side::Black), Some("詰み".to_string()))
            .await
            .unwrap();

        match phase_of(&game.snapshot().await.unwrap()) {
            GamePhaseView::Over { result } => {
                assert_eq!(result.winner, Some(Side::Black));
                assert_eq!(result.reason, GameOverReason::Rule);
                assert_eq!(result.detail.as_deref(), Some("詰み"));
            }
            other => panic!("終局していない: {other:?}"),
        }
        // 終局後は二度と受け付けない
        assert!(game.end_by_rule(None, None).await.is_err());
    }

    #[tokio::test]
    async fn resign_gives_the_win_to_the_opponent() {
        let game = start(two_humans(vec![])).await;
        game.resign(Side::Black).await.unwrap();

        match phase_of(&game.snapshot().await.unwrap()) {
            GamePhaseView::Over { result } => {
                assert_eq!(result.winner, Some(Side::White));
                assert_eq!(result.reason, GameOverReason::Resign);
            }
            other => panic!("終局していない: {other:?}"),
        }
    }

    #[tokio::test]
    async fn abort_finishes_without_a_winner() {
        let game = start(two_humans(vec![])).await;
        game.abort().await.unwrap();

        match phase_of(&game.snapshot().await.unwrap()) {
            GamePhaseView::Over { result } => {
                assert_eq!(result.winner, None);
                assert_eq!(result.reason, GameOverReason::Aborted);
            }
            other => panic!("終局していない: {other:?}"),
        }
    }

    /// 固定しているのは `on_tick` が裁定待ちで時計を見ないこと。
    /// **時計そのものが止まることは別のテストが見る**（下の1本）。
    /// 2つを1本にすると、片方を壊しても通ってしまう
    #[tokio::test]
    async fn ruling_never_runs_the_clock_out() {
        let mut settings = two_humans(vec![]);
        // 100ms しか無い持ち時間で裁定待ちに入れる。時計を見ていれば必ず尽きる
        settings.black_time = TimeLimit {
            main_ms: 100,
            byoyomi_ms: 0,
            increment_ms: 0,
        };
        let game = start(settings).await;
        game.submit_move(Side::Black, "7g7f".to_string())
            .await
            .unwrap();

        tokio::time::sleep(Duration::from_millis(400)).await;

        assert!(
            matches!(
                phase_of(&game.snapshot().await.unwrap()),
                GamePhaseView::AwaitingRuling { .. }
            ),
            "裁定待ちの間に時間切れにしてはいけない"
        );
    }

    #[tokio::test]
    async fn the_shown_clock_does_not_move_while_the_app_is_ruling() {
        let game = start(two_humans(vec![])).await;
        game.submit_move(Side::Black, "7g7f".to_string())
            .await
            .unwrap();

        let before = game.snapshot().await.unwrap().clocks;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let after = game.snapshot().await.unwrap().clocks;

        assert_eq!(before.black.remaining_ms, after.black.remaining_ms);
        assert_eq!(before.white.remaining_ms, after.white.remaining_ms);
    }

    #[tokio::test]
    async fn the_shown_clock_moves_while_a_side_is_thinking() {
        // 上の1本が「止まっている」を見るので、こちらで「動く」側を押さえる。
        // 両方無いと、時計を常に止めても両方通る
        let game = start(two_humans(vec![])).await;

        let before = game.snapshot().await.unwrap().clocks;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let after = game.snapshot().await.unwrap().clocks;

        assert!(
            after.black.remaining_ms < before.black.remaining_ms,
            "手番側の時計が動いていない: {} -> {}",
            before.black.remaining_ms,
            after.black.remaining_ms
        );
        assert_eq!(
            before.white.remaining_ms, after.white.remaining_ms,
            "手番でない側の時計が動いている"
        );
    }

    #[tokio::test]
    async fn running_out_of_time_ends_the_game() {
        let mut settings = two_humans(vec![]);
        settings.black_time = TimeLimit {
            main_ms: 50,
            byoyomi_ms: 0,
            increment_ms: 0,
        };
        let game = start(settings).await;

        // tick は 100ms ごと。実時間で待つので余裕を取る
        let mut result = None;
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if let GamePhaseView::Over { result: r } = phase_of(&game.snapshot().await.unwrap()) {
                result = Some(r.clone());
                break;
            }
        }

        let result = result.expect("持ち時間が尽きても終局しなかった");
        assert_eq!(result.reason, GameOverReason::Timeout);
        assert_eq!(result.winner, Some(Side::White));
    }

    #[test]
    fn settings_reject_startpos_because_position_sfen_is_prepended() {
        let mut settings = two_humans(vec![]);
        settings.start_sfen = "startpos".to_string();
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn settings_reject_an_sfen_without_a_side_field() {
        let mut settings = two_humans(vec![]);
        settings.start_sfen =
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL".to_string();
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn position_is_built_as_sfen_plus_moves() {
        assert_eq!(position_argument(HIRATE, &[]), HIRATE);
        assert_eq!(
            position_argument(HIRATE, &["7g7f".to_string(), "3c3d".to_string()]),
            format!("{HIRATE} moves 7g7f 3c3d")
        );
    }

    #[test]
    fn move_shape_is_checked_but_legality_is_not() {
        // 通したい形
        for mv in ["7g7f", "8h2b+", "P*5e", "5a5b"] {
            assert!(validate_usi_move(mv).is_ok(), "{mv} が弾かれた");
        }
        // 合法かどうかは見ない。盤の上でありえない手でも形が通れば通す
        assert!(validate_usi_move("1a1a").is_ok());

        // 形が壊れているもの
        assert!(validate_usi_move("").is_err());
        assert!(validate_usi_move("7g 7f").is_err());
        assert!(validate_usi_move("7g7f\nquit").is_err());
        assert!(validate_usi_move("７六歩").is_err());
        assert!(validate_usi_move("aaaaaaaaa").is_err());
    }

    #[test]
    fn control_characters_are_rejected_across_the_whole_range() {
        // 列挙で書くと必ず漏れる。範囲を回す（/implement 手順5）
        for code in 0x00u8..=0x1F {
            let mv = format!("7g7{}", code as char);
            assert!(
                validate_usi_move(&mv).is_err(),
                "制御文字 {code:#04x} が通った"
            );
        }
    }
}
