// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";

/**
 * 設定「エンジン管理」の一覧。カードの並びと、カード自身の選択と中のボタンを見る。
 * カードの中身の行は `engineTabCard.test.tsx` が見る。
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
  [...container.querySelectorAll(".engineTab__cardTitle")].map((t) => t.textContent);

function card(container: HTMLElement, label: string) {
  const title = [...container.querySelectorAll(".engineTab__cardTitle")].find(
    (t) => t.textContent === label,
  );
  return title!.closest<HTMLElement>(".engineTab__card")!;
}

const inCard = (container: HTMLElement, label: string, action: string) =>
  within(card(container, label)).getByRole<HTMLButtonElement>("button", { name: action });

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
    expect(card(container, "ろ").className).toContain("is-selected");
    expect(card(container, "い").className).not.toContain("is-selected");
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
    expect(container.querySelector(".engineTab__grid")).toBeNull();
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

  test("読み込み中は追加できない", () => {
    world.state.status = "loading";
    render(<EngineTab />);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "追加" }).disabled).toBe(true);
  });
});

describe("カードの選択", () => {
  test("押すと適用する", () => {
    const { container } = render(<EngineTab />);

    fireEvent.click(card(container, "乙"));

    expect(world.selectPreset).toHaveBeenCalledWith("b");
  });

  test.each(["Enter", " "])("「%s」でも適用する", (key) => {
    const { container } = render(<EngineTab />);

    fireEvent.keyDown(card(container, "乙"), { key });

    expect(world.selectPreset).toHaveBeenCalledWith("b");
  });

  test("ほかのキーでは適用しない", () => {
    const { container } = render(<EngineTab />);

    fireEvent.keyDown(card(container, "乙"), { key: "a" });

    expect(world.selectPreset).not.toHaveBeenCalled();
  });
});

describe("カードのボタン", () => {
  test("編集を押すと適用せずに開き、閉じられる", () => {
    const { container } = render(<EngineTab />);

    fireEvent.click(inCard(container, "乙", "編集"));

    expect(world.selectPreset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "編集中:b" }));
    expect(screen.queryByRole("button", { name: "編集中:b" })).toBeNull();
  });

  test("複製を押すと適用せずに複製する", () => {
    const { container } = render(<EngineTab />);

    fireEvent.click(inCard(container, "乙", "複製"));

    expect(world.duplicatePreset).toHaveBeenCalledWith("b");
    expect(world.selectPreset).not.toHaveBeenCalled();
  });

  test("削除は名前を出して確かめてから消す", async () => {
    const { container } = render(<EngineTab />);

    fireEvent.click(inCard(container, "乙", "削除"));
    await Promise.resolve();

    expect(window.confirm).toHaveBeenCalledWith("乙 を削除します。よろしいですか？");
    expect(world.deletePreset).toHaveBeenCalledWith("b");
    expect(world.selectPreset).not.toHaveBeenCalled();
  });

  test("無名の削除は「このプリセット」と呼ぶ", () => {
    world.state.presets = [preset("a", " "), preset("b", "乙")];
    const { container } = render(<EngineTab />);

    fireEvent.click(inCard(container, "（無名プリセット）", "削除"));

    expect(window.confirm).toHaveBeenCalledWith("このプリセット を削除します。よろしいですか？");
  });

  test("確かめて断られたら消さない", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const { container } = render(<EngineTab />);

    fireEvent.click(inCard(container, "乙", "削除"));
    await Promise.resolve();

    expect(world.deletePreset).not.toHaveBeenCalled();
  });

  test("最後の1枚は消せない", () => {
    world.state.presets = [preset("a", "甲")];
    const { container } = render(<EngineTab />);

    expect(inCard(container, "甲", "削除").disabled).toBe(true);
    expect(inCard(container, "甲", "編集").disabled).toBe(false);
  });

  test("書けないファイルでは変更の操作を押せない", () => {
    world.state.writable = false;
    const { container } = render(<EngineTab />);

    expect(inCard(container, "甲", "編集").disabled).toBe(true);
    expect(inCard(container, "甲", "複製").disabled).toBe(true);
    expect(inCard(container, "甲", "削除").disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "追加" }).disabled).toBe(true);
  });
});

describe("候補手の数の注意", () => {
  test("2以上でだけ出す", () => {
    world.state.presets = [
      preset("a", "甲", { options: { MultiPV: "1" } }),
      preset("b", "乙", { options: { MultiPV: "2" } }),
    ];
    const { container } = render(<EngineTab />);

    expect(card(container, "甲").querySelector(".engineTab__note")).toBeNull();
    expect(card(container, "乙").querySelector(".engineTab__note")).not.toBeNull();
    expect(card(container, "乙").querySelector(".engineTab__miniV.is-warn")?.textContent).toBe("2");
  });
});
