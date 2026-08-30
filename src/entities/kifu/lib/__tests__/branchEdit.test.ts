import { describe, expect, test, vi } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import {
  MAIN_LINE,
  branchIndexFromForkIndex,
  neighborBranchIndex,
} from "@/entities/kifu/model/branch";
import { buildTesuuPointer, type ForkPointer, type KifuCursor } from "@/entities/kifu/model/cursor";
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

  test("複製するのは候補の先頭の手だけで、その先は元の棋譜と共有する", () => {
    // 書き換えるのは先頭の手の forks だけなので、深い手まで複製する必要はない。
    // 先頭を共有すると writeCandidates が入力側の手に forks を生やす
    // （「入力の手のオブジェクトを書き換えない」で押さえている）。
    const kifu = kifuWithTwoForks();
    const mainHead = kifu.moves[2];
    const mainTail = kifu.moves[3];

    swapBranchesInKifu(
      kifu,
      { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
      null,
    );

    const movedMain = kifu.moves[2].forks![0];
    expect(movedMain[0]).not.toBe(mainHead);
    expect(movedMain[1]).toBe(mainTail);
  });
  test("MAIN_LINE より小さい添字は throw する", () => {
    // 一覧の先頭で「上へ」を押したときに neighborBranchIndex が返す値がここで止まる。
    const kifu = kifuWithTwoForks();
    expect(() =>
      swapBranchesInKifu(
        kifu,
        { te: 2, forkPointers: [], a: MAIN_LINE, b: neighborBranchIndex(MAIN_LINE, "up") },
        null,
      ),
    ).toThrow(/out of range/);
  });

  test("一覧の末尾で「下へ」を押した値は throw する", () => {
    // neighborBranchIndex の上限側。"up" 側と対称。
    const kifu = kifuWithTwoForks();
    expect(() =>
      swapBranchesInKifu(
        kifu,
        {
          te: 2,
          forkPointers: [],
          a: MAIN_LINE,
          b: neighborBranchIndex(branchIndexFromForkIndex(1), "down"),
        },
        null,
      ),
    ).toThrow(/out of range/);
  });

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

  test("整数でない対象は throw する", () => {
    // NaN も小数も `< 0` と `>= 候補数` の両方を false にするので、大小比較だけの検査を
    // 素通りし、splice が 0 方向へ丸める。NaN と 0.5 は本譜を、1.9 は隣の変化を、
    // 頼んでいないのに消す。
    for (const target of [NaN, 0.5, 1.9]) {
      const kifu = kifuWithTwoForks();
      expect(() =>
        deleteBranchInKifu(kifu, { te: 2, forkPointers: [], target: target as never }, null),
      ).toThrow();
      expect(tags(kifu.moves)).toEqual(["root", "t1", "main2", "main3"]);
    }
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

describe("throw したときの棋譜", () => {
  test("cursor が壊れていても、棋譜は書き換わらない", () => {
    // cursor の検査が書き換えの後にあると、例外が出たのに kifu だけ変わった状態が残る。
    const kifu = kifuWithTwoForks();
    const before = JSON.stringify(kifu);
    const cursor = cursorAt(2, [{ te: 2, forkIndex: -1 }]);

    expect(() =>
      deleteBranchInKifu(kifu, { te: 2, forkPointers: [], target: MAIN_LINE }, cursor),
    ).toThrow();
    expect(JSON.stringify(kifu)).toBe(before);

    expect(() =>
      swapBranchesInKifu(
        kifu,
        { te: 2, forkPointers: [], a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
        cursor,
      ),
    ).toThrow();
    expect(JSON.stringify(kifu)).toBe(before);
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

describe("cursor の forkPointers が正規化されていないとき", () => {
  /**
   * te=1 と te=2 で変化に降り、その先の te=3 にも分岐がある棋譜。
   * 編集する te より手前に**2つ**選択があるので、並び順の違いが表に出る。
   */
  function nestedKifu(): JKFData {
    return {
      header: {},
      moves: [
        mv("root"),
        mv("m1", [[mv("v1"), mv("v2", [[mv("w2"), mv("w3", [[mv("x3")]])]])]]),
        mv("m2"),
      ],
    };
  }

  const prefix: ForkPointer[] = [
    { te: 1, forkIndex: 0 },
    { te: 2, forkIndex: 0 },
  ];

  // `swapBranchesInKifu` は cursor が同じ stream を辿っているときだけ選択を patch する。
  // 判定は並び順つきの列比較なので、比べる前に両側を整列しないと、同じ経路を
  // 並び順の違いだけで「別の stream」と読み、patch を取りこぼす。
  // cursor は `CursorPath` として任意の呼び出し側から渡るので、整列済みとは限らない。
  test("並び順が崩れていても同じ stream と判定して選択を patch する", () => {
    const swapAt3 = (forkPointers: ForkPointer[]) =>
      swapBranchesInKifu(
        nestedKifu(),
        { te: 3, forkPointers: prefix, a: MAIN_LINE, b: branchIndexFromForkIndex(0) },
        { tesuu: 3, forkPointers },
      );

    const sorted = swapAt3([...prefix, { te: 3, forkIndex: 0 }]);
    const unsorted = swapAt3([{ te: 3, forkIndex: 0 }, prefix[1], prefix[0]]);

    // 本譜と変化1を入れ替えたので、te=3 の選択は「変化1 → 本譜」へ patch される
    expect(sorted.nextCursor?.forkPointers).toEqual(prefix);
    expect(unsorted.nextCursor?.forkPointers).toEqual(sorted.nextCursor?.forkPointers);
  });
});
