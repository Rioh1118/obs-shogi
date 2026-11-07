//! 対局のテストが共有する設定と時刻。`game/` の中のテストからだけ使う。

use std::time::{Duration, Instant};

use super::types::*;

/// 平手。`GuiCommand::Position` が `position sfen` を前置するので、
/// `startpos` ではなく完全な SFEN を持つ
pub(super) const HIRATE: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

pub(super) fn minutes(n: u64) -> TimeLimit {
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
pub(super) fn two_humans(initial_moves: Vec<&str>) -> GameSettings {
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

/// `d` だけ前の時刻。番人の締切を跨がせるのに使う
pub(super) fn long_ago(d: Duration) -> Instant {
    Instant::now()
        .checked_sub(d)
        .expect("起動直後で `Instant` を遡れない")
}
