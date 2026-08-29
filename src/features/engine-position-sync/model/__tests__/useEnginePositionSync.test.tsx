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

/** フックを実際にマウントし、最新の戻り値を掴む。 */
function mountSync() {
  const seen: Sync[] = [];

  function Probe() {
    const sync = useEnginePositionSync();
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
  it("送信中にエンジンが切り替わったら、古い結果を書き戻さず、新しいエンジンへ送り直す", async () => {
    const inFlight = deferred<void>();
    setPositionFromSfen.mockReturnValueOnce(inFlight.promise);

    const view = mountSync();

    // エンジン A への送信が始まっている
    expect(setPositionFromSfen).toHaveBeenCalledWith("SFEN-1");

    // 切替後の送信は保留にする。こうすると「B へ送れた」事実がまだ無い状態を作れる。
    const afterSwitch = deferred<void>();
    setPositionFromSfen.mockReturnValue(afterSwitch.promise);

    presetsStub.selectedPresetId = "B";
    await view.refresh();

    // ここで A 向けの送信が完了する
    await act(async () => {
      inFlight.resolve();
      await inFlight.promise;
    });
    await view.refresh();

    // B にはまだ送れていないので、同期済みを名乗ってはいけない。
    expect(view.current.syncedSfen).toBeNull();

    // かつ、B への送信は始まっていなければならない。ここを見ないと
    // 「古い書き戻しを捨てた」と「そもそも送らなくなった」を区別できない。
    expect(setPositionFromSfen).toHaveBeenCalledTimes(2);

    await act(async () => {
      afterSwitch.resolve();
      await afterSwitch.promise;
    });
    await view.refresh();

    expect(view.current.syncedSfen).toBe("SFEN-1");
  });

  it("送信の失敗で、その後に積まれた新しい局面まで捨てない", async () => {
    const failing = deferred<void>();
    setPositionFromSfen.mockReturnValueOnce(failing.promise);

    const view = mountSync();
    expect(setPositionFromSfen).toHaveBeenCalledWith("SFEN-1");

    // 送信中に盤を1手進める
    setPositionFromSfen.mockResolvedValue(undefined);
    gameStub.currentSfen = "SFEN-2";
    gameStub.cursor = { tesuuPointer: "1,[]" };
    await view.refresh();

    // 先に投げた送信が失敗する
    await act(async () => {
      failing.reject(new Error("boom"));
      await failing.promise.catch(() => {});
    });
    await view.refresh();

    // SFEN-2 は送られていなければならない。ここを捨てると、盤は進んでいるのに
    // エンジンには誰も送らない状態が残る。
    expect(setPositionFromSfen).toHaveBeenLastCalledWith("SFEN-2");
    expect(view.current.syncedSfen).toBe("SFEN-2");
  });

  it("engineKey が変わらないエンジン再起動でも送り直す", async () => {
    setPositionFromSfen.mockResolvedValue(undefined);

    const view = mountSync();
    await act(async () => {});
    expect(setPositionFromSfen).toHaveBeenCalledTimes(1);

    // AI ルートの変更などでは engineKey は変わらないままエンジンだけが再起動する。
    // 新しいプロセスには局面が入っていないので送り直す必要がある。
    engineStub.isReady = false;
    await view.refresh();
    engineStub.isReady = true;
    await view.refresh();

    expect(setPositionFromSfen).toHaveBeenCalledTimes(2);
    expect(setPositionFromSfen).toHaveBeenLastCalledWith("SFEN-1");
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

  it("局面が変わらない限り syncPosition の identity は変わらない", async () => {
    setPositionFromSfen.mockResolvedValue(undefined);

    const identities: unknown[] = [];
    function Probe() {
      const sync = useEnginePositionSync();
      useEffect(() => {
        identities.push(sync.syncPosition);
      });
      return null;
    }
    const utils = render(<Probe />);
    await act(async () => {});

    // syncPosition が自分で書いた state に依存していると、送信成功のたびに
    // identity が変わり、それを依存に持つ自動同期 effect が同じ局面で二周する。
    expect(new Set(identities).size).toBe(1);

    identities.length = 0;
    gameStub.currentSfen = "SFEN-2";
    gameStub.cursor = { tesuuPointer: "1,[]" };
    await act(async () => {
      utils.rerender(<Probe />);
    });

    // 局面が変われば identity は1回だけ変わってよい。二周してはいけない。
    expect(new Set(identities).size).toBe(1);
  });
});
