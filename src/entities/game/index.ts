export * from "./model/provider";
export * from "./model/useGame";
export * from "./model/types";

// 終局の判定。**最初の呼び出し元（`app/providers/bridges/GameSessionBridge`）と
// 一緒に公開面へ載せた**（`entities/game-session/index.ts` の doc）。
// `judgeDeclaration` はまだ呼ぶ側が無いので載せない
export { judgeGameOutcome } from "./lib/gameOutcome";
export type { GameOutcome, GameOutcomeFailure, GameOutcomeKind } from "./lib/gameOutcome";
export { DEFAULT_GAME_RULES } from "./lib/gameRules";
export type { GameRules, JishogiRule } from "./lib/gameRules";
