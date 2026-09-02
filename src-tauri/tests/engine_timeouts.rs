//! 上限どうしの関係のうち、**モジュールを跨ぐもの**を式で固定する。
//!
//! 段を跨ぐ関係は `#[cfg(test)] mod tests` からは見られない
//! （`game` は `analyzer` を `use` できないし、`engine` は crate の他の枝を
//! 知らない）。ここに置くのはそのため。
//!
//! 同じ段の中で閉じる関係は `session.rs` の `the_watchdogs_are_ordered` にある。
//! **散文で「同じ10分」と書かない**——書くと、片方を動かしたときに何も落ちない。

use app_lib::engine::analyzer::MAX_THINK_TIME;
use app_lib::engine::game::session::{CLOSE_ABORT_TIMEOUT, CLOSE_IDLE_TIMEOUT, HARD_TURN_LIMIT};
use app_lib::CLOSE_TIMEOUT;

/// 「1手にこれ以上は待たない」を、対局と解析で同じ値にする。
///
/// 利用者から見れば同じ約束なのに、片方だけ動かすと
/// 「対局では10分待つが解析では5分で切られる」のような食い違いが出る。
/// どちらが正かを決める根拠がどこにも無いので、等値で縛る。
#[test]
fn the_game_and_the_analysis_wait_the_same_for_one_move() {
    assert_eq!(
        HARD_TURN_LIMIT, MAX_THINK_TIME,
        "1手の上限が対局と解析で違う。片方だけ動かしていないか"
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
