import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { cursorKey } from "@/entities/kifu/model/cursor";
import { cursorFromPlayer, reachedCursor } from "../playerCursor";
import { buildPlayer } from "../buildPlayer";

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

describe("reachedCursor", () => {
  test("要求どおりの局面に着いていれば true", () => {
    const player = new JKFPlayer(kifu());
    const path = { tesuu: 3, forkPointers: [{ te: 2, forkIndex: 0 }] };
    player.goto(path.tesuu, path.forkPointers);

    expect(reachedCursor(player, path)).toBe(true);
  });

  // 届かなかった側。getTesuuPointer(tesuu) は引数をそのまま埋めるだけで
  // player.tesuu を見ないので、観測を cursorFromPlayer から取らないと true になる。
  test("線の長さを超える tesuu を要求すると false", () => {
    const path = { tesuu: 40, forkPointers: [] };
    const player = buildPlayer(kifu(), path);

    expect(player.tesuu).toBe(3);
    expect(reachedCursor(player, path)).toBe(false);
  });

  // goto は実在しない変化を黙って捨てるので、tesuu は一致したまま別の線に着く。
  // tesuu の比較では検出できないのがこの関数のもう1つの存在理由。
  test("実在しない変化を要求すると、同じ tesuu でも false", () => {
    const player = new JKFPlayer(kifu());
    const path = { tesuu: 3, forkPointers: [{ te: 2, forkIndex: 9 }] };
    player.goto(path.tesuu, path.forkPointers);

    expect(player.tesuu).toBe(path.tesuu);
    expect(reachedCursor(player, path)).toBe(false);
  });
});
