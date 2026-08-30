import { beforeEach, describe, expect, it } from "vitest";

import type { KifuCursor } from "@/entities/kifu/model/cursor";
import { branchIndexFromForkIndex, MAIN_LINE } from "@/entities/kifu/model/branch";
import {
  branchNumberingForDelete,
  branchNumberingForSwap,
  clearUnsavedDrafts,
  dropUnsavedDraftsFor,
  getUnsavedDraft,
  putUnsavedDraft,
  unsavedDraftKey,
} from "../unsavedDrafts";

/**
 * 預かりの掃除は**両方向に危険**。
 *
 * 落としすぎれば、本文と何の関係も無い操作1回で「書いた本文はこのまま残っています」が
 * 無通知に破れる。落とし損ねれば、番号が振り直されたあとに預かりが**別の変化**の
 * ノートへ本文として出て、900ms 後にそこへ書き込まれる。
 *
 * どちらの向きも実際に踏んだ（掃除を空にしても全テストが緑だった時期がある）ので、
 * ここで両方を固定する。
 *
 * **範囲を組む式もここで固定する。** 落とす範囲を決めているのは掃除の側だけではなく、
 * 呼び出し側が渡す `BranchNumbering` でもある。掃除にだけテストを付けていた間、
 * 入れ替えに削除の形を渡す誤りが素通りしていた。
 */
function cursor(tesuu: number, forkPointers: { te: number; forkIndex: number }[]): KifuCursor {
  return { tesuu, forkPointers, tesuuPointer: `${tesuu},[]" ` } as unknown as KifuCursor;
}

function put(key: string) {
  putUnsavedDraft(key, { draft: "メモ", error: "boom", told: true });
}

const A = "/ws/a.kif";

beforeEach(() => {
  clearUnsavedDrafts();
});

describe("削除で番号が詰まったときの掃除", () => {
  // 変化1を消すと、変化2以降が1つずつ詰まる
  it("消した番号以降の面は落とす", () => {
    const k = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 1 }]), A);
    put(k);

    dropUnsavedDraftsFor(A, branchNumberingForDelete(2, [], branchIndexFromForkIndex(1)));

    expect(getUnsavedDraft(k)).toBeUndefined();
  });

  // 消した番号より前は動かない
  it("消した番号より前の面は落とさない", () => {
    const k = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 0 }]), A);
    put(k);

    dropUnsavedDraftsFor(A, branchNumberingForDelete(2, [], branchIndexFromForkIndex(1)));

    expect(getUnsavedDraft(k)).toBeDefined();
  });

  // **本譜で「ここから削除」を押すだけで、無関係な変化の預かりが消えていた。**
  // 手数だけを見ていると、その分岐点を通っていない面まで落ちる。
  it("本譜が動いても、その分岐点を通っていない面は落とさない", () => {
    const k = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 0 }]), A);
    put(k);

    // 本譜の3手目から先を削除（分岐点は te=3 の本譜）
    dropUnsavedDraftsFor(A, branchNumberingForDelete(3, [], MAIN_LINE));

    expect(getUnsavedDraft(k)).toBeDefined();
  });

  it("本譜が動いたら、その分岐点から先の本譜の面は落とす", () => {
    const k = unsavedDraftKey(cursor(4, []), A);
    put(k);

    dropUnsavedDraftsFor(A, branchNumberingForDelete(3, [], MAIN_LINE));

    expect(getUnsavedDraft(k)).toBeUndefined();
  });

  // 本譜を消すと変化1が本譜へ繰り上がるので、変化の番号は0から全部動く
  it("本譜を消したら、その分岐点の変化の面は全部落とす", () => {
    const k = unsavedDraftKey(cursor(4, [{ te: 3, forkIndex: 0 }]), A);
    put(k);

    dropUnsavedDraftsFor(A, branchNumberingForDelete(3, [], MAIN_LINE));

    expect(getUnsavedDraft(k)).toBeUndefined();
  });

  // **同じ手数でも、辿ってきた経路が違えば別の分岐点。**
  it("経路が違えば、同じ手数の分岐点でも落とさない", () => {
    const k = unsavedDraftKey(
      cursor(6, [
        { te: 2, forkIndex: 0 },
        { te: 4, forkIndex: 1 },
      ]),
      A,
    );
    put(k);

    // te=4 の分岐点だが、そこへ至る経路が違う（本譜のまま来た側）
    dropUnsavedDraftsFor(A, branchNumberingForDelete(4, [], MAIN_LINE));

    expect(getUnsavedDraft(k)).toBeDefined();
  });

  it("別の棋譜の預かりは落とさない", () => {
    const k = unsavedDraftKey(cursor(4, []), "/ws/b.kif");
    put(k);

    dropUnsavedDraftsFor(A, branchNumberingForDelete(1, [], MAIN_LINE));

    expect(getUnsavedDraft(k)).toBeDefined();
  });
});

/**
 * **入れ替えは削除と動き方が違う。** `swapInPlace` が触るのは指した2つだけで、
 * その間や後ろの番号は1つも動かない。削除の形（「ここから先が全部詰まる」）を
 * そのまま渡すと、**並べ替えを1回するだけで無関係な変化の預かりが消える**。
 */
describe("入れ替えで番号が入れ替わったときの掃除", () => {
  it("動いた2つの番号の面だけを落とす", () => {
    const moved = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 1 }]), A);
    const still = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 2 }]), A);
    put(moved);
    put(still);

    // 変化1 ↔ 変化2
    dropUnsavedDraftsFor(
      A,
      branchNumberingForSwap(2, [], branchIndexFromForkIndex(0), branchIndexFromForkIndex(1)),
    );

    expect(getUnsavedDraft(moved)).toBeUndefined();
    expect(getUnsavedDraft(still)).toBeDefined();
  });

  it("本譜と変化1を入れ替えても、変化2以降の面は落とさない", () => {
    const swapped = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 0 }]), A);
    const still = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 1 }]), A);
    const onMainLine = unsavedDraftKey(cursor(4, []), A);
    put(swapped);
    put(still);
    put(onMainLine);

    dropUnsavedDraftsFor(A, branchNumberingForSwap(2, [], MAIN_LINE, branchIndexFromForkIndex(0)));

    expect(getUnsavedDraft(swapped)).toBeUndefined();
    expect(getUnsavedDraft(onMainLine)).toBeUndefined();
    expect(getUnsavedDraft(still)).toBeDefined();
  });

  it("本譜が絡まない入れ替えでは、本譜を辿る面を落とさない", () => {
    const onMainLine = unsavedDraftKey(cursor(4, []), A);
    put(onMainLine);

    dropUnsavedDraftsFor(
      A,
      branchNumberingForSwap(2, [], branchIndexFromForkIndex(0), branchIndexFromForkIndex(1)),
    );

    expect(getUnsavedDraft(onMainLine)).toBeDefined();
  });
});
