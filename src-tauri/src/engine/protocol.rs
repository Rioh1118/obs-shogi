//! 起動した1本のエンジンへ手順を通す。何を書いてよいか、読んだ行をどこへ流すかは状態機械（`usi_machine`）が
//! 決め、ここはそれを1つのロックの下に持って、出たことを順に行う（書き込みの列へ入れる、札の答えを渡す、
//! 探索へ行を流す）。待つ上限は手順が持つ（ADR-0016 決定2）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::sync::{mpsc, oneshot, watch};
use usi::{EngineCommand, GameOverKind, GuiCommand};

use crate::engine::child::{
    ChildDiagnostics, ChildWriter, EngineChild, KillOutcome, ReadEvent, Source, KILL_TIMEOUT,
};
use crate::engine::logging::{shown, LogThrottle, MAX_SUMMARY_LEN};
use crate::engine::usi_machine::{
    Asked, Effect, SearchId, SearchLine, Ticket, UsiMachine, GONE, STALLED,
};
use crate::engine::{logging::cmd_summary, logging::with_cause, types::*};

const LOGT: &str = "obs_shogi::engine::protocol";

pub mod search;

/// USI の行を壊す文字を含むか。
///
/// **判断はここ1本。** USI は行指向なので、改行を混ぜられると別のコマンドを
/// 注入できる。禁止集合を各層に写すと、片方を厚くしたときにもう片方が薄いまま
/// 残る（`\u{85}` や `\u{2028}` を足す動機が出たとき、直すのは踏んだ側だけになる）。
pub fn contains_usi_breaking_char(s: &str) -> bool {
    s.chars().any(|c| c == '\n' || c == '\r' || c == '\0')
}

/// 線に出したときに USI の行を壊さないか。
///
/// **組み立てた1行を見る。** 書き込みの列が線に出すのは `Display` の結果そのもの
/// （`command.to_string()` に改行を足したもの。`run_writer`）なので、バリアントやフィールドが増えても
/// この検査は追随する。フィールドを数え上げる書き方だと増えない。
fn check_writable(command: &GuiCommand) -> Result<(), EngineError> {
    if contains_usi_breaking_char(&command.to_string()) {
        return Err(EngineError::InvalidState(format!(
            "refusing to write a command that breaks the USI line format: {}",
            cmd_summary(command)
        )));
    }
    Ok(())
}

/// 線に出る1行の欄が、行を壊す文字を含めば断る。手順が状態機械へ頼む前に呼ぶ。
///
/// 頼んだ後に書き込みの列（`check_writable`）で断ると、同じ頼みの後ろの書き込み
/// （`position` の後の `go`、`setoption` の後の `isready`）は列へ入り、状態機械も書いたつもりで進む
fn refuse_breaking_field(what: &str, text: &str) -> Result<(), EngineError> {
    if contains_usi_breaking_char(text) {
        return Err(EngineError::InvalidState(format!(
            "refusing {what} that breaks the USI line format"
        )));
    }
    Ok(())
}

/// 出力が終わった、または起動に失敗したエンジンの stderr を読み切るのを待つ上限。
/// stdout と stderr の EOF は別々に着く（`ChildDiagnostics::settle_output`）。失敗の理由に
/// stderr の最後の行を載せるための待ちで、人が待たされていると感じない長さに留める。
/// 出力が終わった後のログでは、終わりを見届けるのもこの上限で並べて待つ（`listen_ended_line`）
const SETTLE_OUTPUT: Duration = Duration::from_millis(200);

/// 解けなかった行を記録する間隔。**1行ずつ書かない。** ノード数が i32 を超えた
/// 探索は `info` を毎秒何行も解けなくなり、1行ずつ書くとログの予算
/// （`LOG_FILE_BUDGET`）を数分で一周させる
const SKIPPED_LINE_LOG_INTERVAL: Duration = Duration::from_secs(10);

/// 書き込み1回に置く上限。
///
/// **1件の書き込みに掛かる。** 手順が返るまでの実時間ではない
/// （列に先客が居ればその処理時間が足される）。呼び出し側に上限を書かせると
/// 包み忘れた呼び出しが上限なしで残るので、置き場はここ1つ。
///
/// 待っている側ではなく `run_writer` の中で包むのは、待つ側だと
/// 前のジョブの処理時間が入るため。1回に書くのは
/// `position sfen ... moves ...` でも数百バイトなので、そちらだと
/// 「自分の書き込みが1バイトも始まっていないのに切れる」が起きる。
///
/// **超えても「書けなかった」とは言えない。** `run_writer` は書き込みのタスクを
/// 取り消さないので、詰まっていた書き込みはエンジンが stdin を吸った瞬間に
/// 完走してコマンドをワイヤへ出す。分かるのは「上限内に書き終わらなかった」だけ。
/// 後続を全部断る（`fail_writes`）のはそのため——**後から1件だけ届く**ことは
/// 避けられないが、その後ろに何も並ばないようにはできる。
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(2);

/// `usi` を送ってから `usiok` を待つ上限。
///
/// ここに掛かるのは実行ファイルの起動直後だけで、評価関数の読み込みは
/// `isready` の側に来る。長く取る理由が無い。
pub const USI_OK_TIMEOUT: Duration = Duration::from_secs(30);

/// `isready` を送ってから `readyok` を待つ上限。
///
/// `usiok` より桁で長いのは、評価関数やハッシュの確保がここで走るため。
/// 短く切ると、重い設定のエンジンが起動できないという形で出る。
pub const READY_TIMEOUT: Duration = Duration::from_secs(120);

/// USI プロトコル処理層。手順（`identify`、`prepare`、`check_value`、`new_game`、`search`、`game_over`）と、
/// 終わらせる操作（`quit`、`kill_engine`）を持つ。
///
/// **子プロセスの持ち主はこれ1つにする。** `Clone` を持たせず、`EngineChild` を `Arc` に
/// 包まない。`&self` から持ち主を増やせると、それをタスクへ渡した瞬間に「捨てればプロセスも
/// 落ちる」がそのタスクの寿命に縛られる。共有は `Arc<UsiProtocol>` で、プロセスより長く生きうる
/// タスク（読んだ行を状態機械へ渡すタスク、捨てた探索の `stop` を書き終えるタスク）へは、
/// 子プロセスを持たない `Shared` か `ChildDiagnostics` を渡す。
pub struct UsiProtocol {
    /// 子プロセスと標準入出力。**書き込み・読み取り・落とす経路がそれぞれ別の持ち主**
    /// なので、書き込みが詰まっても落とせる（`engine/child.rs`）。
    child: EngineChild,
    shared: Arc<Shared>,
    runtime_handle: tokio::runtime::Handle,
}

/// エンジンとの繋がりのうち、**子プロセスを持たない側**。状態機械と、書き込みの列と、状態の写し。
struct Shared {
    /// 状態機械と、その答えを待つ者。**ロックはこれ1つで、await を跨いで握らない**（`step`）。
    /// 状態機械が出した書き込みを列へ入れるのもこの中で行うので、出た順がそのまま線の順になる
    /// （`docs/state-transitions/engine.md` の不変条件1）
    core: Mutex<Core>,

    /// 書き込みの列。**投入順がそのままワイヤ上の順になる**（`run_writer`）
    writer: mpsc::UnboundedSender<WriteJob>,

    /// 閉じたか・探索中かの写し。待つ者（終わりの見張り、前の探索の終わりを待つ手順「探索」）が
    /// ロックを取らずに待てるように置く。書くのは `step` だけ
    status: watch::Sender<Status>,
}

struct Core {
    machine: UsiMachine,
    /// 札ごとの答えの送り先。答えを渡したら外す。待つ者が諦めていれば、送っても黙って捨てられる
    waiters: HashMap<Ticket, Waiter>,
    /// 走っている探索へ行を流す先。状態機械が走らせる探索は高々1本（不変条件2）
    search: Option<(SearchId, mpsc::UnboundedSender<SearchLine>)>,
}

/// 札で待つ者。手順ごとに答えの型が違うので、送り先を型ごとに持つ
enum Waiter {
    Named(oneshot::Sender<Result<EngineInfo, EngineError>>),
    Prepared(oneshot::Sender<Result<Vec<String>, EngineError>>),
    Checked(oneshot::Sender<Result<Vec<String>, EngineError>>),
    Stopped(oneshot::Sender<Result<(), EngineError>>),
}

/// 状態機械の写し（`Shared::status`）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Status {
    end: Option<EngineEnd>,
    searching: bool,
}

/// 1回の `step` で書き込みの列へ入れたもの。書けたかを待つのは、頼んだ手順（`Shared::finish`）
#[must_use]
#[derive(Default)]
struct Written {
    replies: Vec<Result<oneshot::Receiver<Result<(), EngineError>>, EngineError>>,
    /// 状態機械が落とす指示を出した
    kill: bool,
}

/// プロセスの終わりを待つ取っ手。**子プロセスを持たない**ので、
/// 待っている間もプロセスの寿命を延ばさない（`UsiProtocol` の doc）
pub struct EngineEndWatch {
    diagnostics: ChildDiagnostics,
    status: watch::Receiver<Status>,
}

impl EngineEndWatch {
    /// 閉じるまで待ち、理由を返す。**既に閉じていればすぐ返る**（`watch` は今の値から見る）
    pub async fn wait(&mut self) -> EngineEnd {
        let end = match self.status.wait_for(|status| status.end.is_some()).await {
            Ok(status) => status.end,
            Err(_) => None,
        };
        // 送り手が消えた（`Err`）のは、`UsiProtocol` ごと捨てられたとき。こちらが手放している
        end.unwrap_or(EngineEnd::Requested)
    }

    /// エンジンが最後に出した行。stderr の読み切りを `SETTLE_OUTPUT` まで待つ
    pub async fn last_output(&self) -> Option<String> {
        self.diagnostics.settle_output(SETTLE_OUTPUT).await;
        summarize_recent(&self.diagnostics.recent_lines())
    }
}

/// 書き込みの列に流す1件。
struct WriteJob {
    command: GuiCommand,
    reply: oneshot::Sender<Result<(), EngineError>>,
}

/// 書き込みを1本の列にする理由。
///
/// **投入順＝ワイヤ上の順**であることを、この列だけで保証する。
/// 呼び出しごとにタスクを投げると、どのタスクが先に stdin のロックを取るかは
/// **投入順と無関係**になり、`stop` が `go` を追い越す。
///
/// 1件の書き込みは別のタスクに出し、その完了を上限つきで待つ。**待つのをやめても
/// 書き込みは取り消さない**——途中で取り消すと行の半分だけがワイヤに残り、
/// エンジンは次の行と繋げて読む。
async fn run_writer(writer: Option<ChildWriter>, mut jobs: mpsc::UnboundedReceiver<WriteJob>) {
    let writer = writer.map(Arc::new);
    // 1件でも上限に達したら、**それ以降は書かずに断る。**
    //
    // 詰まっているジョブは取り消さない（取り消すと行の半分がワイヤに残る）。後ろを
    // 通すと、「送れなかった」と判断した側が出した `gameover` が、その `go` の
    // 後ろに並ぶ（探索中のエンジンへ `gameover`＝不変条件3 の違反）。
    // 状態機械を閉じるだけでは、**既に列にあるジョブ**は止まらない。
    let mut stalled = false;

    while let Some(WriteJob { command, reply }) = jobs.recv().await {
        let summary = cmd_summary(&command);

        if stalled {
            let _ = reply.send(Err(EngineError::CommunicationFailed(
                STALLED.to_string().into(),
            )));
            log::warn!(target: LOGT, "write: refused after a stall cmd={summary}");
            continue;
        }

        let Some(writer) = writer.as_ref().map(Arc::clone) else {
            let _ = reply.send(Err(EngineError::NotInitialized(GONE.to_string())));
            continue;
        };
        let line = command.to_string();
        let write = tokio::spawn(async move {
            match writer.write_line(&line).await {
                Ok(()) => Ok(()),
                // 閉じてあるのは落とした後だけ（`EngineChild::kill_and_wait`）
                Err(e) if e.kind() == std::io::ErrorKind::NotConnected => {
                    Err(EngineError::NotInitialized(GONE.to_string()))
                }
                Err(e) => Err(EngineError::CommunicationFailed(with_cause(&e).into())),
            }
        });

        // **上限はここ。** 待っている側で包むと、前のジョブの処理時間が入る
        let written = match tokio::time::timeout(WRITE_TIMEOUT, write).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => Err(EngineError::CommunicationFailed(
                format!("write task failed: {e}").into(),
            )),
            Err(_) => {
                stalled = true;
                Err(EngineError::Timeout(format!(
                    "{TIMED_OUT} accepting the write; it may still arrive"
                )))
            }
        };

        if let Err(e) = &written {
            log::warn!(target: LOGT, "write: failed cmd={summary} err={e}");
        }
        let _ = reply.send(written);
    }
}

/// 毒の入ったロックもそのまま取る。`step` は状態機械を1回動かして出たことを行うだけで、
/// 途中で panic して残りうるのは「答えを渡していない札」か「入れていない書き込み」。
/// 待つ者は上限か出力の終わりで抜けるので、ロックを取れなくして全部の手順を止めるより害が小さい
fn lock(core: &Mutex<Core>) -> MutexGuard<'_, Core> {
    core.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Shared {
    /// 状態機械を1回動かし、出たことを出た順に行う。**同期。await 点を持たない。**
    ///
    /// `input` は札を出したら、同じロックの中で送り先を `waiters` に置くこと。外で置くと、
    /// その間に読んだ行が答えを出したときに送り先が無く、答えが黙って消える
    fn step<R>(&self, input: impl FnOnce(&mut Core) -> R) -> (R, Written) {
        let mut core = lock(&self.core);
        let result = input(&mut core);
        let mut written = Written::default();
        for effect in core.machine.take_effects() {
            match effect {
                Effect::Write(command) => written.replies.push(self.enqueue_write(command)),
                Effect::Named(ticket, answer) => {
                    if let Some(Waiter::Named(tx)) = core.waiters.remove(&ticket) {
                        let _ = tx.send(answer);
                    }
                }
                Effect::Prepared(ticket, answer) => {
                    if let Some(Waiter::Prepared(tx)) = core.waiters.remove(&ticket) {
                        let _ = tx.send(answer);
                    }
                }
                Effect::Checked(ticket, answer) => {
                    if let Some(Waiter::Checked(tx)) = core.waiters.remove(&ticket) {
                        let _ = tx.send(answer);
                    }
                }
                Effect::Stopped(ticket, answer) => {
                    if let Some(Waiter::Stopped(tx)) = core.waiters.remove(&ticket) {
                        let _ = tx.send(answer);
                    }
                }
                Effect::ToSearch(id, line) => {
                    if let Some((current, tx)) = &core.search {
                        if *current == id {
                            let _ = tx.send(line);
                        }
                    }
                }
                Effect::SearchEnded(id) => {
                    if core
                        .search
                        .as_ref()
                        .is_some_and(|(current, _)| *current == id)
                    {
                        core.search = None;
                    }
                }
                Effect::Kill => written.kill = true,
                Effect::Note(text) => log::warn!(target: LOGT, "{text}"),
            }
        }
        let status = Status {
            end: core.machine.end(),
            searching: core.machine.is_searching(),
        };
        // 写しもロックの中で書く。外で書くと、2つの `step` の写しが入れ替わって古い値が残りうる
        self.status.send_if_modified(|current| {
            let changed = *current != status;
            *current = status;
            changed
        });
        (result, written)
    }

    /// 書き込みの列へ入れる。**同期。await 点を持たない**（`step` のロックの中で呼ぶ）
    fn enqueue_write(
        &self,
        command: GuiCommand,
    ) -> Result<oneshot::Receiver<Result<(), EngineError>>, EngineError> {
        // **最後の砦。** 手順も状態機械へ頼む前に弾いている（ここで断ると、同じ `step` の後ろの
        // 書き込みは列へ入る）が、そちらは入口ごとに書く検証なので、入口を足した人が素通りするのを
        // 止めるものが無い。ここは書き込みの列へ入る唯一の経路
        check_writable(&command)?;

        let (reply, rx) = oneshot::channel();
        if self.writer.send(WriteJob { command, reply }).is_err() {
            return Err(EngineError::NotInitialized(GONE.to_string()));
        }
        Ok(rx)
    }

    /// `step` で列へ入れた書き込みが書けたかを、入れた順に待つ。最初の失敗を返す。
    ///
    /// **待つだけではない。** 上限に当たったら `fail_writes` を撃つ——状態機械が閉じ、
    /// 以後この `UsiProtocol` へは何も送れなくなる。戻り値を捨ててもこの副作用は起きる
    async fn finish(&self, written: Written) -> Result<(), EngineError> {
        for reply in written.replies {
            let result = match reply?.await {
                Ok(result) => result,
                // 列のタスクが落ちた
                Err(_) => Err(EngineError::CommunicationFailed(
                    "the writer stopped".to_string().into(),
                )),
            };
            if matches!(result, Err(EngineError::Timeout(_))) {
                self.fail_writes();
            }
            result?;
        }
        Ok(())
    }

    /// 書き込みが詰まった後の後始末（表の W1）。
    ///
    /// 断る箇所は2つに分かれる。**既に列にあるジョブ**は `run_writer` の `stalled` が、
    /// **これから手順に入る呼び出し**はここで閉じた状態機械が断る。
    ///
    /// **このプロセスには二度と書けない。** 詰まった書き込みのタスクが stdin の
    /// ロックを握ったままになる。落とすことはできる（`kill_engine` は stdin の
    /// ロックを待たない）ので、復帰は落として新しいプロセスを起動し直すこと。
    fn fail_writes(&self) {
        let ((), _nothing_written) = self.step(|core| core.machine.on_write_stalled());
        log::error!(
            target: LOGT,
            "write: stalled; refusing every later write on this process (→ F-26)"
        );
    }

    /// 届かなくなった理由（`usi_machine` の `GONE` / `CLOSED` / `STALLED`）
    fn cannot_reach(&self) -> EngineError {
        lock(&self.core).machine.cannot_reach()
    }

    /// 書き込みの列へ入れて、書けたかを待つ。状態機械を通さない（詰まりを作るテストだけが使う）
    #[cfg(test)]
    async fn write(&self, command: GuiCommand) -> Result<(), EngineError> {
        let written = Written {
            replies: vec![self.enqueue_write(command)],
            kill: false,
        };
        self.finish(written).await
    }
}

impl Core {
    fn wait_named(&mut self, ticket: Ticket) -> oneshot::Receiver<Result<EngineInfo, EngineError>> {
        let (tx, rx) = oneshot::channel();
        self.waiters.insert(ticket, Waiter::Named(tx));
        rx
    }

    fn wait_prepared(
        &mut self,
        ticket: Ticket,
    ) -> oneshot::Receiver<Result<Vec<String>, EngineError>> {
        let (tx, rx) = oneshot::channel();
        self.waiters.insert(ticket, Waiter::Prepared(tx));
        rx
    }

    fn wait_checked(
        &mut self,
        ticket: Ticket,
    ) -> oneshot::Receiver<Result<Vec<String>, EngineError>> {
        let (tx, rx) = oneshot::channel();
        self.waiters.insert(ticket, Waiter::Checked(tx));
        rx
    }

    fn wait_stopped(&mut self, ticket: Ticket) -> oneshot::Receiver<Result<(), EngineError>> {
        let (tx, rx) = oneshot::channel();
        self.waiters.insert(ticket, Waiter::Stopped(tx));
        rx
    }
}

/// 読み取りを始め、読んだ行を状態機械へ渡すタスクを起こす。
///
/// 読み取りのタスクと状態機械の間をチャンネル1本で繋ぐ。**行ごとに `spawn` しない**——
/// どのタスクが先に状態機械へ渡すかがランタイム任せになり、`id name` と `usiok` が
/// 入れ替わると名前の無い名乗りになる。読み取り側は `send` するだけで、`unbounded` なので詰まらない。
///
/// 渡すタスクは子プロセスを持たない `Shared` と `ChildDiagnostics` だけを握る。`EngineChild` を
/// 渡すと、stdout が開いている間 Drop が起きず、捨てたプロセスが落ちない
fn start_reading(child: &EngineChild, shared: &Arc<Shared>) {
    let (line_tx, mut line_rx) = mpsc::unbounded_channel::<(String, Option<EngineCommand>)>();

    // 解けなかった行も状態機械へ渡す（`option` 行は解けなくても宣言に入る）。
    // **読み取りは止めない**——止めると、エンジンが生きたまま以後の出力が全部消える。
    // 解けなかった数の記録は時計が要るので、状態機械ではなくここで間引く
    let mut skipped = 0u64;
    let mut throttle = LogThrottle::new(SKIPPED_LINE_LOG_INTERVAL);
    let started = child.read_stdout(move |event| match event {
        ReadEvent::Line { parsed, raw } => {
            if parsed.is_none() {
                skipped += 1;
                if throttle.allow() {
                    log::debug!(
                        target: LOGT,
                        "listen: skipped {skipped} line(s) it could not parse; last: {}",
                        shown(&raw, MAX_SUMMARY_LEN)
                    );
                    skipped = 0;
                }
            }
            line_tx.send((raw, parsed)).is_ok()
        }
        // 読み手が抜けると `line_tx` が落ち、下のタスクが後始末をする
        ReadEvent::Eof => false,
    });

    let shared = Arc::clone(shared);
    if !started {
        // 読み取りを始めるのはここだけなので起きない。起きたら、待つ者が上限まで待たないように閉じる
        log::error!(target: LOGT, "listen: the engine output was already being read");
        let ((), _nothing_written) = shared.step(|core| core.machine.on_output_end());
        return;
    }

    let diagnostics = child.diagnostics();
    tokio::spawn(async move {
        while let Some((raw, parsed)) = line_rx.recv().await {
            let ((), _nothing_written) = shared.step(|core| core.machine.on_line(&raw, parsed));
        }

        // 読み取りが終わった。**溜まっていた行を渡し切ってから**「もう来ない」を渡す。
        // 読み取りの終わり方は1つではない（stdout の EOF、読み取り自体の失敗）が、
        // **どの終わり方でも `line_tx` は落ちる**ので、ここに置けば終わり方を数え上げずに済む。
        // hook の中で渡すと、まだ渡していない行（`bestmove` を書いた直後に終わるエンジンの手）を捨てる
        let (end, _nothing_written) = shared.step(|core| {
            core.machine.on_output_end();
            core.machine.end()
        });

        if end == Some(EngineEnd::Requested) {
            log::debug!(target: LOGT, "listen: engine output ended after the kill");
            return;
        }
        // **原因を残す。** 解析や対局の途中で落ちたエンジンの手掛かりは、
        // 直近の出力（assert の文言は stderr に出る）と終わり方しか無い
        log::warn!(
            target: LOGT,
            "{}",
            listen_ended_line(&diagnostics, SETTLE_OUTPUT).await
        );
    });
}

impl UsiProtocol {
    /// 起こしたプロセスを載せ、書き込みの列と読み取りを始める（状態機械は Q0）
    pub fn new(child: EngineChild) -> Self {
        let (writer, jobs) = mpsc::unbounded_channel();
        tokio::spawn(run_writer(child.take_writer(), jobs));

        let shared = Arc::new(Shared {
            core: Mutex::new(Core {
                machine: UsiMachine::new(),
                waiters: HashMap::new(),
                search: None,
            }),
            writer,
            status: watch::channel(Status {
                end: None,
                searching: false,
            })
            .0,
        });
        start_reading(&child, &shared);

        Self {
            child,
            shared,
            runtime_handle: tokio::runtime::Handle::current(),
        }
    }

    /// 届かなくなった理由を文言にする。
    ///
    /// **閉じる理由は1つではない**（読み取りが終わった、書き込みが詰まった、こちらが落とした）。
    /// 利用者に見せる説明も次の手も違うので、1つの文言に潰さない（`usi_machine` の `closed_error`）
    pub(crate) fn cannot_reach(&self) -> EngineError {
        self.shared.cannot_reach()
    }

    /// 手順「名乗り」。`usi` を送り `usiok` までを読み取る。2回目以降は覚えた答えを返す。
    ///
    /// 名前に取得の接頭辞を付けないのは、覚えた値を返すだけでなく、初回はエンジンと往復するため。
    ///
    /// `usiok` を返さないエンジンでここが返らないと、呼び出し元の起動処理ごと
    /// 止まったまま利用者に何も出ない。`timeout` はそのための打ち切り。
    ///
    /// **打ち切っても `EngineError::Timeout` を名乗らない。** 起動できて `usi` にも
    /// 答えない実行ファイルは、待ち直しても同じ時間を使って同じ結果になる。
    /// `TIMED_OUT`（`engine/types.rs`）で始まる文言は「遅かっただけで設定は正しい」
    /// という意味に受け手が使う（F-27）ので、ここが名乗ると**パスを直す導線が出ない**。
    ///
    /// **同時に呼ぶと、後の呼び手は `usi` を書き直さずに同じ答えを待つ**（状態機械の (Q0, R1)）。
    /// 上限はそれぞれの呼び手が自分の `timeout` で持つ
    pub async fn identify(&self, timeout: Duration) -> Result<EngineInfo, EngineError> {
        let (asked, written) = self.shared.step(|core| {
            Ok::<_, EngineError>(match core.machine.identify()? {
                Asked::Done(info) => Asked::Done(info),
                Asked::Waiting(ticket) => Asked::Waiting(core.wait_named(ticket)),
            })
        });
        let answer = match asked {
            Ok(Asked::Done(info)) => return Ok(info),
            Ok(Asked::Waiting(answer)) => answer,
            Err(e) => return Err(self.with_recent_output(e).await),
        };
        if let Err(e) = self.shared.finish(written).await {
            return Err(self.with_recent_output(e).await);
        }
        let answered = match tokio::time::timeout(timeout, answer).await {
            Ok(Ok(answered)) => answered,
            Ok(Err(_)) => Err(self.cannot_reach()),
            Err(_) => Err(EngineError::StartupFailed(
                StartupReason::NoUsiOk { waited: timeout }.into(),
            )),
        };
        match answered {
            Ok(info) => Ok(info),
            Err(e) => Err(self.with_recent_output(e).await),
        }
    }

    /// 手順「準備」。`setoption` を並べた順に送り、`isready` を必ず送って `readyok` を待つ。
    /// 返すのは、その間にエンジンが出した `info string` の文（定跡を読めたかを
    /// `binding::book_load_warning` が判定する）。
    ///
    /// 準備済みでも `isready` を送る。`setoption` を送った後は、評価関数や定跡を読み直させるために
    /// `isready` が要る（やねうら王はそこで読む）。準備済みを理由に飛ばすと、送った設定が効かない。
    ///
    /// - `deadline`: 全体の締切。`setoption` を送る前と `readyok` を待つ前に残りを見る。`None` なら締切なし
    /// - `ready_limit`: `readyok` を待つ上限。締切の残りと小さいほうを使う。`None` なら上限なし
    ///   （検討は、DNN 系の初回の読み込みに上限を置けないので `None` を渡す）。
    ///   **上限は書き込みを渡してから数える。** 締切から時間を借りて呼ぶ側（対局の `START_TIMEOUT`）で、
    ///   書き込みぶんが締切の外に出ないように
    ///
    /// **並べ替えない。** 値の解釈が前の `setoption` に依存するエンジンがあるので、順は呼び手が決める。
    /// 値の検査（件数・長さ・行を壊す文字）は呼び手の段（`setup::validate_options`）が先に済ませる。
    /// 送る途中や `readyok` の前にエンジンが落ちたら、直近の出力を添えて返す。
    /// 待っている最中に `kill_engine` されたら `Cancelled` で返る。
    ///
    /// 途中で future を捨てても、状態機械は `readyok` を待ったまま残る（状態機械の (Q1, L4) で待機へ移る）
    pub async fn prepare(
        &self,
        options: &[SetOptionValue],
        deadline: Option<std::time::Instant>,
        ready_limit: Option<Duration>,
    ) -> Result<Vec<String>, EngineError> {
        if let Some(deadline) = deadline {
            if !options.is_empty() {
                remaining(deadline, "the options were sent")?;
            }
        }
        let limit = match deadline {
            Some(deadline) => {
                let left = remaining(deadline, "the engine said readyok")?;
                Some(ready_limit.map_or(left, |limit| limit.min(left)))
            }
            None => ready_limit,
        };
        let ready_deadline = limit.map(|limit| tokio::time::Instant::now() + limit);
        // 線を壊す値は、状態機械へ頼む前に断る。頼んでから書き込みの列で断ると、
        // 後ろの `setoption` と `isready` だけが線に出る
        for SetOptionValue { name, value } in options {
            refuse_breaking_field("an option name", name)?;
            refuse_breaking_field("an option value", value)?;
        }

        let (asked, written) = self.shared.step(|core| {
            let ticket = core.machine.prepare(options)?;
            Ok::<_, EngineError>(core.wait_prepared(ticket))
        });
        let answer = match asked {
            Ok(answer) => answer,
            Err(e) => return Err(self.with_recent_output(e).await),
        };
        if let Err(e) = self.shared.finish(written).await {
            return Err(self.with_recent_output(e).await);
        }

        let answered = match ready_deadline {
            None => answer.await,
            Some(ready_deadline) => {
                // **残りが尽きたら、待たずに締切として断る。** `timeout(ZERO, _)` は
                // 内側を1回 poll してから `Elapsed` を返すので、そのまま渡すと
                // 「エンジンが `readyok` を返さなかった」で返る——**そのエンジンには
                // 1ナノ秒も与えていない**のに、利用者は評価関数のパスを疑うことになる
                let left = ready_deadline.saturating_duration_since(tokio::time::Instant::now());
                if left.is_zero() {
                    return Err(EngineError::Timeout(format!(
                        "{TIMED_OUT} before waiting for readyok"
                    )));
                }
                match tokio::time::timeout(left, answer).await {
                    Ok(answered) => answered,
                    Err(_) => {
                        return Err(EngineError::Timeout(format!(
                            "{TIMED_OUT} waiting for readyok"
                        )))
                    }
                }
            }
        };
        let texts = match answered {
            Ok(texts) => texts,
            Err(_) => Err(self.cannot_reach()),
        };
        match texts {
            Ok(texts) => Ok(texts),
            Err(e) => Err(self.with_recent_output(e).await),
        }
    }

    /// 手順「値の確認」。`setoption` を1つ送り、続けて `usi` を送って `usiok` を待つ。
    /// 返すのは、その間にエンジンが出した `info string` の文で、`limit` までに `usiok` が
    /// 来なければ `None`。
    ///
    /// **`isready` を使わない。** 評価関数の読み込みが走る。`usi` への答えはオプションの宣言を
    /// 伴うが、宣言は作り直さない（名乗りで覚えたものを使う）。値の解釈は呼び手が行う
    /// （`setup::check_book_path_support`）。`readyok` の前に呼ぶ。
    ///
    /// `limit` までに答えなくても、状態機械は `usiok` を待ったまま残る。続けて準備（`prepare`）を
    /// 頼めば、確認を諦めて準備へ進む（状態機械の (Q2c, R2)）
    pub async fn check_value(
        &self,
        name: &str,
        value: &str,
        limit: Duration,
    ) -> Result<Option<Vec<String>>, EngineError> {
        // 線を壊す値は、状態機械へ頼む前に断る（`prepare` と同じ）
        refuse_breaking_field("an option name", name)?;
        refuse_breaking_field("an option value", value)?;
        let (asked, written) = self.shared.step(|core| {
            let ticket = core.machine.check_value(name, value)?;
            Ok::<_, EngineError>(core.wait_checked(ticket))
        });
        let answer = match asked {
            Ok(answer) => answer,
            Err(e) => return Err(self.with_recent_output(e).await),
        };
        if let Err(e) = self.shared.finish(written).await {
            return Err(self.with_recent_output(e).await);
        }
        let answered = match tokio::time::timeout(limit, answer).await {
            Ok(Ok(answered)) => answered.map(Some),
            Ok(Err(_)) => Err(self.cannot_reach()),
            Err(_) => Ok(None),
        };
        // 落ちたら直近の出力を添える（起動の他の段と同じ。原因は stderr にある）
        match answered {
            Ok(answer) => Ok(answer),
            Err(e) => Err(self.with_recent_output(e).await),
        }
    }

    /// 手順「新しい対局」。`usinewgame` を書く。待つのは書けたことだけ（USI は答えを持たない）。
    /// 準備（`prepare`）の後に呼ぶ。`readyok` の前は積まずに断る（ADR-0016 決定3）
    pub async fn new_game(&self) -> Result<(), EngineError> {
        let (asked, written) = self.shared.step(|core| core.machine.new_game());
        asked?;
        self.shared.finish(written).await
    }

    /// 手順「終局」。`gameover` を書く。待つのは書けたことだけ（USI は答えを持たない）。
    ///
    /// **探索していないエンジンへ呼ぶ。** 探索中・止め待ちの `gameover` は USI が認めないので、状態機械が断る
    pub async fn game_over(&self, kind: GameOverKind) -> Result<(), EngineError> {
        let (asked, written) = self.shared.step(|core| core.machine.game_over(kind));
        asked?;
        self.shared.finish(written).await
    }

    /// エンジンが最後に出した行
    pub fn last_output(&self) -> Option<String> {
        summarize_recent(&self.child.diagnostics().recent_lines())
    }

    /// このプロセスの終わりを見る取っ手
    pub fn end_watch(&self) -> EngineEndWatch {
        EngineEndWatch {
            diagnostics: self.child.diagnostics(),
            status: self.shared.status.subscribe(),
        }
    }

    /// `quit` を送る。**送れたとは限らない。**
    ///
    /// 戻り値を持たないのは、これが礼儀であって保証ではないため。
    /// 落とすことの保証は `kill_engine` の側にある。
    ///
    /// **送る前に印を立てる**（状態機械の R10）。`quit` に答えて終わるエンジンは `kill_engine` より先に
    /// 出力を閉じるので、立てないと「自分で終わった」に見える（`EngineEndWatch`）
    pub async fn quit(&self) {
        log::debug!(target: LOGT, "quit: sending");
        let ((), written) = self.shared.step(|core| core.machine.quit());
        let _ = self.shared.finish(written).await;
    }

    /// プロセスを落とす。2度目以降は何もしない。
    ///
    /// 先に状態機械を閉じ（理由は `Requested`）、待っている手順に答えを渡してから落とす。
    /// 落とすのは待ち手のタスクに頼むだけで（`EngineChild::kill_and_wait`）、stdin のロックも
    /// 書き込みの列も通らない。**書き込みが詰まっていても落とせる。**
    /// 待つのはプロセスが畳まれるのを見届けるところだけで、上限は `KILL_TIMEOUT`。
    ///
    /// `quit` は書かない。行儀よく終わらせたい呼び手は先に `quit` を送る
    /// （`EngineRegistry::terminate`）。
    pub async fn kill_engine(&self) {
        log::info!(target: LOGT, "kill_engine: start");
        let ((), written) = self.shared.step(|core| core.machine.kill());
        if !written.kill {
            return;
        }

        match self.child.kill_and_wait(KILL_TIMEOUT).await {
            KillOutcome::Ended(exit) => {
                log::info!(target: LOGT, "kill_engine: done exit={exit:?}")
            }
            KillOutcome::AlreadyRequested => {
                log::debug!(target: LOGT, "kill_engine: already killed")
            }
            KillOutcome::AlreadyExited => {
                log::info!(target: LOGT, "kill_engine: the process had already exited")
            }
            KillOutcome::WatcherGone => log::warn!(
                target: LOGT,
                "kill_engine: the exit watcher is gone; the process may still be running"
            ),
            KillOutcome::TimedOut => log::error!(
                target: LOGT,
                "kill_engine: timed out waiting for the process to end — it may be left running"
            ),
        }
    }

    /// 起動の失敗に直近の出力を添える（`FailureDetail::last_output`）。理由の欄は変えない。
    /// 添えるのは `StartupFailed` と `CommunicationFailed` だけで、時間切れ（`TIMED_OUT` で
    /// 始まる）には添えない。**既に添えてあれば添え直さない**——先に添えたほうが失敗に近い
    pub(crate) async fn with_recent_output(&self, mut error: EngineError) -> EngineError {
        let slot = match &mut error {
            EngineError::StartupFailed(detail) => &mut detail.last_output,
            EngineError::CommunicationFailed(detail) => &mut detail.last_output,
            _ => return error,
        };
        if slot.is_some() {
            return error;
        }
        let diagnostics = self.child.diagnostics();
        // stderr の読み切りを待つのは、閉じたかプロセスが終わった回だけ。
        // 生きているプロセスの stderr は待っても閉じず、待ちが起動の締切の外に出る
        let ended = self.shared.status.borrow().end.is_some() || diagnostics.exit_now().is_some();
        if ended {
            diagnostics.settle_output(SETTLE_OUTPUT).await;
        }
        *slot = summarize_recent(&diagnostics.recent_lines());
        error
    }
}

/// 出力が終わったエンジンのログの1行。終わり方と直近の出力を載せる。
///
/// **終わり方は見届けてから載せる。** stdout の EOF・stderr の EOF・プロセスの回収は
/// 別々に着くので、stdout が閉じた直後に `exit_now` を覗くと、まだ回収されていないことが
/// ある。stderr の読み切りと並べて `limit` まで待つ。待っても終わらなければ
/// `Waited::TimedOut` が載る（stdout だけを閉じて走り続けている）
async fn listen_ended_line(diagnostics: &ChildDiagnostics, limit: Duration) -> String {
    let ((), exit) = tokio::join!(
        diagnostics.settle_output(limit),
        diagnostics.wait_exit(limit)
    );
    format!(
        "listen: engine output ended exit={exit:?} last={}",
        summarize_recent(&diagnostics.recent_lines()).unwrap_or_default()
    )
}

/// 締切までの残り。尽きていたら時間切れ（`TIMED_OUT` で始まる文言）。
///
/// **`timeout` で包ませず、残りを渡して各段に自分で締めさせる。** 包むと、上限に当たったときに
/// 中の future ごと落ちる——`registry.spawn` が返した直後だと、台帳に載ったプロセスの ID を
/// 誰も知らないまま消える。
pub fn remaining(deadline: std::time::Instant, what: &str) -> Result<Duration, EngineError> {
    let left = deadline.saturating_duration_since(std::time::Instant::now());
    if left.is_zero() {
        return Err(EngineError::Timeout(format!("{TIMED_OUT} before {what}")));
    }
    Ok(left)
}

/// 直近の出力を1行に畳む。失敗の理由とログに添える。
///
/// **stderr の行を先に選ぶ。** 評価関数や共有ライブラリの失敗、assert の文言はそちらに出る。
/// 着いた順の末尾だけを取ると、その後に stdout の `info` が `RECENT_IN_REASON` 行続いた
/// だけで stderr の行が消える。足りない分を stdout の末尾で埋め、選んだ行は着いた順に並べる。
///
/// **エンジンが書いた文字列なので、長さと制御文字を落としてから載せる**
/// （`shown`）。素で載せると、改行を含む行1つで偽のログ行を作れる。
/// stderr の行は `stderr: ` を頭に付ける。
fn summarize_recent(lines: &[(Source, String)]) -> Option<String> {
    let latest = |wanted: Source| {
        (0..lines.len())
            .rev()
            .filter(move |&at| lines[at].0 == wanted)
    };
    let mut picked: Vec<usize> = latest(Source::Stderr).take(RECENT_IN_REASON).collect();
    let room = RECENT_IN_REASON - picked.len();
    picked.extend(latest(Source::Stdout).take(room));
    picked.sort_unstable();

    let tail: Vec<String> = picked
        .into_iter()
        .map(|at| match &lines[at] {
            (Source::Stdout, text) => shown(text, MAX_SUMMARY_LEN),
            (Source::Stderr, text) => format!("stderr: {}", shown(text, MAX_SUMMARY_LEN)),
        })
        .collect();
    (!tail.is_empty()).then(|| tail.join(" / "))
}

/// 起動の失敗の理由に添える直近の行数。多いと理由の本文が読めなくなる
const RECENT_IN_REASON: usize = 3;

/// 実プロセスで確かめるテストの台本（`child::script`）を、プロトコル層に包んで起こす関数。
///
/// 上の段のテストはここを通す。`child` を直に使うと、テストのためだけに
/// `tests/layering.rs` の辺（`may_use` の `child`）を本番にも開くことになる
#[cfg(all(test, unix))]
pub(crate) mod script {
    use super::UsiProtocol;
    use crate::engine::child::script::spawn_script;
    use std::path::Path;

    /// `#!/bin/sh` の台本を `dir` に置いて起こし、プロトコル層に載せる
    pub(crate) async fn spawn_protocol(dir: &Path, body: &str) -> UsiProtocol {
        UsiProtocol::new(spawn_script(dir, body).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 線に出る直前の検査が、`contains_usi_breaking_char` とずれないこと。
    ///
    /// **文字を列挙しない。** 列挙すると、禁止集合を厚くしたときに検査だけが
    /// 薄いまま残る（この repo で2回起きた形）。ASCII を端から流して、
    /// 断る／通すの答えが判断そのものと一致することを見る。
    ///
    /// 見るのは文字列を持つバリアント全部。持たないもの（`Usi` / `Stop` …）は
    /// 混ぜようが無いので通ることだけ確かめる。
    #[test]
    fn the_queue_refuses_what_would_break_the_line() {
        for code in 0u32..=0x7F {
            let ch = char::from_u32(code).expect("ASCII は必ず char になる");
            let poisoned = format!("7g7f{ch}7c7d");
            let should_refuse = contains_usi_breaking_char(&poisoned);

            let carriers = [
                GuiCommand::Position(poisoned.clone()),
                GuiCommand::SetOption(poisoned.clone(), None),
                GuiCommand::SetOption("USI_Hash".to_string(), Some(poisoned.clone())),
            ];
            for command in carriers {
                assert_eq!(
                    check_writable(&command).is_err(),
                    should_refuse,
                    "U+{code:04X} の扱いが `contains_usi_breaking_char` とずれている: {}",
                    cmd_summary(&command)
                );
            }
        }

        for command in [
            GuiCommand::Usi,
            GuiCommand::IsReady,
            GuiCommand::UsiNewGame,
            GuiCommand::Stop,
            GuiCommand::Ponderhit,
            GuiCommand::Quit,
        ] {
            assert!(
                check_writable(&command).is_ok(),
                "文字列を持たないコマンドが断られている: {}",
                cmd_summary(&command)
            );
        }
    }

    fn recent(lines: &[(Source, &str)]) -> Vec<(Source, String)> {
        lines
            .iter()
            .map(|(source, text)| (*source, text.to_string()))
            .collect()
    }

    /// stderr の行は、後から stdout の行が続いても理由から押し出されない。
    /// 評価関数や共有ライブラリの失敗、assert の文言はそちらに出る
    #[test]
    fn a_stderr_line_is_not_pushed_out_by_later_stdout() {
        let lines = recent(&[
            (Source::Stderr, "boom"),
            (Source::Stdout, "info a"),
            (Source::Stdout, "info b"),
            (Source::Stdout, "info c"),
        ]);
        assert_eq!(
            summarize_recent(&lines).as_deref(),
            Some("stderr: boom / info b / info c"),
            "stderr を選ばないか、着いた順に並べていない"
        );
    }

    /// stderr が多ければ stderr の末尾だけ。無ければ stdout の末尾。空なら何も添えない
    #[test]
    fn the_summary_fills_from_the_latest_lines() {
        let many_stderr = recent(&[
            (Source::Stderr, "e1"),
            (Source::Stderr, "e2"),
            (Source::Stdout, "info"),
            (Source::Stderr, "e3"),
            (Source::Stderr, "e4"),
        ]);
        assert_eq!(
            summarize_recent(&many_stderr).as_deref(),
            Some("stderr: e2 / stderr: e3 / stderr: e4")
        );

        let stdout_only = recent(&[
            (Source::Stdout, "a"),
            (Source::Stdout, "b"),
            (Source::Stdout, "c"),
            (Source::Stdout, "d"),
        ]);
        assert_eq!(summarize_recent(&stdout_only).as_deref(), Some("b / c / d"));

        assert_eq!(summarize_recent(&[]), None);
    }

    /// 実プロセスで確かめる。`#!/bin/sh` の台本を置いて起こす
    #[cfg(unix)]
    mod with_a_process {
        use super::*;
        use crate::engine::child::script::spawn_script;
        use std::path::Path;

        async fn protocol_for(dir: &Path, body: &str) -> UsiProtocol {
            UsiProtocol::new(spawn_script(dir, body).await)
        }

        /// 受けた行を `log` に書き、`usi` と `isready` に答える台本
        const LOGS_AND_ANSWERS: &str = r#"while read line; do
  echo "$line" >> log
  case "$line" in
    usi) printf 'id name Logs\nusiok\n' ;;
    isready) echo readyok ;;
  esac
done"#;

        /// `log` が `count` 行になるまで待って返す
        async fn logged_lines(dir: &Path, count: usize) -> Vec<String> {
            for _ in 0..500 {
                let lines: Vec<String> = std::fs::read_to_string(dir.join("log"))
                    .unwrap_or_default()
                    .lines()
                    .map(str::to_string)
                    .collect();
                if lines.len() >= count {
                    return lines;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("{count} 行が書かれない");
        }

        /// 名乗り・準備・新しい対局・終局の手順は、それぞれ自分の行を書く
        #[tokio::test]
        async fn each_procedure_writes_its_own_line() {
            let dir = test_support::dir::temp_dir("protocol-procedures");
            let protocol = protocol_for(&dir, LOGS_AND_ANSWERS).await;
            protocol
                .identify(Duration::from_secs(10))
                .await
                .expect("名乗る");
            protocol.prepare(&[], None, None).await.expect("準備できる");
            protocol.new_game().await.expect("書ける");
            protocol.game_over(GameOverKind::Win).await.expect("書ける");

            assert_eq!(
                logged_lines(&dir, 4).await,
                ["usi", "isready", "usinewgame", "gameover win"]
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 書き込みが詰まっていても落とせる。**`KILL_TIMEOUT` の内に返る。**
        /// 書き込みと kill が同じロックを取り合う形にすると、詰まったときに kill も返らない
        #[tokio::test]
        async fn a_stuck_write_does_not_block_the_kill() {
            let dir = test_support::dir::temp_dir("protocol-stuck-kill");
            // stdin を一切読まない
            let protocol = protocol_for(&dir, "exec sleep 30").await;
            let big = "x".repeat(4 * 1024 * 1024);
            let writing = {
                let shared = Arc::clone(&protocol.shared);
                tokio::spawn(async move {
                    let _ = shared
                        .write(GuiCommand::SetOption("Big".to_string(), Some(big)))
                        .await;
                })
            };
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(
                !writing.is_finished(),
                "詰まっていない（パイプが大きすぎる）"
            );

            tokio::time::timeout(KILL_TIMEOUT * 2, protocol.kill_engine())
                .await
                .expect("書き込みが詰まったまま kill が返らない");
            assert!(
                protocol.child.diagnostics().exit_now().is_some(),
                "落とせていない"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `usiok` の前に終わったエンジンの理由に、stderr の最後の行が載る。
        /// 共有ライブラリが見つからない、評価関数が読めない、はそちらに出る。
        /// 遅れて着く stderr を待つことは `child` のテストが固定する（実時計の余裕に頼らない）
        #[tokio::test]
        async fn a_startup_failure_carries_the_last_stderr_line() {
            let dir = test_support::dir::temp_dir("protocol-stderr");
            let protocol = protocol_for(
                &dir,
                "echo 'dyld: Library not loaded: libomp.dylib' >&2; exit 1",
            )
            .await;

            let error = protocol
                .identify(Duration::from_secs(10))
                .await
                .expect_err("起動が成功している");

            let text = error.to_string();
            assert!(
                text.contains("stderr: dyld: Library not loaded"),
                "理由に stderr が載っていない: {text}"
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `score` の数値が溢れた `info` と UTF-8 でない行があっても読み取りが止まらず、
        /// `usiok` まで読める。`usi` crate の `listen` は、このどちらでもそこから先を全部捨てる
        #[tokio::test]
        async fn an_overflowing_number_does_not_end_the_reading() {
            let dir = test_support::dir::temp_dir("protocol-overflow");
            let protocol = protocol_for(
                &dir,
                r#"printf 'info score cp 99999999999999999999\n\377\376\nid name Overflow\nusiok\n'; exec sleep 30"#,
            )
            .await;

            let info = protocol
                .identify(Duration::from_secs(10))
                .await
                .expect("usiok まで読めていない");
            assert_eq!(info.name, "Overflow");
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `kill_engine` を通さずに `UsiProtocol` を全部捨てても、プロセスは落ちる。
        /// 読み取りの後始末のタスクが `EngineChild` を握っていると、stdout が開いている間
        /// Drop が起きずに残る
        #[tokio::test]
        async fn dropping_the_protocol_ends_the_process() {
            let dir = test_support::dir::temp_dir("protocol-drop");
            let protocol = protocol_for(&dir, "printf 'id name Drop\\nusiok\\n'; exec cat").await;
            protocol
                .identify(Duration::from_secs(10))
                .await
                .expect("読み取りまで始まる");
            let diagnostics = protocol.child.diagnostics();
            drop(protocol);

            assert!(
                matches!(
                    diagnostics.wait_exit(Duration::from_secs(10)).await,
                    crate::engine::child::Waited::Ended(_)
                ),
                "捨てた protocol のプロセスが残っている"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `readyok` を待っている最中に `UsiProtocol` を全部捨てても、プロセスは落ちる。
        /// 待つタスクは `readyok` か出力の終わりかキャンセルでしか抜けないので、
        /// そこに `EngineChild` を握らせると、`readyok` を返さないエンジンでは Drop が起きずに残る
        #[tokio::test]
        async fn dropping_the_protocol_while_waiting_for_readyok_ends_the_process() {
            let dir = test_support::dir::temp_dir("protocol-drop-waiting");
            // `isready` を読んでも `readyok` を返さない（`cat` は受けた行をそのまま返す）
            let protocol = protocol_for(&dir, "printf 'id name Drop\\nusiok\\n'; exec cat").await;
            protocol
                .identify(Duration::from_secs(10))
                .await
                .expect("読み取りまで始まる");
            // `isready` を書いて `readyok` を待っているところまで進める（待ちは上限で諦める）
            let waited = tokio::time::timeout(
                Duration::from_millis(200),
                protocol.prepare(&[], None, None),
            )
            .await;
            let Err(_) = waited else {
                panic!("readyok を返さないのに準備が返った");
            };
            let diagnostics = protocol.child.diagnostics();
            drop(protocol);

            assert!(
                matches!(
                    diagnostics.wait_exit(Duration::from_secs(10)).await,
                    crate::engine::child::Waited::Ended(_)
                ),
                "readyok を待っている間に捨てた protocol のプロセスが残っている"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 出力が終わった後のログに、終わり方が載る。stdout の EOF とプロセスの回収は
        /// 別々に着くので、EOF の直後に覗くだけだと空の回がある。
        ///
        /// **競合なので回数を取る。** 覗くだけの形に戻す変異は1回あたり1割ほどしか当たらず、
        /// 20回ではテスト5回のうち1回すり抜けた
        #[tokio::test]
        async fn the_line_after_the_output_ends_carries_the_exit() {
            for round in 0..100 {
                let dir = test_support::dir::temp_dir("protocol-exit-seen");
                let child = spawn_script(&dir, "echo x; echo e >&2; exit 3").await;
                let (tx, mut rx) = mpsc::unbounded_channel();
                assert!(child.read_stdout(move |event| {
                    tx.send(matches!(event, ReadEvent::Eof)).is_ok()
                }));
                while !rx.recv().await.expect("Eof の前に読み手が消えた") {}

                let line = listen_ended_line(&child.diagnostics(), Duration::from_secs(10)).await;
                assert!(
                    line.contains("exit=Ended(Status("),
                    "{round} 回目: 終わりを見届けずに載せている: {line}"
                );
                assert!(
                    line.contains("stderr: e"),
                    "{round} 回目: stderr の行が載っていない: {line}"
                );
                let _ = std::fs::remove_dir_all(&dir);
            }
        }

        /// `usi` の応答の `option` 行が、`usi` crate の解析を通らないものも含めて定義になる。
        /// 実機のやねうら王の応答（fixture）に、名前に空白を含む1行を足して流す
        #[tokio::test]
        async fn engine_info_carries_every_declared_option() {
            let dir = test_support::dir::temp_dir("protocol-options");
            let fixture = include_str!("../../tests/fixtures/usi/yaneuraou-v900.usi.txt").replace(
                "usiok\n",
                "option name Book Path type string default a b\noption\tname Tab\ttype check default true\nusiok\n",
            );
            std::fs::write(dir.join("usi.txt"), fixture).expect("書けない");
            let protocol = protocol_for(&dir, "read _; cat usi.txt; exec sleep 30").await;

            let info = protocol
                .identify(Duration::from_secs(10))
                .await
                .expect("usiok まで読める");

            assert_eq!(info.options.len(), 41, "落とした option 行がある");
            assert!(
                info.options.iter().any(|o| o.name == "Tab"),
                "タブ区切りの行を落としている"
            );
            let book_file = info
                .options
                .iter()
                .find(|o| o.name == "BookFile")
                .expect("BookFile が無い");
            let crate::engine::types::EngineOptionType::Combo { vars, .. } = &book_file.option_type
            else {
                panic!("combo として読めていない");
            };
            assert_eq!(vars.len(), 10, "`var` の語を選択肢に混ぜている: {vars:?}");
            let spaced = info
                .options
                .iter()
                .find(|o| o.name == "Book Path")
                .expect("空白入りの名前を落としている");
            assert_eq!(spaced.default_value.as_deref(), Some("a b"));
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `usiok` の後に出た `option` 行は、`usi` への応答ではないので定義に入らない
        #[tokio::test]
        async fn option_lines_after_usiok_are_not_declared() {
            let dir = test_support::dir::temp_dir("protocol-options-late");
            std::fs::write(
                dir.join("usi.txt"),
                include_str!("../../tests/fixtures/usi/yaneuraou-v900.usi.txt"),
            )
            .expect("書けない");
            let protocol = protocol_for(
                &dir,
                "read _; cat usi.txt; echo 'option name Late type check default true'; exec sleep 30",
            )
            .await;

            let info = protocol
                .identify(Duration::from_secs(10))
                .await
                .expect("読める");
            assert_eq!(info.options.len(), 39);
            assert!(
                info.options.iter().all(|o| o.name != "Late"),
                "`usiok` の後の行を定義に入れている"
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `identify` を同時に2本呼んでも、どちらも（その後のキャッシュも）全部の定義を持つ
        #[tokio::test]
        async fn concurrent_engine_info_requests_share_every_option() {
            let dir = test_support::dir::temp_dir("protocol-options-join");
            std::fs::write(
                dir.join("usi.txt"),
                include_str!("../../tests/fixtures/usi/yaneuraou-v900.usi.txt"),
            )
            .expect("書けない");
            let protocol = protocol_for(&dir, "read _; cat usi.txt; exec sleep 30").await;

            let (a, b) = tokio::join!(
                protocol.identify(Duration::from_secs(10)),
                protocol.identify(Duration::from_secs(10)),
            );
            let cached = protocol.identify(Duration::from_secs(10)).await;
            for info in [a, b, cached] {
                assert_eq!(info.expect("読める").options.len(), 39);
            }
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q0, L3): `usiok` までに `id name` が無いエンジンは `NO_ID_NAME` で断る。
        ///
        /// **出力が終わった回（`usiok` の前に終わった）と分ける。** 名乗らないエンジンは
        /// 設定の誤り（USI エンジンではないファイル）で、終わったエンジンは起動の失敗。
        /// 呼び手は綴りの先頭で種類を分ける（`start_failure`）
        #[tokio::test]
        async fn an_engine_without_a_name_is_refused_with_no_id_name() {
            let dir = test_support::dir::temp_dir("protocol-no-id-name");
            let protocol =
                protocol_for(&dir, "printf 'id author Nobody\\nusiok\\n'; exec sleep 30").await;

            let error = protocol
                .identify(Duration::from_secs(10))
                .await
                .expect_err("名乗らないエンジンを通している");
            assert!(
                matches!(&error, EngineError::StartupFailed(detail) if detail.reason == StartupReason::NoIdName),
                "`NO_ID_NAME` で断っていない: {error}"
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q3, R8): 探索中に取っ手（`UsiProtocol` と `Search`）を全部捨てても、プロセスは落ちる。
        ///
        /// **台本は探索中に stdin を読まない。** 読んでいると、捨てたときに閉じた stdin で
        /// 台本が自分から終わり、こちらが落としたかどうかを見ないまま通る
        /// （`dropping_the_protocol_ends_the_process` の `cat` はそちらで終わる）。
        /// `Search` を捨てると `stop` を書き終えるタスクが残るが、そのタスクは子プロセスを持たない
        #[tokio::test]
        async fn dropping_the_protocol_during_a_search_ends_the_process() {
            let dir = test_support::dir::temp_dir("protocol-drop-searching");
            let protocol = protocol_for(
                &dir,
                r#"while read line; do
  case "$line" in
    usi) printf 'id name Drop\nusiok\n' ;;
    isready) echo readyok ;;
    go*) echo 'info depth 1 score cp 0 pv 7g7f'; exec sleep 30 ;;
  esac
done"#,
            )
            .await;
            protocol
                .identify(Duration::from_secs(10))
                .await
                .expect("名乗る");
            protocol
                .prepare(&[], None, Some(Duration::from_secs(10)))
                .await
                .expect("準備できる");
            let protocol = Arc::new(protocol);
            let mut search = protocol
                .search("startpos".to_string(), usi::ThinkParams::new().infinite())
                .await
                .expect("探索を始められる");
            // `info` が届けば、台本は `go` を読んで探索（stdin を読まない形）に入っている
            let line = tokio::time::timeout(Duration::from_secs(10), search.next_line())
                .await
                .expect("go の後の info が来ない");
            assert!(
                matches!(line, Ok(Some(SearchLine::Info(_)))),
                "info の前に探索が終わった: {line:?}"
            );
            let diagnostics = protocol.child.diagnostics();
            drop(search);
            drop(protocol);

            assert!(
                matches!(
                    diagnostics.wait_exit(Duration::from_secs(10)).await,
                    crate::engine::child::Waited::Ended(_)
                ),
                "探索中に捨てた protocol のプロセスが残っている"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
    /// 性能の基準線（ADR-0016 決定9 の M1・M2）。**合否は見ない。** 測って印字するだけ。
    ///
    /// `cargo test --lib engine::protocol::tests::baseline -- --ignored --nocapture` で走らせ、
    /// 値は `research/engines/usi-measurements.md` に足す。CI の時間に入れないので `#[ignore]`。
    ///
    /// 測るのは呼び手から見た時間。台本は答えをファイルから `cat` で流すので、書く速さは
    /// 作り直しの前後で変わらず、差は取り次ぎの側に出る
    #[cfg(unix)]
    mod baseline {
        use super::*;
        use crate::engine::child::script::spawn_script;
        use std::time::Instant;

        /// M1 の `info` の行数
        const INFO_LINES: usize = 2000;

        /// `go` を受けたら `go.txt` を、`stop` を受けたら `stop.txt` を流す台本
        const BODY: &str = r#"while read line; do
  case "$line" in
    usi) printf 'id name Baseline\nusiok\n' ;;
    isready) echo readyok ;;
    'go infinite') ;;
    go*) cat go.txt ;;
    stop) cat stop.txt ;;
  esac
done"#;

        async fn ready(dir: &std::path::Path) -> Arc<UsiProtocol> {
            let mut go = String::new();
            for i in 0..INFO_LINES {
                go.push_str(&format!(
                    "info depth {} seldepth {} multipv 1 score cp {} nodes {} nps 1000000 time {} pv 7g7f 3c3d 2g2f 8c8d\n",
                    i % 30 + 1,
                    i % 30 + 3,
                    i % 200,
                    i * 1000,
                    i
                ));
            }
            go.push_str("bestmove 7g7f ponder 3c3d\n");
            std::fs::write(dir.join("go.txt"), go).expect("書けない");
            std::fs::write(dir.join("stop.txt"), "bestmove 7g7f\n").expect("書けない");

            let protocol = UsiProtocol::new(spawn_script(dir, BODY).await);
            protocol
                .identify(Duration::from_secs(10))
                .await
                .expect("名乗る");
            protocol
                .prepare(&[], None, Some(Duration::from_secs(10)))
                .await
                .expect("準備できる");
            Arc::new(protocol)
        }

        /// `search` に `bestmove` が来るまで待つ
        async fn until_bestmove(search: &mut search::Search) {
            loop {
                let line = tokio::time::timeout(Duration::from_secs(10), search.next_line())
                    .await
                    .expect("`bestmove` が来ない")
                    .expect("`bestmove` の前に探索が閉じた")
                    .expect("`bestmove` の後に待っている");
                if matches!(line, SearchLine::BestMove(_)) {
                    return;
                }
            }
        }

        /// 中央値・最小・最大をミリ秒で印字する
        fn report(name: &str, mut samples: Vec<Duration>) {
            samples.sort();
            let ms = |d: Duration| d.as_secs_f64() * 1000.0;
            println!(
                "{name}: n={} median={:.2}ms min={:.2}ms max={:.2}ms",
                samples.len(),
                ms(samples[samples.len() / 2]),
                ms(samples[0]),
                ms(samples[samples.len() - 1])
            );
        }

        /// M1: 手順「探索」を呼んでから（`position` と `go` を書く）、`info` 2000行の後の `bestmove` を呼び手が受け取るまで。5回
        #[tokio::test(flavor = "multi_thread")]
        #[ignore = "性能の基準線。CI の時間に入れない"]
        async fn m1_info_stream_latency() {
            let dir = test_support::dir::temp_dir("baseline-m1");
            let protocol = ready(&dir).await;
            let mut samples = Vec::new();
            for _ in 0..5 {
                let started = Instant::now();
                let mut search = protocol
                    .search(
                        "startpos".to_string(),
                        usi::ThinkParams::new().byoyomi(Duration::from_secs(1)),
                    )
                    .await
                    .expect("探索を始められる");
                until_bestmove(&mut search).await;
                samples.push(started.elapsed());
            }
            report("M1", samples);
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// M2: 探索中に止める手順（`stop`）を呼んでから、答えの `bestmove` を呼び手が受け取るまで。20回
        #[tokio::test(flavor = "multi_thread")]
        #[ignore = "性能の基準線。CI の時間に入れない"]
        async fn m2_stop_to_bestmove_latency() {
            let dir = test_support::dir::temp_dir("baseline-m2");
            let protocol = ready(&dir).await;
            let mut samples = Vec::new();
            for _ in 0..20 {
                let search = protocol
                    .search("startpos".to_string(), usi::ThinkParams::new().infinite())
                    .await
                    .expect("探索を始められる");
                let started = Instant::now();
                let answer = search.stop(Duration::from_secs(10)).await;
                assert!(matches!(answer, search::StopAnswer::Answered), "{answer:?}");
                samples.push(started.elapsed());
            }
            report("M2", samples);
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
