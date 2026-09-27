// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AiRootIndex } from "@/entities/engine/api/aiLibrary";
import type { ProbeOutcome } from "@/entities/engine";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";

/**
 * エンジンを選んだときに申告を取り、下書きへ定義を入れること。**最後に撃った取得の結果だけを使う**
 * ——前のエンジンの取得が後から返っても、選び直したエンジンの定義を上書きしない
 */

const AI_ROOT = "/Users/me/ai";
const ENGINE_A = `${AI_ROOT}/engines/a`;
const ENGINE_B = `${AI_ROOT}/engines/b`;

const PRESET: EnginePreset = {
  id: "p1" as PresetId,
  label: "テスト",
  aiName: "Suisho",
  enginePath: "",
  evalFilePath: "",
  bookEnabled: false,
  bookFilePath: null,
  options: {},
};

const INDEX: AiRootIndex = {
  ai_root: AI_ROOT,
  engines_dir: { path: `${AI_ROOT}/engines`, exists: true, kind: "dir" },
  engines: [
    { entry: "a", path: ENGINE_A, kind: "file", launchability: "ready" },
    { entry: "b", path: ENGINE_B, kind: "file", launchability: "ready" },
  ],
  profiles: [],
};

type Pending = {
  args: { enginePath: string; token: number };
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};
const probes: Pending[] = [];
/** ストアが持つプリセット。差し替えると、読み直しで同じ id の別オブジェクトが来た形になる */
const presets = { current: PRESET };
const updatePreset = vi.fn<(id: PresetId, patch: Partial<EnginePreset>) => Promise<boolean>>();

// Tauri の口だけを差し替え、番号の数え方（`probeEngine` / `isLatestProbe`）は本物を通す
vi.mock(
  "@tauri-apps/api/core",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@tauri-apps/api/core")>()),
      invoke: (<T,>(cmd: string, args?: unknown) => {
        if (cmd !== "probe_engine") throw new Error(`unexpected ${cmd}`);
        return new Promise<T>((resolve, reject) =>
          probes.push({
            args: args as Pending["args"],
            resolve: resolve as Pending["resolve"],
            reject,
          }),
        );
      }) as typeof import("@tauri-apps/api/core").invoke,
    }) satisfies typeof import("@tauri-apps/api/core"),
);

vi.mock(
  "@/entities/app-config",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/app-config")>()),
      useAppConfig: () =>
        ({ config: { ai_root: AI_ROOT }, chooseAiRoot: vi.fn() }) as unknown as ReturnType<
          typeof import("@/entities/app-config").useAppConfig
        >,
    }) satisfies typeof import("@/entities/app-config"),
);

vi.mock(
  "@/entities/engine-presets/model/useEnginePresets",
  () =>
    ({
      useEnginePresets: () =>
        ({ state: { presets: [presets.current] }, updatePreset }) as unknown as ReturnType<
          typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets
        >,
    }) satisfies typeof import("@/entities/engine-presets/model/useEnginePresets"),
);

vi.mock(
  "@/entities/engine/api/aiLibrary",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/engine/api/aiLibrary")>()),
      scanAiRoot: () => Promise.resolve(INDEX),
      ensureEnginesDir: () => Promise.resolve(""),
    }) satisfies typeof import("@/entities/engine/api/aiLibrary"),
);

const { default: EnginePresetEditDialogPanel } = await import("../EnginePresetEditDialogPanel");

function outcome(p: Pending, name: string): ProbeOutcome {
  return {
    token: p.args.token,
    enginePath: p.args.enginePath,
    name,
    author: "someone",
    definitions: [{ name: "Threads", type: "spin", default: 4, min: 1, max: 512 }],
    reserved: [],
  };
}

function engineSelect(): HTMLSelectElement {
  const select = [...document.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === ENGINE_A),
  );
  if (!select) throw new Error("エンジンの欄が無い");
  return select;
}

async function openWithEnginesView() {
  const view = render(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);
  await waitFor(() => engineSelect(), { timeout: 5000 });
  return view;
}

async function openWithEngines() {
  await openWithEnginesView();
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
}

beforeEach(() => {
  probes.length = 0;
  presets.current = PRESET;
  updatePreset.mockReset().mockResolvedValue(true);
});

afterEach(cleanup);

describe("プリセット編集でのオプションの取得", () => {
  test("エンジンを選ぶと申告を取り、保存に定義が載る。取得中は保存できない", async () => {
    await openWithEngines();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });

    expect(probes.map((p) => p.args.enginePath)).toEqual([ENGINE_A]);
    await waitFor(() => expect(saveButton().disabled).toBe(true));

    probes[0].resolve(outcome(probes[0], "Engine A"));
    await screen.findByText(/オプション 1 件を取得済み（Engine A）/);
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(updatePreset).toHaveBeenCalled());
    const patch = updatePreset.mock.calls[0][1];
    expect(patch.definitionsFor).toBe(ENGINE_A);
    expect(patch.engineName).toBe("Engine A");
    expect(patch.definitions).toHaveLength(1);
  }, 20000);

  test("選び直した後に前の取得が返っても、選び直したエンジンの定義を使う", async () => {
    await openWithEngines();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    fireEvent.change(engineSelect(), { target: { value: ENGINE_B } });
    const [first, second] = probes;

    second.resolve(outcome(second, "Engine B"));
    await screen.findByText(/（Engine B）/);
    first.resolve(outcome(first, "Engine A"));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/（Engine A）/)).toBeNull();
    expect(screen.getByText(/（Engine B）/)).toBeTruthy();
  }, 20000);

  /**
   * 同じエンジンに戻ったとき、パスでは古い取得と新しい取得を見分けられない。古い結果で
   * 「取得済み」にすると、新しい取得が返る前に保存でき、返ってきた定義が保存物に載らない
   */
  test("同じエンジンに戻ったら、古い取得の結果では取得を終えない", async () => {
    await openWithEngines();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    fireEvent.change(engineSelect(), { target: { value: ENGINE_B } });
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    const [first, , third] = probes;

    first.resolve(outcome(first, "Engine A (old)"));
    await new Promise((r) => setTimeout(r, 0));
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText(/（Engine A \(old\)）/)).toBeNull();

    third.resolve(outcome(third, "Engine A"));
    await screen.findByText(/（Engine A）/);
    expect(saveButton().disabled).toBe(false);
  }, 20000);

  test("取得に失敗したら理由と次にすることを出す。前のエンジンの失敗は出さない", async () => {
    await openWithEngines();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    probes[0].reject({ kind: "notUsi", message: "no usiok" });

    const failure = await screen.findByRole("alert");
    expect(failure.textContent).toContain("USI エンジンとして応答しませんでした");
    expect(failure.textContent).toContain("詳細: no usiok");
    expect(saveButton().disabled).toBe(false);

    fireEvent.change(engineSelect(), { target: { value: ENGINE_B } });
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    probes[1].reject({ kind: "spawnFailed", message: "" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("alert")).toBeNull();
  }, 20000);

  /** 返らない取得（応答しないドライブ）で保存が塞がったままにならない */
  test("読み込みをやめると保存でき、後から返った結果は使わない", async () => {
    await openWithEngines();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    await waitFor(() => expect(saveButton().disabled).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "読み込みをやめる" }));
    expect(saveButton().disabled).toBe(false);

    probes[0].resolve(outcome(probes[0], "Engine A"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/取得済み/)).toBeNull();
  }, 20000);

  /** 手動のパス欄は取得を撃たない。待っていた取得の結果を、打ち換えたパスに付けない */
  test("取得を待つ間に手でパスを打ち換えたら、前のエンジンの定義を付けない", async () => {
    await openWithEngines();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    fireEvent.change(screen.getByPlaceholderText("/path/to/engine"), {
      target: { value: "/elsewhere/engine" },
    });

    probes[0].resolve(outcome(probes[0], "Engine A"));
    await screen.findByText("オプションは未取得です", { exact: false });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updatePreset).toHaveBeenCalled());
    expect(updatePreset.mock.calls[0][1].definitionsFor).toBeNull();
  }, 20000);

  /** 読み直しで同じプリセットの別オブジェクトが来ても、取得中なら保存を開けない */
  test("取得中にプリセットが読み直されても、保存は塞がったまま", async () => {
    const view = await openWithEnginesView();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    await waitFor(() => expect(saveButton().disabled).toBe(true));

    presets.current = { ...PRESET };
    view.rerender(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));

    expect(saveButton().disabled).toBe(true);
  }, 20000);
});
