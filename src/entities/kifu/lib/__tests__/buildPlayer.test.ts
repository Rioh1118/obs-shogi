import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { ROOT_CURSOR, cursorKey, type CursorPath } from "@/entities/kifu/model/cursor";
import { buildPlayer, gotoPath } from "../buildPlayer";

const mv = (tag: string, forks?: JKFMove[][]): JKFMove =>
  forks ? { comments: [tag], forks } : { comments: [tag] };

/** 本譜3手。te=2 に2手の変化。 */
const kifu = (): JKFData => ({
  header: {},
  moves: [mv("root"), mv("t1"), mv("t2", [[mv("f2"), mv("f3")]]), mv("t3")],
});

const at = (tesuu: number, forkPointers: CursorPath["forkPointers"]): CursorPath => ({
  tesuu,
  forkPointers,
});

describe("buildPlayer", () => {
  test("cursor が無ければ開始局面のまま", () => {
    expect(buildPlayer(kifu(), null).tesuu).toBe(0);
  });

  test("計画に沿って変化へ降りる", () => {
    const player = buildPlayer(kifu(), at(3, [{ te: 2, forkIndex: 0 }]));

    expect(player.tesuu).toBe(3);
    expect(player.currentStream[3]?.comments).toEqual(["f3"]);
  });

  test("tesuu より先の forkPointers は落として渡す", () => {
    const player = buildPlayer(kifu(), at(1, [{ te: 2, forkIndex: 0 }]));

    expect(player.tesuu).toBe(1);
    // te=2 の変化には降りていないので、本譜の続きが見える
    expect(player.currentStream[2]?.comments).toEqual(["t2"]);
  });
});

describe("gotoPath", () => {
  // goToStart はここを通る。変化の中から呼ぶと `goto(0, [])` になり、
  // 引数無しの `goto(0)` とは json-kifu-format の中で別の分岐に入る。
  test("変化の中から開始局面へ戻すと、選択も落ちる", () => {
    const player = new JKFPlayer(kifu());
    player.goto(3, [{ te: 2, forkIndex: 0 }]);
    expect(player.currentStream[3]?.comments).toEqual(["f3"]);

    gotoPath(player, ROOT_CURSOR);

    expect(player.tesuu).toBe(0);
    expect(player.getForkPointers()).toEqual([]);
    // 戻ったあとは本譜が見える
    expect(player.currentStream[3]?.comments).toEqual(["t3"]);
    expect(player.getTesuuPointer(0)).toBe(cursorKey(ROOT_CURSOR));
  });

  test("同じ局面へ二度渡しても結果が変わらない", () => {
    const player = new JKFPlayer(kifu());
    const path = at(3, [{ te: 2, forkIndex: 0 }]);

    gotoPath(player, path);
    const once = player.getTesuuPointer(3);
    gotoPath(player, path);

    expect(player.getTesuuPointer(3)).toBe(once);
  });
});
