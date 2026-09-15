import type { GameResult, GameOverReason } from "@/entities/game-session";
import { sideToColor } from "@/entities/game";
import { turnGlyph } from "@/shared/lib/turn";

/** 勝敗の一行。**引き分けは「どちらの勝ちでもない」ので勝者を出さない** */
export function gameResultLabel(
  result: GameResult,
  players: { blackName: string; whiteName: string },
): string {
  if (result.winner === null) return "引き分け";
  const name = result.winner === "black" ? players.blackName : players.whiteName;
  return `${turnGlyph(sideToColor(result.winner))}${name} の勝ち`;
}

/**
 * 終局の理由。
 *
 * **`aborted` を「中断」とだけ書く。** 利用者が中断したときと、裁定が
 * `RULING_TIMEOUT` の間返らなかったときが同じ値で届くので（#362）、
 * どちらかを名乗ると半分の回で嘘になる。`detail` が付いていればそちらを添える。
 */
export function gameResultReason(result: GameResult): string {
  const base = REASON_LABEL[result.reason];
  return result.detail === null || result.detail === "" ? base : `${base}（${result.detail}）`;
}

/**
 * **`Record` にしてあるので、理由を1つ足して綴りを書かないと tsc が落ちる。**
 * 既定を持たせると、新しい理由が「不明」として出る。
 */
const REASON_LABEL: Record<GameOverReason, string> = {
  resign: "投了",
  declareWin: "入玉宣言",
  timeout: "時間切れ",
  engineFailure: "エンジンの異常",
  rule: "規則による終局",
  aborted: "中断",
};
