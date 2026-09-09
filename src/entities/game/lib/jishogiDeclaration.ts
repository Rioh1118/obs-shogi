/**
 * 入玉宣言（宣言勝ち）が通るかの判定。
 *
 * **1手ごとの終局判定（`judgeGameOutcome`）には入らない。** 27点法も24点法も
 * 宣言した側が申し出て初めて成立する規則で、条件を満たしただけでは対局は終わらない
 * ——満たしたまま指し続けて詰みを狙う選択が残る。自動で終局するのは
 * トライルールだけで、そちらは `judgeGameOutcome` が見る。
 *
 * 呼ぶ口は2つになる。利用者が押す「宣言」と、エンジンの `bestmove win` の検算。
 * **後者はいま繋がっていない**——Rust は `bestmove win` を受けた時点で
 * `GameOverReason::DeclareWin` として終局させ、こちら側に裁定を求めない
 * （`src-tauri/src/engine/game/session.rs` の `SearchOutcome::DeclareWin`）。
 */
import {
  JishogiDeclarationResult,
  JishogiDeclarationRule,
  Position,
  judgeJishogiDeclaration,
} from "tsshogi";

import type { Side } from "@/entities/game-session";
import { Err, Ok, type Result } from "@/shared/lib/result";
import type { JishogiRule } from "./gameRules";
import { sideToTsColor } from "./ruleColor";

/**
 * 宣言の結果。
 *
 * **`lose` と `unavailable` を混ぜないこと。** `lose` は「宣言したが条件を満たさない」で、
 * 宣言した側の反則負けになる。`unavailable` は設定が宣言を認めていない
 * （`none` / `try`）ので、そもそも宣言が起きない。
 *
 * `draw` が返るのは24点法だけ（24点以上31点未満）。
 */
export type DeclarationJudgment = "win" | "lose" | "draw" | "unavailable";

/** 局面を組み立てられなかった。**宣言の可否ではない** */
export type DeclarationFailure = { code: "unplayable_sfen"; sfen: string };

/**
 * 設定を tsshogi の宣言規則へ移す。宣言を認めない設定なら `null`。
 *
 * **`switch` で書く。** `JishogiRule` に値を足したとき、三項の else 側に
 * 吸われて黙って27点法になるのを tsc に止めさせるため
 */
function declarationRuleOf(rule: JishogiRule): JishogiDeclarationRule | null {
  switch (rule) {
    case "general24":
      return JishogiDeclarationRule.GENERAL24;
    case "general27":
      return JishogiDeclarationRule.GENERAL27;
    case "none":
    case "try":
      return null;
  }
}

/**
 * `side` がこの局面で宣言したらどうなるかを返す。
 *
 * 見る条件は入玉宣言法のうち盤から分かるものだけ——手番・玉が敵陣にいること・
 * 王手されていないこと・敵陣の駒が玉を除いて10枚以上・点数。
 * **持ち時間が残っているかは見ない**（時計は Rust が持っている）。
 */
export function judgeDeclaration(
  sfen: string,
  side: Side,
  rule: JishogiRule,
): Result<DeclarationJudgment, DeclarationFailure> {
  const declarationRule = declarationRuleOf(rule);
  if (declarationRule === null) return Ok("unavailable");

  const position = Position.newBySFEN(sfen);
  if (!position) return Err({ code: "unplayable_sfen", sfen });

  switch (judgeJishogiDeclaration(declarationRule, position, sideToTsColor(side))) {
    case JishogiDeclarationResult.WIN:
      return Ok("win");
    case JishogiDeclarationResult.DRAW:
      return Ok("draw");
    case JishogiDeclarationResult.LOSE:
      return Ok("lose");
  }
}
