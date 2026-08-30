import { beforeEach, describe, expect, it } from "vitest";

import type { KifuCursor } from "@/entities/kifu/model/cursor";
import {
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

describe("番号が振り直されたときの掃除", () => {
  // 変化1を消すと、変化2以降が1つずつ詰まる
  it("消した番号以降の面は落とす", () => {
    const k = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 1 }]), A);
    put(k);

    dropUnsavedDraftsFor(A, {
      te: 2,
      forkPointers: [],
      mainLineMoved: false,
      movedFromForkIndex: 1,
    });

    expect(getUnsavedDraft(k)).toBeUndefined();
  });

  // 消した番号より前は動かない
  it("消した番号より前の面は落とさない", () => {
    const k = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 0 }]), A);
    put(k);

    dropUnsavedDraftsFor(A, {
      te: 2,
      forkPointers: [],
      mainLineMoved: false,
      movedFromForkIndex: 1,
    });

    expect(getUnsavedDraft(k)).toBeDefined();
  });

  // **本譜で「ここから削除」を押すだけで、無関係な変化の預かりが消えていた。**
  // 手数だけを見ていると、その分岐点を通っていない面まで落ちる。
  it("本譜が動いても、その分岐点を通っていない面は落とさない", () => {
    const k = unsavedDraftKey(cursor(4, [{ te: 2, forkIndex: 0 }]), A);
    put(k);

    // 本譜の3手目から先を削除（分岐点は te=3 の本譜）
    dropUnsavedDraftsFor(A, {
      te: 3,
      forkPointers: [],
      mainLineMoved: true,
      movedFromForkIndex: 0,
    });

    expect(getUnsavedDraft(k)).toBeDefined();
  });

  it("本譜が動いたら、その分岐点から先の本譜の面は落とす", () => {
    const k = unsavedDraftKey(cursor(4, []), A);
    put(k);

    dropUnsavedDraftsFor(A, {
      te: 3,
      forkPointers: [],
      mainLineMoved: true,
      movedFromForkIndex: 0,
    });

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
    dropUnsavedDraftsFor(A, {
      te: 4,
      forkPointers: [],
      mainLineMoved: true,
      movedFromForkIndex: 0,
    });

    expect(getUnsavedDraft(k)).toBeDefined();
  });

  it("別の棋譜の預かりは落とさない", () => {
    const k = unsavedDraftKey(cursor(4, []), "/ws/b.kif");
    put(k);

    dropUnsavedDraftsFor(A, {
      te: 1,
      forkPointers: [],
      mainLineMoved: true,
      movedFromForkIndex: 0,
    });

    expect(getUnsavedDraft(k)).toBeDefined();
  });
});
