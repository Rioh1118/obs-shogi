// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { BOUNDARY_LABELS } from "@/shared/ui/AppErrorBoundary";
import type { DockViewBindings } from "@/widgets/dock/model/bindings";

/**
 * ドックのタブ切替。表は `docs/state-transitions/dock-tabs.md`。
 *
 * ここが踏むのは **D1（別のタブを選ぶ）** と **D2（見ているタブを一覧から外す）** の行。
 * 解析そのものの遷移は `analysis.md` 側が持つ。**畳まれても解析を止めないこと**は
 * ビューの側の検査（`analysisControlsLifetime.test.tsx`）が見る——器はそもそも
 * 解析を知らないので、ここに置くと何も見ていない検査になる。
 *
 * **名簿を差し替える。** 実在するビューは解析1枚なので、本物のままだと
 * タブ切替そのものが踏めない。
 */
const FAKE = vi.hoisted(() => [
  { key: "analysis", label: "解析", removable: false, defaultVisible: true },
  { key: "book", label: "定跡", removable: true, defaultVisible: true },
]);

vi.mock("@/entities/dock/model/views", () => ({
  DOCK_VIEWS: FAKE,
  dockViewMeta: (key: string) => FAKE.find((v) => v.key === key),
  dockViewLabel: (key: string) => FAKE.find((v) => v.key === key)?.label ?? key,
}));

const config = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  setDisplayConfig: vi.fn(async () => ({ success: true as const, data: undefined })),
}));

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: config.current, setDisplayConfig: config.setDisplayConfig }),
}));

const { default: Dock } = await import("../Dock");

/** 落ちる部品。テストごとに1つだけ真にする */
const throwing = { book: false, bookControls: false };

const VIEWS = {
  analysis: {
    Body: () => <div data-testid="analysis-body" />,
    Controls: () => <div data-testid="analysis-controls" />,
    boundary: BOUNDARY_LABELS.analysis,
    fallbackHint: "解析の案内",
  },
  book: {
    Body: () => {
      if (throwing.book) throw new Error("定跡ビューの中で落ちた");
      return <div data-testid="book-body" />;
    },
    Controls: () => {
      if (throwing.bookControls) throw new Error("定跡ビューの操作列の中で落ちた");
      return <div data-testid="book-controls" />;
    },
    boundary: BOUNDARY_LABELS.kifuStream,
    fallbackHint: "定跡の案内",
  },
} as unknown as DockViewBindings;

function mount(url = "/app") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Dock views={VIEWS} />
    </MemoryRouter>,
  );
}

const tab = (label: string) => screen.getByRole("tab", { name: label });

beforeEach(() => {
  config.current = null;
  config.setDisplayConfig.mockClear();
  throwing.book = false;
  throwing.bookControls = false;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ドックのタブ", () => {
  test("一覧に出るのは設定が並べたタブだけで、順番もそのまま", () => {
    config.current = { dock_tabs: ["book", "analysis"] };
    mount();

    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual(["定跡", "解析"]);
  });

  // (Ta, D1) —— 前のビューは畳まれ、新しいビューが出る
  test("別のタブを選ぶと、前のビューは消えて新しいビューが出る", () => {
    mount();
    expect(screen.getByTestId("analysis-body")).toBeTruthy();

    fireEvent.click(tab("定跡"));

    expect(screen.queryByTestId("analysis-body")).toBeNull();
    expect(screen.getByTestId("book-body")).toBeTruthy();
  });

  // 受け入れ条件「各タブが自分の操作列を持ち、他のタブの操作が出ない」
  test("操作列は選んでいるビューのものだけが出る", () => {
    mount();
    expect(screen.getByTestId("analysis-controls")).toBeTruthy();
    expect(screen.queryByTestId("book-controls")).toBeNull();

    fireEvent.click(tab("定跡"));

    expect(screen.getByTestId("book-controls")).toBeTruthy();
    expect(screen.queryByTestId("analysis-controls")).toBeNull();
  });

  // (Tx, D1) —— リロードで戻る道は URL が持つ
  test("URL の `dock=` が指すタブで開く", () => {
    mount("/app?dock=book");

    expect(screen.getByTestId("book-body")).toBeTruthy();
    expect(tab("定跡").getAttribute("aria-selected")).toBe("true");
  });

  test("選んだタブは URL にも設定にも残す", () => {
    mount();

    fireEvent.click(tab("定跡"));

    expect(config.setDisplayConfig).toHaveBeenCalledWith({ dock_last_tab: "book" });
    expect(tab("定跡").getAttribute("aria-selected")).toBe("true");
  });

  /**
   * (Tx, D2) —— 見ているタブを一覧から外した回。
   *
   * **知っていた顔ぶれを一緒に置く。** 置かないと「まだ無かったビュー」と区別が付かず、
   * `resolveDockTabs` が既定で出すものを足し直す（→ `entities/dock/lib/tabs.ts`）。
   */
  test("いま見ているタブが一覧から外れたら、残っているタブへ落ちる", () => {
    config.current = { dock_tabs: ["analysis"], dock_tabs_known: ["analysis", "book", "play"] };
    mount("/app?dock=book");

    expect(screen.getByTestId("analysis-body")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "定跡" })).toBeNull();
  });

  // 注1 —— `T0` から出るときに開くタブは設定が決める
  test("起動時に開くタブを決めてあれば、そこから始まる", () => {
    config.current = { dock_startup_tab: "book", dock_last_tab: "analysis" };
    mount();

    expect(screen.getByTestId("book-body")).toBeTruthy();
  });

  test("決めていなければ、前回のタブから始まる", () => {
    config.current = { dock_startup_tab: null, dock_last_tab: "book" };
    mount();

    expect(screen.getByTestId("book-body")).toBeTruthy();
  });

  // **操作列も境界の中に居ること。** 外に居ると、ここで落ちた回はドックの境界が
  // 受けず、1つ外（作業画面）まで畳まれる —— 盤も棋譜一覧もヘッダも消える
  test("操作列が落ちても、畳まれるのはドックの中だけで、タブ列は残る", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.bookControls = true;
    mount("/app?dock=book");

    expect(screen.getByText("棋譜一覧を表示できませんでした。")).toBeTruthy();
    expect(screen.getByRole("tablist")).toBeTruthy();
  });

  /**
   * `role="tablist"` は矢印での移動を期待させる役。名乗るなら持つこと
   * （`AnalysisControls` は持たないので `role="toolbar"` を名乗っていない）。
   */
  test("矢印でタブを移せて、選んでいないタブは Tab の順から外れる", () => {
    mount();

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });

    expect(tab("定跡").getAttribute("aria-selected")).toBe("true");
    expect(tab("定跡").getAttribute("tabindex")).toBe("0");
    expect(tab("解析").getAttribute("tabindex")).toBe("-1");
  });

  test("端で押すと反対の端へ回る", () => {
    mount();

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });

    expect(tab("定跡").getAttribute("aria-selected")).toBe("true");
  });

  test("ビューが落ちても、タブ列は残るので別の面へ移れる", () => {
    // 境界が捕まえた例外は `componentDidCatch` と React の両方が出す。出力だけ畳む
    vi.spyOn(console, "error").mockImplementation(() => {});
    throwing.book = true;
    mount("/app?dock=book");

    expect(screen.getByText("棋譜一覧を表示できませんでした。")).toBeTruthy();

    fireEvent.click(tab("解析"));

    expect(screen.getByTestId("analysis-body")).toBeTruthy();
  });
});
