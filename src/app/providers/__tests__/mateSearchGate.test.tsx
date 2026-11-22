// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ComponentProps } from "react";
import type { EnginePreset } from "@/entities/engine-presets";

/** 詰み探索へ渡すものの配線。取り違えても型は通り、別のエンジンで調べるか、検討の意思が残る */
type MateSearchProviderProps = ComponentProps<
  typeof import("@/entities/mate-search").MateSearchProvider
>;
const given: { props: MateSearchProviderProps | null } = { props: null };
const world = {
  config: {} as Record<string, unknown>,
  presets: [] as EnginePreset[],
  analysis: { isAnalyzing: false, starting: false },
  stopAnalysis: vi.fn(async () => {}),
};

vi.mock("@/entities/mate-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/mate-search")>();
  const mocked = {
    ...actual,
    MateSearchProvider: (props: MateSearchProviderProps) => {
      given.props = props;
      return <>{props.children}</>;
    },
  };
  return mocked satisfies typeof import("@/entities/mate-search");
});
vi.mock("@/entities/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game")>();
  const mocked = {
    ...actual,
    useGame: (() => ({ view: { currentSfen: "P1" } })) as unknown as typeof actual.useGame,
  };
  return mocked satisfies typeof import("@/entities/game");
});
vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => world) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => {
  const mocked = {
    useEnginePresets: (() => ({
      // 検討で選んでいるのは別のプリセット
      state: { presets: world.presets, selectedPresetId: "analysis" },
    })) as unknown as typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets,
  };
  return mocked satisfies typeof import("@/entities/engine-presets/model/useEnginePresets");
});
vi.mock("@/entities/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/analysis")>();
  const mocked = {
    ...actual,
    useAnalysis: (() => ({
      state: world.analysis,
      stopAnalysis: world.stopAnalysis,
    })) as unknown as typeof actual.useAnalysis,
  };
  return mocked satisfies typeof import("@/entities/analysis");
});

const { MateSearchGate } = await import("../gates/MateSearchGate");

const preset = (id: string, enginePath: string): EnginePreset => ({
  id,
  label: id,
  aiName: "",
  enginePath,
  evalFilePath: "",
  bookEnabled: false,
  bookFilePath: null,
  options: {},
});

function propsGiven(): MateSearchProviderProps {
  render(
    <MateSearchGate>
      <div />
    </MateSearchGate>,
  );
  return given.props!;
}

beforeEach(() => {
  given.props = null;
  world.config = { mate_preset_id: "mate", mate_search_limit: "10" };
  world.presets = [preset("analysis", "/e/analysis"), preset("mate", "/e/mate")];
  world.analysis = { isAnalyzing: false, starting: false };
});
afterEach(cleanup);

test("局面、詰み探索に指定したプリセット、上限、検討の中断を渡す", () => {
  expect(propsGiven()).toMatchObject({
    currentSfen: "P1",
    presetChosen: true,
    engine: { enginePath: "/e/mate" },
    limitMs: 10_000,
    analysisBusy: false,
    stopAnalysis: world.stopAnalysis,
  });
});

test.each([
  ["指定が無い", {}],
  ["指定したプリセットを削除した", { mate_preset_id: "gone" }],
])("%s なら、エンジンも指定も無い", (_, config) => {
  world.config = config;
  expect(propsGiven()).toMatchObject({ presetChosen: false, engine: null, limitMs: 30_000 });
});

test("指定したプリセットのエンジンが未設定なら、指定だけある", () => {
  world.presets = [preset("mate", "")];
  expect(propsGiven()).toMatchObject({ presetChosen: true, engine: null });
});

test.each([
  ["検討中", { isAnalyzing: true, starting: false }],
  ["▶ を押して始まるまでの間", { isAnalyzing: false, starting: true }],
])("%s なら、先に検討を中断する", (_, analysis) => {
  world.analysis = analysis;
  expect(propsGiven().analysisBusy).toBe(true);
});
