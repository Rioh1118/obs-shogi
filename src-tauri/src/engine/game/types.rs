//! 対局 API の境界に出る型。
//!
//! **進行の語彙をここに出さない。** `usiok` / `readyok` / `isready` /
//! `position` 文字列 / `go` のパラメータ / `ponderhit` / `gameover` は
//! この層の内側で完結する。外に出るのは「いま誰の手番か」「どの手が決まったか」
//! 「時計がどうなっているか」「どう終わったか」。
//!
//! **エンジンを起こすための設定は越える。** `setoption` の名前と値、`ponder`、
//! 根の SFEN、USI の指し手文字列。どれを渡すかを決めるのはフロントなので、
//! 内側に閉じようがない。「USI が1語も出ない」ではなく、
//! **「進行の段取りを外に出さない」**が守っている線。

use serde::{Deserialize, Serialize};

use crate::engine::types::AnalysisResult;

/// 対局セッションを指す値。
///
/// **`String` の別名に戻さない。** 戻すと `registry.shutdown(&game_id)` が
/// 型検査を通り、`EngineRegistry` は知らない ID として `debug` を1行出して
/// **成功で返る**——プロセスは残り、`Result` も `warn` も出ない。
///
/// `EngineId`（`registry.rs`）はまだ別名のまま。`analyzer` / `bridge` に
/// 波及するので別に扱う → #379。
///
/// 線に出る形は文字列のまま（`serde(transparent)`）。TS 側は brand
/// （`entities/game-session/api/rust-types.ts`）で、そちらは引数の並べ替えを止める。
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GameId(String);

impl GameId {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// 静的な写像の鍵として持ってよいか。
    ///
    /// 中身は webview から来る無検証の文字列で、長い値をそのまま持つと
    /// プロセスが終わるまで解放されない領域になる。`Display` の切り詰めは
    /// 表示にしか効かない。
    pub fn is_safe_to_retain(&self) -> bool {
        self.0.len() <= MAX_ID_BYTES
    }
}

/// 文章に出すときと、静的な写像の鍵として持つときの上限。**バイト数で持つ。**
///
/// **文字数で持つと4倍外れる。** 縛りたいのはログ1行の大きさと、
/// 静的な写像が抱える領域で、どちらもバイトで効く。48文字の4バイト文字を
/// 通すと、1行が192バイトになるうえ同じ ID が文言にもう一度載る。
///
/// **数えるのは出す側のバイト数。** 入力を数えると、制御文字だらけの ID が
/// ここの3倍を出す（1バイトが3バイトの置換文字になる）。しかもその ID は
/// 入力が1バイト/文字なので `is_safe_to_retain` も通る。
///
/// **同じ数にしてある。** どちらも根拠は「本物（UUID の36バイト）が収まる」の
/// 1つで、片方だけ動かす理由が無い。片方を広げたくなったら、
/// もう片方に何が起きるかを見てから割ること。
const MAX_ID_BYTES: usize = 48;

/// **文章に出す形は切り詰める。** 中身は webview から来る無検証の文字列で、
/// 長さも制御文字も見ていない。
///
/// 素で出すと、`unknown game: {game_id}` の1行だけでログの予算
/// （`LOG_FILE_BUDGET` ＋ `KeepOne`）を一周させられる——**壊れた理由を
/// 説明していた行が全部消える**。改行を通せば、その後ろに好きなログ行も作れる。
///
/// 台帳を引く側は `as_str` を使うので、切り詰めが照合に効くことはない。
impl std::fmt::Display for GameId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // **数えるのは出す側のバイト数。** 制御文字は1バイトの入力が3バイトの
        // 置換文字になるので、入力を数えると上限を3倍まで超える。
        // 文字の途中で割らないよう、入り切る文字までを出す
        let mut used = 0;
        for ch in self.0.chars() {
            let out = if ch.is_control() { '\u{fffd}' } else { ch };
            if used + out.len_utf8() > MAX_ID_BYTES {
                return f.write_str("…");
            }
            used += out.len_utf8();
            write!(f, "{out}")?;
        }
        Ok(())
    }
}

/// 文章に出したとき**いちばん重くなる** ID。測る側はこれを使う。
///
/// **重いのは長い ID ではなく制御文字の ID。** `Display` は1文字を3バイトの
/// 置換文字へ広げるので、入力が上限より短くても出力は上限まで届く。しかも
/// 入力は1バイト/文字なので `is_safe_to_retain` を通り、静的な写像の鍵としても
/// 正規に入ってくる。「長い ASCII」や「4バイト文字を詰めた ID」で測ると、
/// 広がるぶんを丸ごと見落とす。
///
/// **1箇所で持つ。** 最悪の形を測る側それぞれが選ぶと、片方だけ古くなる。
#[cfg(test)]
pub fn worst_game_id() -> GameId {
    GameId::new("\n".repeat(MAX_ID_BYTES))
}

/// 手番。SFEN の 2 番目のフィールド（`b` / `w`）と対応する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Black,
    White,
}

impl Side {
    pub fn opponent(self) -> Side {
        match self {
            Side::Black => Side::White,
            Side::White => Side::Black,
        }
    }

    /// 配列の添字。`[T; 2]` を先後で引くために使う
    pub fn index(self) -> usize {
        match self {
            Side::Black => 0,
            Side::White => 1,
        }
    }

    pub fn from_sfen_token(token: &str) -> Option<Side> {
        match token {
            "b" => Some(Side::Black),
            "w" => Some(Side::White),
            _ => None,
        }
    }
}

/// `setoption` で送る値1件。**並べた順にそのまま送る。**
///
/// **`engine::types::EngineOption` とは別物。** あちらはエンジンが `usi` の
/// 応答で宣言してくる option の**定義**（型・既定値・現在値）で、向きが逆。
/// 同じ綴りにすると、コメントや報告書で名前を書いた瞬間にどちらか分からなくなる。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetOptionValue {
    pub name: String,
    pub value: String,
}

/// 対局者。
///
/// **人とエンジンを1つの型にまとめてある。** 分岐させると、進行側が
/// 「相手が人かエンジンか」を至る所で見ることになり、
/// 人対人・人対エンジン・エンジン対エンジンを同じ経路で回せなくなる。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlayerSpec {
    Human {
        name: String,
    },
    Engine {
        name: String,
        engine_path: String,
        /// 省略時は実行ファイルの置き場
        work_dir: Option<String>,
        /// `setoption` で送る値。型は持たない（→ `research/shogihome/05-usi-engine.md`）。
        ///
        /// **順序を持つ。** 連想配列にすると反復順がプロセスごとに変わり、
        /// 同じ設定で起動しても `setoption` の並びが実行のたびに違う。
        /// 値の解釈が前の `setoption` に依存するエンジン（`EvalDir` を変えてから
        /// `EvalFile` を指す、`Threads` を上げてから `USI_Hash` を割り当てる）では、
        /// **同じ設定なのに片方の実行だけ棋力が変わる**。ログに残るのは1行ずつなので、
        /// 再現しない差の原因として最後まで疑われない。
        #[serde(default)]
        options: Vec<SetOptionValue>,
        /// 相手の手番の間も読ませるか
        #[serde(default)]
        ponder: bool,
    },
}

impl PlayerSpec {
    pub fn name(&self) -> &str {
        match self {
            PlayerSpec::Human { name } | PlayerSpec::Engine { name, .. } => name,
        }
    }

    pub fn is_engine(&self) -> bool {
        matches!(self, PlayerSpec::Engine { .. })
    }
}

/// 片側の持ち時間。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeLimit {
    /// 持ち時間
    pub main_ms: u64,
    /// 1手ごとに与え直される秒読み
    pub byoyomi_ms: u64,
    /// 着手できたときに持ち時間へ加算する量（フィッシャー）。
    ///
    /// **開始時の残り時間には初手ぶんが既に積まれている**
    /// （`ClockView::main_ms` は `main_ms + increment_ms` から始まる）。
    /// 積まないと「持ち時間0のフィッシャー」で初手に使える時間が 0 になる。
    /// 設定した値をそのまま出したいなら `GameSettings` 側を見ること
    pub increment_ms: u64,
}

/// 1つの欄に置ける上限。24時間。
///
/// **入口で弾く側の防御。** 算術の側は `saturating_add` で守ってあるので、
/// これが無くても溢れはしない。ここで弾くのは、溢れないだけの値
/// （`u64::MAX` に張り付いた持ち時間）が画面と `go` の `btime` に出るのを避けるため。
///
/// 24時間にしたのは、これを超える持ち時間の対局が将棋に無いから。
/// 足りなくなったら上げてよい。
pub const MAX_TIME_MS: u64 = 24 * 60 * 60 * 1000;

impl TimeLimit {
    /// 通したい組み合わせ。
    ///
    /// - 切れ負け: `main > 0`、秒読みも加算も 0
    /// - 秒読み: `byoyomi > 0`。`main` は 0 でもよい（0 なら 30 秒将棋など）
    /// - フィッシャー: `increment > 0`。`main` は 0 でもよい
    /// - 秒読み付きの持ち時間: `main > 0 && byoyomi > 0`
    ///
    /// **弾く形は下の `if` に並べてある。** 数も一覧もここには書かない
    /// （`if` を1つ足すたびに、離れたところが嘘になる）。
    ///
    /// **片側の中しか見ない。** 先後で流儀が違う組み合わせは
    /// `validate_settings`（`session.rs`）が弾く。
    pub fn validate(&self) -> Result<(), String> {
        // 秒読みとフィッシャーを両方送ると、どちらを優先するかがエンジンごとに割れる。
        // GUI 側で決め打つと「設定した通りに指さない」という形で出るので、入口で断る。
        if self.byoyomi_ms > 0 && self.increment_ms > 0 {
            return Err("byoyomi and increment cannot be used together".to_string());
        }
        // 3つとも 0 は「持ち時間が無い」であって、初手で必ず時間切れになる
        if self.main_ms == 0 && self.byoyomi_ms == 0 && self.increment_ms == 0 {
            return Err("time limit must set at least one of main/byoyomi/increment".to_string());
        }
        // 溢れる値を入口で断る。値はフロントから来る任意の `u64`
        for (name, value) in [
            ("main", self.main_ms),
            ("byoyomi", self.byoyomi_ms),
            ("increment", self.increment_ms),
        ] {
            if value > MAX_TIME_MS {
                return Err(format!("{name} time must not exceed {MAX_TIME_MS} ms"));
            }
        }
        Ok(())
    }
}

/// 1局ぶんの設定。
///
/// 連続対局・並列対局はこの型に足さない。足すなら
/// `SingleGameSettings` → `LinearGameSettings` と重ねる
/// （→ `research/shogihome/02-game.md` 2節）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSettings {
    pub black: PlayerSpec,
    pub white: PlayerSpec,
    pub black_time: TimeLimit,
    pub white_time: TimeLimit,
    /// 根の局面の SFEN。`position sfen <これ> moves ...` の形で送る。
    /// **`startpos` は受け付けない**（`usi` crate が `position sfen` を前置するため）
    pub start_sfen: String,
    /// 根から対局開始局面までに既に指されている手。途中局面から始めるときに使う
    #[serde(default)]
    pub initial_moves: Vec<String>,
    /// エンジンの時間切れを GUI 側で成立させるか。
    ///
    /// 既定で成立させないのは、**この打ち切りが当たるのはたいてい GUI 側の
    /// 取りこぼしだから**（→ `research/shogihome/02-game.md` の
    /// `enableEngineTimeout` も既定 false）。人間の時間切れは常に成立する。
    #[serde(default)]
    pub enforce_engine_timeout: bool,
}

/// 終局の理由。
///
/// **将棋のルールを Rust は判定しない。** 詰み・千日手・持将棋・最大手数は
/// フロントが判定して `Rule` として渡す。
///
/// フロントの呼び出しから入るのは `Rule` / `Resign`（人間の投了）/
/// `Aborted`（中断）の3つ。残りは Rust が決める。
/// **`Rule` と `Aborted` は両方から入る**——`Rule` は盤に載る手数の上限
/// （`MAX_PLIES`）、`Aborted` は裁定が返らなかったとき。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameOverReason {
    /// `bestmove resign`、または人間の投了
    Resign,
    /// `bestmove win`（入玉宣言）
    DeclareWin,
    Timeout,
    /// エンジンが応答しない、落ちた、コマンドを送れない
    EngineFailure,
    /// 将棋のルールで終局と判定した。
    ///
    /// **フロントの裁定と、Rust の手数上限（`MAX_PLIES`）の両方から入る。**
    /// 後者は `endGameByRule` を呼んでいないのに届くので、
    /// 「自分が投げた終局のこだま」として捨てないこと。
    Rule,
    /// 利用者の中断（`abort`）。
    ///
    /// **裁定が `RULING_TIMEOUT` 返らなかったときも同じ値**になる。
    /// 区別できるのは `detail` だけ（アプリが落としたほうには文言が入る）。
    /// 受け手の対処は正反対（前者は利用者の意図、後者は故障）。
    /// TODO(#362): 型で分ける
    Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResult {
    /// 勝者。引き分けなら `None`
    pub winner: Option<Side>,
    pub reason: GameOverReason,
    /// 棋譜や画面に残す説明。
    ///
    /// `Rule` のときは、フロントが渡した文言か Rust の手数上限の説明のどちらか。
    /// **`Some` なら捨てないこと**——なぜ終わったかを説明する唯一の文字列になる。
    pub detail: Option<String>,
}

/// 片側の時計。**2つの欄で性質が違う。**
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockView {
    /// 持ち時間の残り。**止まっている値。**
    /// 動いている側の表示には `RunningClock::main_zero_at` を使う。
    ///
    /// 開始時は `TimeLimit::main_ms + increment_ms`。
    /// **利用者が設定した持ち時間そのものではない**（→ `TimeLimit::increment_ms`）
    pub main_ms: u64,
    /// 秒読みの設定値。1手ごとに与え直されるので**常にこの値**。
    /// 動いている側でも、これで `byoyomi_zero_at` をクランプする
    pub byoyomi_ms: u64,
}

/// 動いている側と、その表示が 0 になる時刻。
///
/// **減っていく値ではなく、尽きる時刻を渡す。** 減る値を渡すと、滑らかに
/// 見せたい側がそれを自分で減らすことになり、「持ち時間を使い切ってから
/// 秒読みが減り始める」という規則が**境界の両側に**生える。
/// 時刻なら `deadline - now` のクランプだけで済み、その規則は Rust から出ない。
///
/// 時刻は壁時計（UNIX epoch のミリ秒）。**時間切れの判定には使わない**
/// （そちらは単調時計で測る）。壁時計が飛んでも狂うのは表示だけで、
/// 次の更新で入れ直る。ただし epoch より前を指している間は入れ直らず、
/// `ClocksView::running` が `None` のままになる（同 4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningClock {
    pub side: Side,
    /// 持ち時間の表示が 0 になる時刻
    pub main_zero_at: u64,
    /// 秒読みの表示が 0 になる時刻。持ち時間が残っている間は
    /// `main_zero_at + byoyomi_ms` なので、`byoyomi_ms` でクランプすれば満額に見える
    pub byoyomi_zero_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClocksView {
    pub black: ClockView,
    pub white: ClockView,
    /// 動いている時計。**`None` は「対局が止まった」ではない。**
    ///
    /// `None` になるのは4つ。
    ///
    /// 1. 裁定待ち（`AwaitingRuling`）
    /// 2. 終局後（`Over`）
    /// 3. **手番だが `go` をまだ出していない**（止めた探索の畳み待ち）。
    ///    `phase` は `thinking` のまま。通常は数百ミリ秒、長くて `SETTLE_TIMEOUT`
    /// 4. **壁時計が取れない**（epoch より前を指している）。`phase` は何でもありうる
    ///
    /// 区別できるのは `phase` だけで、3 と 4 は `phase` でも分けられない。
    /// 手番中に `None` が続いても、対局は進んでいる
    pub running: Option<RunningClock>,
}

/// 対局がいまどの段にいるか。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GamePhaseView {
    /// `side` の着手を待っている。
    ///
    /// **時計が動いているとは限らない。** 畳み待ちの間は `clocks.running` が
    /// `null` になる（`ClocksView::running` の 3）
    Thinking {
        side: Side,
    },
    /// 手が決まり、**フロントの裁定を待っている。時計は止まっている。**
    /// `continue_game` か `end_by_rule` が呼ばれるまで対局は進まない
    AwaitingRuling {
        last_mover: Side,
        usi_move: String,
    },
    Over {
        result: GameResult,
    },
}

/// 対局がいまどうなっているか。`get_game_state` の戻り値。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSnapshot {
    pub game_id: GameId,
    pub black_name: String,
    pub white_name: String,
    pub phase: GamePhaseView,
    /// Rust が持っている指し手列。**権威はフロントの棋譜側**で、
    /// これは `continue_game` が毎手上書きする写し。食い違いの検出に使う
    pub moves: Vec<String>,
    pub clocks: ClocksView,
}

/// フロントへ流す対局の出来事。`game-event` で emit する。
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GameEvent {
    /// 手番が変わった。
    ///
    /// **`clocks.running` が `null` のことがある。** 前の探索を畳んでいる間は
    /// `go` をまだ出しておらず、時計はそこからは動かない。動き出したら
    /// 次の `clockUpdated` に載る
    TurnChanged {
        game_id: GameId,
        side: Side,
        clocks: ClocksView,
    },
    /// 手番側の読み筋。人間の手番と先読み中は出ない
    SearchInfo {
        game_id: GameId,
        side: Side,
        result: AnalysisResult,
    },
    /// 手が決まった。**ここで対局は止まる。**
    ///
    /// フロントがこの手の合法性と、指した後の局面が終局かどうか
    /// （詰み・千日手・持将棋・最大手数）を判定し、
    /// `continue_game` か `end_by_rule` を呼ぶまで次の手番は始まらない。
    MoveDecided {
        game_id: GameId,
        side: Side,
        usi_move: String,
        elapsed_ms: u64,
        clocks: ClocksView,
    },
    /// 時計の更新だけ
    ClockUpdated { game_id: GameId, clocks: ClocksView },
    Over {
        game_id: GameId,
        result: GameResult,
        clocks: ClocksView,
    },
}

impl GameEvent {
    /// ログに出す種別名。**中身は出さない**（読み筋がログを埋める）。
    ///
    /// **`_` を足さないこと。** バリアントが増えたらここがコンパイルで落ちる。
    pub fn kind(&self) -> &'static str {
        match self {
            GameEvent::TurnChanged { .. } => "turnChanged",
            GameEvent::SearchInfo { .. } => "searchInfo",
            GameEvent::MoveDecided { .. } => "moveDecided",
            GameEvent::ClockUpdated { .. } => "clockUpdated",
            GameEvent::Over { .. } => "over",
        }
    }

    /// これが届かなかったとき、**後から気付く手立てが無い**か。
    ///
    /// 他のイベントは、届かなくても次のイベントか番人が状況を動かす。
    /// `Over` だけは違う——`Phase::Over` に入った後の `on_tick` は即 return なので
    /// 中断も来ない。落とすと、盤は最後に受けた期限で 00:00 まで描いてから静止し、
    /// **時間切れなのに何も起きない画面**が残る（→ 台帳の F-19）。
    ///
    /// 立て直せるのは `get_game_state` を叩く側だけなので、ここは絞らずに出す。
    ///
    /// **`_` を書かない。** 書くと、足したバリアントが黙って「後から気付ける」側に落ちる。
    pub fn is_terminal(&self) -> bool {
        match self {
            GameEvent::Over { .. } => true,
            GameEvent::TurnChanged { .. }
            | GameEvent::SearchInfo { .. }
            | GameEvent::MoveDecided { .. }
            | GameEvent::ClockUpdated { .. } => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::engine::types::{AnalysisCandidate, Evaluation, EvaluationKind};
    use std::collections::{BTreeMap, BTreeSet};

    /// `GameId` を文章に出すとき、長さと制御文字が抑えられていること（表の外）。
    ///
    /// 中身は webview から来る無検証の文字列。素で出すと1行でログの予算を
    /// 一周させられ、**壊れた理由を説明していた行が全部消える**。
    /// 改行を通せば、その後ろに好きなログ行も作れる。
    #[test]
    fn a_game_id_in_text_is_bounded_and_has_no_control_characters() {
        // 末尾には切ったことを示す1文字が付く
        let cap = MAX_ID_BYTES + '…'.len_utf8();

        for long in [
            GameId::new("x".repeat(10_000)),
            // 置換文字へ広がるので、入力が短くても出力は上限に届く
            worst_game_id(),
        ] {
            let shown = long.to_string();
            assert!(
                shown.len() <= cap,
                "長い ID を切り詰めていない: {} バイト（上限 {cap}）",
                shown.len()
            );
        }

        // **等式で留める。** 不等式だけだと、測る側を軽い入力に差し替えても通る
        // ——`worst_game_id` を `"x".repeat(MAX_ID_BYTES)` にすると、`Display` が
        // 入力のバイト数を数える形に戻しても全部が緑になる。予算の式
        // （`the_log_keeps_a_minimum_of_history_under_rejections`）はこの値を
        // 最悪として組んでいるので、届かなくなったことを知らせる。
        //
        // **`cap` とは比べない。** 置換文字は3バイトなので、埋まるのは3の倍数まで。
        // `cap` で留めると `MAX_ID_BYTES` が3の倍数でないときに落ち、しかも
        // 直す先は `Display` でも `worst_game_id` でもない——読んだ人は
        // 最悪ケースを弱めるか、表明を消すことになる
        let filled = MAX_ID_BYTES / '\u{fffd}'.len_utf8() * '\u{fffd}'.len_utf8();
        assert_eq!(
            worst_game_id().to_string().len(),
            filled + '…'.len_utf8(),
            "最悪の ID が埋まり切っていない。制御文字が置換文字へ広がる形を選び直すこと"
        );

        let sneaky = GameId::new("a\nERROR fake line".to_string());
        let shown = sneaky.to_string();
        assert!(!shown.contains('\n'), "改行をそのまま通している: {shown:?}");

        // 本物は必ず収まる。切り詰めが照合に効かないことは `as_str` が保証する
        let real = GameId::new(uuid::Uuid::new_v4().to_string());
        assert_eq!(real.to_string(), real.as_str());
    }

    /// 境界に出る JSON の形を固定する。
    ///
    /// **`rename_all` は enum のバリアント名にしか効かない。** 中のフィールドを
    /// camelCase にするには `rename_all_fields` が要る（`engine_path` /
    /// `game_id` / `usi_move`）。抜けても型を書き写した TS 側が静かに
    /// `undefined` を読むだけなので、コンパイルでは気付けない。
    #[test]
    fn the_wire_shape_is_camel_case_all_the_way_down() {
        let settings = GameSettings {
            black: PlayerSpec::Human {
                name: "me".to_string(),
            },
            white: PlayerSpec::Engine {
                name: "engine".to_string(),
                engine_path: "/path".to_string(),
                work_dir: None,
                options: Vec::new(),
                ponder: true,
            },
            black_time: TimeLimit {
                main_ms: 1,
                byoyomi_ms: 0,
                increment_ms: 0,
            },
            white_time: TimeLimit {
                main_ms: 1,
                byoyomi_ms: 0,
                increment_ms: 0,
            },
            start_sfen: "sfen b - 1".to_string(),
            initial_moves: Vec::new(),
            enforce_engine_timeout: false,
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains(r#""kind":"engine""#), "{json}");
        assert!(json.contains(r#""enginePath":"/path""#), "{json}");
        assert!(json.contains(r#""workDir":null"#), "{json}");
        assert!(json.contains(r#""blackTime""#), "{json}");
        assert!(json.contains(r#""enforceEngineTimeout""#), "{json}");
        assert!(!json.contains('_'), "snake_case が残っている: {json}");

        let event = GameEvent::MoveDecided {
            game_id: GameId::new("g".to_string()),
            side: Side::Black,
            usi_move: "7g7f".to_string(),
            elapsed_ms: 5,
            clocks: ClocksView {
                black: ClockView {
                    main_ms: 1,
                    byoyomi_ms: 0,
                },
                white: ClockView {
                    main_ms: 1,
                    byoyomi_ms: 0,
                },
                running: Some(RunningClock {
                    side: Side::Black,
                    main_zero_at: 1_700_000_000_000,
                    byoyomi_zero_at: 1_700_000_000_000,
                }),
            },
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""type":"moveDecided""#), "{json}");
        assert!(json.contains(r#""gameId":"g""#), "{json}");
        assert!(json.contains(r#""usiMove":"7g7f""#), "{json}");
        assert!(json.contains(r#""elapsedMs":5"#), "{json}");
        assert!(json.contains(r#""byoyomiMs""#), "{json}");
        assert!(json.contains(r#""mainZeroAt""#), "{json}");
        assert!(json.contains(r#""byoyomiZeroAt""#), "{json}");
        assert!(!json.contains('_'), "snake_case が残っている: {json}");

        let phase = GamePhaseView::AwaitingRuling {
            last_mover: Side::White,
            usi_move: "7g7f".to_string(),
        };
        let json = serde_json::to_string(&phase).unwrap();
        assert!(json.contains(r#""phase":"awaitingRuling""#), "{json}");
        assert!(json.contains(r#""lastMover":"white""#), "{json}");
        assert!(!json.contains('_'), "snake_case が残っている: {json}");

        let result = GameResult {
            winner: Some(Side::Black),
            reason: GameOverReason::DeclareWin,
            detail: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert_eq!(
            json,
            r#"{"winner":"black","reason":"declareWin","detail":null}"#
        );
    }

    /// 全バリアントの見本。**`every_event_is_classified` が宣言と突き合わせる**ので、
    /// 足し忘れるとテストが落ちる
    fn sample_of_every_event() -> Vec<GameEvent> {
        let clocks = ClocksView {
            black: ClockView {
                main_ms: 1,
                byoyomi_ms: 0,
            },
            white: ClockView {
                main_ms: 1,
                byoyomi_ms: 0,
            },
            running: None,
        };
        vec![
            GameEvent::TurnChanged {
                game_id: GameId::new("g".to_string()),
                side: Side::Black,
                clocks,
            },
            GameEvent::SearchInfo {
                game_id: GameId::new("g".to_string()),
                side: Side::Black,
                result: AnalysisResult::default(),
            },
            GameEvent::MoveDecided {
                game_id: GameId::new("g".to_string()),
                side: Side::Black,
                usi_move: "7g7f".to_string(),
                elapsed_ms: 1,
                clocks,
            },
            GameEvent::ClockUpdated {
                game_id: GameId::new("g".to_string()),
                clocks,
            },
            GameEvent::Over {
                game_id: GameId::new("g".to_string()),
                result: GameResult {
                    winner: None,
                    reason: GameOverReason::Aborted,
                    detail: None,
                },
                clocks,
            },
        ]
    }

    /// TS 側の写しに、Rust が線に出す欄が**型ごとに**あること。
    ///
    /// `src/entities/game-session/api/rust-types.ts` は手で写した型で、
    /// **TS 側が見るのは綴りだけ。** Rust に `#[serde(default)]` の無い欄を
    /// 1つ足しても、写しが古いまま tsc は緑で通り、初めて画面を繋いだ人が
    /// `start_game` の実行時 deserialize エラーで詰まる。
    ///
    /// **全部のキーを1つの集合に潰さない。** 潰すと「どの型のどの欄か」が消え、
    /// 別の型やコメントに同じ綴りがあるだけで通る（`GameSnapshot` に `detail` を
    /// 足しても `GameResult` の側にあるので緑、という形）。
    ///
    /// **見るのは Rust → TS の向きだけ。** 逆（TS にあって Rust に無い欄）は
    /// serde が黙って捨てるので、ここでは見ていない。
    #[test]
    fn the_typescript_copy_has_every_field() {
        // `include_str!` はコンパイル時に解決されるので、写しを移したらビルドで落ちる。
        // `AnalysisResult` はこの写しが宣言せず `entities/engine` から取る
        let game_copy = include_str!("../../../../src/entities/game-session/api/rust-types.ts");
        let engine_copy = include_str!("../../../../src/entities/engine/api/rust-types.ts");
        let declared = typescript_fields(&format!("{game_copy}\n{engine_copy}"));

        assert!(
            declared.contains_key("GameSettings") && declared.contains_key("AnalysisCandidate"),
            "写しを読めていない。宣言を {} 個しか拾えていない",
            declared.len()
        );

        // **見本が写しの宣言を覆っていること。** 覆っていない型は
        // 足しても誰も突き合わせないので、見本の足し忘れをここで拾う
        let sampled: BTreeSet<&str> = wire_samples().iter().map(|(name, _)| *name).collect();
        let unchecked: Vec<&String> = declared
            .keys()
            .filter(|name| !sampled.contains(name.as_str()))
            // 欄を持たない型（判別子だけの union）と、解析側だけが使う型は対象外
            .filter(|name| game_copy.contains(&format!("export interface {name} ")))
            .collect();
        assert!(
            unchecked.is_empty(),
            "写しにあるのに見本が無い型がある。`wire_samples` に足すこと:\n{unchecked:?}"
        );

        let mut missing = Vec::new();
        for (name, value) in wire_samples() {
            let Some(fields) = declared.get(name) else {
                missing.push(format!("{name}（写しにこの型が無い）"));
                continue;
            };
            let serde_json::Value::Object(map) = value else {
                panic!("{name} の見本が object でない");
            };
            for key in map.keys() {
                // 判別子は TS では文字列リテラルの union として書かれる
                if ["type", "kind", "phase"].contains(&key.as_str()) {
                    continue;
                }
                if !fields.contains(key.as_str()) {
                    missing.push(format!("{name}.{key}"));
                }
            }
        }

        assert!(
            missing.is_empty(),
            "Rust が線に出す欄が TS の写しに無い。写しを直すこと:\n{missing:?}"
        );
    }

    /// TS の宣言 → その型が持つ欄の名前。
    ///
    /// `export interface X { .. }` と `export type X = { .. } | { .. }` の両方を
    /// 拾う（後者は全バリアントの欄をまとめて1つにする）。
    ///
    /// **空行で切らない。** 切ると、宣言の途中に空行を入れただけで
    /// その後ろの欄が検査から消える。波括弧の深さと `;` で切る。
    fn typescript_fields(source: &str) -> BTreeMap<String, BTreeSet<String>> {
        let mut found: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut current: Option<(String, bool)> = None;
        let mut depth = 0i32;

        for line in source.lines() {
            let trimmed = line.trim();
            let opened = trimmed.matches('{').count() as i32;
            let closed = trimmed.matches('}').count() as i32;

            if current.is_none() {
                let declaration = trimmed
                    .strip_prefix("export interface ")
                    .map(|rest| (rest, true))
                    .or_else(|| {
                        trimmed
                            .strip_prefix("export type ")
                            .map(|rest| (rest, false))
                    });
                if let Some((rest, is_interface)) = declaration {
                    let name = rest
                        .split(|c: char| !c.is_alphanumeric() && c != '_')
                        .next()
                        .unwrap_or("");
                    if !name.is_empty() {
                        found.entry(name.to_string()).or_default();
                        current = Some((name.to_string(), is_interface));
                        depth = 0;
                    }
                }
            }

            let Some((name, is_interface)) = current.clone() else {
                continue;
            };
            // **コメントの中の `名前:` を欄として数えない。** 数えると、写しの側で
            // 欄をコメントへ退避しただけの形（`/** いずれ clocks: .. を足す */`）が
            // 素通りする。この写しは日本語の doc が本体より長い
            for field in fields_in(strip_ts_comment(trimmed)) {
                found.entry(name.clone()).or_default().insert(field);
            }

            depth += opened - closed;
            // **`interface` と union で終わり方が違う。** `interface` は塊が閉じたら
            // 終わり。union は途中のバリアントが `}` で閉じるので、`;` まで続ける
            let ended = if is_interface {
                depth <= 0 && closed > 0
            } else {
                depth <= 0 && trimmed.ends_with(';')
            };
            if ended {
                current = None;
            }
        }
        found
    }

    /// 行からコメントを落とす。`//` 以降と、`/*`〜`*/`、行頭の `*`（複数行 doc の続き）。
    ///
    /// **潰さないと、コメントに書いた `名前:` が欄として数えられる。**
    fn strip_ts_comment(line: &str) -> &str {
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") || trimmed.starts_with('*') || trimmed.starts_with("/*") {
            // `/** a: X */ b: Y;` のように後ろにコードが続く形だけ拾う
            return match trimmed.find("*/") {
                Some(at) if !trimmed.starts_with("//") => &trimmed[at + 2..],
                _ => "",
            };
        }
        match line.find("//") {
            Some(at) => &line[..at],
            None => line,
        }
    }

    /// 1行に現れる `名前:` / `名前?:` の名前。union の1行書き（`{ a: X; b: Y }`）も拾う
    fn fields_in(line: &str) -> Vec<String> {
        let mut found = Vec::new();
        for (at, _) in line.match_indices(':') {
            let head = line[..at].trim_end();
            let head = head.strip_suffix('?').unwrap_or(head);
            let name: String = head
                .chars()
                .rev()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            // 直前が識別子の一部でない（`a.b:` のような形を拾わない）
            let before = head[..head.len() - name.len()].chars().next_back();
            if name.is_empty() || matches!(before, Some('.') | Some('"')) {
                continue;
            }
            found.push(name);
        }
        found
    }

    /// 線に出る型ごとの見本。**空のコレクションを置かない**
    /// ——空だと中身の欄が1つも JSON に現れず、その型は突き合わせから消える。
    fn wire_samples() -> Vec<(&'static str, serde_json::Value)> {
        let candidate = AnalysisCandidate {
            rank: 1,
            first_move: Some("7g7f".to_string()),
            pv_line: vec!["7g7f".to_string()],
            evaluation: Some(Evaluation {
                value: 42,
                kind: EvaluationKind::Centipawn,
            }),
            depth: Some(12),
            nodes: Some(1000),
            time_ms: Some(500),
        };
        let result = AnalysisResult {
            candidates: vec![candidate.clone()],
            mate_sequence: Some(vec!["7g7f".to_string()]),
        };
        let clocks = sample_snapshot().clocks;

        let mut samples: Vec<(&'static str, serde_json::Value)> = vec![
            (
                "GameSettings",
                serde_json::to_value(sample_settings()).expect("設定"),
            ),
            (
                "GameSnapshot",
                serde_json::to_value(sample_snapshot()).expect("状態"),
            ),
            ("ClocksView", serde_json::to_value(clocks).expect("時計")),
            (
                "ClockView",
                serde_json::to_value(clocks.black).expect("片側の時計"),
            ),
            (
                "RunningClock",
                serde_json::to_value(clocks.running.expect("見本は動いている"))
                    .expect("動いている時計"),
            ),
            (
                "TimeLimit",
                serde_json::to_value(sample_settings().black_time).expect("持ち時間"),
            ),
            (
                "SetOptionValue",
                serde_json::to_value(SetOptionValue {
                    name: "USI_Hash".to_string(),
                    value: "256".to_string(),
                })
                .expect("option"),
            ),
            (
                "GameResult",
                serde_json::to_value(GameResult {
                    winner: Some(Side::Black),
                    reason: GameOverReason::Resign,
                    detail: Some("投了".to_string()),
                })
                .expect("結果"),
            ),
            (
                "PlayerSpec",
                serde_json::to_value(sample_settings().black).expect("人"),
            ),
            (
                "PlayerSpec",
                serde_json::to_value(sample_settings().white).expect("エンジン"),
            ),
            (
                "GamePhaseView",
                serde_json::to_value(GamePhaseView::Thinking { side: Side::Black }).expect("段"),
            ),
            (
                "GamePhaseView",
                serde_json::to_value(sample_snapshot().phase).expect("段"),
            ),
            (
                "GamePhaseView",
                serde_json::to_value(GamePhaseView::Over {
                    result: GameResult {
                        winner: None,
                        reason: GameOverReason::Aborted,
                        detail: None,
                    },
                })
                .expect("段"),
            ),
            (
                "AnalysisResult",
                serde_json::to_value(&result).expect("解析結果"),
            ),
            (
                "AnalysisCandidate",
                serde_json::to_value(&candidate).expect("候補手"),
            ),
            (
                "Evaluation",
                serde_json::to_value(candidate.evaluation.expect("見本は評価を持つ"))
                    .expect("評価"),
            ),
        ];
        for event in sample_of_every_event() {
            samples.push(("GameEvent", serde_json::to_value(&event).expect("出来事")));
        }
        samples
    }

    fn sample_settings() -> GameSettings {
        GameSettings {
            black: PlayerSpec::Human {
                name: "me".to_string(),
            },
            white: PlayerSpec::Engine {
                name: "engine".to_string(),
                engine_path: "/path".to_string(),
                work_dir: Some("/dir".to_string()),
                options: vec![SetOptionValue {
                    name: "USI_Hash".to_string(),
                    value: "256".to_string(),
                }],
                ponder: true,
            },
            black_time: TimeLimit {
                main_ms: 1,
                byoyomi_ms: 0,
                increment_ms: 0,
            },
            white_time: TimeLimit {
                main_ms: 1,
                byoyomi_ms: 0,
                increment_ms: 0,
            },
            start_sfen: "sfen b - 1".to_string(),
            initial_moves: vec!["7g7f".to_string()],
            enforce_engine_timeout: false,
        }
    }

    fn sample_snapshot() -> GameSnapshot {
        GameSnapshot {
            game_id: GameId::new("g".to_string()),
            black_name: "me".to_string(),
            white_name: "engine".to_string(),
            phase: GamePhaseView::AwaitingRuling {
                last_mover: Side::Black,
                usi_move: "7g7f".to_string(),
            },
            moves: vec!["7g7f".to_string()],
            clocks: ClocksView {
                black: ClockView {
                    main_ms: 1,
                    byoyomi_ms: 0,
                },
                white: ClockView {
                    main_ms: 1,
                    byoyomi_ms: 0,
                },
                running: Some(RunningClock {
                    side: Side::Black,
                    main_zero_at: 1,
                    byoyomi_zero_at: 1,
                }),
            },
        }
    }

    /// 出来事の分類が、バリアントを足したときに黙って既定へ落ちないこと。
    ///
    /// **見本は宣言から突き合わせる。** 手で並べた見本は、バリアントを足した
    /// 時点で古くなり、足したものが分類されていないことに誰も気付かない。
    /// `include_str!` で自分の宣言を読み、見本が全バリアントを覆っているかを見る。
    #[test]
    fn every_event_is_classified() {
        let source = include_str!("types.rs");
        let body = source
            .split_once("pub enum GameEvent {")
            .expect("GameEvent の宣言が見つからない")
            .1;
        let declared: Vec<&str> = body
            .lines()
            .take_while(|line| *line != "}")
            .map(|line| line.trim().split([' ', '{', ',']).next().unwrap_or(""))
            .filter(|token| token.starts_with(char::is_uppercase))
            .collect();
        assert!(!declared.is_empty(), "宣言を1つも拾えていない");

        let samples = sample_of_every_event();
        let covered: Vec<String> = samples
            .iter()
            .map(|e| {
                let kind = e.kind();
                let mut chars = kind.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            })
            .collect();
        for name in &declared {
            assert!(
                covered.iter().any(|c| c == name),
                "{name} の見本が無い。分類（is_terminal）も見られていない"
            );
        }
        assert_eq!(declared.len(), samples.len(), "見本が余っている");

        // 終局は「後から気付けない」側なので、絞る枠に載せてはいけない
        let terminal: Vec<&str> = samples
            .iter()
            .filter(|e| e.is_terminal())
            .map(|e| e.kind())
            .collect();
        assert_eq!(terminal, vec!["over"], "終局として扱う出来事が変わっている");
    }

    /// フロントから届く形をそのまま読めること。
    /// 省略できる項目（`workDir` / `options` / `ponder` / `initialMoves` /
    /// `enforceEngineTimeout`）を落としても通る
    #[test]
    fn settings_parse_with_every_optional_field_omitted() {
        let json = r#"{
            "black": { "kind": "human", "name": "me" },
            "white": { "kind": "engine", "name": "e", "enginePath": "/p" },
            "blackTime": { "mainMs": 600000, "byoyomiMs": 0, "incrementMs": 0 },
            "whiteTime": { "mainMs": 600000, "byoyomiMs": 0, "incrementMs": 0 },
            "startSfen": "sfen b - 1"
        }"#;
        let settings: GameSettings = serde_json::from_str(json).unwrap();
        assert!(settings.initial_moves.is_empty());
        assert!(!settings.enforce_engine_timeout);
        match settings.white {
            PlayerSpec::Engine {
                ponder, work_dir, ..
            } => {
                assert!(!ponder);
                assert_eq!(work_dir, None);
            }
            _ => panic!("engine として読めていない"),
        }
    }

    /// `setoption` の順序が線を往復しても変わらないこと。
    ///
    /// **連想配列にすると壊れる。** 反復順がプロセスごとに変わるので、
    /// 同じ設定で起動しても `setoption` の並びが実行のたびに違う。
    /// 値の解釈が前の `setoption` に依存するエンジンでは、
    /// 同じ設定なのに片方の実行だけ棋力が変わる。
    #[test]
    fn engine_options_keep_the_order_the_app_put_them_in() {
        let json = r#"{
            "black": { "kind": "human", "name": "me" },
            "white": {
                "kind": "engine", "name": "e", "enginePath": "/p",
                "options": [
                    { "name": "EvalDir", "value": "/eval" },
                    { "name": "EvalFile", "value": "nn.bin" },
                    { "name": "Threads", "value": "4" }
                ]
            },
            "blackTime": { "mainMs": 600000, "byoyomiMs": 0, "incrementMs": 0 },
            "whiteTime": { "mainMs": 600000, "byoyomiMs": 0, "incrementMs": 0 },
            "startSfen": "sfen b - 1"
        }"#;
        let settings: GameSettings = serde_json::from_str(json).unwrap();

        let PlayerSpec::Engine { options, .. } = &settings.white else {
            panic!("engine として読めていない");
        };
        let names: Vec<&str> = options.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, ["EvalDir", "EvalFile", "Threads"]);

        // 書き戻しても崩れないこと。片道だけ順序を持っても意味が無い
        let back = serde_json::to_string(&settings).unwrap();
        let round: GameSettings = serde_json::from_str(&back).unwrap();
        let PlayerSpec::Engine { options, .. } = &round.white else {
            panic!("engine として読めていない");
        };
        let names: Vec<&str> = options.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, ["EvalDir", "EvalFile", "Threads"]);
    }
}
