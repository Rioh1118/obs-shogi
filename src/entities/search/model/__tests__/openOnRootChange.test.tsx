// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

  /**
   * `open_project` は入口で `Restoring` を emit する。購読より先に開くと、その1発を
   * 取りこぼして `index.state` が `"Empty"` のまま止まり、復元中の検索が
   * 「0件・完了・最新」として出る。
   */
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
