// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";

/**
 * 設定「エンジン管理」のカード。1枚に出すのはエンジンと評価関数（「フォルダ / ファイル」）と、
 * 要設定かどうか。要設定の判定はエンジンだけを見る（`isPresetConfigured`）
 */

const presets = { current: [] as EnginePreset[] };

vi.mock(
  "@/entities/engine-presets/model/useEnginePresets",
  () =>
    ({
      useEnginePresets: () =>
        ({
          state: { presets: presets.current, selectedPresetId: null, writable: true },
        }) as unknown as ReturnType<
          typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets
        >,
    }) satisfies typeof import("@/entities/engine-presets/model/useEnginePresets"),
);

const { default: EngineTab } = await import("../EngineTab");

const PRESET: EnginePreset = {
  id: "p1" as PresetId,
  label: "やねうら王",
  aiName: "hao",
  enginePath: "/ai/engines/YaneuraOu",
  evalFilePath: "/ai/hao/eval/nn.bin",
  bookEnabled: false,
  bookFilePath: null,
  options: {},
};

afterEach(cleanup);

/** カードの「見出し → 値」の並び */
const rows = (container: HTMLElement) =>
  [...container.querySelectorAll(".engineTab__row")].map((row) => [
    row.querySelector(".engineTab__k")?.textContent,
    row.querySelector(".engineTab__v")?.textContent,
  ]);

describe("エンジン管理のカード", () => {
  test("エンジンと評価関数を1行ずつ出す。評価関数はフォルダとファイルで", () => {
    presets.current = [PRESET];
    const { container, getByText } = render(<EngineTab />);

    expect(rows(container)).toEqual([
      ["エンジン", "YaneuraOu"],
      ["評価関数", "hao / nn.bin"],
    ]);
    expect(getByText("設定済み")).toBeTruthy();
  });

  test("評価関数（と、そのフォルダの AI の名前）が無くても設定済み。エンジンが無ければ要設定", () => {
    presets.current = [
      { ...PRESET, aiName: "", evalFilePath: "" },
      { ...PRESET, id: "p2" as PresetId, label: "空", enginePath: "" },
    ];
    const { container, getAllByText } = render(<EngineTab />);

    expect(rows(container).map(([k, v]) => `${k}:${v}`)).toEqual([
      "エンジン:YaneuraOu",
      "評価関数:指定しない",
      "エンジン:未設定",
      "評価関数:hao / nn.bin",
    ]);
    expect(getAllByText("設定済み")).toHaveLength(1);
    expect(getAllByText("要設定")).toHaveLength(1);
  });
});
