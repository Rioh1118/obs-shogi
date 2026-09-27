// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type {
  EnginePreset,
  EnginePresetsContextType,
  LoadedPresets,
} from "@/entities/engine-presets/model/types";

/**
 * プリセットの読み書き（`docs/state-transitions/presets-file.md` の「保存」）。
 *
 * **画面に出ている内容は、ディスクに書けた内容。** 書けなかった変更を画面にだけ残すと、
 * 次に開いたときに黙って消える（ADR-0004 の F-5）。
 */

const loadPresets = vi.fn<() => Promise<LoadedPresets>>();
const savePresets = vi.fn<(presets: EnginePreset[], rev: string | null) => Promise<string>>();

vi.mock(
  "@/entities/engine-presets/api/presets",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/engine-presets/api/presets")>()),
      loadPresets: () => loadPresets(),
      savePresets: (presets: EnginePreset[], rev: string | null) => savePresets(presets, rev),
    }) satisfies typeof import("@/entities/engine-presets/api/presets"),
);
// 読むのは `config` の2欄と `isLoading` と `setLastPresetId` だけ
vi.mock(
  "@/entities/app-config",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/app-config")>()),
      useAppConfig: () =>
        ({
          config: { last_preset_id: "a", ai_root: "/ai" },
          isLoading: false,
          setLastPresetId: async () => {},
        }) as unknown as ReturnType<typeof import("@/entities/app-config").useAppConfig>,
    }) satisfies typeof import("@/entities/app-config"),
);

const { EnginePresetsProvider } = await import("../provider");
const { useEnginePresets } = await import("../useEnginePresets");

const PRESET: EnginePreset = {
  id: "a",
  label: "水匠",
  aiName: "suisho",
  enginePath: "/ai/engines/yaneuraou",
  evalFilePath: "/ai/suisho/eval/nn.bin",
  bookEnabled: false,
  bookFilePath: null,
  options: {},
};

function loaded(overrides: Partial<LoadedPresets> = {}): LoadedPresets {
  return {
    presets: [PRESET],
    revision: "r1",
    writable: true,
    unreadableCount: 0,
    loadNotice: null,
    ...overrides,
  };
}

async function mount() {
  let ctx!: EnginePresetsContextType;
  function Probe() {
    ctx = useEnginePresets();
    return null;
  }
  await act(async () => {
    render(
      <EnginePresetsProvider>
        <Probe />
      </EnginePresetsProvider>,
    );
  });
  return () => ctx;
}

beforeEach(() => {
  loadPresets.mockReset();
  savePresets.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("プリセットの保存は、書けてから画面に反映する", () => {
  test("保存が断られたら、画面は変えずに理由を残す", async () => {
    loadPresets.mockResolvedValue(loaded());
    savePresets.mockRejectedValue({ kind: "conflict", message: "changed" });
    const ctx = await mount();

    let result: boolean | undefined;
    await act(async () => {
      result = await ctx().updatePreset("a", { label: "書けなかった名前" });
    });

    expect(result).toBe(false);
    expect(ctx().state.presets[0].label).toBe("水匠");
    expect(ctx().state.saveFailure?.kind).toBe("conflict");
  });

  test("作成・削除も書けなければ画面に出さない", async () => {
    loadPresets.mockResolvedValue(loaded());
    savePresets.mockRejectedValue({ kind: "io", message: "disk full" });
    const ctx = await mount();

    await act(async () => {
      expect(await ctx().createPreset({ label: "新規" })).toBeNull();
      expect(await ctx().deletePreset("a")).toBe(false);
    });

    expect(ctx().state.presets.map((p) => p.id)).toEqual(["a"]);
  });

  /** 読んだ印で書き、書いた印で次を書く（別の書き手の変更を Rust が見分ける） */
  test("読んだ印を保存に渡し、書けたら印を差し替える", async () => {
    loadPresets.mockResolvedValue(loaded({ revision: "r1" }));
    savePresets.mockResolvedValueOnce("r2").mockResolvedValueOnce("r3");
    const ctx = await mount();

    await act(async () => {
      await ctx().updatePreset("a", { label: "1回目" });
      await ctx().updatePreset("a", { label: "2回目" });
    });

    expect(savePresets.mock.calls.map((call) => call[1])).toEqual(["r1", "r2"]);
    expect(ctx().state.presets[0].label).toBe("2回目");
    expect(ctx().state.saveFailure).toBeNull();
  });

  /**
   * **次の一覧は最後に書けた一覧から組む。** 描画を挟まずに別の欄を続けて変えると、
   * 2回目が1回目を知らない一覧から組まれ、1回目の変更が黙って消える
   */
  test("描画を挟まずに続けた変更は、どちらも残る", async () => {
    loadPresets.mockResolvedValue(loaded({ revision: "r1" }));
    savePresets.mockResolvedValueOnce("r2").mockResolvedValueOnce("r3");
    const ctx = await mount();
    const { updatePreset } = ctx();

    await act(async () => {
      await updatePreset("a", { label: "新しい名前" });
      await updatePreset("a", { aiName: "naoetsu" });
    });

    const written = savePresets.mock.calls[1][0][0];
    expect(written.label).toBe("新しい名前");
    expect(written.aiName).toBe("naoetsu");
    expect(ctx().state.presets[0]).toMatchObject({ label: "新しい名前", aiName: "naoetsu" });
  });

  /**
   * **同時に2本書かない。** 2本目が1本目の前の印を持って書くと、自分の変更どうしが
   * `conflict` になる（「別の場所で変更されました」と誤って伝える）
   */
  test("同時に撃った変更は1本ずつ通り、どちらも書ける", async () => {
    let disk = "r1";
    let n = 1;
    loadPresets.mockResolvedValue(loaded({ revision: "r1" }));
    savePresets.mockImplementation(async (_presets, rev) => {
      if (rev !== disk) throw { kind: "conflict", message: "changed" };
      disk = `r${++n}`;
      return disk;
    });
    const ctx = await mount();
    const { createPreset } = ctx();

    let made: unknown[] = [];
    await act(async () => {
      made = await Promise.all([createPreset({ label: "1" }), createPreset({ label: "2" })]);
    });

    expect(made.every((p) => p !== null)).toBe(true);
    expect(ctx().state.presets.map((p) => p.label)).toEqual(["水匠", "1", "2"]);
    expect(ctx().state.saveFailure).toBeNull();
  });
});

describe("書けないファイルには書かない", () => {
  /**
   * 新しい版・読めない・移せなかったファイル。**既定の1件も作らない**——作ると、
   * 読めていない中身の上に書く
   */
  test("書けない状態で開いたら、0件でも既定の1件を書かず、変更も断る", async () => {
    loadPresets.mockResolvedValue(
      loaded({
        presets: [],
        revision: null,
        writable: false,
        loadNotice: { kind: "unreadable", reason: "EACCES" },
      }),
    );
    const ctx = await mount();

    expect(savePresets).not.toHaveBeenCalled();
    expect(ctx().state.writable).toBe(false);
    expect(ctx().state.loadNotice?.kind).toBe("unreadable");

    await act(async () => {
      expect(await ctx().createPreset()).toBeNull();
    });
    expect(savePresets).not.toHaveBeenCalled();
    expect(ctx().state.saveFailure?.kind).toBe("readOnly");
  });

  /** 既定の1件を書けなかった理由は、取り込みと一緒に残る（取り込みが消すと、0件の理由がどこにも出ない） */
  test("0件で開いて既定の1件を書けなかったら、その理由が残る", async () => {
    loadPresets.mockResolvedValue(loaded({ presets: [], revision: null }));
    savePresets.mockRejectedValue({ kind: "io", message: "EACCES" });
    const ctx = await mount();

    expect(ctx().state.presets).toHaveLength(0);
    expect(ctx().state.saveFailure?.kind).toBe("io");
  });

  test("書ける状態で0件なら、既定の1件を書いてから出す", async () => {
    loadPresets.mockResolvedValue(loaded({ presets: [], revision: null }));
    savePresets.mockResolvedValue("r1");
    const ctx = await mount();

    expect(savePresets).toHaveBeenCalledTimes(1);
    expect(savePresets.mock.calls[0][1]).toBeNull();
    expect(ctx().state.presets).toHaveLength(1);
  });
});
