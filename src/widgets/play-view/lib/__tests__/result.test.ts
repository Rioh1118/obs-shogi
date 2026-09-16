import { describe, expect, test } from "vitest";

import type { GameOverReason, GameResult } from "@/entities/game-session";

import { gameResultReason } from "../result";

function resultWith(reason: GameOverReason, detail: string | null = null): GameResult {
  return { winner: null, reason, detail };
}

describe("gameResultReason", () => {
  /**
   * **利用者の中断とアプリの故障が同じ語を名乗らないこと。**
   *
   * 受け手の対処が正反対（中断は自分で押したので何も要らない、故障は
   * 名乗らないと気付けない）なので、ここが同じ語になると、画面は
   * 「アプリが壊れた」を一度も言えないか、中断した人に故障を名乗ることになる。
   */
  test("中断とアプリの異常を別の語で名乗る", () => {
    const aborted = gameResultReason(resultWith("aborted"));
    const failure = gameResultReason(resultWith("rulingTimeout"));

    expect(aborted).toBe("中断");
    expect(failure).toBe("アプリの異常");
  });

  /**
   * **`detail` は Rust の英文のことがある。** 裁定が返らなかった回の説明は
   * Rust が入れるので、落とすと何が起きたかを言う文字列が理由の欄から消える
   */
  test("detail が付いていれば添える", () => {
    expect(gameResultReason(resultWith("rulingTimeout", "no ruling came back from the app"))).toBe(
      "アプリの異常（no ruling came back from the app）",
    );
  });

  /** 空文字は「説明が無い」と同じに扱う（空の括弧を描かない） */
  test("空の detail で括弧を出さない", () => {
    expect(gameResultReason(resultWith("aborted", ""))).toBe("中断");
  });
});
