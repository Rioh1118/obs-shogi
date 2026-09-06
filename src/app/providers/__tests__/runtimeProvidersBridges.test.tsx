// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * 盤の向きを落とす橋は `RuntimeProviders` に載っている。
 *
 * **外しても何も落ちない。** 型も通るしレンダも通る。起きるのは
 * 「棋譜を変えても向きが戻らない」だけで、例外もエラー表示も出ない。
 * 置き場ごとここで固定する。
 *
 * 橋が盤の中ではなくここに居る理由は
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
});
