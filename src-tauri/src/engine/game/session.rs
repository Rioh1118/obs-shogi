//! 対局セッションの状態機械。
//!
//! 状態を1つのタスクが持ち、外からの要求も探索タスクからの通知も同じ
//! チャンネルに流す。**ロックを持ったまま USI を送る経路を作らない**ための形で、
//! 「止めたはずのエンジンから届いた `bestmove` を今の手番の着手として採る」
//! 類の取り違えが起きる場所を1箇所に閉じ込める。
//!
//! # 責任の切れ目
//!
//! **ここは将棋のルールを持たない。**
//!
//! 合法手と成りの判定は**既にフロントにある**（`shogiMoveValidator.ts`）。
//! 盤の表示（移動可能マスの強調・成り選択）にも要るので消せず、Rust に重ねると
//! 合法手判定が2実装になる。ルールをフロント側に寄せるのはそのため。
//!
//! **詰み・千日手・持将棋・最大手数の判定は、まだどちらにも無い** → #354。
//! この層はそれらを持たないので、指した後の局面が終局かどうかを自分では知れない。
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
use tokio::sync::mpsc::WeakUnboundedSender;
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

/// `go` を出してから `bestmove` を待つ上限に足す猶予。
///
/// 締切は「その手に使い切れる持ち時間 ＋ これ」。**時間切れ負けの判定とは別物**で、
/// こちらは**エンジンが黙ったことを見つける**ためにある。`enforce_engine_timeout`
/// が `false`（既定）でも必ず効く。
///
/// 30秒あるのは、持ち時間を使い切った後もエンジンは1手指すまで返らないため。
/// 短くすると、正常に長考しているエンジンを故障と呼ぶ。
const SEARCH_GRACE: Duration = Duration::from_secs(30);

/// 手番が長すぎることの番人。**`Thinking` の全部をここ1本で見る。**
///
/// 見るのは「**いまどうなっているか**」（`TurnClock` と持ち時間）で、
/// 「いつ探索を起動したか」ではない。探索タスクの中に締切を置くと、
/// `ponderhit` で先読みから本番へ昇格した探索を観測できない
/// （タスクは起動時の値を握ったまま走るため）。
///
/// **時間切れ負けの判定とは別物。** `enforce_engine_timeout` を見ないのは、
/// これが「黙ったエンジンを見つける」ためにあるから。
///
/// 先読み中は `TurnClock` が相手側の手番を指しているので、ここには掛からない
/// （先読みは `ponderhit` か `stop` が来るまで走ってよい）。
fn stalled_turn(clock: TurnClock, budget_ms: u64) -> Option<Stall> {
    match clock {
        TurnClock::Settling(since) if since.elapsed() >= SETTLE_TIMEOUT => Some(Stall::NotStopping),
        TurnClock::Running(since)
            if since.elapsed() >= Duration::from_millis(budget_ms) + SEARCH_GRACE =>
        {
            Some(Stall::NotAnswering)
        }
        _ => None,
    }
}

/// 手番が進まない理由。**エンジンの状態が違うので潰さない。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stall {
    /// `stop` を出したのに畳み終わらない
    NotStopping,
    /// `go` を出したのに `bestmove` が返らない
    NotAnswering,
}

impl Stall {
    fn detail(self) -> &'static str {
        match self {
            Stall::NotStopping => "the engine did not stop searching in time",
            Stall::NotAnswering => "the engine did not answer in time",
        }
    }
}

/// 手番に入ったまま `go` を出せずにいられる上限。
///
/// **`stalled_turn` の `Settling` の枝だけが使う。** `Running` の枝は
/// 同じ関数が「持ち時間＋`SEARCH_GRACE`」で見る。番人は分かれていない。
/// 畳み待ちの間は時計が動かないので、時間切れの判定には掛からない。
/// ここが無いと、`stop` の書き込みが詰まったときに対局が無音のまま固まる。
///
/// `search.rs` の `SEARCH_STOP_GRACE`（5秒）＋書き込みの上限（2秒）より長く取る。
/// 短いと、正常に畳んでいる最中のエンジンを故障と呼ぶ。
const SETTLE_TIMEOUT: Duration = Duration::from_secs(10);

/// `close` が「両側の `Activity` が `Idle` に戻る」のを待つ上限。
///
/// **`SETTLE_TIMEOUT` とは別物。** あちらは `TurnClock::Settling`（手番に入ったが
/// `go` をまだ出していない）を見る番人で、こちらは探索が畳まれたかを見る待ち。
/// 見ている述語も所有者も違うので、片方の値をもう片方に合わせないこと。
///
/// **待つ**理由: 待たずに落とすと、`stop` を送ろうとしている探索の足元で
/// プロセスが消える。チャンネルが閉じて `Failed` が上がり、正常に閉じただけなのに
/// 「エンジンが応答しない」というログが毎回出て、本物の故障と区別が付かなくなる。
///
/// **上限を置く**理由: `abort` も `searches_idle` も `run_loop` が1件ずつ
/// 処理し、その中で `send_command` を待つ。エンジンが stdin を読まなくなると
/// パイプが埋まって書き込みが止まり、応答が返らない。上限が無いと
/// `close_game` が無期限に返らなくなる。
///
/// `search.rs` の `SEARCH_STOP_GRACE` より少し長い。
pub(super) const CLOSE_IDLE_TIMEOUT: Duration = Duration::from_secs(6);

/// 畳まれたかを聞き直す間隔。
///
/// **聞きに行くのは、畳まれたことを知らせる口が無いため。** `Activity` が
/// `Idle` に戻るのは `run_loop` の中で、そこから外へ通知する経路を持っていない。
///
/// 50ms は `TICK`（100ms）より細かく、`close_game` の応答に足す遅れが
/// 人に分からない範囲。細かくするほど `SearchesIdle` が `Tick` と同じ
/// キューに並ぶので、`run_loop` を要求で埋めない上限でもある
/// （6秒で最大120回）。
const CLOSE_POLL: Duration = Duration::from_millis(50);

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
            turn_clock: TurnClock::Running(Instant::now()),
            next_req: 0,
            last_clock_emit: Instant::now(),
            tx: tx.downgrade(),
        };

        runner.emit(GameEvent::TurnChanged {
            game_id: id.clone(),
            side: side_to_move,
            clocks: runner.clocks_view(),
        });
        runner.start_search(side_to_move);

        tokio::spawn(run_loop(runner, rx));
        tokio::spawn(tick_loop(tx.downgrade()));

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
        // 「止める → 畳まれるのを**待つ** → 落とす」の順。
        // 待つ理由と上限の理由はどちらも `CLOSE_IDLE_TIMEOUT` に書いてある
        let deadline = Instant::now() + CLOSE_IDLE_TIMEOUT;
        // `abort` の失敗は2通りで、意味が正反対。潰すとログから区別が付かない
        match tokio::time::timeout(CLOSE_IDLE_TIMEOUT, self.abort()).await {
            Ok(Ok(())) => {}
            // セッションのタスクが先に居なくなった。もう止まっている
            Ok(Err(e)) => log::debug!(target: LOGT, "close: nothing to abort: {e}"),
            // `run_loop` が詰まっている。止められていない
            Err(_) => log::warn!(target: LOGT, "close: abort timed out; the session is stuck"),
        }

        let mut idle = false;
        while !idle {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            match tokio::time::timeout(left, self.searches_idle()).await {
                // 畳まれた、またはセッションのタスクがもう無い
                Ok(Ok(true)) | Ok(Err(_)) => idle = true,
                Ok(Ok(false)) => tokio::time::sleep(CLOSE_POLL).await,
                // 期限切れ。応答そのものが返らない
                Err(_) => break,
            }
        }

        if !idle {
            // 「畳まれなかった」と「畳まれたか**尋ねられなかった**」の両方でここに来る。
            // `abort` が上限を使い切ると `left` が 0 になり、1度も尋ねずに抜ける
            log::warn!(
                target: LOGT,
                "close: could not confirm searches idle game_id={}",
                self.id
            );
        }

        // 上限は `registry::terminate` の中にある。ここで包み直さないこと。
        // 二重に上限を置くと、どちらが効いたかがログから読めなくなる
        for id in &self.engine_ids {
            registry.shutdown(id).await;
        }
    }

    /// 走っている探索が無いか。
    async fn searches_idle(&self) -> Result<bool, String> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(Command::SearchesIdle { reply })
            .map_err(|_| ENDED.to_string())?;
        rx.await.map_err(|_| ENDED.to_string())
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
    SearchesIdle {
        reply: oneshot::Sender<bool>,
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
}

impl Player {
    fn new(spec: PlayerSpec, engine: Option<Arc<EngineProcess>>) -> Self {
        Self {
            spec,
            engine,
            activity: Activity::Idle,
        }
    }

    fn ponder_enabled(&self) -> bool {
        matches!(self.spec, PlayerSpec::Engine { ponder: true, .. })
    }
}

/// エンジンプロセスが USI 上でいまどの状態にあるか。
///
/// **セッションの段（`Phase`）と別に持つ。** 一致させ損ねたときに何が
/// 起きるかは `docs/state-transitions/game-session.md` の不変条件1
/// （`G0` の間、本番の `go` が出ているのは手番側だけ）。
enum Activity {
    Idle,
    /// `go` / `go ponder` を送って `bestmove` を待っている
    Searching {
        req: u64,
        kind: SearchKind,
        cancel: CancellationToken,
    },
    /// 止めた。**この `req` の結果は着手として採らない。**
    /// 止めた探索の答えは別の局面に対するもので、いまの局面では非合法になりうる。
    /// 捨てる `bestmove` が返ったら、`restart` なら本番の思考を始める
    Stopping {
        req: u64,
        restart: bool,
    },
    /// 止めたのに `bestmove` が返らなかった。**エンジンは探索中とみなす。**
    /// `gameover` を送らないのはそのため（探索中の `gameover` はプロトコル違反）。
    ///
    /// **`Phase::Thinking` と同時には立たない。** これを立てるのは
    /// `on_search_outcome` が `StopTimedOut` を受けたときだけで、その同じ
    /// 呼び出しの中で `finish` が `Phase::Over` に入れる。`AwaitingRuling` から
    /// しか来ない `accept_continue` は、この値を見ることがない。
    /// `finish` を条件付きに変えると、その経路が生き返る
    Unresponsive,
}

/// 手番を渡すときに、そのエンジンをどう扱うか。
///
/// **`StartNow` と `StopThenStart` を1つに潰さない。** 潰すと、走っている探索の
/// 上から `go` を出す経路ができる（USI は探索中の `position` / `go` を認めない）。
enum Handover {
    /// 先読みが当たった。`ponderhit` を送って続けさせる
    PonderHit,
    /// 走っているものを止め、捨てる `bestmove` が返ってから始める
    StopThenStart,
    /// 何も走っていない。そのまま `go`
    StartNow,
    /// 止めたのに応答しないエンジン。この側は指せない
    Unusable,
}

enum Phase {
    /// `side` の着手待ち。**時計が動いているとは限らない。**
    /// 動くのは `turn_clock` が `Running` のときだけ（`running_clock`）
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

/// 手番の中で、時計が動いているか止まっているか。
///
/// **どちらの枝も時刻を持つ。** 止まっている側にも時刻が要るのは、
/// `on_tick` の `SETTLE_TIMEOUT` が「いつから畳み待ちか」を見るため。
#[derive(Debug, Clone, Copy)]
enum TurnClock {
    /// `go` を出した時刻。時計はここから動く
    Running(Instant),
    /// 手番だが、まだ `go` を出していない。止めた探索を畳んでいる間
    /// （`Activity::Stopping`）がこれで、**その間は時計を動かさない**。
    /// 手番に入った時刻で数えると、エンジンが1手も読んでいない最大 `SEARCH_STOP_GRACE` が
    /// 消費に入り、画面の残り時間も畳み終わりに巻き戻る。
    ///
    /// 持つのは**待ち始めた**時刻で、`on_tick` の番人がこれを見る
    Settling(Instant),
}

struct Runner {
    id: GameId,
    /// イベントの宛先。**`None` はテストのときだけ。**
    ///
    /// 本番は `GameManager` が必ず `Some` を渡す。`None` にすると
    /// `emit` が黙って捨てるので、フロントは時計も指し手も終局も受け取らない。
    /// テストが `None` を使うのは、`AppHandle` を作るのに Tauri の
    /// ランタイムが要るため。
    app: Option<AppHandle>,
    settings: GameSettings,
    players: [Player; 2],
    clocks: GameClocks,
    /// 指し手列の**写し**。権威はフロントにあり、`continue_game` が上書きする
    moves: Vec<String>,
    phase: Phase,
    turn_clock: TurnClock,
    next_req: u64,
    last_clock_emit: Instant,
    /// 探索タスクへ渡す、自分あての口。
    ///
    /// **weak であることが要る。** strong を持つと `run_loop` が所有する
    /// `Runner` が自分のチャンネルを生かし続け、`rx.recv()` が永久に
    /// `None` を返さない。`GameSession` を捨てても対局のタスクが残る。
    tx: WeakUnboundedSender<Command>,
}

/// 対局が畳まれたら、走っている探索も止める。
///
/// **`CancellationToken` は drop では cancel しない**（`tokio_util`）。
/// `run_loop` が終わって `Runner` が落ちても、`go ponder` を投げた探索タスクは
/// `bestmove` も cancel も来ないまま残り続ける。ここで明示的に落とす。
impl Drop for Runner {
    fn drop(&mut self) {
        for player in &self.players {
            if let Activity::Searching { cancel, .. } = &player.activity {
                cancel.cancel();
            }
        }
    }
}

async fn run_loop(mut runner: Runner, mut rx: mpsc::UnboundedReceiver<Command>) {
    while let Some(command) = rx.recv().await {
        runner.handle(command).await;
    }
    log::debug!(target: LOGT, "run_loop: ended game_id={}", runner.id);
}

/// 時計を見るための拍。
///
/// **weak で持つ。** strong を持つと、この拍自身が対局のチャンネルを
/// 生かし続けて `run_loop` が終わらなくなる。
async fn tick_loop(tx: WeakUnboundedSender<Command>) {
    let mut interval = tokio::time::interval(TICK);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let Some(tx) = tx.upgrade() else {
            return;
        };
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
            Command::SearchesIdle { reply } => {
                let _ = reply.send(self.searches_idle());
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
        // 手番に入った時点では `go` をまだ出していない。`hand_turn_to` が
        // `Running` に上書きするまで時計は動かず、`on_tick` の `SETTLE_TIMEOUT`
        // がここからの経過を見る
        self.turn_clock = TurnClock::Settling(Instant::now());

        self.hand_turn_to(next, &usi_move).await;

        // `hand_turn_to` は終局させることがある（渡す先が応答しないエンジンだったとき）。
        // 見ないと、`Over` を出した直後に `TurnChanged` を出し、
        // `gameover` を送ったエンジンへ `go ponder` を投げる
        if self.is_over() {
            return Ok(());
        }

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
        // 世代の照合と「この結果を着手として採ってよいか」を1箇所で決める。
        //
        // **`Stopping` の間に返ってきたものは採らない。** 止めた探索の答えは
        // 別の局面に対するもので、いまの局面では非合法になりうる。
        // 採る／採らないを `Activity` から引くので、別のフラグと食い違わない
        let (accept, restart) = match &self.player(side).activity {
            Activity::Searching { req: current, .. } if *current == req => (true, false),
            Activity::Stopping {
                req: current,
                restart,
            } if *current == req => (false, *restart),
            _ => {
                // 世代が合わない。前の `go` の後始末が遅れて届いただけ
                log::debug!(target: LOGT, "stale search outcome side={side:?} req={req}");
                return;
            }
        };

        // **バリアントを1つずつ書く。** `_ =>` にすると、後から足した変種が
        // 黙って `Idle` へ落ちる。`Idle` は `finish` に「`gameover` を送ってよい」
        // と読まれるので、まだ探索しているエンジンへ送ることになる（不変条件3）。
        // 足したときにここを数え直させるために網羅で書く
        self.player_mut(side).activity = match outcome {
            // まだ探索中。`gameover` を送らない
            SearchOutcome::StopTimedOut => Activity::Unresponsive,
            // どれも「エンジンは止まっている」。`Failed` は出力が終わった側
            SearchOutcome::Move { .. }
            | SearchOutcome::Resign
            | SearchOutcome::DeclareWin
            | SearchOutcome::StoppedCleanly
            | SearchOutcome::Failed(_) => Activity::Idle,
        };

        // 終局後に返ってきた `bestmove` は、`gameover` を送るための合図にだけ使う。
        // 探索中のエンジンへ `gameover` を送るのはプロトコル違反なので、
        // idle に戻ったここまで待つ
        if let Phase::Over { result } = &self.phase {
            let result = result.clone();
            if !matches!(self.player(side).activity, Activity::Unresponsive) {
                self.send_gameover(side, &result).await;
            }
            return;
        }

        // エンジンの故障は、採る採らないに関わらず終局にする
        match outcome {
            SearchOutcome::StopTimedOut => {
                log::error!(target: LOGT, "engine did not stop searching side={side:?}");
                self.finish(GameResult {
                    winner: Some(side.opponent()),
                    reason: GameOverReason::EngineFailure,
                    detail: Some("engine did not stop searching in time".to_string()),
                })
                .await;
                return;
            }
            SearchOutcome::Failed(message) => {
                log::error!(target: LOGT, "engine failed side={side:?}: {message}");
                self.finish(GameResult {
                    winner: Some(side.opponent()),
                    reason: GameOverReason::EngineFailure,
                    detail: Some(message),
                })
                .await;
                return;
            }
            _ => {}
        }

        if !accept {
            // 止めた探索の結果。捨てて、必要なら改めていまの局面で考えさせる
            if restart && self.is_to_move(side) {
                // **時計をここで引き直す。** `accept_continue` が手番を渡した
                // 時点から数えると、止めた探索が畳まれるのを待っていた時間
                // （最大 `SEARCH_STOP_GRACE`）が、1手も読んでいないエンジンの
                // 消費として計上される。`go` に載せる `btime` は満額なので、
                // 画面の残り時間とエンジンに伝えた残り時間も食い違う。
                //
                // 引き直すぶん、止めている間は**どちらの持ち時間にも入らない**
                self.turn_clock = TurnClock::Running(Instant::now());
                self.start_search(side);
            }
            return;
        }

        match outcome {
            SearchOutcome::StoppedCleanly
            | SearchOutcome::StopTimedOut
            | SearchOutcome::Failed(_) => {
                // 上で処理済み。
                //
                // `Aborted` は `Searching` からも来る（`finish` は `Stopping` へ
                // 移さずに cancel するため）。それがここへ落ちないのは、
                // **`Phase::Over` の早期 return が先にある**から。
                // `Over` の判定をこの `match` より後ろへ動かすと、終局時の
                // `Aborted` がこの空アームに吸われて `gameover` が飛ばなくなる
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

                // 手番が進まないことの番人。**`Settling` も `Running` もここで見る。**
                // 探索タスクの中に置くと `ponderhit` の昇格を観測できず、
                // 終局させても `Activity` が `Idle` に戻ってしまう
                // （探索中のエンジンへ `gameover` が飛ぶ）
                if let Some(stall) = stalled_turn(self.turn_clock, self.clocks.budget_ms(side)) {
                    self.finish(GameResult {
                        winner: Some(side.opponent()),
                        reason: GameOverReason::EngineFailure,
                        detail: Some(stall.detail().to_string()),
                    })
                    .await;
                    return;
                }

                if let Some((side, elapsed)) = self.running_clock() {
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
        let elapsed = self.running_clock().map_or(0, |(_, ms)| ms);
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
        let handover = match &self.player(side).activity {
            Activity::Searching {
                kind: SearchKind::Ponder { ponder_move },
                ..
            } => {
                if ponder_move == last_move {
                    Handover::PonderHit
                } else {
                    Handover::StopThenStart
                }
            }
            Activity::Searching {
                kind: SearchKind::Search,
                ..
            } => {
                // 手番でない側が本番の思考をしている。組み立てを間違えている。
                //
                // **`Idle` と同じ扱いにしない。** そのまま `go` を出すと
                // 探索中のエンジンへ `position` / `go` を送ることになる（USI 違反）
                log::warn!(target: LOGT, "unexpected live search on idle side={side:?}");
                Handover::StopThenStart
            }
            // 前に止めた分がまだ返っていない。`restart` を立てるだけ
            Activity::Stopping { .. } => Handover::StopThenStart,
            // 到達しない理由は `Activity::Unresponsive` の doc
            Activity::Unresponsive => Handover::Unusable,
            Activity::Idle => Handover::StartNow,
        };

        match handover {
            // 読み当たり。エンジンはそのまま考え続ける。ここから時計が動く
            Handover::PonderHit => {
                let sent = match self.protocol(side) {
                    Some(protocol) => protocol.send_command(&GuiCommand::Ponderhit).await,
                    None => Ok(()),
                };
                match sent {
                    Ok(()) => {
                        if let Activity::Searching { kind, .. } =
                            &mut self.player_mut(side).activity
                        {
                            *kind = SearchKind::Search;
                        }
                        // 先読みの時間は無料。時計はここから動く
                        self.turn_clock = TurnClock::Running(Instant::now());
                    }
                    Err(e) => {
                        // 送れていないのでエンジンは `go ponder` のまま。
                        // `Search` に書き換えると「考えている」と誤認したまま
                        // 時計だけが進む。止めて始め直す側へ倒す
                        log::warn!(target: LOGT, "ponderhit failed side={side:?}: {e}");
                        self.stop_then_start(side);
                    }
                }
            }
            Handover::StopThenStart => self.stop_then_start(side),
            Handover::StartNow => {
                self.turn_clock = TurnClock::Running(Instant::now());
                self.start_search(side);
            }
            Handover::Unusable => {
                log::error!(target: LOGT, "handing the turn to an unresponsive engine side={side:?}");
                self.finish(GameResult {
                    winner: Some(side.opponent()),
                    reason: GameOverReason::EngineFailure,
                    detail: Some("engine did not stop searching in time".to_string()),
                })
                .await;
            }
        }
    }

    /// 手番を渡す先の `activity` に応じて、思考を始める段取りを決める。
    ///
    /// 分岐で振る舞いが違う。
    ///
    /// - `Searching` / `Stopping` — 止めて `A3 { restart }` にする。
    ///   **実際の `go` は `on_search_outcome` が出す。** ここで出すと、
    ///   遅れて届く前の局面の `bestmove` を新しい探索のものとして採る
    /// - `Idle` — **その場で `go` を出す**。時計もここから動く
    /// - `Unresponsive` — 何もできない。**対局はここで進まなくなる**ので、
    ///   呼び出し側が終局させること（`hand_turn_to` の `Unusable` がそれ）
    fn stop_then_start(&mut self, side: Side) {
        match &mut self.player_mut(side).activity {
            Activity::Searching { req, cancel, .. } => {
                cancel.cancel();
                let req = *req;
                self.player_mut(side).activity = Activity::Stopping { req, restart: true };
            }
            Activity::Stopping { restart, .. } => *restart = true,
            // 何も走っていない。そのまま始めてよい
            Activity::Idle => {
                self.turn_clock = TurnClock::Running(Instant::now());
                self.start_search(side);
            }
            Activity::Unresponsive => {
                log::error!(target: LOGT, "cannot restart an unresponsive engine side={side:?}");
            }
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

        // **`Idle` の側にだけ呼ぶ。** 走っているものの上から始めると、
        // 探索中のエンジンへ `position` / `go` を送ることになる（USI 違反）。
        // 止めてから始めるのは `stop_then_start` の責務
        if !matches!(self.player(side).activity, Activity::Idle) {
            log::error!(target: LOGT, "spawn_search: the side is not idle side={side:?}");
            debug_assert!(false, "spawn_search は Idle の側にだけ呼ぶ");
            return;
        }

        // **weak のまま渡す。** ここで `upgrade()` して strong を持たせると、
        // その探索が終わるまで対局のチャンネルが生き続け、`GameSession` を
        // 捨てても `run_loop` が終わらない。`go ponder` は `ponderhit` か
        // `stop` が来るまで `bestmove` を返さないので、輪は永久に残りうる
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let (search_tx, mut search_rx) = mpsc::unbounded_channel();
            let forward = tokio::spawn(async move {
                while let Some(message) = search_rx.recv().await {
                    let Some(tx) = tx.upgrade() else {
                        // 対局はもう無い。走らせ続ける意味が無い
                        return;
                    };
                    if tx.send(Command::Search(message)).is_err() {
                        return;
                    }
                }
            });
            run_search(request, search_tx).await;
            let _ = forward.await;
        });

        self.player_mut(side).activity = Activity::Searching { req, kind, cancel };
    }

    async fn finish(&mut self, result: GameResult) {
        if self.is_over() {
            return;
        }

        // 走っている思考を止める。`gameover` はエンジンが idle に戻ってから
        // （`on_search_outcome` の Over 分岐）送る
        let mut idle_sides = Vec::new();
        for side in [Side::Black, Side::White] {
            match &mut self.player_mut(side).activity {
                Activity::Searching { cancel, .. } => cancel.cancel(),
                // 既に止めてある。`bestmove` を待っている間に始め直さない
                Activity::Stopping { restart, .. } => *restart = false,
                // 探索中とみなす側。`gameover` を送らない（不変条件3）
                Activity::Unresponsive => {}
                Activity::Idle => idle_sides.push(side),
            }
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

    /// 走っている探索が無いか。
    ///
    /// `Unresponsive` は**畳まれたものとして数える**。`stop` に応じないと
    /// 分かっている側なので、待ち続けても返らない。
    fn searches_idle(&self) -> bool {
        [Side::Black, Side::White].into_iter().all(|side| {
            !matches!(
                self.player(side).activity,
                Activity::Searching { .. } | Activity::Stopping { .. }
            )
        })
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

    /// いま時計が動いている側と、その手に既に使った時間。
    ///
    /// **`Phase` と `TurnClock` から時計の走行を決めるのはここ1本。**
    /// `Some` を返すのは `Phase::Thinking` かつ `TurnClock::Running` のときだけ。
    ///
    /// `clocks_view` はこれに加えて、**壁時計が取れないときも `None` にする**
    /// （`ClocksView::running` の 4）。そちらは別の判定なので、
    /// 「重複した番人」と読んで消さないこと。消すと 1970 年基準の期限が出る
    fn running_clock(&self) -> Option<(Side, u64)> {
        let Phase::Thinking { side } = self.phase else {
            return None;
        };
        let TurnClock::Running(started) = self.turn_clock else {
            return None;
        };
        Some((side, started.elapsed().as_millis() as u64))
    }

    fn clocks_view(&self) -> ClocksView {
        // 動いていないときは時刻を出さない。**受け手が減らす余地そのものを消す**
        let Some(now) = now_epoch_ms() else {
            // 壁時計が取れない。嘘の 00:00 を出すより、止まっている値だけを見せる
            log::warn!(target: LOGT, "clocks: wall clock is before the epoch");
            return self.clocks.view(None, 0);
        };
        self.clocks.view(self.running_clock(), now)
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

    // `TimeLimit::validate` は片側の中しか見ない。**対局をまたぐ組み合わせは
    // ここでしか弾けない。** 先後で流儀が違うと、`go` に `byoyomi` と `winc` が
    // 同時に載る（`GameClocks::think_params` は手番側の秒読みと、両者の加算を
    // それぞれ載せるため）。どちらを優先するかはエンジンごとに割れる。
    //
    // 長さが違うのは通す（駒落ちのハンデなど）。弾くのは流儀が違うときだけ。
    let uses_byoyomi = settings.black_time.byoyomi_ms > 0 || settings.white_time.byoyomi_ms > 0;
    let uses_increment =
        settings.black_time.increment_ms > 0 || settings.white_time.increment_ms > 0;
    if uses_byoyomi && uses_increment {
        return Err("byoyomi and increment cannot be mixed between the two sides".to_string());
    }

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

/// 壁時計。**時間切れの判定には使わない**（そちらは `Instant` で測る）。
/// 使うのは「表示が尽きる時刻」を受け手へ渡すときだけ。
///
/// 取れないのは壁時計が 1970 年より前を指しているとき。**0 で埋めない。**
/// 埋めると尽きる時刻がほぼ 0 になり、受け手は契約どおり
/// `deadline - now` をクランプして**両者の残り 00:00** を出す。
/// 対局は `Instant` で進んでいるので手は指せるし時間切れにもならず、
/// 利用者からは時計が壊れたのか対局が壊れたのかが区別できない。
fn now_epoch_ms() -> Option<u64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
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

    /// `Runner` を直に組む。`GameSession::start` を通さないので、
    /// エンジン無しでも `Activity` を好きな状態にできる
    fn test_runner(tx: &mpsc::UnboundedSender<Command>) -> Runner {
        let settings = two_humans(vec![]);
        Runner {
            id: "test".to_string(),
            app: None,
            clocks: GameClocks::new(settings.black_time, settings.white_time),
            players: [
                Player::new(settings.black.clone(), None),
                Player::new(settings.white.clone(), None),
            ],
            moves: Vec::new(),
            settings,
            phase: Phase::Thinking { side: Side::Black },
            turn_clock: TurnClock::Running(Instant::now()),
            next_req: 0,
            last_clock_emit: Instant::now(),
            tx: tx.downgrade(),
        }
    }

    /// 走っている探索は、対局が畳まれたら止まること。
    ///
    /// `CancellationToken` は drop では cancel しないので、`Drop` を書かないと
    /// `go ponder` を投げた探索タスクが `bestmove` も cancel も来ないまま残る
    #[tokio::test]
    async fn dropping_the_runner_cancels_live_searches() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();

        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = Activity::Searching {
            req: 1,
            kind: SearchKind::Search,
            cancel: cancel.clone(),
        };

        assert!(!cancel.is_cancelled());
        drop(runner);
        assert!(cancel.is_cancelled(), "対局を畳んでも探索が止まっていない");
    }

    fn searching(cancel: &CancellationToken) -> Activity {
        Activity::Searching {
            req: 1,
            kind: SearchKind::Search,
            cancel: cancel.clone(),
        }
    }

    /// 止めた探索から返ってきた手を着手として採らないこと。
    ///
    /// 採ると、**別の局面に対する答えが現局面の着手として `MoveDecided` に載る**。
    /// フロントは非合法として反則にするので、エンジンが身に覚えのない負けを負う
    #[tokio::test]
    async fn a_move_from_a_stopped_search_is_not_taken() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = Activity::Stopping {
            req: 1,
            restart: true,
        };

        runner
            .on_search_outcome(
                Side::Black,
                1,
                SearchOutcome::Move {
                    usi: "2g2f".to_string(),
                    ponder: None,
                },
            )
            .await;

        assert!(
            matches!(runner.phase, Phase::Thinking { side: Side::Black }),
            "止めた探索の bestmove を着手として採った"
        );
    }

    /// 投了も同じ。**起きていない局面での投了で終局してはいけない**
    #[tokio::test]
    async fn a_resign_from_a_stopped_search_does_not_end_the_game() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = Activity::Stopping {
            req: 1,
            restart: false,
        };

        runner
            .on_search_outcome(Side::Black, 1, SearchOutcome::Resign)
            .await;

        assert!(
            matches!(runner.phase, Phase::Thinking { .. }),
            "止めた探索の投了で終局した"
        );
    }

    /// 走っている探索の結果は採ること。
    /// これが無いと「常に採らない」でも上の2本が通ってしまう
    #[tokio::test]
    async fn a_move_from_a_live_search_is_taken() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = searching(&cancel);

        runner
            .on_search_outcome(
                Side::Black,
                1,
                SearchOutcome::Move {
                    usi: "7g7f".to_string(),
                    ponder: None,
                },
            )
            .await;

        assert!(
            matches!(runner.phase, Phase::AwaitingRuling { .. }),
            "走っている探索の bestmove を採らなかった"
        );
    }

    /// `stop` に応じないエンジンは `Idle` に戻さないこと。
    /// 戻すと `finish` が「idle だから送ってよい」と判断して、
    /// 探索中のエンジンへ `gameover` を送る（不変条件3 を破る）
    #[tokio::test]
    async fn an_engine_that_will_not_stop_is_not_marked_idle() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = searching(&cancel);

        runner
            .on_search_outcome(Side::Black, 1, SearchOutcome::StopTimedOut)
            .await;

        assert!(matches!(
            runner.players[Side::Black.index()].activity,
            Activity::Unresponsive
        ));
        match &runner.phase {
            Phase::Over { result } => {
                assert_eq!(result.reason, GameOverReason::EngineFailure);
                assert_eq!(result.winner, Some(Side::White));
            }
            _ => panic!("終局していない"),
        }
    }

    /// 止めた探索を畳んでいる間は、時計が動かないこと。
    ///
    /// 手番に入った時刻で数えると、`go` を一度も受け取っていないエンジンの
    /// 消費として最大 `SEARCH_STOP_GRACE`（5秒）が計上され、`enforce_engine_timeout` が
    /// 真なら**それだけで時間切れ負けする**。画面の残り時間も畳み終わりに巻き戻る。
    #[tokio::test]
    async fn the_clock_does_not_run_while_a_stopped_search_is_settling() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.turn_clock = TurnClock::Settling(Instant::now());
        runner.players[Side::Black.index()].activity = Activity::Stopping {
            req: 1,
            restart: true,
        };

        assert!(
            runner.running_clock().is_none(),
            "畳み待ちの間に時計が動いている"
        );
        assert!(
            runner.clocks_view().running.is_none(),
            "畳み待ちの間に尽きる時刻を出している"
        );
    }

    /// 畳み待ちの間は時間切れにもならないこと。
    /// 持ち時間を使い切った状態で tick を叩いても終局しない
    #[tokio::test]
    async fn settling_never_runs_the_clock_out() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        *runner.clocks.get_mut(Side::Black) =
            crate::engine::game::clock::SideClock::new(TimeLimit {
                main_ms: 1,
                byoyomi_ms: 0,
                increment_ms: 0,
            });
        runner.turn_clock = TurnClock::Settling(Instant::now());
        runner.players[Side::Black.index()].activity = Activity::Stopping {
            req: 1,
            restart: true,
        };

        tokio::time::sleep(Duration::from_millis(50)).await;
        runner.handle(Command::Tick).await;

        assert!(
            matches!(runner.phase, Phase::Thinking { .. }),
            "畳み待ちの間に時間切れで終局した"
        );
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
            _ => panic!("終局していない"),
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
            _ => panic!("終局していない"),
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
            _ => panic!("終局していない"),
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

    /// 裁定待ちでは**動いている時計を出さない**。
    /// 時刻を出すと、受け手はそれを `now` から引いて減らしてしまう
    #[tokio::test]
    async fn no_clock_is_running_while_the_app_is_ruling() {
        let game = start(two_humans(vec![])).await;
        game.submit_move(Side::Black, "7g7f".to_string())
            .await
            .unwrap();

        let clocks = game.snapshot().await.unwrap().clocks;
        assert!(
            clocks.running.is_none(),
            "裁定待ちなのに動いている時計が出ている"
        );
    }

    /// 終局後も時計が止まっていること（不変条件4 の `G2` 側）。
    ///
    /// `running_clock` の `Phase` 判定を消すと、`snapshot` が終局後も
    /// 動いている時計を出す。裁定待ち側のテストだけでは、その変異が通る
    #[tokio::test]
    async fn no_clock_is_running_after_the_game_is_over() {
        let game = start(two_humans(vec![])).await;
        game.resign(Side::Black).await.unwrap();

        let snapshot = game.snapshot().await.unwrap();
        assert!(
            matches!(phase_of(&snapshot), GamePhaseView::Over { .. }),
            "終局していない"
        );
        assert!(
            snapshot.clocks.running.is_none(),
            "終局後なのに動いている時計が出ている"
        );
    }

    /// 手番の間は、動いている側と尽きる時刻が出ること。
    /// 上の1本だけだと「常に出さない」でも通る
    #[tokio::test]
    async fn the_side_to_move_carries_a_deadline() {
        let game = start(two_humans(vec![])).await;

        let clocks = game.snapshot().await.unwrap().clocks;
        let running = clocks.running.expect("手番側の時計が出ていない");
        assert_eq!(running.side, Side::Black);

        // 持ち時間は10分。壁時計との差がそれに近いこと（実時間で測るので幅を持たせる）
        let now = now_epoch_ms().expect("テストの実行中に壁時計が epoch より前になった");
        let left = running.main_zero_at.saturating_sub(now);
        assert!(
            (595_000..=600_000).contains(&left),
            "尽きる時刻が持ち時間と合っていない: {left}ms"
        );
        // 秒読み0なので、2つの期限は同じ
        assert_eq!(running.byoyomi_zero_at, running.main_zero_at);
    }

    /// 手番の時計が尽きたら終局すること（表の E14）。
    ///
    /// `AwaitingRuling` の `RULING_TIMEOUT` に対応する `Thinking` 側の番人。
    /// 時計が動いている間の打ち切りはこれ、止まっている間は `SETTLE_TIMEOUT`
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

    /// 番人が2つの止まり方を分けること。**どちらも `Thinking` の中。**
    ///
    /// 畳み待ちと思考中では、エンジンに何が起きているかが違う。
    /// 潰すと `detail` が原因を取り違える
    #[test]
    fn a_stalled_turn_says_which_kind_of_stall_it_is() {
        let long_ago = |d: Duration| {
            Instant::now()
                .checked_sub(d)
                .expect("起動直後で `Instant` を遡れない")
        };

        // まだどちらも上限に達していない
        assert_eq!(stalled_turn(TurnClock::Settling(Instant::now()), 0), None);
        assert_eq!(stalled_turn(TurnClock::Running(Instant::now()), 0), None);

        assert_eq!(
            stalled_turn(TurnClock::Settling(long_ago(SETTLE_TIMEOUT)), 600_000),
            Some(Stall::NotStopping),
            "畳み待ちの上限は持ち時間と無関係"
        );

        // 思考中の上限は持ち時間ぶんだけ伸びる
        assert_eq!(
            stalled_turn(TurnClock::Running(long_ago(SEARCH_GRACE)), 600_000),
            None
        );
        assert_eq!(
            stalled_turn(TurnClock::Running(long_ago(SEARCH_GRACE)), 0),
            Some(Stall::NotAnswering)
        );
    }

    /// 上限どうしの大小を固定する。
    ///
    /// **数を散文で書かない。** 「`SEARCH_STOP_GRACE`（5秒）＋書き込みの上限（2秒）より
    /// 長く取る」のような文は、どちらかを動かすと黙って偽になる。
    /// 関係そのものをここで見る。
    #[test]
    fn the_watchdogs_are_ordered() {
        use crate::engine::game::search::SEARCH_STOP_GRACE;
        use crate::engine::protocol::WRITE_TIMEOUT;

        // 畳み待ちの番人は、`stop` の書き込み1件ぶんと `bestmove` の猶予を
        // 足したより長い。**これは下限でしかない。** `WRITE_TIMEOUT` は列の
        // 1件に掛かる上限で、`send_command` が返るまでの実時間ではない
        // （列に先客が居れば、その処理時間が足される）。
        // 下限を割ると、正常に畳んでいる最中のエンジンを必ず故障と呼ぶ
        assert!(
            SETTLE_TIMEOUT > WRITE_TIMEOUT + SEARCH_STOP_GRACE,
            "SETTLE_TIMEOUT({SETTLE_TIMEOUT:?}) が WRITE_TIMEOUT + SEARCH_STOP_GRACE 以下"
        );

        // 閉じるときの待ちも、畳み終わるのに要る時間より長い
        assert!(
            CLOSE_IDLE_TIMEOUT > SEARCH_STOP_GRACE,
            "CLOSE_IDLE_TIMEOUT({CLOSE_IDLE_TIMEOUT:?}) が SEARCH_STOP_GRACE 以下"
        );

        // 思考の番人は畳み待ちの番人より長い。逆だと、考えているエンジンが
        // 畳み待ちより先に故障扱いになる
        assert!(SEARCH_GRACE >= SETTLE_TIMEOUT);
    }

    /// 畳み待ちのまま `SETTLE_TIMEOUT` を過ぎたら終局にすること。
    ///
    /// 畳み待ちの間は時計が動かないので、時間切れの番人には掛からない。
    /// ここが無いと `stop` の書き込みが詰まったときに無音で固まる
    #[tokio::test]
    async fn settling_forever_ends_the_game() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = Activity::Stopping {
            req: 1,
            restart: false,
        };
        runner.turn_clock = TurnClock::Settling(
            Instant::now()
                .checked_sub(SETTLE_TIMEOUT)
                .expect("起動直後で `Instant` を遡れない"),
        );
        drop(cancel);

        // 時計は動いていない。時間切れの番人は掛からない
        assert!(runner.running_clock().is_none());

        runner.on_tick().await;

        match &runner.phase {
            Phase::Over { result } => {
                assert_eq!(result.reason, GameOverReason::EngineFailure);
                assert_eq!(result.winner, Some(Side::White));
            }
            _ => panic!("畳み待ちのまま固まっている"),
        }
    }

    /// 走っている探索からの投了は終局にすること（表の E8 の `A1` 側）。
    /// `a_resign_from_a_stopped_search_does_not_end_the_game` の対で、
    /// これが無いと「常に採らない」でも通る
    #[tokio::test]
    async fn a_resign_from_a_live_search_ends_the_game() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = searching(&cancel);

        runner
            .on_search_outcome(Side::Black, 1, SearchOutcome::Resign)
            .await;

        match &runner.phase {
            Phase::Over { result } => {
                assert_eq!(result.reason, GameOverReason::Resign);
                assert_eq!(result.winner, Some(Side::White));
            }
            _ => panic!("投了で終局していない"),
        }
    }

    #[test]
    fn settings_accept_every_pair_of_time_limits_we_want_to_support() {
        // 弾く方向の門番なので、通したいものを先に並べる（/implement 手順5）
        let allowed: [(&str, TimeLimit, TimeLimit); 5] = [
            ("先後とも切れ負け", minutes(10), minutes(10)),
            ("先後で持ち時間が違う（ハンデ）", minutes(10), minutes(5)),
            (
                "先後とも秒読み。長さは違う",
                TimeLimit {
                    main_ms: 0,
                    byoyomi_ms: 60_000,
                    increment_ms: 0,
                },
                TimeLimit {
                    main_ms: 0,
                    byoyomi_ms: 30_000,
                    increment_ms: 0,
                },
            ),
            (
                "先後ともフィッシャー。加算が違う",
                TimeLimit {
                    main_ms: 300_000,
                    byoyomi_ms: 0,
                    increment_ms: 10_000,
                },
                TimeLimit {
                    main_ms: 300_000,
                    byoyomi_ms: 0,
                    increment_ms: 5_000,
                },
            ),
            (
                "片側だけ秒読み付き（もう片方は秒読み0）",
                TimeLimit {
                    main_ms: 600_000,
                    byoyomi_ms: 30_000,
                    increment_ms: 0,
                },
                minutes(10),
            ),
        ];

        for (label, black, white) in allowed {
            let mut settings = two_humans(vec![]);
            settings.black_time = black;
            settings.white_time = white;
            assert!(
                validate_settings(&settings).is_ok(),
                "{label} が弾かれた: {:?}",
                validate_settings(&settings)
            );
        }
    }

    #[test]
    fn settings_reject_mixing_byoyomi_and_increment_across_the_two_sides() {
        // 片側ずつは `TimeLimit::validate` を通るので、ここでしか弾けない。
        // 通すと `go` に `byoyomi` と `winc` が同時に載る
        let mut settings = two_humans(vec![]);
        settings.black_time = TimeLimit {
            main_ms: 0,
            byoyomi_ms: 30_000,
            increment_ms: 0,
        };
        settings.white_time = TimeLimit {
            main_ms: 300_000,
            byoyomi_ms: 0,
            increment_ms: 5_000,
        };
        assert!(settings.black_time.validate().is_ok());
        assert!(settings.white_time.validate().is_ok());
        assert!(validate_settings(&settings).is_err());
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
