// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { EnginePreset, PresetId } from "@/entities/engine-presets";

/**
 * 設定「エンジン管理」の一覧。行の並びと、行そのものの選択と中のボタンを見る。
 * 行の中身は `engineTabRow.test.tsx` が見る。
 */

const world = vi.hoisted(() => ({
  state: {
    status: "ok",
    error: null as string | null,
    presets: [] as unknown[],
    selectedPresetId: null as string | null,
    writable: true,
  },
  reload: vi.fn(async () => {}),
  selectPreset: vi.fn(async () => {}),
  createPreset: vi.fn(async () => null),
  duplicatePreset: vi.fn(async () => null),
  deletePreset: vi.fn(async () => true),
}));

vi.mock("../../engine-tab/MateSearchSection", () => {
  const mocked = { default: () => <></> };
  return mocked satisfies typeof import("../../engine-tab/MateSearchSection");
});

vi.mock(
  "@/entities/engine-presets/model/useEnginePresets",
  () =>
    ({
      useEnginePresets: () =>
        world as unknown as ReturnType<
          typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets
        >,
    }) satisfies typeof import("@/entities/engine-presets/model/useEnginePresets"),
);

vi.mock(
  "../../engine-preset-dialog/EnginePresetEditDialogPanel",
  () =>
    ({
      default: ({ presetId, onClose }: { presetId: string; onClose: () => void }) => (
        <button onClick={onClose}>{`編集中:${presetId}`}</button>
      ),
    }) satisfies typeof import("../../engine-preset-dialog/EnginePresetEditDialogPanel"),
);

const { default: EngineTab } = await import("../EngineTab");

function preset(id: string, label: string, patch: Partial<EnginePreset> = {}): EnginePreset {
  return {
    id: id as PresetId,
    label,
    aiName: "",
    enginePath: "/e/engine",
    evalFilePath: "",
    bookEnabled: false,
    bookFilePath: null,
    options: {},
    ...patch,
  };
}

const titles = (container: HTMLElement) =>
  [...container.querySelectorAll(".presetRow__label")].map((t) => t.textContent);

function row(container: HTMLElement, label: string) {
  const title = [...container.querySelectorAll(".presetRow__label")].find(
    (t) => t.textContent === label,
  );
  return title!.closest<HTMLElement>(".presetRow")!;
}

const inRow = (container: HTMLElement, label: string, action: string) =>
  within(row(container, label)).getByRole<HTMLButtonElement>("button", { name: action });

beforeEach(() => {
  world.state.status = "ok";
  world.state.error = null;
  world.state.presets = [preset("a", "甲"), preset("b", "乙")];
  world.state.selectedPresetId = null;
  world.state.writable = true;
  world.reload.mockClear();
  world.selectPreset.mockClear();
  world.createPreset.mockClear();
  world.duplicatePreset.mockClear();
  world.deletePreset.mockClear();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("並び", () => {
  test("適用中を先頭にして、残りは名前順", () => {
    world.state.presets = [preset("c", "ぬ"), preset("b", "い"), preset("a", "ろ")];
    world.state.selectedPresetId = "a";

    const { container, getAllByText } = render(<EngineTab />);

    expect(titles(container)).toEqual(["ろ", "い", "ぬ"]);
    expect(getAllByText("適用中")).toHaveLength(1);
    expect(row(container, "ろ").getAttribute("aria-selected")).toBe("true");
    expect(row(container, "い").getAttribute("aria-selected")).toBe("false");
    expect(row(container, "ろ").className).toContain("is-selected");
    expect(row(container, "い").className).not.toContain("is-selected");
  });

  test("適用中が元の並びの先頭でも末尾でも先頭に出る", () => {
    world.state.selectedPresetId = "a";
    world.state.presets = [preset("a", "ろ"), preset("b", "い")];
    const first = render(<EngineTab />);
    expect(titles(first.container)).toEqual(["ろ", "い"]);
    first.unmount();

    world.state.presets = [preset("b", "い"), preset("a", "ろ")];
    const last = render(<EngineTab />);
    expect(titles(last.container)).toEqual(["ろ", "い"]);
  });

  test("並べ替えは一覧そのものを動かさない", () => {
    const presets = [preset("c", "ぬ"), preset("b", "い")];
    world.state.presets = presets;
    render(<EngineTab />);

    expect(presets.map((p) => p.id)).toEqual(["c", "b"]);
  });

  test("空の名前は無名として出す", () => {
    world.state.presets = [preset("a", "  ")];
    const { container } = render(<EngineTab />);

    expect(titles(container)).toEqual(["（無名プリセット）"]);
  });
});

describe("上の操作", () => {
  test("読み込み中で空なら一覧の代わりに案内を出す", () => {
    world.state.status = "loading";
    world.state.presets = [];
    const { container } = render(<EngineTab />);

    expect(container.querySelector(".engineTab__loading")?.textContent).toBe("読み込み中…");
    expect(container.querySelector(".presetList")).toBeNull();
  });

  test("読み込み中でも持っている一覧は出す", () => {
    world.state.status = "loading";
    const { container } = render(<EngineTab />);

    expect(titles(container)).toHaveLength(2);
  });

  test("読めなかった理由を出す", () => {
    world.state.status = "error";
    world.state.error = "読めません";
    render(<EngineTab />);

    expect(screen.getByRole("alert").textContent).toBe("読めません");
  });

  test("「もう一度読み込む」で読み直す", () => {
    render(<EngineTab />);

    fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));

    expect(world.reload).toHaveBeenCalledTimes(1);
  });

  test("「追加」で新規プリセットを作る", () => {
    render(<EngineTab />);

    fireEvent.click(screen.getByRole("button", { name: "追加" }));

    expect(world.createPreset).toHaveBeenCalledWith({ label: "新規プリセット" });
  });

  test("読み込み中は追加も読み直しもできない", () => {
    world.state.status = "loading";
    render(<EngineTab />);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "追加" }).disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "もう一度読み込む" }).disabled,
    ).toBe(true);
  });
});

describe("行の選択", () => {
  test("押すと適用する", () => {
    const { container } = render(<EngineTab />);

    fireEvent.click(row(container, "乙"));

    expect(world.selectPreset).toHaveBeenCalledWith("b");
  });

  test.each(["Enter", " "])("「%s」でも適用する", (key) => {
    const { container } = render(<EngineTab />);

    fireEvent.keyDown(row(container, "乙"), { key });

    expect(world.selectPreset).toHaveBeenCalledWith("b");
  });

  test.each(["Enter", " "])("「%s」の既定の動作を止める", (key) => {
    const { container } = render(<EngineTab />);

    const notPrevented = fireEvent.keyDown(row(container, "乙"), { key });

    expect(notPrevented).toBe(false);
  });

  test("ほかのキーでは適用しない", () => {
    const { container } = render(<EngineTab />);

    fireEvent.keyDown(row(container, "乙"), { key: "a" });

    expect(world.selectPreset).not.toHaveBeenCalled();
  });
});

// 表（grid）を名乗るので、Tab で止まるのは1行だけで、行の間は矢印で動く
describe("行の間をキーで動く", () => {
  beforeEach(() => {
    world.state.presets = [preset("a", "甲"), preset("b", "乙"), preset("c", "丙")];
  });

  const tabStops = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>(".presetRow")].filter((r) => r.tabIndex === 0);

  test("Tab で止まる行は1つ", () => {
    const { container } = render(<EngineTab />);

    expect(tabStops(container)).toHaveLength(1);
  });

  /** 並びは名前順（「並び」）。上から何行目かで引く */
  const nth = (container: HTMLElement, at: number) => row(container, titles(container)[at]!);

  test("↓ で次の行へ、↑ で前の行へ動き、適用はしない", () => {
    const { container } = render(<EngineTab />);

    act(() => nth(container, 1).focus());
    fireEvent.keyDown(nth(container, 1), { key: "ArrowDown" });
    expect(document.activeElement).toBe(nth(container, 2));

    fireEvent.keyDown(nth(container, 2), { key: "ArrowUp" });
    expect(document.activeElement).toBe(nth(container, 1));
    expect(tabStops(container)).toEqual([nth(container, 1)]);
    expect(world.selectPreset).not.toHaveBeenCalled();
  });

  test("Home と End で端の行へ", () => {
    const { container } = render(<EngineTab />);

    act(() => nth(container, 1).focus());
    fireEvent.keyDown(nth(container, 1), { key: "End" });
    expect(document.activeElement).toBe(nth(container, 2));

    fireEvent.keyDown(nth(container, 2), { key: "Home" });
    expect(document.activeElement).toBe(nth(container, 0));
  });
});

describe("行のボタン", () => {
  /** 既定の動作を止めると、ボタンが押されないまま別のプリセットへ切り替わり、エンジンが再起動する */
  test.each([
    ["Enter", "編集"],
    [" ", "編集"],
    ["Enter", "複製"],
    [" ", "複製"],
    ["Enter", "削除"],
    [" ", "削除"],
  ])("「%s」で%sを押しても、行を適用せずボタンの動作を止めない", (key, action) => {
    const { container } = render(<EngineTab />);

    const notPrevented = fireEvent.keyDown(inRow(container, "乙", action), { key });

    expect(world.selectPreset).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  test("編集を押すと適用せずに開き、閉じられる", () => {
    const { container } = render(<EngineTab />);

    fireEvent.click(inRow(container, "乙", "編集"));

    expect(world.selectPreset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "編集中:b" }));
    expect(screen.queryByRole("button", { name: "編集中:b" })).toBeNull();
  });

  test("複製は行の選択を通らず、複製の操作だけを呼ぶ", () => {
    const { container } = render(<EngineTab />);

    fireEvent.click(inRow(container, "乙", "複製"));

    expect(world.duplicatePreset).toHaveBeenCalledWith("b");
    expect(world.selectPreset).not.toHaveBeenCalled();
  });

  test("削除は名前を出して確かめてから消す", async () => {
    const { container } = render(<EngineTab />);

    fireEvent.click(inRow(container, "乙", "削除"));
    await Promise.resolve();

    expect(window.confirm).toHaveBeenCalledWith("乙 を削除します。よろしいですか？");
    expect(world.deletePreset).toHaveBeenCalledWith("b");
    expect(world.selectPreset).not.toHaveBeenCalled();
  });

  test("無名の削除は「このプリセット」と呼ぶ", () => {
    world.state.presets = [preset("a", " "), preset("b", "乙")];
    const { container } = render(<EngineTab />);

    fireEvent.click(inRow(container, "（無名プリセット）", "削除"));

    expect(window.confirm).toHaveBeenCalledWith("このプリセット を削除します。よろしいですか？");
  });

  test("確かめて断られたら消さない", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const { container } = render(<EngineTab />);

    fireEvent.click(inRow(container, "乙", "削除"));
    await Promise.resolve();

    expect(world.deletePreset).not.toHaveBeenCalled();
  });

  test("最後の1枚は消せない", () => {
    world.state.presets = [preset("a", "甲")];
    const { container } = render(<EngineTab />);

    expect(inRow(container, "甲", "削除").disabled).toBe(true);
    expect(inRow(container, "甲", "編集").disabled).toBe(false);
  });

  test("書けないファイルでは変更の操作を押せない", () => {
    world.state.writable = false;
    const { container } = render(<EngineTab />);

    expect(inRow(container, "甲", "編集").disabled).toBe(true);
    expect(inRow(container, "甲", "複製").disabled).toBe(true);
    expect(inRow(container, "甲", "削除").disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "追加" }).disabled).toBe(true);
  });
});

describe("行の値", () => {
  /** 定跡と3つの数。欄ごとに文字をつなぐ */
  const cells = (container: HTMLElement, label: string) =>
    [...row(container, label).querySelectorAll(".presetRow__book, .presetRow__num")].map((cell) =>
      [...cell.childNodes].map((node) => node.textContent).join(" "),
    );

  test("保存した値を、桁で区切って欄ごとに出す", () => {
    world.state.presets = [
      preset("a", "甲", {
        options: { MultiPV: "3", Threads: "4", USI_Hash: "33554432" },
        bookEnabled: true,
        bookFilePath: "/b/book.db",
      }),
    ];
    const { container } = render(<EngineTab />);

    expect(cells(container, "甲")).toEqual(["ON", "3", "4", "33,554,432 MB"]);
    expect(row(container, "甲").querySelector(".presetRow__num--default")).toBeNull();
  });

  test("保存していない値は、エンジンの初期値に「初期値」を添えて出す", () => {
    const definition = (name: string, value: number) =>
      ({ name, type: "spin", default: value, min: 1, max: 9999 }) as NonNullable<
        EnginePreset["definitions"]
      >[number];
    world.state.presets = [
      preset("a", "甲", {
        definitionsFor: "/e/engine",
        reservedNames: [],
        definitions: [
          definition("MultiPV", 1),
          definition("Threads", 2),
          definition("USI_Hash", 1024),
        ],
      }),
    ];
    const { container } = render(<EngineTab />);

    expect(cells(container, "甲")).toEqual(["OFF", "1 初期値", "2 初期値", "1,024 MB 初期値"]);
  });

  test("初期値がいくつか分からなければ、「初期値」だけを出す", () => {
    world.state.presets = [preset("a", "甲")];
    const { container } = render(<EngineTab />);

    expect(cells(container, "甲")).toEqual(["OFF", "初期値", "初期値", "初期値"]);
  });
});

describe("候補手の数の注意", () => {
  const note = (container: HTMLElement) => container.querySelector(".engineTab__note");

  test.each(["2", "20"])("%s のプリセットが1つでもあれば、一覧の下に1つ出す", (multiPv) => {
    world.state.presets = [
      preset("a", "甲", { options: { MultiPV: "1" } }),
      preset("b", "乙", { options: { MultiPV: multiPv } }),
    ];
    const { container } = render(<EngineTab />);

    expect(container.querySelectorAll(".engineTab__note")).toHaveLength(1);
  });

  test("どれも1以下なら出さない", () => {
    world.state.presets = [preset("a", "甲", { options: { MultiPV: "1" } }), preset("b", "乙")];
    const { container } = render(<EngineTab />);

    expect(note(container)).toBeNull();
  });
});

describe("件数", () => {
  test("題に添え、節の名前には入れない", () => {
    const { container } = render(<EngineTab />);

    expect(container.querySelector(".sui-section__count")?.textContent).toBe("2");
    expect(screen.getByRole("region", { name: "検討プリセット" })).toBeTruthy();
  });
});
