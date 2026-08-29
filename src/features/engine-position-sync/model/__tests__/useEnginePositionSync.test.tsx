// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import { useEnginePositionSync } from "../useEnginePositionSync";

// エンジンへの送信。テストごとに解決タイミングを握る。
const setPositionFromSfen = vi.fn<(sfen: string) => Promise<void>>();

// フックが読む3スライスは差し替える。ここで検証したいのは
// 「送信の途中で条件が変わったときに何を書き戻すか」だけ。
const gameStub = { cursor: null as unknown, currentSfen: null as string | null };
const engineStub = { isReady: true };
const presetsStub = { selectedPresetId: "A" as string | null, selectedPresetVersion: 1 };

vi.mock("@/entities/engine/api/tauri", () => ({
  setPositionFromSfen: (sfen: string) => setPositionFromSfen(sfen),
}));
vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: { cursor: gameStub.cursor },
    view: { currentSfen: gameStub.currentSfen },
  }),
}));
vi.mock("@/entities/engine", () => ({
  useEngine: () => ({ isReady: engineStub.isReady }),
}));
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => ({
  useEnginePresets: () => ({
    state: { selectedPresetId: presetsStub.selectedPresetId },
    selectedPresetVersion: presetsStub.selectedPresetVersion,
  }),
}));

type Sync = ReturnType<typeof useEnginePositionSync>;

/** フックを実際にマウントし、最新の戻り値と再レンダ回数を掴む。 */
function mountSync() {
  const seen: Sync[] = [];
  let renders = 0;

  function Probe() {
    const sync = useEnginePositionSync();
    renders += 1;
    useEffect(() => {
      seen.push(sync);
    });
    return null;
  }

  const utils = render(<Probe />);
  return {
    ...utils,
    /** スタブを書き換えたあとに呼ぶ。Probe を差し替えずに再レンダする。 */
    async refresh() {
      await act(async () => {
        utils.rerender(<Probe />);
      });
    },
    get current() {
      return seen[seen.length - 1];
    },
    get renderCount() {
      return renders;
    },
  };
}

/** 解決を外から握れる promise。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  setPositionFromSfen.mockReset();
  gameStub.cursor = { tesuuPointer: "0,[]" };
  gameStub.currentSfen = "SFEN-1";
  engineStub.isReady = true;
  presetsStub.selectedPresetId = "A";
  presetsStub.selectedPresetVersion = 1;
});

describe("useEnginePositionSync", () => {
  it("送信中にエンジンが切り替わったら、古い送信の結果を書き戻さない", async () => {
    const inFlight = deferred<void>();
    setPositionFromSfen.mockReturnValueOnce(inFlight.promise);

    const view = mountSync();

    // エンジン A への送信が始まっている
    expect(setPositionFromSfen).toHaveBeenCalledWith("SFEN-1");

    // 送信中にプリセットを B へ切り替える
    presetsStub.selectedPresetId = "B";
    setPositionFromSfen.mockResolvedValue(undefined);
    await view.refresh();

    // ここで A 向けの送信が完了する
    await act(async () => {
      inFlight.resolve();
      await inFlight.promise;
    });
    await view.refresh();

    // syncedSfen が立っているなら、それは「今のエンジンに送れた」ことを意味していなければならない。
    // 古いクロージャの書き戻しが通ると、B に送れていないのに同期済みに見える。
    if (view.current.syncedSfen !== null) {
      expect(setPositionFromSfen.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(setPositionFromSfen).toHaveBeenLastCalledWith(view.current.syncedSfen);
    }
  });

  it("同期に失敗したら syncPosition が reject する", async () => {
    setPositionFromSfen.mockRejectedValue(new Error("boom"));

    const view = mountSync();

    await expect(view.current.syncPosition()).rejects.toThrow("boom");
  });

  it("1回の局面変化に対してエンジンへの送信は1回だけ", async () => {
    setPositionFromSfen.mockResolvedValue(undefined);

    const view = mountSync();
    await act(async () => {});

    expect(setPositionFromSfen).toHaveBeenCalledTimes(1);

    // 送信成功で syncedSfen が変わっても、それ自体が effect を再駆動してはいけない
    gameStub.currentSfen = "SFEN-2";
    gameStub.cursor = { tesuuPointer: "1,[]" };
    await view.refresh();

    expect(setPositionFromSfen).toHaveBeenCalledTimes(2);
    expect(setPositionFromSfen).toHaveBeenLastCalledWith("SFEN-2");
  });
});
