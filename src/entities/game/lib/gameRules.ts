/**
 * 対局のルール設定。**`GameSettings`（`entities/game-session`）とは別物。**
 * あちらは Rust に渡す対局者・持ち時間・開始局面で、こちらは Rust が持たない
 * 終局の規則（`docs/state-transitions/game-session.md` の「責任の切れ目」）。
 *
 * 値の形は ShogiHome の `SingleGameSettings` に合わせてある
 * （`research/shogihome/02-game.md`）。同じ設定を別の綴りで持つと、
 * 棋譜や設定を行き来させるときに対応表が要る。
 */

/**
 * 持将棋の規則。
 *
 * **`general24` と `general27` は宣言の規則で、`try` だけが自動で終局する。**
 * 前2つは「条件を満たした側が申し出て初めて成立する」ので、満たしただけでは
 * 対局は終わらない（満たしたまま指し続けて勝ちを狙う選択が残る）。
 * どちらの判定に使うかは `judgeDeclaration` と `judgeGameOutcome` に分かれている。
 */
export type JishogiRule = "none" | "general24" | "general27" | "try";

export interface GameRules {
  jishogiRule: JishogiRule;
  /**
   * この手数に達したら引き分けにする。**0 以下なら上限なし。**
   *
   * 数えるのは根からの指し手の総数なので、途中局面から始めた対局では
   * `GameSettings.initialMoves` のぶんも含む（`continueGame` に渡す列の長さと同じ）。
   *
   * **Rust の `MAX_PLIES` とは別の上限。** あちらは `position` の1行が
   * 伸びすぎないための機械的な枷で、超えると `over { reason: "rule" }` が
   * こちらの裁定を待たずに届く。ここはルールとしての最大手数で、
   * 既定はあちらより十分に小さい。
   */
  maxMoves: number;
}

/** ShogiHome の既定値に合わせてある（`research/shogihome/02-game.md` の §4） */
export const DEFAULT_GAME_RULES: GameRules = {
  jishogiRule: "general27",
  maxMoves: 1000,
};
