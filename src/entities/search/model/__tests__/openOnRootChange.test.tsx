// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";

/**
 * 索引を開く合図は `rootDir` prop。**呼び出し側の再描画ではない。**
 * なぜそこに寄せるかは `../provider.tsx` の effect の doc にある。
 *
 * 崩れても表に出ない（検索は成功し、結果だけが実物と食い違う）ので、
 * 合図と順序をここで固定する。
 */

const openProjectApi = vi.fn();

/** 購読が張り終わる時点を試験の側から決める。既定は即時 */
let listenImpl: () => Promise<() => void> = () => Promise.resolve(() => {});

vi.mock("../../api/tauri", () => ({
  openProject: (rootDir: string) => openProjectApi(rootDir),
  listenSearchEvents: () => listenImpl(),
  searchPosition: vi.fn(),
  cancelSearch: vi.fn(),
}));

const { PositionSearchProvider } = await import("../provider");

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
   * **前の open が終わっている場合だけ**を見ている。終わる前に根が変わる経路は
   * `openProject` が飛行中の open を根を見ずに畳むので通らない（#430）。
   * ここを「ワークスペースを変えたら開き直す」と名乗らせない——名前が実装より
   * 強いと、#430 を直したかどうかがこのテストの緑では分からなくなる。
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
   * 二度マウントされると、1回目は**畳まれてから**購読が決着する。畳まれた回が門を
   * 開けると、2回目の購読がまだ張れていないうちに `open_project` が飛び、
   * `Restoring` の最初の1発を取りこぼす（r1-06 が潰した形）。
   *
   * ここでは1回目を失敗、2回目を保留にして、**畳まれた回の決着では開かない**ことを見る。
   */
  test("畳まれた回の購読が決着しても、生きている回の門は開かない", async () => {
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
