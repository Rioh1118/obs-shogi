import { describe, expect, test, vi } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import {
  MAIN_LINE,
  branchIndexFromForkIndex,
  buildTesuuPointer,
} from "@/entities/kifu/model/branch";
import type { ForkPointer, KifuCursor } from "@/entities/kifu/model/cursor";
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

function cursorAt(tesuu: number, forkPointers: ForkPointer[]): KifuCursor {
  return { tesuu, forkPointers, tesuuPointer: buildTesuuPointer(tesuu, forkPointers) };
}

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

  test("入力の手のオブジェクトを書き換えない", () => {
    // 候補の先頭の手は readCandidates が複製する。複製し忘れると、
    // writeCandidates の `main[0].forks = forkSegs` が入力側の手に forks を生やす。
    const kifu = kifuWithTwoForks();
    const forkHead = kifu.moves[2].forks![0][0];

    swapBranchesInKifu(
      kifu,
      { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
      null,
    );

    expect(kifu.moves[2]).not.toBe(forkHead);
    expect(forkHead.forks).toBeUndefined();
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

  test("te=0 は throw する", () => {
    // moves[0] は開始局面のエントリ。通すと本譜の削除が moves を空にする。
    const kifu = kifuWithTwoForks();
    expect(() =>
      deleteBranchInKifu(kifu, { te: 0, forkPointers: [], target: MAIN_LINE }, null),
    ).toThrow();
    expect(kifu.moves).toHaveLength(4);
  });

  test("範囲外の対象は throw する", () => {
    const kifu = kifuWithTwoForks();
    expect(() =>
      deleteBranchInKifu(
        kifu,
        { te: 2, forkPointers: [], target: branchIndexFromForkIndex(4) },
        null,
      ),
    ).toThrow();
  });
});

describe("複製の回数", () => {
  test("棋譜の深いコピーを取らない", () => {
    // 呼び出し側が既に複製した JKF を渡してくる（doc に書いてある前提）。
    // ここで深いコピーを足すと、分岐点が序盤にある棋譜ほど無駄が大きくなる。
    const spy = vi.spyOn(globalThis, "structuredClone");
    try {
      swapBranchesInKifu(
        kifuWithTwoForks(),
        { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
        null,
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("削除後のカーソル", () => {
  test("消えた候補より後ろにいたら、同じ変化を指し続けるよう番号が詰まる", () => {
    // 変化2（f1）を見ている状態で本譜を消すと、f1 は変化1に繰り上がる。
    // 詰め忘れると、カーソルが隣の変化を指したまま保存される。
    const kifu = kifuWithTwoForks();
    const cursor = cursorAt(2, [{ te: 2, forkIndex: 1 }]);
    const res = deleteBranchInKifu(kifu, { te: 2, forkPointers: [], target: MAIN_LINE }, cursor);

    expect(kifu.moves[2].forks?.map(tags)).toEqual([["f1"]]);
    expect(res.nextCursor?.forkPointers).toEqual([{ te: 2, forkIndex: 0 }]);
  });

  test("消えた候補の中にいたら、その手数の本譜へ退避する", () => {
    const kifu = kifuWithTwoForks();
    const cursor = cursorAt(2, [{ te: 2, forkIndex: 0 }]);
    const res = deleteBranchInKifu(
      kifu,
      { te: 2, forkPointers: [], target: branchIndexFromForkIndex(0) },
      cursor,
    );

    expect(res.nextCursor?.tesuu).toBe(2);
    expect(res.nextCursor?.forkPointers).toEqual([]);
  });

  test("候補が全部消えたら、その手前まで戻る", () => {
    const kifu: JKFData = { header: {}, moves: [mv("root"), mv("t1"), mv("main2")] };
    const cursor = cursorAt(2, []);
    const res = deleteBranchInKifu(kifu, { te: 2, forkPointers: [], target: MAIN_LINE }, cursor);

    // te 以降が丸ごと消える。棋譜が短くなる側なので長さまで固定する。
    expect(tags(kifu.moves)).toEqual(["root", "t1"]);
    expect(res.nextCursor?.tesuu).toBe(1);
  });
});

describe("空の変化", () => {
  test("先頭が null の変化でも throw する", () => {
    // sanitizeJkf が落とすのは「長さ0」と「先頭が null」の2形。
    // 弾く側がどちらか一方だけだと、もう一方で同じ捏造が起きる。
    const kifu: JKFData = {
      header: {},
      moves: [mv("root"), mv("t1"), mv("main2", [[null as unknown as JKFMove], [mv("f1")]])],
    };
    expect(() =>
      swapBranchesInKifu(
        kifu,
        { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
        null,
      ),
    ).toThrow();
  });

  test("手を捏造せず throw する", () => {
    // `{ ...undefined }` は `{}` になるので、素通しすると指し手も special も持たない
    // 手が本譜に入り、そのままファイルに書き戻される。
    const kifu: JKFData = {
      header: {},
      moves: [mv("root"), mv("t1"), mv("main2", [[], [mv("f1")]])],
    };
    expect(() =>
      swapBranchesInKifu(
        kifu,
        { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
        null,
      ),
    ).toThrow();
  });
});

describe("同じ手数の入れ子の変化", () => {
  test("持ち上げて平坦にしてから書き戻す", () => {
    // 変化の先頭がさらに forks を持つ形は「同じ手数の別候補」なので、
    // 候補配列では兄弟に並ぶ。平坦化を忘れると入れ替えが1段目にしか効かない。
    const kifu: JKFData = {
      header: {},
      moves: [mv("root"), mv("t1"), mv("main2", [[mv("f0", [[mv("g0")]])]])],
    };
    swapBranchesInKifu(
      kifu,
      {
        te: 2,
        forkPointers: [],
        a: branchIndexFromForkIndex(0),
        b: branchIndexFromForkIndex(1),
      },
      null,
    );

    expect(tags(kifu.moves)).toEqual(["root", "t1", "main2"]);
    expect(kifu.moves[2].forks?.map(tags)).toEqual([["g0"], ["f0"]]);
  });
});

describe("swapBranchesInKifu の範囲外", () => {
  test("候補数を超える添字は throw する", () => {
    const kifu = kifuWithTwoForks();
    expect(() =>
      swapBranchesInKifu(
        kifu,
        { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(8) },
        null,
      ),
    ).toThrow();
  });
});
