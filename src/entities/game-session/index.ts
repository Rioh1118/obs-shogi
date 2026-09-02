/**
 * 対局セッション。**`entities/game` とは別物。**
 * あちらは「棋譜を読んでいる状態」、ここは「対局が進んでいる状態」。
 *
 * 進行の権威は Rust（手番・時計・エンジン）。こちら側が持つのは
 * 局面と指し手列（棋譜）とルールの判定で、`continueGame` が毎手それを渡す。
 * 表は `docs/state-transitions/game-session.md`。
 */
export {
  abortGame,
  closeGame,
  continueGame,
  endGameByRule,
  getGameState,
  listGames,
  resignGame,
  startGame,
  submitGameMove,
} from "./api/tauri";
export { GAME_EVENT, listenToGameEvents } from "./api/events";
export type {
  ClocksView,
  ClockView,
  GameEvent,
  GameId,
  GameOverReason,
  GamePhaseView,
  GameResult,
  GameSettings,
  GameSnapshot,
  PlayerSpec,
  Side,
  TimeLimit,
} from "./api/rust-types";
