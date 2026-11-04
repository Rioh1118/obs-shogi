// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { EngineStatus } from "@/entities/analysis";

/**
 * 操作列のボタンが、どの条件で何を呼ぶか。
 *
 * ▶ と ■ はエンジンへ届き、他のボタンは URL の `modal` と `pov` を書く。
 * 呼び先を取り違えると、押した人には「何も起きない」か「別の面が開く」としか見えない。
 * 状態ごとに出すボタンの形は `analysisControlsStatus.test.tsx` が見る。
 */

const analysis = {
  state: { isAnalyzing: false, starting: false, stopping: false },
  startInfiniteAnalysis: vi.fn(async () => {}),
  stopAnalysis: vi.fn(async () => {}),
};
const engine = {
  state: {
    phase: "ready",
    error: null as { kind: string; lastOutput: string | null } | null,
    lastOutput: null as string | null,
  },
  initialize: vi.fn(async () => {}),
  cancelStart: vi.fn(),
  presetIncomplete: false,
  slowStart: false,
};
const game = { view: { currentSfen: "P1" as string | null } };
const status = { value: "standing-by" as EngineStatus };
const bookmarked = { value: false };

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
    useEngine: (() => engine) as unknown as typeof actual.useEngine,
  };
  return mocked satisfies typeof import("@/entities/engine");
});
vi.mock("@/entities/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game")>();
  const mocked = {
    ...actual,
    useGame: (() => game) as unknown as typeof actual.useGame,
  };
  return mocked satisfies typeof import("@/entities/game");
});
vi.mock("@/widgets/analysis-pane/lib/useEngineStatus", () => {
  const mocked = { useEngineStatus: () => status.value };
  return mocked satisfies typeof import("@/widgets/analysis-pane/lib/useEngineStatus");
});
vi.mock("@/entities/study-positions/model/useStudyPositions", () => {
  const mocked = {
    useStudyPositions: (() => ({
      findBySfen: (sfen: string | null) => (bookmarked.value && sfen ? { sfen } : null),
    })) as unknown as typeof import("@/entities/study-positions/model/useStudyPositions").useStudyPositions,
  };
  return mocked satisfies typeof import("@/entities/study-positions/model/useStudyPositions");
});

const { default: AnalysisControls } = await import("../AnalysisControls");

function mount(search = "") {
  const seen = { search: "" };

  function LocationProbe() {
    seen.search = useLocation().search;
    return <></>;
  }

  render(
    <MemoryRouter initialEntries={[`/app${search}`]}>
      <AnalysisControls />
      <LocationProbe />
    </MemoryRouter>,
  );

  return { params: () => new URLSearchParams(seen.search) };
}

async function press(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

beforeEach(() => {
  analysis.state = { isAnalyzing: false, starting: false, stopping: false };
  analysis.startInfiniteAnalysis.mockClear();
  analysis.stopAnalysis.mockClear();
  engine.state = { phase: "ready", error: null, lastOutput: null };
  engine.initialize.mockClear();
  engine.cancelStart.mockClear();
  engine.slowStart = false;
  engine.presetIncomplete = false;
  game.view.currentSfen = "P1";
  status.value = "standing-by";
  bookmarked.value = false;
});

afterEach(cleanup);

describe("▶ と ■", () => {
  test("検討していなければ、押すと検討を始める", async () => {
    mount();

    await press(screen.getByTitle("検討を開始"));

    expect(analysis.startInfiniteAnalysis).toHaveBeenCalledTimes(1);
    expect(analysis.stopAnalysis).not.toHaveBeenCalled();
  });

  test("検討中に押すと中断する", async () => {
    analysis.state.isAnalyzing = true;
    status.value = "analyzing";
    mount();

    await press(screen.getByTitle("検討を中断"));

    expect(analysis.stopAnalysis).toHaveBeenCalledTimes(1);
    expect(analysis.startInfiniteAnalysis).not.toHaveBeenCalled();
  });

  test("起動を待って読み始める前に押しても、中断する", async () => {
    analysis.state.starting = true;
    status.value = "starting";
    mount();

    await press(screen.getByTitle("検討を中断"));

    expect(analysis.stopAnalysis).toHaveBeenCalledTimes(1);
    expect(analysis.startInfiniteAnalysis).not.toHaveBeenCalled();
  });

  test("中断を頼んだ後は押せない", () => {
    analysis.state = { isAnalyzing: true, starting: false, stopping: true };
    status.value = "analyzing";
    mount();

    expect((screen.getByTitle("検討を中断") as HTMLButtonElement).disabled).toBe(true);
  });

  test("始めるのが断られても、操作列は落ちない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    analysis.startInfiniteAnalysis.mockRejectedValueOnce(new Error("refused"));
    mount();

    await press(screen.getByTitle("検討を開始"));

    expect(screen.getByTitle("検討を開始")).toBeTruthy();
    error.mockRestore();
  });

  test("エンジンが終わったら、再起動のボタンが起こし直す", async () => {
    status.value = "exited";
    mount();

    await press(screen.getByRole("button", { name: "再起動" }));

    expect(engine.initialize).toHaveBeenCalledTimes(1);
  });

  test("起動が長引いたら、起動を中止のボタンが起動を取り消す", async () => {
    status.value = "starting";
    engine.slowStart = true;
    mount();

    await press(screen.getByRole("button", { name: "起動を中止" }));

    expect(engine.cancelStart).toHaveBeenCalledTimes(1);
  });
});

describe("起動の失敗のボタン", () => {
  test("同じ設定で直る見込みの無い失敗では、設定を開くボタンが設定のエンジンのタブを開く", async () => {
    engine.state = {
      phase: "error",
      error: { kind: "invalidValue", lastOutput: null },
      lastOutput: null,
    };
    status.value = "failed";
    const { params } = mount();

    expect(screen.queryByRole("button", { name: "もう一度起動" })).toBeNull();
    await press(screen.getAllByRole("button", { name: "設定を開く" })[0]);

    expect(params().get("tab")).toBe("engine");
  });

  test("プリセットの設定が足りなければ、語を押して理由を読める", () => {
    engine.presetIncomplete = true;
    status.value = "failed";
    mount();

    expect(screen.getByRole("button", { name: "起動失敗" })).toBeTruthy();
  });
});

describe("局面の道具と設定", () => {
  test.each([
    ["局面ナビゲーション", "navigation"],
    ["局面検索", "position-search"],
    ["局面を保存", "study-position-save"],
  ])("%s を押すと modal=%s を開く", async (title, modal) => {
    const { params } = mount();

    await press(screen.getByTitle(title));

    expect(params().get("modal")).toBe(modal);
  });

  test("局面が無ければ、局面の道具は押せない", () => {
    game.view.currentSfen = null;
    mount();

    for (const title of ["局面ナビゲーション", "局面検索", "局面を保存"]) {
      expect((screen.getByTitle(title) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByTitle("検討を開始") as HTMLButtonElement).disabled).toBe(true);
  });

  test("保存済みの局面では、課題局面の編集として押せる", () => {
    bookmarked.value = true;
    mount();

    expect(screen.getByTitle("課題局面を編集").getAttribute("aria-pressed")).toBe("true");
  });

  test("設定を押すと、エンジンのタブで設定を開く", async () => {
    const { params } = mount();

    await press(screen.getByTitle("設定"));

    expect(params().get("modal")).toBe("settings");
    expect(params().get("tab")).toBe("engine");
  });

  test("向きのボタンは盤を後手視点にし、もう一度押すと戻す", async () => {
    const { params } = mount();

    await press(screen.getByTitle("後手視点にする"));
    expect(params().get("pov")).toBe("gote");
    expect(screen.getByTitle("先手視点に戻す").getAttribute("aria-pressed")).toBe("true");

    await press(screen.getByTitle("先手視点に戻す"));
    expect(params().get("pov")).toBeNull();
  });
});

describe("語を押して出す文", () => {
  test("文に添える出力は、失敗が持つものを先に使う", async () => {
    engine.state = {
      phase: "error",
      error: { kind: "spawnFailed", lastOutput: "stderr: from error" },
      lastOutput: "stderr: from engine",
    };
    status.value = "failed";
    mount();

    await press(screen.getByRole("button", { name: "起動失敗" }));

    expect(screen.getByText("stderr: from error")).toBeTruthy();
  });

  test("失敗が出力を持たなければ、エンジンの最後の出力を使う", async () => {
    engine.state = { phase: "exited", error: null, lastOutput: "stderr: from engine" };
    status.value = "exited";
    mount();

    await press(screen.getByRole("button", { name: "エンジン終了" }));

    expect(screen.getByText("stderr: from engine")).toBeTruthy();
  });

  test("文の設定のボタンは、エンジンのタブで設定を開く", async () => {
    engine.state = { phase: "exited", error: null, lastOutput: null };
    status.value = "exited";
    const { params } = mount();

    await press(screen.getByRole("button", { name: "エンジン終了" }));
    await press(screen.getByRole("button", { name: "設定を開く" }));

    expect(params().get("modal")).toBe("settings");
    expect(params().get("tab")).toBe("engine");
  });
});
