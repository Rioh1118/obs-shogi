// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";

import type { IndexWarnPayload } from "@/entities/search/api/events";

/**
 * 索引を開く合図は `rootDir` prop。呼び出し側の再描画ではない。
 * なぜそこに寄せるかは `../provider.tsx` の effect の doc にある。
 *
 * 崩れても表に出ない（検索は成功し、結果だけが実物と食い違う）ので、
 * 合図と順序をここで固定する。
 */

const openProjectApi = vi.fn();

type Handlers = { onIndexWarn: (p: IndexWarnPayload) => void };

/** 購読が張り終わる時点を試験の側から決める。既定は即時 */
let listenImpl: (handlers: Handlers) => Promise<() => void> = () => Promise.resolve(() => {});

vi.mock("../../api/tauri", () => ({
  openProject: (rootDir: string) => openProjectApi(rootDir),
  listenSearchEvents: (handlers: Handlers) => listenImpl(handlers),
  searchPosition: vi.fn(),
  cancelSearch: vi.fn(),
}));

const { PositionSearchProvider } = await import("../provider");
const { usePositionSearch } = await import("../usePositionSearch");

const app = (rootDir: string | null) => (
  <PositionSearchProvider rootDir={rootDir}>
    <div />
  </PositionSearchProvider>
);

/** 開いた根を、呼ばれた順に並べる */
const openedRoots = () => openProjectApi.mock.calls.map(([rootDir]) => rootDir);

beforeEach(() => {
  listenImpl = () => Promise.resolve(() => {});
  openProjectApi.mockReset().mockResolvedValue({ indexedCount: 0 });
});

afterEach(() => cleanup());

function WarnPaths() {
  const { state } = usePositionSearch();
  return <p>{state.warns.map((w) => w.path).join(",") || "警告なし"}</p>;
}

describe("根が変わったときの警告", () => {
  const warned = (rootDir: string) => (
    <PositionSearchProvider rootDir={rootDir}>
      <WarnPaths />
    </PositionSearchProvider>
  );
  const warnAt = (path: string): IndexWarnPayload => ({
    kind: "place",
    path,
    message: "読めません",
  });

  /** ルートの改名は `setRootDir` を読み直しなしで通るので、`rootDir` だけが変わる */
  test("前の根の警告を消し、新しい根の警告は残す", async () => {
    let handlers!: Handlers;
    listenImpl = (h) => {
      handlers = h;
      return Promise.resolve(() => {});
    };
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(warned("/old"));
    });
    await act(async () => handlers.onIndexWarn(warnAt("/old/a")));
    expect(screen.getByText("/old/a")).toBeTruthy();

    await act(async () => view.rerender(warned("/new")));
    expect(screen.getByText("警告なし")).toBeTruthy();

    await act(async () => handlers.onIndexWarn(warnAt("/new/b")));
    expect(screen.getByText("/new/b")).toBeTruthy();
  });
});

describe("索引を開く合図", () => {
  test("根が無いうちは開かない", async () => {
    await act(async () => {
      render(app(null));
    });

    expect(openedRoots()).toEqual([]);
  });

  test("根が決まったら開く", async () => {
    await act(async () => {
      render(app("/ws"));
    });

    expect(openedRoots()).toEqual(["/ws"]);
  });

  /**
   * 前の open が終わっている場合だけを見ている。
   * TODO(#430): 終わる前に根が変わる経路は、`openProject` が飛行中の open を根を見ずに畳むので通らない。
   * ここを「ワークスペースを変えたら開き直す」と名乗らせない——名前が実装より
   * 強いと、直したかどうかがこのテストの緑では分からなくなる。
   */
  test("前の open が終わっていれば、根が変わったときに開き直す", async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(app("/ws"));
    });

    await act(async () => {
      view.rerender(app("/other"));
    });

    expect(openedRoots()).toEqual(["/ws", "/other"]);
  });

  /** 順序（購読 → open）。なぜ要るかは `../provider.tsx` の `isListenSettled` の doc */
  test("購読が張り終わるまで開かない", async () => {
    let letListenFinish!: (unlisten: () => void) => void;
    listenImpl = () => new Promise((resolve) => (letListenFinish = resolve));

    await act(async () => {
      render(app("/ws"));
    });
    expect(openedRoots()).toEqual([]);

    await act(async () => {
      letListenFinish(() => {});
    });
    expect(openedRoots()).toEqual(["/ws"]);
  });

  /** 束ねない側。理由は同じ doc の「張れたか」ではなく「決着したか」の段 */
  test("購読が張れなくても索引は開く", async () => {
    listenImpl = () => Promise.reject(new Error("listen failed"));

    await act(async () => {
      render(app("/ws"));
    });

    expect(openedRoots()).toEqual(["/ws"]);
  });

  /**
   * 購読 effect が名乗る「StrictMode-safe」を実際に踏む。
   *
   * 二度マウントされると、1回目は畳まれてから購読が決着する。畳まれた回が `isListenSettled` を
   * 立てると、2回目の購読がまだ張れていないうちに `open_project` が飛び、
   * `Restoring` の最初の1発を取りこぼす。
   *
   * ここでは1回目を失敗、2回目を保留にして、畳まれた回の決着では開かないことを見る。
   */
  test("畳まれた回の購読が決着しても、生きている回の判定は立たない", async () => {
    let letSecondListenFinish!: (unlisten: () => void) => void;
    let attempt = 0;
    listenImpl = () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error("listen failed"));
      return new Promise((resolve) => (letSecondListenFinish = resolve));
    };

    await act(async () => {
      render(
        <StrictMode>
          <PositionSearchProvider rootDir="/ws">
            <div />
          </PositionSearchProvider>
        </StrictMode>,
      );
    });
    expect(attempt).toBe(2);
    expect(openedRoots()).toEqual([]);

    await act(async () => {
      letSecondListenFinish(() => {});
    });
    expect(openedRoots()).toEqual(["/ws"]);
  });

  test("同じ根のまま描き直しても開き直さない", async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(app("/ws"));
    });

    await act(async () => {
      view.rerender(app("/ws"));
    });

    expect(openedRoots()).toEqual(["/ws"]);
  });
});
