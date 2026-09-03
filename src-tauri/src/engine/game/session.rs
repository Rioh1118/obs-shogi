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

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::mpsc::WeakUnboundedSender;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use usi::{GameOverKind, GuiCommand};

use crate::engine::protocol::UsiProtocol;
use crate::engine::protocol::{READY_TIMEOUT, USI_OK_TIMEOUT};
use crate::engine::registry::SPAWN_TIMEOUT;
use crate::engine::registry::{EngineId, EngineProcess, EngineRegistry};
use crate::engine::types::AnalysisResult;
use crate::engine::utils::LogThrottle;

use super::clock::{ClockOutcome, GameClocks};
use super::events::GameEventSink;
use super::search::{run_search, SearchKind, SearchMessage, SearchOutcome, SearchRequest};
use super::types::*;
use crate::engine::protocol::contains_usi_breaking_char;

const LOGT: &str = "obs_shogi::engine::game";

/// 時計を見る間隔。時間切れの検出はこの粒度になる
const TICK: Duration = Duration::from_millis(100);

/// 線に出る1行の長さの上限。
///
/// **`MAX_PLIES` と同じ理由で、同じ経路を守る。** `position` も `setoption` も
/// 1行にまとめて出るので、長さを見ないと `check_writable` の `to_string` で
/// 写しが1本、`push_pending` の `clone` でもう1本作られ、積み置きは
/// `PENDING_LIMIT` 件まで滞留する。書き込みは `WRITE_TIMEOUT` で切れて
/// `fail_writes` が走り、**そのエンジンは以後何も受け付けなくなる**——
/// 出るのは「stdin を読まなくなった」で、長すぎたことは分からない。
///
/// **同じ1行を伸ばせる経路は3つあり、見る場所も3つ。** 手数は `MAX_PLIES`、
/// `setoption` の件数は `MAX_OPTIONS`、`start_sfen` と `setoption` の名前・値の
/// 長さがここ。1つでも欠けると、そこから1行を伸ばせる。
///
/// 8KB にしたのは、平手の SFEN が 60 バイト前後、最長の駒落ちでも 100 バイト未満で、
/// `setoption` の値（評価関数のパス、`USI_Hash` の数値）も収まる幅だから。
const MAX_WIRE_FIELD: usize = 8 * 1024;

/// `setoption` で送れる件数の上限。
///
/// 1件ごとに `WRITE_TIMEOUT` が積まれるので、件数がそのまま起動の待ち時間になる。
/// 実在するエンジンの option は多くて数十件。
const MAX_OPTIONS: usize = 128;

/// `start_game` が返るまでの上限。**1局ぶん全体で見る。**
///
/// 段ごとの上限（`SPAWN_TIMEOUT` / `USI_OK_TIMEOUT` / `READY_TIMEOUT`）を
/// 素直に足すとここを大きく超える（関係は `the_steps_alone_would_overrun_the_start_budget`）。
/// その間 `start_game` は返らず、
/// **フロントには進捗も残り時間も無く、取り消す口も無い**。
/// `EvalDir` を1文字間違えて `readyok` を返さなくなったエンジン——F-27 が
/// 「最も起きやすい」と書いている形——がそこに落ちる。
///
/// **段ごとの上限を消さない。** ここは全体の締切で、段ごとの上限は
/// 「そこで待つのが妥当な長さ」。どちらか一方だと、片方の段が全部を食う。
/// 各段には残りを渡して縮めさせる（`SPAWN_TIMEOUT.min(left)` の形）——
/// 渡さないと、締切が尽きかけていても段は自前の上限を丸ごと使える。
///
/// **厳密な上限ではない。** 段に入る前に残りを見るので、入った段が
/// 締切を跨ぐぶんは超える。**どの段も入口で残りを見る**ので、跨ぎうるのは
/// 書き込み1件ぶん（`WRITE_TIMEOUT`）と、失敗したときの後始末
/// （`registry::shutdown`）。どのコマンドかは書かない——`send_setup` に
/// 1行足すたびに離れたここが嘘になる。
///
/// 90秒にしたのは、評価関数の読み込みが重いエンジン（数十秒）を通し、
/// かつ人が「反応が無い」と判断する前に返るため。
pub const START_TIMEOUT: Duration = Duration::from_secs(90);

/// 1局に積める手数の上限。
///
/// **入口で弾く側の防御。** 溢れはしないが、線に出る1行の長さがここで決まる。
/// `position` は指し手を1行に並べるので、10万手なら1行が 900KB を超え、
/// 組み立てで写しが2本（`check_writable` の `to_string` と `push_pending` の
/// `clone`）作られ、積み置きは `PENDING_LIMIT` 件まで滞留しうる。
/// 書き込みは `WRITE_TIMEOUT` で切れて `fail_writes` が走り、
/// **そのエンジンは以後何も受け付けなくなる**——出るのは
/// 「stdin を読まなくなった」で、長すぎたことは分からない。
///
/// **盤に載る手数の上限**として読むこと。当たり方は入口と裁定で違う。
///
/// - `initial_moves`（`validate_settings`）は `>=` で**断る**。ここから最低1手は
///   指せる必要がある。揃えないと `start_game` が通した設定で1手も指せない局ができる
/// - 裁定（`accept_continue`）で超えたら**終局にする**（`Rule`）。断ると、
///   フロントは一意に固定された列しか返せないのでやり直しても同じ `Err` になり、
///   `RULING_TIMEOUT` 後に「アプリが裁定を返さなかった」で畳まれる——
///   **返しているのに「返さなかった」と棋譜に残る。**
///
/// 2000 にしたのは、相入玉の長手数の棋譜が通る幅だから。足りなくなったら上げてよい。
const MAX_PLIES: usize = 2000;

/// 壁時計が取れないことを記録する最短間隔。
///
/// `clocks_view` は `CLOCK_EMIT_INTERVAL` ごとに通るので、絞らないと
/// 毎秒2行出続ける。
const CLOCK_WARN_INTERVAL: Duration = Duration::from_secs(5);

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

/// エンジンが黙ったまま考えていられる長さ。
///
/// **持ち時間には足さない。** 掛かるのは `since.elapsed()`（手番に入ってからの経過）と
/// `silent_for`（最後の便りからの経過）の**両方**で、`budget_ms` は見ない。
/// 持ち時間に足すのは `HARD_TURN_LIMIT` のほう。
///
/// **時間切れ負けの判定とは別物**で、こちらは**エンジンが黙ったことを見つける**
/// ためにある。`enforce_engine_timeout` が `false`（既定）でも必ず効く。
///
/// これだけの幅があるのは、持ち時間を使い切った後もエンジンは1手指すまで返らないため。
/// 短くすると、正常に長考しているエンジンを故障と呼ぶ。
const SEARCH_GRACE: Duration = Duration::from_secs(30);

/// 持ち時間を使い切った**後**に、エンジンへさらに許す上限。
///
/// **持ち時間に足す。** 絶対の値にすると、持ち時間が長い対局で
/// **時計より先に**発火する——60分の持ち時間で15分の長考をしたエンジンが
/// 故障扱いになる。
///
/// **黙っていなくても超えたら落とす。** 沈黙だけを条件にすると、
/// `info` を出し続けながら `bestmove` を返さないエンジンに上限が1つも残らない
/// （`enforce_engine_timeout` が偽なら時間切れも掛からず、`run_search` にも締切は無い）。
/// フロントには読み筋だけが流れ続け、利用者が中断を押すまで対局が終わらない。
///
/// **これは「1手に待つ上限」ではない。** 実際に待つのは `budget_ms`＋これで、
/// `budget_ms` は `remaining_ms + byoyomi_ms`（`clock.rs`）。
///
/// **`remaining_ms` は育つ。** フィッシャーでは着手のたびに `increment_ms` が
/// 積まれる（`SideClock::consume`）ので、「10分＋10秒加算」でも300手指せば
/// 45分近くまで伸びる。`TimeLimit::validate` が見るのは1欄ずつの上限だけで、
/// 合計も累積も見ない。つまり**待つ長さは設定と手数で動く**。
///
/// `enforce_engine_timeout` が偽なら時間切れも掛からないので、その間
/// 固まったエンジンは落ちない。短くしたいなら `enforce_engine_timeout` の既定を
/// 変えるか、ここを短くすること（`MAX_TIME_MS` は1欄ごとの上限なので効かない）。
///
/// 解析側の `MAX_THINK_TIME` とは**別の約束**。あちらは席を握る時間の上限で、
/// こちらは持ち時間を使い切った後の猶予。値が同じなのは偶然なので縛らない。
pub const HARD_TURN_LIMIT: Duration = Duration::from_secs(600);

/// 手番側がエンジンか。**`bool` を裸で渡さない。**
///
/// `stalled_turn` は同じ型の真偽を2つ並べて受けるので、裸だと**入れ替えても
/// コンパイルが通る**。入れ替えると、`info` を出していないエンジンで
/// 「エンジンである」が偽になり、`Running` の枝に一切入らない——
/// 沈黙の腕だけでなく `budget + HARD_TURN_LIMIT` の最後の上限も消える。
struct IsEngine(bool);

/// そのエンジンがこの局で `info` を1行でも出したことがあるか。→ `IsEngine`
struct HasSpoken(bool);

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
/// **持ち時間を過ぎたことだけでは落とさない。** `enforce_engine_timeout` が
/// 偽のまま持ち時間が尽きると `budget_ms` は 0 に張り付くので、持ち時間だけを
/// 条件にすると `HARD_TURN_LIMIT` の腕が**そこから即座に効き始める**。
/// 利用者は「時間切れを成立させない」と指定したのに、時計が尽きた
/// `HARD_TURN_LIMIT` 後に必ず負けることになる。
/// 黙っていること（`silent_for`）を条件に足す。**持ち時間とは無関係に見る**
/// ——黙っているかどうかは、持ち時間が残っているかとは別の話。
///
/// **先読み中の側はここへ来ない。** `on_tick` が渡すのは
/// `Phase::Thinking { side }` の側だけで、先読みしている側は評価の対象に入らない
/// （先読みは `ponderhit` か `stop` が来るまで走ってよい）。
/// `TurnClock` は側を持たないので、外しているのは渡す側。
fn stalled_turn(
    clock: TurnClock,
    budget_ms: u64,
    silent_for: Duration,
    thinking_is_an_engine: IsEngine,
    has_spoken: HasSpoken,
) -> Option<Stall> {
    let (thinking_is_an_engine, has_spoken) = (thinking_is_an_engine.0, has_spoken.0);
    // 畳み待ちは探索を止めた側の話なので、対局者の種別に関わらず見る
    if let TurnClock::Settling(since) = clock {
        return (since.elapsed() >= SETTLE_TIMEOUT).then_some(Stall::NotStopping);
    }

    // **人間には掛けない。** 人間が長考しても「応答しない」ではないし、
    // `info` を出さないので沈黙条件は常に満たされる。人間の手番を締めるのは
    // 時計（`has_expired`）で、そちらは種別に関わらず成立する
    if !thinking_is_an_engine {
        return None;
    }

    let TurnClock::Running(since) = clock else {
        return None;
    };
    let budget = Duration::from_millis(budget_ms);

    // 持ち時間を使い切った後の上限。**喋り続けていても超えたら落とす。**
    // これが無いと、`info` を出しながら `bestmove` を返さないエンジンに
    // 上限が1つも残らない（`enforce_engine_timeout` は既定で偽）
    if since.elapsed() >= budget + HARD_TURN_LIMIT {
        return Some(Stall::NotAnswering);
    }

    // **黙っていることは持ち時間と無関係の信号。** ここに持ち時間を足すと、
    // 持ち時間の長い対局で初手から固まったエンジンが、持ち時間ぶん検出されない
    // （フロントには時計だけが流れ続け、正常な長考と区別が付かない）。
    //
    // ただし**喋る実装だと分かっているエンジンにだけ掛ける。** USI は `info` を
    // 義務にしていないので、1行も出さない実装は正常に読んでいても黙って見える。
    // 区別せずに掛けると、そういうエンジンは**正常な31秒目に必ず負ける**
    // ——棋譜に英文の故障理由が残り、利用者に無効化する手段が無い。
    // 出したことが無いエンジンを押さえるのは上の `budget + HARD_TURN_LIMIT` だけになる。
    //
    // 手番に入って `SEARCH_GRACE` 経ってから見るのは、`go` を出した直後の
    // 一瞬を「黙っている」と数えないため。
    if has_spoken && since.elapsed() >= SEARCH_GRACE && silent_for >= SEARCH_GRACE {
        return Some(Stall::NotAnswering);
    }
    None
}

/// 先後。
///
/// **数を式に直書きしない。** 「`gameover` を最大2回通す」のような
/// 見積もりが散文にしか無いと、番人の上限を式で固定するときに
/// 1件ぶんしか見ない値が通る（実際にそうなっていた）。
const SIDES: [Side; 2] = [Side::Black, Side::White];

/// 手番が進まない理由。**エンジンの状態が違うので潰さない。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stall {
    /// `stop` を出したのに畳み終わらない
    NotStopping,
    /// `go` を出したのに `bestmove` が返らない
    NotAnswering,
}

impl Stall {
    /// 棋譜と画面に残す説明。
    ///
    /// **この文字列を書く場所はここ1箇所。** 同じ物理状態を別の検出器で
    /// 見た側（`SearchOutcome::StopTimedOut` と `Handover::Unusable`）も
    /// ここを通す。手で写すと、どちらの番人が先に当たったかで綴りが変わり、
    /// `GameOverReason` が5経路を1値に潰している以上、**残る差が冠詞だけ**に
    /// なる。腕を足したときに写しを数え直させられないのも同じ理由。
    fn detail(self) -> &'static str {
        match self {
            Stall::NotStopping => "the engine did not stop searching in time",
            Stall::NotAnswering => "the engine did not answer in time",
        }
    }
}

/// 手番に入ったまま `go` を出せずにいられる上限。
///
/// **`stalled_turn` の `Settling` の枝だけが使う。** `Running` の枝は同じ関数が
/// `budget + HARD_TURN_LIMIT` と `SEARCH_GRACE`（沈黙）の2本で見る。番人は分かれていない。
/// 畳み待ちの間は時計が動かないので、時間切れの判定には掛からない。
/// ここが無いと、`stop` の書き込みが詰まったときに対局が無音のまま固まる。
///
/// `search.rs` の `SEARCH_STOP_GRACE` ＋書き込みの上限（`WRITE_TIMEOUT`）より長く取る
/// （関係は `the_watchdogs_are_ordered` が式で見る）。
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
/// **1回の畳みの最悪値より長く取る。** 畳みは `stop` の書き込み
/// （列の中で `WRITE_TIMEOUT`）＋ 捨てる `bestmove` を待つ `SEARCH_STOP_GRACE`。
/// 短いと、`stop` の直後に1秒ほど stdin を吸わなかっただけの正常な対局で
/// 待ち切れず、「エンジンが応答しない」の警告が出て探索の足元でプロセスが落ちる。
/// **上と同じ関係を `the_watchdogs_are_ordered` が固定する。**
///
/// `abort` はこれとは別枠。合計の予算にすると、`abort` が使い切ったぶんだけ
/// 畳み待ちが縮む（`abort` は `finish` の中で、探索していない側それぞれへ
/// `gameover` を書く——`SIDES` ぶん直列に待ちうる）。
pub const CLOSE_IDLE_TIMEOUT: Duration = Duration::from_secs(10);

/// `close` が `abort` の応答を待つ上限。
///
/// **畳み待ちと分ける。** 1つの予算を分け合うと、`abort` に時間を取られた
/// ぶんだけ畳み待ちが縮み、正常な畳みを待ち切れなくなる。
///
/// 下限は「列の先客1件＋`SIDES` ぶんの `gameover`」。
/// `the_watchdogs_are_ordered` が式で持つ。
pub const CLOSE_ABORT_TIMEOUT: Duration = Duration::from_secs(8);

/// 畳まれたかを聞き直す間隔。
///
/// **聞きに行くのは、畳まれたことを知らせる口が無いため。** `Activity` が
/// `Idle` に戻るのは `run_loop` の中で、そこから外へ通知する経路を持っていない。
///
/// 50ms は `TICK`（100ms）より細かく、`close_game` の応答に足す遅れが
/// 人に分からない範囲。細かくするほど `SearchesIdle` が `Tick` と同じ
/// キューに並ぶので、`run_loop` を要求で埋めない上限でもある
/// （回数は `CLOSE_IDLE_TIMEOUT` をこれで割ったぶん。**数を書かない**——
/// 予算を動かしたときに、離れたところが嘘になる）。
const CLOSE_POLL: Duration = Duration::from_millis(50);

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
    /// `setoption` → `isready` → `readyok` → `usinewgame` **まで**を待つ。
    /// **呼び出し側は USI の段取りを知らない。**
    ///
    /// **最初の `position` / `go` は待たない。** 別タスクで走るので、その失敗は
    /// 戻り値ではなく `game-event` の `over { reason: engineFailure }` で届く。
    /// `Ok` は「エンジンが `usinewgame` まで応じた」であって
    /// 「考え始めた」ではない。
    ///
    /// **購読は呼ぶ前に張ること。** 最初の `TurnChanged` と `start_search` は
    /// この関数が返る前に走るので、`Ok` を待ってから張ると必ず取りこぼす
    /// （`bestmove resign` を即返すエンジンでは `MoveDecided` と `Over` も落ちる）。
    ///
    /// **`GameId` もまだ返っていない。** 受け手は `gameId` で振り分けられないので、
    /// 解決するまで溜めて後から振り分け直すことになる（→ `startGame` の TSDoc）。
    /// ここで ID を先に返す形にすると、台帳へ載る前の対局に操作が届く。
    ///
    /// **待たせる長さは `START_TIMEOUT` で決まる。** 2体ぶんの段ごとの上限を
    /// 足した値ではない。取り消す口は無いので、ここが唯一の歯止め。
    /// 段に入る前に残りを見る作りなので、跨いだ段のぶんは少し超える。
    pub async fn start(
        registry: &EngineRegistry,
        events: Arc<dyn GameEventSink>,
        settings: GameSettings,
    ) -> Result<GameSession, String> {
        validate_settings(&settings)?;
        let side_to_move = derive_side_after(&settings, settings.initial_moves.len());

        let deadline = Instant::now() + START_TIMEOUT;
        let (engine_ids, engines) = spawn_players(registry, &settings, deadline).await?;

        let id = GameId::new(uuid::Uuid::new_v4().to_string());
        let (tx, rx) = mpsc::unbounded_channel();
        let [black_engine, white_engine] = engines;

        let mut runner = Runner {
            id: id.clone(),
            events,
            clocks: GameClocks::new(settings.black_time, settings.white_time),
            players: [
                Player::new(settings.black.clone(), black_engine),
                Player::new(settings.white.clone(), white_engine),
            ],
            moves: settings.initial_moves.clone(),
            settings,
            phase: Phase::Thinking { side: side_to_move },
            turn_clock: TurnClock::Running(Instant::now()),
            last_progress: Instant::now(),
            clock_warn: Mutex::new(LogThrottle::new(CLOCK_WARN_INTERVAL)),
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
    ///
    /// **`Ok` は「次の手番が始まった」とは限らない。** 手数が `MAX_PLIES` を
    /// 超えていたら終局にして `Ok` を返す（理由は `MAX_PLIES` の doc）。
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

    /// 上限を掛けて中断する。**閉じる経路はどちらもここを通る。**
    ///
    /// `abort` は `run_loop` の応答を待つので、そこが書き込みで詰まっていると
    /// 返らない。上限が要るのはそのため。
    ///
    /// **失敗は2通りで、意味が正反対。** 潰すとログから区別が付かない——
    /// 「もう止まっている」と「止められていない」が同じ1行になる。
    ///
    /// 分類を2箇所に書かない。書くと、`abort` の失敗の種類を増やしたときに
    /// 片方だけ増える。古いまま残るのは `GameManager::close` の側で、
    /// そこは `Arc` が2本要るのでテストが踏みにくい。
    pub(super) async fn abort_within_budget(&self) {
        match tokio::time::timeout(CLOSE_ABORT_TIMEOUT, self.abort()).await {
            Ok(Ok(())) => {}
            // セッションのタスクが先に居なくなった。もう止まっている
            Ok(Err(e)) => log::debug!(target: LOGT, "close: nothing to abort: {e}"),
            // `run_loop` が詰まっている。止められていない
            Err(_) => log::warn!(target: LOGT, "close: abort timed out; the session is stuck"),
        }
    }

    /// 対局を閉じ、使っていたエンジンを落とす。
    ///
    /// **終局しただけではプロセスは落ちない。** `gameover` の後に
    /// `usinewgame` で指し直せるようにしてある（USI がそういう作りのため）。
    /// 呼ばないとプロセスが残る。
    pub async fn close(self, registry: &EngineRegistry) {
        // 「止める → 畳まれるのを**待つ** → 落とす」の順。
        // 待つ理由と上限の理由はどちらも `CLOSE_IDLE_TIMEOUT` に書いてある
        self.abort_within_budget().await;

        // **`abort` の後から測る。** 前から測ると、`abort` に使ったぶんだけ
        // 畳み待ちが縮み、正常に畳んでいるエンジンを待ち切れなくなる
        let deadline = Instant::now() + CLOSE_IDLE_TIMEOUT;

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
            // 「畳まれなかった」と「`searches_idle` の応答が `CLOSE_IDLE_TIMEOUT` 内に
            // 返らなかった」の両方でここに来る。締切は `abort` の**後**から測るので、
            // 1度も尋ねずに抜けることは無い
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
    /// このエンジンが `info` を1行でも出したことがあるか。**局を通じて残る。**
    ///
    /// **沈黙を信号として使ってよいかの判定に要る。** USI は `info` を義務に
    /// していないので、1行も出さない実装（詰将棋ソルバを対局者に挿す、
    /// 深さが変わったときだけ出すエンジン）は正常に読んでいても黙って見える。
    /// 出したことがあるエンジンについてだけ、黙ったことを故障と読む。
    has_spoken: bool,
}

impl Player {
    fn new(spec: PlayerSpec, engine: Option<Arc<EngineProcess>>) -> Self {
        Self {
            spec,
            engine,
            activity: Activity::Idle,
            has_spoken: false,
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
    /// 出来事の宛先。**具象（`tauri::AppHandle`）に依存しない。**
    ///
    /// 依存すると、対局の状態機械を回すのに Tauri のランタイムが要る。
    /// テストは宛先を持てず、`Over` を出したか `TurnChanged` に何を載せたかを
    /// 確かめられない（→ `game::events`）。
    events: Arc<dyn GameEventSink>,
    settings: GameSettings,
    players: [Player; 2],
    clocks: GameClocks,
    /// 指し手列の**写し**。権威はフロントにあり、`continue_game` が上書きする
    moves: Vec<String>,
    phase: Phase,
    turn_clock: TurnClock,
    /// エンジンから最後に便りがあった時刻。**進むのは2箇所。**
    ///
    /// - `begin_turn`: 手番が始まった。`turn_clock` と対で動かす
    /// - `on_search_info`: 手番側から `info` が届いた
    ///
    /// **どちらも消せない。** `begin_turn` だけだと手番開始からの経過になり、
    /// `silent_for` が `since.elapsed()` と同じ値になって沈黙条件が意味を失う
    /// （正常に読んでいるエンジンが `SEARCH_GRACE` で落ちる）。
    /// `on_search_info` だけだと、前の手番の便りが残って締切がずれる。
    last_progress: Instant,
    next_req: u64,
    last_clock_emit: Instant,
    /// 壁時計が取れないことを記録する枠。
    ///
    /// **周期的に呼ばれる場所の warn は絞る。** `emit` の失敗と違い、
    /// 条件が満たされている間ずっと出続ける。
    clock_warn: Mutex<LogThrottle>,

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
            Command::Search(SearchMessage::Info { side, req, result }) => {
                self.on_search_info(side, req, result)
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

        // **`Ok` は「`MoveDecided` が出た」の意味にする。** 採らなかったのに
        // `Ok` を返すと、`await` の後に棋譜へ積む素直な実装が、終局後の棋譜に
        // 指されていない手を1手足す。しかも `finish` は `Over` を先に流すので、
        // フロントには終局が先に届き、その後で `Ok` が解決する
        if self.decide_move(side, usi_move, None).await {
            return Ok(());
        }
        Err("the clock ran out before the move landed".to_string())
    }

    /// 裁定「続く」。`moves` で写しを上書きして次の手番を始める。
    /// **ただし手数が `MAX_PLIES` を超えていたら終局にして `Ok` を返す。**
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
        // 確かめないと、食い違いに気付く経路がどこにも無くなる。
        //
        // **末尾だけを見ても足りない。** 手が決まった直後という文脈では、
        // 正しい列は「いまの写し＋決まった手」の1つに定まる。末尾と長さの偶奇だけを
        // 見ていると、`initial_moves` を偶数個持つ途中局面で「対局開始以降の手だけ」を
        // 渡された場合が全部通り、写しが黙って短い列に差し替わる。次の `go` は
        // **根の局面に途中の手を継ぎ足した別局面**を送ることになり、エンジンは
        // そこの合法手を返し、フロントは現局面で非合法と裁定する——
        // エンジンが指してもいない手で反則負けする。
        if moves.len() != self.moves.len() + 1 || moves[..self.moves.len()] != self.moves[..] {
            return Err(format!(
                "move list is not the current one plus {usi_move} \
                 (have {} moves, got {})",
                self.moves.len(),
                moves.len()
            ));
        }
        if moves.last() != Some(&usi_move) {
            return Err(format!(
                "move list does not end with the move just decided ({usi_move})"
            ));
        }
        let next = last_mover.opponent();
        // 接頭辞まで見た後なので、これは冗長。**残す。** 手番の導出
        // （`derive_side_after`）が壊れたときに、ここが先に落ちる
        if derive_side_after(&self.settings, moves.len()) != next {
            return Err(format!(
                "move list length {} does not put {next:?} to move",
                moves.len()
            ));
        }
        validate_usi_move(&usi_move)?;

        // **上限に達したら終局にする。断らない。** 断ると、フロントは
        // 接頭辞と長さで一意に固定された列しか返せないのでやり直しても同じ `Err` になり、
        // `RULING_TIMEOUT` 後に `Aborted { "no ruling came back from the app" }` で
        // 畳まれる——**返しているのに「返さなかった」と棋譜に残る。**
        // 上限は GUI 側の都合なので、理由も GUI 側のもの（`Rule`）として持つ。
        //
        // **検算の後に置く。** 前に置くと、食い違った長い列——別の対局の指し手を
        // 渡してしまった、など——が接頭辞を1手も見られないまま「上限に当たった」として
        // 終局する。4手で終わった対局に「最大手数で終局」と棋譜が残り、
        // `Err` も出ないので食い違いに気付く経路が無くなる。
        if moves.len() > MAX_PLIES {
            self.finish(GameResult {
                winner: None,
                reason: GameOverReason::Rule,
                detail: Some(format!("the game reached the {MAX_PLIES} ply limit")),
            })
            .await;
            return Ok(());
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

    /// 探索の途中経過。**先読みを落とすのはここ1本。**
    ///
    /// 探索タスク側で落とすと、`ponderhit` で本番へ昇格した探索が
    /// 先読み扱いのまま残る（タスクは起動時の値を握って走る）。
    /// 手番かどうかはこちらが常に持っているので、判断はここに置く。
    fn on_search_info(&mut self, side: Side, req: u64, result: AnalysisResult) {
        // **落とす前に記録する。** 見たいのは「このエンジンは `info` を出す実装か」
        // で、その行がいまの局面のものかとは別の話。先読み中の1行でも、
        // 打ち切った探索の1行でも、出す実装であることの証拠になる
        self.player_mut(side).has_spoken = true;

        // 先読み中の側は手番ではない。手番が変わった後に届いた読み筋も同じで、
        // どちらも「いまの局面のものではない」で落ちる
        if !self.is_to_move(side) {
            return;
        }

        // **世代も見る。** 手番は合っていても、打ち切った探索が cancel と
        // 同時に吐いた `info` は別の局面のもの。採ると、盤に無い局面
        // （外れた先読み手を指した後）の評価値と読み筋が一瞬出る
        if !self.is_current_search(side, req) {
            return;
        }

        // 便りがあった。黙っていないので `stalled_turn` の締切を先送りする
        self.last_progress = Instant::now();
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
                    detail: Some(Stall::NotStopping.detail().to_string()),
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
                self.begin_turn();
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
                // `SearchOutcome::StoppedCleanly` は `Searching` からも来る
                // （`finish` は `Stopping` へ移さずに cancel するため）。
                // **`GameOverReason::Aborted` とは別物。**
                // それがここへ落ちないのは、
                // **`Phase::Over` の早期 return が先にある**から。
                // `Over` の判定をこの `match` より後ろへ動かすと、終局時に
                // 返ってきた `bestmove` がこの空アームに吸われ、探索していた
                // エンジンへ `gameover` が飛ばなくなる（不変条件3 の違反）
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
                // エンジン側には返す相手が居ない。採らなかったときは `finish` が
                // `Over` を流しているので、ここで足すことは無い
                let _taken = self.decide_move(side, usi, ponder).await;
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
                if let Some(stall) = stalled_turn(
                    self.turn_clock,
                    self.clocks.budget_ms(side),
                    self.last_progress.elapsed(),
                    IsEngine(self.player(side).spec.is_engine()),
                    HasSpoken(self.player(side).has_spoken),
                ) {
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

    /// 手が決まった。**ここでは進めない。** 時計を締めて裁定待ちへ入る。
    ///
    /// **採らなかったら `false`**（時計が先に尽きたとき）。
    ///
    /// 戻り値を捨てると、`submit_game_move` が指されなかった手に `Ok` を返す。
    /// 呼び出し側は `MoveDecided` が出たものとして棋譜に積むので、
    /// **終局後の棋譜に指されていない手が1手増える。**
    async fn decide_move(
        &mut self,
        mover: Side,
        usi_move: String,
        ponder_move: Option<String>,
    ) -> bool {
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
            return false;
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
        true
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
                        self.begin_turn();
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
                self.begin_turn();
                self.start_search(side);
            }
            Handover::Unusable => {
                log::error!(target: LOGT, "handing the turn to an unresponsive engine side={side:?}");
                // `Activity::Unresponsive` を立てるのは `StopTimedOut` の枝だけなので、
                // ここへ来た側の物理状態は「`stop` に応じなかった」で同じ
                self.finish(GameResult {
                    winner: Some(side.opponent()),
                    reason: GameOverReason::EngineFailure,
                    detail: Some(Stall::NotStopping.detail().to_string()),
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
    /// - `Unresponsive` — **ここへは来ない。** `hand_turn_to` が `Handover::Unusable` で
    ///   先に終局させる。網羅のために腕を残してあり、`log::error!` が出たら
    ///   振り分けのほうが壊れている
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
                self.begin_turn();
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

        // **その手に使った時間を締める。** `consume` を呼ぶのは `decide_move` だけで、
        // ここを通る終わり方（時間切れ・投了・中断・裁定・故障）は通らない。
        // 締めないと、`Phase::Over` にした瞬間に `running` が消えて
        // 手番開始時点の残り時間が出る——画面が使ったぶんだけ巻き戻り、
        // 時間切れ負けなのに残り時間が正の値で並ぶ
        if let Some((side, elapsed)) = self.running_clock() {
            self.clocks.get_mut(side).charge(elapsed);
        }

        // 走っている思考を止める。`gameover` はエンジンが idle に戻ってから
        // （`on_search_outcome` の Over 分岐）送る
        let mut idle_sides = Vec::new();
        for side in SIDES {
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

        // **`gameover` より先に知らせる。** `send_command` は1件あたり
        // `WRITE_TIMEOUT` ＋ 列の待ちなので、後に回すと終局からイベント到着まで
        // 数秒空く。その間フロントは減り続ける時計を描いたままになる
        self.emit(GameEvent::Over {
            game_id: self.id.clone(),
            result: result.clone(),
            clocks: self.clocks_view(),
        });

        for side in idle_sides {
            self.send_gameover(side, &result).await;
        }
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

    /// その `req` が、いまその側で走っている探索のものか。
    ///
    /// `Stopping` の `req` も弾く——打ち切りを待っている探索の結果は採らない。
    fn is_current_search(&self, side: Side, req: u64) -> bool {
        matches!(
            self.player(side).activity,
            Activity::Searching { req: current, .. } if current == req
        )
    }

    fn timeout_enforced(&self, side: Side) -> bool {
        !self.player(side).spec.is_engine() || self.settings.enforce_engine_timeout
    }

    /// 手番の時計を動かし始める。
    ///
    /// **`turn_clock` を `Running` に動かすときは必ずここを通す。**
    /// `last_progress` を別に代入する形にすると、片方だけ更新する経路ができ、
    /// `stalled_turn` が前の手番の便りを見たまま締切を測る。
    /// （`Settling` への遷移は手番の開始ではないので、ここは通らない）
    fn begin_turn(&mut self) {
        let now = Instant::now();
        self.turn_clock = TurnClock::Running(now);
        self.last_progress = now;
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
            // 壁時計が取れない。嘘の 00:00 を出すより、止まっている値だけを見せる。
            //
            // **絞る。** ここは `on_tick` から `CLOCK_EMIT_INTERVAL` ごとに通る。
            // 条件が満たされている間（RTC が死んだ端末、時刻同期前の起動）
            // 毎秒2行出続けるので、絞らないとログが十数分で一周し、
            // それより前の記録が全部消える（`KeepOne` なので戻せない）
            if self.clock_warn.lock().is_ok_and(|mut w| w.allow()) {
                log::warn!(target: LOGT, "clocks: wall clock is before the epoch");
            }
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
        self.events.emit(event);
    }
}

// ===== 起動時の段取り =====

/// 締切までの残り。尽きていたら `Err`。
///
/// **`timeout` で包まない。** 包むと、上限に当たったときに中の future ごと
/// 落ちる——`registry.spawn` が返した直後だと、台帳に載ったプロセスの ID を
/// 誰も知らないまま消える。残りを渡して各段に自分で締めさせれば、
/// `Err` は普通に返り、起こしたぶんの後始末が走る。
fn remaining(deadline: Instant, what: &str) -> Result<Duration, String> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(format!("timed out before {what}"));
    }
    Ok(left)
}

/// エンジン側の対局者を全部起動する。
/// 途中で失敗したら、それまでに起動したものを道連れに落とす
async fn spawn_players(
    registry: &EngineRegistry,
    settings: &GameSettings,
    deadline: Instant,
) -> Result<(Vec<EngineId>, [Option<Arc<EngineProcess>>; 2]), String> {
    let mut ids = Vec::new();
    let mut engines: [Option<Arc<EngineProcess>>; 2] = [None, None];

    for side in SIDES {
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

        match prepare_engine(
            registry,
            engine_path,
            work_dir.as_deref(),
            options,
            deadline,
        )
        .await
        {
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
    options: &[SetOptionValue],
    deadline: Instant,
) -> Result<Arc<EngineProcess>, String> {
    // **段ごとの上限を締切で縮める。** 縮めないと、`start_game` 全体の締切が
    // 尽きかけていても各段は自前の上限を丸ごと使えるので、`START_TIMEOUT` は
    // 「返るまでの上限」にならない（2体ぶんで `SPAWN_TIMEOUT` の20秒が外に積まれる）
    // **残りを2段に配る。** 1つの `min` で済ませると、`spawn` の取り分が残りを
    // 丸ごと食って `usiok` の取り分が 0 になる——プロセスは実際に起こしたうえで
    // 1回 poll しただけで殺し、フロントには「エンジンが `usiok` を返さない」と返る。
    // 利用者は起こしたばかりのエンジンのパスと評価関数を疑うが、
    // **そのエンジンには1ナノ秒も与えていない。**
    //
    // `spawn` は fork/exec だけで普通は数ミリ秒しか使わないので、取り分を先に
    // 決めてから引く。`usiok` に何も残らないなら**起こす前に締切として断る。**
    let left = remaining(deadline, "the engine started")?;
    let for_spawn = SPAWN_TIMEOUT.min(left);
    let for_usiok = USI_OK_TIMEOUT.min(left.saturating_sub(for_spawn));
    if for_usiok.is_zero() {
        return Err("timed out before the engine said usiok".to_string());
    }
    let process = registry
        .spawn(engine_path, work_dir, for_spawn, for_usiok)
        .await
        .map_err(|e| e.to_string())?;

    let prepared = send_setup(&process, options, deadline).await;
    if let Err(e) = prepared {
        registry.shutdown(&process.id).await;
        return Err(e);
    }
    Ok(process)
}

/// `setoption` を送ってから `readyok` を待つ。
///
/// **締切を引き直しながら進む。** `setoption` の件数はフロントから来るので、
/// 1件あたり `WRITE_TIMEOUT` が積まれる。前もって計算した残りを
/// `ensure_ready` に渡すと、書き込みに食われたぶんだけ全体の締切を超える。
async fn send_setup(
    process: &EngineProcess,
    options: &[SetOptionValue],
    deadline: Instant,
) -> Result<(), String> {
    let protocol = process.protocol();

    // **並べた順にそのまま送る。** 値の解釈が前の `setoption` に依存する
    // エンジンがあるので、ここで並べ替えない（→ `PlayerSpec::Engine::options`）
    for SetOptionValue { name, value } in options {
        // USI は行指向なので、改行を混ぜられると別のコマンドを注入できる
        if contains_usi_breaking_char(name) || contains_usi_breaking_char(value) {
            return Err(format!(
                "option '{name}' contains a forbidden control character"
            ));
        }
        remaining(deadline, "the options were sent")?;
        protocol
            .send_command(&GuiCommand::SetOption(name.clone(), Some(value.clone())))
            .await
            .map_err(|e| e.to_string())?;
    }

    // `readyok` まで待ってから `usinewgame` を出す。待たずに積むと、
    // 呼び出し側は「対局が始まった」と思ったまま何も起きない状態になりうる
    protocol
        .ensure_ready(READY_TIMEOUT.min(remaining(deadline, "the engine said readyok")?))
        .await
        .map_err(|e| e.to_string())?;

    // **ここも残りを見る。** 見ないと、`ensure_ready` が残りを使い切った直後でも
    // 無条件に書きに行く。しかもその `usinewgame` は、直後に2体目の
    // `prepare_engine` が締切で断って**落とすエンジン**へ送っていることがある
    remaining(deadline, "usinewgame was sent")?;
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
    if settings.start_sfen.len() > MAX_WIRE_FIELD {
        return Err(format!(
            "start_sfen is {} bytes; the limit is {MAX_WIRE_FIELD}",
            settings.start_sfen.len()
        ));
    }
    for side in SIDES {
        let PlayerSpec::Engine { options, .. } = settings.spec(side) else {
            continue;
        };
        if options.len() > MAX_OPTIONS {
            return Err(format!(
                "{side:?} has {} options; the limit is {MAX_OPTIONS}",
                options.len()
            ));
        }
        for SetOptionValue { name, value } in options {
            if name.len() > MAX_WIRE_FIELD || value.len() > MAX_WIRE_FIELD {
                return Err(format!(
                    "option '{}' is longer than {MAX_WIRE_FIELD} bytes",
                    name.chars().take(40).collect::<String>()
                ));
            }
            // **入口で断る。** `send_setup` も同じことを見るが、そちらは
            // 起動を始めた後——プロセスを起こしてから断ることになる。
            // `start_sfen` の制御文字は入口で見ているので、非対称にしない
            if contains_usi_breaking_char(name) || contains_usi_breaking_char(value) {
                return Err(format!(
                    "option '{}' contains a forbidden control character",
                    name.chars().take(40).collect::<String>()
                ));
            }
        }
    }
    validate_start_sfen(&settings.start_sfen)?;
    // **`>=` で弾く。** ちょうど `MAX_PLIES` を通すと、最初の手の裁定が
    // 必ず断られる対局ができる（フロントが返せる列は1つに固定されている）
    if settings.initial_moves.len() >= MAX_PLIES {
        return Err(format!(
            "initial_moves has {} moves; the limit is {} (one move must be playable)",
            settings.initial_moves.len(),
            MAX_PLIES - 1
        ));
    }
    for mv in &settings.initial_moves {
        validate_usi_move(mv)?;
    }
    Ok(())
}

/// SFEN が**書式として**送れる形か。
///
/// **将棋のルールは見ない**（合法性の判定はフロントが持つ、がこの層の切れ目）。
/// 見るのはワイヤに出せる形かどうかだけ。
///
/// ここが緩いと、壊れた SFEN が `position sfen <それ> moves ...` として
/// そのままエンジンへ出る。エンジンの反応は実装ごとに割れる（無視する／
/// エラー行を返す／落ちる）が、**どれになっても原因が `start_sfen` にあることは
/// 利用者にもログにも出ない**。無視された場合は前の局面のまま `go` を受けるので、
/// 返る `bestmove` は別の局面に対する手になり、フロントは反則と裁定する
/// ——エンジンが身に覚えのない負けを負う。
fn validate_start_sfen(sfen: &str) -> Result<(), String> {
    let fields: Vec<&str> = sfen.split_whitespace().collect();

    // `startpos` は受け取らない。`GuiCommand::Position` が `position sfen` を
    // 前置するので、`position sfen startpos moves ...` という壊れた行になる
    if fields.first() == Some(&"startpos") {
        return Err("start_sfen must be a full SFEN, not \"startpos\"".to_string());
    }
    // 盤面 / 手番 / 持ち駒 / 手数 の4つ。欠けたまま送ると解釈が実装依存になる
    if fields.len() != 4 {
        return Err(format!(
            "start_sfen must have 4 fields (board, side, hands, ply), got {}",
            fields.len()
        ));
    }
    // 段は9つ。`/` の数だけを見る（駒の綴りはルール側の話）
    if fields[0].split('/').count() != 9 {
        return Err("start_sfen board must have 9 ranks separated by '/'".to_string());
    }
    if Side::from_sfen_token(fields[1]).is_none() {
        return Err("start_sfen must have \"b\" or \"w\" as its second field".to_string());
    }
    if fields[3].parse::<u32>().is_err() {
        return Err("start_sfen ply must be a number".to_string());
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

#[cfg(test)]
mod tests {
    use super::super::events::{DiscardEvents, RecordedEvents};
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
        GameSession::start(&EngineRegistry::new(), Arc::new(DiscardEvents), settings)
            .await
            .expect("人間だけの対局は起動できるはず")
    }

    fn phase_of(snapshot: &GameSnapshot) -> &GamePhaseView {
        &snapshot.phase
    }

    /// `d` だけ前の時刻。番人の締切を跨がせるのに使う
    fn long_ago(d: Duration) -> Instant {
        Instant::now()
            .checked_sub(d)
            .expect("起動直後で `Instant` を遡れない")
    }

    /// `Runner` を直に組む。`GameSession::start` を通さないので、
    /// エンジン無しでも `Activity` を好きな状態にできる
    fn test_runner(tx: &mpsc::UnboundedSender<Command>) -> Runner {
        runner_with_events(tx, Arc::new(DiscardEvents))
    }

    /// 出来事を観測したいときの `Runner`。
    ///
    /// 宛先を差し替えられるので、出た出来事をそのまま確かめられる
    /// （→ `game::events`）。
    fn runner_with_events(
        tx: &mpsc::UnboundedSender<Command>,
        events: Arc<dyn GameEventSink>,
    ) -> Runner {
        let settings = two_humans(vec![]);
        Runner {
            id: GameId::new("test".to_string()),
            events,
            clocks: GameClocks::new(settings.black_time, settings.white_time),
            players: [
                Player::new(settings.black.clone(), None),
                Player::new(settings.white.clone(), None),
            ],
            moves: Vec::new(),
            settings,
            phase: Phase::Thinking { side: Side::Black },
            turn_clock: TurnClock::Running(Instant::now()),
            last_progress: Instant::now(),
            clock_warn: Mutex::new(LogThrottle::new(CLOCK_WARN_INTERVAL)),
            next_req: 0,
            last_clock_emit: Instant::now(),
            tx: tx.downgrade(),
        }
    }

    /// 線に出る1行を伸ばせる経路を、入口で全部見ていること。
    ///
    /// **手数だけ見ても足りない。** 同じ1行は `start_sfen` の盤面欄からも
    /// `setoption` の値からも伸ばせる。どれも `check_writable` の `to_string` と
    /// `push_pending` の `clone` を通り、`WRITE_TIMEOUT` で切れて `fail_writes` が
    /// 走ると**そのエンジンは以後何も受け付けなくなる**——出るのは
    /// 「stdin を読まなくなった」で、長すぎたことは分からない。
    #[test]
    fn every_way_to_stretch_the_wire_is_checked_at_the_door() {
        // 通したい形: 平手も、最長の駒落ちも、実在するエンジンの option の件数も
        validate_settings(&two_humans(vec![])).expect("平手を断っている");

        let engine = |options: Vec<SetOptionValue>| PlayerSpec::Engine {
            name: "エンジン".to_string(),
            engine_path: "/path".to_string(),
            work_dir: None,
            options,
            ponder: false,
        };
        let option = |value: String| SetOptionValue {
            name: "EvalDir".to_string(),
            value,
        };

        let mut settings = two_humans(vec![]);
        settings.black = engine(vec![option("/very/long/path/to/eval".to_string()); 32]);
        validate_settings(&settings).expect("32件の option を断っている");

        // 断る形
        let mut settings = two_humans(vec![]);
        settings.start_sfen = format!(
            "{}{} b - 1",
            HIRATE.split(' ').next().expect("盤面欄がある"),
            "1".repeat(MAX_WIRE_FIELD)
        );
        let error = validate_settings(&settings).expect_err("長すぎる SFEN を通している");
        assert!(error.contains("bytes"), "断る理由が変わっている: {error}");

        let mut settings = two_humans(vec![]);
        settings.black = engine(vec![option("x".to_string()); MAX_OPTIONS + 1]);
        validate_settings(&settings).expect_err("多すぎる option を通している");

        let mut settings = two_humans(vec![]);
        settings.black = engine(vec![option("x".repeat(MAX_WIRE_FIELD + 1))]);
        validate_settings(&settings).expect_err("長すぎる option の値を通している");

        // **制御文字も入口で断る。** `send_setup` も見るが、そちらは
        // プロセスを起こした後——起こしてから断ることになる
        let mut settings = two_humans(vec![]);
        settings.black = engine(vec![option("/eval\ninjected".to_string())]);
        let error =
            validate_settings(&settings).expect_err("改行を含む option の値を入口で通している");
        assert!(
            error.contains("control character"),
            "断る理由が変わっている: {error}"
        );
    }

    /// 入口2箇所の手数の上限が、**1手指せる関係**になっていること。
    ///
    /// 揃っていないと、`start_game` が `Ok` を返した対局で最初の手の裁定が
    /// 必ず断られる。フロントが返せる列は接頭辞と長さで一意に固定されているので、
    /// やり直しても同じ `Err` になり、`RULING_TIMEOUT` 後に
    /// 「アプリが裁定を返さなかった」で畳まれる——**返しているのに。**
    #[tokio::test]
    async fn the_longest_startable_game_can_still_take_a_move() {
        let longest = MAX_PLIES - 1;

        let mut settings = two_humans(vec![]);
        settings.initial_moves = vec!["7g7f".to_string(); longest];
        validate_settings(&settings).expect("1手指せる長さを断っている");

        settings.initial_moves.push("7g7f".to_string());
        validate_settings(&settings).expect_err("1手も指せない長さを通している");

        // その対局の最初の裁定が通ること
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.moves = vec!["7g7f".to_string(); longest];
        runner.phase = Phase::AwaitingRuling {
            last_mover: Side::White,
            usi_move: "7g7f".to_string(),
            ponder_move: None,
            since: Instant::now(),
        };
        runner
            .accept_continue(vec!["7g7f".to_string(); longest + 1])
            .await
            .expect("起動できた対局の最初の裁定を断っている");
    }

    /// `on_tick` が `stalled_turn` へ渡す2つの `bool` の配線。
    ///
    /// **型が同じで隣り合っているので、入れ替えてもコンパイルが通る。**
    /// 入れ替えると、`info` を出していないエンジンで `thinking_is_an_engine` が
    /// 偽になり、`Running` の枝に一切入らない——沈黙の腕だけでなく
    /// **`budget + HARD_TURN_LIMIT` の最後の上限も消える。**
    ///
    /// `stalled_turn` を直に叩くテストは、この配線を1本も見ていない。
    #[tokio::test]
    async fn the_last_resort_limit_reaches_an_engine_that_never_spoke() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].spec = PlayerSpec::Engine {
            name: "黙ったエンジン".to_string(),
            engine_path: "/nonexistent".to_string(),
            work_dir: None,
            options: Vec::new(),
            ponder: false,
        };
        runner.players[Side::Black.index()].activity = searching(&cancel);
        // 一度も `info` を出していない
        assert!(!runner.players[Side::Black.index()].has_spoken);

        let budget = Duration::from_millis(runner.clocks.budget_ms(Side::Black));
        runner.turn_clock =
            TurnClock::Running(long_ago(budget + HARD_TURN_LIMIT + Duration::from_secs(1)));
        runner.last_progress = long_ago(budget + HARD_TURN_LIMIT + Duration::from_secs(1));

        runner.on_tick().await;

        match &runner.phase {
            Phase::Over { result } => assert_eq!(
                result.reason,
                GameOverReason::EngineFailure,
                "上限で落ちていない"
            ),
            _ => panic!("上限を超えたエンジンが落ちていない"),
        }
    }

    /// 締切が細ったとき、`usiok` の取り分を 0 にしないこと。
    ///
    /// **0 にすると、プロセスは実際に起こしたうえで1回 poll しただけで殺される。**
    /// フロントに返るのは「エンジンが `usiok` を返さない」で、利用者は起こしたばかりの
    /// エンジンのパスと評価関数を疑う——**そのエンジンには1ナノ秒も与えていないのに。**
    /// 与えられないなら、起こす前に締切として断る。
    #[tokio::test]
    async fn a_thin_budget_never_starts_an_engine_it_cannot_wait_for() {
        let mut settings = two_humans(vec![]);
        settings.black = PlayerSpec::Engine {
            name: "後手番のエンジン".to_string(),
            engine_path: "/nonexistent/engine".to_string(),
            work_dir: None,
            options: Vec::new(),
            ponder: false,
        };

        let registry = EngineRegistry::new();
        // `spawn` の取り分（`SPAWN_TIMEOUT`）は残っているが、`usiok` に回らない幅
        let deadline = Instant::now() + SPAWN_TIMEOUT;
        let error = spawn_players(&registry, &settings, deadline)
            .await
            .expect_err("`usiok` を待てない締切で起動している");

        assert!(
            error.contains("timed out before"),
            "エンジンのせいとして断っている: {error}"
        );
    }

    /// 対局の起動が、締切を過ぎたら**プロセスを起こす前に**断ること。
    ///
    /// 段ごとの上限しか無いと、それを足したぶんのあいだ `start_game` が返らない。
    /// フロントには進捗も残り時間も無く、取り消す口も無い。
    ///
    /// **`timeout` で包まないので、後始末が普通に走る。** 包むと、上限に当たった
    /// ときに中の future ごと落ちて、台帳に載ったプロセスの ID を誰も知らないまま消える。
    #[tokio::test]
    async fn starting_a_game_stops_at_the_deadline() {
        let mut settings = two_humans(vec![]);
        settings.black = PlayerSpec::Engine {
            name: "存在しないエンジン".to_string(),
            engine_path: "/nonexistent/engine".to_string(),
            work_dir: None,
            options: Vec::new(),
            ponder: false,
        };

        let registry = EngineRegistry::new();
        let error = spawn_players(&registry, &settings, Instant::now())
            .await
            .expect_err("締切を過ぎているのに起動している");

        // 起こそうとして失敗したのではなく、起こす前に締切で断ったこと
        assert!(
            error.contains("timed out before"),
            "締切ではなく起動の失敗で断っている: {error}"
        );
    }

    /// 時計が尽きて採られなかった手に `Ok` を返さないこと。
    ///
    /// 人間の着手が届くのと持ち時間が尽きるのが同じ tick に入ると、
    /// `MoveDecided` は出ずに `Over { Timeout }` が出る。ここで `Ok` を返すと、
    /// `await submitGameMove(...)` の後に棋譜へ積む素直な実装が、
    /// **終局後の棋譜に指されていない手を1手足す**。しかも `finish` は `Over` を
    /// 先に流すので、フロントには終局が先に届いてから `Ok` が解決する。
    #[tokio::test]
    async fn a_move_that_the_clock_beat_is_not_reported_as_taken() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let events = Arc::new(RecordedEvents::default());
        let mut runner = runner_with_events(&tx, events.clone());
        // **`enforce_engine_timeout` は置かない。** 手番は人間なので
        // `timeout_enforced` は左辺だけで真になり、置いても効かない
        // （置くと「エンジン側の時間切れを踏んでいる」と読める）。
        // 持ち時間を尽きた状態にして、手番に入った時刻を十分前に置く
        runner.clocks = GameClocks::new(
            TimeLimit {
                main_ms: 1,
                byoyomi_ms: 0,
                increment_ms: 0,
            },
            minutes(10),
        );
        runner.turn_clock = TurnClock::Running(long_ago(Duration::from_secs(5)));

        let error = runner
            .accept_human_move(Side::Black, "7g7f".to_string())
            .await
            .expect_err("採られなかった手に Ok を返している");
        assert!(error.contains("clock"), "断る理由が変わっている: {error}");

        let seen = events.take();
        assert!(
            !seen
                .iter()
                .any(|e| matches!(e, GameEvent::MoveDecided { .. })),
            "採らなかったのに `moveDecided` を流している"
        );
        assert!(
            seen.iter().any(|e| matches!(e, GameEvent::Over { .. })),
            "終局が流れていない"
        );
    }

    /// 裁定で渡された指し手列が、いまの写しの続きであること。
    ///
    /// **通したい形を先に並べる。** 途中局面から始めた対局でも、フロントは
    /// 根からの全手を渡す。ここを緩めると、`initial_moves` を偶数個持つ局面で
    /// 「対局開始以降の手だけ」を渡した列が全部通る——末尾は決まった手のままで、
    /// 長さの偶奇も変わらないので。写しが黙って短くなると、次の `go` は
    /// **根の局面に途中の手を継ぎ足した別局面**を送る。
    #[tokio::test]
    async fn a_ruling_must_carry_the_whole_move_list() {
        let opening = ["7g7f", "3c3d", "2g2f", "8c8d"];

        let awaiting = |moves: &[&str]| {
            let (tx, _rx) = mpsc::unbounded_channel();
            let mut runner = test_runner(&tx);
            runner.moves = moves.iter().map(|m| m.to_string()).collect();
            runner.phase = Phase::AwaitingRuling {
                last_mover: Side::White,
                usi_move: "8c8d".to_string(),
                ponder_move: None,
                since: Instant::now(),
            };
            (runner, tx)
        };

        // 通る: 根からの全手（写し3手 + 決まった1手）
        let (mut runner, _tx) = awaiting(&opening[..3]);
        assert!(
            runner
                .accept_continue(opening.iter().map(|m| m.to_string()).collect())
                .await
                .is_ok(),
            "根からの全手を断っている"
        );

        // 断る: 対局開始以降の手だけ（偶数個を落としたので偶奇は合ったまま）
        let (mut runner, _tx) = awaiting(&opening[..3]);
        let error = runner
            .accept_continue(vec!["2g2f".to_string(), "8c8d".to_string()])
            .await
            .expect_err("途中を落とした列を通している");
        assert!(error.contains("plus"), "断る理由が変わっている: {error}");

        // 断る: 過去の手が入れ替わっている（長さも末尾も合っている）
        let (mut runner, _tx) = awaiting(&opening[..3]);
        runner
            .accept_continue(vec![
                "7g7f".to_string(),
                "8c8d".to_string(),
                "2g2f".to_string(),
                "8c8d".to_string(),
            ])
            .await
            .expect_err("過去の手が入れ替わった列を通している");

        // **上限は検算の後。** 食い違った長い列は「上限に当たった」ではなく
        // 食い違いとして断る——前に置くと、4手で終わった対局に
        // 「最大手数で終局」と棋譜が残り、`Err` も出ないので気付く経路が無くなる
        let (mut runner, _tx) = awaiting(&opening[..3]);
        let error = runner
            .accept_continue(vec!["7g7f".to_string(); MAX_PLIES + 1])
            .await
            .expect_err("食い違った長い列を終局として飲んでいる");
        assert!(error.contains("plus"), "断る理由が変わっている: {error}");
        assert!(
            !matches!(runner.phase, Phase::Over { .. }),
            "食い違いで終局している"
        );

        // 上限を超えたら**断らずに終局にする**。断ると、フロントは一意に固定された
        // 列しか返せないのでやり直しても同じ `Err` になり、`RULING_TIMEOUT` 後に
        // 「アプリが裁定を返さなかった」で畳まれる——返しているのに、と記録される
        let full = vec!["7g7f".to_string(); MAX_PLIES];
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.moves = full.clone();
        // 写しが偶数手なので、決まったばかりの手は先手のもの
        runner.phase = Phase::AwaitingRuling {
            last_mover: Side::Black,
            usi_move: "7g7f".to_string(),
            ponder_move: None,
            since: Instant::now(),
        };
        let mut over_the_limit = full;
        over_the_limit.push("7g7f".to_string());
        runner
            .accept_continue(over_the_limit)
            .await
            .expect("上限を超えた列を断っている");
        match &runner.phase {
            Phase::Over { result } => {
                assert_eq!(result.reason, GameOverReason::Rule, "終局の理由が違う");
                assert!(
                    result
                        .detail
                        .as_deref()
                        .is_some_and(|d| d.contains("ply limit")),
                    "上限に当たったことが `detail` に残っていない: {:?}",
                    result.detail
                );
            }
            _ => panic!("上限に当たっても終局していない"),
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
    /// 消費として最大 `SEARCH_STOP_GRACE` が計上され、`enforce_engine_timeout` が
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
        // **接頭辞の検算を通る列でないと、この分岐に届かない。**
        // 長さも接頭辞も末尾も合っていて、偶奇だけが合わない列を作る——
        // 平手（先手番）で2手目まで進んだなら次は先手だが、`last_mover` が先手なので
        // `last_mover.opponent()` は後手を指す。`derive_side_after` と食い違う
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.moves = vec!["3c3d".to_string()];
        runner.phase = Phase::AwaitingRuling {
            last_mover: Side::Black,
            usi_move: "7g7f".to_string(),
            ponder_move: None,
            since: Instant::now(),
        };

        let error = runner
            .accept_continue(vec!["3c3d".to_string(), "7g7f".to_string()])
            .await
            .expect_err("手番の導出と食い違う列を通している");
        assert!(
            error.contains("to move"),
            "偶奇の検算ではないところで断っている: {error}"
        );
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
        let mut over = None;
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let snapshot = game.snapshot().await.unwrap();
            if let GamePhaseView::Over { result: r } = phase_of(&snapshot) {
                over = Some((r.clone(), snapshot.clocks));
                break;
            }
        }

        let (result, clocks) = over.expect("持ち時間が尽きても終局しなかった");
        assert_eq!(result.reason, GameOverReason::Timeout);
        assert_eq!(result.winner, Some(Side::White));

        // **負けた側の残り時間は 0。** その手に使った時間を締めないと、
        // 手番開始時点の値が出る——時間切れ負けなのに残り時間が正のまま並ぶ
        assert_eq!(
            clocks.black.main_ms, 0,
            "時間切れで負けた側の残り時間が 0 になっていない"
        );
        assert!(clocks.running.is_none(), "終局後に動いている時計がある");
    }

    /// 番人が2つの止まり方を分けること。**どちらも `Thinking` の中。**
    ///
    /// 畳み待ちと思考中では、エンジンに何が起きているかが違う。
    /// 潰すと `detail` が原因を取り違える
    #[test]
    fn a_stalled_turn_says_which_kind_of_stall_it_is() {
        let silent = SEARCH_GRACE;
        let just_spoke = Duration::ZERO;

        // まだどちらも上限に達していない
        assert_eq!(
            stalled_turn(
                TurnClock::Settling(Instant::now()),
                0,
                silent,
                IsEngine(true),
                HasSpoken(true)
            ),
            None
        );
        assert_eq!(
            stalled_turn(
                TurnClock::Running(Instant::now()),
                0,
                silent,
                IsEngine(true),
                HasSpoken(true)
            ),
            None
        );

        assert_eq!(
            stalled_turn(
                TurnClock::Settling(long_ago(SETTLE_TIMEOUT)),
                600_000,
                just_spoke,
                IsEngine(true),
                HasSpoken(true)
            ),
            Some(Stall::NotStopping),
            "畳み待ちの上限は持ち時間とも便りとも無関係"
        );

        // **黙っているなら持ち時間が残っていても落とす。**
        // 持ち時間を足すと、60分の対局で初手から固まったエンジンが
        // 持ち時間ぶん検出されない
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(SEARCH_GRACE)),
                600_000,
                silent,
                IsEngine(true),
                HasSpoken(true)
            ),
            Some(Stall::NotAnswering),
            "黙っているのに持ち時間が残っているから待っている"
        );
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(SEARCH_GRACE)),
                0,
                silent,
                IsEngine(true),
                HasSpoken(true)
            ),
            Some(Stall::NotAnswering)
        );
    }

    /// `info` を1行も出さないエンジンを、正常なのに落とさないこと。
    ///
    /// USI は `info` を義務にしていない。1行も出さない実装（詰将棋ソルバを
    /// 対局者に挿す、深さが変わったときだけ出すエンジン）を沈黙で落とすと、
    /// **正常に読んでいる31秒目に必ず負ける**——棋譜に英文の故障理由が残り、
    /// 利用者に無効化する手段が無い（`enforce_engine_timeout` はこの番人を見ない）。
    ///
    /// 押さえるのは `budget + HARD_TURN_LIMIT` だけになる。**それは残す。**
    #[test]
    fn an_engine_that_never_prints_info_is_not_called_unresponsive() {
        let an_hour = 60 * 60 * 1000;
        let never_spoke = false;

        for elapsed in [SEARCH_GRACE, SEARCH_GRACE * 4, HARD_TURN_LIMIT] {
            assert_eq!(
                stalled_turn(
                    TurnClock::Running(long_ago(elapsed)),
                    an_hour,
                    elapsed,
                    IsEngine(true),
                    HasSpoken(never_spoke)
                ),
                None,
                "`info` を出さないエンジンを {elapsed:?} で故障扱いにしている"
            );
        }

        // 上限そのものは残る
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(
                    Duration::from_millis(an_hour) + HARD_TURN_LIMIT + Duration::from_secs(1)
                )),
                an_hour,
                Duration::ZERO,
                IsEngine(true),
                HasSpoken(never_spoke)
            ),
            Some(Stall::NotAnswering),
            "`info` を出さないエンジンに上限が1つも残っていない"
        );

        // 一度でも出したエンジンには、黙ったことが信号として効く
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(SEARCH_GRACE)),
                an_hour,
                SEARCH_GRACE,
                IsEngine(true),
                HasSpoken(true)
            ),
            Some(Stall::NotAnswering),
            "喋っていたエンジンが黙ったのに待っている"
        );
    }

    /// **黙って固まったエンジンを、持ち時間ぶん待たないこと。**
    ///
    /// 60分切れ負け・`enforce_engine_timeout` は既定の偽・初手のエンジンが
    /// `go` の後にデッドロックして `info` を1行も出さない、を置く。
    /// 沈黙の腕に持ち時間を足すと、**持ち時間ぶん何も起きない**。
    /// フロントには時計が500msごとに流れ続けるので、正常な長考と区別が付かない。
    #[test]
    fn a_silent_engine_is_caught_without_waiting_out_the_clock() {
        let an_hour = 60 * 60 * 1000;

        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(SEARCH_GRACE + Duration::from_secs(1))),
                an_hour,
                SEARCH_GRACE,
                IsEngine(true),
                HasSpoken(true)
            ),
            Some(Stall::NotAnswering),
            "黙って固まったエンジンを持ち時間ぶん待っている"
        );

        // `go` を出した直後の一瞬は「黙っている」と数えない
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(Duration::from_secs(1))),
                an_hour,
                Duration::from_secs(1),
                IsEngine(true),
                HasSpoken(true)
            ),
            None
        );
    }

    /// **人間の手番には掛けないこと。**
    ///
    /// 人間が長考しても「応答しない」ではない。しかも `info` を出さないので
    /// 沈黙条件は常に満たされる。掛けると、30分切れ負けで11分考えた人間が
    /// **残り19分あるのに `EngineFailure` で負ける**——相手に勝ちが付き、
    /// 棋譜に「the engine did not answer in time」が残る。
    ///
    /// 人間の手番を締めるのは時計（`has_expired`）で、そちらは種別に関わらず成立する。
    #[test]
    fn a_human_taking_a_long_think_is_never_called_unresponsive() {
        let half_an_hour = 30 * 60 * 1000;
        let budget = Duration::from_millis(half_an_hour);

        // **どの締切も跨いだ値で見る。** 跨がない値だと、人間かどうかを
        // 見ていない実装でも通ってしまう（変異が落ちない）
        for elapsed in [
            budget + SEARCH_GRACE + Duration::from_secs(1),
            budget + HARD_TURN_LIMIT + Duration::from_secs(1),
            budget + HARD_TURN_LIMIT * 3,
        ] {
            assert_eq!(
                stalled_turn(
                    TurnClock::Running(long_ago(elapsed)),
                    half_an_hour,
                    // 人間は `info` を出さないので、沈黙は常に満たされる
                    elapsed,
                    IsEngine(false),
                    HasSpoken(true)
                ),
                None,
                "長考した人間を「応答しない」と呼んでいる: {elapsed:?}"
            );
        }

        // 同じ値でエンジンなら落ちる。**種別を見ていることの裏取り**
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(budget + HARD_TURN_LIMIT + Duration::from_secs(1))),
                half_an_hour,
                Duration::ZERO,
                IsEngine(true),
                HasSpoken(true)
            ),
            Some(Stall::NotAnswering)
        );

        // 畳み待ちは種別に関わらず見る（止めた探索の話なので）
        assert_eq!(
            stalled_turn(
                TurnClock::Settling(long_ago(SETTLE_TIMEOUT)),
                half_an_hour,
                Duration::ZERO,
                IsEngine(false),
                HasSpoken(true)
            ),
            Some(Stall::NotStopping)
        );
    }

    /// **持ち時間を過ぎただけで落とさないこと。**
    ///
    /// `enforce_engine_timeout` が偽のまま持ち時間が尽きると `budget_ms` は
    /// 0 に張り付く。持ち時間だけを見ると締切が `SEARCH_GRACE` ちょうどになり、
    /// 正常に読み続けているエンジンが `SEARCH_GRACE` で「応答しない」と呼ばれる。
    #[test]
    fn an_engine_that_keeps_talking_is_not_called_unresponsive() {
        // 持ち時間は尽きている（budget 0）が、いま便りがあった
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(SEARCH_GRACE * 10)),
                0,
                Duration::ZERO,
                IsEngine(true),
                HasSpoken(true)
            ),
            None,
            "読み続けているエンジンを「応答しない」と呼んでいる"
        );

        // 黙ったなら落とす
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(SEARCH_GRACE * 10)),
                0,
                SEARCH_GRACE,
                IsEngine(true),
                HasSpoken(true)
            ),
            Some(Stall::NotAnswering)
        );
    }

    /// **喋り続けても上限は超えられないこと。ただし持ち時間より先には来ない。**
    ///
    /// 沈黙だけを条件にすると、`info` を出しながら `bestmove` を返さない
    /// エンジンに上限が1つも残らない。逆に絶対の値にすると、持ち時間の長い
    /// 対局で**時計より先に**発火する（60分の持ち時間で15分の長考が故障扱い）。
    /// だから持ち時間に**足す**。
    #[test]
    fn talking_forever_still_hits_the_hard_limit() {
        let an_hour = 60 * 60 * 1000;

        // 持ち時間が尽きた後は、そこから `HARD_TURN_LIMIT` で落ちる
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(HARD_TURN_LIMIT)),
                0,
                Duration::ZERO,
                IsEngine(true),
                HasSpoken(true)
            ),
            Some(Stall::NotAnswering),
            "喋り続けるエンジンに上限が残っていない"
        );

        // **持ち時間が残っているうちは落とさない。** 長考は故障ではない
        assert_eq!(
            stalled_turn(
                TurnClock::Running(long_ago(HARD_TURN_LIMIT)),
                an_hour,
                Duration::ZERO,
                IsEngine(true),
                HasSpoken(true)
            ),
            None,
            "持ち時間が残っているエンジンを上限で落としている"
        );
    }

    /// 上限どうしの大小を固定する。
    ///
    /// **数を散文で書かない。** 「`SEARCH_STOP_GRACE` ＋書き込みの上限より
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

        // 閉じるときの畳み待ちも、**同じ最悪値**より長い。
        // `SEARCH_STOP_GRACE` だけと比べると、書き込みぶんが抜けて足りない値が通る
        assert!(
            CLOSE_IDLE_TIMEOUT > WRITE_TIMEOUT + SEARCH_STOP_GRACE,
            "CLOSE_IDLE_TIMEOUT({CLOSE_IDLE_TIMEOUT:?}) が WRITE_TIMEOUT + SEARCH_STOP_GRACE 以下"
        );

        // `abort` の予算は畳み待ちと別枠。合計にすると、`abort` が使ったぶんだけ
        // 畳み待ちが縮む。**別枠であることを式で持つ**
        //
        // **1件ぶんでは足りない。** `abort` は `finish` を通り、`finish` は
        // 探索していない側それぞれへ `gameover` を書く。先後は別プロセス＝
        // 別の書き込み列なので、最悪はその件数ぶん**直列に**待つ。
        //
        // **さらに列の先客が1件乗る。** `abort_within_budget` が包むのは
        // `run_loop` の単一キューへ入れてから返るまでで、`take_and_close` が
        // それを呼ぶのは `Arc::try_unwrap` が失敗したとき——つまり
        // **別の操作が掴んでいることが確定している**とき。
        //
        // **これも下限でしかない。** 先客の処理が書き込み1件で終わるとは限らない
        assert!(
            CLOSE_ABORT_TIMEOUT > WRITE_TIMEOUT * (SIDES.len() as u32 + 1),
            "CLOSE_ABORT_TIMEOUT({CLOSE_ABORT_TIMEOUT:?}) が、列の先客と `gameover` を書き切れる長さに足りない"
        );

        // 思考の番人は畳み待ちの番人より長い。逆だと、考えているエンジンが
        // 畳み待ちより先に故障扱いになる。
        //
        // **等値を許さない。** 同じなら両方の番人が同じ tick に当たりうるので、
        // `NotStopping` と `NotAnswering` のどちらが付くかが `stalled_turn` の
        // 腕の順序で決まる——`detail` が原因を取り違える
        assert!(
            SEARCH_GRACE > SETTLE_TIMEOUT,
            "SEARCH_GRACE({SEARCH_GRACE:?}) が SETTLE_TIMEOUT({SETTLE_TIMEOUT:?}) 以下"
        );

        // 上限が沈黙の猶予より短いと、沈黙の腕が一度も届かない
        assert!(
            HARD_TURN_LIMIT > SEARCH_GRACE,
            "HARD_TURN_LIMIT({HARD_TURN_LIMIT:?}) が SEARCH_GRACE 以下"
        );
    }

    /// 畳み待ちのまま `SETTLE_TIMEOUT` を過ぎたら終局にすること（表の E17）。
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

    /// 終局を知らせること（※6 の順序。`(G0, E8)` の経路で確かめる）。
    ///
    /// **`Over` が出ないと、フロントは対局が終わったことを知らない。**
    /// `send_gameover` は書き込みの列を通るので、後に回すと終局から
    /// イベント到着まで数秒空き、その間フロントは減り続ける時計を描く。
    ///
    /// **見ているのは `Over` が出たことだけ。** `gameover` が実際に飛ぶことも、
    /// それが `Over` より後であることも見ていない——`send_gameover` の宛先は
    /// `UsiProtocol` の具象で、観測する継ぎ目が無い（→ #377）。
    /// 順序を入れ替える変異ではここは落ちない。
    #[tokio::test]
    async fn ending_the_game_tells_the_app_before_it_tells_the_engines() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let events = Arc::new(RecordedEvents::default());
        let mut runner = runner_with_events(&tx, events.clone());
        runner.players[Side::Black.index()].activity = searching(&cancel);

        runner
            .on_search_outcome(Side::Black, 1, SearchOutcome::Resign)
            .await;

        let seen = events.take();
        let over = seen
            .iter()
            .find(|e| matches!(e, GameEvent::Over { .. }))
            .expect("終局を知らせていない");

        let GameEvent::Over { result, clocks, .. } = over else {
            unreachable!("`Over` を探して当てている");
        };
        assert_eq!(result.reason, GameOverReason::Resign);
        assert_eq!(result.winner, Some(Side::White));
        assert!(
            clocks.running.is_none(),
            "終局を知らせる時点で動いている時計がある"
        );
    }

    /// 先読みの当たり／外れの振り分け。**実プロセスは要らない。**
    ///
    /// `Handover::PonderHit` の送信は `protocol(side)` が `None` のとき
    /// `Ok(())` に落ちるので、`engine: None` の `Runner` でも成功側が走る。
    ///
    /// 当たりに潰すと、**外れた先読みの上から `ponderhit` を送ったことにして**
    /// 時計を動かす。エンジンは指されなかった手の後の局面を読み続け、返る
    /// `bestmove` は現局面で非合法——※7 の「身に覚えのない負け」がそのまま起きる。
    #[tokio::test]
    async fn a_ponder_that_missed_is_stopped_and_restarted() {
        let (tx, _rx) = mpsc::unbounded_channel();

        // 当たり: そのまま考え続け、時計はここから動く
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::White.index()].activity = Activity::Searching {
            req: 1,
            kind: SearchKind::Ponder {
                ponder_move: "7g7f".to_string(),
            },
            cancel: cancel.clone(),
        };
        runner.turn_clock = TurnClock::Settling(Instant::now());
        runner.hand_turn_to(Side::White, "7g7f").await;

        assert!(
            matches!(
                runner.players[Side::White.index()].activity,
                Activity::Searching {
                    kind: SearchKind::Search,
                    ..
                }
            ),
            "読み当たりなのに本番の思考へ昇格していない"
        );
        assert!(
            matches!(runner.turn_clock, TurnClock::Running(_)),
            "読み当たりなのに時計が動き出していない"
        );
        assert!(!cancel.is_cancelled(), "読み当たりなのに探索を止めた");

        // 外れ: 止めて始め直す。時計はまだ動かない
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::White.index()].activity = Activity::Searching {
            req: 1,
            kind: SearchKind::Ponder {
                ponder_move: "7g7f".to_string(),
            },
            cancel: cancel.clone(),
        };
        runner.turn_clock = TurnClock::Settling(Instant::now());
        runner.hand_turn_to(Side::White, "2g2f").await;

        assert!(
            matches!(
                runner.players[Side::White.index()].activity,
                Activity::Stopping { restart: true, .. }
            ),
            "読み外れなのに止めて始め直していない"
        );
        assert!(cancel.is_cancelled(), "読み外れなのに探索を止めていない");
        assert!(
            matches!(runner.turn_clock, TurnClock::Settling(_)),
            "まだ `go` を出していないのに時計が動いている"
        );
    }

    /// `hand_turn_to` の振り分けを、先読み以外の腕でも見ること。
    ///
    /// ※2 の表のうち、踏んでいたのは先読みの当たり／外れと、止めたのに
    /// 応答しない側（`A4`、`handing_the_turn_to_an_unresponsive_engine_ends_the_game_and_stops_there`）
    /// だけだった。残りは手番でない側が本番の思考をしている（`A1`）、
    /// 前に止めた分がまだ返っていない（`A3`）、何も走っていない（`A0`）。
    ///
    /// `A1` を `A0` と同じ扱いにすると、**探索中のエンジンへ `position` /
    /// `go` を送る**（USI 違反）。`A4` へ渡せることにすると、応答しない
    /// エンジンに手番が渡って対局が黙って止まる。
    #[tokio::test]
    async fn handing_the_turn_covers_every_activity() {
        let (tx, _rx) = mpsc::unbounded_channel();

        // `A1` — 手番でない側が本番の思考をしている。止めてから始め直す
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::White.index()].activity = Activity::Searching {
            req: 1,
            kind: SearchKind::Search,
            cancel: cancel.clone(),
        };
        runner.turn_clock = TurnClock::Settling(Instant::now());
        runner.hand_turn_to(Side::White, "7g7f").await;

        assert!(
            matches!(
                runner.players[Side::White.index()].activity,
                Activity::Stopping { restart: true, .. }
            ),
            "本番の思考をしている側に、止めずに手番を渡した"
        );
        assert!(cancel.is_cancelled(), "本番の思考を止めていない");
        assert!(
            matches!(runner.turn_clock, TurnClock::Settling(_)),
            "まだ `go` を出していないのに時計が動いている"
        );

        // `A3` — 既に止めてある。`restart` を立てるだけ
        let mut runner = test_runner(&tx);
        runner.players[Side::White.index()].activity = Activity::Stopping {
            req: 1,
            restart: false,
        };
        runner.turn_clock = TurnClock::Settling(Instant::now());
        runner.hand_turn_to(Side::White, "7g7f").await;

        assert!(
            matches!(
                runner.players[Side::White.index()].activity,
                Activity::Stopping { restart: true, .. }
            ),
            "止め終わった後に `go` を出し直す印が立っていない"
        );

        // `A4` — 渡せない。その場で終局させる
        let mut runner = test_runner(&tx);
        runner.players[Side::White.index()].activity = Activity::Unresponsive;
        runner.hand_turn_to(Side::White, "7g7f").await;

        let Phase::Over { result } = &runner.phase else {
            panic!("応答しないエンジンに手番を渡した");
        };
        assert_eq!(result.reason, GameOverReason::EngineFailure);
        assert_eq!(
            result.winner,
            Some(Side::Black),
            "勝ちが相手側になっていない"
        );

        // `A0` — その場で `go`。`engine` が無いので走り出さないが、時計は動く
        let mut runner = test_runner(&tx);
        runner.players[Side::White.index()].activity = Activity::Idle;
        runner.turn_clock = TurnClock::Settling(Instant::now());
        runner.hand_turn_to(Side::White, "7g7f").await;

        assert!(
            matches!(runner.turn_clock, TurnClock::Running(_)),
            "何も走っていない側に渡したのに時計が動き出していない"
        );
    }

    /// 終局は1回しか流れないこと。
    ///
    /// 呼び出し側は全部ガードしているが、その多重が消えたことに気付く経路が無い。
    /// 再入すると `Over` が**2回、別々の `result` で**流れ、受け手は
    /// 最後に受けたほうを採る（`Timeout` の後に届いた `Aborted` が棋譜に残る）。
    #[tokio::test]
    async fn finishing_twice_only_tells_the_app_once() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let events = Arc::new(RecordedEvents::default());
        let mut runner = runner_with_events(&tx, events.clone());

        for reason in [GameOverReason::Timeout, GameOverReason::Aborted] {
            runner
                .finish(GameResult {
                    winner: None,
                    reason,
                    detail: None,
                })
                .await;
        }

        let overs = events
            .take()
            .into_iter()
            .filter(|e| matches!(e, GameEvent::Over { .. }))
            .count();
        assert_eq!(overs, 1, "終局が {overs} 回流れた");
    }

    /// エンジンの側に人間の操作を通さないこと（表の E1 / E4）。
    ///
    /// 通すと、エンジンが考えている最中に人間の手が採られ、返ってきた
    /// `bestmove` は別の局面のものになる。
    #[tokio::test]
    async fn a_seat_played_by_an_engine_refuses_human_moves_and_resignations() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].spec = PlayerSpec::Engine {
            name: "エンジン".to_string(),
            engine_path: "/nonexistent".to_string(),
            work_dir: None,
            options: Vec::new(),
            ponder: false,
        };

        runner
            .accept_human_move(Side::Black, "7g7f".to_string())
            .await
            .expect_err("エンジンの席に人間の着手を通している");
        runner
            .accept_resign(Side::Black)
            .await
            .expect_err("エンジンの席に人間の投了を通している");
    }

    /// 先読み中の側が自分から返した `bestmove` を、着手として採らないこと。
    ///
    /// **先読みは自分から終わることがある**（詰みを見つけた等）。採ると
    /// `decide_move` の `elapsed` は**相手の手番の経過**なので、
    /// 先読み側の時計から相手の消費時間が引かれ、`MoveDecided { side: 先読み側 }` が
    /// フロントへ飛ぶ——**手番の側が指す前に、相手の手が1手積まれる。**
    #[tokio::test]
    async fn a_bestmove_from_the_side_that_is_only_pondering_is_not_taken() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let events = Arc::new(RecordedEvents::default());
        let mut runner = runner_with_events(&tx, events.clone());
        // 手番は先手。後手は先読み中
        runner.players[Side::White.index()].activity = searching(&cancel);

        runner
            .on_search_outcome(
                Side::White,
                1,
                SearchOutcome::Move {
                    usi: "8c8d".to_string(),
                    ponder: None,
                },
            )
            .await;

        assert!(
            matches!(runner.phase, Phase::Thinking { side: Side::Black }),
            "先読み側の `bestmove` を着手として採った"
        );
        assert!(
            !events
                .take()
                .iter()
                .any(|e| matches!(e, GameEvent::MoveDecided { .. })),
            "先読み側の手を `moveDecided` として流している"
        );
    }

    /// 畳み待ち（`Stopping`）を「走っていない」と数えないこと。
    ///
    /// 数えると `close` が待たずに `registry.shutdown` へ進み、**`stop` を
    /// 送っている最中にプロセスが消える**。チャンネル閉塞が
    /// 「エンジンが応答しない」になるので、**正常に閉じるたびに故障のログが出て**
    /// 本物の故障と区別が付かなくなる。
    #[test]
    fn a_search_that_is_still_settling_is_not_idle() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = Activity::Stopping {
            req: 1,
            restart: false,
        };

        assert!(
            !runner.searches_idle(),
            "畳み待ちの探索を「走っていない」と数えた"
        );
    }

    /// `enforce_engine_timeout` の**既定（偽）**が、エンジンの手番で効くこと。
    ///
    /// 既存の時間切れテストは両者とも人間で、`timeout_enforced` は
    /// `!is_engine` で常に真になる経路しか通っていない。外すと、
    /// **「エンジンの時間切れを成立させない」と指定したのに時間切れ負けする。**
    #[tokio::test]
    async fn an_engine_never_loses_on_time_unless_the_app_asked_for_it() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].spec = PlayerSpec::Engine {
            name: "長考するエンジン".to_string(),
            engine_path: "/nonexistent".to_string(),
            work_dir: None,
            options: Vec::new(),
            ponder: false,
        };
        runner.players[Side::Black.index()].has_spoken = true;
        runner.players[Side::Black.index()].activity = searching(&cancel);
        assert!(!runner.settings.enforce_engine_timeout, "既定は偽のはず");

        let budget = runner.clocks.budget_ms(Side::Black);
        runner.turn_clock = TurnClock::Running(long_ago(
            Duration::from_millis(budget) + Duration::from_secs(1),
        ));
        runner.last_progress = Instant::now();

        runner.on_tick().await;
        assert!(!runner.is_over(), "持ち時間を過ぎただけで終局している");

        // 遅れて返ってきた手も採る
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
            "持ち時間を過ぎた後の手を捨てている"
        );
    }

    /// 応答しないエンジンへ手番を渡したら終局し、そこから先へ進まないこと。
    ///
    /// 終局させないと、対局はそのまま止まって拾うのは `SETTLE_TIMEOUT` だけになる。
    /// 終局した後にガードが無いと、`Over` の直後に `TurnChanged` が流れ、
    /// `gameover` を送った側へ `go ponder` を投げにいく（不変条件1 と ※6 の両方）。
    #[tokio::test]
    async fn handing_the_turn_to_an_unresponsive_engine_ends_the_game_and_stops_there() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let events = Arc::new(RecordedEvents::default());
        let mut runner = runner_with_events(&tx, events.clone());
        runner.players[Side::White.index()].activity = Activity::Unresponsive;
        runner.phase = Phase::AwaitingRuling {
            last_mover: Side::Black,
            usi_move: "7g7f".to_string(),
            ponder_move: Some("8c8d".to_string()),
            since: Instant::now(),
        };

        runner
            .accept_continue(vec!["7g7f".to_string()])
            .await
            .expect("正しい列を断っている");

        assert!(
            runner.is_over(),
            "応答しないエンジンへ手番を渡して進めている"
        );
        assert!(
            !events
                .take()
                .iter()
                .any(|e| matches!(e, GameEvent::TurnChanged { .. })),
            "終局した後に手番が変わったことにしている"
        );
    }

    /// 止めるときは `cancel` を撃ち、`restart` の向きを揃えること。
    ///
    /// `cancel` を撃たないと `Activity` だけ `Stopping` になり、探索タスクには
    /// 何も届かない——`stop` すら送られず、時計は `Settling` で止まったまま
    /// `SETTLE_TIMEOUT` で故障扱いになる。
    /// `finish` 側の `restart` を落とし損ねると、終局後に `go` が出る。
    #[tokio::test]
    async fn stopping_a_search_cancels_it_and_sets_the_right_restart() {
        let (tx, _rx) = mpsc::unbounded_channel();

        // 止めて始め直す: cancel して `restart: true`
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = searching(&cancel);
        runner.stop_then_start(Side::Black);
        assert!(cancel.is_cancelled(), "止めるのに cancel を撃っていない");
        assert!(
            matches!(
                runner.players[Side::Black.index()].activity,
                Activity::Stopping { restart: true, .. }
            ),
            "始め直す印が立っていない"
        );

        // 既に畳み待ちなら印を立てるだけ
        runner.players[Side::Black.index()].activity = Activity::Stopping {
            req: 5,
            restart: false,
        };
        runner.stop_then_start(Side::Black);
        assert!(matches!(
            runner.players[Side::Black.index()].activity,
            Activity::Stopping {
                req: 5,
                restart: true
            }
        ));

        // 終局: cancel して `restart: false`
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = searching(&cancel);
        runner.players[Side::White.index()].activity = Activity::Stopping {
            req: 9,
            restart: true,
        };
        runner
            .finish(GameResult {
                winner: None,
                reason: GameOverReason::Aborted,
                detail: None,
            })
            .await;
        assert!(cancel.is_cancelled(), "終局で探索を止めていない");
        assert!(
            matches!(
                runner.players[Side::White.index()].activity,
                Activity::Stopping { restart: false, .. }
            ),
            "終局したのに始め直す印が立ったまま"
        );
    }

    /// 先読み中のエンジンの `info` を画面へ流さないこと（表の ※8）。
    ///
    /// **`is_to_move` の1行がいま守っている唯一のもの。** 冗長と読んで消すと、
    /// 相手の手番中に走っている先読みの読み筋が `searchInfo` として流れ、
    /// **まだ指されていない手の後の評価値**が現局面のものとして画面に出る。
    ///
    /// 既存の `info_from_a_stopped_search_is_not_shown` が見ているのは世代（`req`）だけで、
    /// 手番のほうは見ていない。
    #[test]
    fn info_from_the_side_that_is_only_pondering_is_not_shown() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let events = Arc::new(RecordedEvents::default());
        let mut runner = runner_with_events(&tx, events.clone());
        // 手番は先手。後手は先読み中
        runner.players[Side::White.index()].activity = searching(&cancel);

        runner.on_search_info(Side::White, 1, AnalysisResult::default());

        assert!(
            !events
                .take()
                .iter()
                .any(|e| matches!(e, GameEvent::SearchInfo { .. })),
            "先読み中の読み筋を現局面のものとして流している"
        );
    }

    /// 裁定を通した直後は時計が動いていないこと（表の「時計」節の 3、および ※2）。
    ///
    /// **`turn_clock = Settling` を書く本番の唯一の口が `accept_continue`。**
    /// 消えると `turn_clock` は前の手番の `Running(t0)` のまま残り、
    /// `running_clock()` は**前の手番の開始からの経過**を新しい手番側の消費として返す。
    /// 先読みが外れた局面で手番を受け取ったエンジンが、1ノードも読まないうちに
    /// 相手の長考ぶんを丸ごと請求される。
    ///
    /// 既存の2本はどちらも手で `Settling` を代入しているので、この口は踏んでいない。
    #[tokio::test]
    async fn taking_a_ruling_stops_the_clock_until_the_search_starts() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        // **`Idle` に渡す形だと `begin_turn` が上書きするので隠れる。**
        // 止めてから始め直す側（`StopThenStart`）は `begin_turn` を通らないので、
        // `accept_continue` が置いた `Settling` がそのまま残るはず
        runner.players[Side::White.index()].activity = searching(&cancel);
        runner.turn_clock = TurnClock::Running(long_ago(Duration::from_secs(30)));
        runner.phase = Phase::AwaitingRuling {
            last_mover: Side::Black,
            usi_move: "7g7f".to_string(),
            ponder_move: None,
            since: Instant::now(),
        };

        runner
            .accept_continue(vec!["7g7f".to_string()])
            .await
            .expect("正しい列を断っている");

        assert!(
            runner.running_clock().is_none(),
            "裁定を通した直後に時計が動いている（前の手番の経過が新しい手番へ請求される）"
        );
    }

    /// 裁定が返らないまま `RULING_TIMEOUT` を過ぎたら中断すること（表の `(G1, E15)`）。
    ///
    /// **上限に当たった裁定を「断らずに終局」にした根拠がこの番人。**
    /// 断ると同じ `Err` を返し続けてここに落ち、`detail` は「アプリが裁定を
    /// 返さなかった」と書く——返しているのに。その番人自体に検査が無かった。
    #[tokio::test]
    async fn a_ruling_that_never_comes_back_aborts_the_game() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut runner = test_runner(&tx);
        runner.phase = Phase::AwaitingRuling {
            last_mover: Side::Black,
            usi_move: "7g7f".to_string(),
            ponder_move: None,
            since: long_ago(RULING_TIMEOUT),
        };

        runner.on_tick().await;

        match &runner.phase {
            Phase::Over { result } => {
                assert_eq!(result.reason, GameOverReason::Aborted, "終局の理由が違う");
                assert!(
                    result.winner.is_none(),
                    "裁定が返らないのに勝敗が付いている"
                );
            }
            _ => panic!("裁定が返らないまま留まっている"),
        }
    }

    /// 打ち切った探索の `info` を採らないこと（表の E16 が `Info` にも掛かる）。
    ///
    /// 手番は合っていても、cancel と同時に吐かれた `info` は別の局面のもの。
    /// 採ると、盤に無い局面（外れた先読み手を指した後）の評価値と読み筋が
    /// 一瞬出る。**世代を持たないと照合できない。**
    #[test]
    fn info_from_a_stopped_search_is_not_shown() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let events = Arc::new(RecordedEvents::default());
        let mut runner = runner_with_events(&tx, events.clone());
        runner.players[Side::Black.index()].activity = searching(&cancel);

        // いま走っている探索の `req` は 1（`searching` が立てる）
        runner.on_search_info(Side::Black, 2, AnalysisResult::default());
        assert!(events.take().is_empty(), "世代の合わない読み筋を流している");

        // **落とした行でも「喋る実装だ」の証拠にはなる。**
        // ここを落とすと、`info` を出すエンジンでも沈黙の番人が二度と掛からない
        assert!(
            runner.players[Side::Black.index()].has_spoken,
            "落とした `info` を、喋った証拠として数えていない"
        );

        runner.on_search_info(Side::Black, 1, AnalysisResult::default());
        assert!(
            events
                .take()
                .iter()
                .any(|e| matches!(e, GameEvent::SearchInfo { .. })),
            "いまの探索の読み筋が流れていない"
        );
    }

    /// 終局後に返ってきた `bestmove` で `Activity` が `A0` に戻ること
    /// （表の `(G2, E7)`）。
    ///
    /// **見ているのはそこまで。** `gameover` が実際に飛ぶことは見ていない
    /// ——`send_gameover` の宛先が `UsiProtocol` の具象で、観測する継ぎ目が
    /// 無いため（→ #377）。`Phase::Over` の早期 return を `match` より後ろへ
    /// 動かす変異でも、`activity` の代入はその手前にあるのでここは落ちない。
    /// **セルは踏んでいるが、不変条件3 はまだ守られていない。**
    #[tokio::test]
    async fn a_bestmove_after_the_game_ended_still_gets_a_gameover() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let mut runner = test_runner(&tx);
        runner.players[Side::Black.index()].activity = searching(&cancel);
        runner.phase = Phase::Over {
            result: GameResult {
                winner: Some(Side::White),
                reason: GameOverReason::Resign,
                detail: None,
            },
        };

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

        // 送れたかは protocol が要るので見られないが、**`A0` に戻ること**は
        // 見られる。戻らないと `close` の畳み待ちが必ず上限まで走る
        assert!(
            matches!(runner.players[Side::Black.index()].activity, Activity::Idle),
            "終局後の `bestmove` で `A0` に戻っていない"
        );
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

    /// 通したい形と弾きたい形を並べる。
    ///
    /// **見るのは書式だけ。** 駒の綴りも局面の妥当性もルール側の話で、
    /// この層は「ワイヤに出せる形か」しか見ない（→ `validate_start_sfen`）。
    /// 緩いと、壊れた SFEN が `position sfen <それ>` としてエンジンへ出る。
    #[test]
    fn start_sfen_is_checked_as_a_wire_format() {
        // 通す
        for ok in [
            HIRATE,
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 42",
            // 持ち駒あり・途中局面
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b P2p 7",
        ] {
            assert!(validate_start_sfen(ok).is_ok(), "通らない: {ok}");
        }

        // 弾く
        for (ng, why) in [
            ("startpos", "`position sfen startpos` という壊れた行になる"),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -",
                "手数が無い（3フィールド）",
            ),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1 extra",
                "余分なフィールド",
            ),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1 b - 1",
                "段が8つしかない",
            ),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL x - 1",
                "手番が `b` でも `w` でもない",
            ),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - one",
                "手数が数でない",
            ),
        ] {
            assert!(
                validate_start_sfen(ng).is_err(),
                "弾けていない（{why}）: {ng}"
            );
        }
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
