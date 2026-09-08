// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

import { EnginePresetsProvider } from "../provider";
import { useEnginePresets } from "../useEnginePresets";
import type { EnginePreset, PresetsFile } from "../types";
import type { EngineRuntimeConfig } from "@/entities/engine";

/**
 * **見るのは `runtimeConfig` の並びだけ。**
 *
 * この値が `desiredRuntime` として engine へ降り、null になった回は engine が畳まれる
 * （`docs/state-transitions/engine.md` の ※7）。走っている解析はそれを「エンジンが
 * 使えなくなった」と読んで止まるので、**一瞬でも null を通すかどうかが振る舞いそのもの**。
 */
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
  }) as unknown as EnginePreset;

/** commit された `runtimeConfig` を順に集める。**null も1つの値として残す。** */
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
  loadPresets.mockResolvedValue({ presets: [preset("a"), preset("b")] } as PresetsFile);
  savePresets.mockResolvedValue(undefined);
  setLastPresetId.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("EnginePresetsProvider", () => {
  it("選択中のプリセットを消しても、runtimeConfig は null を通らない", async () => {
    const view = mountPresets();
    await view.settle();
    expect(view.current.runtimeConfig).not.toBeNull();

    // 読み込みが済むまでの描画は `runtimeConfig` が null（プリセットがまだ無い）。
    // **見たいのはそこから先**なので、印を取ってから消す。
    const from = view.seen.length;

    // **保存の invoke を長引かせて窓を開ける。** 一覧と選択が別々の commit なら、
    // この間の描画で `runtimeConfig` が null になる。
    let finishSave: () => void = () => {};
    savePresets.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    const deleting = view.current.deletePreset("a");
    await view.settle();

    // **保存が返るまで画面は動かない**（ADR-0004 の決定7）。
    expect(view.current.selectedPreset?.id).toBe("a");

    await act(async () => {
      finishSave();
      await deleting;
    });
    await view.settle();

    // **一度も null を通していない。** 通すとエンジンが畳まれ、走っている解析が止まる。
    expect(view.seen.slice(from).filter((r) => r === null)).toHaveLength(0);
    expect(view.current.selectedPreset?.id).toBe("b");
    expect(setLastPresetId).toHaveBeenCalledWith("b");
    view.unmount();
  });

  it("選んでいないプリセットを消しても、選択は動かない", async () => {
    const view = mountPresets();
    await view.settle();

    await act(async () => {
      await view.current.deletePreset("b");
    });
    await view.settle();

    expect(view.current.selectedPreset?.id).toBe("a");
    expect(view.current.state.presets.map((p) => p.id)).toEqual(["a"]);
    // 選択を動かさない回は `setLastPresetId` も撃たない（保存する値が変わっていない）。
    expect(setLastPresetId).not.toHaveBeenCalled();
    view.unmount();
  });

  it("保存に失敗したら、一覧も選択も動かさない", async () => {
    const view = mountPresets();
    await view.settle();
    savePresets.mockRejectedValueOnce(new Error("disk full"));

    await act(async () => {
      await view.current.deletePreset("a").catch(() => {});
    });
    await view.settle();

    // **成功と見分けが付く形で終える。** 画面を先に動かすと、ディスクは元のままなのに
    // 完全な成功と同じに見え、次に起動したとき消したはずのものが戻ってくる。
    expect(view.current.state.presets.map((p) => p.id)).toEqual(["a", "b"]);
    expect(view.current.selectedPreset?.id).toBe("a");
    expect(setLastPresetId).not.toHaveBeenCalled();
    view.unmount();
  });
});
