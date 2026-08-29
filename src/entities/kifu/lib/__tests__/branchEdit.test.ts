import { describe, expect, test, vi } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { MAIN_LINE, branchIndexFromForkIndex } from "@/entities/kifu/model/branch";
import { deleteBranchInKifu, swapBranchesInKifu } from "../branchEdit";

/**
 * 分岐編集は `forks` の形しか見ないので、指し手の中身は区別が付く印で足りる。
 * 印は `comments` に入れる（`move` を持たせると tsshogi の検証が要る）。
 */
function mv(tag: string, forks?: JKFMove[][]): JKFMove {
  return forks ? { comments: [tag], forks } : { comments: [tag] };
}

/** te=2 に変化が2本ぶら下がった棋譜。te=1 は共通。 */
function kifuWithTwoForks(): JKFData {
  return {
    header: {},
    moves: [mv("root"), mv("t1"), mv("main2", [[mv("f0")], [mv("f1")]]), mv("main3")],
  };
}

const tags = (moves: JKFMove[] | undefined) => moves?.map((m) => m.comments?.[0]);

describe("swapBranchesInKifu", () => {
  test("本譜と変化1を入れ替えると、te 以降の並びごと入れ替わる", () => {
    const kifu = kifuWithTwoForks();
    const res = swapBranchesInKifu(
      kifu,
      { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
      null,
    );

    expect(res.changed).toBe(true);
    expect(tags(kifu.moves)).toEqual(["root", "t1", "f0"]);
    expect(kifu.moves[2].forks?.map(tags)).toEqual([["main2", "main3"], ["f1"]]);
  });

  test("入れ替えた候補どうしが同じオブジェクトを共有しない", () => {
    const kifu = kifuWithTwoForks();
    swapBranchesInKifu(
      kifu,
      { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
      null,
    );

    // 片方を書き換えたときにもう片方が動くと、次の編集で無関係な変化が壊れる。
    kifu.moves[2].comments = ["touched"];
    expect(kifu.moves[2].forks?.[0][0].comments).toEqual(["main2"]);
  });
});

describe("deleteBranchInKifu", () => {
  test("本譜を消すと変化1が本譜に繰り上がり、残りの変化が1つ詰まる", () => {
    const kifu = kifuWithTwoForks();
    const res = deleteBranchInKifu(kifu, { te: 2, forkPointers: [], target: MAIN_LINE }, null);

    expect(res.changed).toBe(true);
    expect(tags(kifu.moves)).toEqual(["root", "t1", "f0"]);
    expect(kifu.moves[2].forks?.map(tags)).toEqual([["f1"]]);
  });

  test("変化が1本だけになったら forks は残さない", () => {
    const kifu: JKFData = {
      header: {},
      moves: [mv("root"), mv("t1"), mv("main2", [[mv("f0")]])],
    };
    deleteBranchInKifu(
      kifu,
      { te: 2, forkPointers: [], target: branchIndexFromForkIndex(0) },
      null,
    );

    expect(tags(kifu.moves)).toEqual(["root", "t1", "main2"]);
    expect(kifu.moves[2].forks).toBeUndefined();
  });

  test("範囲外の対象は throw する", () => {
    const kifu = kifuWithTwoForks();
    expect(() =>
      deleteBranchInKifu(kifu, { te: 2, forkPointers: [], target: 5 as never }, null),
    ).toThrow();
  });
});

describe("複製の回数", () => {
  test("分岐点以下を複製するのは1回だけ", () => {
    // 候補配列は readCandidates が作った私有コピーなので、持ち替えるだけでよい。
    // 数え直しの複製が戻ると、分岐点が序盤にある棋譜ほど無駄が大きくなる。
    const spy = vi.spyOn(globalThis, "structuredClone");
    try {
      swapBranchesInKifu(
        kifuWithTwoForks(),
        { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
        null,
      );
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
