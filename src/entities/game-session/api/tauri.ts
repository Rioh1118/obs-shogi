/**
 * 対局の Tauri コマンド。
 *
 * **USI の語彙はここに出てこない。** `isready` / `position` / `go` /
 * `ponderhit` / `gameover` は Rust の中で完結する。ここが扱うのは
 * 対局者・持ち時間・手番・決まった手・終局だけ。
 */
import { invoke } from "@tauri-apps/api/core";
import type { GameId, GameSettings, GameSnapshot, Side } from "./rust-types";

/**
 * 対局を始める。
 *
 * エンジンの起動と `usinewgame` までを済ませて返るので、**返ったときには
 * 手番側が既に考えている**。評価関数の読み込みが重いエンジンではここで
 * 数十秒かかるので、呼び出し側は待っている表示を出すこと。
 */
export async function startGame(settings: GameSettings): Promise<GameId> {
  return await invoke("start_game", { settings });
}

/** 人間の着手。合法性を確かめてから呼ぶ */
export async function submitGameMove(gameId: GameId, side: Side, usiMove: string): Promise<void> {
  return await invoke("submit_game_move", { gameId, side, usiMove });
}

/**
 * 裁定「まだ続く」。`moves` が指し手列の権威になる。
 *
 * `moveDecided` を受けたら、合法性と終局（詰み・千日手・持将棋・最大手数）を
 * 判定して、これか `endGameByRule` のどちらかを呼ぶ。
 * **どちらも呼ばないと対局は進まない。**
 */
export async function continueGame(gameId: GameId, moves: string[]): Promise<void> {
  return await invoke("continue_game", { gameId, moves });
}

/** 裁定「終局」。詰み・千日手・持将棋・最大手数・反則はすべてここから入る */
export async function endGameByRule(
  gameId: GameId,
  winner: Side | null,
  detail: string | null,
): Promise<void> {
  return await invoke("end_game_by_rule", { gameId, winner, detail });
}

/** 人間の投了。エンジンの投了は `bestmove resign` から入るのでここは通らない */
export async function resignGame(gameId: GameId, side: Side): Promise<void> {
  return await invoke("resign_game", { gameId, side });
}

/** 勝敗を付けずに終局にする */
export async function abortGame(gameId: GameId): Promise<void> {
  return await invoke("abort_game", { gameId });
}

/**
 * 対局を閉じ、使っていたエンジンを落とす。
 *
 * **終局しただけでは落ちない**（`gameover` の後に指し直せる形にしてあるため）。
 * 呼ばないとプロセスが残る。
 */
export async function closeGame(gameId: GameId): Promise<void> {
  return await invoke("close_game", { gameId });
}

/**
 * いまの対局の状態を取る。**イベントを取りこぼした後の突き合わせ用。**
 *
 * 進行は `listenToGameEvents` で届くので、常用しない。返る `moves` は Rust が持つ
 * 写しで、**権威はこちら側の棋譜**。`clocks.running` が `null` になる理由は
 * `ClocksView.running` に4つ挙げてある（うち2つは `phase: "thinking"` でも起きる）。
 */
export async function getGameState(gameId: GameId): Promise<GameSnapshot> {
  return await invoke("get_game_state", { gameId });
}

/**
 * 開いている対局の ID。**閉じ忘れを拾うためにある。**
 *
 * 終局してもエンジンのプロセスは落ちない。`closeGame` を呼ばずに画面を離れた
 * 対局はここに残る。
 */
export async function listGames(): Promise<GameId[]> {
  return await invoke("list_games");
}
