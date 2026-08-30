import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { cursorKey } from "@/entities/kifu/model/cursor";
import { cursorFromPlayer } from "../playerCursor";

const mv = (tag: string, forks?: JKFMove[][]): JKFMove =>
  forks ? { comments: [tag], forks } : { comments: [tag] };

/** 本譜3手。te=2 に2手の変化。 */
const kifu = (): JKFData => ({
  header: {},
  moves: [mv("root"), mv("t1"), mv("t2", [[mv("f2"), mv("f3")]]), mv("t3")],
});

describe("cursorFromPlayer", () => {
  test("開始局面では選択を持たない", () => {
    const c = cursorFromPlayer(new JKFPlayer(kifu()));

    expect(c.tesuu).toBe(0);
    expect(c.forkPointers).toEqual([]);
  });

  test("本譜を進んだだけなら選択は空", () => {
    const player = new JKFPlayer(kifu());
    player.goto(3);

    expect(cursorFromPlayer(player).forkPointers).toEqual([]);
  });

  test("変化に降りていれば、実際に降りた選択を持つ", () => {
    const player = new JKFPlayer(kifu());
    player.goto(3, [{ te: 2, forkIndex: 0 }]);

    const c = cursorFromPlayer(player);
    expect(c.tesuu).toBe(3);
    expect(c.forkPointers).toEqual([{ te: 2, forkIndex: 0 }]);
  });

  /**
   * 3つの値は同じ player の同じ `tesuu` から取らないと、`tesuuPointer` が
   * `tesuu` / `forkPointers` と食い違う。食い違うと `navigate` / `edit` の
   * 「動いたか」の比較が誤判定し、**ボタンを押しても盤が動かないのに何も出ない**。
   */
  test("tesuuPointer は tesuu と forkPointers に対応する", () => {
    const player = new JKFPlayer(kifu());
    player.goto(3, [{ te: 2, forkIndex: 0 }]);

    const c = cursorFromPlayer(player);
    expect(c.tesuuPointer).toBe(cursorKey({ tesuu: c.tesuu, forkPointers: c.forkPointers }));
  });
});
