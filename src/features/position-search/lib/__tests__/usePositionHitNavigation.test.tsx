// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import type { CursorLite } from "@/entities/search";

/**
 * 索引に在る棋譜がツリーに無いのは正常運転で起こる（理由は
 * `docs/state-transitions/search.md`）。**そのとき移動は始まっていない**ので、
 * 呼び手がそれを知れなければ「開いた」ように見えるだけの操作になる。
 */

const selectNodeByAbsPath = vi.fn();
const applyCursor = vi.fn();

type SelectedNode = { path: string; isDirectory: boolean } | null;
const stub = {
  fileTree: {} as unknown,
  selectedNode: null as SelectedNode,
  player: null as unknown,
  loadedAbsPath: null as string | null,
  loadFailedAbsPath: null as string | null,
  loadFailedSeq: 0,
  kifuError: null as { path?: string } | null,
};

vi.mock("@/entities/file-tree", () => ({
  useFileTree: () => ({
    fileTree: stub.fileTree,
    selectedNode: stub.selectedNode,
    selectNodeByAbsPath,
    kifuError: stub.kifuError,
  }),
}));

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: {
      loadedAbsPath: stub.loadedAbsPath,
      loadFailedAbsPath: stub.loadFailedAbsPath,
      loadFailedSeq: stub.loadFailedSeq,
    },
    view: { player: stub.player },
    applyCursor,
  }),
}));

const { usePositionHitNavigation } = await import("../usePositionHitNavigation");

const CURSOR: CursorLite = { tesuu: 3, forkPointers: [] };

beforeEach(() => {
  stub.fileTree = {};
  stub.selectedNode = null;
  stub.player = null;
  stub.loadedAbsPath = null;
  stub.loadFailedAbsPath = null;
  stub.loadFailedSeq = 0;
  stub.kifuError = null;
  selectNodeByAbsPath.mockReset();
  applyCursor.mockReset();
});

afterEach(() => cleanup());

describe("usePositionHitNavigation", () => {
  /**
   * **一度盤に載せられなかった棋譜へ、もう一度ヒットから飛ぶ経路。**
   *
   * ツリーは `activeKifuPath` をその棋譜に進めたまま（構文としては読めている）なので、
   * `selectNodeByAbsPath` に任せると「もう開いている」と判断して `openKifuNode` を飛ばす。
   * 飛ばされると載せ直しの effect が走らず、**モーダルだけが閉じて何も起きない**。
   */
  test("盤に載っていない棋譜は、ツリーが開いていると言っていても開き直させる", () => {
    selectNodeByAbsPath.mockReturnValue(true);
    stub.selectedNode = { path: "/root/こわれた.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/前の.kif";

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/こわれた.kif", CURSOR)).toBe("started");
    expect(selectNodeByAbsPath).toHaveBeenCalledWith("/root/こわれた.kif", { forceReopen: true });
  });

  /** 盤に載っているなら、読み直させない（ディスクを1回余分に読むことになる） */
  test("盤に載っている棋譜は開き直させない", () => {
    selectNodeByAbsPath.mockReturnValue(true);
    stub.selectedNode = { path: "/root/別.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/a.kif";

    const { result } = renderHook(() => usePositionHitNavigation());

    result.current.startNavigationToHit("/root/a.kif", CURSOR);
    expect(selectNodeByAbsPath).toHaveBeenCalledWith("/root/a.kif", { forceReopen: false });
  });

  test("ツリーにその棋譜が無ければ not-in-tree。局面も動かさない", () => {
    selectNodeByAbsPath.mockReturnValue(false);

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/gone.kif", CURSOR)).toBe("not-in-tree");
    expect(applyCursor).not.toHaveBeenCalled();
  });

  test("ツリーを切り替えられたら started。局面はまだ当てない", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/b.kif", CURSOR)).toBe("started");
    expect(selectNodeByAbsPath).toHaveBeenCalledWith("/root/b.kif", { forceReopen: true });
    expect(applyCursor).not.toHaveBeenCalled();
  });

  test("同じ棋譜が盤に載っていれば、その場で局面へ当てて started", () => {
    stub.selectedNode = { path: "/root/a.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/a.kif";
    stub.player = {};

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/a.kif", CURSOR)).toBe("started");
    expect(selectNodeByAbsPath).not.toHaveBeenCalled();
    expect(applyCursor).toHaveBeenCalledTimes(1);
  });

  /**
   * 選択は即座に切り替わるのに、`view.player` は**盤に載っている棋譜**の再生器。
   * 選択だけを見て当てると、前の棋譜に別の棋譜のカーソルが当たる。
   */
  test("選んであっても盤にまだ載っていなければ、その場では当てない", () => {
    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/a.kif";
    stub.player = {};
    selectNodeByAbsPath.mockReturnValue(true);

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/b.kif", CURSOR)).toBe("started");
    expect(applyCursor).not.toHaveBeenCalled();
  });

  /** 要求を出したあと、その棋譜が盤に載ったら当てる（この経路が生きていること） */
  test("要求した棋譜が読み終わったら当たる", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/b.kif";
    stub.player = {};
    rerender();

    expect(applyCursor).toHaveBeenCalledTimes(1);
  });

  /**
   * 要求は1回きり。捨てないと、開けなかった棋譜の要求がアプリを終えるまで残り、
   * あとでその棋譜を普通に開いた瞬間に頼んでいない局面へ盤が動く。
   */
  test("別の棋譜を選んだら要求は流れ、あとでその棋譜が読めても当たらない", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    stub.selectedNode = { path: "/root/c.kif", isDirectory: false };
    rerender();

    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/b.kif";
    stub.player = {};
    rerender();

    expect(applyCursor).not.toHaveBeenCalled();
  });

  test("その棋譜を読めなかったら要求は流れる", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.kifuError = { path: "/root/b.kif" };
    rerender();

    stub.kifuError = null;
    stub.loadedAbsPath = "/root/b.kif";
    stub.player = {};
    rerender();

    expect(applyCursor).not.toHaveBeenCalled();
  });

  /**
   * **読めたが盤に載せられなかった回**（`game.md` の E16）。`kifuError` は立たず、
   * 選択もその棋譜のままなので、上の2つでは見分けが付かない。
   *
   * 捨てないと、利用者が外でそのファイルを直して普通に開き直した瞬間に、
   * **ずっと前に押した検索ヒットの局面へ盤が飛ぶ**。
   */
  test("盤に載せられなかったら要求は流れる", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    // ツリーは開いた（選択も動いた）が、盤には載らなかった
    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.loadFailedAbsPath = "/root/b.kif";
    stub.loadFailedSeq = 1;
    rerender();

    // あとで直して、普通に開き直した
    stub.loadFailedAbsPath = null;
    stub.loadedAbsPath = "/root/b.kif";
    stub.player = {};
    rerender();

    expect(applyCursor).not.toHaveBeenCalled();
  });

  /**
   * **読み込みの最中は捨てない。** `loadedAbsPath` の不一致で代用すると、
   * 成功する要求まで捨てることになる。
   */
  test("まだ載っていないだけなら要求は生きている", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    // 選択は動いたが、盤はまだ前の棋譜（読み込みの飛行中）
    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/a.kif";
    stub.player = {};
    rerender();

    stub.loadedAbsPath = "/root/b.kif";
    rerender();

    expect(applyCursor).toHaveBeenCalledTimes(1);
  });

  /**
   * **前の回の失敗が残っているうちに、新しい要求を出す。**
   *
   * 印が「いま失敗している」を表すと、armed の直後から立っているので、effect が
   * 1回でも走った時点で新しい要求まで捨てられる。**印は直近の試行だけを指すこと。**
   */
  test("前の失敗の印が残っていても、新しい要求は捨てない", () => {
    selectNodeByAbsPath.mockReturnValue(true);
    // 前の回に載せられなかった印が残っている
    stub.loadFailedAbsPath = "/root/b.kif";
    stub.loadFailedSeq = 1;

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    // `selectNodeByAbsPath` が選択を動かす。**`openKifuNode` はまだディスクを読んでいる**ので、
    // `loadGame` には届いておらず、前の回の印が立ったまま effect が走る
    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    rerender();

    // 今度は載った
    stub.loadFailedAbsPath = null;
    stub.loadedAbsPath = "/root/b.kif";
    stub.player = {};
    rerender();

    expect(applyCursor).toHaveBeenCalledTimes(1);
  });

  /**
   * ツリーを1本も持っていない状態は「探した結果、無かった」ではない。
   * 索引は cache から復元されるので、ツリーの取得が落ちた回でも結果は並ぶ。
   */
  test("ツリーそのものが無ければ tree-unavailable。ツリーは引かない", () => {
    stub.fileTree = null;

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/b.kif", CURSOR)).toBe("tree-unavailable");
    expect(selectNodeByAbsPath).not.toHaveBeenCalled();
  });
});
