//! 対局の Tauri コマンド。
//!
//! 1コマンド = 1つの意図。USI のコマンドと1対1にはしない
//! （`position` も `go` も `isready` もここには出てこない）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use crate::engine::utils::{LogThrottle, EMIT_WARN_INTERVAL};

use tauri::Emitter;

use crate::engine::game::events::GameEventSink;
use crate::engine::game::types::GameEvent;
use crate::engine::state::AppState;

use crate::engine::game::types::{GameId, GameSettings, GameSnapshot, Side};

/// 対局を始める。
///
/// `settings` は**実行ファイルのパスを運ぶ**（`PlayerSpec::Engine` の
/// `engine_path` / `work_dir`）。エンジンはワークスペースの外にあるので
/// root 配下の関門は掛からない（→ `tests/root_guard.rs` の `EXEMPT`）。
/// 起こしてよいかを見ているのは `EngineRegistry::spawn` の `canonicalize` と
/// `is_file` / `is_dir` だけ。
///
/// エンジンの起動と `usinewgame` までを待って返る。**最初の `go` は待たない**
/// ——その失敗は `game-event` の `over { reason: engineFailure }` で届くので、
/// **購読は呼ぶ前に張ること。** 最初の `TurnChanged` と最初の `go` は
/// この関数が返る前に走るので、`Ok` を待ってから張ると必ず取りこぼす。
/// 評価関数の読み込みが重いエンジンではここで数十秒かかる。
/// **待たせる長さは `START_TIMEOUT` で決まる**（跨いだ段のぶんは少し超える）。
/// 取り消す口は無いので、それまでは返らない。
#[tauri::command]
pub async fn start_game(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    settings: GameSettings,
) -> Result<GameId, String> {
    state
        .games
        .start(
            Arc::new(TauriEvents {
                app,
                emit_warn: Mutex::new(LogThrottle::new(EMIT_WARN_INTERVAL)),
            }),
            settings,
        )
        .await
}

/// `game-event` のチャンネル名。
///
/// **宛先の語彙なので `game` に置かない。** `DiscardEvents` にとって
/// この綴りは意味を持たない。下に置くと、次に宛先を増やす人が
/// 「チャンネル名は `game` にある」を根拠に、宛先ごとの分岐を状態機械へ書き始める。
const GAME_EVENT: &str = "game-event";

/// `game-event` へ流す宛先。**実装はここ（上の段）に置く。**
///
/// `game` 側に置くと、対局の状態機械が `tauri` を知ることになる。
/// 口（`GameEventSink`）は下が決め、それに合わせるのは上、という向き。
struct TauriEvents {
    app: tauri::AppHandle,
    /// 送信失敗を記録する枠。**1つで足りる。**
    ///
    /// **届かないことは、ここからは観測できない。** `emit` が返す `Err` は
    /// 直列化の失敗と webview への eval の失敗だけで、**購読者がゼロなら成功して返る**
    /// （ウィンドウを閉じても、フロントが購読を外しても `Ok`）。
    /// `GameEvent` が運ぶのは文字列と整数だけなので、直列化はまず失敗しない。
    ///
    /// つまりここに残るのは「起きたら全件起きる」種類の失敗で、
    /// **種別ごとに枠を分ける意味が無い**。分けていたのは
    /// 「宛先が消えると失敗し続ける」という前提の上で、その前提が偽だった。
    ///
    /// **対局が止まった理由は `finish` が書く。** 届かなかったせいで裁定が
    /// 返らなかった場合も、終局の1行に `Aborted` と理由が残る（→ 台帳の F-19）。
    emit_warn: Mutex<LogThrottle>,
}

impl GameEventSink for TauriEvents {
    /// **失敗しても対局を止めない。** 届かないのはフロントの都合で、
    /// エンジンは指し続ける。ここで折ると、画面が落ちただけで対局が壊れる。
    fn emit(&self, event: GameEvent) {
        let kind = event.kind();
        let terminal = event.is_terminal();

        let Err(e) = self.app.emit(GAME_EVENT, event) else {
            return;
        };

        // 立て直しに要るのは「どの局が終わったことになっているか」なので、
        // 絞らず、段も上げて出す。1局に1回しか通らない
        if terminal {
            log::error!(
                target: "obs_shogi::engine::game",
                "emit failed kind={kind}: {e}; the game is over on this side. \
                 the app must resync with get_game_state"
            );
            return;
        }

        // **種別を出す。** 出さないと、届かなかったのが読み筋なのか
        // 手番なのかが分からず、追う先を絞れない
        if self.emit_warn.lock().is_ok_and(|mut w| w.allow()) {
            log::warn!(target: "obs_shogi::engine::game", "emit failed kind={kind}: {e}");
        }
    }
}

/// 断りのログを絞る間隔。
///
/// **`EMIT_WARN_INTERVAL` と揃えない。** あちらはエンジンの出力に付いて出る
/// もので、絞りたいのは秒に何十回という流量。こちらは人の操作か裁定に付いて
/// 出るので、**操作ごとの最初の断りは体感で即座に残ってほしい**。
/// 1秒あれば、案内（`closeGame` の doc）より短い間隔で呼び直す実装の連打も潰せる。
const REJECTION_WARN_INTERVAL: Duration = Duration::from_secs(1);

/// 対局ごとの枠を持てる `(操作, 対局)` の組の数。
///
/// 操作は6つあるので、同時に追える対局は最悪でこの1/6。
///
/// **ここが1間隔に出る行数の一次の上限。** 枠は1間隔に1行しか通さないので、
/// 出る行は最悪で「枠の数 ＋ 操作の数」。**枠を増やすほど連打が通る**ので、
/// 実際に同時に見たい対局の数に見合うところで止める。
const MAX_TRACKED_GAMES: usize = 24;

/// 1間隔に通す断りの行数の**背押さえ**。
///
/// **一次の上限ではない**（それは `MAX_TRACKED_GAMES`）。ここは
/// 「枠の数 ＋ 操作の数」を上回る値にして、**実運用では当たらない**ようにする。
/// 当たる値にすると、断られ続けている鍵が予算を食い切って
/// **別の対局の1件目が枠すら作られずに落ちる**——枠を対局ごとに割った理由が消える。
const MAX_LINES_PER_INTERVAL: u32 = 48;

/// 断りの絞り。**2段で持つ。**
///
/// **対局まで鍵に入れる。** `op` だけで割ると、断られ続けている対局が
/// **他の対局の断りを食う**——A局の裁定が毎回断られている裏で B局が1回
/// 断られても、その1行はどこにも残らない。B局は `RULING_TIMEOUT` で
/// `aborted` になり、ログにその `game_id` が一度も出ない。
///
/// **溢れたぶんは操作ごとの枠へ落とす。** `game_id` は webView から来る
/// 無検証の文字列なので、知らない ID を撃ち続ければ組はいくらでも増える。
/// 溢れたときに写像を捨てる形にすると**絞りが1件も掛からなくなる**——
/// `LogThrottle` は新しい枠の先頭を必ず通すので、捨てた直後の1件が毎回
/// 通り、呼び出しと同じ頻度でログが書かれる。落とす先を用意すれば、
/// 知らない ID の連打は操作ごとに1秒1行へ収まる。
///
/// **長い ID は最初から操作ごとの枠へ。** 鍵に入れると、その文字列は
/// プロセスが終わるまで解放されない（`GameId::is_safe_to_retain`）。
///
/// **満杯になったら、空いた枠から落とす。** 落とす口が無いと、知らない ID を
/// `MAX_TRACKED_GAMES` 回撃つだけで——対局を1つも開かずに数十ミリ秒で済む——
/// 以後**プロセスの寿命ぶん**、走っている対局の断りが全部操作ごとの枠に落ちる。
/// 空いた枠（`LogThrottle::is_open`）は何も覚えていないので、落としても
/// 失われる情報が無い。
///
/// **落とせる枠が無ければ操作ごとの枠へ。** 連打の最中は枠がどれも新しいので
/// 誰も落とせず、その間だけ知らない ID と同じ扱いになる。枠が空く
/// （`REJECTION_WARN_INTERVAL`）と自分の枠を取り戻す。
#[derive(Default)]
struct RejectionThrottles {
    per_game: HashMap<(&'static str, GameId), LogThrottle>,
    per_op: HashMap<&'static str, LogThrottle>,
    /// 1間隔ぶんの窓。開くたびに `spent` を戻す
    window: Option<LogThrottle>,
    /// この窓で通した行数
    spent: u32,
    /// 枠の長さ。**テストから縮められるようにしておく**——
    /// 「枠が空けば取り戻せる」は時間が経たないと見えない
    interval: Option<Duration>,
}

impl RejectionThrottles {
    fn interval(&self) -> Duration {
        self.interval.unwrap_or(REJECTION_WARN_INTERVAL)
    }

    /// 1間隔に出る行数を「枠の数 ＋ 操作の数」で頭打ちにする。
    ///
    /// 枠ごとの絞りは「同じ鍵が続けて通らない」しか言わない。鍵が毎回違えば
    /// 新しい枠が次々にできるので、**枠の数がそのまま1間隔の行数になる**
    /// （枠が120あった時点の実測で121行/秒）。
    ///
    /// `MAX_LINES_PER_INTERVAL` はその上に置く背押さえで、
    /// **実運用では当たらない値**にしてある。
    fn allow(&mut self, op: &'static str, game_id: &GameId) -> bool {
        let interval = self.interval();
        let opened = self
            .window
            .get_or_insert_with(|| LogThrottle::new(interval))
            .allow();
        if opened {
            self.spent = 0;
        }

        // **予算より先に鍵を通す。** 手前で切ると `allow_by_key` に入らないので、
        // 枠が予算の数までしか挿さらず、**満杯のときに空いた枠を落とす枝が
        // どのテストからも踏めなくなる**（消しても緑で通る状態になる）。
        if !self.allow_by_key(op, game_id) {
            return false;
        }
        if self.spent >= MAX_LINES_PER_INTERVAL {
            return false;
        }
        self.spent += 1;
        true
    }

    fn allow_by_key(&mut self, op: &'static str, game_id: &GameId) -> bool {
        // **長さを先に見る。** 照合より前に弾かないと、呼び出し側が選んだ
        // 長さの文字列を毎回複製することになる
        if !game_id.is_safe_to_retain() {
            return self.allow_by_op(op);
        }

        let key = (op, game_id.clone());
        if let Some(throttle) = self.per_game.get_mut(&key) {
            return throttle.allow();
        }
        if self.per_game.len() >= MAX_TRACKED_GAMES {
            self.per_game.retain(|_, throttle| !throttle.is_open());
        }
        if self.per_game.len() < MAX_TRACKED_GAMES {
            let interval = self.interval();
            return self
                .per_game
                .entry(key)
                .or_insert_with(|| LogThrottle::new(interval))
                .allow();
        }
        self.allow_by_op(op)
    }

    fn allow_by_op(&mut self, op: &'static str) -> bool {
        let interval = self.interval();
        self.per_op
            .entry(op)
            .or_insert_with(|| LogThrottle::new(interval))
            .allow()
    }
}

/// **静的に持つ。** `log_rejection` はコマンドの入口から直に呼ぶ自由関数で、
/// `AppState` を通していない。通す形にすると、断りを記録するためだけに
/// 全コマンドの署名が増える。
fn rejection_throttles() -> &'static Mutex<RejectionThrottles> {
    static THROTTLES: OnceLock<Mutex<RejectionThrottles>> = OnceLock::new();
    THROTTLES.get_or_init(Mutex::default)
}

/// 断ったことをログに残す。
///
/// 断り文句は `Err` でフロントへ返るが、**受けた側が捨てると記録がどこにも残らない**。
/// 裁定（`continue_game` / `end_game_by_rule`）を断ると次の手番が始まらず、
/// `RULING_TIMEOUT` を過ぎると「アプリが裁定を返さなかった」で畳まれる。
/// 断った事実がログに無いと、**呼ばなかったのか断られたのかが区別できない**
/// （→ 台帳の F-28）。
///
/// **絞る。** 断り方のうち `the game is busy` は呼び直しを案内してあり
/// （`closeGame` の doc）、その busy 判定はミリ秒で返る。案内は間隔を空けろと
/// 書いているが、**守らせる手立ては無い**——待たずに呼び直す実装は毎秒数百行を
/// 書く。ログは `LOG_FILE_BUDGET` で `KeepOne` なので、**壊れた理由を説明していた `error` の
/// 行が数秒で消える**——`clock_warn` を絞っているのと同じ理由。
///
/// つまりここが守るのは**案内に従わない実装から**であって、従う実装からではない。
///
/// 静かなときの1件は必ず残る（`LogThrottle` は枠の先頭を通す）。
///
/// **拾えないもの**: 連打の中で理由が変わったこと。1間隔の予算
/// （`MAX_LINES_PER_INTERVAL`）を使い切った後に来た断り。枠が満杯で、どれも
/// まだ空いていない間に来た新しい対局の断り。**どちらも続かない**——
/// `REJECTION_WARN_INTERVAL` で予算も枠も戻る。
fn log_rejection<T>(
    op: &'static str,
    game_id: &GameId,
    result: Result<T, String>,
) -> Result<T, String> {
    if let Err(e) = &result {
        let allowed = rejection_throttles()
            .lock()
            .is_ok_and(|mut throttles| throttles.allow(op, game_id));
        if allowed {
            log::warn!(target: "obs_shogi::engine::game", "{op} rejected game={game_id}: {e}");
        }
    }
    result
}

/// 人間の着手。合法性はフロントが確かめてから呼ぶ
#[tauri::command]
pub async fn submit_game_move(
    state: tauri::State<'_, AppState>,
    game_id: GameId,
    side: Side,
    usi_move: String,
) -> Result<(), String> {
    log_rejection(
        "submit_move",
        &game_id,
        state.games.submit_move(&game_id, side, usi_move).await,
    )
}

/// 裁定「まだ続く」。`moves` が指し手列の権威になる。
///
/// `game-event` の `moveDecided` を受けたら、合法性と終局（詰み・千日手・
/// 持将棋・最大手数）を判定して、これか `end_game_by_rule` のどちらかを呼ぶ。
/// **どちらも呼ばないと対局は進まない。**
///
/// **`Ok` は「次の手番が始まった」とは限らない。** 手数が `MAX_PLIES` を
/// 超えていたら終局する（`over { reason: rule }`）。
#[tauri::command]
pub async fn continue_game(
    state: tauri::State<'_, AppState>,
    game_id: GameId,
    moves: Vec<String>,
) -> Result<(), String> {
    log_rejection(
        "continue_game",
        &game_id,
        state.games.continue_game(&game_id, moves).await,
    )
}

/// 裁定「終局」。詰み・千日手・持将棋・最大手数・反則はすべてここから入る
#[tauri::command]
pub async fn end_game_by_rule(
    state: tauri::State<'_, AppState>,
    game_id: GameId,
    winner: Option<Side>,
    detail: Option<String>,
) -> Result<(), String> {
    log_rejection(
        "end_by_rule",
        &game_id,
        state.games.end_by_rule(&game_id, winner, detail).await,
    )
}

/// 人間の投了。エンジンの投了は `bestmove resign` から入るのでここは通らない
#[tauri::command]
pub async fn resign_game(
    state: tauri::State<'_, AppState>,
    game_id: GameId,
    side: Side,
) -> Result<(), String> {
    log_rejection("resign", &game_id, state.games.resign(&game_id, side).await)
}

/// 対局の中断。勝敗を付けずに終局にする
#[tauri::command]
pub async fn abort_game(state: tauri::State<'_, AppState>, game_id: GameId) -> Result<(), String> {
    log_rejection("abort", &game_id, state.games.abort(&game_id).await)
}

/// 対局を閉じ、使っていたエンジンを落とす。
/// **終局しただけでは落ちない。** 呼ばないとプロセスが残る。
///
/// # エラー
///
/// **後始末が要るのは `busy` のときだけ。** 断り方の分類は `GameManager::close`。
///
/// 中断が `CLOSE_ABORT_TIMEOUT` を超えた場合は `Err` にならない（畳めなくても
/// 落としにいく）。→ `docs/state-transitions/failure-surfacing.md` の F-24。
#[tauri::command]
pub async fn close_game(state: tauri::State<'_, AppState>, game_id: GameId) -> Result<(), String> {
    log_rejection("close", &game_id, state.games.close(&game_id).await)
}

/// いまの対局の状態を取る。**イベントを取りこぼした後の突き合わせ用。**
///
/// 進行は `game-event` で届くので、常用しない。返る `moves` は Rust が持つ
/// 写しで、**権威はフロントの棋譜**（食い違いの検出に使う）。
/// `clocks.running` が `null` になる理由は `ClocksView::running` に挙げてある。
#[tauri::command]
pub async fn get_game_state(
    state: tauri::State<'_, AppState>,
    game_id: GameId,
) -> Result<GameSnapshot, String> {
    state.games.snapshot(&game_id).await
}

/// 開いている対局の ID。**閉じ忘れを拾うためにある。**
///
/// 終局してもプロセスは落ちない（不変条件5）ので、`close_game` を呼ばずに
/// 画面を離れた対局はここに残る。
#[tauri::command]
pub async fn list_games(state: tauri::State<'_, AppState>) -> Result<Vec<GameId>, String> {
    Ok(state.games.ids().await)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::time::Instant;

    use crate::engine::utils::LOG_FILE_BUDGET;

    fn id(value: &str) -> GameId {
        GameId::new(value.to_string())
    }

    /// 枠の長さを縮めた絞り。「空けば取り戻せる」は時間が経たないと見えない
    fn quick() -> RejectionThrottles {
        RejectionThrottles {
            interval: Some(Duration::from_millis(20)),
            ..RejectionThrottles::default()
        }
    }

    fn flood(throttles: &mut RejectionThrottles, op: &'static str) {
        for n in 0..MAX_TRACKED_GAMES {
            throttles.allow(op, &id(&format!("junk{n}")));
        }
    }

    /// 断られ続けている対局が、他の対局の1件目を食わないこと。
    ///
    /// 食うと、B局は `RULING_TIMEOUT` で `aborted` になるのに、
    /// ログにその `game_id` が一度も出ない。
    #[test]
    fn a_noisy_game_does_not_eat_another_games_first_line() {
        let mut throttles = RejectionThrottles::default();

        assert!(throttles.allow("continue_game", &id("a")));
        assert!(
            !throttles.allow("continue_game", &id("a")),
            "同じ組を絞れていない"
        );
        assert!(
            throttles.allow("continue_game", &id("b")),
            "別の対局の1件目を食っている"
        );
        assert!(
            throttles.allow("close", &id("a")),
            "別の操作の1件目を食っている"
        );
    }

    /// 絞りの2つの数が、ログの予算と噛み合っていること。
    ///
    /// **どちらも `LOG_FILE_BUDGET` から逆算した値。** 片方だけ動かすと、
    /// 逆算の根拠が静かに崩れる。式で持って、動かした人に数え直させる。
    #[test]
    fn the_limits_are_derived_from_the_log_budget() {
        /// 断りの1行のおおよそのバイト数（`op` ＋ ID ＋ 文言 ＋ ログの接頭辞）
        const APPROX_LINE: u128 = 200;
        /// 操作の数ぶんの余裕。`per_op` の枠がこれだけ上乗せされる
        const OPS_HEADROOM: usize = 8;

        // 1間隔ぶんを出し切っても、予算の1/10を超えない
        let worst = u128::from(MAX_LINES_PER_INTERVAL) * APPROX_LINE;
        assert!(
            worst * 10 <= LOG_FILE_BUDGET,
            "1間隔で予算の1/10を超える（{worst} バイト）。ログが数十秒で一周する"
        );

        // 予算は背押さえ。**実運用で当たると、枠を対局ごとに割った意味が消える**
        assert!(
            MAX_LINES_PER_INTERVAL as usize >= MAX_TRACKED_GAMES + OPS_HEADROOM,
            "予算が枠の数に届いていない。断られ続けている鍵が予算を食い切ると、\
             別の対局の1件目が枠すら作られずに落ちる"
        );
    }

    /// 枠が実際に満杯まで埋まること。
    ///
    /// **満杯にならないと、空いた枠を落とす枝がどのテストからも踏めない。**
    /// 予算を鍵の判定より手前に置いていたときは枠が予算の数までしか挿さらず、
    /// その枝を丸ごと消しても全部緑で通った。
    #[test]
    fn the_frames_actually_fill_up() {
        let mut throttles = quick();
        flood(&mut throttles, "submit_move");

        assert_eq!(
            throttles.per_game.len(),
            MAX_TRACKED_GAMES,
            "枠が満杯まで埋まっていない。空いた枠を落とす枝が踏めない"
        );
    }

    /// 連打が**続いて**も、1間隔に通る行数が上限を超えないこと。
    ///
    /// 枠ごとの絞りは「同じ鍵が続けて通らない」しか言わない。鍵が毎回違えば
    /// 新しい枠が次々にでき、`LogThrottle` は新しい枠の先頭を必ず通すので、
    /// **1間隔あたり枠の数だけ通る**（この上限を外した実測で121行/秒）。
    /// 1行は約170バイトなので、`LOG_FILE_BUDGET` の `KeepOne` は10秒前後で一周する。
    ///
    /// **窓の数で割って見る。** 遅いマシンでは窓が余分に開くぶん通る行が増えるが、
    /// その増え方も式に入っているので、遅さで落ちることはない。
    #[test]
    fn a_sustained_flood_stays_within_the_log_budget() {
        let mut throttles = RejectionThrottles::default();
        let started = Instant::now();

        let mut passed = 0u32;
        for n in 0..20_000 {
            if throttles.allow("submit_move", &id(&format!("flood{n}"))) {
                passed += 1;
            }
        }

        let windows = started.elapsed().as_secs_f64() / REJECTION_WARN_INTERVAL.as_secs_f64();
        // 一次の上限は枠の数。操作は1つしか使っていないので `per_op` は1枠
        let per_window = MAX_TRACKED_GAMES as f64 + 1.0;
        let budget = per_window * (windows + 1.0);
        assert!(
            f64::from(passed) <= budget,
            "1間隔の上限を超えて {passed} 行通っている（予算 {budget:.0}）"
        );
    }

    /// 知らない ID の連打で枠が満杯になっても、**枠が空けば取り戻せる**こと。
    ///
    /// 落とす口が無いと、対局を1つも開かずに数十ミリ秒で満杯にでき、
    /// 以後**プロセスの寿命ぶん**、走っている対局の断りが全部操作ごとの枠へ
    /// 落ちる。A局が毎秒断られている裏で B局が1回断られても、その行はどこにも
    /// 残らない——`RULING_TIMEOUT` で `aborted` になった B局を、ログから追えない。
    ///
    /// **待つ側にしか賭けていない。** 遅いマシンでは窓も枠も余計に空くだけで、
    /// 下の表明はどれも通りやすくなる。
    #[test]
    fn a_flood_does_not_lock_real_games_out_forever() {
        let mut throttles = quick();
        flood(&mut throttles, "submit_move");

        std::thread::sleep(Duration::from_millis(60));

        // 窓が開いて予算が戻り、空いた枠も落とされるので、両方が自分の枠を取れる
        assert!(
            throttles.allow("submit_move", &id("real-a")),
            "枠が空いても取り戻せていない"
        );
        assert!(
            throttles.allow("submit_move", &id("real-b")),
            "別の対局の1件目を食っている"
        );
        assert!(
            !throttles.allow("submit_move", &id("real-b")),
            "自分の枠で絞れていない（まだ共有枠に落ちている）"
        );
    }

    /// 長い ID を鍵として抱え込まないこと。
    ///
    /// 抱えると、その文字列はプロセスが終わるまで解放されない。
    /// `Display` の切り詰めは表示にしか効かない。
    #[test]
    fn a_long_id_is_never_kept_as_a_key() {
        let mut throttles = RejectionThrottles::default();
        let long = id(&"x".repeat(10_000));

        assert!(throttles.allow("submit_move", &long));
        assert!(
            throttles.per_game.is_empty(),
            "長い ID を鍵として持っている"
        );
        assert!(
            !throttles.allow("submit_move", &id(&"y".repeat(10_000))),
            "操作ごとの枠で絞れていない"
        );
    }
}
