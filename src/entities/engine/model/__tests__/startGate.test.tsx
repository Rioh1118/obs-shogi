// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

import { EngineProvider } from "../provider";
import { useEngine } from "../useEngine";
import type { EngineNotReadyReason, EngineRuntimeConfig } from "../types";
import type { EngineInfo } from "@/entities/engine/api/rust-types";

/**
 * **起動の門が、畳む回と重なっても降りること。**
 *
 * ここだけ `engineInitializer` を差し替えず、**本物を通す**——差し替えた double は
 * `inFlight` を持たないので「畳む側が飛んでいる起動を待つか」を表現できず、
 * この窓はどう書いても再現しない（隣の `provider.test.tsx` の double がまさにそれ）。
 * 差し替えるのは IPC の4つだけ。
 *
 * 守っている性質: **起動を待っている間に `desiredRuntime` が2度外れて戻っても、
 * エンジンは起動し直す。** 落ちると理由は `starting`（＝待てば戻る側）のまま固まるので、
 * 走っている解析は誰にも断たれずに「解析中」を回し続ける（→ #502 と同じ症状）。
 */
const initializeEngine = vi.fn<() => Promise<void>>();
const shutdownEngine = vi.fn<() => Promise<void>>();
const applyEngineSettings = vi.fn<() => Promise<void>>();
const getEngineInfo = vi.fn<() => Promise<EngineInfo | null>>();

vi.mock("../../api/tauri", () => ({
  initializeEngine: () => initializeEngine(),
  shutdownEngine: () => shutdownEngine(),
  applyEngineSettings: () => applyEngineSettings(),
  getEngineInfo: () => getEngineInfo(),
}));

const info = { name: "test-engine", author: "t", options: [] } satisfies EngineInfo;

const runtime = (options: Record<string, string> = {}): EngineRuntimeConfig => ({
  enginePath: "/e",
  workDir: "/w",
  evalDir: "/v",
  bookDir: null,
  bookFile: null,
  options,
});

function mountEngine(initial: EngineRuntimeConfig | null) {
  const seen: (EngineNotReadyReason | null)[] = [];

  function Probe() {
    const { notReadyReason } = useEngine();
    useEffect(() => {
      seen.push(notReadyReason);
    });
    return null;
  }

  const tree = (desired: EngineRuntimeConfig | null) => (
    <EngineProvider desiredRuntime={desired}>
      <Probe />
    </EngineProvider>
  );

  const utils = render(tree(initial));
  return {
    reasons: seen,
    async setRuntime(desired: EngineRuntimeConfig | null) {
      await act(async () => {
        utils.rerender(tree(desired));
      });
    },
    async settle() {
      await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    },
  };
}

beforeEach(() => {
  initializeEngine.mockReset();
  shutdownEngine.mockReset();
  applyEngineSettings.mockReset();
  getEngineInfo.mockReset();

  initializeEngine.mockResolvedValue(undefined);
  shutdownEngine.mockResolvedValue(undefined);
  applyEngineSettings.mockResolvedValue(undefined);
  getEngineInfo.mockResolvedValue(info);
});

afterEach(cleanup);

describe("起動の門", () => {
  it("起動を待っている間に設定が2度外れて戻っても、エンジンは起動し直す", async () => {
    // 起動が返らない状態を作る。**評価関数が大きくて初期化が長い回**がこれ。
    let releaseStart: () => void = () => {};
    initializeEngine.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountEngine(runtime());
    await view.settle();
    expect(initializeEngine).toHaveBeenCalledTimes(1);

    // 1度目: 適用中のプリセットが消えて設定が組み立てられなくなる（→ #518 の窓）。
    // 畳む側は飛んでいる起動を待つので、ここではまだ `idle` へ落ちない。
    await view.setRuntime(null);
    await view.settle();

    // 設定が戻る。`phase` はまだ `initializing` なので effect はどの枝にも入らない。
    await view.setRuntime(runtime());
    await view.settle();

    // 2度目: ここが要。**2本目の畳みは飛んでいる起動を待たずに戻り**、`phase` を
    // `idle` に落とす。門が bool だと、この時点で立てた者が居なくなる。
    await view.setRuntime(null);
    await view.settle();
    await view.setRuntime(runtime());
    await view.settle();

    // 1本目の起動がようやく返る（もう誰の待ち相手でもない）。
    releaseStart();
    await view.settle();
    await view.settle();

    // **門が降りていれば、ここまでに起動し直している。**
    expect(initializeEngine.mock.calls.length).toBeGreaterThan(1);
    expect(view.reasons[view.reasons.length - 1]).toBeNull();
  });
});
