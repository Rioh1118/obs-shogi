// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * `RuntimeProviders` に載っている橋のうち、**外しても何も落ちない2つ**
 * （`BoardOrientationBridge` / `EngineFailureBridge`）が載っていること。
 * 型も通るしレンダも通る。起きるのは「棋譜を変えても向きが戻らない」
 * 「エンジンが起動できなくても画面に何も出ない」だけで、例外もエラー表示も出ない。
 *
 * **器の形をしている `EngineRuntimeBridge` / `AnalysisBridge` は対象外。**
 * あちらは provider を張るので、外せば `useEngine` / `useAnalysis` が投げる。
 *
 * **見ているのは描かれることだけで、どこに載っているかではない。**
 * `EngineFailureBridge` は `EngineProvider` の内側に居る必要があるが、
 * ここは `EngineRuntimeBridge` を素通しに差し替えているので、外へ動かしても緑になる。
 *
 * 向きの橋が盤の中ではなくここに居る理由は
 * [BoardOrientationBridge](../bridges/BoardOrientationBridge.tsx) の doc にある。
 */

const passthrough = (name: string) => ({
  [name]: ({ children }: { children?: ReactNode }) => <>{children}</>,
});

vi.mock("../gates/FileTreeRootGate", () => passthrough("FileTreeRootGate"));
vi.mock("../gates/GamePersistenceGate", () => passthrough("GamePersistenceGate"));
vi.mock("../gates/SearchRootGate", () => passthrough("SearchRootGate"));
vi.mock("../bridges/EngineRuntimeBridge", () => passthrough("EngineRuntimeBridge"));
vi.mock("../bridges/AnalysisBridge", () => passthrough("AnalysisBridge"));
vi.mock("@/entities/engine-presets/model/provider", () => passthrough("EnginePresetsProvider"));
vi.mock("@/entities/study-positions/model/provider", () => passthrough("StudyPositionsProvider"));

const resetOrientation = vi.fn();
const engineFailureBridge = vi.fn();

// **中身は差し替える。** 実物は `EngineProvider` の中に居る前提なのに、
// この試験は `EngineRuntimeBridge` を素通しに差し替えている。
// 実物のまま描くと器が無くて投げるので、載っているかだけを見る
vi.mock("../bridges/EngineFailureBridge", () => ({
  EngineFailureBridge: () => {
    engineFailureBridge();
    return null;
  },
}));

// 向きを読む側はこの部分木に居ないので、落とす側だけを差し替える。
// 使わない口を形だけ書くと、実物が変わっても気付けない
vi.mock("@/features/board-orientation", () => ({
  useResetOrientationOnKifuChange: () => resetOrientation(),
}));

const { RuntimeProviders } = await import("../RuntimeProviders");

afterEach(() => cleanup());

describe("RuntimeProviders", () => {
  test("盤の向きを落とす橋を載せる", () => {
    render(
      <RuntimeProviders>
        <div />
      </RuntimeProviders>,
    );

    expect(resetOrientation).toHaveBeenCalled();
  });

  /**
   * エンジンの失敗を届ける橋（`failure-surfacing.md` の F-9）。
   * **`engine` の `state.error` に他の読み手は居ない**ので、外すと失敗は
   * どの画面にも出なくなる。
   */
  test("エンジンの失敗を届ける橋を載せる", () => {
    render(
      <RuntimeProviders>
        <div />
      </RuntimeProviders>,
    );

    expect(engineFailureBridge).toHaveBeenCalled();
  });
});
