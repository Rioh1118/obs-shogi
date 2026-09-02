//! 上限どうしの関係のうち、**モジュールを跨ぐもの**を式で固定する。
//!
//! 段を跨ぐ関係は `#[cfg(test)] mod tests` からは見られない
//! （`game` は `analyzer` を `use` できないし、`engine` は crate の他の枝を
//! 知らない）。ここに置くのはそのため。
//!
//! 同じ段の中で閉じる関係は `session.rs` の `the_watchdogs_are_ordered` にある。
//! **散文で「同じ10分」と書かない**——書くと、片方を動かしたときに何も落ちない。

use std::time::Duration;

use app_lib::engine::game::session::{CLOSE_ABORT_TIMEOUT, CLOSE_IDLE_TIMEOUT, HARD_TURN_LIMIT};
use app_lib::engine::game::types::MAX_TIME_MS;
use app_lib::CLOSE_TIMEOUT;

/// 対局で1手に待ちうる最大が、終了時の予算より**長い**こと。
///
/// これは意図した関係。固まったエンジンを待つ時間と、アプリを閉じるときに
/// 待つ時間は別の話で、後者を前者に合わせると終了が何時間も待たされる。
/// 閉じるときは畳めていなくても落とす（→ `CLOSE_TIMEOUT` の doc）。
///
/// **等値で縛らない。** `HARD_TURN_LIMIT` と `MAX_THINK_TIME` は値が同じだが、
/// 約束が違う（前者は持ち時間を使い切った後の猶予、後者は解析の席を握る上限）。
/// 縛ると、解析の席を緩めただけで固まった対局エンジンの猶予まで伸びる。
#[test]
fn closing_never_waits_as_long_as_a_stuck_engine() {
    let longest_turn = Duration::from_millis(MAX_TIME_MS) + HARD_TURN_LIMIT;

    assert!(
        CLOSE_TIMEOUT < longest_turn,
        "終了時の予算({CLOSE_TIMEOUT:?})が、1手に待ちうる最大({longest_turn:?})以上。\
         アプリを閉じるのに対局の番人と同じだけ待つことになる"
    );
}

/// 終了時の予算が、1局を閉じ切る値より**短い**こと。
///
/// これは意図した関係で、合わせに行かない（合わせると終了が十数秒待たされる）。
/// 切り上げたぶんは `registry::shutdown_all` の掃除が拾う。
/// **式で持たないと、片方を動かしたときに何も落ちない。**
#[test]
fn the_close_budget_is_deliberately_short() {
    assert!(
        CLOSE_TIMEOUT < CLOSE_ABORT_TIMEOUT + CLOSE_IDLE_TIMEOUT,
        "CLOSE_TIMEOUT({CLOSE_TIMEOUT:?}) が1局を閉じ切る値以上。\
         合わせに行くなら、終了が何秒待たされるかを測ってから決めること"
    );
}
