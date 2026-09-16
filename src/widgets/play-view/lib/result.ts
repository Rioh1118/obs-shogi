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
 * 終局の理由。**`detail` が付いていれば添える。**
 *
 * `detail` は Rust が入れた英文のこともある（手数の上限、裁定が返らなかった説明）。
 * 自分が `endGameByRule` へ渡した和文とは限らない。
 */
export function gameResultReason(result: GameResult): string {
  const base = REASON_LABEL[result.reason];
  return result.detail === null || result.detail === "" ? base : `${base}（${result.detail}）`;
}

/**
 * **`Record` にしてあるので、理由を1つ足して綴りを書かないと tsc が落ちる。**
 * 既定を持たせると、新しい理由が「不明」として出る。
 *
 * **原因を名乗る名詞で揃える**（ADR-0011 決定1）。「アプリの異常」は
 * 「エンジンの異常」と対になる綴りで、結果を名乗る語（「進行不能」）を当てると
 * 状態行の「終局 ／ 進行不能」が自己矛盾に読める。
 */
const REASON_LABEL: Record<GameOverReason, string> = {
  resign: "投了",
  declareWin: "入玉宣言",
  timeout: "時間切れ",
  engineFailure: "エンジンの異常",
  rule: "規則による終局",
  aborted: "中断",
  rulingTimeout: "アプリの異常",
};
