import { describe, expect, it } from "vitest";

import { reducer } from "../reducer";
import type { FileTreeState } from "../types";
import type { JKFData } from "@/entities/kifu/model/jkf";

/**
 * **`state.jkfData` の参照の同一性は、レイヤをまたぐ契約。**
 *
 * `GameFileTreeBridge` は「前に盤へ載せた `jkfData` と同じ参照か」だけで
 * 改名と載せ直しを見分ける。`entities/file-tree` から `entities/game` は見えないので、
 * この性質が壊れてもこのスライスの中では何も起きない——**壊れ方は2方向あり、
 * 片方は盤の棋譜が別のファイルへ書かれる。**
 *
 * - 参照が変わる → 改名で盤が載せ直され、開いた時点まで巻き戻る
 * - 別のファイルを指しながら参照が残る → 保存先の門番が通り、前の棋譜が新しいパスへ入る
 *
 * 橋のテスト（`gameFileTreeBridgeRename.test.tsx`）は `@/entities/file-tree` を
 * まるごとモックして「参照を持ち越す」を手で真似ているので、**実物がこの性質を
 * 失っても緑のまま**。ここが実物の reducer を回す唯一の場所。
 */

const OPENED: JKFData = { header: {}, moves: [{}, {}] };

const base = {
  fileTree: null,
  selectedNode: null,
  activeKifuPath: null,
  jkfData: null,
  kifuFormat: null,
  expandedNodes: new Set<string>(),
  isLoading: false,
  menu: null,
  renamingNodeId: null,
  creatingDirParentPath: null,
  error: null,
  kifuError: null,
  conflict: null,
} as unknown as FileTreeState;

const opened = reducer(base, {
  type: "kifu_opened",
  payload: { path: "/ws/a.kif", jkfData: OPENED, format: "kif" },
});

describe("開いた棋譜の参照の同一性", () => {
  it("改名・移動でパスが張り替わっても、同じ参照を持ち越す", () => {
    const renamed = reducer(opened, {
      type: "active_kifu_reconciled",
      payload: { path: "/ws/b.kif" },
    });

    expect(renamed.activeKifuPath).toBe("/ws/b.kif");
    expect(renamed.jkfData).toBe(OPENED);
  });

  it("親フォルダごと移しても、同じ参照を持ち越す", () => {
    const moved = reducer(opened, {
      type: "active_kifu_reconciled",
      payload: { path: "/ws/移動先/a.kif" },
    });

    expect(moved.jkfData).toBe(OPENED);
  });

  /**
   * **開き直しは別の参照でなければならない。** ここが同じ参照になると、橋は
   * 「パスも中身も同じ」と読んで `loadGame` を撃たず、**盤がディスクの変更を
   * 二度と拾わなくなる**。解析結果をパスごとにキャッシュする最適化がこれを壊す。
   */
  it("開き直したら別の参照になる", () => {
    const reread: JKFData = { header: {}, moves: [{}, {}] };

    const reopened = reducer(opened, {
      type: "kifu_opened",
      payload: { path: "/ws/a.kif", jkfData: reread, format: "kif" },
    });

    expect(reopened.jkfData).toBe(reread);
    expect(reopened.jkfData).not.toBe(OPENED);
  });

  /** 閉じたら落とす。持ち越すと、盤に何も無いのに「同じ棋譜」を名乗れる */
  it("棋譜を閉じたら参照を落とす", () => {
    expect(reducer(opened, { type: "kifu_closed" }).jkfData).toBeNull();
  });

  /** 根の外へ出た場合も同じ。`path: null` は閉じる指示 */
  it("張り替え先が無ければ参照を落とす", () => {
    const closed = reducer(opened, {
      type: "active_kifu_reconciled",
      payload: { path: null },
    });

    expect(closed.jkfData).toBeNull();
  });
});
