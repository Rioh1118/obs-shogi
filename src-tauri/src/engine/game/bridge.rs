//! 対局の Tauri コマンド。
//!
//! 1コマンド = 1つの意図。USI のコマンドと1対1にはしない
//! （`position` も `go` も `isready` もここには出てこない）。

use crate::engine::bridge::AppState;

use super::types::{GameId, GameSettings, GameSnapshot, Side};

/// 対局を始める。
///
/// エンジンの起動と `usinewgame` までを待って返る。**最初の `go` は待たない**
/// ——その失敗は `game-event` の `over { reason: engineFailure }` で届くので、
/// `Ok` を受け取ったら `game-event` を購読してから盤を出すこと。評価関数の読み込みが重いエンジンでは
/// ここで数十秒かかる。
#[tauri::command]
pub async fn start_game(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    settings: GameSettings,
) -> Result<GameId, String> {
    state
        .games
        .start(state.registry.clone(), Some(app), settings)
        .await
}

/// 人間の着手。合法性はフロントが確かめてから呼ぶ
#[tauri::command]
pub async fn submit_game_move(
    state: tauri::State<'_, AppState>,
    game_id: String,
    side: Side,
    usi_move: String,
) -> Result<(), String> {
    state.games.submit_move(&game_id, side, usi_move).await
}

/// 裁定「まだ続く」。`moves` が指し手列の権威になる。
///
/// `game-event` の `moveDecided` を受けたら、合法性と終局（詰み・千日手・
/// 持将棋・最大手数）を判定して、これか `end_game_by_rule` のどちらかを呼ぶ。
/// **どちらも呼ばないと対局は進まない。**
#[tauri::command]
pub async fn continue_game(
    state: tauri::State<'_, AppState>,
    game_id: String,
    moves: Vec<String>,
) -> Result<(), String> {
    state.games.continue_game(&game_id, moves).await
}

/// 裁定「終局」。詰み・千日手・持将棋・最大手数・反則はすべてここから入る
#[tauri::command]
pub async fn end_game_by_rule(
    state: tauri::State<'_, AppState>,
    game_id: String,
    winner: Option<Side>,
    detail: Option<String>,
) -> Result<(), String> {
    state.games.end_by_rule(&game_id, winner, detail).await
}

/// 人間の投了。エンジンの投了は `bestmove resign` から入るのでここは通らない
#[tauri::command]
pub async fn resign_game(
    state: tauri::State<'_, AppState>,
    game_id: String,
    side: Side,
) -> Result<(), String> {
    state.games.resign(&game_id, side).await
}

/// 対局の中断。勝敗を付けずに終局にする
#[tauri::command]
pub async fn abort_game(state: tauri::State<'_, AppState>, game_id: String) -> Result<(), String> {
    state.games.abort(&game_id).await
}

/// 対局を閉じ、使っていたエンジンを落とす。
/// **終局しただけでは落ちない。** 呼ばないとプロセスが残る。
///
/// # エラー
///
/// 他の操作が同じ対局を掴んでいると閉じられず `Err` を返す。そのとき
/// **対局は中断済みだが、エンジンは生きたまま台帳に残る。**
/// そのまま呼び直せる。呼び直さないとプロセスが残る
/// （→ `docs/state-transitions/failure-surfacing.md` の F-24）。
#[tauri::command]
pub async fn close_game(state: tauri::State<'_, AppState>, game_id: String) -> Result<(), String> {
    state.games.close(&state.registry, &game_id).await
}

/// いまの対局の状態を取る。**イベントを取りこぼした後の突き合わせ用。**
///
/// 進行は `game-event` で届くので、常用しない。返る `moves` は Rust が持つ
/// 写しで、**権威はフロントの棋譜**（食い違いの検出に使う）。
/// `clocks.running` が `null` になる理由は `ClocksView::running` に4つ挙げてある。
#[tauri::command]
pub async fn get_game_state(
    state: tauri::State<'_, AppState>,
    game_id: String,
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
