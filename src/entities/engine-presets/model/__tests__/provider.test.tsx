// @vitest-environment happy-dom
/**
 * `runtimeConfig` の並びを固定する。
 *
 * この値が `desiredRuntime` として engine へ降り、null になった回は engine が畳まれる
 * （`docs/state-transitions/engine.md` の ※7）。走っている解析はそれを「エンジンが
 * 使えなくなった」と読んで打ち切るので、**null を通すかどうかがそのまま振る舞い**になる。
 *
 * **ここが固定しているのは、いま在る窓が在ること**——選択中のプリセットを消すと、
 * 保存の往復のあいだ `runtimeConfig` は null を通る（→ #518）。塞ぐときにこの
 * テストが赤くなるので、そこで期待値ごと書き換えること。
 *
 * @packageDocumentation
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

import { EnginePresetsProvider } from "../provider";
import { useEnginePresets } from "../useEnginePresets";
import type { EnginePreset, PresetsFile } from "../types";
import type { EngineRuntimeConfig } from "@/entities/engine";

const loadPresets = vi.fn<() => Promise<PresetsFile>>();
const savePresets = vi.fn<(file: PresetsFile) => Promise<void>>();
vi.mock("../../api/presets", () => ({
  loadPresets: () => loadPresets(),
  savePresets: (file: PresetsFile) => savePresets(file),
}));

const setLastPresetId = vi.fn<(id: string | null) => Promise<void>>();
let lastPresetId: string | null = null;
vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({
    config: { ai_root: "/ai", last_preset_id: lastPresetId },
    isLoading: false,
    setLastPresetId,
  }),
}));

const preset = (id: string): EnginePreset =>
  ({
    id,
    label: id,
    aiName: id,
    enginePath: `/ai/${id}/engine`,
    evalFilePath: `/ai/${id}/eval/nn.bin`,
    bookEnabled: false,
    bookFilePath: null,
    options: {},
  }) satisfies EnginePreset;

/**
 * commit された `runtimeConfig` を順に集める。**畳まない**——中間の1枚が見たいので、
 * 同じ値が続いてもそのまま押す。
 */
function mountPresets() {
  const seen: (EngineRuntimeConfig | null)[] = [];
  let api: ReturnType<typeof useEnginePresets> | null = null;

  function Probe() {
    const presets = useEnginePresets();
    api = presets;
    useEffect(() => {
      seen.push(presets.runtimeConfig);
    });
    return null;
  }

  const utils = render(
    <EnginePresetsProvider>
      <Probe />
    </EnginePresetsProvider>,
  );

  return {
    seen,
    get current() {
      if (!api) throw new Error("not mounted");
      return api;
    },
    async settle() {
      await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    },
    unmount: () => utils.unmount(),
  };
}

beforeEach(() => {
  loadPresets.mockReset();
  savePresets.mockReset();
  setLastPresetId.mockReset();
  lastPresetId = "a";
  loadPresets.mockResolvedValue({ presets: [preset("a"), preset("b")] } satisfies PresetsFile);
  savePresets.mockResolvedValue(undefined);
  setLastPresetId.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("EnginePresetsProvider", () => {
  it("選択中のプリセットを消すと、保存の往復のあいだ runtimeConfig が null を通る", async () => {
    const view = mountPresets();
    await view.settle();
    expect(view.current.runtimeConfig).not.toBeNull();
    const from = view.seen.length;

    // 保存の invoke を長引かせて窓を開ける。
    let finishSave: () => void = () => {};
    savePresets.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    const deleting = view.current.deletePreset("a");
    await view.settle();

    // 一覧からは消えたのに、選択は消した id を指したまま——**engine はここで畳まれる。**
    expect(view.current.selectedPreset).toBeNull();
    expect(view.current.runtimeConfig).toBeNull();

    // **`act` の外で解決させる。** 中に入れると、その間の commit がまとめて畳まれて
    // 中間の1枚が `seen` に出ない（＝どう壊しても緑になる）。
    finishSave();
    await deleting;
    await view.settle();

    // 窓は閉じる。代わりのプリセットが選ばれ、エンジンは起動し直せる。
    expect(view.current.selectedPreset?.id).toBe("b");
    expect(view.current.runtimeConfig).not.toBeNull();
    expect(setLastPresetId).toHaveBeenCalledWith("b");

    // **通った null が `seen` に残っている。** 塞いだらここが 0 になるので、
    // そのとき doc（`analysis.md` の ※5）も一緒に直すこと。
    expect(view.seen.slice(from).filter((r) => r === null).length).toBeGreaterThan(0);
    view.unmount();
  });

  it("選んでいないプリセットを消しても、窓は開かない", async () => {
    const view = mountPresets();
    await view.settle();
    const from = view.seen.length;

    // **1本目と同じ形で観測する。** `act` の中で解決させると中間の commit が畳まれ、
    // 「窓が開かない」を名乗る検査がどう壊しても緑になる（→ 上の doc）。
    let finishSave: () => void = () => {};
    savePresets.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    const deleting = view.current.deletePreset("b");
    await view.settle();

    // 保存の往復のあいだも、選択は動かないので `runtimeConfig` も動かない。
    expect(view.current.runtimeConfig).not.toBeNull();

    finishSave();
    await deleting;
    await view.settle();

    expect(view.current.selectedPreset?.id).toBe("a");
    expect(view.current.state.presets.map((p) => p.id)).toEqual(["a"]);
    // 選択を動かさない回は `setLastPresetId` も撃たない（保存する値が変わっていない）。
    expect(setLastPresetId).not.toHaveBeenCalled();
    expect(view.seen.slice(from).filter((r) => r === null)).toHaveLength(0);
    view.unmount();
  });
});
