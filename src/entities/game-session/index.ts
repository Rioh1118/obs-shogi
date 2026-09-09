/**
 * 対局セッション。**`entities/game` とは別物。**
 * あちらは「棋譜を読んでいる状態」、ここは「対局が進んでいる状態」。
 *
 * 進行の権威は Rust（手番・時計・エンジン）。こちら側が持つのは
 * 局面と指し手列（棋譜）とルールの判定で、`continueGame` が毎手それを渡す。
 * 表は `docs/state-transitions/game-session.md`。
 *
 * 終局の判定は `entities/game` にある。`moveDecided` を受けたら
 * `judgeGameOutcome`（`lib/gameOutcome.ts`）に掛けて、`continueGame` と
 * `endGameByRule` のどちらを返すかを決める。**返るのは詰み・手詰まり・千日手・
 * 連続王手・トライルール・最大手数の6つだけ**で、持将棋の27点法と24点法は
 * 入らない——あちらは宣言の規則なので、利用者の宣言操作から
 * `judgeDeclaration`（`lib/jishogiDeclaration.ts`）を呼ぶ。
 * ただし Rust は手数の上限で `rule` を出す——`endGameByRule` を呼んでいなくても届く。
 *
 * **どちらもまだ `entities/game` の barrel には出していない。** 呼ぶ画面が現れた
 * ときに、最初の呼び出し元と一緒に公開面へ載せる。それまで深い import を
 * 増やさないこと。
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
