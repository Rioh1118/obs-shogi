use std::collections::VecDeque;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::engine::child::{
    ChildDiagnostics, ChildWriter, EngineChild, KillOutcome, ReadEvent, Source, KILL_TIMEOUT,
};
use crate::engine::option_line::{parse_option_line, MAX_DECLARED_BYTES, MAX_OPTIONS};
use crate::engine::utils::{shown, LogThrottle, MAX_SUMMARY_LEN};
use crate::engine::{types::*, utils::cmd_summary, utils::with_cause};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, watch, Mutex, RwLock};
use usi::{EngineCommand, GuiCommand, IdParams};

const LOGT: &str = "obs_shogi::engine::protocol";

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

/// 出力が終わった、または起動に失敗したエンジンの stderr を読み切るのを待つ上限。
/// stdout と stderr の EOF は別々に着く（`ChildDiagnostics::settle_output`）。失敗の理由に
/// stderr の最後の行を載せるための待ちで、人が待たされていると感じない長さに留める。
/// 出力が終わった後のログでは、終わりを見届けるのもこの上限で並べて待つ（`listen_ended_line`）
const SETTLE_OUTPUT: Duration = Duration::from_millis(200);

/// 解けなかった行を記録する間隔。**1行ずつ書かない。** ノード数が i32 を超えた
/// 探索は `info` を毎秒何行も解けなくなり、1行ずつ書くとログの予算
/// （`LOG_FILE_BUDGET`）を数分で一周させる
const SKIPPED_LINE_LOG_INTERVAL: Duration = Duration::from_secs(10);

/// プロセスを落とした後に送ろうとしたときの文言
const GONE: &str = "engine process has been shut down";
/// 出力が終わったプロセスへ送ろうとしたときの文言
const CLOSED: &str = "engine output has ended; the process cannot be reached";
/// 書き込みが詰まったプロセスへ送ろうとしたときの文言。
/// **`CLOSED` と分ける。** あちらは読み取りが終わった状態で、こちらは
/// 出力は続いているのに stdin を読まなくなった状態。原因も直し方も違う
const STALLED: &str = "the engine stopped reading stdin; the process cannot be reached";
/// USI プロトコル処理層
///
/// **子プロセスの持ち主はこれ1つにする。** `Clone` を持たせず、`EngineChild` を `Arc` に
/// 包まない。`&self` から持ち主を増やせると、それをタスクへ渡した瞬間に「捨てればプロセスも
/// 落ちる」がそのタスクの寿命に縛られる（`readyok` を返さないエンジンでは、待つタスクが
/// 抜けないままプロセスが残る）。共有は `Arc<UsiProtocol>` で、プロセスより長く生きうる
/// タスクへは子プロセスを持たない `Link` か `ChildDiagnostics` を渡す。
pub struct UsiProtocol {
    /// 子プロセスと標準入出力。**書き込み・読み取り・落とす口がそれぞれ別の持ち主**
    /// なので、書き込みが詰まっても落とせる（`engine/child.rs`）。
    child: EngineChild,
    link: Link,
    state: Arc<RwLock<ProtocolState>>,
    listen_active: Arc<Mutex<bool>>,

    /// 読み取りが解いた `option` 行（`option_line::parse_option_line`）。
    ///
    /// **溜めるのは `usi` への応答の `option` 行だけ。** `get_engine_info` が読み取りを始める前に
    /// 開き、読み取りの hook が `usiok` の行を見たところで閉じる。読み取りは1本のタスクが
    /// 行を順に処理するので、境界は行の順序で決まる（`usiok` より前の行は入り終え、後の行は入らない）
    declared: Arc<std::sync::Mutex<DeclaredOptions>>,

    /// `get_engine_info` を1本ずつ通す。2本が同時に `usi` を送ると、1つの `declared` を
    /// 取り合って片方の定義が空になる
    info_gate: Arc<Mutex<()>>,

    /// こちらが落としたか。
    ///
    /// `kill_engine` も `Closed` を立てるので、印が無いと
    /// **こちらが落としたのに「エンジンの出力が終わった」と説明する**。
    killed: Arc<std::sync::atomic::AtomicBool>,

    runtime_handle: tokio::runtime::Handle,
    init_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    init_cancel: Arc<Mutex<Option<CancellationToken>>>,
}

/// エンジンとの繋がりのうち、**子プロセスを持たない側**。書き込みの列と、送れるかを決める状態。
///
/// `readyok` を待つタスク（`start_ready_watch_and_send`）には `UsiProtocol` ではなくこれを渡す。
/// そのタスクは `readyok` か出力の終わりかキャンセルでしか抜けないので、`EngineChild` を
/// 握らせると、`readyok` を返さないまま stdout を開けているエンジンでは `UsiProtocol` を
/// 全部捨てても Drop が起きず、プロセスが落ちない（`EngineChild` の doc）。
#[derive(Clone)]
struct Link {
    listeners: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EngineCommand>>>>,

    /// 書き込みが詰まったか。
    ///
    /// `ReadyState::Closed` は「もう届かない」を1つの値で表すが、**理由が分かれる**。
    /// 読み取りが終わった（EOF）のと、stdin を読まなくなったのとでは、
    /// 利用者にとっての意味も次の手も違う。`Refuse` を返すときに文言を選ぶのに使う。
    stalled: Arc<std::sync::atomic::AtomicBool>,

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

/// 積み置きを捨てたことを記録する1行。
///
/// **理由ごとに書式を分けない。** 掃き出しはここを `PENDING_LIMIT` 回まとめて
/// 通るので、1行の大きさがそのまま予算に効く。書式が2つあると、テストは片方しか
/// 測らないまま「式で縛った」と読める——**長いほうが予算を超えても緑で通る**。
///
/// **捨てる口は全部ここを通す**（`begin_generation` / `discard_pending` も）。
/// どれも `std::mem::take` で最大 `PENDING_LIMIT` 件をまとめて出す、
/// 測る側とまったく同じ形の突発。
///
/// 理由（`why`）は分けたまま持つ。「`readyok` が来なかった」と「flush が折れた」は
/// 後から届きうるかが違う。取りうる値は `DropReason`。
fn dropped_line(cmd: &GuiCommand, why: DropReason) -> String {
    format!(
        "ready: dropping queued cmd={} ({})",
        cmd_summary(cmd),
        why.text()
    )
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
    /// **ここから戻る道は無い。** stdout の読み取りは1回きり（`EngineChild::read_stdout`）で、
    /// 二度と始まらない。復帰の手段はプロセスの再起動しかない。
    Closed,
}
}

closed_set_enum! {
/// 積み置きを捨てた理由。**文言を素の文字列で渡させない。**
///
/// 理由ごとに書式を分けると、予算を測るテストは片方しか測らないまま
/// 「式で縛った」と読める——長いほうが予算を超えても緑で通る。
/// 型にしておくと、理由を増やす人は `ALL` を通って測る側に載る。
#[derive(Debug, Clone, Copy)]
enum DropReason {
    /// `readyok` を待たずにエンジンの出力が終わった。**もう届かない**
    NoReadyok,
    /// 掃き出しの途中で書き込みが失敗した。**届いたかは分からない**
    /// （`Timeout` は「上限内に書き終わらなかった」で、後から届きうる）
    FlushBroke,
    /// 新しい `isready` が始まった。積んでいたのは前の世代のもの
    NewIsready,
    /// エンジンが stdin を読まなくなった
    StdinStalled,
    /// `readyok` を待つのをやめた
    ReadyWaitAborted,
}
}

impl DropReason {
    fn text(self) -> &'static str {
        match self {
            DropReason::NoReadyok => "readyok never came",
            DropReason::FlushBroke => "the flush could not continue",
            DropReason::NewIsready => "a new isready started",
            DropReason::StdinStalled => "the engine stopped reading stdin",
            DropReason::ReadyWaitAborted => "the ready wait was aborted",
        }
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
/// 逆順（落としてから詰まる）も起きうる。`kill_engine` が `killed` を立ててから SIGKILL が
/// 効くまでの間に、先に詰まっていた書き込みが `WRITE_TIMEOUT` に達する回。そのときも
/// `killed` を先に見るので、見せるのは `GONE`。
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
        log::warn!(target: LOGT, "{}", dropped_line(cmd, DropReason::FlushBroke));
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

/// `usi` に `usiok` で答えなかったときの断り文句の頭。
///
/// **呼び出し側が分類し直せるように定数で持つ。** 待てた長さが
/// `USI_OK_TIMEOUT` 満額でないなら、答えなかったのは「そのファイルが USI では
/// ない」ではなく「待てる時間が残っていない」——上限を締切で削る側は、
/// この綴りを目印にして断り文句を差し替える。
pub const NO_USIOK: &str = "the engine did not answer `usi` with `usiok`";

/// `isready` を送ってから `readyok` を待つ上限。
///
/// `usiok` より桁で長いのは、評価関数やハッシュの確保がここで走るため。
/// 短く切ると、重い設定のエンジンが起動できないという形で出る。
pub const READY_TIMEOUT: Duration = Duration::from_secs(120);

/// 書き込みの列に流す1件。
struct WriteJob {
    command: GuiCommand,
    reply: oneshot::Sender<Result<(), EngineError>>,
}

/// 書き込みを1本の列にする理由。
///
/// **投入順＝ワイヤ上の順**であることを、この列だけで保証する。
/// 呼び出しごとにタスクを投げると、どのタスクが先に stdin のロックを取るかは
/// **投入順と無関係**になる。`stop` が `go` を追い越す／flush が直書きに追い越される、
/// が両方そこから出る。
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
    // `Closed` を立てるだけでは、**既に列にあるジョブ**は止まらない。
    let mut stalled = false;

    while let Some(WriteJob { command, reply }) = jobs.recv().await {
        let summary = cmd_summary(&command);

        if stalled {
            let _ = reply.send(Err(EngineError::CommunicationFailed(STALLED.to_string())));
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
                Err(e) => Err(EngineError::CommunicationFailed(with_cause(&e))),
            }
        });

        // **上限はここ。** 待っている側で包むと、前のジョブの処理時間が入る
        let written = match tokio::time::timeout(WRITE_TIMEOUT, write).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => Err(EngineError::CommunicationFailed(format!(
                "write task failed: {e}"
            ))),
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

impl Link {
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
        // **最後の砦。** 呼び出し側でも弾いているが、そちらは入口ごとに書く
        // 検証なので、5箇所目を足した人が素通りするのを止めるものが無い。
        // ここは書き込みの列へ入る唯一の口。
        //
        // **組み立てた1行を見る。** 列が線に出すのは `Display` の
        // 結果そのもの（`command.to_string()` に改行を足したもの）なので、バリアントや
        // フィールドが増えても検査は追随する。フィールドを数え上げると増えない
        check_writable(&command)?;

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

    /// 書き込みが詰まった後の後始末。
    ///
    /// 断る口は2つに分かれる。**既に列にあるジョブ**は `run_writer` の `stalled` が、
    /// **これから `send_command` に入る呼び出し**はここで立てる `Closed` が断る。
    ///
    /// やることは、詰まった印を立てる・`Closed` を立てる・積み置きを捨てるの3つ。
    ///
    /// **このプロセスには二度と書けない。** 詰まった書き込みのタスクが stdin の
    /// ロックを握ったままになる。落とすことはできる（`kill_engine` は stdin の
    /// ロックを待たない）ので、復帰は落として新しいプロセスを起動し直すこと。
    async fn fail_writes(&self) {
        self.stalled
            .store(true, std::sync::atomic::Ordering::Relaxed);
        set_ready_state(&self.ready, ReadyState::Closed);
        log::error!(
            target: LOGT,
            "write: stalled; refusing every later write on this process (→ F-26)"
        );
        self.discard_pending(DropReason::StdinStalled).await;
    }

    /// 積み置きを捨てる。**捨てるものがあったら必ず1行残す。**
    ///
    /// 積んだ時点で呼び出し側には `Ok` が返っているので、ここで黙ると
    /// 「送ったつもりのコマンドがどこにも書かれない」が痕跡なしに起きる
    async fn discard_pending(&self, why: DropReason) {
        let dropped = {
            let mut pending = self.pending.lock().await;
            pending.draining = false;
            std::mem::take(&mut pending.queue)
        };
        for cmd in &dropped {
            log::warn!(target: LOGT, "{}", dropped_line(cmd, why));
        }
    }

    async fn remove_listener(&self, name: &str) {
        self.listeners.write().await.remove(name);
    }
}

impl UsiProtocol {
    pub fn new(child: EngineChild) -> Self {
        let (writer, jobs) = mpsc::unbounded_channel();
        tokio::spawn(run_writer(child.take_writer(), jobs));

        Self {
            child,
            link: Link {
                listeners: Arc::new(RwLock::new(HashMap::new())),
                stalled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                ready: Arc::new(watch::channel(ReadyState::Waiting).0),
                pending: Arc::new(Mutex::new(Pending {
                    generation: 0,
                    queue: VecDeque::new(),
                    draining: false,
                })),
                writer,
            },
            state: Arc::new(RwLock::new(ProtocolState {
                engine_info: None,
                last_command: None,
            })),
            listen_active: Arc::new(Mutex::new(false)),
            declared: Arc::new(std::sync::Mutex::new(DeclaredOptions::default())),
            info_gate: Arc::new(Mutex::new(())),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            runtime_handle: tokio::runtime::Handle::current(),
            init_task: Arc::new(Mutex::new(None)),
            init_cancel: Arc::new(Mutex::new(None)),
        }
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
        // （`EngineChild::read_stdout` は1回きり）。
        // 入れても誰も配らないので、`raw_rx.recv()` が永久に返らない待ちができる
        let state: ReadyState = *self.link.ready.borrow();
        if state == ReadyState::Closed {
            return Err(self.cannot_reach());
        }

        self.link
            .listeners
            .write()
            .await
            .insert(name.clone(), sender);

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
        self.link.remove_listener(name).await;
    }

    /// リスニング開始(内部用)
    async fn start_listening(&self) -> Result<(), EngineError> {
        log::debug!(target: LOGT, "start_listening: begin");

        // 読み取りのタスクと配布の間をチャンネル1本で繋ぐ。
        //
        // 行ごとに `spawn` して配ると、**どのタスクが先に `send` するかが
        // ランタイム任せ**になる。`id name` と `usiok` が入れ替わると
        // `collect_engine_info` が `usiok` で抜けて名前が空になり、
        // エンジンの起動が偶発的に失敗する。
        //
        // 読み取り側は `send` するだけで、`unbounded` なので詰まらない。
        // ロックを待つのは配る側の1本に閉じる。
        let (line_tx, mut line_rx) = mpsc::unbounded_channel::<EngineCommand>();

        // 解けなかった行は配らない（受け手は `EngineCommand` しか読まない）。
        // **読み取りは止めない**——止めると、エンジンが生きたまま以後の出力が全部消える
        let mut skipped = 0u64;
        let mut throttle = LogThrottle::new(SKIPPED_LINE_LOG_INTERVAL);
        // 下の転送タスクへ流す。解けなかった行はログを間引いて捨てる
        let mut forward = move |event: ReadEvent| match event {
            ReadEvent::Line {
                parsed: Some(cmd), ..
            } => line_tx.send(cmd).is_ok(),
            ReadEvent::Line { parsed: None, raw } => {
                skipped += 1;
                if throttle.allow() {
                    log::debug!(
                        target: LOGT,
                        "listen: skipped {skipped} line(s) it could not parse; last: {}",
                        shown(&raw, MAX_SUMMARY_LEN)
                    );
                    skipped = 0;
                }
                true
            }
            // 読み手が抜けると `line_tx` が落ち、下の転送タスクが後始末をする
            ReadEvent::Eof => false,
        };
        let declared = Arc::clone(&self.declared);
        let started = self.child.read_stdout(move |event| {
            // `option` 行は `usi` crate の解析の成否に関係なくここで解く（理由は
            // `option_line.rs` の冒頭）。判定はパーサの入口と同じ（語の区切りはタブも含む）
            if let ReadEvent::Line { raw, .. } = &event {
                lock_declared(&declared).note(raw);
            }
            forward(event)
        });

        // **始められなかったら転送タスクを立てない。** 立てると、落ちた `line_tx` を
        // 「出力が終わった」と読んで生きているエンジンを `Closed` にする
        if !started {
            log::debug!(target: LOGT, "start_listening: already listening");
            return Err(EngineError::AlreadyListening(
                "the engine output is already being read".to_string(),
            ));
        }

        let listeners = Arc::clone(&self.link.listeners);
        let ready = Arc::clone(&self.link.ready);
        // 落とす口を持たない取っ手を渡す。`EngineChild` を渡すと、このタスクが生きている
        // 間（stdout が開いている間ずっと）Drop が起きず、捨てたプロセスが落ちない
        let diagnostics = self.child.diagnostics();
        let killed = Arc::clone(&self.killed);
        self.runtime_handle.spawn(async move {
            while let Some(cmd) = line_rx.recv().await {
                Self::broadcast_to_listeners(Arc::clone(&listeners), cmd).await;
            }

            // 読み取りが終わった。**溜まっていた行を配り切ってから**
            // 「もう来ない」を届ける。落とさないと `raw_rx.recv()` が永久に
            // 返らず、対局は手番のまま無音で止まる。
            //
            // 読み取りの終わり方は1つではない（stdout の EOF、読み取り自体の失敗、
            // 受け手が居なくなった）。**どの終わり方でも `line_tx` は落ちる**ので、
            // ここに置けば終わり方を数え上げずに済む。
            //
            // hook の中で落とすと、まだ配っていない行を捨てることになる。
            // `bestmove` を書いた直後に終了するエンジンでは、その手が
            // 誰にも届かないまま「応答しない」と判定される。
            listeners.write().await.clear();

            // `readyok` を待っている側にも届ける。listeners を落とすだけでは
            // `ensure_ready` は watch を見ているので気付かず、上限まで待つ
            set_ready_state(&ready, ReadyState::Closed);

            if killed.load(std::sync::atomic::Ordering::Relaxed) {
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

        Ok(())
    }

    /// エンジンの出力1行を、購読している全員へ配る。
    ///
    /// 送れなかった相手は表から外す。`UnboundedSender::send` が失敗するのは
    /// 受け手が落ちたときだけなので、外して困ることはない。
    async fn broadcast_to_listeners(
        listeners: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EngineCommand>>>>,
        cmd: EngineCommand,
    ) {
        // **読み取りロックを握ったまま配る。** ループの中は同期の `send` だけで
        // await 点が無く、手放す理由が無い。手放すために表を写すと、
        // **エンジンの出力1行ごと**に表を丸ごと clone することになる
        // （深い読み筋を吐くエンジンでは毎秒数十回）
        let mut gone = Vec::new();
        {
            let guard = listeners.read().await;
            for (name, sender) in guard.iter() {
                if sender.send(cmd.clone()).is_err() {
                    gone.push(name.clone());
                }
            }
        }

        if gone.is_empty() {
            return;
        }
        let mut guard = listeners.write().await;
        for name in gone {
            guard.remove(&name);
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
    /// - `CommunicationFailed`: **2つの意味がある。** 届く口が無い（出力が終わったか、
    ///   書き込みが詰まった。文言で分かれる → `cannot_reach`）ならプロセスを
    ///   起動し直すしかない。積み置きが上限（`PENDING_LIMIT`）に達したのなら
    ///   プロセスは生きていて `readyok` を待っているだけで、**やり直せる**。
    ///   文言で見分けること
    /// - `Timeout`: 上限内に書き終わらなかった。**後から届く可能性がある**。
    ///   ただしこの時点で `fail_writes` が走っているので、後続は全部断られる
    /// - `NotInitialized`: 送る先が無い。列が消えたか、`kill_engine` が
    ///   stdin を閉じた後に書き込みが列を抜けた
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
            let mut pending = self.link.pending.lock().await;
            // `watch::Ref` を `match` のスクルーティニに置かない。
            // 置くと全アームの間じゅう読み取りロックを握り、`set_ready_state` が待つ
            let state: ReadyState = *self.link.ready.borrow();
            match dispatch_for(state, pending.draining, command) {
                Dispatch::Refuse => return Err(self.cannot_reach()),
                Dispatch::Queue => return push_pending(&mut pending, command),
                Dispatch::Send => {}
            }
        }

        if matches!(command, GuiCommand::IsReady) {
            return self.start_ready_watch_and_send().await;
        }

        self.link.write(command.clone()).await
    }

    /// 届かなくなった理由を文言にする。
    ///
    /// **`Closed` は複数の理由で立つ**（`set_ready_state(_, Closed)` の呼び出しを見ること）。
    /// 読み取りが終わった、書き込みが詰まった、こちらが落とした。
    /// 利用者に見せる説明も次の手も違うので、`Closed` の一語に潰さない。
    pub(crate) fn cannot_reach(&self) -> EngineError {
        use std::sync::atomic::Ordering::Relaxed;

        EngineError::CommunicationFailed(
            cannot_reach_text(self.killed.load(Relaxed), self.link.stalled.load(Relaxed))
                .to_string(),
        )
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
        let state: ReadyState = *self.link.ready.borrow();
        let draining = self.link.pending.lock().await.draining;
        if dispatch_for(state, draining, &GuiCommand::Stop) == Dispatch::Refuse {
            return Err(self.cannot_reach());
        }

        let cancelled = {
            let mut pending = self.link.pending.lock().await;
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
        if set_ready_state(&self.link.ready, ReadyState::Waiting) == ReadyState::Closed {
            return Err(self.cannot_reach());
        }

        let cancel = CancellationToken::new();
        *self.init_cancel.lock().await = Some(cancel.clone());

        let (tx, mut rx) = mpsc::unbounded_channel();
        let listener_name = format!("ready_wait_{}_{}", gen, uuid::Uuid::new_v4());
        self.register_listener(listener_name.clone(), tx).await?;

        self.link.write(GuiCommand::IsReady).await?;

        // 非ブロッキングに readyok 待ち。**子プロセスを持たない `Link` だけを渡す**
        // （このタスクは `readyok` を返さないエンジンでは抜けない → `Link` の doc）
        let link = self.link.clone();
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

            link.remove_listener(&listener_name).await;

            // **世代の確認と `Ready` の書き込みを同じロック区間に入れる。**
            // 確認だけして手放すと、その隙に次の `isready` が世代を上げて
            // `Waiting` に落とせる。`abort()` は次の await 点までしか効かないので、
            // 確認を通過済みのこのタスクは構わず `Ready` を書く。
            // 結果、`readyok` が返っていないエンジンに対して `ensure_ready` が
            // 即 `Ok` を返し、まだ評価関数を読んでいる相手へ `position` / `go` が流れる
            let mut pending = link.pending.lock().await;
            if pending.generation != gen {
                return;
            }

            if ready {
                set_ready_state(&link.ready, ReadyState::Ready);
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
                        let mut pending = link.pending.lock().await;
                        if pending.generation != gen {
                            // 次の `isready` が来た。残りは `begin_generation` が残す。
                            // 印はそちらが降ろす
                            break;
                        }
                        match pending.queue.pop_front() {
                            Some(cmd) => Some((cmd.clone(), link.enqueue_write(cmd))),
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
                        Ok(rx) => link.await_write(rx).await,
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
                            let mut pending = link.pending.lock().await;
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
                        "{}",
                        dropped_line(cmd, DropReason::NoReadyok)
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
    ///
    /// **打ち切っても `EngineError::Timeout` を名乗らない。** 起動できて `usi` にも
    /// 答えない実行ファイルは、待ち直しても同じ時間を使って同じ結果になる。
    /// `TIMED_OUT`（`engine/types.rs`）で始まる文言は「遅かっただけで設定は正しい」
    /// という意味に受け手が使う（F-27）ので、ここが名乗ると**パスを直す導線が出ない**。
    ///
    /// **同時に呼ぶと1本ずつ通す**（`info_gate`）。後の呼び手は先の呼び手が返るまで待ち、
    /// その待ちは `timeout` に含まれない。先の呼び手が成功していれば、後の呼び手はキャッシュを返す。
    pub async fn get_engine_info(&self, timeout: Duration) -> Result<EngineInfo, EngineError> {
        // 1本ずつ通す（`info_gate` の doc）。ゲートを取ってからキャッシュを見直す
        let _gate = self.info_gate.lock().await;
        {
            let state = self.state.read().await;
            if let Some(info) = &state.engine_info {
                return Ok(info.clone());
            }
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let listener_name = format!("info_collection_{}", uuid::Uuid::new_v4());

        // 読み取りを始める（`register_listener`）前に開く。後に開くと、`usi` を待たずに
        // 出力するエンジンの `option` 行を、開く前に読んで捨てることがある
        lock_declared(&self.declared).begin();
        if let Err(e) = self.register_listener(listener_name.clone(), tx).await {
            lock_declared(&self.declared).finish();
            return Err(e);
        }
        let sent = self.send_command(&GuiCommand::Usi).await;
        let collected = match sent {
            Ok(()) => tokio::time::timeout(timeout, Self::collect_engine_info(rx))
                .await
                .unwrap_or(Err(EngineError::StartupFailed(format!(
                    "{NO_USIOK} in {timeout:?}; the file may not be a USI engine"
                )))),
            Err(e) => Err(e),
        };

        // 打ち切ったときもリスナーを外す。残すと、以降の `info` が
        // 誰も読まないチャンネルへ配られ続ける。
        self.remove_listener(&listener_name).await;
        // 取り出して閉じる。`usiok` が来なかった回（失敗した回）も閉じないと、
        // 以後の出力の `option` 行を溜め続ける
        let declared = lock_declared(&self.declared).finish();

        let (name, author) = match collected {
            Ok(id) => id,
            Err(e) => return Err(self.with_recent_output(e).await),
        };
        declared.log_problems();
        let engine_info = EngineInfo {
            name,
            author,
            options: declared.options,
        };
        self.state.write().await.engine_info = Some(engine_info.clone());

        Ok(engine_info)
    }

    /// `usiok` までの `id name` / `id author` を集める。オプションの定義は、読み取りの hook
    /// （`start_listening` の `read_stdout` に渡すもの）が `declared` に溜める。
    /// 解き方は `option_line::parse_option_line`
    async fn collect_engine_info(
        mut rx: mpsc::UnboundedReceiver<EngineCommand>,
    ) -> Result<(String, String), EngineError> {
        let mut name = String::new();
        let mut author = String::new();
        let mut saw_usiok = false;

        while let Some(cmd) = rx.recv().await {
            match cmd {
                EngineCommand::Id(IdParams::Name(n)) => name = n,
                EngineCommand::Id(IdParams::Author(a)) => author = a,
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

        Ok((name, author))
    }

    /// `readyok` を受け取り済みか
    pub fn is_ready(&self) -> bool {
        let state: ReadyState = *self.link.ready.borrow();
        state == ReadyState::Ready
    }

    /// `isready` を送り、`readyok` が返るまで待つ。
    ///
    /// 既に ready なら何も送らない。対局の開始前と、局面を送る前にこれを通す。
    /// 待たずに `position` / `go` を送っても `send_command` が ready まで
    /// 積んでくれるが、**積まれたまま返ってこないことを呼び出し側が知れない。**
    ///
    /// **`timeout` は待ちだけでなく `isready` の書き込みも含む。** 待ちにしか
    /// 掛けないと、締切から時間を借りて呼ぶ側（対局の `START_TIMEOUT`）で
    /// 書き込みぶんが締切の外に出る。書き込みで使い切ったら、待たずに
    /// `Timeout` で断る。
    ///
    /// **上限として使えるとは書かない。** 書き込みは列に入るので、先客が
    /// 居ればその処理時間が足される（→ `WRITE_TIMEOUT`）。ここが覆うのは
    /// 「書き込みを渡してから `readyok` を待ち終わるまで」で、実時間の上限ではない。
    pub async fn ensure_ready(&self, timeout: Duration) -> Result<(), EngineError> {
        if self.is_ready() {
            return Ok(());
        }
        self.become_ready(Some(timeout)).await
    }

    /// `isready` を**必ず**送り、`readyok` が返るまで待つ。`limit` が `None` なら上限なし。
    ///
    /// `ensure_ready` と違って準備済みでも送る。`setoption` を送った後は、評価関数や定跡を
    /// 読み直させるために `isready` が要る（やねうら王はそこで読む）。準備済みを理由に
    /// 飛ばすと、送った設定が効かない。
    ///
    /// **`limit` は待ちだけでなく `isready` の書き込みも含む**（`ensure_ready` の doc）。
    /// 待っている最中に `kill_engine` されたら `Cancelled` で返る。
    pub async fn become_ready(&self, limit: Option<Duration>) -> Result<(), EngineError> {
        let deadline = limit.map(|limit| tokio::time::Instant::now() + limit);
        // **`subscribe` は送る前に取る。** 後に回すと、送ってから購読するまでの間に
        // 出力が終わった場合に `Closed` を見落として上限まで待つ
        let mut rx = self.link.ready.subscribe();
        self.send_command(&GuiCommand::IsReady).await?;

        let wait = rx.wait_for(|state| *state != ReadyState::Waiting);
        // `Ref` はこの式の中で読み捨てる。束ねたまま下の await を跨ぐと `Send` でなくなる
        let settled: ReadyState = match deadline {
            Some(deadline) => {
                // **残りが尽きたら、待たずに締切として断る。** `timeout(ZERO, _)` は
                // 内側を1回 poll してから `Elapsed` を返すので、そのまま渡すと
                // 「エンジンが `readyok` を返さなかった」で返る——**そのエンジンには
                // 1ナノ秒も与えていない**のに、利用者は評価関数のパスを疑うことになる
                let left = deadline.saturating_duration_since(tokio::time::Instant::now());
                if left.is_zero() {
                    return Err(EngineError::Timeout(format!(
                        "{TIMED_OUT} before waiting for readyok"
                    )));
                }
                *tokio::time::timeout(left, wait)
                    .await
                    .map_err(|_| EngineError::Timeout(format!("{TIMED_OUT} waiting for readyok")))?
                    .map_err(|_| {
                        EngineError::CommunicationFailed("ready channel closed".to_string())
                    })?
            }
            None => *wait.await.map_err(|_| {
                EngineError::CommunicationFailed("ready channel closed".to_string())
            })?,
        };

        // **上限まで待たずに返る。** 出力が終わっているなら `readyok` は来ない
        if settled == ReadyState::Closed {
            if self.killed.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(EngineError::Cancelled(
                    "the engine was stopped before it became ready".to_string(),
                ));
            }
            return Err(self
                .with_recent_output(EngineError::CommunicationFailed(
                    "engine exited before it became ready".to_string(),
                ))
                .await);
        }

        Ok(())
    }

    /// 現在のリスナー数取得（デバッグ用）
    pub async fn listener_count(&self) -> usize {
        self.link.listeners.read().await.len()
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

        self.link
            .discard_pending(DropReason::ReadyWaitAborted)
            .await;
    }

    /// 世代を上げ、前の世代の積み置きを捨てる。**同じロックの中で行う。**
    ///
    /// 別々にすると、上げてから捨てるまでの間に積まれたぶんが、
    /// 新しい世代のキューに前の世代のコマンドとして残る
    async fn begin_generation(&self) -> u64 {
        let mut pending = self.link.pending.lock().await;
        pending.generation += 1;
        pending.draining = false;
        let gen = pending.generation;
        let dropped = std::mem::take(&mut pending.queue);
        drop(pending);

        for cmd in &dropped {
            log::warn!(target: LOGT, "{}", dropped_line(cmd, DropReason::NewIsready));
        }
        gen
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
    /// 落とすのは待ち手のタスクに頼むだけで（`EngineChild::kill_and_wait`）、stdin のロックも
    /// 書き込みの列も通らない。**書き込みが詰まっていても落とせる。**
    /// 待つのはプロセスが畳まれるのを見届けるところだけで、上限は `KILL_TIMEOUT`。
    ///
    /// `quit` は書かない。行儀よく終わらせたい呼び手は先に `quit` を送る
    /// （`EngineRegistry::terminate`）。
    pub async fn kill_engine(&self) {
        log::info!(target: LOGT, "kill_engine: start");

        // **落とす前に `Closed` を立てる。** 立てないと、落とした後も `ready` が
        // `Waiting` のまま残り、死んだプロセス向けに `position` / `go` が積める
        // （`Ok` が返り、掃く者は永久に来ない）。
        //
        // 印も一緒に立てる。立てないと、以後の `Refuse` が
        // 「エンジンの出力が終わった」と説明する（落としたのはこちら）
        self.killed
            .store(true, std::sync::atomic::Ordering::Relaxed);
        set_ready_state(&self.link.ready, ReadyState::Closed);

        self.abort_init().await;

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

    /// 起動の失敗に直近の出力を添える。**頭は変えない**（`NO_USIOK` のように
    /// 頭の綴りで分類し直す呼び手がいる）。添えるのは `StartupFailed` と
    /// `CommunicationFailed` だけで、時間切れ（`TIMED_OUT` で始まる）には添えない
    async fn with_recent_output(&self, error: EngineError) -> EngineError {
        if !matches!(
            error,
            EngineError::StartupFailed(_) | EngineError::CommunicationFailed(_)
        ) {
            return error;
        }
        let diagnostics = self.child.diagnostics();
        // stderr の読み切りを待つのは、出力が終わったかプロセスが終わった回だけ。
        // 生きているプロセスの stderr は待っても閉じず、待ちが起動の締切の外に出る
        let ended =
            *self.link.ready.borrow() == ReadyState::Closed || diagnostics.exit_now().is_some();
        if ended {
            diagnostics.settle_output(SETTLE_OUTPUT).await;
        }
        let Some(output) = summarize_recent(&diagnostics.recent_lines()) else {
            return error;
        };
        match error {
            EngineError::StartupFailed(why) => {
                EngineError::StartupFailed(format!("{why} (last output: {output})"))
            }
            EngineError::CommunicationFailed(why) => {
                EngineError::CommunicationFailed(format!("{why} (last output: {output})"))
            }
            other => other,
        }
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

/// 読み取りが解いた `option` 行と、解けなかった行の記録。
///
/// **開いている間だけ溜める**（`begin` から、`usiok` の行を見た `close` か `finish` まで）。
/// 閉じた後の `option` 行（`usiok` の後も吐き続けるエンジン）は誰も取り出さないので、溜めずに捨てる
#[derive(Default)]
struct DeclaredOptions {
    open: bool,
    options: Vec<crate::engine::types::EngineOption>,
    /// 溜めた行の合計（バイト）。足すと `MAX_DECLARED_BYTES` を超える行は捨てる
    /// （その後の短い行は入りうる）
    bytes: usize,
    /// 解けなかった行の数。上限なしで数える
    rejected: usize,
    /// 解けなかった最初の行と理由。エンジンが書いた文字列を含むので、理由ごと `shown` を通す
    first_rejected: Option<String>,
    /// 定義の数（`MAX_OPTIONS`）か合計の大きさ（`MAX_DECLARED_BYTES`）を超えて捨てた行の数
    beyond_limit: usize,
    /// `combo` の選択肢の上限を超えて捨てた数
    dropped_vars: usize,
}

impl DeclaredOptions {
    fn begin(&mut self) {
        *self = Self {
            open: true,
            ..Self::default()
        };
    }

    /// 読み取りの hook が1行ごとに渡す。`option` 行を溜め、`usiok` の行で閉じる
    /// （後に続く `option` 行は `usi` への応答ではない）。判定はパーサの入口と同じで、
    /// 語の区切りにタブも含む
    fn note(&mut self, raw: &str) {
        match raw.split_whitespace().next() {
            Some("option") => self.record(raw),
            Some("usiok") => self.close(),
            _ => {}
        }
    }

    /// 以後の行を溜めない。溜めたものは `finish` で取り出すまで残す
    fn close(&mut self) {
        self.open = false;
    }

    /// 溜めたものを取り出して閉じる
    fn finish(&mut self) -> Self {
        std::mem::take(self)
    }

    fn record(&mut self, raw: &str) {
        if !self.open {
            return;
        }
        if self.options.len() >= MAX_OPTIONS || self.bytes + raw.len() > MAX_DECLARED_BYTES {
            self.beyond_limit += 1;
            return;
        }
        match parse_option_line(raw) {
            Ok(parsed) => {
                self.bytes += raw.len();
                self.dropped_vars += parsed.dropped_vars;
                self.options.push(parsed.option);
            }
            Err(e) => {
                if self.first_rejected.is_none() {
                    let reason = shown(&format!("{e}: {raw}"), MAX_SUMMARY_LEN * 2);
                    self.first_rejected = Some(reason);
                }
                self.rejected += 1;
            }
        }
    }

    /// 捨てたものがあれば1行残す。**利用者の画面には、捨てた定義が黙って欠ける**ので、
    /// 開発者が気付ける手掛かりはここしか無い
    fn log_problems(&self) {
        if self.rejected == 0 && self.beyond_limit == 0 && self.dropped_vars == 0 {
            return;
        }
        log::warn!(
            target: LOGT,
            "usi: dropped option lines: {} unreadable, {} beyond the limits, {} combo values; first: {}",
            self.rejected,
            self.beyond_limit,
            self.dropped_vars,
            self.first_rejected.as_deref().unwrap_or("")
        );
    }
}

/// 毒の入ったロックもそのまま取る。`record` の途中で panic して残りうるのは欄どうしの数の
/// 食い違い（`bytes` だけ増えて `options` に無い、など）で、影響は `log_problems` の1行の
/// 数字と、以後の予算の見積りに留まる。定義そのもの（`options` の各要素）が半端になることは無い
fn lock_declared(
    declared: &std::sync::Mutex<DeclaredOptions>,
) -> std::sync::MutexGuard<'_, DeclaredOptions> {
    declared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::engine::utils::{LOG_FILE_BUDGET, MAX_SUMMARY_LEN};

    /// 線に出る直前の門番が、`contains_usi_breaking_char` とずれないこと。
    ///
    /// **文字を列挙しない。** 列挙すると、禁止集合を厚くしたときに門番だけが
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
    ///
    /// **辿れるのは、新しいバリアントを新しい `Kind` へ写したときだけ。**
    /// 既存の `Kind` へ写すとコンパイルも通り、3つとも数が変わらず緑になる。
    /// そこは型では止まらないので、`kind_of` が単射であること
    /// （2つの `GuiCommand` が同じ `Kind` を指さないこと）を下で見る。
    #[test]
    fn commands_covers_every_gui_command() {
        let mut kinds: Vec<Kind> = commands().iter().map(kind_of).collect();
        kinds.sort_unstable();
        let before = kinds.len();
        kinds.dedup();

        // `commands()` の各要素が別々の種類であること。同じ `Kind` へ2つ写ると、
        // 片方の組み合わせが写像のループから静かに落ちる
        assert_eq!(before, kinds.len(), "`commands()` に同じ種類が2つある");

        let mut all = Kind::ALL.to_vec();
        all.sort_unstable();

        assert_eq!(kinds, all, "`commands()` が `GuiCommand` を網羅していない");
    }

    /// 写像の全域を回す。**行を手で選ばない。**
    ///
    /// 手書きの表にすると、書いた人が選んだ組み合わせしか当たらない。
    /// `ReadyState` にバリアントを足したときも、`commands()` に足したときも、
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

    /// 積み置きの掃き出しが、ログの予算を一周させられないこと。
    ///
    /// **`MAX_SUMMARY_LEN` はここから決まる。** 上限があるだけでは足りない
    /// ——上限を大きくしても「上限を超える名前は切られる」テストは通るので、
    /// 予算との関係を式で持つ。
    ///
    /// **1行ではなく掃き出し1回で測る。** `readyok` が来なかったときは
    /// `PENDING_LIMIT` 件がまとめて出るので、1行だけを見るとその倍数ぶん見落とす。
    ///
    /// **見積もらずに、最悪の入力で実際の1行を組んで測る。**
    ///
    /// **測る側を小さくする間違いは、この形の表明では落ちない。**
    /// 上限の不等式なので、`PENDING_LIMIT` を掛け忘れても左辺が小さくなるだけで
    /// 通ってしまう（どんな `SHARE` を選んでも同じ）。掛ける数を増やすなら、
    /// 緩む側に倒れるのを承知で増やす必要がある。
    #[test]
    fn flushing_the_queue_cannot_rotate_the_log() {
        /// 掃き出し1回が予算のうち占めてよい割合の逆数
        const SHARE: u128 = 10;

        // `setoption` の名前は webview から来る。潰されず（制御文字ではない）、
        // UTF-8 でいちばん重い4バイト文字を上限の倍だけ詰める
        let name = "\u{10ffff}".repeat(MAX_SUMMARY_LEN * 2);
        let cmd = GuiCommand::SetOption(name, Some("1".to_string()));

        // **理由を全部回して長いほうで測る。** 1つだけ測ると、もう片方の書式が
        // 予算を超えても緑で通る
        let line = DropReason::ALL
            .iter()
            .map(|why| dropped_line(&cmd, *why))
            .max_by_key(String::len)
            .expect("理由が1つも無い");
        assert!(
            line.chars().filter(|c| c.len_utf8() == 4).count() >= MAX_SUMMARY_LEN,
            "最悪の文字が入口で潰されている。詰める文字を選び直すこと"
        );

        let burst = PENDING_LIMIT as u128 * line.len() as u128;
        assert!(
            burst * SHARE <= LOG_FILE_BUDGET,
            "積み置きの掃き出しが予算の1/{SHARE} を超える\
             （{PENDING_LIMIT} 行 × {} バイト = {burst} バイト）",
            line.len()
        );
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

    /// 閉じた後の `option` 行は溜めない（`usiok` の後も吐き続けるエンジン）
    #[test]
    fn declared_options_are_kept_only_while_open() {
        let mut declared = DeclaredOptions::default();
        declared.record("option name Before type check default true");
        declared.begin();
        declared.record("option name During type check default true");
        let taken = declared.finish();
        declared.record("option name After type check default true");

        let names: Vec<_> = taken.options.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, ["During"]);
        assert!(declared.options.is_empty(), "閉じた後も溜めている");
    }

    /// `usiok` の行で閉じた後は溜めない。溜めたものは `finish` まで残る。
    /// タブ区切りの `option` 行も拾う
    #[test]
    fn declared_options_stop_at_usiok() {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        declared.note("id name X");
        declared.note("option\tname During type check default true");
        declared.note("usiok");
        declared.note("option name After type check default true");
        let names: Vec<_> = declared
            .finish()
            .options
            .into_iter()
            .map(|o| o.name)
            .collect();
        assert_eq!(names, ["During"]);
    }

    /// 予算に入らない長い行を捨てても、その後の短い行は入る
    #[test]
    fn a_line_beyond_the_byte_budget_is_dropped_but_later_short_ones_are_kept() {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        declared.bytes = MAX_DECLARED_BYTES - 100;
        declared.record(&format!(
            "option name Long type string default {}",
            "a".repeat(200)
        ));
        declared.record("option name Short type check default true");
        assert_eq!(declared.beyond_limit, 1);
        let names: Vec<_> = declared.options.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, ["Short"]);
    }

    /// 上限を超えた行も、解けなかった行も数える。解けなかった行は上限なしで数える
    #[test]
    fn declared_options_count_what_they_drop() {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        for i in 0..MAX_OPTIONS + 1 {
            declared.record(&format!("option name O{i} type check default true"));
        }
        for _ in 0..MAX_OPTIONS + 1 {
            declared.record("option name X type slider");
        }
        assert_eq!(declared.options.len(), MAX_OPTIONS);
        // 上限に達した後は、解けない行も上限の側で数える
        assert_eq!(declared.beyond_limit, MAX_OPTIONS + 2);

        let mut unreadable = DeclaredOptions::default();
        unreadable.begin();
        for _ in 0..MAX_OPTIONS + 1 {
            unreadable.record("option name X type slider");
        }
        assert_eq!(unreadable.rejected, MAX_OPTIONS + 1);
    }

    /// 解けなかった理由は、エンジンが書いた語ごと長さと制御文字を落として持つ
    #[test]
    fn a_rejected_line_is_kept_short_and_without_control_characters() {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        declared.record(&format!(
            "option name X type \u{1b}]{}",
            "z".repeat(100_000)
        ));
        let first = declared.first_rejected.expect("理由が残っていない");
        assert!(
            first.chars().count() <= MAX_SUMMARY_LEN * 2 + 1,
            "{}",
            first.len()
        );
        assert!(!first.chars().any(char::is_control), "{first:?}");
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

        /// 書き込みが詰まっていても落とせる。**`KILL_TIMEOUT` の内に返る。**
        /// 書き込みと kill が同じロックを取り合う形にすると、詰まったときに kill も返らない
        #[tokio::test]
        async fn a_stuck_write_does_not_block_the_kill() {
            let dir = test_support::dir::temp_dir("protocol-stuck-kill");
            // stdin を一切読まない
            let protocol = protocol_for(&dir, "exec sleep 30").await;
            let big = "x".repeat(4 * 1024 * 1024);
            let writing = {
                let link = protocol.link.clone();
                tokio::spawn(async move {
                    let _ = link
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
                .get_engine_info(Duration::from_secs(10))
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
                .get_engine_info(Duration::from_secs(10))
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
                .get_engine_info(Duration::from_secs(10))
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
                .get_engine_info(Duration::from_secs(10))
                .await
                .expect("読み取りまで始まる");
            protocol
                .send_command(&GuiCommand::IsReady)
                .await
                .expect("isready を送れる");
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
                .get_engine_info(Duration::from_secs(10))
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
                .get_engine_info(Duration::from_secs(10))
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

        /// `get_engine_info` を同時に2本呼んでも、どちらも（その後のキャッシュも）全部の定義を持つ
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
                protocol.get_engine_info(Duration::from_secs(10)),
                protocol.get_engine_info(Duration::from_secs(10)),
            );
            let cached = protocol.get_engine_info(Duration::from_secs(10)).await;
            for info in [a, b, cached] {
                assert_eq!(info.expect("読める").options.len(), 39);
            }
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 読み取りを2度始めると `AlreadyListening`。**プロセスは生きている**ので
        /// 落とさなくてよい、という区別を呼び手が読む（`send_command` の doc）
        #[tokio::test]
        async fn a_second_listen_is_told_apart() {
            let dir = test_support::dir::temp_dir("protocol-double-listen");
            let protocol = protocol_for(&dir, "exec sleep 30").await;

            protocol.start_listening().await.expect("1度目は始められる");
            let error = protocol
                .start_listening()
                .await
                .expect_err("2度目も始めている");
            assert!(matches!(error, EngineError::AlreadyListening(_)), "{error}");
            assert_ne!(
                *protocol.link.ready.borrow(),
                ReadyState::Closed,
                "始められなかった2度目が、生きているエンジンを閉じている"
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
