// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { Ok } from "@/shared/lib/result";

/**
 * 対局を始める面。
 *
 * **守るのは「押した結果が画面に出ること」。** この面は棋譜を1枚作ってから
 * 対局を走らせるので、途中で止まると**使われない棋譜だけが残る**。
 * 押せない条件も、押した後の遷移も、ここで固定する。
 */

const tree = vi.hoisted(() => ({
  createNewFile: vi.fn(async () => Ok("/w/game.kif")),
  selectNodeByAbsPath: vi.fn(() => true),
  fileTree: { path: "/w", name: "w", isDirectory: true, children: [] },
}));

const session = vi.hoisted(() => ({
  view: { kind: "idle", eventsUnavailable: null } as Record<string, unknown>,
  start: vi.fn(async () => undefined),
  // **既定は「始められる」。** 断る形は各試験が差し替える
  startRefusal: vi.fn(async (): Promise<string | null> => null),
}));

/**
 * **実物を混ぜてから差し替える。** 差し替える先の形と結び付いていないと、
 * 実物が export を増やしても改名してもここは古いまま緑で残る
 * （`src/__tests__/viMockShape.test.ts`）。
 *
 * 返す偽物は主題の欄しか持たないので、口の型は `never` を通して合わせる ——
 * **見たいのは export の集合が合っていること**で、欄の網羅ではない。
 */
const partial = <T,>(value: unknown): T => value as T;

vi.mock(
  "@/entities/file-tree",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/file-tree")>()),
      useFileTree: () =>
        partial<ReturnType<typeof import("@/entities/file-tree").useFileTree>>(tree),
    }) satisfies typeof import("@/entities/file-tree"),
);

vi.mock(
  "@/entities/game-session",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/game-session")>()),
      useGameSession: () =>
        partial<ReturnType<typeof import("@/entities/game-session").useGameSession>>(session),
    }) satisfies typeof import("@/entities/game-session"),
);

vi.mock(
  "@/entities/engine-presets/model/useEnginePresets",
  () =>
    ({
      useEnginePresets: () =>
        partial<
          ReturnType<
            typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets
          >
        >({ state: { presets: [] } }),
    }) satisfies typeof import("@/entities/engine-presets/model/useEnginePresets"),
);

vi.mock(
  "@/entities/app-config",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/app-config")>()),
      useAppConfig: () =>
        partial<ReturnType<typeof import("@/entities/app-config").useAppConfig>>({
          config: { ai_root: "/ai" },
        }),
    }) satisfies typeof import("@/entities/app-config"),
);

const { default: GameStartModal } = await import("../GameStartModal");

/** いまの URL。**遷移が1回で済んだかを見る** */
let search = "";

function Probe() {
  search = useLocation().search;
  return null;
}

function open() {
  return render(
    <MemoryRouter initialEntries={["/?modal=game-start&dir=%2Fw"]}>
      <Probe />
      <GameStartModal />
    </MemoryRouter>,
  );
}

function submit() {
  const form = document.querySelector("form");
  if (form === null) throw new Error("フォームが出ていない");
  return act(async () => {
    form.requestSubmit();
  });
}

function typeInto(label: string, value: string) {
  const input = screen.getByLabelText(label, { exact: false });
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tree.createNewFile.mockResolvedValue(Ok("/w/game.kif"));
  tree.selectNodeByAbsPath.mockReturnValue(true);
  session.view = { kind: "idle", eventsUnavailable: null };
  search = "";
});

afterEach(() => {
  cleanup();
});

describe("対局を始める面", () => {
  /**
   * **`closeModal()` の直後に `updateParams` を呼ぶと、閉じる前の写しから
   * 組み直して `modal=game-start` を書き戻す。** 対局は走り出すのに
   * フォームが覆いかぶさったまま残り、そこには「すでに対局があります」が出る。
   */
  test("始めたら、この面は閉じて対局タブへ移る", async () => {
    open();
    await typeInto("ファイル名", "テスト");
    await submit();

    expect(tree.createNewFile).toHaveBeenCalledTimes(1);
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(search).not.toContain("modal=game-start");
    expect(search).toContain("dock=play");
  });

  /**
   * **作った棋譜を盤へ載せてから始める。** 載せないと対局の手を積む先が
   * 前の棋譜のままになり、ようこそ画面から始めた場合はドックごと存在しない。
   */
  test("作った棋譜を盤に載せてから始める", async () => {
    open();
    await typeInto("ファイル名", "テスト");
    await submit();

    expect(tree.selectNodeByAbsPath).toHaveBeenCalledWith("/w/game.kif", { forceReopen: true });
  });

  test("盤に載せられなかったら、対局を始めない", async () => {
    tree.selectNodeByAbsPath.mockReturnValue(false);
    open();
    await typeInto("ファイル名", "テスト");
    await submit();

    expect(session.start).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("ツリーに見つかりません");
  });

  /**
   * **始め損ねた対局は、閉じずにやり直せる**（進行の側も `failed` だけは断らない）。
   * ここで沈めると、設定を直してもこの面からやり直せなくなる。
   */
  test("始め損ねた対局が残っていても押せる", async () => {
    session.view = { kind: "failed", kifuPath: "/w/a.kif", message: "起動できない" };
    open();
    await typeInto("ファイル名", "テスト");
    await submit();

    expect(session.start).toHaveBeenCalledTimes(1);
  });

  /** **出来事が届かないなら、始めても進まない。** 棋譜だけ作って終わらせない */
  test("購読が張れていなければ、棋譜も作らない", async () => {
    session.view = { kind: "idle", eventsUnavailable: "listen failed" };
    open();
    await typeInto("ファイル名", "テスト");
    await submit();

    expect(tree.createNewFile).not.toHaveBeenCalled();
    expect(session.start).not.toHaveBeenCalled();
  });

  /**
   * **押せる表示のまま断られる窓がある。**
   *
   * 押せるかの表示は描画時の `view` から組むが、進行の側は
   * `listenSettledRef` を待った**後の** ref を見る。購読が張り終わる前に押した1回は、
   * 画面が「張れている」と読んで通す。
   *
   * そこで `start` が黙って戻ると、**対局していない棋譜が1枚できて、
   * ドックだけが対局タブへ移る。** 棋譜を作る前に同じ関数で断りを取ること。
   */
  test("進行の側が断るなら、棋譜も作らない", async () => {
    session.startRefusal.mockResolvedValueOnce("events-unavailable");
    open();
    await typeInto("ファイル名", "テスト");
    await submit();

    expect(tree.createNewFile).not.toHaveBeenCalled();
    expect(session.start).not.toHaveBeenCalled();
  });

  /** **理由を出す。** 押せたのに何も起きないと、押し損ねたと読まれる */
  test("断られた理由を、押せない案内と同じ文言で出す", async () => {
    session.startRefusal.mockResolvedValueOnce("held");
    open();
    await typeInto("ファイル名", "テスト");
    await submit();

    expect(screen.getByText(/すでに対局があります。対局タブで「閉じる」を押してから/)).toBeTruthy();
  });

  /**
   * **`Number("１０")` は `NaN`。** 通すと `mainMs: null` が Rust へ飛んで
   * 取り込みで落ちる —— そのときには棋譜が既に作られている。
   */
  test("持ち時間が数でなければ、棋譜も作らない", async () => {
    open();
    await typeInto("ファイル名", "テスト");
    await typeInto("持ち時間（分）", "１０");
    await typeInto("秒読み（秒）", "あ");
    await submit();

    expect(tree.createNewFile).not.toHaveBeenCalled();
  });
});
