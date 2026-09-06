// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

/**
 * 索引を開く合図は `config.root_dir`。**呼び出し側の再描画ではない。**
 *
 * これを画面の `useEffect` に置いていたときは、張り直しが2つの偶然に乗っていた——
 * その画面が描かれていること、`openProject` の同一性が根と一緒に変わること。
 * どちらが崩れても**索引が古いまま黙って動く**。検索は成功して、結果だけが実物と
 * 食い違う。表に出ないので、ここで固定しておく必要がある。
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

const config = { root_dir: null as string | null };

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config, isLoading: false, error: null }),
}));

const { PositionSearchProvider } = await import("../provider");

const app = () => (
  <PositionSearchProvider>
    <div />
  </PositionSearchProvider>
);

/** 開いた根を、呼ばれた順に並べる */
const openedRoots = () => openProjectApi.mock.calls.map(([rootDir]) => rootDir);

beforeEach(() => {
  config.root_dir = null;
  listenImpl = () => Promise.resolve(() => {});
  openProjectApi.mockReset().mockResolvedValue({ indexedCount: 0 });
});

afterEach(() => cleanup());

describe("索引を開く合図", () => {
  test("根が無いうちは開かない", () => {
    render(app());

    expect(openedRoots()).toEqual([]);
  });

  test("根が決まったら開く", async () => {
    config.root_dir = "/ws";
    await act(async () => {
      render(app());
    });

    expect(openedRoots()).toEqual(["/ws"]);
  });

  test("ワークスペースを変えたら開き直す", async () => {
    config.root_dir = "/ws";
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(app());
    });

    config.root_dir = "/other";
    await act(async () => {
      view.rerender(app());
    });

    expect(openedRoots()).toEqual(["/ws", "/other"]);
  });

  /**
   * `open_project` は入口で `Restoring` を emit する。購読より先に開くと、その1発を
   * 取りこぼして `index.state` が `"Empty"` のまま止まり、復元中の検索が
   * 「0件・完了・最新」として出る。
   */
  test("購読が張り終わるまで開かない", async () => {
    config.root_dir = "/ws";
    let letListenFinish!: (unlisten: () => void) => void;
    listenImpl = () => new Promise((resolve) => (letListenFinish = resolve));

    await act(async () => {
      render(app());
    });
    expect(openedRoots()).toEqual([]);

    await act(async () => {
      letListenFinish(() => {});
    });
    expect(openedRoots()).toEqual(["/ws"]);
  });

  test("同じ根のまま描き直しても開き直さない", async () => {
    config.root_dir = "/ws";
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(app());
    });

    await act(async () => {
      view.rerender(app());
    });

    expect(openedRoots()).toEqual(["/ws"]);
  });
});
