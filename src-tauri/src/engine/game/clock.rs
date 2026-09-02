//! 対局の持ち時間。
//!
//! 経過時間を外から渡す作りにしてある。`Instant` を内側に持つと
//! 「30 秒使った」をテストで書けない。時刻を測るのは呼び出し側の責任。

use std::time::Duration;
use usi::ThinkParams;

use super::types::{ClockView, ClocksView, RunningClock, Side, TimeLimit};

/// 片側の時計。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SideClock {
    limit: TimeLimit,
    /// 持ち時間の残り。0 になったら以降は毎手 `limit.byoyomi_ms` だけ使える
    remaining_ms: u64,
}

/// 1手ぶんの消費を反映した結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClockOutcome {
    Ok,
    /// 使える時間を超えた。時間切れ
    Expired,
}

impl SideClock {
    pub fn new(limit: TimeLimit) -> Self {
        Self {
            limit,
            remaining_ms: limit.main_ms,
        }
    }

    pub fn remaining_ms(&self) -> u64 {
        self.remaining_ms
    }

    pub fn byoyomi_ms(&self) -> u64 {
        self.limit.byoyomi_ms
    }

    /// この手に使い切れる上限。持ち時間の残り＋秒読み。
    ///
    /// 加算（フィッシャー）は**着手できてから**足すので、ここには入らない。
    /// 入れると、使い切ったのに指せていない状態を「まだ余裕がある」と読む。
    fn budget_ms(&self) -> u64 {
        self.remaining_ms + self.limit.byoyomi_ms
    }

    /// `main_ms` は止まっている値、`byoyomi_ms` は設定値。
    /// 動いている側の持ち時間は `GameClocks::view` の `running` を見る
    pub fn view(&self) -> ClockView {
        ClockView {
            main_ms: self.remaining_ms,
            byoyomi_ms: self.limit.byoyomi_ms,
        }
    }

    /// いま指せなければ時間切れか。時計を進めずに判定する
    pub fn has_expired(&self, elapsed_ms: u64) -> bool {
        elapsed_ms > self.budget_ms()
    }

    /// 1手ぶんの消費を反映する。
    ///
    /// 時間切れなら時計は据え置く（`Expired` を返した後の残り時間に意味は無い）。
    pub fn consume(&mut self, elapsed_ms: u64) -> ClockOutcome {
        if self.has_expired(elapsed_ms) {
            self.remaining_ms = 0;
            return ClockOutcome::Expired;
        }

        let from_main = elapsed_ms.min(self.remaining_ms);
        self.remaining_ms -= from_main;

        // 秒読みで賄った分は持ち時間から引かない。秒読みは毎手与え直される。
        // 加算はここでだけ足す。中断では足さない（着手していないため）
        self.remaining_ms += self.limit.increment_ms;

        ClockOutcome::Ok
    }
}

/// 両者の時計。
#[derive(Debug, Clone, Copy)]
pub struct GameClocks {
    clocks: [SideClock; 2],
}

impl GameClocks {
    pub fn new(black: TimeLimit, white: TimeLimit) -> Self {
        Self {
            clocks: [SideClock::new(black), SideClock::new(white)],
        }
    }

    pub fn get(&self, side: Side) -> &SideClock {
        &self.clocks[side.index()]
    }

    pub fn get_mut(&mut self, side: Side) -> &mut SideClock {
        &mut self.clocks[side.index()]
    }

    /// 画面へ出す形。
    ///
    /// **動いている側は「尽きる時刻」で渡す。** 減っていく値を渡すと、
    /// 滑らかに見せたい側がそれを自分で減らすことになり、
    /// 「持ち時間を使い切ってから秒読みが減り始める」という規則が両側に生える。
    /// 時刻なら受け手は `deadline - now` をクランプするだけで済む。
    ///
    /// `running` はその手に既に使った時間、`now_epoch_ms` は壁時計。
    /// **どちらも外から渡す**（この型は時刻を測らない）。
    pub fn view(&self, running: Option<(Side, u64)>, now_epoch_ms: u64) -> ClocksView {
        let running = running.map(|(side, elapsed_ms)| {
            let clock = &self.clocks[side.index()];

            // 持ち時間を使い切ってから秒読みが減る。
            //
            // **この規則の式は3箇所にある**（ここを含む）。`GameClocks::view` /
            // `SideClock::budget_ms` / `SideClock::consume`。`has_expired` は
            // `budget_ms` に委譲しているので数に入らない。
            // 1つだけ変えると、画面に秒読みが残っているのに時間切れになる
            let main_left = clock.remaining_ms.saturating_sub(elapsed_ms);
            let into_byoyomi = elapsed_ms.saturating_sub(clock.remaining_ms);
            let byoyomi_left = clock.limit.byoyomi_ms.saturating_sub(into_byoyomi);

            RunningClock {
                side,
                main_zero_at: now_epoch_ms.saturating_add(main_left),
                byoyomi_zero_at: now_epoch_ms
                    .saturating_add(main_left)
                    .saturating_add(byoyomi_left),
            }
        });

        ClocksView {
            black: self.clocks[Side::Black.index()].view(),
            white: self.clocks[Side::White.index()].view(),
            running,
        }
    }

    /// `go` に載せる時間。
    ///
    /// USI の `byoyomi` は**1つしか無い**ので、手番側の値を送る。
    /// 先後で秒読みを変えられる設定は表現できず、手番側が優先される。
    pub fn think_params(&self, side: Side) -> ThinkParams {
        let black = &self.clocks[Side::Black.index()];
        let white = &self.clocks[Side::White.index()];

        let mut params = ThinkParams::new()
            .btime(Duration::from_millis(black.remaining_ms))
            .wtime(Duration::from_millis(white.remaining_ms));

        let byoyomi = self.clocks[side.index()].limit.byoyomi_ms;
        if byoyomi > 0 {
            params = params.byoyomi(Duration::from_millis(byoyomi));
        }
        // 秒読みと加算が同じ `go` に載らないのは、**`validate_settings` が
        // 先後をまたいで排他にしている**ため（`session.rs`）。
        // `TimeLimit::validate` は片側の中しか見ないので、そちらでは足りない。
        if black.limit.increment_ms > 0 {
            params = params.binc(Duration::from_millis(black.limit.increment_ms));
        }
        if white.limit.increment_ms > 0 {
            params = params.winc(Duration::from_millis(white.limit.increment_ms));
        }

        params
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sudden_death(main_ms: u64) -> TimeLimit {
        TimeLimit {
            main_ms,
            byoyomi_ms: 0,
            increment_ms: 0,
        }
    }

    fn byoyomi(main_ms: u64, byoyomi_ms: u64) -> TimeLimit {
        TimeLimit {
            main_ms,
            byoyomi_ms,
            increment_ms: 0,
        }
    }

    fn minutes_ms(n: u64) -> TimeLimit {
        sudden_death(n * 60_000)
    }

    fn fischer(main_ms: u64, increment_ms: u64) -> TimeLimit {
        TimeLimit {
            main_ms,
            byoyomi_ms: 0,
            increment_ms,
        }
    }

    #[test]
    fn validate_accepts_every_shape_we_want_to_support() {
        // 弾く方向の変更なので、通したいものを先に並べる（/implement 手順5）
        let allowed = [
            ("切れ負け", sudden_death(600_000)),
            ("秒読みのみ", byoyomi(0, 30_000)),
            ("持ち時間＋秒読み", byoyomi(600_000, 30_000)),
            ("フィッシャー", fischer(300_000, 5_000)),
            ("持ち時間0のフィッシャー", fischer(0, 10_000)),
        ];
        for (label, limit) in allowed {
            assert!(limit.validate().is_ok(), "{label} が弾かれた: {limit:?}");
        }
    }

    #[test]
    fn validate_rejects_byoyomi_with_increment_and_all_zero() {
        let both = TimeLimit {
            main_ms: 600_000,
            byoyomi_ms: 30_000,
            increment_ms: 5_000,
        };
        assert!(both.validate().is_err());

        let nothing = TimeLimit {
            main_ms: 0,
            byoyomi_ms: 0,
            increment_ms: 0,
        };
        assert!(nothing.validate().is_err());
    }

    #[test]
    fn main_time_is_spent_before_byoyomi() {
        let mut clock = SideClock::new(byoyomi(10_000, 30_000));

        assert_eq!(clock.consume(4_000), ClockOutcome::Ok);
        assert_eq!(clock.remaining_ms(), 6_000);

        // 残り 6 秒に対して 20 秒使った。超過 14 秒は秒読み 30 秒で賄える
        assert_eq!(clock.consume(20_000), ClockOutcome::Ok);
        assert_eq!(clock.remaining_ms(), 0);

        // 以降は毎手 30 秒まで
        assert_eq!(clock.consume(29_000), ClockOutcome::Ok);
        assert_eq!(clock.consume(29_000), ClockOutcome::Ok);
    }

    #[test]
    fn byoyomi_is_given_again_every_move_but_not_carried_over() {
        let mut clock = SideClock::new(byoyomi(0, 30_000));

        // 使い切っても次の手でまた 30 秒
        assert_eq!(clock.consume(30_000), ClockOutcome::Ok);
        assert_eq!(clock.consume(30_000), ClockOutcome::Ok);
        // 余らせても持ち越さない
        assert_eq!(clock.consume(1_000), ClockOutcome::Ok);
        assert_eq!(clock.remaining_ms(), 0);
        // 31 秒目で切れる
        assert_eq!(clock.consume(30_001), ClockOutcome::Expired);
    }

    #[test]
    fn sudden_death_expires_when_main_time_runs_out() {
        let mut clock = SideClock::new(sudden_death(5_000));
        assert_eq!(clock.consume(5_000), ClockOutcome::Ok);
        assert_eq!(clock.remaining_ms(), 0);
        assert_eq!(clock.consume(1), ClockOutcome::Expired);
    }

    #[test]
    fn increment_is_added_only_after_a_move_lands() {
        let mut clock = SideClock::new(fischer(10_000, 3_000));

        assert_eq!(clock.consume(4_000), ClockOutcome::Ok);
        assert_eq!(clock.remaining_ms(), 9_000);

        // 使い切ると加算する前に切れる。加算を先に足すと1手ぶん延命してしまう
        assert_eq!(clock.consume(9_001), ClockOutcome::Expired);
    }

    /// 動いている側は「尽きる時刻」で出す。持ち時間が残っている間は
    /// 秒読みの期限が `持ち時間の期限 + 秒読み` になるので、
    /// 受け手が `byoyomi_ms` でクランプすれば満額に見える
    #[test]
    fn a_running_clock_is_published_as_deadlines() {
        let clocks = GameClocks::new(byoyomi(10_000, 30_000), minutes_ms(10));
        const NOW: u64 = 1_700_000_000_000;

        let during_main = clocks
            .view(Some((Side::Black, 4_000)), NOW)
            .running
            .unwrap();
        assert_eq!(during_main.main_zero_at, NOW + 6_000);
        assert_eq!(during_main.byoyomi_zero_at, NOW + 6_000 + 30_000);

        // 持ち時間を使い切った後は、秒読みだけが減る
        let into_byoyomi = clocks
            .view(Some((Side::Black, 15_000)), NOW)
            .running
            .unwrap();
        assert_eq!(into_byoyomi.main_zero_at, NOW);
        assert_eq!(into_byoyomi.byoyomi_zero_at, NOW + 25_000);
    }

    /// 止まっている側は時刻を持たない。**受け手が減らす余地を作らない**
    #[test]
    fn a_stopped_clock_carries_no_deadline() {
        let clocks = GameClocks::new(byoyomi(10_000, 30_000), minutes_ms(10));

        let view = clocks.view(None, 1_700_000_000_000);
        assert!(view.running.is_none());
        assert_eq!(view.black.main_ms, 10_000);
        assert_eq!(view.black.byoyomi_ms, 30_000);
    }

    #[test]
    fn go_carries_both_clocks_and_the_mover_byoyomi() {
        let clocks = GameClocks::new(byoyomi(60_000, 10_000), byoyomi(50_000, 5_000));

        assert_eq!(
            usi::GuiCommand::Go(clocks.think_params(Side::Black)).to_string(),
            "go btime 60000 wtime 50000 byoyomi 10000"
        );
        // 秒読みは手番側の値。USI に byoyomi は1つしか無い
        assert_eq!(
            usi::GuiCommand::Go(clocks.think_params(Side::White)).to_string(),
            "go btime 60000 wtime 50000 byoyomi 5000"
        );
    }

    #[test]
    fn go_carries_increments_for_both_sides() {
        let clocks = GameClocks::new(fischer(40_000, 10_000), fischer(50_000, 10_000));
        assert_eq!(
            usi::GuiCommand::Go(clocks.think_params(Side::Black)).to_string(),
            "go btime 40000 wtime 50000 binc 10000 winc 10000"
        );
    }
}
