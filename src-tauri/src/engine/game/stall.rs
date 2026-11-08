//! 手番が止まったことの監視。
//!
//! 隠すのは「どれだけ待てばエンジンが止まらない・答えないと呼ぶか」の判断で、
//! 上限の長さと、どの信号（持ち時間、沈黙、`info` を出したことがあるか）を見るか。
//! 時間切れ負けの判定（`GameClocks`）とは別物で、`enforce_engine_timeout` を見ない。
//! 終局させるのは `session.rs` の `on_tick` で、ここは止まり方（`Stall`）を返すだけ。

use std::time::{Duration, Instant};

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
pub(super) const SEARCH_GRACE: Duration = Duration::from_secs(30);

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
/// 「エンジンである」が偽になり、`Running` の分岐に一切入らない——
/// 沈黙の腕だけでなく `budget + HARD_TURN_LIMIT` の最後の上限も消える。
pub(super) struct IsEngine(pub(super) bool);

/// そのエンジンがこの局で `info` を1行でも出したことがあるか。→ `IsEngine`
pub(super) struct HasSpoken(pub(super) bool);

/// 手番が長すぎることの監視。**`Thinking` の全部をここ1本で見る。**
///
/// 見るのは「**いまどうなっているか**」（`TurnClock` と持ち時間）で、
/// 「いつ探索を起動したか」ではない。探索タスクの中に締切を置くと、
/// `ponderhit` で先読みから本番へ昇格した探索を観測できない
/// （タスクは起動時の値を握ったまま走るため）。
///
/// **時間切れ負けの判定とは別物。** `enforce_engine_timeout` を見ないのは、
/// これが「黙ったエンジンを見つける」ためにあるから。
///
/// **腕は2本あり、見ている信号が違う。**
///
/// 1本目（`budget_ms` ＋ `HARD_TURN_LIMIT`）は持ち時間を見る。**持ち時間を
/// 過ぎたことだけでは落とさない**——`enforce_engine_timeout` が偽のまま持ち時間が
/// 尽きると `budget_ms` は 0 に張り付くので、持ち時間だけを条件にすると
/// **そこから即座に効き始める**。利用者は「時間切れを成立させない」と指定したのに、
/// 時計が尽きた瞬間から `HARD_TURN_LIMIT` 後に必ず負けることになる。
///
/// 2本目（`silent_for`）は**持ち時間を1つも見ない**。黙っているかどうかは、
/// 持ち時間が残っているかとは別の信号。
///
/// **先読み中の側はここへ来ない。** `on_tick` が渡すのは
/// `Phase::Thinking { side }` の側だけで、先読みしている側は評価の対象に入らない
/// （先読みは `ponderhit` か `stop` が来るまで走ってよい）。
/// `TurnClock` は側を持たないので、外しているのは渡す側。
pub(super) fn stalled_turn(
    clock: TurnClock,
    budget_ms: u64,
    silent_for: Duration,
    thinking_is_an_engine: IsEngine,
    has_spoken: HasSpoken,
) -> Option<Stall> {
    let (thinking_is_an_engine, has_spoken) = (thinking_is_an_engine.0, has_spoken.0);
    // 止め終わり待ちは探索を止めた側の話なので、対局者の種別に関わらず見る
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
    // 区別せずに掛けると、そういうエンジンは**`SEARCH_GRACE` を過ぎた最初の tick で
    // 必ず負ける**
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

/// 手番が進まない理由。**エンジンの状態が違うので潰さない。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Stall {
    /// `stop` を出したのに止め終わらない
    NotStopping,
    /// `go` を出したのに `bestmove` が返らない
    NotAnswering,
}

impl Stall {
    /// 棋譜と画面に残す説明。
    ///
    /// **この文字列を書く場所はここ1箇所。** 同じ物理状態を別の検出器で
    /// 見た側（`SearchOutcome::StopTimedOut` と `Handover::Unusable`）も
    /// ここを通す。手で写すと、どちらの監視が先に当たったかで綴りが変わり、
    /// `GameOverReason` が5経路を1値に潰している以上、**残る差が冠詞だけ**に
    /// なる。腕を足したときに写しを数え直させられないのも同じ理由。
    pub(super) fn detail(self) -> &'static str {
        match self {
            Stall::NotStopping => "the engine did not stop searching in time",
            Stall::NotAnswering => "the engine did not answer in time",
        }
    }
}

/// 手番に入ったまま `go` を出せずにいられる上限。
///
/// **`stalled_turn` の `Settling` の分岐だけが使う。** `Running` の分岐は同じ関数が
/// `budget + HARD_TURN_LIMIT` と `SEARCH_GRACE`（沈黙）の2本で見る。監視は分かれていない。
/// 止め終わり待ちの間は時計が動かないので、時間切れの判定には掛からない。
/// ここが無いと、`stop` の書き込みが詰まったときに対局が無音のまま固まる。
///
/// `search.rs` の `SEARCH_STOP_GRACE` ＋書き込みの上限（`WRITE_TIMEOUT`）より長く取る
/// （関係は `the_watchdogs_are_ordered` が式で見る）。
/// 短いと、正常に止まりつつあるエンジンを故障と呼ぶ。
pub(super) const SETTLE_TIMEOUT: Duration = Duration::from_secs(10);

/// 手番の中で、時計が動いているか止まっているか。
///
/// **どちらの分岐も時刻を持つ。** 止まっている側にも時刻が要るのは、
/// `on_tick` の `SETTLE_TIMEOUT` が「いつから止め終わり待ちか」を見るため。
#[derive(Debug, Clone, Copy)]
pub(super) enum TurnClock {
    /// `go` を出した時刻。時計はここから動く
    Running(Instant),
    /// 手番だが、まだ `go` を出していない。止めた探索の止め終わりを待つ間
    /// （`Activity::Stopping`）がこれで、**その間は時計を動かさない**。
    /// 手番に入った時刻で数えると、エンジンが1手も読んでいない最大 `SEARCH_STOP_GRACE` が
    /// 消費に入り、画面の残り時間も止め終わりに巻き戻る。
    ///
    /// 持つのは**待ち始めた**時刻で、`on_tick` の監視がこれを見る
    Settling(Instant),
}

#[cfg(test)]
mod tests {
    use super::super::fixtures::long_ago;
    use super::*;

    /// 監視が2つの止まり方を分けること。**どちらも `Thinking` の中。**
    ///
    /// 止め終わり待ちと思考中では、エンジンに何が起きているかが違う。
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
            "止め終わり待ちの上限は持ち時間とも便りとも無関係"
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
    /// **正常に読んでいるのに `SEARCH_GRACE` を過ぎた最初の tick で必ず負ける**
    /// ——棋譜に英文の故障理由が残り、
    /// 利用者に無効化する手段が無い（`enforce_engine_timeout` はこの監視を見ない）。
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

        // 止め終わり待ちは種別に関わらず見る（止めた探索の話なので）
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
}
