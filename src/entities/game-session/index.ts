/**
 * 対局セッション。**`entities/game` とは別物。**
 * あちらは「棋譜を読んでいる状態」、ここは「対局が進んでいる状態」。
 *
 * 進行の権威は Rust（手番・時計・エンジン）。こちら側が持つのは
 * 局面と指し手列（棋譜）とルールの判定で、`continueGame` が毎手それを渡す。
 * 表は `docs/state-transitions/game-session.md`。
 *
 * **詰み・千日手・持将棋・最大手数の判定はまだ無い** → #354。
 * `entities/game` にあるのは合法手と成りだけなので、`moveDecided` に対して
 * `continueGame` しか返せない。入るまで対局は終局に辿り着かない。
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
