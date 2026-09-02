//! 上限どうしの関係のうち、**モジュールを跨ぐもの**を式で固定する。
//!
//! 段を跨ぐ関係は `#[cfg(test)] mod tests` からは見られない
//! （`game` は `analyzer` を `use` できないし、`engine` は crate の他の枝を
//! 知らない）。ここに置くのはそのため。
//!
//! 同じ段の中で閉じる関係は `session.rs` の `the_watchdogs_are_ordered` にある。
//! **散文で「同じ10分」と書かない**——書くと、片方を動かしたときに何も落ちない。

use app_lib::engine::game::session::{
    CLOSE_ABORT_TIMEOUT, CLOSE_IDLE_TIMEOUT, HARD_TURN_LIMIT, START_TIMEOUT,
};
use app_lib::engine::protocol::{KILL_TIMEOUT, READY_TIMEOUT, USI_OK_TIMEOUT, WRITE_TIMEOUT};
use app_lib::engine::registry::SPAWN_TIMEOUT;

use app_lib::{CLOSE_TIMEOUT, SWEEP_TIMEOUT};

/// 対局で1手に待ちうる猶予が、終了時の予算より**長い**こと。
///
/// これは意図した関係。固まったエンジンを待つ猶予と、アプリを閉じるときに
/// 待つ時間は別の話で、後者を前者に合わせると終了が10分待たされる。
/// 閉じるときは畳めていなくても落とす（→ `CLOSE_TIMEOUT` の doc）。
///
/// **持ち時間を足さない。** `MAX_TIME_MS` を足すと 4秒 < 24時間 になり、
/// どちらの定数をどう動かしても落ちなくなる（`HARD_TURN_LIMIT` を3秒にしても通る）。
/// ここで守りたいのは持ち時間の話ではなく、**番人の猶予と終了の予算の関係**。
#[test]
fn closing_never_waits_as_long_as_a_stuck_engine() {
    assert!(
        CLOSE_TIMEOUT < HARD_TURN_LIMIT,
        "終了時の予算({CLOSE_TIMEOUT:?})が、固まったエンジンへの猶予({HARD_TURN_LIMIT:?})以上。\
         アプリを閉じるのに対局の番人と同じだけ待つことになる"
    );
}

/// 終了時の予算が、1局を閉じ切る値より**短く**、それでいて
/// **1件の書き込みが着地できるだけはある**こと。
///
/// 上は意図した切り上げで、合わせに行かない（合わせると終了が十数秒待たされる）。
/// 切り上げたぶんは `registry::shutdown_all` の掃除が拾う。
///
/// 下が要るのは、閉じる経路が `gameover` と `quit` を**書く**から。
/// `WRITE_TIMEOUT` を下回ると、1行も書けないまま切り上げる予算になり、
/// エンジンは毎回 `kill` で落ちる——**行儀よく終わる経路が事実上消える**。
///
/// **式で持たないと、片方を動かしたときに何も落ちない。**
#[test]
fn the_close_budget_is_deliberately_short() {
    assert!(
        CLOSE_TIMEOUT < CLOSE_ABORT_TIMEOUT + CLOSE_IDLE_TIMEOUT,
        "CLOSE_TIMEOUT({CLOSE_TIMEOUT:?}) が1局を閉じ切る値以上。\
         合わせに行くなら、終了が何秒待たされるかを測ってから決めること"
    );
    assert!(
        CLOSE_TIMEOUT > WRITE_TIMEOUT,
        "CLOSE_TIMEOUT({CLOSE_TIMEOUT:?}) が1件の書き込みの上限({WRITE_TIMEOUT:?})以下。\
         `gameover` も `quit` も1行も書けないまま切り上げることになる"
    );
}

/// 掃除の予算が、1本を落とす上限より**長い**こと。
///
/// `shutdown_all` は台帳に残った全部を落とす。1本ぶんの `kill` の上限
/// （`KILL_TIMEOUT`）を下回ると、**1本も落とし切れないまま予算が尽きる**。
/// そのときプロセスは残り、回収する仕掛けは無い（→ #353）。
#[test]
fn the_sweep_can_finish_at_least_one_kill() {
    assert!(
        SWEEP_TIMEOUT > KILL_TIMEOUT,
        "SWEEP_TIMEOUT({SWEEP_TIMEOUT:?}) が1本を落とす上限({KILL_TIMEOUT:?})以下。\
         1本も落とし切れないまま予算が尽きる"
    );
}

/// 対局の起動にかける上限が、**段ごとの上限より短い**こと。
///
/// 段ごとの上限（`SPAWN_TIMEOUT` + `USI_OK_TIMEOUT` + `READY_TIMEOUT`）を素直に
/// 足すと全体の締切を大きく超える（関係は `the_steps_alone_would_overrun_the_start_budget`）。
/// その間 `start_game` は返らず、
/// フロントには進捗も残り時間も無く、取り消す口も無い。
///
/// **`READY_TIMEOUT` 単体より短いことを見る。** ここがいちばん長い段で、
/// 逆転していると全体の締切が意味を持たない。
#[test]
fn starting_a_game_is_bounded_below_the_slowest_step() {
    assert!(
        START_TIMEOUT < READY_TIMEOUT,
        "START_TIMEOUT({START_TIMEOUT:?}) が `readyok` を待つ上限({READY_TIMEOUT:?})以上。\
         全体の締切が段ごとの上限に飲まれている"
    );
    assert!(
        START_TIMEOUT > USI_OK_TIMEOUT,
        "START_TIMEOUT({START_TIMEOUT:?}) が `usiok` を待つ上限({USI_OK_TIMEOUT:?})以下。\
         最初の段を待ち切る前に全体が切れる"
    );
}

/// 段ごとの上限を素直に足した値が、全体の締切より**長い**こと。
///
/// **これが逆転したら締切は要らない。** 締切を置いた理由は「段を足すと
/// 締切を大きく超える」なので、足しても収まるなら、締切は何も縮めていないことになる。
///
/// 逆に、この式が成り立つ限り**各段は締切で縮めないと意味がない**
/// （`prepare_engine` が `SPAWN_TIMEOUT.min(left)` を渡しているのはそのため）。
#[test]
fn the_steps_alone_would_overrun_the_start_budget() {
    let one_engine = SPAWN_TIMEOUT + USI_OK_TIMEOUT + READY_TIMEOUT;

    assert!(
        one_engine > START_TIMEOUT,
        "1体ぶんの段({one_engine:?})が全体の締切({START_TIMEOUT:?})以下。\
         締切が何も縮めていない"
    );
}
