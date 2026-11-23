// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { EnginePreset, PresetId } from "@/entities/engine-presets";

/**
 * 設定「エンジン管理」の行。1行に出すのはエンジンと評価関数（「フォルダ / ファイル」）と、
 * 要設定かどうか。要設定の判定はエンジンだけを見る（`isPresetConfigured`）。
 * うまくいっている間は何も言わない（「設定済み」と書かない）
 */

const presets = { current: [] as EnginePreset[] };

vi.mock("../../engine-tab/MateSearchSection", () => {
  const mocked = { default: () => <></> };
  return mocked satisfies typeof import("../../engine-tab/MateSearchSection");
});

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

/** 行の「エンジン／評価関数」 */
const files = (container: HTMLElement) =>
  [...container.querySelectorAll(".presetRow")].map((row) => [
    row.querySelector(".presetRow__engine")?.textContent,
    row.querySelector(".presetRow__eval")?.textContent,
  ]);

describe("エンジン管理の行", () => {
  test("エンジンと評価関数を出す。評価関数はフォルダとファイルで", () => {
    presets.current = [PRESET];
    const { container, queryByText } = render(<EngineTab />);

    expect(files(container)).toEqual([["YaneuraOu", "hao / nn.bin"]]);
    expect(queryByText("要設定")).toBeNull();
    expect(queryByText("設定済み")).toBeNull();
  });

  test("全体のパスは題で読める", () => {
    presets.current = [PRESET];
    const { container } = render(<EngineTab />);

    expect(container.querySelector<HTMLElement>(".presetRow__engine")?.title).toBe(
      "/ai/engines/YaneuraOu",
    );
    expect(container.querySelector<HTMLElement>(".presetRow__eval")?.title).toBe(
      "/ai/hao/eval/nn.bin",
    );
  });

  test("評価関数（と、そのフォルダの AI の名前）が無くても何も言わない。エンジンが無ければ要設定", () => {
    presets.current = [
      { ...PRESET, aiName: "", evalFilePath: "" },
      { ...PRESET, id: "p2" as PresetId, label: "空", enginePath: "" },
    ];
    const { container, getAllByText } = render(<EngineTab />);

    expect(files(container)).toEqual([
      ["YaneuraOu", "指定しない"],
      ["未設定", "hao / nn.bin"],
    ]);
    expect(getAllByText("要設定")).toHaveLength(1);
  });
});
