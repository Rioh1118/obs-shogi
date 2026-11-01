// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { AiRootIndex, EngineCandidate } from "@/entities/engine/api/aiLibrary";
import type { ProbeOutcome } from "@/entities/engine";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";

/**
 * プリセット編集の画面が何を出し、保存で何を書くか。下書きと読み込みの判定は `presetDialogProbe.test.tsx`、
 * 走査と帯の競合は `EnginePresetEditDialogPanel.test.tsx` が見る。
 */

const AI_ROOT = "/Users/me/ai";
const ENGINE_A = `${AI_ROOT}/engines/a`;
const ENGINE_B = `${AI_ROOT}/engines/b`;
const EVAL_HAO = `${AI_ROOT}/hao/eval/nn.bin`;

const PRESET: EnginePreset = {
  id: "p1" as PresetId,
  label: "テスト",
  aiName: "",
  enginePath: "",
  evalFilePath: "",
  bookEnabled: false,
  bookFilePath: null,
  options: {},
};

const candidate = (entry: string, path: string): EngineCandidate => ({
  entry,
  path,
  kind: "file",
  launchability: "ready",
});

const INDEX: AiRootIndex = {
  ai_root: AI_ROOT,
  engines_dir: { path: `${AI_ROOT}/engines`, exists: true, kind: "dir" },
  engines: [candidate("a", ENGINE_A), candidate("b", ENGINE_B)],
  profiles: [
    {
      name: "hao",
      path: `${AI_ROOT}/hao`,
      has_eval_dir: true,
      has_book_dir: false,
      eval_files: [{ entry: "nn.bin", path: EVAL_HAO, kind: "file" }],
      book_db_files: [],
    },
  ],
};

const DEFS: ProbeOutcome["definitions"] = [
  { name: "Threads", type: "spin", default: 4, min: 1, max: 512, label: "スレッド数" },
  { name: "MultiPV", type: "spin", default: 1, min: 1, max: 500 },
  { name: "Slow", type: "spin", default: 0, min: null, max: null },
  { name: "Ponder", type: "check", default: false },
  { name: "Style", type: "combo", default: "a", vars: ["a", "b"] },
  { name: "Note", type: "string", default: "" },
  { name: "Model", type: "filename", default: "nn.bin" },
];

type Pending = {
  args: { enginePath: string; token: number };
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

const probes: Pending[] = [];
const presets = { current: [PRESET] };
const aiRoot = { current: AI_ROOT as string | null };
const updatePreset = vi.fn<(id: PresetId, patch: Partial<EnginePreset>) => Promise<boolean>>();
const scanAiRoot = vi.fn<(root: string) => Promise<AiRootIndex>>();
const ensureEnginesDir = vi.fn<(root: string) => Promise<string>>();
const dialogOpen = vi.fn<() => Promise<string | null>>();

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
  "@tauri-apps/plugin-dialog",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@tauri-apps/plugin-dialog")>()),
      open: (() => dialogOpen()) as unknown as typeof import("@tauri-apps/plugin-dialog").open,
    }) satisfies typeof import("@tauri-apps/plugin-dialog"),
);

vi.mock(
  "@/entities/app-config",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/app-config")>()),
      useAppConfig: () =>
        ({ config: { ai_root: aiRoot.current } }) as unknown as ReturnType<
          typeof import("@/entities/app-config").useAppConfig
        >,
    }) satisfies typeof import("@/entities/app-config"),
);

vi.mock(
  "@/entities/engine-presets/model/useEnginePresets",
  () =>
    ({
      useEnginePresets: () =>
        ({
          state: { presets: presets.current },
          updatePreset,
        }) as unknown as ReturnType<
          typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets
        >,
    }) satisfies typeof import("@/entities/engine-presets/model/useEnginePresets"),
);

vi.mock(
  "@/entities/engine/api/aiLibrary",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/engine/api/aiLibrary")>()),
      scanAiRoot: (root: string) => scanAiRoot(root),
      ensureEnginesDir: (root: string) => ensureEnginesDir(root),
    }) satisfies typeof import("@/entities/engine/api/aiLibrary"),
);

const { default: EnginePresetEditDialogPanel } = await import("../EnginePresetEditDialogPanel");

const onClose = vi.fn();

const dialog = () => <EnginePresetEditDialogPanel presetId={PRESET.id} onClose={onClose} />;

const engineSelect = () =>
  screen.getByLabelText("エンジン", { selector: "select" }) as HTMLSelectElement;
const evalSelect = () =>
  screen.getByLabelText("評価関数", { selector: "select" }) as HTMLSelectElement;
const bookSelect = () => screen.getByLabelText("定跡", { selector: "select" }) as HTMLSelectElement;
const nameInput = () => screen.getByLabelText("プリセットの名前") as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const optionTexts = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);

function outcome(p: Pending, defs = DEFS): ProbeOutcome {
  return {
    token: p.args.token,
    enginePath: p.args.enginePath,
    name: "Engine A",
    author: "someone",
    definitions: defs,
    reserved: [],
  };
}

async function openDialog(preset: Partial<EnginePreset> = {}) {
  presets.current = [{ ...PRESET, ...preset }];
  const view = render(dialog());
  await tick();
  return view;
}

/** エンジンを読み込み終えた画面を開く */
async function openLoaded(preset: Partial<EnginePreset> = {}, defs = DEFS) {
  const view = await openDialog({ enginePath: ENGINE_A, ...preset });
  await act(async () => probes[0].resolve(outcome(probes[0], defs)));
  return view;
}

async function saved(): Promise<Partial<EnginePreset>> {
  fireEvent.click(saveButton());
  await waitFor(() => expect(updatePreset).toHaveBeenCalled());
  return updatePreset.mock.calls[0][1];
}

beforeEach(() => {
  probes.length = 0;
  presets.current = [PRESET];
  aiRoot.current = AI_ROOT;
  updatePreset.mockReset().mockResolvedValue(true);
  scanAiRoot.mockReset().mockResolvedValue(INDEX);
  ensureEnginesDir.mockReset().mockResolvedValue("");
  dialogOpen.mockReset();
  onClose.mockReset();
});

afterEach(cleanup);

describe("開く", () => {
  test("題は名前の前後を落として出し、空なら「プリセット編集」", async () => {
    await openDialog({ label: "  研究用  " });
    expect(document.querySelector(".presetDialog__title")?.textContent).toBe("研究用");

    fireEvent.change(nameInput(), { target: { value: "   " } });
    expect(document.querySelector(".presetDialog__title")?.textContent).toBe("プリセット編集");
  });

  test("編集中のプリセットが消えたら閉じ、何も出さない", async () => {
    const view = await openDialog();
    presets.current = [];
    view.rerender(dialog());
    await tick();

    expect(onClose).toHaveBeenCalled();
    expect(document.querySelector(".presetDialog")).toBeNull();
  });

  test("キャンセルで閉じ、保存しない", async () => {
    await openDialog();
    fireEvent.click(button("キャンセル"));
    expect(onClose).toHaveBeenCalled();
    expect(updatePreset).not.toHaveBeenCalled();
  });
});

describe("AI ライブラリの走査", () => {
  test("AI ライブラリが未設定なら案内を出し、走査しない。欄は塞ぎ、探し直すボタンも出さない", async () => {
    aiRoot.current = null;
    await openDialog();

    expect(screen.getByText(/AI ライブラリが決まっていません/).textContent).toBe(
      "AI ライブラリが決まっていません。設定の「AI ライブラリ」で選ぶと、ここにエンジンと評価関数が並びます。",
    );
    expect(scanAiRoot).not.toHaveBeenCalled();
    expect(engineSelect().options[0].textContent).toBe("AI ライブラリが未設定");
    expect(engineSelect().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "AI ライブラリをもう一度読み込む" })).toBeNull();
  });

  test("走査の間は読み込み中と言い、欄を塞ぐ", async () => {
    scanAiRoot.mockReturnValue(new Promise(() => {}));
    await openDialog();

    expect(engineSelect().options[0].textContent).toBe("読み込んでいます…");
    expect(engineSelect().disabled).toBe(true);
  });

  test("候補が届いたら選べる。案内の行は「エンジンを選択」", async () => {
    await openDialog();

    expect(optionTexts(engineSelect())).toEqual(["エンジンを選択", "a", "b"]);
    expect(engineSelect().disabled).toBe(false);
  });

  test("エンジンが1つも無ければ、そう言って欄を塞ぐ", async () => {
    scanAiRoot.mockResolvedValue({ ...INDEX, engines: [] });
    await openDialog();

    expect(engineSelect().options[0].textContent).toBe("engines/ にエンジンがありません");
    expect(engineSelect().disabled).toBe(true);
  });

  test("走査に失敗したら理由を節の上に出す。探し直して読めたら消える", async () => {
    scanAiRoot.mockRejectedValueOnce("EIO");
    await openDialog();

    expect(
      screen.getByText(
        "AI ライブラリを読めませんでした。フォルダがあるか（外付けなら繋がっているか）を確認して「もう一度読み込む」を押してください（EIO）",
      ),
    ).toBeTruthy();
    expect(engineSelect().options[0].textContent).toBe("エンジンを読み込めませんでした");
    expect(engineSelect().disabled).toBe(true);

    fireEvent.click(button("AI ライブラリをもう一度読み込む"));
    await tick();

    expect(screen.queryByText(/AI ライブラリを読めませんでした/)).toBeNull();
    expect(engineSelect().disabled).toBe(false);
  });

  test("engines がフォルダでなければ、帯で言い、作成は出さない", async () => {
    scanAiRoot.mockResolvedValue({
      ...INDEX,
      engines_dir: { path: `${AI_ROOT}/engines`, exists: true, kind: "file" },
    });
    await openDialog();

    expect(
      screen.getByText(
        new RegExp(
          `engines がフォルダではありません（${AI_ROOT}/engines）。同じ名前のものを削除してください。`,
        ),
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "フォルダを作成" })).toBeNull();
  });

  test("「フォルダを作成」は engines/ を作り、探し直す", async () => {
    scanAiRoot.mockResolvedValue({
      ...INDEX,
      engines_dir: { path: `${AI_ROOT}/engines`, exists: false, kind: "unknown" },
    });
    await openDialog();

    scanAiRoot.mockResolvedValue(INDEX);
    fireEvent.click(button("フォルダを作成"));
    await tick();

    expect(ensureEnginesDir).toHaveBeenCalledWith(AI_ROOT);
    expect(scanAiRoot).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "フォルダを作成" })).toBeNull();
  });

  test("作成に失敗したら理由を節の上に出し、帯は残す", async () => {
    scanAiRoot.mockResolvedValue({
      ...INDEX,
      engines_dir: { path: `${AI_ROOT}/engines`, exists: false, kind: "unknown" },
    });
    ensureEnginesDir.mockRejectedValue("EACCES");
    await openDialog();

    fireEvent.click(button("フォルダを作成"));
    await tick();

    expect(screen.getByText("engines/ の作成に失敗しました: EACCES")).toBeTruthy();
    expect(button("フォルダを作成").disabled).toBe(false);
    expect(engineSelect().options[0].textContent).toBe("エンジンを読み込めませんでした");
  });

  test("作成の途中でルートが変わったら、作り終えても前のルートを探し直さない", async () => {
    scanAiRoot.mockResolvedValue({
      ...INDEX,
      engines_dir: { path: `${AI_ROOT}/engines`, exists: false, kind: "unknown" },
    });
    let finish!: (path: string) => void;
    ensureEnginesDir.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const view = await openDialog();
    fireEvent.click(button("フォルダを作成"));

    aiRoot.current = "/Users/me/ai2";
    view.rerender(dialog());
    await tick();
    await act(async () => finish(""));

    expect(scanAiRoot.mock.calls.map(([root]) => root)).toEqual([AI_ROOT, "/Users/me/ai2"]);
  });

  test("ルートを変えた後に前の走査が返っても、前の結果を使わない", async () => {
    let finishOld!: (index: AiRootIndex) => void;
    scanAiRoot.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)));
    scanAiRoot.mockReturnValueOnce(new Promise(() => {}));
    const view = await openDialog();

    aiRoot.current = "/Users/me/ai2";
    view.rerender(dialog());
    await tick();
    await act(async () => finishOld(INDEX));

    expect(engineSelect().options[0].textContent).toBe("読み込んでいます…");
  });

  test("ルートを変えた後に前の走査が失敗しても、理由を出さない", async () => {
    let failOld!: (reason: string) => void;
    scanAiRoot.mockReturnValueOnce(new Promise((_, reject) => (failOld = reject)));
    scanAiRoot.mockReturnValueOnce(new Promise(() => {}));
    const view = await openDialog();

    aiRoot.current = "/Users/me/ai2";
    view.rerender(dialog());
    await tick();
    await act(async () => failOld("EIO"));

    expect(screen.queryByText(/AI ライブラリを読めませんでした/)).toBeNull();
  });

  test("ルートが外れたら、候補と失敗を消す", async () => {
    scanAiRoot.mockRejectedValueOnce("EIO");
    const view = await openDialog();

    aiRoot.current = null;
    view.rerender(dialog());
    await tick();

    expect(screen.queryByText(/AI ライブラリを読めませんでした/)).toBeNull();
    expect(engineSelect().options[0].textContent).toBe("AI ライブラリが未設定");
  });

  test("探し直しの間も、読めていた候補を残す", async () => {
    await openDialog();
    scanAiRoot.mockReturnValue(new Promise(() => {}));
    fireEvent.click(button("AI ライブラリをもう一度読み込む"));
    await tick();

    expect(optionTexts(evalSelect())).toContain("hao / nn.bin");
    expect(engineSelect().options[0].textContent).toBe("読み込んでいます…");
  });
});

describe("エンジンの欄", () => {
  test("候補に無い保存済みのパスは「（現在の選択）」として残す", async () => {
    await openDialog({ enginePath: "/elsewhere/old-build" });

    expect(optionTexts(engineSelect())).toEqual([
      "エンジンを選択",
      "old-build（現在の選択）",
      "a",
      "b",
    ]);
    expect(engineSelect().value).toBe("/elsewhere/old-build");
  });

  test.each([
    ["C:\\engines\\yaneura.exe", "yaneura.exe（現在の選択）"],
    ["/elsewhere/build/", "build（現在の選択）"],
    ["old-build", "old-build（現在の選択）"],
  ])("候補に無いパス %s は末尾の名前で出す", async (path, label) => {
    await openDialog({ enginePath: path });
    expect(optionTexts(engineSelect())).toContain(label);
  });

  test("候補にある保存済みのパスは重ねない", async () => {
    await openDialog({ enginePath: ENGINE_A });
    expect(optionTexts(engineSelect())).toEqual(["エンジンを選択", "a", "b"]);
  });

  test("起動できない見込みは理由を添え、選べないものは塞ぐ", async () => {
    scanAiRoot.mockResolvedValue({
      ...INDEX,
      engines: [
        { ...candidate("a", ENGINE_A), launchability: "notExecutable" },
        { ...candidate("b", ENGINE_B), launchability: "unreadable" },
      ],
    });
    await openDialog();

    expect(optionTexts(engineSelect())).toContain("a（実行権限がありません）");
    expect(optionTexts(engineSelect())).toContain("b（読めません）");
    expect(engineSelect().options[1].disabled).toBe(false);
    expect(engineSelect().options[2].disabled).toBe(true);
  });

  test("読み込めたら名乗りで出し、起動できない見込みの理由は名乗りの後ろに添える", async () => {
    scanAiRoot.mockResolvedValue({
      ...INDEX,
      engines: [{ ...candidate("a", ENGINE_A), launchability: "notExecutable" }],
    });
    await openLoaded();

    expect(engineSelect().selectedOptions[0].textContent).toBe("Engine A（実行権限がありません）");
  });

  test("選んだエンジンのパスを欄の下に出す。選ぶまでは出さない", async () => {
    await openDialog();
    expect(document.querySelector(".presetDialog__enginePath")).toBeNull();

    fireEvent.change(engineSelect(), { target: { value: ENGINE_B } });
    expect(document.querySelector(".presetDialog__enginePath")?.textContent).toBe(ENGINE_B);
  });

  test("読み込めていないエンジンは、止まったままと言う", async () => {
    await openDialog({ enginePath: ENGINE_A });
    fireEvent.click(button("中止"));

    const status = screen.getByText(/エンジンをまだ読み込んでいません/);
    expect(status.getAttribute("role")).toBeNull();
    expect(within(status).getByRole("button", { name: "もう一度読み込む" })).toBeTruthy();
  });
});

describe("開いたときの読み込みと補完", () => {
  test("候補がちょうど1つの新しいプリセットは、エンジンを埋めて1回だけ読み込む", async () => {
    scanAiRoot.mockResolvedValue({ ...INDEX, engines: [candidate("a", ENGINE_A)] });
    await openDialog();

    expect(engineSelect().value).toBe(ENGINE_A);
    expect(evalSelect().value).toBe(EVAL_HAO);
    expect(probes.map((p) => p.args.enginePath)).toEqual([ENGINE_A]);
  });

  test("利用者が選んで読み込んだ後は、開いたときの読み込みを足さない", async () => {
    await openDialog();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    await act(async () => probes[0].resolve(outcome(probes[0])));
    await tick();

    expect(probes).toHaveLength(1);
  });

  test("探し直しても読み込み直さず、補完もやり直さない", async () => {
    await openDialog({ enginePath: ENGINE_A });
    await act(async () => probes[0].resolve(outcome(probes[0])));
    fireEvent.change(evalSelect(), { target: { value: "" } });

    fireEvent.click(button("AI ライブラリをもう一度読み込む"));
    await tick();

    expect(probes).toHaveLength(1);
    expect(evalSelect().value).toBe("");
  });

  test("読み込めなければ console に残す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await openDialog({ enginePath: ENGINE_A });
    await act(async () => probes[0].reject({ kind: "notUsi", message: "no usiok" }));

    expect(warn).toHaveBeenCalledWith("[EnginePresetEditDialog] probe failed:", "no usiok");
    warn.mockRestore();
  });

  test("探す前に開いた新しいプリセットは、候補が届いた回に補完する", async () => {
    scanAiRoot.mockRejectedValueOnce("EIO");
    await openDialog();
    expect(evalSelect().value).toBe("");

    fireEvent.click(button("AI ライブラリをもう一度読み込む"));
    await tick();

    expect(evalSelect().value).toBe(EVAL_HAO);
  });
});

describe("検証", () => {
  test("名前とエンジンが空なら保存せず、欄ごとに言う。直すとその欄の赤字が消える", async () => {
    await openDialog({ label: "   " });
    fireEvent.click(saveButton());
    await tick();

    expect(updatePreset).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("名前を入力してください")).toBeTruthy();
    expect(screen.getByText("エンジンを選択してください")).toBeTruthy();
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(engineSelect().getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(nameInput(), { target: { value: "x" } });
    expect(screen.queryByText("名前を入力してください")).toBeNull();
    expect(screen.getByText("エンジンを選択してください")).toBeTruthy();

    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    expect(screen.queryByText("エンジンを選択してください")).toBeNull();
  });

  test("プリセットが読み直されたら、赤字も消える", async () => {
    const view = await openDialog();
    fireEvent.click(saveButton());
    await screen.findByText("エンジンを選択してください");

    presets.current = [{ ...PRESET }];
    view.rerender(dialog());
    await tick();

    expect(screen.queryByText("エンジンを選択してください")).toBeNull();
  });

  test("赤字のあと、エンジンだけが空のまま保存し直しても、エンジンの赤字が残る", async () => {
    await openDialog({ label: "" });
    fireEvent.click(saveButton());
    fireEvent.change(nameInput(), { target: { value: "x" } });
    fireEvent.click(saveButton());
    await tick();

    expect(screen.queryByText("名前を入力してください")).toBeNull();
    expect(screen.getByText("エンジンを選択してください")).toBeTruthy();
  });
});

describe("保存", () => {
  test("書けたら閉じる", async () => {
    await openLoaded();
    await saved();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test("書けなかったら閉じず、入力を残す", async () => {
    updatePreset.mockResolvedValue(false);
    await openLoaded();
    fireEvent.change(nameInput(), { target: { value: "直した名前" } });
    await saved();
    await tick();

    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("直した名前");
  });

  test("文字の欄は前後を落として書き、呼び手のプリセットを渡す", async () => {
    await openLoaded({
      label: "  研究用 ",
      aiName: " hao ",
      evalFilePath: ` ${EVAL_HAO} `,
    });

    const patch = await saved();
    expect(updatePreset.mock.calls[0][0]).toBe(PRESET.id);
    expect(patch).toMatchObject({
      label: "研究用",
      aiName: "hao",
      enginePath: ENGINE_A,
      evalFilePath: EVAL_HAO,
    });
  });

  test("読み込みの結果と名乗りを一緒に書く", async () => {
    await openLoaded();

    const patch = await saved();
    expect(patch).toMatchObject({
      reservedNames: [],
      definitionsFor: ENGINE_A,
      engineName: "Engine A",
      engineAuthor: "someone",
    });
    expect(typeof patch.probedAt).toBe("string");
  });

  test("読み込んでいなければ、定義の欄は null で書く", async () => {
    await openDialog({ enginePath: ENGINE_A });
    fireEvent.click(button("中止"));

    expect(await saved()).toMatchObject({
      definitions: null,
      reservedNames: null,
      definitionsFor: null,
      probedAt: null,
      engineName: null,
      engineAuthor: null,
    });
  });

  test("使う定跡はパスの前後を落として書く", async () => {
    await openLoaded({ bookEnabled: true, bookFilePath: " /ai/hao/book/a.db " });

    expect(await saved()).toMatchObject({ bookEnabled: true, bookFilePath: "/ai/hao/book/a.db" });
  });

  test("オプションの空は書かず、値は前後を落とす", async () => {
    await openLoaded({ options: { Threads: " 8 ", Style: "  ", Note: "" } });

    expect((await saved()).options).toEqual({ Threads: "8" });
  });

  test("止める条件は上限へ丸める", async () => {
    await openLoaded({
      analysis: { timeSeconds: 9999, depth: 5000, nodes: 2_000_000_000, mateSearch: true },
    });

    expect((await saved()).analysis).toEqual({
      timeSeconds: 3600,
      depth: 999,
      nodes: 999_999_999,
      mateSearch: true,
    });
  });

  test("止める条件の 0 以下は落とし、残りを書く", async () => {
    await openLoaded({
      analysis: { timeSeconds: 0, depth: -3, nodes: 500, mateSearch: false },
    });

    expect((await saved()).analysis).toEqual({ nodes: 500, mateSearch: false });
  });

  test.each([
    ["時間", { timeSeconds: 10 }],
    ["深さ", { depth: 10 }],
    ["ノード数", { nodes: 10 }],
    ["詰み探索", { mateSearch: true }],
  ])("%s だけでも analysis を持つ", async (_, analysis) => {
    await openLoaded({ analysis: { mateSearch: false, ...analysis } });

    expect((await saved()).analysis).toEqual({ mateSearch: false, ...analysis });
  });

  test("4つとも空なら analysis を持たせない", async () => {
    await openLoaded({ analysis: { timeSeconds: 0, mateSearch: false } });

    const patch = await saved();
    expect("analysis" in patch).toBe(true);
    expect(patch.analysis).toBeUndefined();
  });

  test("入力前のプリセットは analysis を持たないまま", async () => {
    await openLoaded();
    expect((await saved()).analysis).toBeUndefined();
  });
});

describe("評価関数と定跡の欄", () => {
  test("候補に無い評価関数を残し、選び直さなければフォルダの名前を変えない", async () => {
    await openLoaded({ aiName: "hao", evalFilePath: "/elsewhere/x/eval/old.bin" });

    expect(evalSelect().selectedOptions[0].textContent).toBe("x / old.bin（現在の選択）");

    fireEvent.change(evalSelect(), { target: { value: "/elsewhere/x/eval/old.bin" } });
    expect(await saved()).toMatchObject({ aiName: "hao" });
  });

  test("定跡は既定で「使わない」", async () => {
    await openLoaded();
    expect(bookSelect().selectedOptions[0].textContent).toBe("使わない");
  });

  test("定跡の説明を出す", async () => {
    await openLoaded();
    expect(screen.getByText("選んだ定跡を検討で使い、定跡ビューにも出します。")).toBeTruthy();
  });
});

describe("検討の節", () => {
  const multiPvInput = () => screen.getByLabelText("候補手の数（数値で入力）") as HTMLInputElement;

  test("値が無ければ空欄の意味を、定義が分かれば初期値も言う", async () => {
    await openDialog();
    expect(screen.getByText("空欄なら初期値")).toBeTruthy();
    cleanup();
    probes.length = 0;

    await openLoaded();
    expect(screen.getByText("空欄なら初期値（1）")).toBeTruthy();
  });

  test("値があれば初期値と影響を言う。初期値が分からなければ「—」", async () => {
    await openDialog({ options: { MultiPV: "3" } });
    expect(screen.getByText("初期値 —。増やすと 1 手あたりの読みは浅くなります")).toBeTruthy();
    cleanup();
    probes.length = 0;

    await openLoaded({ options: { MultiPV: "3" } });
    expect(screen.getByText("初期値 1。増やすと 1 手あたりの読みは浅くなります")).toBeTruthy();
  });

  test("押したボタンに印を付ける", async () => {
    await openDialog({ options: { MultiPV: "3" } });
    const pressed = button("3");

    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(pressed.className).toContain("is-active");
    expect(button("5").getAttribute("aria-pressed")).toBe("false");
    expect(button("5").className).not.toContain("is-active");
  });

  test("ボタンは上限までしか出さない", async () => {
    await openLoaded({}, [{ name: "MultiPV", type: "spin", default: 1, min: 1, max: 4 }]);

    const group = screen.getByRole("group", { name: "候補手の数" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["1", "3"]);
  });

  test("「ほかの数…」で数の欄を開き、もう一度押すと閉じる", async () => {
    await openDialog();
    expect(screen.queryByLabelText("候補手の数（数値で入力）")).toBeNull();

    fireEvent.click(button("ほかの数…"));
    expect(multiPvInput()).toBeTruthy();

    fireEvent.click(button("ほかの数…"));
    expect(screen.queryByLabelText("候補手の数（数値で入力）")).toBeNull();
  });

  test("数の欄は上限と下限へ丸める", async () => {
    await openLoaded({}, [{ name: "MultiPV", type: "spin", default: 1, min: 1, max: 6 }]);
    fireEvent.click(button("ほかの数…"));

    fireEvent.change(multiPvInput(), { target: { value: "99" } });
    expect(multiPvInput().value).toBe("6");

    fireEvent.change(multiPvInput(), { target: { value: "-3" } });
    expect((await saved()).options).toEqual({ MultiPV: "1" });
  });

  test("数の欄の案内は初期値", async () => {
    await openLoaded();
    fireEvent.click(button("ほかの数…"));

    expect(multiPvInput().placeholder).toBe("1");
    expect(multiPvInput().max).toBe("8");
  });

  test("止める条件を入れて保存し、空にすると落ちる", async () => {
    await openLoaded();
    const time = screen.getByLabelText("時間（秒）") as HTMLInputElement;
    const depth = screen.getByLabelText("深さ") as HTMLInputElement;
    const nodes = screen.getByLabelText("ノード数") as HTMLInputElement;

    fireEvent.change(time, { target: { value: "30" } });
    fireEvent.change(depth, { target: { value: "12" } });
    fireEvent.change(nodes, { target: { value: "1000" } });
    fireEvent.change(depth, { target: { value: "" } });

    expect(time.value).toBe("30");
    expect((await saved()).analysis).toEqual({ timeSeconds: 30, nodes: 1000, mateSearch: false });
  });

  test("詰み探索を入れて保存する", async () => {
    await openLoaded();
    const check = screen.getByRole("checkbox", { name: "詰み探索" }) as HTMLInputElement;
    expect(check.checked).toBe(false);

    fireEvent.click(check);
    expect((await saved()).analysis).toEqual({ mateSearch: true });
  });

  test("止める条件はまだ検討に届かないと言う", async () => {
    await openDialog();
    expect(
      screen.getByText(
        "保存はしますが、検討はまだこの条件で終了しません（いまは中断するまで読み続けます）",
      ),
    ).toBeTruthy();
  });
});

describe("エンジン設定の節", () => {
  const search = () => screen.getByLabelText("エンジン設定を検索") as HTMLInputElement;
  const combo = (label: string) =>
    screen.getByDisplayValue(label).closest("select") as HTMLSelectElement;

  test("読み込む前の案内は3通り", async () => {
    await openDialog();
    expect(screen.getByText("エンジンを選択すると、ここに設定が並びます")).toBeTruthy();

    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    expect(screen.getByText("読み込みが終わると、ここに設定が並びます")).toBeTruthy();

    fireEvent.click(button("中止"));
    expect(screen.getByText("エンジンを読み込めると、ここに設定が並びます")).toBeTruthy();
  });

  test("読み込めたら検索の欄に件数を出し、空欄の意味を言う", async () => {
    await openLoaded();

    expect(search().placeholder).toBe("項目を検索（全 6 件）");
    expect(screen.getByText("空欄は初期値のままで、エンジンへは送りません。")).toBeTruthy();
  });

  test("値を変えた行に印を付ける。初期値と同じなら付けない", async () => {
    await openLoaded({ options: { Threads: "8", Style: "a" } });

    expect(screen.getAllByLabelText("初期値と違う")).toHaveLength(1);
  });

  test("辞書の名前があれば綴りを添え、無ければ綴りだけ", async () => {
    await openLoaded();

    expect(screen.getByText("スレッド数")).toBeTruthy();
    expect(document.querySelectorAll(".presetDialog__optionId")).toHaveLength(1);
  });

  test("値を変えて合わせた分を、先頭に件数でまとめる", async () => {
    await openLoaded({ options: { Threads: "9999" } });

    expect(
      screen.getByText("このエンジンに合わせて 1 件の値を変えました（保存すると確定します）"),
    ).toBeTruthy();
    expect(
      screen.getByText("Threads を 9999 から 512 に丸めました（このエンジンの範囲は 1〜512）"),
    ).toBeTruthy();
  });

  test("「変えた値だけ」で絞り、押すと「すべて表示」へ変わる", async () => {
    await openLoaded({ options: { Threads: "8" } });

    fireEvent.click(button("変えた値だけ"));
    expect(screen.getByText("スレッド数")).toBeTruthy();
    expect(screen.queryByText("Style")).toBeNull();
    expect(button("すべて表示").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button("すべて表示"));
    expect(screen.getByText("Style")).toBeTruthy();
  });

  test("当てはまらなければ、そう言う", async () => {
    await openLoaded();
    fireEvent.change(search(), { target: { value: "存在しない" } });

    expect(screen.getByText("当てはまる項目はありません")).toBeTruthy();
  });

  test("戻す値が無ければ押せない。絞っていなければ「すべて初期値に戻す」", async () => {
    await openLoaded();
    expect(button("すべて初期値に戻す").disabled).toBe(true);
  });

  test("「すべて初期値に戻す」は検討の節の値を消さない", async () => {
    await openLoaded({ options: { Threads: "8", Style: "b", MultiPV: "5" } });
    fireEvent.click(button("すべて初期値に戻す"));

    expect((await saved()).options).toEqual({ MultiPV: "5" });
  });

  test("「変えた値だけ」で絞っている間も、件数で言う", async () => {
    await openLoaded({ options: { Threads: "8" } });
    fireEvent.click(button("変えた値だけ"));

    expect(button("表示中の 1 件を初期値に戻す")).toBeTruthy();
  });

  test("空白だけの検索は絞らない", async () => {
    await openLoaded({ options: { Threads: "8" } });
    fireEvent.change(search(), { target: { value: "  " } });

    expect(button("すべて初期値に戻す")).toBeTruthy();
  });

  test("check の欄は初期値を ON か OFF で言い、選ぶと true か false、初期値で消す", async () => {
    await openLoaded();
    const select = combo("初期値（OFF）");

    expect(optionTexts(select)).toEqual(["初期値（OFF）", "ON", "OFF"]);
    fireEvent.change(select, { target: { value: "true" } });
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.change(select, { target: { value: "false" } });

    expect((await saved()).options).toEqual({ Ponder: "false" });
  });

  test("check の初期値が ON の行", async () => {
    await openLoaded({}, [{ name: "Ponder", type: "check", default: true }]);
    expect(combo("初期値（ON）")).toBeTruthy();
  });

  test("combo の欄は先頭が初期値で、選ぶと値になる。初期値を選ぶと消える", async () => {
    await openLoaded({ options: { Style: "b" } });
    const select = combo("b");

    expect(optionTexts(select)).toEqual(["初期値（a）", "a", "b"]);
    fireEvent.change(select, { target: { value: "" } });

    expect((await saved()).options).toEqual({});
  });

  test("選択肢に無い値は外さず残す", async () => {
    await openDialog({
      enginePath: ENGINE_A,
      options: { Style: "c" },
      definitions: DEFS,
      reservedNames: [],
      definitionsFor: ENGINE_A,
    });

    expect(optionTexts(combo("c（選択肢に無い）"))).toEqual([
      "初期値（a）",
      "c（選択肢に無い）",
      "a",
      "b",
    ]);
  });

  test("文字の欄は空にすると値を消す", async () => {
    await openLoaded({ options: { Note: "x" } });
    const input = screen.getByDisplayValue("x");
    fireEvent.change(input, { target: { value: "y" } });
    fireEvent.change(input, { target: { value: "" } });

    expect((await saved()).options).toEqual({});
  });

  test("文字の欄の案内は初期値", async () => {
    await openLoaded({}, [{ name: "Note", type: "string", default: "abc" }]);
    expect(screen.getByPlaceholderText("初期値（abc）")).toBeTruthy();
  });

  test("数の欄の案内に範囲を添える。範囲が無ければ初期値だけ", async () => {
    await openLoaded();

    expect(screen.getByPlaceholderText("初期値（4） 範囲 1〜512")).toBeTruthy();
    expect(screen.getByPlaceholderText("初期値（0）")).toBeTruthy();
  });

  test("数の欄は片側だけの範囲も言う", async () => {
    await openLoaded({}, [{ name: "Slow", type: "spin", default: 3, min: 1, max: null }]);
    expect(screen.getByPlaceholderText("初期値（3） 範囲 1〜")).toBeTruthy();
  });

  test("数の欄は打っている間は確定せず、離れたときに確定する", async () => {
    await openLoaded({ options: { Threads: "8" } });
    const input = screen.getByDisplayValue("8") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "１，０" } });
    expect(input.value).toBe("１，０");

    fireEvent.blur(input);
    expect(input.value).toBe("10");
  });

  test("数の欄で読めない文字を打って離れたら、保存済みの値へ戻る", async () => {
    await openLoaded({ options: { Threads: "8" } });
    const input = screen.getByDisplayValue("8") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    expect(input.value).toBe("8");
    expect((await saved()).options).toEqual({ Threads: "8" });
  });

  test("数の欄に何も打たずに離れても、確定しない", async () => {
    await openLoaded({ options: { Threads: "8" } });
    const input = screen.getByDisplayValue("8") as HTMLInputElement;

    fireEvent.blur(input);

    expect(input.value).toBe("8");
  });

  test("ファイルの欄は選んだパスを入れ、取り消したら何もしない", async () => {
    await openLoaded();
    dialogOpen.mockResolvedValueOnce(null);
    fireEvent.click(button("選択…"));
    await tick();
    expect((screen.getByPlaceholderText("初期値（nn.bin）") as HTMLInputElement).value).toBe("");

    dialogOpen.mockResolvedValueOnce("/e/model.bin");
    fireEvent.click(button("選択…"));
    await tick();

    expect((await saved()).options).toEqual({ Model: "/e/model.bin" });
  });

  test("ファイルの欄に打って空にすると、値を消す", async () => {
    await openLoaded({ options: { Model: "/e/model.bin" } });
    const input = screen.getByDisplayValue("/e/model.bin");

    fireEvent.change(input, { target: { value: "" } });

    expect((await saved()).options).toEqual({});
  });

  test("選ぶ画面の失敗は、次に開けたら消える", async () => {
    await openLoaded();
    dialogOpen.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(button("選択…"));
    await screen.findByRole("alert");

    dialogOpen.mockResolvedValueOnce(null);
    fireEvent.click(button("選択…"));
    await tick();

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("文言", () => {
  test("見出しの下の説明と、足もとの注意", async () => {
    await openDialog();

    expect(
      screen.getByText("保存時にプリセットが更新され、必要なら自動でエンジンが再起動されます。"),
    ).toBeTruthy();
    expect(screen.getByText("※ 編集中は保存されません。保存で確定します。")).toBeTruthy();
  });
});
