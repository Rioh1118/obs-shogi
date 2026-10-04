// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AiRootIndex } from "@/entities/engine/api/aiLibrary";
import type { ProbeOutcome } from "@/entities/engine";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";

/**
 * プリセット編集（使うもの／解析／エンジンの設定）。エンジンは選べば裏で読み込み、うまくいけば何も言わない。
 * 状態の判定表は `docs/state-transitions/engine-preset-dialog.md`（reducer のセルは reducer のテストが踏む）
 */

const AI_ROOT = "/Users/me/ai";
const ENGINE_A = `${AI_ROOT}/engines/a`;
const ENGINE_B = `${AI_ROOT}/engines/b`;

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

const INDEX: AiRootIndex = {
  ai_root: AI_ROOT,
  engines_dir: { path: `${AI_ROOT}/engines`, exists: true, kind: "dir" },
  engines: [
    { entry: "a", path: ENGINE_A, kind: "file", launchability: "ready" },
    { entry: "b", path: ENGINE_B, kind: "file", launchability: "ready" },
  ],
  profiles: [
    {
      name: "hao",
      path: `${AI_ROOT}/hao`,
      has_eval_dir: true,
      has_book_dir: false,
      eval_files: [{ entry: "nn.bin", path: `${AI_ROOT}/hao/eval/nn.bin`, kind: "file" }],
      book_db_files: [],
    },
    {
      name: "li",
      path: `${AI_ROOT}/li`,
      has_eval_dir: true,
      has_book_dir: true,
      eval_files: [{ entry: "nn.bin", path: `${AI_ROOT}/li/eval/nn.bin`, kind: "file" }],
      book_db_files: [
        {
          entry: "user_book1.db",
          path: `${AI_ROOT}/li/book/user_book1.db`,
          kind: "file",
        },
      ],
    },
  ],
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

// Tauri の口だけを差し替え、番号の払い出し（`probeEngine` の `nextRequestNumber`）は本物を通す。
// 捨てる判定は `presetDialogReducer`
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

/** ファイルを選ぶ画面。開けなかった形（権限の設定漏れ・プラグインの失敗）を当てる */
const dialogOpen = vi.fn<() => Promise<string | null>>();
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
        ({ config: { ai_root: AI_ROOT } }) as unknown as ReturnType<
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
          state: { presets: [presets.current] },
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
      scanAiRoot: () => Promise.resolve(INDEX),
      ensureEnginesDir: () => Promise.resolve(""),
    }) satisfies typeof import("@/entities/engine/api/aiLibrary"),
);

const { default: EnginePresetEditDialogPanel } = await import("../EnginePresetEditDialogPanel");

const DEFS: ProbeOutcome["definitions"] = [
  {
    name: "Threads",
    type: "spin",
    default: 4,
    min: 1,
    max: 512,
    label: "スレッド数",
  },
  {
    name: "USI_Hash",
    type: "spin",
    default: 1024,
    min: 1,
    max: 65536,
    label: "ハッシュ（MB）",
  },
  {
    name: "MultiPV",
    type: "spin",
    default: 1,
    min: 1,
    max: 500,
    label: "候補手の数",
  },
  {
    name: "USI_Ponder",
    type: "check",
    default: false,
    label: "相手の手番でも考える",
  },
  { name: "Style", type: "combo", default: "a", vars: ["a", "b"] },
  { name: "Model", type: "filename", default: "nn.bin" },
  {
    name: "BookMoves",
    type: "spin",
    default: 16,
    min: 0,
    max: 10000,
    label: "定跡を使う手数",
    group: "book",
  },
  { name: "Clear_Hash", type: "button" },
];

function outcome(p: Pending, name: string, defs = DEFS): ProbeOutcome {
  return {
    token: p.args.token,
    enginePath: p.args.enginePath,
    name,
    author: "someone",
    definitions: defs,
    reserved: ["USI_Ponder"],
  };
}

const engineSelect = () =>
  screen.getByLabelText("エンジン", {
    selector: "select",
  }) as HTMLSelectElement;
const saveButton = () => screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
const tick = () => new Promise((r) => setTimeout(r, 0));

async function open(): Promise<ReturnType<typeof render>> {
  const view = render(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);
  await waitFor(() => expect(engineSelect().disabled).toBe(false), {
    timeout: 5000,
  });
  return view;
}

async function saved(): Promise<Partial<EnginePreset>> {
  fireEvent.click(saveButton());
  await waitFor(() => expect(updatePreset).toHaveBeenCalled());
  return updatePreset.mock.calls[0][1];
}

beforeEach(() => {
  probes.length = 0;
  presets.current = PRESET;
  updatePreset.mockReset().mockResolvedValue(true);
  dialogOpen.mockReset();
});

afterEach(cleanup);

describe("読み込み", () => {
  test("エンジンを選ぶと読み込み、うまくいけば何も言わない。名乗りで出し、保存に定義が載る（画面の名前は除く）", async () => {
    await open();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    expect(probes.map((p) => p.args.enginePath)).toEqual([ENGINE_A]);
    expect(screen.getByText("エンジンを読み込んでいます…")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);

    probes[0].resolve(outcome(probes[0], "Engine A"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.queryByText(/読み込んでいます|取得|未取得/)).toBeNull();
    expect(engineSelect().selectedOptions[0].textContent).toBe("Engine A");

    const patch = await saved();
    expect(patch.definitionsFor).toBe(ENGINE_A);
    expect(patch.definitions?.[0]).not.toHaveProperty("label");
  }, 20000);

  /** 開いたときに1回読み込む（画面の名前はいつも今の辞書から。保存しない） */
  test("エンジンを持つプリセットを開くと、すぐ読み込む", async () => {
    presets.current = { ...PRESET, enginePath: ENGINE_A };
    await open();
    expect(probes.map((p) => p.args.enginePath)).toEqual([ENGINE_A]);
  }, 20000);

  /** 名乗りは読み込めたエンジンのもの。別のエンジンを前の名乗りで出すと、どれを選んだか分からなくなる */
  test("選び直したエンジンを読み込めなかったら、前のエンジンの名乗りで出さず、名乗りを保存しない", async () => {
    presets.current = { ...PRESET, enginePath: ENGINE_A };
    await open();
    probes[0].resolve(outcome(probes[0], "Engine A"));
    await waitFor(() => expect(engineSelect().selectedOptions[0].textContent).toBe("Engine A"));

    fireEvent.change(engineSelect(), { target: { value: ENGINE_B } });
    probes[1].reject({ kind: "notUsi", message: "no usiok" });
    await screen.findByRole("alert");
    expect(engineSelect().value).toBe(ENGINE_B);
    expect([...engineSelect().options].map((o) => o.textContent)).not.toContain("Engine A");
    expect((await saved()).engineName).toBeNull();
  }, 20000);

  /** 保存した名乗りは、保存したときのエンジンのもの。いま読み込めていなければ、それを名乗りとして出さない */
  test("いまのエンジンを読み込めていなければ、保存してある名乗りで出さない", async () => {
    presets.current = { ...PRESET, enginePath: ENGINE_A, engineName: "Old Build" };
    await open();
    probes[0].reject({ kind: "notUsi", message: "no usiok" });
    await screen.findByRole("alert");
    expect([...engineSelect().options].map((o) => o.textContent)).not.toContain("Old Build");
  }, 20000);

  test("選び直した後に前の読み込みが返っても、選び直したエンジンを使う（A→B→A も）", async () => {
    await open();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    fireEvent.change(engineSelect(), { target: { value: ENGINE_B } });
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    const [first, , third] = probes;

    first.resolve(outcome(first, "Engine A (old)"));
    await tick();
    expect(saveButton().disabled).toBe(true);

    third.resolve(outcome(third, "Engine A"));
    await waitFor(() => expect(engineSelect().selectedOptions[0].textContent).toBe("Engine A"));
    expect(saveButton().disabled).toBe(false);
  }, 20000);

  test("読めなかったら理由と「もう一度読み込む」を出し、押すと読み込み直す", async () => {
    await open();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    probes[0].reject({ kind: "notUsi", message: "no usiok" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("USI エンジンとして応答しませんでした");
    expect(alert.textContent).toContain("詳細: no usiok");

    fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
    expect(probes.map((p) => p.args.enginePath)).toEqual([ENGINE_A, ENGINE_A]);
  }, 20000);

  /** 返らない読み込み（応答しないドライブ）で保存が塞がったままにならない */
  test("「やめる」で保存でき、後から返った結果は使わない", async () => {
    await open();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(saveButton().disabled).toBe(false);

    probes[0].resolve(outcome(probes[0], "Engine A"));
    await tick();
    expect(engineSelect().selectedOptions[0].textContent).not.toBe("Engine A");

    // 同じエンジンは選び直しても読まれないので、読み込み直す口が残っていないと行き止まりになる
    expect(screen.getByText(/エンジンをまだ読み込んでいません/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
    expect(probes.map((p) => p.args.enginePath)).toEqual([ENGINE_A, ENGINE_A]);
  }, 20000);

  test("読み込み中にプリセットが読み直されても、保存は塞がったまま", async () => {
    const view = await open();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    presets.current = { ...PRESET };
    view.rerender(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);
    await tick();
    expect(saveButton().disabled).toBe(true);
  }, 20000);
});

describe("値を定義に当てる", () => {
  /** 当てる元は保存済みの値＋この画面での編集。読み込みを待つ間の編集も残る */
  test("読み込んだら値を当て、変えた値を1行にまとめて見せる。待つ間の編集は残る", async () => {
    presets.current = {
      ...PRESET,
      options: { NetworkDelay: "120", Threads: "999" },
    };
    await open();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    probes[0].resolve(outcome(probes[0], "Engine A"));

    const summary = await screen.findByText(/このエンジンに合わせて 2 件の値を変えました/);
    fireEvent.click(summary);
    expect(screen.getByText("NetworkDelay = 120 を外しました（このエンジンに無い）")).toBeTruthy();

    expect((await saved()).options).toEqual({ Threads: "512", MultiPV: "3" });
  }, 20000);

  test("A で外した値は、それを受ける B に選び直すと戻る", async () => {
    presets.current = { ...PRESET, options: { NetworkDelay: "120" } };
    await open();
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    probes[0].resolve(outcome(probes[0], "Engine A"));
    await screen.findByText(/このエンジンに合わせて/);

    fireEvent.change(engineSelect(), { target: { value: ENGINE_B } });
    probes[1].resolve(
      outcome(probes[1], "Engine B", [
        { name: "NetworkDelay", type: "spin", default: 0, min: 0, max: 10000 },
      ]),
    );
    await waitFor(() => expect(engineSelect().selectedOptions[0].textContent).toBe("Engine B"));
    expect((await saved()).options).toEqual({ NetworkDelay: "120" });
  }, 20000);
});

describe("使うもの", () => {
  test("評価関数は「フォルダ / ファイル」で選び、選んだフォルダが AI の名前になる。定跡は「使わない」を選べる", async () => {
    presets.current = {
      ...PRESET,
      bookEnabled: true,
      bookFilePath: `${AI_ROOT}/li/book/user_book1.db`,
    };
    await open();

    const evalSelect = screen.getByLabelText("評価関数", {
      selector: "select",
    });
    fireEvent.change(evalSelect, {
      target: { value: `${AI_ROOT}/li/eval/nn.bin` },
    });
    fireEvent.change(screen.getByLabelText("定跡", { selector: "select" }), {
      target: { value: "" },
    });
    fireEvent.change(engineSelect(), { target: { value: ENGINE_A } });
    probes[0].resolve(outcome(probes[0], "Engine A"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    const patch = await saved();
    expect(patch.evalFilePath).toBe(`${AI_ROOT}/li/eval/nn.bin`);
    expect(patch.aiName).toBe("li");
    expect([patch.bookEnabled, patch.bookFilePath]).toEqual([false, null]);
  }, 20000);

  /** 評価関数の空は「指定しない」という選択でもある。補完が埋め直すと、選べない選択肢になる */
  test("評価関数の「指定しない」は埋め直されず、そのフォルダの AI の名前も外れる", async () => {
    presets.current = {
      ...PRESET,
      enginePath: ENGINE_A,
      aiName: "hao",
      evalFilePath: `${AI_ROOT}/hao/eval/nn.bin`,
    };
    await open();
    probes[0].resolve(outcome(probes[0], "Engine A"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    const evalSelect = screen.getByLabelText("評価関数", {
      selector: "select",
    }) as HTMLSelectElement;
    fireEvent.change(evalSelect, { target: { value: "" } });
    await tick();
    expect(evalSelect.value).toBe("");

    const patch = await saved();
    expect([patch.evalFilePath, patch.aiName]).toEqual(["", ""]);
  }, 20000);

  test("空欄の補完は作ったばかりのプリセットにだけ。エンジンのあるプリセットの評価関数の空は埋めない", async () => {
    await open();
    const evalSelect = () =>
      screen.getByLabelText("評価関数", {
        selector: "select",
      }) as HTMLSelectElement;
    await waitFor(() => expect(evalSelect().value).toBe(`${AI_ROOT}/hao/eval/nn.bin`));
    // 補完は開いた後の1回だけ。選んだ「指定しない」を埋め直さない
    fireEvent.change(evalSelect(), { target: { value: "" } });
    await tick();
    expect(evalSelect().value).toBe("");
    cleanup();

    presets.current = { ...PRESET, enginePath: ENGINE_A };
    await open();
    probes[0].resolve(outcome(probes[0], "Engine A"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(evalSelect().value).toBe("");
  }, 20000);

  /** 前の版は「解析で使わない」定跡のパスを残して保存している。欄は「使わない」と出すので、ファイルも揃える */
  test("使わない定跡のパスは、保存で落とす", async () => {
    presets.current = {
      ...PRESET,
      enginePath: ENGINE_A,
      bookEnabled: false,
      bookFilePath: `${AI_ROOT}/li/book/user_book1.db`,
    };
    await open();
    probes[0].resolve(outcome(probes[0], "Engine A"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(
      (
        screen.getByLabelText("定跡", {
          selector: "select",
        }) as HTMLSelectElement
      ).value,
    ).toBe("");

    const patch = await saved();
    expect([patch.bookEnabled, patch.bookFilePath]).toEqual([false, null]);
  }, 20000);
});

describe("解析", () => {
  test("候補手の数は、押したボタンをもう一度押すと初期値（値を持たない）に戻る", async () => {
    presets.current = {
      ...PRESET,
      enginePath: ENGINE_A,
      options: { MultiPV: "5" },
    };
    await open();
    probes[0].resolve(outcome(probes[0], "Engine A"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect((await saved()).options).toEqual({});
  }, 20000);

  /** 丸められてボタンに無い値になっても、値が画面から消えない */
  test("ボタンに無い値になったら、数の欄を開いて値を出す。空にしたら初期値", async () => {
    presets.current = {
      ...PRESET,
      enginePath: ENGINE_A,
      options: { MultiPV: "5" },
    };
    await open();
    probes[0].resolve(
      outcome(probes[0], "Engine A", [
        { name: "MultiPV", type: "spin", default: 1, min: 1, max: 4 },
      ]),
    );
    const input = (await screen.findByLabelText("候補手の数（数で入れる）")) as HTMLInputElement;
    expect(input.value).toBe("4");
    // 閉じると値が画面から消えるので、ボタンに無い値の間は閉じられない
    expect((screen.getByRole("button", { name: "ほかの数…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(input, { target: { value: "" } });
    expect((await saved()).options).toEqual({});
  }, 20000);
});

describe("エンジンの設定", () => {
  async function loaded(options: Record<string, string> = {}, extra: Partial<EnginePreset> = {}) {
    presets.current = { ...PRESET, enginePath: ENGINE_A, options, ...extra };
    await open();
    probes[0].resolve(outcome(probes[0], "Engine A"));
    await screen.findByLabelText("エンジンの設定を探す");
  }

  test("日本語の名前で並べ、綴りを添える。辞書に無い名前は綴りのまま。アプリが決める項目と button は出さない", async () => {
    await loaded();
    expect(screen.getByText("スレッド数")).toBeTruthy();
    expect(screen.getByText("Threads")).toBeTruthy();
    expect(screen.getByText("Style")).toBeTruthy();
    expect(screen.queryByText("相手の手番でも考える")).toBeNull();
    expect(screen.queryByText("Clear_Hash")).toBeNull();
  }, 20000);

  test("定跡を使わないときは定跡の設定を出さない", async () => {
    await loaded();
    expect(screen.queryByText("定跡を使う手数")).toBeNull();
  }, 20000);

  test("型ごとの欄で値を変え、保存に載る（数は欄を離れたときに範囲へ丸める）", async () => {
    await loaded();
    fireEvent.change(screen.getByDisplayValue("初期値（a）"), {
      target: { value: "b" },
    });
    const threads = screen.getByPlaceholderText(/初期値（4）/);
    fireEvent.change(threads, { target: { value: "999" } });
    fireEvent.blur(threads);
    fireEvent.change(screen.getByPlaceholderText("初期値（nn.bin）"), {
      target: { value: "/e/model.bin" },
    });
    expect((await saved()).options).toEqual({
      Style: "b",
      Threads: "512",
      Model: "/e/model.bin",
    });
  }, 20000);

  test("日本語で探せる。絞り込み中は表示中の行だけを初期値に戻す", async () => {
    await loaded({ Style: "b", Threads: "8", MultiPV: "5" });
    fireEvent.change(screen.getByLabelText("エンジンの設定を探す"), {
      target: { value: "スレッド" },
    });
    expect(screen.queryByText("Style")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "表示中の 1 件を初期値に戻す" }));
    // 見えない行（Style）と、解析の節の値（MultiPV）は残す
    expect((await saved()).options).toEqual({ Style: "b", MultiPV: "5" });
  }, 20000);

  /** 選ぶ画面を開けなければ、そう言って文字の欄へ誘う（黙って何も起きない、にしない） */
  test("ファイルを選ぶ画面を開けなければ、理由と代わりの手を出す", async () => {
    dialogOpen.mockRejectedValueOnce(new Error("dialog.open not allowed"));
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "選択…" }));
    const message = await screen.findByText(/ファイルを選ぶ画面を開けませんでした/);
    expect(message.textContent).toContain("欄にパスを直接入力してください");
  }, 20000);
});
