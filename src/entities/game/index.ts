export { GameProvider } from "./model/provider";
export { useGame, useLoadedKifuPath } from "./model/useGame";
export type {
  BoardLine,
  GameContextType,
  GamePersistence,
  MoveGate,
  ShogiMove,
  StandardMoveFormat,
} from "./model/types";

// 終局の判定。呼び出し元は `features/game-ruling`。
//
// **載せるのは、スライスの外に呼び手が居るものだけ。**
// `judgeGameOutcome`（根から組み直す形）は載せない —— 毎手呼ぶ側がそれを使うと
// 合計が手数の2乗で効くので、外へ出す関数は持ち回る側だけにする。
// `GameOutcomeKind` / `JishogiRule` と `judgeDeclaration` も、呼ぶ側が現れるまで載せない
export { createOutcomeJudge } from "./lib/gameOutcome";
export type { GameOutcome, GameOutcomeFailure } from "./lib/gameOutcome";
// 盤の手を対局の境界へ出す綴り。呼び出し元は `features/game-move`
export { fromUsiMove, isPrefixOf, lineUsiMoves, toUsiMove } from "./lib/usiMove";
// 盤の成りの選択を出すかの判定。呼び出し元は `widgets/game-board`
export { canPromote, mustPromote } from "./lib/moveValidation";
export { colorToSide } from "./lib/ruleColor";
export { DEFAULT_GAME_RULES } from "./lib/gameRules";
export type { GameRules } from "./lib/gameRules";
