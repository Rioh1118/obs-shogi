import { describe, it, expect } from "vitest";

import { indexHealth } from "../indexHealth";

type Index = Parameters<typeof indexHealth>[0];

function idx(over: Partial<Index>): Index {
  return {
    state: "Ready",
    dirtyCount: 0,
    scanFailed: false,
    partiallyUnreadable: false,
    indexedFiles: 0,
    totalFiles: 0,
    doneFiles: 0,
    currentPath: null,
    ...over,
  };
}

describe("indexHealth", () => {
  /**
   * **重い側から見ること。**
   *
   * 走査そのものが失敗しているなら、一部を読めなかったかはもう問題ではない
   * ——利用者が次にすることは同じ一手（ワークスペースを繋ぎ直す）。
   */
  it("走査の失敗が、一部を読めないより優先される", () => {
    expect(indexHealth(idx({ scanFailed: true, partiallyUnreadable: true }))).toBe("notRefreshed");
    expect(indexHealth(idx({ partiallyUnreadable: true }))).toBe("partiallyUnreadable");
  });

  /**
   * **何も走っていない状態を「更新中」と言わないこと。**
   *
   * プロジェクトを開く前の既定は `Empty`。ここを `building` に落とすと、
   * 待っても増えないものに「増える場合があります」と断言することになる。
   */
  it("まだ作っていない索引を「更新中」と言わない", () => {
    expect(indexHealth(idx({ state: "Empty" }))).toBe("notStarted");
    expect(indexHealth(idx({ state: "Building" }))).toBe("building");
    expect(indexHealth(idx({ state: "Restoring" }))).toBe("building");
    expect(indexHealth(idx({}))).toBe("ok");
  });
});
