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
 * 返せるのは `continueGame` だけ。**こちらから**ルールで終局させることは、
 * それが入るまでできない（投了・中断・時間切れ・エンジンの異常では終わる）。
 * ただし Rust は手数の上限で `rule` を出す——`endGameByRule` を呼んでいなくても届く。
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
  RunningClock,
  GameEvent,
  GameId,
  GameOverReason,
  GamePhaseView,
  GameResult,
  GameSettings,
  GameSnapshot,
  PlayerSpec,
  SetOptionValue,
  Side,
  TimeLimit,
} from "./api/rust-types";
