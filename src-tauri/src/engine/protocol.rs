use std::collections::VecDeque;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::engine::{types::*, utils::cmd_summary};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, watch, Mutex, RwLock};
use usi::{EngineCommand, GuiCommand, IdParams, OptionParams, UsiEngineHandler};

const LOGT: &str = "obs_shogi::engine::protocol";

/// `kill` を待つ上限。
///
/// `kill` は書き込みの列を通らない（`handler` を `take` して直接落とす）ので、
/// 列に掛かる `WRITE_TIMEOUT` は効かない。上限はここに要る。
///
/// **この上限が効くのは、`kill` が `spawn_blocking` の中にあるから。**
/// async のタスクの中で同期 write を直に呼ぶと `poll` が返らず、
/// `timeout` は発火する機会そのものを持たない。
///
/// 超えるとプロセスが残る。回収する仕掛けは無い → #353
const KILL_TIMEOUT: Duration = Duration::from_secs(2);

/// プロセスを落とした後に送ろうとしたときの文言
const GONE: &str = "engine process has been shut down";
/// 出力が終わったプロセスへ送ろうとしたときの文言
const CLOSED: &str = "engine output has ended; the process cannot be reached";
/// 書き込みが詰まったプロセスへ送ろうとしたときの文言。
/// **`CLOSED` と分ける。** あちらは読み取りが終わった状態で、こちらは
/// 出力は続いているのに stdin を読まなくなった状態。原因も直し方も違う
const STALLED: &str = "the engine stopped reading stdin; the process cannot be reached";
/// USI プロトコル処理層
pub struct UsiProtocol {
    /// `Option` なのは、落とした後に **`Drop` を走らせない**ため。
    /// `UsiEngineHandler::Drop` は `kill().unwrap()` を呼ぶ（`usi` crate）。
    handler: Arc<Mutex<Option<UsiEngineHandler>>>,
    state: Arc<RwLock<ProtocolState>>,
    listeners: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EngineCommand>>>>,
    listen_active: Arc<Mutex<bool>>,

    /// 書き込みが詰まったか。
    ///
    /// `ReadyState::Closed` は「もう届かない」を1つの値で表すが、**理由が分かれる**。
    /// 読み取りが終わった（EOF）のと、stdin を読まなくなったのとでは、
    /// 利用者にとっての意味も次の手も違う。`Refuse` を返すときに文言を選ぶのに使う。
    stalled: Arc<std::sync::atomic::AtomicBool>,

    /// こちらが落としたか。
    ///
    /// `kill_engine` も `Closed` を立てるので、印が無いと
    /// **こちらが落としたのに「エンジンの出力が終わった」と説明する**。
    killed: Arc<std::sync::atomic::AtomicBool>,

    /// `isready` に対してエンジンがどう応じたか。
    ///
    /// **3値であることが要る。** `bool` だと「まだ返っていない」と
    /// 「もう返らない（プロセスが終わった）」が同じ値になる。
    /// 前者は待てば来るが、後者は `READY_TIMEOUT` を使い切るまで待つだけで、
    /// その間 `start_game` は返らない（評価関数を読めずに即死するエンジンで踏む）。
    /// 書き込み側の分岐も3値を見る（`dispatch_for`）。
    ///
    /// watch なのは、**待つ側がポーリングしないで済む**ため。
    ready: Arc<watch::Sender<ReadyState>>,

    runtime_handle: tokio::runtime::Handle,
    init_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    init_cancel: Arc<Mutex<Option<CancellationToken>>>,
    pending: Arc<Mutex<Pending>>,

    /// 書き込みの列。**投入順がそのままワイヤ上の順になる**
    writer: mpsc::UnboundedSender<WriteJob>,
}

/// 順番待ちのコマンドと、その世代。
///
/// 積まれる理由は2つ。`readyok` をまだ待っている（`requires_ready`）のと、
/// 掃いている最中に来た（`draining`）の。
///
/// **世代とキューを同じロックの下に置く。** 別々に持つと、世代を読んでから
/// 積むまでの間に次の `isready` が挟まり、**消された直後の世代へ入れる**ことになる。
/// そこに入ったコマンドを掃く者はいないので、呼び出し側に `Ok` を返したまま消える。
///
/// 1つにまとめたので、積む側は世代を読む必要が無い。キューは常に現在の世代のもの。
struct Pending {
    generation: u64,
    queue: VecDeque<GuiCommand>,
    /// 積み置きを掃いている最中か。
    ///
    /// **立っている間は、`Ready` でも直書きさせずに積ませる。** flush は
    /// 1件ごとに書き込みの返事を待つので、その隙に直書きが列へ入ると
    /// `position(旧) → position(新) → go(旧)` の順でエンジンへ届く。
    /// エンジンは新しい局面に対して古い `go` を受け取る。
    draining: bool,
}

/// 積み置きの上限。
///
/// `readyok` を返さないエンジンでは、`position` と `go` が来るたびに積み続ける。
/// 上限を超えたら断る側に倒す。**積んで `Ok` を返すより、断ったほうが呼び出し側が気付ける。**
/// 32 は「1局面ぶんの `position` + `go` が十数回入っても足りる」から。
/// 正常な流れでこの数に届くことはない
const PENDING_LIMIT: usize = 32;

impl Clone for UsiProtocol {
    fn clone(&self) -> Self {
        Self {
            handler: Arc::clone(&self.handler),
            state: Arc::clone(&self.state),
            listeners: Arc::clone(&self.listeners),
            listen_active: Arc::clone(&self.listen_active),
            stalled: Arc::clone(&self.stalled),
            killed: Arc::clone(&self.killed),
            ready: Arc::clone(&self.ready),
            runtime_handle: self.runtime_handle.clone(),
            init_task: Arc::clone(&self.init_task),
            init_cancel: Arc::clone(&self.init_cancel),
            pending: Arc::clone(&self.pending),
            writer: self.writer.clone(),
        }
    }
}

#[derive(Debug, Clone)]
struct ProtocolState {
    engine_info: Option<EngineInfo>,
    last_command: Option<String>,
}

/// バリアントと全一覧を1回だけ書く。
///
/// 一覧を手で並べると、バリアントを足したときに片方だけ直せる。逆に
/// 一覧から落とすと、回す側は静かに回数が減るだけで**何も落ちない**。
/// 「全部回している」と読める検査が、実際には一部しか回していない形になる。
macro_rules! closed_set_enum {
    (
        $(#[$enum_meta:meta])*
        enum $name:ident { $($(#[$meta:meta])* $variant:ident),* $(,)? }
    ) => {
        $(#[$enum_meta])*
        enum $name { $($(#[$meta])* $variant),* }

        impl $name {
            /// 全バリアント。**手で書かない。** 宣言から生える。
            ///
            /// 使うのは「全部の状態を回す」検査だけなので `cfg(test)` に置く。
            /// `#[allow(dead_code)]` で通さないこと——本番で誰かが使い始めたら、
            /// そのときに属性を外して意図を書くほうが読める。
            #[cfg(test)]
            const ALL: &'static [$name] = &[$($name::$variant),*];
        }
    };
}

closed_set_enum! {
/// `isready` に対する応答の状態。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadyState {
    /// `readyok` が返っていない。
    ///
    /// **生成直後もこれ。** `isready` を1度も送っていない状態と、送って
    /// 待っている状態を区別しない。どちらでも `position` / `go` を積む、で扱いが同じ。
    ///
    /// `isready` 自身は `dispatch_for` を**通る**（`Closed` なら断られる）。
    /// 素通りするのは `draining` の腕だけで、それが `bypasses_draining` の意味。
    Waiting,
    Ready,
    /// エンジンの出力が終わった。**もう `readyok` は返らない**
    ///
    /// **ここから戻る道は無い。** `usi` crate の `listen` は reader を `take` するので
    /// 読み取りは1回きりで、二度と始まらない。復帰の手段はプロセスの再起動しかない。
    Closed,
}
}

/// `ready` の次の値を決める。**`Closed` は吸収状態。**
///
/// 書き込み側（`dispatch_for` の `Refuse`）と `register_listener` の拒否は、
/// どちらも `Closed` を見て断っている。戻す口があると、`isready` を1本送るだけで
/// 両方が同時に無効になり、`position` も `go` も `Queue` に落ちて `Ok` が返る。
/// 待っている側は永久に返らない。
fn next_ready_state(current: ReadyState, requested: ReadyState) -> ReadyState {
    match current {
        ReadyState::Closed => ReadyState::Closed,
        _ => requested,
    }
}

/// 届かなくなった理由の文言を選ぶ。**印の優先順はここだけ。**
///
/// こちらが落としたことを最優先で見る。両方立つのは**詰まったプロセスを利用者が
/// 後から終了させたとき**で、そのとき見せるべきは自分の操作の結果のほう。
/// 「自分で終了させた」と「エンジンが応じなくなった」では次の手が違う。
///
/// 逆順（落としてから詰まる）は起きない。`kill_engine` が `handler` を `take` した
/// 後の書き込みは `run_writer` が即 `NotInitialized` にするので、`Timeout` にならない。
fn cannot_reach_text(killed: bool, stalled: bool) -> &'static str {
    if killed {
        GONE
    } else if stalled {
        STALLED
    } else {
        CLOSED
    }
}

/// flush が途中で折れたときに、書けたか分からないぶんを残す。
///
/// `failed` も挙げるのは、**届いたか分からない**ため（`Timeout` は
/// 「上限内に書き終わらなかった」で、後から届きうる）。
/// 落ちた1件だけ黙ると、flush が最後まで通ったように読める
fn report_dropped(failed: &GuiCommand, rest: &VecDeque<GuiCommand>) {
    for cmd in std::iter::once(failed).chain(rest.iter()) {
        log::warn!(
            target: LOGT,
            "ready: dropping queued cmd={} (the flush could not continue)",
            cmd_summary(cmd)
        );
    }
}

/// 書き込み1回に置く上限。
///
/// **1件の書き込みに掛かる。** `send_command` が返るまでの実時間ではない
/// （列に先客が居ればその処理時間が足される）。呼び出し側に上限を書かせると
/// 包み忘れた口が上限なしで残るので、置き場はここ1つ。
///
/// 待っている側ではなく `run_writer` の中で包むのは、待つ側だと
/// 前のジョブの処理時間が入るため。1回に書くのは
/// `position sfen ... moves ...` でも数百バイトなので、そちらだと
/// 「自分の書き込みが1バイトも始まっていないのに切れる」が起きる。
///
/// **超えても「書けなかった」とは言えない。** `timeout` は `spawn_blocking` を
/// 中断しないので、詰まっていた `write_all` はエンジンが stdin を吸った瞬間に
/// 完走してコマンドをワイヤへ出す。分かるのは「上限内に書き終わらなかった」だけ。
/// 後続を全部断る（`fail_writes`）のはそのため——**後から1件だけ届く**ことは
/// 避けられないが、その後ろに何も並ばないようにはできる。
pub(crate) const WRITE_TIMEOUT: Duration = Duration::from_secs(2);

/// 書き込みの列に流す1件。
struct WriteJob {
    command: GuiCommand,
    reply: oneshot::Sender<Result<(), EngineError>>,
}

/// 書き込みを1本の列にする理由。
///
/// **投入順＝ワイヤ上の順**であることを、この列だけで保証する。
/// 呼び出しごとに `spawn_blocking` を投げると、どのスレッドが先に
/// `handler` の Mutex を取るかは**投入順と無関係**になる。
/// `stop` が `go` を追い越す／flush が直書きに追い越される、が両方そこから出る。
///
/// 書き込み自体を `spawn_blocking` に出すのは、`usi` crate の書き込みが
/// `ChildStdin` への `write_all` + `flush`（同期）だから。async のタスクの中で
/// 直に呼ぶと `poll` が返らず、**それを包んだ `tokio::time::timeout` が
/// 発火する機会そのものを失う**（タイマーが鳴っても poll する者が居ない）。
async fn run_writer(
    handler: Arc<Mutex<Option<UsiEngineHandler>>>,
    mut jobs: mpsc::UnboundedReceiver<WriteJob>,
) {
    // 1件でも上限に達したら、**それ以降は書かずに断る。**
    //
    // 詰まっているジョブは `spawn_blocking` の中なので取り消せない。後ろを
    // 通すと、「送れなかった」と判断した側が出した `gameover` が、その `go` の
    // 後ろに並ぶ（探索中のエンジンへ `gameover`＝不変条件3 の違反）。
    // `Closed` を立てるだけでは、**既に列にあるジョブ**は止まらない。
    let mut stalled = false;

    while let Some(WriteJob { command, reply }) = jobs.recv().await {
        let summary = cmd_summary(&command);

        if stalled {
            let _ = reply.send(Err(EngineError::CommunicationFailed(STALLED.to_string())));
            log::warn!(target: LOGT, "write: refused after a stall cmd={summary}");
            continue;
        }

        let handler = Arc::clone(&handler);
        let write = tokio::task::spawn_blocking(move || {
            let mut guard = handler.blocking_lock();
            let Some(h) = guard.as_mut() else {
                return Err(EngineError::NotInitialized(GONE.to_string()));
            };
            h.send_command(&command)
                .map_err(|e| EngineError::CommunicationFailed(e.to_string()))
        });

        // **上限はここ。** 待っている側で包むと、前のジョブの処理時間が入る
        let written = match tokio::time::timeout(WRITE_TIMEOUT, write).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => Err(EngineError::CommunicationFailed(format!(
                "write task failed: {e}"
            ))),
            Err(_) => {
                stalled = true;
                Err(EngineError::Timeout(
                    "the engine did not accept the write in time; it may still arrive".to_string(),
                ))
            }
        };

        if let Err(e) = &written {
            log::warn!(target: LOGT, "write: failed cmd={summary} err={e}");
        }
        let _ = reply.send(written);
    }
}

/// `ready` への書き込みはここ1本を通す。返すのは実際に落ち着いた値。
fn set_ready_state(ready: &watch::Sender<ReadyState>, requested: ReadyState) -> ReadyState {
    let mut settled = requested;
    ready.send_if_modified(|current| {
        settled = next_ready_state(*current, requested);
        if settled == *current {
            false
        } else {
            *current = settled;
            true
        }
    });
    settled
}

/// 読み取りを終わらせる合図。`usi` crate の `listen` へ返すためだけの型。
///
/// `listen` のループは、hook が `Err` を返すか、**読み取り自体が `Err` になった**
/// ときに終わる（`usi::UsiEngineHandler::listen`）。後者では hook が呼ばれない。
/// EOF だけは `Ok(response: None)` で来るので、hook がこれを返さないと終わらない。
#[derive(Debug)]
struct StopListening;

impl std::fmt::Display for StopListening {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "stop listening")
    }
}

impl std::error::Error for StopListening {}

/// `readyok` が返るまで送れないコマンド。
///
/// USI は `isready` の返事より前の `usinewgame` / `position` / `go` を認めない。
/// 送っても評価関数の読み込み中に握り潰される。
fn requires_ready(cmd: &GuiCommand) -> bool {
    matches!(
        cmd,
        GuiCommand::UsiNewGame | GuiCommand::Go(_) | GuiCommand::Position(_)
    )
}

/// 積み置きを掃いている最中でも列の後ろへ回さないコマンド。
///
/// - `Stop`: 止めるのに列の後ろへ並ばせては意味が無い
/// - `IsReady`: 掃く側は書き込みの列を直に使うので、積むと
///   `start_ready_watch_and_send` の後処理（世代の更新、`readyok` の購読）が飛ぶ。
///   **通すと、掃いている最中の積み置きが捨てられる。** `begin_generation` が
///   世代を上げ、掃きループは世代違いで抜けるので、残りは `Ok` を返したまま消える
///   （落ちたぶんは `report_dropped` がログに残す）
/// - `Quit`: 積むと直後の `kill_engine` が捨てる。落とす前に1行も書かれない
///
/// どれも `position` / `go` の順序には関わらない。
fn bypasses_draining(cmd: &GuiCommand) -> bool {
    matches!(
        cmd,
        GuiCommand::Stop | GuiCommand::IsReady | GuiCommand::Quit
    )
}

/// 送ろうとしているコマンドをどう扱うか。
#[derive(Debug, PartialEq, Eq)]
enum Dispatch {
    /// そのまま書く
    Send,
    /// 列の後ろへ回す。**掃かれるのは `readyok` の後か、掃きが終わった後。**
    Queue,
    /// 断る。出力が終わっているので、書いても待っても何も返らない
    Refuse,
}

/// `send_command` の入口で、送る／積む／断るを決める。
///
/// **入口の判断はこれで全部。** ただし断る口はここだけではない。
/// 書き込みの列が詰まった後は `run_writer` が `STALLED` で断り、
/// 列そのものが閉じていれば `write` が `NotInitialized` を返す。
///
/// 早期 return を使わず1つの `match` にしてあるのは、
/// **どの枝も他の枝に隠れていないことを目で数えられるようにする**ため。
///
/// - `Closed` を `Waiting` と同じ扱いにしない。積み置きは「まだ `readyok` が
///   来ていない」ための仕組みで、「**もう来ない**」ときの置き場ではない。
///   積むと呼び出し側へ `Ok` が返り、待つ側は永久に返らない
/// - `draining`（積み置きを掃いている最中）は `Ready` でも積む。掃きは1件ごとに
///   書き込みの返事を待つので、直書きが入るとその隙に追い越す。
///   例外は `bypasses_draining` の3つ
fn dispatch_for(state: ReadyState, draining: bool, cmd: &GuiCommand) -> Dispatch {
    match (state, draining) {
        (ReadyState::Closed, _) => Dispatch::Refuse,
        (_, true) if !bypasses_draining(cmd) => Dispatch::Queue,
        (ReadyState::Ready, _) => Dispatch::Send,
        (ReadyState::Waiting, _) if requires_ready(cmd) => Dispatch::Queue,
        (ReadyState::Waiting, _) => Dispatch::Send,
    }
}

/// `stop` が何をしたか。**待ち手の次の動きが変わるので潰さない。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopEffect {
    /// エンジンへ `stop` を書いた。この後 `bestmove` が来る
    Written,
    /// まだ書いていない `go` を落とした。**`bestmove` は来ない**
    CancelledQueued,
}

/// 積み置きへ1件入れる。**積む判断はここ1本を通す。**
///
/// 上限を超えたら断る側に倒す。積んで `Ok` を返すより、断ったほうが
/// 呼び出し側が気付ける。
fn push_pending(pending: &mut Pending, command: &GuiCommand) -> Result<(), EngineError> {
    if pending.queue.len() >= PENDING_LIMIT {
        log::warn!(
            target: LOGT,
            "send_command: pending queue is full cmd={} gen={}",
            cmd_summary(command),
            pending.generation
        );
        // **理由で文言を分ける。** `readyok` が既に返っているのに
        // 「まだ返っていない」と言うと、原因を誤って説明することになる
        let why = if pending.draining {
            "the engine is still catching up on queued commands"
        } else {
            "the engine has not returned readyok"
        };
        return Err(EngineError::CommunicationFailed(format!(
            "{why}; {PENDING_LIMIT} commands are already queued"
        )));
    }
    pending.queue.push_back(command.clone());
    log::debug!(
        target: LOGT,
        "send_command: queued cmd={} gen={} qlen={} draining={}",
        cmd_summary(command),
        pending.generation,
        pending.queue.len(),
        pending.draining
    );
    Ok(())
}

/// 積み置きから `go` を落とす。落とした数を返す。
///
/// **`stop` は積まれないのに `go` は積まれる**ので、`readyok` を待っている間は
/// 順序が入れ替わる。そのまま書くと `stop` が先にエンジンへ届き、まだ探索して
/// いないので何も起きず、後から flush された `go` で**利用者が止めたはずの探索が
/// 始まる**。画面は「停止」のままエンジンだけが回り続ける。
///
/// `position` は落とさない。局面を送っただけでは何も起きないうえ、
/// 次の `go` の前提になる。
fn cancel_queued_go(queue: &mut VecDeque<GuiCommand>) -> usize {
    let before = queue.len();
    queue.retain(|cmd| !matches!(cmd, GuiCommand::Go(_)));
    before - queue.len()
}

impl UsiProtocol {
    pub fn new(handler: UsiEngineHandler) -> Self {
        let handler = Arc::new(Mutex::new(Some(handler)));
        let (writer, jobs) = mpsc::unbounded_channel();
        tokio::spawn(run_writer(Arc::clone(&handler), jobs));

        Self {
            handler,
            state: Arc::new(RwLock::new(ProtocolState {
                engine_info: None,
                last_command: None,
            })),
            listeners: Arc::new(RwLock::new(HashMap::new())),
            listen_active: Arc::new(Mutex::new(false)),
            stalled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            ready: Arc::new(watch::channel(ReadyState::Waiting).0),
            runtime_handle: tokio::runtime::Handle::current(),
            init_task: Arc::new(Mutex::new(None)),
            init_cancel: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(Pending {
                generation: 0,
                queue: VecDeque::new(),
                draining: false,
            })),
            writer,
        }
    }

    /// 書き込みの列へ入れて、書けたかを待つ。
    ///
    /// **待つだけ。** 上限は `run_writer` が1件の書き込みに掛ける（→ `WRITE_TIMEOUT`）。
    /// 超えたときに返るのは `Timeout` で、
    /// 「送る口が無い」（`NotInitialized` / `CommunicationFailed`）とは別物。
    /// 前者はエンジンが stdin を読んでいない、後者は届く先が無い。
    /// 次に何ができるかが違うので潰さない。
    async fn write(&self, command: GuiCommand) -> Result<(), EngineError> {
        let rx = self.enqueue_write(command)?;
        self.await_write(rx).await
    }

    /// 書き込みの列へ入れる。**同期。await 点を持たない。**
    ///
    /// 入れた順がそのままワイヤ上の順になる（→ `run_writer`）。順番を守る責任が
    /// ある側——積み置きの掃き出し——は、**キューのロックを握ったまま**ここを呼ぶ。
    /// `write` しか無いと、ロックを離してから列へ入るまでの隙に
    /// 別の書き込みが割り込めるかどうかが `write` の内側の作りに依存する。
    /// 同期の関数に分けてあれば、依存するのは型のほうになる。
    fn enqueue_write(
        &self,
        command: GuiCommand,
    ) -> Result<oneshot::Receiver<Result<(), EngineError>>, EngineError> {
        let (reply, rx) = oneshot::channel();
        let job = WriteJob { command, reply };
        if self.writer.send(job).is_err() {
            return Err(EngineError::NotInitialized(GONE.to_string()));
        }
        Ok(rx)
    }

    /// 列に入れた1件が書けたかを待つ。
    ///
    /// 上限は `run_writer` が1件の書き込みに掛ける（→ `WRITE_TIMEOUT`）。
    ///
    /// **待つだけではない。** 上限に当たったら `fail_writes` を撃つ——
    /// `Closed` が立ち、積み置きが捨てられ、以後この `UsiProtocol` へは
    /// 何も送れなくなる。戻り値を捨ててもこの副作用は起きる。
    /// 掃き出しループが1件ごとにここを通るので、flush の途中で1件が
    /// 上限に当たると残りは `report_dropped` を通らずに消える。
    async fn await_write(
        &self,
        rx: oneshot::Receiver<Result<(), EngineError>>,
    ) -> Result<(), EngineError> {
        let result = match rx.await {
            Ok(result) => result,
            // 列のタスクが落ちた
            Err(_) => Err(EngineError::CommunicationFailed(
                "the writer stopped".to_string(),
            )),
        };

        if matches!(result, Err(EngineError::Timeout(_))) {
            self.fail_writes().await;
        }
        result
    }

    /// リスナー登録
    pub async fn register_listener(
        &self,
        name: String,
        sender: mpsc::UnboundedSender<EngineCommand>,
    ) -> Result<(), EngineError> {
        // 出力が終わったプロセスには登録させない。
        //
        // `listen_active` は `true` のまま戻らず、読み取りは二度と始まらない
        // （`usi` crate の `listen` は reader を `take` するので1回きり）。
        // 入れても誰も配らないので、`raw_rx.recv()` が永久に返らない待ちができる
        let state: ReadyState = *self.ready.borrow();
        if state == ReadyState::Closed {
            return Err(self.cannot_reach());
        }

        self.listeners.write().await.insert(name.clone(), sender);

        // await をまたがないように「必要かどうか」だけ決める
        let need_start = {
            let mut g = self.listen_active.lock().await;
            if *g {
                false
            } else {
                *g = true;
                true
            }
        };

        if need_start {
            if let Err(e) = self.start_listening().await {
                // start_listening が失敗したらフラグを戻す
                let mut g = self.listen_active.lock().await;
                *g = false;
                return Err(e);
            }
        }

        Ok(())
    }

    /// リスナー削除
    pub async fn remove_listener(&self, name: &str) {
        self.listeners.write().await.remove(name);
    }

    /// リスニング開始(内部用)
    async fn start_listening(&self) -> Result<(), EngineError> {
        log::debug!(target: LOGT, "start_listening: begin");

        // 読み取りスレッドと配布の間をチャンネル1本で繋ぐ。
        //
        // 行ごとに `spawn` して配ると、**どのタスクが先に `send` するかが
        // ランタイム任せ**になる。`id name` と `usiok` が入れ替わると
        // `collect_engine_info` が `usiok` で抜けて名前が空になり、
        // エンジンの起動が偶発的に失敗する。
        //
        // 読み取り側は `send` するだけで、`unbounded` なので詰まらない。
        // ロックを待つのは配る側の1本に閉じる。
        let (line_tx, mut line_rx) = mpsc::unbounded_channel::<EngineCommand>();
        let listeners = Arc::clone(&self.listeners);
        let ready = Arc::clone(&self.ready);
        self.runtime_handle.spawn(async move {
            while let Some(cmd) = line_rx.recv().await {
                Self::broadcast_to_listeners(Arc::clone(&listeners), cmd).await;
            }

            // 読み取りが終わった。**溜まっていた行を配り切ってから**
            // 「もう来ない」を届ける。落とさないと `raw_rx.recv()` が永久に
            // 返らず、対局は手番のまま無音で止まる。
            //
            // 読み取りの終わり方は1つではない。EOF は下の hook が `Err` を
            // 返して終わらせるが、`usi` crate は読み取り自体の `Err`
            // （非 UTF-8 の行、数値のパース失敗）では**hook を呼ばずに**
            // スレッドを抜ける。**どの終わり方でも `line_tx` は落ちる**ので、
            // ここに置けば終わり方を数え上げずに済む。
            //
            // hook の中で落とすと、まだ配っていない行を捨てることになる。
            // `bestmove` を書いた直後に終了するエンジンでは、その手が
            // 誰にも届かないまま「応答しない」と判定される。
            listeners.write().await.clear();

            // `readyok` を待っている側にも届ける。listeners を落とすだけでは
            // `ensure_ready` は watch を見ているので気付かず、上限まで待つ
            set_ready_state(&ready, ReadyState::Closed);

            log::warn!(target: LOGT, "listen: engine output ended");
        });

        let mut handler_guard = self.handler.lock().await;
        let Some(handler) = handler_guard.as_mut() else {
            return Err(EngineError::NotInitialized(GONE.to_string()));
        };
        let result = handler.listen(move |output| -> Result<(), StopListening> {
            let Some(cmd) = output.response() else {
                // `response` が `None` になるのは**出力が閉じたときだけ**。
                // `usi` crate はそれを `Err` ではなく `Ok(response: None)` で返すので、
                // ここで `Err` を返さないと EOF を延々読む busy loop になる。
                //
                // 待っている側への通知はここではしない（上の転送タスクが行う）
                return Err(StopListening);
            };

            if line_tx.send(cmd.clone()).is_err() {
                // 配る側が落ちている。読み続けても届け先が無い
                return Err(StopListening);
            }
            Ok(())
        });

        drop(handler_guard);

        result.map_err(|e| {
            if e.to_string().contains("already started listening") {
                log::debug!(target: LOGT, "start_listening: already listening");
                EngineError::AlreadyListening(e.to_string())
            } else {
                log::error!(target: LOGT, "start_listening: failed: {}", e);
                EngineError::CommunicationFailed(e.to_string())
            }
        })
    }

    /// リスナーへのブロードキャスト処理を分離
    async fn broadcast_to_listeners(
        listeners: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EngineCommand>>>>,
        cmd: EngineCommand,
    ) {
        // 失敗したリスナーを記録（削除用）
        let mut failed_listeners = Vec::new();

        // リスナーのスナップショットを取得（長時間ロックしない）
        let listeners_snapshot = {
            let guard = listeners.read().await;
            guard.clone()
        };

        // 各リスナーに配信
        for (name, sender) in listeners_snapshot.iter() {
            if sender.send(cmd.clone()).is_err() {
                // 送信失敗 = チャンネルクローズ済み
                failed_listeners.push(name.clone());
            }
        }

        // 失敗したリスナーを削除（自動クリーンアップ）
        if !failed_listeners.is_empty() {
            let mut guard = listeners.write().await;
            for name in failed_listeners {
                guard.remove(&name);
            }
        }
    }

    /// コマンドを送る。
    ///
    /// **`Ok` は受理であって「書けた」ではない。** `readyok` 待ちや掃きの最中は
    /// 積むだけで返る。積んだぶんは、次の `isready` / `kill_engine` / 掃きの失敗で
    /// 1行も書かれずに消えることがある（そのときログに1行ずつ残る）。
    ///
    /// # エラー
    ///
    /// 呼び出し側の次の手が違うので、`EngineError` のどれが返るかを挙げる。
    /// **数は書かない**（`isready` の経路が増えるたびにずれる）。
    ///
    /// - `CommunicationFailed`: 届く口が無い。出力が終わったか、書き込みが詰まった
    ///   （文言で分かれる → `cannot_reach`）。プロセスを起動し直すしかない
    /// - `Timeout`: 上限内に書き終わらなかった。**後から届く可能性がある**
    /// - `NotInitialized`: 書き込みの列そのものが無くなった（通常は起きない）
    /// - `AlreadyListening`: `isready` のときだけ。読み取りが二重に始まった。
    ///   プロセスは生きているので落とさないこと
    pub async fn send_command(&self, command: &GuiCommand) -> Result<(), EngineError> {
        // コマンド履歴更新
        self.state.write().await.last_command = Some(cmd_summary(command));

        // **判断は `dispatch_for` が全部持つ。** 本文で条件を足すと、
        // 足したぶんだけ写像のテストが当たらない範囲が増える。
        //
        // `pending` のロックを取ってから引くのは、`draining` と `ReadyState` を
        // **同じ瞬間の値**で見るため。別々に読むと、取るまでの間に
        // `readyok` が着地して flush が掃き終わり、もう誰も掃かないキューへ
        // 積んで `Ok` を返すことになる。
        //
        // `IsReady` もここを通す。手前で分岐すると `Refuse` を誰も聞かない
        {
            let mut pending = self.pending.lock().await;
            // `watch::Ref` を `match` のスクルーティニに置かない。
            // 置くと全アームの間じゅう読み取りロックを握り、`set_ready_state` が待つ
            let state: ReadyState = *self.ready.borrow();
            match dispatch_for(state, pending.draining, command) {
                Dispatch::Refuse => return Err(self.cannot_reach()),
                Dispatch::Queue => return push_pending(&mut pending, command),
                Dispatch::Send => {}
            }
        }

        if matches!(command, GuiCommand::IsReady) {
            return self.start_ready_watch_and_send().await;
        }

        self.write(command.clone()).await
    }

    /// 届かなくなった理由を文言にする。
    ///
    /// **`Closed` は複数の理由で立つ**（`set_ready_state(_, Closed)` の呼び出しを見ること）。
    /// 読み取りが終わった、書き込みが詰まった、こちらが落とした。
    /// 利用者に見せる説明も次の手も違うので、`Closed` の一語に潰さない。
    pub(crate) fn cannot_reach(&self) -> EngineError {
        use std::sync::atomic::Ordering::Relaxed;

        EngineError::CommunicationFailed(
            cannot_reach_text(self.killed.load(Relaxed), self.stalled.load(Relaxed)).to_string(),
        )
    }

    /// 書き込みが詰まった後の後始末。
    ///
    /// 断る口は2つに分かれる。**既に列にあるジョブ**は `run_writer` の `stalled` が、
    /// **これから `send_command` に入る呼び出し**はここで立てる `Closed` が断る。
    ///
    /// やることは、詰まった印を立てる・`Closed` を立てる・積み置きを捨てるの3つ。
    ///
    /// **このプロセスは落とせない。** 詰まった `spawn_blocking` のスレッドが
    /// `handler` の Mutex を握ったままなので、`kill_engine` も返らない（→ #353）。
    /// 復帰は新しいプロセスを起動し直すこと。
    async fn fail_writes(&self) {
        self.stalled
            .store(true, std::sync::atomic::Ordering::Relaxed);
        set_ready_state(&self.ready, ReadyState::Closed);
        log::error!(
            target: LOGT,
            "write: stalled; refusing every later write on this process (→ F-26)"
        );
        self.discard_pending("the engine stopped reading stdin")
            .await;
    }

    /// 探索を止める。**「書いた」と「書く必要が無かった」を分けて返す。**
    ///
    /// `readyok` を待っている間は `go` が積まれて `stop` は素通りするので、
    /// そのまま書くと順序が入れ替わる（`stop` が先に届き、まだ探索していない
    /// エンジンがそれを無視し、後から flush された `go` で
    /// **利用者が止めたはずの探索が始まる**）。
    ///
    /// 積み置きの `go` を落とせたときに `Ok(())` を返すと、待ち手が
    /// 「この後 `bestmove` が来る」と読んで永久に待つ。だから戻り値で分ける。
    pub async fn stop(&self) -> Result<StopEffect, EngineError> {
        let state: ReadyState = *self.ready.borrow();
        let draining = self.pending.lock().await.draining;
        if dispatch_for(state, draining, &GuiCommand::Stop) == Dispatch::Refuse {
            return Err(self.cannot_reach());
        }

        let cancelled = {
            let mut pending = self.pending.lock().await;
            cancel_queued_go(&mut pending.queue)
        };
        if cancelled > 0 {
            log::info!(target: LOGT, "stop: cancelled {cancelled} queued go");
            return Ok(StopEffect::CancelledQueued);
        }

        self.send_command(&GuiCommand::Stop).await?;
        Ok(StopEffect::Written)
    }

    async fn start_ready_watch_and_send(&self) -> Result<(), EngineError> {
        self.abort_init().await;

        let gen = self.begin_generation().await;

        // `send_command` も `dispatch_for` で断っているが、**判定をここにも置く。**
        // 呼び出し側の順序に依存させない。手前に分岐が1つ増えるだけで穴が開く
        if set_ready_state(&self.ready, ReadyState::Waiting) == ReadyState::Closed {
            return Err(self.cannot_reach());
        }

        let cancel = CancellationToken::new();
        *self.init_cancel.lock().await = Some(cancel.clone());

        let (tx, mut rx) = mpsc::unbounded_channel();
        let listener_name = format!("ready_wait_{}_{}", gen, uuid::Uuid::new_v4());
        self.register_listener(listener_name.clone(), tx).await?;

        self.write(GuiCommand::IsReady).await?;

        // 非ブロッキングに readyok 待ち
        let protocol = Arc::new(self.clone());
        let handle = tokio::spawn(async move {
            let mut ready = false;

            loop {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        // キャンセルされた
                        break;
                    }
                    msg = rx.recv() => {
                        match msg {
                            Some(EngineCommand::ReadyOk) => { ready = true; break; }
                            Some(_) => {}
                            None => { break; }
                        }
                    }
                }
            }

            protocol.remove_listener(&listener_name).await;

            // **世代の確認と `Ready` の書き込みを同じロック区間に入れる。**
            // 確認だけして手放すと、その隙に次の `isready` が世代を上げて
            // `Waiting` に落とせる。`abort()` は次の await 点までしか効かないので、
            // 確認を通過済みのこのタスクは構わず `Ready` を書く。
            // 結果、`readyok` が返っていないエンジンに対して `ensure_ready` が
            // 即 `Ok` を返し、まだ評価関数を読んでいる相手へ `position` / `go` が流れる
            let mut pending = protocol.pending.lock().await;
            if pending.generation != gen {
                return;
            }

            if ready {
                set_ready_state(&protocol.ready, ReadyState::Ready);
                log::info!(target: LOGT, "ready: ok gen={}", gen);

                // **掃き始めから掃き終わりまで印を立てる。** 立てないと、
                // 1件書くごとの待ちの隙に直書きが列へ入り、
                // `position(旧) → position(新) → go(旧)` の順で届く
                pending.draining = true;
                drop(pending);

                // **キューをローカルへ移さない。** 移すと、書いている途中に
                // `abort_init` が入ったときに `pending.queue` が空なので
                // `discard_pending` が何も見つけられず、まだ書いていないぶんが
                // 1行も残さずに消える（積んだ側には `Ok` が返っている）。
                // 1件ずつ取り出して、残りは常に `pending` の側に置いておく
                loop {
                    // **キューから引くのと書き込みの列へ入れるのを、同じロック区間で。**
                    // 離すと、その隙に走った `stop` が `cancel_queued_go` で
                    // 空のキューを見て 0 を返し、取り出し済みの `go` を追い越して
                    // ワイヤへ出る。`enqueue_write` は await 点を持たないので、
                    // ロックを握ったまま呼べる
                    let next = {
                        let mut pending = protocol.pending.lock().await;
                        if pending.generation != gen {
                            // 次の `isready` が来た。残りは `begin_generation` が残す。
                            // 印はそちらが降ろす
                            break;
                        }
                        match pending.queue.pop_front() {
                            Some(cmd) => Some((cmd.clone(), protocol.enqueue_write(cmd))),
                            None => {
                                // 掃き終わり。**印を降ろすのは列が空になった瞬間**で、
                                // 同じロック区間でないと最後の1件を追い越される
                                pending.draining = false;
                                None
                            }
                        }
                    };
                    let Some((cmd, enqueued)) = next else { break };

                    let written = match enqueued {
                        Ok(rx) => protocol.await_write(rx).await,
                        Err(e) => Err(e),
                    };

                    if let Err(e) = written {
                        log::warn!(
                            target: LOGT,
                            "ready: flush failed cmd={} err={}",
                            cmd_summary(&cmd),
                            e
                        );
                        let rest = {
                            let mut pending = protocol.pending.lock().await;
                            // **自分の世代のキューしか触らない。** 世代が
                            // 変わっていたら、そこにあるのは次の世代の積み置き
                            if pending.generation != gen {
                                break;
                            }
                            pending.draining = false;
                            std::mem::take(&mut pending.queue)
                        };
                        report_dropped(&cmd, &rest);
                        break;
                    }
                }
            } else {
                log::warn!(target: LOGT, "ready: ended without readyok gen={}", gen);
                let q = std::mem::take(&mut pending.queue);
                drop(pending);
                for cmd in &q {
                    log::warn!(
                        target: LOGT,
                        "ready: dropping queued cmd={} (readyok never came)",
                        cmd_summary(cmd)
                    );
                }
            }
        });

        *self.init_task.lock().await = Some(handle);
        Ok(())
    }

    /// `usi` を送り `usiok` までを読み取る。2回目以降はキャッシュを返す。
    ///
    /// `usiok` を返さないエンジンでここが返らないと、呼び出し元の起動処理ごと
    /// 止まったまま利用者に何も出ない。`timeout` はそのための打ち切り。
    pub async fn get_engine_info(&self, timeout: Duration) -> Result<EngineInfo, EngineError> {
        {
            let state = self.state.read().await;
            if let Some(info) = &state.engine_info {
                return Ok(info.clone());
            }
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let listener_name = format!("info_collection_{}", uuid::Uuid::new_v4());

        self.register_listener(listener_name.clone(), tx).await?;
        let sent = self.send_command(&GuiCommand::Usi).await;
        let collected = match sent {
            Ok(()) => tokio::time::timeout(timeout, Self::collect_engine_info(rx))
                .await
                .unwrap_or(Err(EngineError::Timeout(
                    "engine did not return usiok in time".to_string(),
                ))),
            Err(e) => Err(e),
        };

        // 打ち切ったときもリスナーを外す。残すと、以降の `info` が
        // 誰も読まないチャンネルへ配られ続ける。
        self.remove_listener(&listener_name).await;

        let engine_info = collected?;
        self.state.write().await.engine_info = Some(engine_info.clone());

        Ok(engine_info)
    }

    async fn collect_engine_info(
        mut rx: mpsc::UnboundedReceiver<EngineCommand>,
    ) -> Result<EngineInfo, EngineError> {
        let mut name = String::new();
        let mut author = String::new();
        let mut options = Vec::new();
        let mut saw_usiok = false;

        while let Some(cmd) = rx.recv().await {
            match cmd {
                EngineCommand::Id(IdParams::Name(n)) => name = n,
                EngineCommand::Id(IdParams::Author(a)) => author = a,
                EngineCommand::Option(option_params) => {
                    options.push(convert_option_params(&option_params));
                }
                EngineCommand::UsiOk => {
                    saw_usiok = true;
                    break;
                }
                _ => {} // 他のコマンドは無視（高頻度でくる可能性）
            }
        }

        if name.is_empty() {
            // 出力が終わったのか、`usiok` までに `id name` が無かったのかで
            // 呼び出し側の対処が違う。潰さない
            return Err(EngineError::CommunicationFailed(if saw_usiok {
                "engine did not send `id name` before `usiok`".to_string()
            } else {
                "engine output ended before `usiok`".to_string()
            }));
        }

        Ok(EngineInfo {
            name,
            author,
            options,
        })
    }

    /// `readyok` を受け取り済みか
    pub fn is_ready(&self) -> bool {
        let state: ReadyState = *self.ready.borrow();
        state == ReadyState::Ready
    }

    /// `isready` を送り、`readyok` が返るまで待つ。
    ///
    /// 既に ready なら何も送らない。対局の開始前と、局面を送る前にこれを通す。
    /// 待たずに `position` / `go` を送っても `send_command` が ready まで
    /// 積んでくれるが、**積まれたまま返ってこないことを呼び出し側が知れない。**
    pub async fn ensure_ready(&self, timeout: Duration) -> Result<(), EngineError> {
        if self.is_ready() {
            return Ok(());
        }

        // **`subscribe` は送る前に取る。** 後に回すと、送ってから購読するまでの間に
        // 出力が終わった場合に `Closed` を見落として上限まで待つ
        let mut rx = self.ready.subscribe();
        self.send_command(&GuiCommand::IsReady).await?;

        let settled =
            tokio::time::timeout(timeout, rx.wait_for(|state| *state != ReadyState::Waiting))
                .await
                .map_err(|_| {
                    EngineError::Timeout("engine did not return readyok in time".to_string())
                })?
                .map_err(|_| {
                    EngineError::CommunicationFailed("ready channel closed".to_string())
                })?;

        // **上限まで待たずに返る。** 出力が終わっているなら `readyok` は来ない
        if *settled == ReadyState::Closed {
            return Err(EngineError::CommunicationFailed(
                "engine exited before it became ready".to_string(),
            ));
        }

        Ok(())
    }

    /// 現在のリスナー数取得（デバッグ用）
    pub async fn listener_count(&self) -> usize {
        self.listeners.read().await.len()
    }

    async fn abort_init(&self) {
        // cancel token
        if let Some(tok) = self.init_cancel.lock().await.take() {
            tok.cancel();
        }
        // join handle
        if let Some(h) = self.init_task.lock().await.take() {
            h.abort();
        }

        self.discard_pending("the ready wait was aborted").await;
    }

    /// 世代を上げ、前の世代の積み置きを捨てる。**同じロックの中で行う。**
    ///
    /// 別々にすると、上げてから捨てるまでの間に積まれたぶんが、
    /// 新しい世代のキューに前の世代のコマンドとして残る
    async fn begin_generation(&self) -> u64 {
        let mut pending = self.pending.lock().await;
        pending.generation += 1;
        pending.draining = false;
        let gen = pending.generation;
        let dropped = std::mem::take(&mut pending.queue);
        drop(pending);

        for cmd in &dropped {
            log::warn!(
                target: LOGT,
                "ready: dropping queued cmd={} (a new isready started)",
                cmd_summary(cmd)
            );
        }
        gen
    }

    /// 積み置きを捨てる。**捨てるものがあったら必ず1行残す。**
    ///
    /// 積んだ時点で呼び出し側には `Ok` が返っているので、ここで黙ると
    /// 「送ったつもりのコマンドがどこにも書かれない」が痕跡なしに起きる
    async fn discard_pending(&self, why: &str) {
        let dropped = {
            let mut pending = self.pending.lock().await;
            pending.draining = false;
            std::mem::take(&mut pending.queue)
        };
        for cmd in &dropped {
            log::warn!(
                target: LOGT,
                "ready: dropping queued cmd={} ({why})",
                cmd_summary(cmd)
            );
        }
    }

    /// `quit` を送る。**送れたとは限らない。**
    ///
    /// 戻り値を持たないのは、これが礼儀であって保証ではないため。
    /// 落とすことの保証は `kill_engine` の側にある。
    pub async fn quit(&self) {
        log::debug!(target: LOGT, "quit: sending");
        let _ = self.send_command(&GuiCommand::Quit).await;
    }

    /// プロセスを落とす。2度目以降は何もしない。
    ///
    /// **待つ上限はここに閉じてある。** `handler` の Mutex を書き込みの
    /// `spawn_blocking` が握ったままだと、取りに行くスレッドは返らない（→ #353）。
    /// 呼び出し側に上限を任せると、裸で呼ぶ口が1つできただけで
    /// そこが終了処理の行き止まりになる。
    ///
    /// 超えたときプロセスは走ったまま残る。待ち続けてアプリが終われないより
    /// ましだという判断。`tokio::time::timeout` は `spawn_blocking` を
    /// 取り消さないので、詰まったスレッドはそのまま残る。
    ///
    /// **落とした handler を drop させない。** `usi 0.6` の
    /// `UsiEngineHandler` は `Drop` で `kill().unwrap()` を呼び、その `kill` は
    /// 先に `quit` を書く。既に死んだプロセスへの書き込みは EPIPE で失敗するので、
    /// **2度目の `kill` は必ずパニックする**。
    ///
    /// 行番号で指さないのは、版を上げた瞬間に無言でずれるため。
    /// 確かめるときは `Cargo.lock` の版で crate を開き、`Drop` と `kill` を読む。
    ///
    /// `forget` で漏れるのはパイプの fd。子プロセスの回収はどちらにせよ
    /// 起きない（Rust の `Child::drop` は `wait` しない）。→ #353
    pub async fn kill_engine(&self) {
        log::info!(target: LOGT, "kill_engine: start");

        // **落とす前に `Closed` を立てる。** 立てないと、`handler` を `take` した
        // 後も `ready` が `Waiting` のまま残り、死んだプロセス向けに
        // `position` / `go` が積める（`Ok` が返り、掃く者は永久に来ない）。
        //
        // 印も一緒に立てる。立てないと、以後の `Refuse` が
        // 「エンジンの出力が終わった」と説明する（落としたのはこちら）
        self.killed
            .store(true, std::sync::atomic::Ordering::Relaxed);
        set_ready_state(&self.ready, ReadyState::Closed);

        self.abort_init().await;

        // `kill` も `quit` を書くので、書き込みと同じ理由で専用スレッドへ出す
        let handler = Arc::clone(&self.handler);
        let killed = tokio::task::spawn_blocking(move || {
            let taken = handler.blocking_lock().take();
            let Some(mut handler) = taken else {
                return false;
            };

            // 戻り値に用は無い。目的は「死んでいること」で、
            // 既に死んでいれば `quit` の書き込みが失敗するだけ
            let _ = handler.kill();
            std::mem::forget(handler);
            true
        });

        match tokio::time::timeout(KILL_TIMEOUT, killed).await {
            Ok(Ok(true)) => log::info!(target: LOGT, "kill_engine: done"),
            Ok(Ok(false)) => log::debug!(target: LOGT, "kill_engine: already gone"),
            Ok(Err(e)) => log::warn!(target: LOGT, "kill_engine: task failed: {e}"),
            Err(_) => log::error!(
                target: LOGT,
                "kill_engine: timed out — the process is left running"
            ),
        }
    }
}

// ヘルパー関数（高速化のためインライン化）
#[inline]
fn convert_option_params(params: &OptionParams) -> EngineOption {
    use usi::OptionKind;

    let option_type = match &params.value {
        OptionKind::Check { default } => EngineOptionType::Check { default: *default },
        OptionKind::Spin { default, min, max } => EngineOptionType::Spin {
            default: *default,
            min: *min,
            max: *max,
        },
        OptionKind::Combo { default, vars } => EngineOptionType::Combo {
            default: default.clone(),
            vars: vars.clone(),
        },
        OptionKind::Button { default } => EngineOptionType::Button {
            default: default.clone(),
        },
        OptionKind::String { default } => EngineOptionType::String {
            default: default.clone(),
        },
        OptionKind::Filename { default } => EngineOptionType::Filename {
            default: default.clone(),
        },
    };

    let default_value = match &params.value {
        OptionKind::Check { default } => default.map(|b| b.to_string()),
        OptionKind::Spin { default, .. } => default.map(|i| i.to_string()),
        OptionKind::Combo { default, .. } => default.clone(),
        OptionKind::Button { default } => default.clone(),
        OptionKind::String { default } => default.clone(),
        OptionKind::Filename { default } => default.clone(),
    };

    EngineOption {
        name: params.name.clone(),
        option_type,
        default_value,
        current_value: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// コマンドの種類を**1回だけ**書く。
    ///
    /// 種類の一覧が手書きの写しだと、バリアントを足したときに片方だけ直せる。
    /// 数が揃ってしまえば緑で通るので、忘れたことに誰も気付かない。
    /// ここで宣言すれば `Kind::ALL` は列から生えるので、写しにならない。
    macro_rules! kinds {
        ($($name:ident),* $(,)?) => {
            #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
            enum Kind { $($name),* }

            impl Kind {
                /// **手で書かない。** 上の列から生える
                const ALL: &'static [Kind] = &[$(Kind::$name),*];
            }
        };
    }

    kinds! {
        Usi,
        IsReady,
        SetOption,
        UsiNewGame,
        Position,
        Go,
        Stop,
        Ponderhit,
        GameOver,
        Quit,
    }

    /// `GuiCommand` の全バリアントを `Kind` へ写す。
    ///
    /// **`_` を足さないこと。** `usi` crate がバリアントを増やしたら、
    /// この `match` がコンパイルで落ちる。そこから `kinds!` の列へ辿り着く。
    fn kind_of(cmd: &GuiCommand) -> Kind {
        match cmd {
            GuiCommand::Usi => Kind::Usi,
            GuiCommand::IsReady => Kind::IsReady,
            GuiCommand::SetOption(..) => Kind::SetOption,
            GuiCommand::UsiNewGame => Kind::UsiNewGame,
            GuiCommand::Position(_) => Kind::Position,
            GuiCommand::Go(_) => Kind::Go,
            GuiCommand::Stop => Kind::Stop,
            GuiCommand::Ponderhit => Kind::Ponderhit,
            GuiCommand::GameOver(_) => Kind::GameOver,
            GuiCommand::Quit => Kind::Quit,
        }
    }

    /// 写像のループが回すコマンド。**`GuiCommand` の全バリアントを1つずつ。**
    ///
    /// 述語（`requires_ready` / `bypasses_draining`）にバリアントを足したとき、
    /// ここに無いと写像のループがその組み合わせを試さない。
    /// 全部あることは `commands_covers_every_gui_command` が見る。
    fn commands() -> Vec<GuiCommand> {
        vec![
            GuiCommand::Usi,
            GuiCommand::IsReady,
            GuiCommand::SetOption("name".to_string(), None),
            GuiCommand::UsiNewGame,
            GuiCommand::Position("sfen".to_string()),
            GuiCommand::Go(usi::ThinkParams::new()),
            GuiCommand::Stop,
            GuiCommand::Ponderhit,
            GuiCommand::GameOver(usi::GameOverKind::Win),
            GuiCommand::Quit,
        ]
    }

    /// `commands()` が `GuiCommand` の全バリアントを持つこと。
    ///
    /// 突き合わせる相手は `Kind::ALL`。**手書きの写しではない**ので、
    /// `usi` crate のバリアントが増えたときは
    /// 「`kind_of` がコンパイルで落ちる → `kinds!` に足す →
    /// `Kind::ALL` が伸びる → ここが落ちる → `commands()` に足す」の順に辿れる。
    /// どこか1つを忘れても、数が揃って緑になることがない。
    #[test]
    fn commands_covers_every_gui_command() {
        let mut kinds: Vec<Kind> = commands().iter().map(kind_of).collect();
        kinds.sort_unstable();
        let before = kinds.len();
        kinds.dedup();

        assert_eq!(before, kinds.len(), "`commands()` に同じ種類が2つある");

        let mut all = Kind::ALL.to_vec();
        all.sort_unstable();

        assert_eq!(kinds, all, "`commands()` が `GuiCommand` を網羅していない");
    }

    /// 写像の全域を回す。**行を手で選ばない。**
    ///
    /// 手書きの表にすると、書いた人が選んだ組み合わせしか当たらない。
    /// `ReadyState` にバリアントを足したときも、`COMMANDS` に足したときも、
    /// このループが自動で広がる。
    ///
    /// 期待値は `expected_dispatch` が別の書き方で作る。**同じ式を写さない**
    /// （写すと `dispatch_for` を壊しても両方が同じように壊れる）。
    #[test]
    fn the_dispatch_map_is_total() {
        for &state in ReadyState::ALL {
            for draining in [false, true] {
                for cmd in commands() {
                    assert_eq!(
                        dispatch_for(state, draining, &cmd),
                        expected_dispatch(state, draining, &cmd),
                        "({state:?}, draining={draining}, {cmd})"
                    );
                }
            }
        }
    }

    /// `dispatch_for` と**独立に**期待値を組む。
    ///
    /// **述語（`requires_ready` / `bypasses_draining`）を呼ばない。** 呼ぶと、
    /// 述語の中身を変えたときに両辺が同じだけ動いて絶対に落ちない。
    /// ここではコマンドを `kind_of` の名前で数え上げる——
    /// 述語にバリアントを足す変異は、この列挙と食い違って落ちる。
    fn expected_dispatch(state: ReadyState, draining: bool, cmd: &GuiCommand) -> Dispatch {
        if state == ReadyState::Closed {
            return Dispatch::Refuse;
        }

        let kind = kind_of(cmd);

        // 掃きの最中でも列の後ろへ回さないもの
        if draining && !matches!(kind, Kind::Stop | Kind::IsReady | Kind::Quit) {
            return Dispatch::Queue;
        }
        // `readyok` が返るまで送れないもの
        if state == ReadyState::Waiting
            && matches!(kind, Kind::UsiNewGame | Kind::Position | Kind::Go)
        {
            return Dispatch::Queue;
        }
        Dispatch::Send
    }

    /// 届かない理由を、印の組み合わせ4通り全部で確かめる。
    ///
    /// **`killed` と `stalled` が両方立つ組み合わせを外さないこと。**
    /// 落としたプロセスは書き込みも詰まるので、この組み合わせは実際に起きる。
    /// ここで `STALLED` が出ると、利用者が終了させた直後に
    /// 「エンジンが stdin を読まなくなった」と説明することになる。
    #[test]
    fn who_stopped_the_engine_is_not_flattened_into_one_message() {
        assert_eq!(cannot_reach_text(false, false), CLOSED);
        assert_eq!(cannot_reach_text(false, true), STALLED);
        assert_eq!(cannot_reach_text(true, false), GONE);
        assert_eq!(cannot_reach_text(true, true), GONE);

        // 3つとも別の文言であること。同じなら上の突き合わせは何も見ていない
        let mut texts = [CLOSED, STALLED, GONE];
        texts.sort_unstable();
        let before = texts.len();
        let mut unique = texts.to_vec();
        unique.dedup();
        assert_eq!(before, unique.len(), "届かない理由の文言が重なっている");
    }

    /// `Closed` から戻す口を作らないこと。
    ///
    /// 戻せると `dispatch_for` の `Refuse` も `register_listener` の拒否も、
    /// `isready` 1本で同時に無効になる。
    #[test]
    fn closed_absorbs_every_later_transition() {
        for &requested in ReadyState::ALL {
            assert_eq!(
                next_ready_state(ReadyState::Closed, requested),
                ReadyState::Closed,
                "Closed から {requested:?} へ戻している"
            );
        }

        // `Closed` 以外は要求どおりに動く
        for &current in ReadyState::ALL {
            if current == ReadyState::Closed {
                continue;
            }
            for &requested in ReadyState::ALL {
                assert_eq!(next_ready_state(current, requested), requested);
            }
        }
    }

    /// `stop` が積み置きの `go` を取り消すこと。
    ///
    /// `stop` は積まれないのに `go` は積まれるので、`readyok` を待っている間は
    /// 順序が入れ替わる。取り消さないと、**利用者が止めた後に探索が始まる**
    #[test]
    fn a_stop_cancels_queued_go() {
        let mut queue = VecDeque::from(vec![
            GuiCommand::UsiNewGame,
            GuiCommand::Position("sfen".to_string()),
            GuiCommand::Go(usi::ThinkParams::new()),
        ]);

        assert_eq!(cancel_queued_go(&mut queue), 1);

        // `position` は残す。送っただけでは何も起きず、次の `go` の前提になる
        assert_eq!(queue.len(), 2);
        assert!(matches!(queue[0], GuiCommand::UsiNewGame));
        assert!(matches!(queue[1], GuiCommand::Position(_)));

        // 2度目は何も落とさない
        assert_eq!(cancel_queued_go(&mut queue), 0);
    }

    fn empty_pending() -> Pending {
        Pending {
            generation: 1,
            queue: VecDeque::new(),
            draining: false,
        }
    }

    /// 積み置きが上限で断られること。**積んで `Ok` を返さない。**
    ///
    /// 積み続けると、`readyok` を返さないエンジン相手に無限に伸びる。
    /// 断れば呼び出し側が気付ける
    #[test]
    fn a_full_pending_queue_is_refused() {
        let mut pending = empty_pending();
        let position = GuiCommand::Position("sfen".to_string());

        for i in 0..PENDING_LIMIT {
            assert!(
                push_pending(&mut pending, &position).is_ok(),
                "{i} 件目で断られた"
            );
        }
        assert!(push_pending(&mut pending, &position).is_err());
        assert_eq!(pending.queue.len(), PENDING_LIMIT);
    }

    /// 落ち着いた値を返すこと。呼び出し側はこれを見て「戻せなかった」を知る
    #[test]
    fn set_ready_state_reports_what_it_settled_on() {
        let ready = watch::channel(ReadyState::Waiting).0;

        assert_eq!(
            set_ready_state(&ready, ReadyState::Ready),
            ReadyState::Ready
        );
        assert_eq!(
            set_ready_state(&ready, ReadyState::Closed),
            ReadyState::Closed
        );
        assert_eq!(
            set_ready_state(&ready, ReadyState::Waiting),
            ReadyState::Closed,
            "Closed の後に Waiting を通している"
        );
        assert_eq!(*ready.borrow(), ReadyState::Closed);
    }
}
