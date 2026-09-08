// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { AiRootIndex, FsKind } from "@/entities/engine/api/aiLibrary";
import type { NotifyRequest } from "@/shared/lib/notification/types";

/**
 * 「開く」が、**開けない場所を開かせない**こと。
 *
 * この経路の失敗は「そこに無い」か「ファイル管理ソフトを呼べない」のどちらかで、
 * どちらも押した人には同じに見える。押せる条件と本文の両方が揃っていないと、
 * 無いフォルダを Finder で探させる案内になる。
 */

const AI_ROOT = "/Users/me/ai";

const revealInFileManager =
  vi.fn<(path: string) => Promise<{ success: boolean; error?: string }>>();
const notify = vi.fn<(request: NotifyRequest) => void>();
const scanAiRoot = vi.fn<(root: string) => Promise<AiRootIndex>>();
/** 本番と同じ形（`AsyncResult<string | null, string>`）。取り消しは `data: null` */
type PickResult = { success: true; data: string | null } | { success: false; error: string };
const chooseAiRoot = vi.fn<() => Promise<PickResult>>();
const ensureEnginesDir = vi.fn<(root: string) => Promise<string>>();
/** 本番と同じ形（`AsyncResult<string, FsError>`）。名前の失敗を作れる必要がある */
type CreateResult = { success: true; data: string } | { success: false; error: { code: string } };
const createAiProfileDirs = vi.fn<(root: string, name: string) => Promise<CreateResult>>();

/** `config` は起動時に非同期で届く。届く前に mount する回を作れるようにする */
const aiRootValue = { current: AI_ROOT };

/**
 * 選択が成功したときの本番の振る舞い。**`config` も一緒に変わる**——
 * `chooseAiRoot` は保存して読み直してから返るので、返った時点で `config.ai_root` は新しい
 */
function pickReturns(root: string) {
  chooseAiRoot.mockImplementation(async () => {
    aiRootValue.current = root;
    return { success: true, data: root } as const;
  });
}

// 差し替えるのは実体の側。barrel を差し替えると再 export の全部が消える
vi.mock("@/entities/app-config/model/useAppConfig", () => ({
  useAppConfig: () => ({ config: { ai_root: aiRootValue.current }, chooseAiRoot }),
}));

vi.mock("@/entities/engine/api/aiLibrary", () => ({
  scanAiRoot: (root: string) => scanAiRoot(root),
  ensureEnginesDir: (root: string) => ensureEnginesDir(root),
  createAiProfileDirs: (root: string, name: string) => createAiProfileDirs(root, name),
}));

vi.mock("@/shared/api/shell/revealInFileManager", () => ({
  revealInFileManager: (path: string) => revealInFileManager(path),
}));

vi.mock("@/shared/lib/notification/useNotifications", () => ({
  useNotify: () => ({ notify, dismiss: vi.fn(), dismissByKey: vi.fn() }),
}));

const { default: AiLibraryTab } = await import("../AiLibraryTab");

/** `engines/` が在るか無いか（と、何として在るか）だけを変えた索引 */
function index(enginesDirExists: boolean, kind: FsKind = "dir"): AiRootIndex {
  return {
    ai_root: AI_ROOT,
    engines_dir: {
      path: `${AI_ROOT}/engines`,
      exists: enginesDirExists,
      kind: enginesDirExists ? kind : "unknown",
    },
    engines: [],
    profiles: [],
  };
}

/**
 * エンジンが1つ在る索引。**「AIフォルダを追加」の節はエンジンが0件だと描かれない**
 * （`SetupGuide` の `canOperate && enginesCount > 0`）
 */
function indexWithEngine(root = AI_ROOT): AiRootIndex {
  return {
    ...index(true),
    ai_root: root,
    engines: [{ entry: "YaneuraOu", path: `${root}/engines/YaneuraOu`, kind: "file" }],
  };
}

/**
 * 手順書の「スキャン」。**どれでも同じ**——hero の副動作も Step 3 も Step 4 も
 * `onRescan` を呼ぶので、先頭を採る
 */
function scanButton() {
  return screen.getAllByRole("button", { name: "スキャン" })[0];
}

/**
 * スキャンが終わるまで待ち、**主カラムの**「engines/ を開く」を返す。
 *
 * 同じ名前のボタンは `SetupGuide` の hero（エンジンが0件のとき）と Step 3 にも出る。
 * `engines/` が在る回は3つとも描かれるので、名前だけでは引けない。
 * 節（`SSection`）は見出しで名前が付いているので、そこで絞る
 */
async function renderScanned(enginesDirExists: boolean, kind: FsKind = "dir") {
  scanAiRoot.mockResolvedValue(index(enginesDirExists, kind));
  render(<AiLibraryTab />);
  // **呼ばれたことではなく、結果が画面に入ったことを待つ。** 待たずに押すと、
  // まだ `loading` で塞がっているボタンを押して何も起きない回が混じる
  await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

  return within(screen.getByRole("region", { name: "AIライブラリ" })).getByRole("button", {
    name: "engines/ を開く",
  }) as HTMLButtonElement;
}

beforeEach(() => {
  revealInFileManager.mockReset().mockResolvedValue({ success: true });
  notify.mockReset();
  scanAiRoot.mockReset();
  chooseAiRoot.mockReset();
  ensureEnginesDir.mockReset().mockResolvedValue("");
  createAiProfileDirs.mockReset().mockResolvedValue({ success: true, data: "" });
  aiRootValue.current = AI_ROOT;
});

afterEach(cleanup);

describe("AI ライブラリタブの「開く」", () => {
  /**
   * 設定は起動時に非同期で届くので、この画面が `config === null` で mount する回がある。
   * 初回だけの読み込みにすると、後から届いたルートを誰もスキャンしない
   */
  test("ルートが後から届いても読み直す", async () => {
    aiRootValue.current = "";
    const { rerender } = render(<AiLibraryTab />);
    expect(scanAiRoot).not.toHaveBeenCalled();

    aiRootValue.current = AI_ROOT;
    scanAiRoot.mockResolvedValue(index(true));
    rerender(<AiLibraryTab />);

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith(AI_ROOT));

    // 出したかどうかだけでなく、**画面に載ったか**まで見る
    await waitFor(() => expect(screen.queryByText("未設定")).toBeNull());
    expect(
      (
        within(screen.getByRole("region", { name: "AIライブラリ" })).getByRole("button", {
          name: "engines/ を開く",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  // 開けなかったときの読み直しも `await` を跨ぐ。その間に選び直されたら書かない
  test("開けなかった後に選び直したら、前のルートで読み直さない", async () => {
    await renderScanned(true);

    let failReveal!: (v: { success: false; error: string }) => void;
    revealInFileManager.mockReturnValue(new Promise((r) => (failReveal = r)));
    fireEvent.click(screen.getByTitle("engines/ を開く"));

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue({ ...index(true), ai_root: "/Users/me/ai2" });
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      failReveal({ success: false, error: "os error 2" });
    });

    // 読み直しはいま指しているルートで走る。前のルートでは走らせない。
    // **初回のぶんを除いた列そのものを見る**——「ちょうど N 回ではない」は
    // 0 回でも通るので、関門を壊す変異を1つも殺せない
    expect(scanAiRoot.mock.calls.map(([root]) => root).slice(1)).toEqual([
      "/Users/me/ai2",
      "/Users/me/ai2",
    ]);
  });

  /**
   * スキャン中に「まだ何も読めていない」と同じ画面へ落ちないこと。
   *
   * 進行中に索引を捨てると、開く口が閉じ、手順書の段が塞がり、
   * 押したスキャンのボタン自身も消える。`unknown` なので作成も出ない——
   * engines に対してできることが1つも無くなる。
   * 残るのは常設の「選択…」だけで、それはルートを選び直す操作であって、
   * いま在るフォルダへ戻る道ではない
   */
  test("再スキャン中も、読めていた engines/ は開ける", async () => {
    const button = await renderScanned(true);
    scanAiRoot.mockReturnValue(new Promise(() => {}));

    fireEvent.click(scanButton());

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledTimes(2));
    expect(button.disabled).toBe(false);
  });

  test("engines/ が無い間は押せない", async () => {
    expect((await renderScanned(false)).disabled).toBe(true);
  });

  // フォルダでないものが居座っている状態を直すには、それを見に行くしかない。
  // 「作成」は必ず失敗するので出さない
  test("engines がフォルダでなければ、開けて、作成は出ない", async () => {
    expect((await renderScanned(true, "file")).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "engines/ を作成" })).toBeNull();
    expect(screen.getByText("engines がフォルダではありません")).toBeTruthy();
    // 「現在の状態」の木も、作成ではなく外すことを言う
    expect(screen.getByText("← フォルダではない")).toBeTruthy();
    // 外した後に「終わった」と言う口。無いと、実在しなくなったパスへの「開く」しか残らない
    expect(scanButton()).toBeTruthy();
  });

  test("engines/ が在れば押せて、その場所を見せに行く", async () => {
    const button = await renderScanned(true);
    expect(button.disabled).toBe(false);

    fireEvent.click(button);

    await waitFor(() => expect(revealInFileManager).toHaveBeenCalledWith(`${AI_ROOT}/engines`));
    expect(notify).not.toHaveBeenCalled();
    // 成功した回は読み直さない（押すたびにディスクを走査しない）
    expect(scanAiRoot).toHaveBeenCalledTimes(1);
  });

  // AI ルート側の「開く」も同じ経路を通る。押せる条件はパスが入っていることだけ
  test("AI ルートの「開く」も、その場所を見せに行く", async () => {
    await renderScanned(true);

    fireEvent.click(
      within(screen.getByRole("region", { name: "AIライブラリ" })).getByRole("button", {
        name: "開く",
      }),
    );

    await waitFor(() => expect(revealInFileManager).toHaveBeenCalledWith(AI_ROOT));
    expect(notify).not.toHaveBeenCalled();
  });

  /**
   * 切り替えた直後に前のルートの索引が残ると、「開く」は**前のフォルダを開いて成功する**。
   * 失敗しないので、押した人には手掛かりが1つも残らない
   */
  test("ルートを選び直した直後は、前のルートの索引で開かない", async () => {
    const button = await renderScanned(true);
    pickReturns("/Users/me/ai2");
    scanAiRoot.mockReturnValue(new Promise(() => {}));

    fireEvent.click(screen.getByRole("button", { name: /選択/ }));

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));
    expect(button.disabled).toBe(true);
  });

  /**
   * 同じルートを選び直す回（効かなくなった外付けを繋ぎ直した等）。
   *
   * `aiRoot` が変わらないので **effect は走らない**。ここで呼ばないと、
   * 押しても何も起きないボタンになる
   */
  test("同じルートを選び直したら、読み直す", async () => {
    await renderScanned(true);
    expect(scanAiRoot).toHaveBeenCalledTimes(1);

    pickReturns(AI_ROOT);
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledTimes(2));
    expect(scanAiRoot.mock.calls[1][0]).toBe(AI_ROOT);
  });

  // 逆向き。`chooseAiRoot` は設定を書き換えてから返るので、別のルートは effect が読む。
  // ここでも呼ぶと、同じルートをディスクごと2回走査する
  test("別のルートを選んだら、そのルートの走査は1回だけ", async () => {
    await renderScanned(true);
    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue({ ...index(true), ai_root: "/Users/me/ai2" });

    fireEvent.click(screen.getByRole("button", { name: /選択/ }));

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    expect(scanAiRoot.mock.calls.filter(([root]) => root === "/Users/me/ai2")).toHaveLength(1);
  });

  // 取り消しは失敗ではない。診断へ回すと、何もしていないのに「確認できませんでした」が出る
  test("選択を取り消したら、画面は何も変わらない", async () => {
    const button = await renderScanned(true);
    chooseAiRoot.mockResolvedValue({ success: true, data: null });

    fireEvent.click(screen.getByRole("button", { name: /選択/ }));

    await waitFor(() => expect(chooseAiRoot).toHaveBeenCalled());
    expect(scanAiRoot).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    expect(screen.queryByText("フォルダを確認できませんでした")).toBeNull();
  });

  /**
   * 選べなかった回。**最後に読めた索引は捨てない**——ルートは変わっていないので、
   * その索引はまだ現物を指している。捨てると、選択に失敗しただけで
   * 開く口まで閉じることになる
   */
  test("選択に失敗しても、読めていた engines/ は開ける", async () => {
    const button = await renderScanned(true);
    chooseAiRoot.mockResolvedValue({ success: false, error: "dialog unavailable" });

    fireEvent.click(screen.getByRole("button", { name: /選択/ }));

    // 主カラムの帯と手順書の hero の2箇所に出る
    await waitFor(() =>
      expect(screen.getAllByText("dialog unavailable").length).toBeGreaterThan(0),
    );
    expect(button.disabled).toBe(false);
  });

  // ルートごと消えている回。索引を残すと、読み直しても「あり」のままになる
  test("ルートを読めなくなったら、古い索引で開かせない", async () => {
    const button = await renderScanned(true);
    scanAiRoot.mockRejectedValue("ai_root does not exist");

    fireEvent.click(scanButton());

    await waitFor(() => expect(button.disabled).toBe(true));
    // 作成もルートの存在を確かめるので、押せば同じ失敗が返るだけ
    expect(screen.queryAllByRole("button", { name: "engines/ を作成" })).toEqual([]);
    // 読めていない回に「0 件」と断言しない（観測していない）
    expect(screen.queryByText("0 件")).toBeNull();
    // 木も同じ。読めていないのに「作成しろ」と指示すると、
    // その回は入力欄も段も描かれていないので、探しても作成口が無い
    expect(screen.queryByText("← AIフォルダを作成")).toBeNull();
  });

  // `await` を跨ぐ口は他にもある。前のルートの失敗を新しいルートの画面に書かない
  test("ルートを切り替えた後に返る作成の失敗は、画面に書かない", async () => {
    await renderScanned(false);

    let failEnsure!: (reason: string) => void;
    ensureEnginesDir.mockReturnValue(new Promise((_, reject) => (failEnsure = reject)));
    fireEvent.click(screen.getAllByRole("button", { name: "engines/ を作成" })[0]);

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue({ ...index(true), ai_root: "/Users/me/ai2" });
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      failEnsure("ai_root does not exist");
    });

    expect(screen.queryByText("ai_root does not exist")).toBeNull();
  });

  // 関門を強める方向へ動かしたときに、正常な経路が止まらないこと
  test("engines/ を作成したら、読み直して開けるようになる", async () => {
    const button = await renderScanned(false);
    expect(button.disabled).toBe(true);

    scanAiRoot.mockResolvedValue(index(true));
    fireEvent.click(screen.getAllByRole("button", { name: "engines/ を作成" })[0]);

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  // 失敗側だけ関門しても足りない。**成功して返る回**が普通の経路
  test("ルートを切り替えた後に返る作成の成功は、新しいルートの画面を壊さない", async () => {
    await renderScanned(false);

    let finishEnsure!: (path: string) => void;
    ensureEnginesDir.mockReturnValue(new Promise((r) => (finishEnsure = r)));
    fireEvent.click(screen.getAllByRole("button", { name: "engines/ を作成" })[0]);

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue({ ...index(true), ai_root: "/Users/me/ai2" });
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      finishEnsure("");
    });

    // 新しいルートの索引がそのまま残る（前のルートのスキャンで上書きしない）
    expect(screen.getByTitle("engines/ を開く")).toBeTruthy();
    expect((screen.getByTitle("engines/ を開く") as HTMLButtonElement).disabled).toBe(false);
  });

  /**
   * 作成の関門は、**成功と区別できる形**で返らないといけない。
   *
   * 畳んで `null`（成功）にすると、呼び出し元は打った名前を消す。
   * 旧ルートでは作られているかもしれないのに、新しいルートの一覧には出ないので、
   * 利用者には「打ち直したのに何も起きなかった」ようにしか見えない
   */
  test("作成の途中でルートを切り替えても、打った名前を消さない", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI名を入力"), { target: { value: "Suisho" } });

    let finishCreate!: (created: CreateResult) => void;
    createAiProfileDirs.mockReturnValue(new Promise((r) => (finishCreate = r)));
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue(indexWithEngine("/Users/me/ai2"));
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      finishCreate({ success: true, data: `${AI_ROOT}/Suisho` });
    });

    expect((screen.getByPlaceholderText("AI名を入力") as HTMLInputElement).value).toBe("Suisho");
    // 名前は悪くないので、欄も赤くしない。**空であることまで見る**——
    // `"stale"` を名前の失敗に畳むと、ここに `describeFsError` の文言が入る
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  /**
   * エンジンが0件の回。**入力欄が描かれないので、木も指示しない。**
   *
   * 指示すると、同じ画面でカードは「エンジンを置いた後に作成できます」と逆を言い、
   * 従って探しても作成口はどこにも無い
   */
  test("エンジンが0件なら、木は「AIフォルダを作成」と言わない", async () => {
    await renderScanned(true);

    expect(screen.queryByText("← AIフォルダを作成")).toBeNull();
    expect(screen.queryByPlaceholderText("AI名を入力")).toBeNull();
    expect(screen.getByText("エンジンを置いた後に作成できます")).toBeTruthy();
  });

  // 名前を直せば通る失敗は、欄のそばに出す（ADR-0004 の F-14）。打った文字列は残す
  test("名前の失敗は欄のそばに出て、打った名前は残る", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI名を入力"), { target: { value: "Suisho/A" } });
    createAiProfileDirs.mockResolvedValue({
      success: false,
      error: { code: "invalid_name_separator" },
    });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() =>
      expect(document.querySelector(".setupGuide__createError")?.textContent).toBe(
        "名前に / や \\ は使えません",
      ),
    );
    expect((screen.getByPlaceholderText("AI名を入力") as HTMLInputElement).value).toBe("Suisho/A");
    // 読み取りは成功しているので、スキャンの診断へは回さない
    expect(document.querySelector(".aiLibraryTab__error")).toBeNull();
  });

  test("作れたら、打った名前は消える", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI名を入力"), { target: { value: "Suisho" } });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() =>
      expect((screen.getByPlaceholderText("AI名を入力") as HTMLInputElement).value).toBe(""),
    );
  });

  /**
   * 宛先を失った回は、**欄の赤字も動かさない**。
   *
   * 赤字を消すのを `await` の前に置くと、この回は「前の失敗の赤字を消しただけ」で返る——
   * 直すべき理由だけが画面から消えて、直すべき文字列が残る
   */
  test("宛先を失っても、前の失敗の赤字は消さない", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    const input = screen.getByPlaceholderText("AI名を入力");
    fireEvent.change(input, { target: { value: "Suisho/A" } });
    createAiProfileDirs.mockResolvedValue({
      success: false,
      error: { code: "invalid_name_separator" },
    });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));
    await waitFor(() =>
      expect(document.querySelector(".setupGuide__createError")?.textContent).not.toBe(""),
    );

    // 名前を直さずにもう一度押し、その最中にルートを切り替える
    let finishCreate!: (created: CreateResult) => void;
    createAiProfileDirs.mockReturnValue(new Promise((r) => (finishCreate = r)));
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue(indexWithEngine("/Users/me/ai2"));
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      finishCreate({ success: true, data: `${AI_ROOT}/Suisho/A` });
    });

    expect(document.querySelector(".setupGuide__createError")?.textContent).toBe(
      "名前に / や \\ は使えません",
    );
  });

  /**
   * 宛先を失っても、**旧ルートで何が起きたかは分かっている**。
   *
   * 黙ると「失敗した」ようにしか見えず、もう一度押して新しいルートにもう1つ作ることになる
   */
  test("宛先を失った作成は、旧ルートでの結果を通知に出す", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI名を入力"), { target: { value: "Suisho" } });

    let finishCreate!: (created: CreateResult) => void;
    createAiProfileDirs.mockReturnValue(new Promise((r) => (finishCreate = r)));
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue(indexWithEngine("/Users/me/ai2"));
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      finishCreate({ success: true, data: `${AI_ROOT}/Suisho` });
    });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "info",
        presentation: "toast",
        autoDismiss: true,
        title: "前のフォルダに「Suisho」を作成しました",
        body: "切り替える前の AI ルートでの結果です",
        // 連打しても1枚に畳む。鍵にルートと名前が入っていないと別のフォルダの回まで畳む
        dedupeKey: `create-profile:${AI_ROOT}/Suisho`,
      }),
    );
  });

  /**
   * 落ちて返った回。**段まで同じにしない。**
   *
   * 6秒で消える通知で成功と失敗の差が題の末尾の1語だけになると、
   * 作れていないのに「作れた」と読んで先へ進み、どのルートにもそのフォルダが無い
   */
  test("宛先を失った作成が落ちていたら、段も文面も分ける", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI名を入力"), { target: { value: "Suisho" } });

    let finishCreate!: (created: CreateResult) => void;
    createAiProfileDirs.mockReturnValue(new Promise((r) => (finishCreate = r)));
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue(indexWithEngine("/Users/me/ai2"));
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      finishCreate({ success: false, error: { code: "already_exists" } });
    });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "warning",
        title: "前のフォルダに「Suisho」を作成できませんでした",
        body: "同じ名前で作り直せます",
      }),
    );
  });

  /**
   * 名前で落ちた回。**「同じ名前で作り直せます」は嘘になる。**
   *
   * 同じ名前では何度やっても通らないうえ、欄には「名前に / や \ は使えません」が
   * 残っている（宛先を失った回は赤字を動かさないので）——2つの文言が正面から食い違う
   */
  test("宛先を失った作成が名前で落ちていたら、本文で名前を直させる", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI名を入力"), { target: { value: "Suisho/A" } });

    let finishCreate!: (created: CreateResult) => void;
    createAiProfileDirs.mockReturnValue(new Promise((r) => (finishCreate = r)));
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue(indexWithEngine("/Users/me/ai2"));
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      finishCreate({ success: false, error: { code: "invalid_name_separator" } });
    });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "warning",
        body: "名前を直してから作り直してください",
      }),
    );
  });

  // 門番は `engines/` が使えるときだけ「配下に置いてください」と言う
  test("engines/ が在ってエンジンが0件なら、置き場を案内する", async () => {
    await renderScanned(true);

    expect(screen.getByText(/エンジン実行ファイルが未検出です/)).toBeTruthy();
  });

  test("engines がフォルダでなければ、その中へ置けとは言わない", async () => {
    await renderScanned(true, "file");

    expect(screen.queryByText(/エンジン実行ファイルが未検出です/)).toBeNull();
    // 出るのは外させるほうの一言だけ（hero と「検出された問題」の2箇所に出る）
    expect(screen.getAllByText(/engines がフォルダではありません/).length).toBeGreaterThan(0);
  });

  /**
   * 関門が**どこで更新されるか**を固定する。
   *
   * 関門を跨ぐ2本（「ルートを切り替えた後に返る作成の失敗は、画面に書かない」と
   * 「同 成功は、新しいルートの画面を壊さない」）は、間に `waitFor` を挟むので
   * レンダが走る。**位置で指さない**——テストを1本挿し込むだけで指す先が変わる。
   * `currentRootRef` をレンダで
   * 更新する形でもそれだけなら通る。選び直した直後に返る継続は**再レンダより先**に走るので、
   * レンダを1度も挟まずに関門できないと、その窓で前のルートの走査が新しい画面を上書きする
   */
  test("選び直しと作成が続けて返っても、前のルートでは読み直さない", async () => {
    await renderScanned(false);

    let finishEnsure!: (path: string) => void;
    ensureEnginesDir.mockReturnValue(new Promise((r) => (finishEnsure = r)));
    fireEvent.click(screen.getAllByRole("button", { name: "engines/ を作成" })[0]);

    let finishPick!: (picked: PickResult) => void;
    chooseAiRoot.mockImplementation(() => new Promise((r) => (finishPick = r)));
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(chooseAiRoot).toHaveBeenCalled());

    scanAiRoot.mockResolvedValue({ ...index(true), ai_root: "/Users/me/ai2" });

    // **間に `waitFor` を置かない。** 2つの継続を続けて走らせる
    await act(async () => {
      aiRootValue.current = "/Users/me/ai2";
      finishPick({ success: true, data: "/Users/me/ai2" });
      finishEnsure("");
    });

    // 初回のぶんを除くと、走ったのは新しいルートだけ
    expect(scanAiRoot.mock.calls.map(([root]) => root).slice(1)).toEqual(["/Users/me/ai2"]);
  });

  // 読み直しは指示なしにも走るので、古い要求の結果が後から届く並びが現実にある
  test("追い越されたスキャンの結果は捨てる", async () => {
    const button = await renderScanned(true);

    let resolveStale!: (index: AiRootIndex) => void;
    scanAiRoot.mockReturnValueOnce(new Promise((r) => (resolveStale = r)));
    fireEvent.click(scanButton());
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledTimes(2));

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue({ ...index(true), ai_root: "/Users/me/ai2" });
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      resolveStale(index(true));
    });

    expect(button.disabled).toBe(false);
  });

  /**
   * 追い越された要求は**落ちて返ることもある**（切り替える前のルートが消えていた回）。
   *
   * 成功側だけ関門すると、その `catch` が新しいルートの画面に
   * 「フォルダを確認できませんでした」を書き、`last` まで捨てて開く口を閉じる
   */
  test("追い越されたスキャンの失敗も捨てる", async () => {
    const button = await renderScanned(true);

    let rejectStale!: (reason: string) => void;
    scanAiRoot.mockReturnValueOnce(new Promise((_, reject) => (rejectStale = reject)));
    fireEvent.click(scanButton());
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledTimes(2));

    pickReturns("/Users/me/ai2");
    scanAiRoot.mockResolvedValue({ ...index(true), ai_root: "/Users/me/ai2" });
    fireEvent.click(screen.getByRole("button", { name: /選択/ }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith("/Users/me/ai2"));

    await act(async () => {
      rejectStale("ai_root does not exist");
    });

    expect(screen.queryByText("ai_root does not exist")).toBeNull();
    expect(button.disabled).toBe(false);
  });

  test("見せられなかったら通知に出る。本文にできない指示を書かない", async () => {
    revealInFileManager.mockResolvedValue({ success: false, error: "os error 2" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    fireEvent.click(await renderScanned(true));

    await waitFor(() => expect(notify).toHaveBeenCalled());
    const request = notify.mock.calls[0][0];

    expect(request).toMatchObject({ tier: "info", presentation: "toast", autoDismiss: true });
    // 連打しても1枚に畳まれること。鍵にパスが入っていないと別のフォルダの失敗まで畳む
    expect(request).toHaveProperty("dedupeKey", `reveal:${AI_ROOT}/engines`);
    // どのフォルダかは題で言う。本文は6秒で読み切れる1行に収める
    expect(request).toHaveProperty("title", "engines/を開けませんでした");

    const body = "body" in request ? (request.body ?? "") : "";
    expect(body.length).toBeLessThanOrEqual(40);
    // 無いフォルダを探させないこと。失敗の理由は環境で変わる
    expect(body).not.toContain("開いてください");
    // 内部の語もパスも本文に出さない
    expect(body).not.toContain("os error");
    expect(body).not.toContain(AI_ROOT);

    // 開けたはずのものが開けないなら索引が古い。読み直さないと、
    // 消えたフォルダを作り直す口が画面に出ない
    expect(scanAiRoot).toHaveBeenCalledTimes(2);

    // 画面に出さない代わりに、理由はログに残す
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("[AiLibraryTab]"),
      `${AI_ROOT}/engines`,
      "os error 2",
    );
    logged.mockRestore();
  });
});
