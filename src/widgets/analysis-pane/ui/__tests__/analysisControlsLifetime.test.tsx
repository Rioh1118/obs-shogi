// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * **解析ビューが畳まれても、解析は止まらない。**
 *
 * `docs/state-transitions/dock-tabs.md` の不変条件1。ドックがタブの器になったので、
 * この面はタブを移るだけで unmount される。ここで停止を投げると、
 * **別のタブを覗いた人のエンジンが黙って止まる**——止めた覚えが無いので、
 * 戻ったときに「解析が終わっている」としか見えない。
 *
 * 席を返すのは `AnalysisProvider`（`RuntimeProviders` 側に居るので、
 * タブを移っても畳まれない）の仕事。
 */
const analysis = {
  state: { isAnalyzing: true },
  startInfiniteAnalysis: vi.fn(),
  stopAnalysis: vi.fn(),
};

vi.mock("@/entities/analysis", () => ({ useAnalysis: () => analysis }));
vi.mock("@/entities/game", () => ({
  useGame: () => ({ view: { currentSfen: "sfen" } }),
}));
vi.mock("@/features/settings/model/useOpenSettings", () => ({
  useOpenSettings: () => vi.fn(),
}));
vi.mock("@/entities/study-positions/model/useStudyPositions", () => ({
  useStudyPositions: () => ({ findBySfen: () => null }),
}));
vi.mock("@/features/board-orientation", () => ({
  useBoardOrientation: () => ({ isGotePov: false, toggle: vi.fn() }),
}));
vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: null, setDisplayConfig: vi.fn() }),
}));

const { default: AnalysisControls } = await import("../AnalysisControls");

afterEach(() => {
  analysis.stopAnalysis.mockClear();
  cleanup();
});

describe("解析ビューの寿命", () => {
  test("操作列が畳まれても、停止を投げない", () => {
    const { unmount } = render(
      <MemoryRouter>
        <AnalysisControls />
      </MemoryRouter>,
    );

    unmount();

    expect(analysis.stopAnalysis).not.toHaveBeenCalled();
  });
});
