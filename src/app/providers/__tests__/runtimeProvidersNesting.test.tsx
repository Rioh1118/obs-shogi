// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";

/**
 * `RuntimeProviders` の入れ子の順と、橋がどの器の内側に載るか。
 *
 * 順を入れ替えても型も描画も通る。変わるのは誰が誰を読めるかで、内側の器が
 * 外側の値を読めなくなると、`use…` が投げるか、棋譜が入れ替わるたびに
 * 対局や定跡が畳まれる。`runtimeProvidersBridges.test.tsx` は載っていることだけを見て、
 * 場所は見ない。ここは器を全部差し替え、描かれたときに包んでいた器の並びで順を読む。
 */

/** 外から順に、いま包んでいる器の名前 */
const Layers = createContext<readonly string[]>([]);

function layer(name: string) {
  return ({ children }: { children?: ReactNode }) => {
    const outer = useContext(Layers);
    return <Layers.Provider value={[...outer, name]}>{children}</Layers.Provider>;
  };
}

/** 描かれたときに包んでいた器。橋は `null` を返すので DOM では探せない */
const placed: Record<string, readonly string[]> = {};

function leaf(name: string) {
  return () => {
    placed[name] = useContext(Layers);
    return null;
  };
}

function Child() {
  placed.child = useContext(Layers);
  return null;
}

vi.mock(
  "../gates/FileTreeRootGate",
  () =>
    ({
      FileTreeRootGate: layer("FileTreeRootGate"),
    }) satisfies typeof import("../gates/FileTreeRootGate"),
);
vi.mock(
  "../bridges/GameSessionBridge",
  () =>
    ({
      GameSessionBridge: layer("GameSessionBridge"),
    }) satisfies typeof import("../bridges/GameSessionBridge"),
);
vi.mock(
  "../gates/GameMoveGate",
  () => ({ GameMoveGate: layer("GameMoveGate") }) satisfies typeof import("../gates/GameMoveGate"),
);
vi.mock("@/entities/study-positions/model/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/study-positions/model/provider")>();
  const mocked = {
    ...actual,
    StudyPositionsProvider: layer("StudyPositionsProvider"),
  };
  return mocked satisfies typeof import("@/entities/study-positions/model/provider");
});
vi.mock("@/entities/engine-presets/model/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/engine-presets/model/provider")>();
  const mocked = {
    ...actual,
    EnginePresetsProvider: layer("EnginePresetsProvider"),
  };
  return mocked satisfies typeof import("@/entities/engine-presets/model/provider");
});
vi.mock(
  "../bridges/PresetsFileBridge",
  () =>
    ({
      PresetsFileBridge: leaf("PresetsFileBridge"),
    }) satisfies typeof import("../bridges/PresetsFileBridge"),
);
vi.mock(
  "../bridges/EngineRuntimeBridge",
  () =>
    ({
      EngineRuntimeBridge: layer("EngineRuntimeBridge"),
    }) satisfies typeof import("../bridges/EngineRuntimeBridge"),
);
vi.mock(
  "../bridges/EngineFailureBridge",
  () =>
    ({
      EngineFailureBridge: leaf("EngineFailureBridge"),
    }) satisfies typeof import("../bridges/EngineFailureBridge"),
);
vi.mock(
  "../bridges/EngineStartWarningBridge",
  () =>
    ({
      EngineStartWarningBridge: leaf("EngineStartWarningBridge"),
    }) satisfies typeof import("../bridges/EngineStartWarningBridge"),
);
vi.mock(
  "../gates/SearchRootGate",
  () =>
    ({
      SearchRootGate: layer("SearchRootGate"),
    }) satisfies typeof import("../gates/SearchRootGate"),
);
vi.mock(
  "../bridges/AnalysisBridge",
  () =>
    ({
      AnalysisBridge: layer("AnalysisBridge"),
    }) satisfies typeof import("../bridges/AnalysisBridge"),
);
vi.mock(
  "../bridges/AnalysisRefusalBridge",
  () =>
    ({
      AnalysisRefusalBridge: leaf("AnalysisRefusalBridge"),
    }) satisfies typeof import("../bridges/AnalysisRefusalBridge"),
);
vi.mock(
  "../bridges/BoardOrientationBridge",
  () =>
    ({
      BoardOrientationBridge: leaf("BoardOrientationBridge"),
    }) satisfies typeof import("../bridges/BoardOrientationBridge"),
);
vi.mock(
  "../gates/BookPositionGate",
  () =>
    ({
      BookPositionGate: layer("BookPositionGate"),
    }) satisfies typeof import("../gates/BookPositionGate"),
);

const { RuntimeProviders } = await import("../RuntimeProviders");

function layersAround(name: string): readonly string[] {
  const found = placed[name];
  if (!found) throw new Error(`${name} が載っていない`);
  return found;
}

afterEach(() => {
  for (const key of Object.keys(placed)) delete placed[key];
  cleanup();
});

describe("RuntimeProviders の入れ子", () => {
  test("器は外からこの順に重なり、中身はいちばん内側に入る", () => {
    render(
      <RuntimeProviders>
        <Child />
      </RuntimeProviders>,
    );

    expect(layersAround("child")).toEqual([
      "FileTreeRootGate",
      "GameSessionBridge",
      "GameMoveGate",
      "StudyPositionsProvider",
      "EnginePresetsProvider",
      "EngineRuntimeBridge",
      "SearchRootGate",
      "AnalysisBridge",
      "BookPositionGate",
    ]);
  });

  test.each([
    ["PresetsFileBridge", "EnginePresetsProvider"],
    ["EngineFailureBridge", "EngineRuntimeBridge"],
    ["EngineStartWarningBridge", "EngineRuntimeBridge"],
    ["AnalysisRefusalBridge", "AnalysisBridge"],
    ["BoardOrientationBridge", "AnalysisBridge"],
  ])("%s は %s のすぐ内側に載る", (name, parent) => {
    render(
      <RuntimeProviders>
        <Child />
      </RuntimeProviders>,
    );

    const around = layersAround(name);
    expect(around[around.length - 1]).toBe(parent);
  });
});
