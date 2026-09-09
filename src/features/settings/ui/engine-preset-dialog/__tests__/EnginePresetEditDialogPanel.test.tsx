// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { AiRootIndex } from "@/entities/engine/api/aiLibrary";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";

/**
 * 帯（`engines` の状態）が、**いつの索引を映すか**。
 *
 * このダイアログは AI ルートを選び直せるので、走査の最中に画面が指すルートと
 * 索引のルートがずれる窓がある。ずれたまま帯を出すと、旧ルートの絶対パスを名指ししながら
 * 隣のボタンは新しいルートに対して働く——本文と動作の宛先が食い違う。
 */

const AI_ROOT = "/Users/me/ai";

const scanAiRoot = vi.fn<(root: string) => Promise<AiRootIndex>>();
const chooseAiRoot = vi.fn<() => Promise<{ success: true; data: string | null }>>();
const ensureEnginesDir = vi.fn<(root: string) => Promise<string>>();
const aiRootValue = { current: AI_ROOT };

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

// 差し替えるのは実体の側。barrel を差し替えると再 export の全部が消える
vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: { ai_root: aiRootValue.current }, chooseAiRoot }),
}));

vi.mock("@/entities/engine-presets/model/useEnginePresets", () => ({
  useEnginePresets: () => ({
    state: { presets: [PRESET] },
    updatePreset: vi.fn(),
  }),
}));

vi.mock("@/entities/engine/api/aiLibrary", () => ({
  scanAiRoot: (root: string) => scanAiRoot(root),
  ensureEnginesDir: (root: string) => ensureEnginesDir(root),
}));

const { default: EnginePresetEditDialogPanel } = await import("../EnginePresetEditDialogPanel");

/**
 * `engines/` が無いルートの索引。帯が出る2つの分類（`missing` / `other`）のうち、
 * 作成ボタンも出るほう。**`other` の帯はまだどのテストも通っていない**
 */
function indexWithoutEngines(root: string): AiRootIndex {
  return {
    ai_root: root,
    engines_dir: { path: `${root}/engines`, exists: false, kind: "unknown" },
    engines: [],
    profiles: [],
  };
}

/** `engines` の帯だけを引く。同じ class の帯は MultiPV の注意書きにもある */
function band(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".presetDialog__hintWarn")].find((el) =>
    el.textContent?.includes("engines"),
  );
}

beforeEach(() => {
  scanAiRoot.mockReset();
  chooseAiRoot.mockReset();
  ensureEnginesDir.mockReset().mockResolvedValue("");
  aiRootValue.current = AI_ROOT;
});

afterEach(cleanup);

describe("プリセット編集ダイアログの engines の帯", () => {
  test("engines/ が無ければ、その場所を名乗って作成を出す", async () => {
    scanAiRoot.mockResolvedValue(indexWithoutEngines(AI_ROOT));
    render(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);

    await waitFor(() => expect(band()).not.toBeUndefined(), { timeout: 5000 });
    expect(band()?.textContent).toContain(`${AI_ROOT}/engines`);
    expect(screen.getByRole("button", { name: "engines/ を作成" })).toBeTruthy();
  }, 20000);

  /** 押せる「再スキャン」の数。帯は `engines` が無い／フォルダでない回にしか出ない */
  function enabledRescans() {
    return screen
      .queryAllByRole("button", { name: "再スキャン" })
      .filter((b) => !(b as HTMLButtonElement).disabled).length;
  }

  /**
   * 走査が返らない環境（応答しないボリューム）。**出口を残す。**
   *
   * 塞ぐと、閉じて開き直す以外に手が無く、編集中の下書きが消える
   */
  test("初回の走査が返らない間も、押せる再スキャンが残る", async () => {
    scanAiRoot.mockReturnValue(new Promise(() => {}));
    render(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalled(), { timeout: 5000 });
    expect(enabledRescans()).toBeGreaterThan(0);
  }, 20000);

  // 帯が出ない構成（`engines/` が普通に在る）でも同じ
  test("engines/ が在るルートの読み直しが返らない間も、押せる再スキャンが残る", async () => {
    scanAiRoot.mockResolvedValue({
      ...indexWithoutEngines(AI_ROOT),
      engines_dir: { path: `${AI_ROOT}/engines`, exists: true, kind: "dir" },
    });
    render(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);
    await waitFor(() => expect(enabledRescans()).toBeGreaterThan(0), { timeout: 5000 });

    scanAiRoot.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getAllByRole("button", { name: "再スキャン" })[0]);

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(band()).toBeUndefined();
    expect(enabledRescans()).toBeGreaterThan(0);
  }, 20000);

  /**
   * 同じフォルダを選び直した回。**この画面が自分で読み直す。**
   *
   * `ai_root` が変わらないので走査の effect は再走しない——繋ぎ直した人が
   * 唯一押せる口を押しても画面が変わらないことになる
   */
  test("同じフォルダを選び直したら、読み直す", async () => {
    scanAiRoot.mockResolvedValue(indexWithoutEngines(AI_ROOT));
    render(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);
    await waitFor(() => expect(band()).not.toBeUndefined(), { timeout: 5000 });
    expect(scanAiRoot).toHaveBeenCalledTimes(1);

    chooseAiRoot.mockResolvedValue({ success: true, data: AI_ROOT });
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledTimes(2), { timeout: 5000 });
  }, 20000);

  /**
   * 切り替えた直後の走査中。**前のルートの索引で描かない。**
   *
   * 描くと、帯は旧ルートの絶対パスを名指しするのに、その隣の「engines/ を作成」は
   * 新しいルートに対して働く
   */
  test("ルートを選び直したら、走査が返るまで帯を出さない", async () => {
    scanAiRoot.mockResolvedValue(indexWithoutEngines(AI_ROOT));
    const { rerender } = render(
      <EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />,
    );
    await waitFor(() => expect(band()).not.toBeUndefined(), { timeout: 5000 });

    // 新しいルートの走査は返さない。切り替えた直後の窓をそのまま観測する
    scanAiRoot.mockReturnValue(new Promise(() => {}));
    chooseAiRoot.mockImplementation(async () => {
      aiRootValue.current = "/Users/me/ai2";
      return { success: true, data: "/Users/me/ai2" } as const;
    });

    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(chooseAiRoot).toHaveBeenCalled());

    // 本番では設定の provider が再描画する。ここは差し替えているので手で促す。
    // **帯が消えるのはこの描画の中**（索引を突き合わせた結果なので、走査を待たない）
    rerender(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);

    expect(band()).toBeUndefined();
  }, 20000);

  /**
   * 作成の途中でルートを切り替えた回。**前のルートの失敗を新しいルートの画面に書かない。**
   *
   * 書くと、もう指していないフォルダの失敗が赤字で出るうえ、`indexStatus` が error に落ちて
   * **読めている索引ごと候補が全部塞がる**
   */
  test("作成の途中でルートを切り替えたら、前のルートの失敗を書かない", async () => {
    scanAiRoot.mockResolvedValue(indexWithoutEngines(AI_ROOT));
    const { rerender } = render(
      <EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />,
    );
    await waitFor(() => expect(band()).not.toBeUndefined(), { timeout: 5000 });

    let failEnsure!: (reason: string) => void;
    ensureEnginesDir.mockReturnValue(new Promise((_, reject) => (failEnsure = reject)));
    fireEvent.click(screen.getByRole("button", { name: "engines/ を作成" }));

    scanAiRoot.mockResolvedValue(indexWithoutEngines("/Users/me/ai2"));
    chooseAiRoot.mockImplementation(async () => {
      aiRootValue.current = "/Users/me/ai2";
      return { success: true, data: "/Users/me/ai2" } as const;
    });
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(chooseAiRoot).toHaveBeenCalled());
    rerender(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"), {
      timeout: 5000,
    });

    await act(async () => {
      failEnsure("ai_root does not exist");
    });

    expect(screen.queryByText(/ai_root does not exist/)).toBeNull();
  }, 20000);

  /**
   * 読み直している間の帯は前の索引のままなので、作成は押せると「効かなかった」と読まれる。
   * **「再スキャン」は塞がない**——画面の再試行の口が2つとも同じ条件で死ぬと、
   * 走査が返らない環境で出口が無くなる
   */
  test("同じルートを読み直している間は、帯の作成だけ押せない", async () => {
    scanAiRoot.mockResolvedValue(indexWithoutEngines(AI_ROOT));
    render(<EnginePresetEditDialogPanel presetId={PRESET.id} open onClose={() => {}} />);
    await waitFor(() => expect(band()).not.toBeUndefined(), { timeout: 5000 });

    scanAiRoot.mockReturnValue(new Promise(() => {}));
    // 帯の中の「再スキャン」。同じ名前のボタンは基本の節にもある
    fireEvent.click(within(band() as HTMLElement).getByRole("button", { name: "再スキャン" }));

    await waitFor(
      () =>
        expect(
          (screen.getByRole("button", { name: "engines/ を作成" }) as HTMLButtonElement).disabled,
        ).toBe(true),
      { timeout: 5000 },
    );

    expect(
      (
        within(band() as HTMLElement).getByRole("button", {
          name: "再スキャン",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  }, 20000);
});
