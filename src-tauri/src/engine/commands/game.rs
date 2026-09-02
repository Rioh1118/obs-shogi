//! 対局の Tauri コマンド。
//!
//! 1コマンド = 1つの意図。USI のコマンドと1対1にはしない
//! （`position` も `go` も `isready` もここには出てこない）。

use std::sync::{Arc, Mutex};

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
                frequent_warn: Mutex::new(LogThrottle::new(EMIT_WARN_INTERVAL)),
                rare_warn: Mutex::new(LogThrottle::new(EMIT_WARN_INTERVAL)),
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
    /// 読み筋と時計の失敗を記録する枠。
    ///
    /// **絞る。** `emit` が失敗する理由（payload、宛先の消失）はイベントごとに
    /// 独立ではないので、一度失敗し始めると全件失敗する。`SearchInfo` は
    /// `info` 行ごと、`ClockUpdated` は `CLOCK_EMIT_INTERVAL` ごとに出るので、
    /// 絞らないと同じ1行がログを一周させ、**原因が書かれた最初の warn ごと消える**。
    frequent_warn: Mutex<LogThrottle>,

    /// 手番と着手の失敗を記録する枠。**高頻度のものと分ける。**
    ///
    /// 1枠を共有すると、読み筋の失敗で枠を使い切った直後の `moveDecided` の
    /// 失敗が黙って捨てられる。**その1行が、なぜ対局が止まったかを説明する
    /// 唯一の記録**（→ 台帳の F-19）。1手に1回なので絞らなくても洪水にならないが、
    /// 宛先が消えた後も出続けるので枠は持つ。
    ///
    /// 終局はここを通らない（`GameEvent::is_terminal`）。
    rare_warn: Mutex<LogThrottle>,
}

impl GameEventSink for TauriEvents {
    /// **失敗しても対局を止めない。** 届かないのはフロントの都合で、
    /// エンジンは指し続ける。ここで折ると、画面が落ちただけで対局が壊れる。
    ///
    /// ただし**黙って捨てると原因が追えない**（届かなかった裁定要求が
    /// `RULING_TIMEOUT` で「アプリが答えなかった」に化ける → 台帳の F-19）。
    fn emit(&self, event: GameEvent) {
        let kind = event.kind();
        let terminal = event.is_terminal();
        let throttle = if event.is_frequent() {
            &self.frequent_warn
        } else {
            &self.rare_warn
        };

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
        // 手番なのかが分からず、対局が止まった理由を追えない
        if throttle.lock().is_ok_and(|mut w| w.allow()) {
            log::warn!(target: "obs_shogi::engine::game", "emit failed kind={kind}: {e}");
        }
    }
}

/// 断ったことをログに残す。
///
/// 断り文句は `Err` でフロントへ返るが、**受けた側が捨てると記録がどこにも残らない**。
/// 裁定（`continue_game` / `end_game_by_rule`）を断ると次の手番が始まらず、
/// 30秒後に `RULING_TIMEOUT` が「アプリが裁定を返さなかった」で畳む。
/// 断った事実がログに無いと、**呼ばなかったのか断られたのかが区別できない**
/// （→ 台帳の F-28）。
///
/// 絞らない。ここを通るのは利用者の操作かフロントの裁定で、1手に数回しか出ない。
fn log_rejection<T>(op: &str, game_id: &GameId, result: Result<T, String>) -> Result<T, String> {
    if let Err(e) = &result {
        log::warn!(target: "obs_shogi::engine::game", "{op} rejected game={game_id}: {e}");
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
/// 断り方は3つあり、**後始末が要るのは1つだけ**。分類は `GameManager::close`。
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
/// `clocks.running` が `null` になる理由は `ClocksView::running` に4つ挙げてある。
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
