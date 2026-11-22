// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Color } from "shogi.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AnalysisCandidate } from "@/entities/engine";
import type { EngineStatus } from "@/entities/analysis";
import type { MateSearchAvailability, MateSearchState } from "@/entities/mate-search";

/** 操作列と候補手の表が、検討と詰み探索のどちらのものとして出るか（AC-M6〜AC-M11） */
const SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const move = (usi: string, evaluation: AnalysisCandidate["evaluation"] = null) => ({
  rank: 1,
  first_move: usi,
  pv_line: [usi],
  evaluation,
});

const cache = { lookup: vi.fn(() => [move("2g2f")]), remember: vi.fn(), scopeTo: vi.fn() };
const analysis = {
  state: {
    isAnalyzing: false,
    starting: false,
    stopping: false,
    analyzedSfen: null as string | null,
    candidates: [] as AnalysisCandidate[],
  },
  candidateCache: cache,
  startInfiniteAnalysis: vi.fn(async () => {}),
  stopAnalysis: vi.fn(async () => {}),
};
const mate = {
  state: { phase: "closed" } as MateSearchState,
  ownsTable: false,
  availability: "ready" as MateSearchAvailability,
  toggle: vi.fn(async () => {}),
  dismiss: vi.fn(),
};
const status = { value: "standing-by" as EngineStatus };
const game = {
  state: { cursor: { tesuuPointer: "0,[]" } },
  view: { currentSfen: SFEN as string | null, currentTurn: Color.Black },
};

vi.mock("@/entities/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/analysis")>();
  const mocked = {
    ...actual,
    useAnalysis: (() => analysis) as unknown as typeof actual.useAnalysis,
  };
  return mocked satisfies typeof import("@/entities/analysis");
});
vi.mock("@/entities/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/engine")>();
  const mocked = {
    ...actual,
    useEngine: (() => ({
      state: { phase: "ready", error: null, lastOutput: null, unresponsiveReason: null },
      initialize: vi.fn(),
      cancelStart: vi.fn(),
      presetIncomplete: false,
      slowStart: false,
    })) as unknown as typeof actual.useEngine,
  };
  return mocked satisfies typeof import("@/entities/engine");
});
vi.mock("@/entities/mate-search/model/useMateSearch", () => {
  const mocked = { useMateSearch: () => mate };
  return mocked satisfies typeof import("@/entities/mate-search/model/useMateSearch");
});
vi.mock("@/entities/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game")>();
  const mocked = { ...actual, useGame: (() => game) as unknown as typeof actual.useGame };
  return mocked satisfies typeof import("@/entities/game");
});
vi.mock("@/entities/file-tree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/file-tree")>();
  const mocked = {
    ...actual,
    useFileTree: (() => ({ selectedNode: { id: "f" } })) as unknown as typeof actual.useFileTree,
  };
  return mocked satisfies typeof import("@/entities/file-tree");
});
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => {
  const mocked = {
    useEnginePresets: (() => ({
      state: { selectedPresetId: "p" },
    })) as unknown as typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets,
  };
  return mocked satisfies typeof import("@/entities/engine-presets/model/useEnginePresets");
});
vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => ({ config: {} })) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});
vi.mock("@/widgets/analysis-pane/lib/useEngineStatus", () => {
  const mocked = { useEngineStatus: () => status.value };
  return mocked satisfies typeof import("@/widgets/analysis-pane/lib/useEngineStatus");
});
vi.mock("@/entities/study-positions/model/useStudyPositions", () => {
  const mocked = {
    useStudyPositions: (() => ({
      findBySfen: () => null,
    })) as unknown as typeof import("@/entities/study-positions/model/useStudyPositions").useStudyPositions,
  };
  return mocked satisfies typeof import("@/entities/study-positions/model/useStudyPositions");
});

const { default: AnalysisControls } = await import("../AnalysisControls");
const { default: AnalysisPane } = await import("../AnalysisPane");

const controls = () =>
  render(
    <MemoryRouter initialEntries={["/app"]}>
      <AnalysisControls />
    </MemoryRouter>,
  );
const button = (title: string) => screen.getByTitle(title) as HTMLButtonElement;
const press = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

function own(state: MateSearchState) {
  mate.state = state;
  mate.ownsTable = state.phase !== "closed" && state.phase !== "preparing";
}
const SEARCHING: MateSearchState = {
  phase: "searching",
  sfen: SFEN,
  stopping: false,
  sessionId: "s1",
  startedAt: 0,
  candidates: [move("7g7f", { value: 7, kind: { MateInMoves: 7 } })],
};
const FINISHED: MateSearchState = {
  phase: "finished",
  sfen: SFEN,
  elapsedMs: 12_900,
  candidates: SEARCHING.candidates,
  outcome: { kind: "mate", moves: ["7g7f"] },
};

beforeEach(() => {
  vi.useFakeTimers({ now: 12_000 });
  vi.clearAllMocks();
  own({ phase: "closed" });
  mate.availability = "ready";
  status.value = "standing-by";
  game.view.currentSfen = SFEN;
  Object.assign(analysis.state, {
    isAnalyzing: false,
    starting: false,
    stopping: false,
    analyzedSfen: null,
    candidates: [],
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("詰み探索のボタン", () => {
  test("押すと始める。検討中でも無効にしない", async () => {
    analysis.state.isAnalyzing = true;
    status.value = "analyzing";
    controls();
    expect(button("詰み探索").disabled).toBe(false);
    await press(button("詰み探索"));
    expect(mate.toggle).toHaveBeenCalledTimes(1);
  });

  test("プリセットの指定が無ければ無効で、設定で選択するよう言う", () => {
    mate.availability = "unset";
    controls();
    expect(button("詰み探索に使うプリセットを設定で選択してください").disabled).toBe(true);
  });

  test("指定したプリセットのエンジンが未設定なら、別の文で言う", () => {
    mate.availability = "incomplete";
    controls();
    expect(button("詰み探索に使うプリセットのエンジンを設定で選択してください").disabled).toBe(
      true,
    );
  });

  test("読む局面が無ければ押せない", () => {
    game.view.currentSfen = null;
    controls();
    expect(button("詰み探索").disabled).toBe(true);
  });

  test("走っている間は中止のボタンで、止まるまでは押せない", () => {
    own(SEARCHING);
    const { unmount } = controls();
    expect(button("詰み探索を中止").disabled).toBe(false);
    unmount();

    own({ ...SEARCHING, stopping: true });
    controls();
    expect(button("詰み探索を中止").disabled).toBe(true);
  });

  test("走っている間にプリセットの指定が外れても、中止できる", () => {
    own(SEARCHING);
    mate.availability = "unset";
    controls();
    expect(button("詰み探索を中止").disabled).toBe(false);
  });
});

describe("操作列の語と ▶", () => {
  test.each<[string, MateSearchState]>([
    ["詰み探索の起動中…", { phase: "starting", sfen: SFEN, stopping: false }],
    ["詰み探索中12s", SEARCHING],
    ["詰み探索完了12s", FINISHED],
  ])("%s", (word, state) => {
    // 検討のエンジンの状態は語に出さない
    status.value = "exited";
    own(state);
    const { container } = controls();
    expect(container.querySelector(".analysis-controls__status")?.textContent).toBe(word);
  });

  test("検討の中断を待っている間の語は、検討のもの", () => {
    analysis.state.isAnalyzing = true;
    status.value = "analyzing";
    own({ phase: "preparing", sfen: SFEN });
    const { container } = controls();
    expect(container.querySelector(".analysis-controls__status-text")?.textContent).toBe("検討中");
  });

  test("▶ は詰み探索を閉じてから検討を始める", async () => {
    own(SEARCHING);
    controls();
    await press(button("検討を開始"));
    expect(mate.dismiss).toHaveBeenCalledTimes(1);
    expect(analysis.startInfiniteAnalysis).toHaveBeenCalledTimes(1);
    expect(mate.dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      analysis.startInfiniteAnalysis.mock.invocationCallOrder[0]!,
    );
  });

  test.each<EngineStatus>(["exited", "unresponsive", "failed", "cancelled", "no-engine"])(
    "検討のエンジンが %s なら、▶ は表を返すだけで検討を始めない",
    async (value) => {
      status.value = value;
      own(FINISHED);
      controls();
      await press(button("検討を開始"));
      expect(mate.dismiss).toHaveBeenCalledTimes(1);
      expect(analysis.startInfiniteAnalysis).not.toHaveBeenCalled();
    },
  );
});

describe("候補手の表", () => {
  test("探索中は詰将棋エンジンの候補手だけを出し、検討のキャッシュに読み書きしない", () => {
    own(SEARCHING);
    const { container } = render(<AnalysisPane />);
    const text = container.querySelector(".candidate-table")?.textContent ?? "";
    expect(text).toContain("Mate+7");
    expect(cache.lookup).not.toHaveBeenCalled();
    expect(cache.remember).not.toHaveBeenCalled();
    expect(container.querySelector(".analysis-pane__outcome")).toBeNull();
  });

  test("起動中は空", () => {
    own({ phase: "starting", sfen: SFEN, stopping: false });
    const { container } = render(<AnalysisPane />);
    expect(container.querySelectorAll(".candidate-table__row")).toHaveLength(0);
  });

  test("終わったら、最後の候補手の上に結論を1行出す", () => {
    own(FINISHED);
    const { container } = render(<AnalysisPane />);
    const outcome = screen.getByRole("status");
    expect(outcome.textContent).toMatch(/^1手詰 ☗/);
    expect(
      outcome.compareDocumentPosition(container.querySelector(".candidate-table")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelectorAll(".candidate-table__row")).toHaveLength(1);
  });

  test("検討のエンジンが止まっていても、詰み探索の候補手は薄くしない", () => {
    status.value = "exited";
    own(SEARCHING);
    const { container } = render(<AnalysisPane />);
    expect(container.querySelector(".analysis-pane--stale")).toBeNull();
  });

  test("表が検討に戻れば、検討のキャッシュから出す", () => {
    const { container } = render(<AnalysisPane />);
    expect(cache.lookup).toHaveBeenCalled();
    expect(container.querySelectorAll(".candidate-table__row")).toHaveLength(1);
  });
});
