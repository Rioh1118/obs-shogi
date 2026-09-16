import { describe, expect, test } from "vitest";

import type { GameOverReason, GameResult, Side } from "@/entities/game-session";

import { gameResultLabel, gameResultReason } from "../result";

const PLAYERS = { blackName: "あなた", whiteName: "YaneuraOu" };

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

describe("gameResultLabel", () => {
  /**
   * **勝敗が付かずに終わった回を「引き分け」と名乗らないこと。**
   *
   * 面のいちばん大きい行なので、ここが嘘をつくと、アプリが故障して畳んだ対局を
   * 引き分けとして記録することになる。中断もアプリの異常も必ず `winner: null` で届く。
   */
  test("中断とアプリの異常は引き分けと名乗らない", () => {
    expect(gameResultLabel(resultWith("aborted"), PLAYERS)).toBe("勝敗なし");
    expect(gameResultLabel(resultWith("rulingTimeout"), PLAYERS)).toBe("勝敗なし");
  });

  /** 千日手・最大手数は本物の引き分け。**勝敗なしと同じ綴りにしない** */
  test("規則による引き分けは引き分けと名乗る", () => {
    expect(gameResultLabel(resultWith("rule", "千日手"), PLAYERS)).toBe("引き分け");
  });

  /** 勝者が居れば名前を出す。**印は席の欄と同じ流儀** */
  test("勝者の名前を出す", () => {
    const won = (winner: Side): GameResult => ({ winner, reason: "resign", detail: null });

    expect(gameResultLabel(won("black"), PLAYERS)).toContain("あなた");
    expect(gameResultLabel(won("white"), PLAYERS)).toContain("YaneuraOu");
  });
});
