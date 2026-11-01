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

/** エンジンが1つ在る索引。エンジンが0件だと「AI フォルダを追加」の節は描かれない */
function indexWithEngine(root = AI_ROOT): AiRootIndex {
  return {
    ...index(true),
    ai_root: root,
    engines: [
      {
        entry: "YaneuraOu",
        path: `${root}/engines/YaneuraOu`,
        kind: "file",
        launchability: "ready",
      },
    ],
  };
}

/**
 * 手順書の「もう一度読み込む」。**どれでも同じ**——hero の副動作も Step 3 も Step 4 も
 * `onRescan` を呼ぶので、先頭を採る
 */
function scanButton() {
  return screen.getAllByRole("button", { name: "もう一度読み込む" })[0];
}

/**
 * スキャンが終わるまで待ち、**主カラムの**「engines/ を開く」を返す。
 *
 * 同じ名前のボタンは `SetupHero`（エンジンが0件のとき）と Step 3 にも出る。
 * `engines/` が在る回は3つとも描かれるので、名前だけでは引けない。
 * 節（`SSection`）は見出しで名前が付いているので、そこで絞る
 */
async function renderScanned(enginesDirExists: boolean, kind: FsKind = "dir") {
  scanAiRoot.mockResolvedValue(index(enginesDirExists, kind));
  render(<AiLibraryTab />);
  // **呼ばれたことではなく、結果が画面に入ったことを待つ。** 待たずに押すと、
  // まだ `loading` で塞がっているボタンを押して何も起きない回が混じる
  await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

  return within(screen.getByRole("region", { name: "AI ライブラリ" })).getByRole("button", {
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
        within(screen.getByRole("region", { name: "AI ライブラリ" })).getByRole("button", {
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
    // 0 回でも通るので、判定を壊す変異を1つも殺せない
    expect(scanAiRoot.mock.calls.map(([root]) => root).slice(1)).toEqual([
      "/Users/me/ai2",
      "/Users/me/ai2",
    ]);
  });

  /**
   * スキャン中に「まだ何も読めていない」と同じ画面へ落ちないこと。
   *
   * 進行中に索引を捨てると、開くボタンが押せなくなり、手順書の段が塞がり、
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
    // 外した後に「終わった」と言うボタン。無いと、実在しなくなったパスへの「開く」しか残らない
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
      within(screen.getByRole("region", { name: "AI ライブラリ" })).getByRole("button", {
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
   * 開くボタンまで押せなくなることになる
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
    // その回は入力欄も段も描かれていないので、探しても作成の操作が無い
    expect(screen.queryByText("← AI フォルダを作成")).toBeNull();
  });

  // `await` を跨ぐ呼び出しは他にもある。前のルートの失敗を新しいルートの画面に書かない
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

  // 判定を強める方向へ動かしたときに、正常な経路が止まらないこと
  test("engines/ を作成したら、読み直して開けるようになる", async () => {
    const button = await renderScanned(false);
    expect(button.disabled).toBe(true);

    scanAiRoot.mockResolvedValue(index(true));
    fireEvent.click(screen.getAllByRole("button", { name: "engines/ を作成" })[0]);

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  // 失敗側だけ判定しても足りない。**成功して返る回**が普通の経路
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
   * 作成の判定は、**成功と区別できる形**で返らないといけない。
   *
   * 畳んで `null`（成功）にすると、呼び出し元は打った名前を消す。
   * 旧ルートでは作られているかもしれないのに、新しいルートの一覧には出ないので、
   * 利用者には「打ち直したのに何も起きなかった」ようにしか見えない
   */
  test("作成の途中でルートを切り替えても、打った名前を消さない", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI 名を入力"), { target: { value: "Suisho" } });

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

    expect((screen.getByPlaceholderText("AI 名を入力") as HTMLInputElement).value).toBe("Suisho");
    // 名前は悪くないので、欄も赤くしない。**空であることまで見る**——
    // `"stale"` を名前の失敗に畳むと、ここに `describeFsError` の文言が入る
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  /**
   * エンジンが0件の回。**入力欄が描かれないので、木も指示しない。**
   *
   * 指示すると、同じ画面でカードは「エンジンを置いた後に作成できます」と逆を言い、
   * 従って探しても作成の操作はどこにも無い
   */
  test("エンジンが0件なら、木は「AIフォルダを作成」と言わない", async () => {
    await renderScanned(true);

    expect(screen.queryByText("← AI フォルダを作成")).toBeNull();
    expect(screen.queryByPlaceholderText("AI 名を入力")).toBeNull();
    expect(screen.getByText("エンジンを置いた後に作成できます")).toBeTruthy();
  });

  // 名前を直せば通る失敗は、欄のそばに出す（ADR-0004 の F-14）。打った文字列は残す
  test("名前の失敗は欄のそばに出て、打った名前は残る", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI 名を入力"), { target: { value: "Suisho/A" } });
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
    expect((screen.getByPlaceholderText("AI 名を入力") as HTMLInputElement).value).toBe("Suisho/A");
    // 読み取りは成功しているので、スキャンの診断へは回さない
    expect(document.querySelector(".aiLibraryTab__error")).toBeNull();
  });

  test("作れたら、打った名前は消える", async () => {
    scanAiRoot.mockResolvedValue(indexWithEngine());
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("AI 名を入力"), { target: { value: "Suisho" } });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() =>
      expect((screen.getByPlaceholderText("AI 名を入力") as HTMLInputElement).value).toBe(""),
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

    const input = screen.getByPlaceholderText("AI 名を入力");
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

    fireEvent.change(screen.getByPlaceholderText("AI 名を入力"), { target: { value: "Suisho" } });

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
        body: "切り替える前の AI ライブラリでの結果です",
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

    fireEvent.change(screen.getByPlaceholderText("AI 名を入力"), { target: { value: "Suisho" } });

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
        body: "同じ名前で作成し直せます",
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

    fireEvent.change(screen.getByPlaceholderText("AI 名を入力"), { target: { value: "Suisho/A" } });

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
        body: "名前を直してから作成し直してください",
      }),
    );
  });

  // `warnings` は `engines/` が使えるときだけ「配下に置いてください」と言う
  test("engines/ が在ってエンジンが0件なら、置き場を案内する", async () => {
    await renderScanned(true);

    expect(screen.getByText(/エンジン実行ファイルが未検出です/)).toBeTruthy();
  });

  // 置いたのが別の OS 向けだけなら、このマシンで使えるエンジンは0件
  test("別の OS 向けと読めないものしか無ければ、未検出と言う", async () => {
    scanAiRoot.mockResolvedValue({
      ...index(true),
      engines: [
        {
          entry: "YaneuraOu_AVX2.exe",
          path: `${AI_ROOT}/engines/YaneuraOu_AVX2.exe`,
          kind: "file",
          launchability: "wrongPlatform",
        },
        {
          entry: "locked/",
          path: `${AI_ROOT}/engines/locked`,
          kind: "dir",
          launchability: "unreadable",
        },
      ],
    });
    render(<AiLibraryTab />);
    await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());

    expect(screen.getByText(/エンジン実行ファイルが未検出です/)).toBeTruthy();
    expect(screen.queryByText("検出済み")).toBeNull();
  });

  test("engines がフォルダでなければ、その中へ置けとは言わない", async () => {
    await renderScanned(true, "file");

    expect(screen.queryByText(/エンジン実行ファイルが未検出です/)).toBeNull();
    // 出るのは外させるほうの一言だけ（hero と「検出された問題」の2箇所に出る）
    expect(screen.getAllByText(/engines がフォルダではありません/).length).toBeGreaterThan(0);
  });

  /**
   * `currentRootRef` をルートが変わる場所で書くこと。
   *
   * 作成の失敗と成功の2本は間に `waitFor` を挟むのでレンダが走り、レンダで書く形でも通る。
   * 選び直しの直後に返る継続は再レンダより先に走るので、そこで判定できないと前のルートの走査が
   * 新しい画面を上書きする
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
   * 成功側だけ判定すると、その `catch` が新しいルートの画面に
   * 「フォルダを確認できませんでした」を書き、`last` まで捨てて開くボタンを押せなくする
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
    // 消えたフォルダを作り直すボタンが画面に出ない
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

/** 主カラムのバッジの文字を読む。バッジの要素に役割が無いので class で引く */
function badgeText() {
  return document.querySelector(".aiLibraryTab__badge")?.textContent;
}

/** 手順書の先頭の「次にやること」の区画 */
function hero() {
  return within(document.querySelector<HTMLElement>(".setupGuide__hero")!);
}

function heroButtons() {
  return hero()
    .queryAllByRole("button")
    .map((button) => button.textContent);
}

/** 手順の段の状態。見出しの文字から段の枠へ上がって読む */
function stepState(title: string) {
  return screen.getByText(title).closest("[data-state]")?.getAttribute("data-state");
}

/** 状態のカードの文字。見出しから枠へ上がり、見出し・値・補足を1本で読む */
function statusCard(label: string) {
  const grid = within(document.querySelector<HTMLElement>(".setupGuide__statusGrid")!);
  const card = grid.getByText(label).closest<HTMLElement>("[data-state]")!;
  return { text: card.textContent, state: card.getAttribute("data-state") };
}

/** 「現在の状態」の木を、接続の罫線まで含めて行ごとに読む */
function treeLines() {
  return [...document.querySelectorAll(".structureOverview__node")].map((node) => node.textContent);
}

type FolderFiles = { evalFiles?: number; bookFiles?: number };

/** AI フォルダを1つ持つ索引。ファイルの数を変えて欠けを作る */
function indexWithFolder(name: string, { evalFiles = 1, bookFiles = 1 }: FolderFiles = {}) {
  const files = (dir: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      entry: `${i}.bin`,
      path: `${AI_ROOT}/${name}/${dir}/${i}.bin`,
      kind: "file" as const,
    }));
  return {
    ...indexWithEngine(),
    profiles: [
      {
        name,
        path: `${AI_ROOT}/${name}`,
        has_eval_dir: true,
        has_book_dir: true,
        eval_files: files("eval", evalFiles),
        book_db_files: files("book", bookFiles),
      },
    ],
  };
}

async function renderIndex(scanned: AiRootIndex) {
  scanAiRoot.mockResolvedValue(scanned);
  render(<AiLibraryTab />);
  await waitFor(() => expect(screen.queryByText("診断中…")).toBeNull());
}

describe("AI ライブラリタブのバッジ", () => {
  test("ルートが無ければ未設定で、走査しない", async () => {
    aiRootValue.current = "";
    render(<AiLibraryTab />);

    expect(badgeText()).toBe("未設定");
    expect(scanAiRoot).not.toHaveBeenCalled();
  });

  test("読んでいる間は診断中", () => {
    scanAiRoot.mockReturnValue(new Promise(() => {}));
    render(<AiLibraryTab />);

    expect(badgeText()).toBe("診断中…");
  });

  test("読めなければエラー", async () => {
    scanAiRoot.mockRejectedValue("読めません");
    render(<AiLibraryTab />);

    await waitFor(() => expect(badgeText()).toBe("エラー"));
  });

  test("注意が1つでもあれば注意あり", async () => {
    await renderIndex(indexWithFolder("Suisho", { bookFiles: 0 }));

    expect(badgeText()).toBe("注意あり");
  });

  test("注意が無ければ OK", async () => {
    await renderIndex(indexWithFolder("Suisho"));

    expect(badgeText()).toBe("OK");
  });
});

describe("AI ライブラリタブの「検出された問題」", () => {
  function warnings() {
    return [...document.querySelectorAll(".setupGuide__warningItem")].map((w) => w.textContent);
  }

  test("engines/ が無ければ作成を案内し、置き場の話はしない", async () => {
    await renderIndex(index(false));

    expect(warnings()).toEqual(["engines/ が見つかりません。『engines/ を作成』で生成できます。"]);
  });

  test("engines がフォルダでなければ、同じ名前のものを外させる", async () => {
    await renderIndex(index(true, "file"));

    expect(warnings()).toEqual([
      "engines がフォルダではありません。同じ名前のものを削除してください。",
    ]);
  });

  test("AI フォルダごとに、欠けているものを言う", async () => {
    await renderIndex(indexWithFolder("Suisho", { evalFiles: 0, bookFiles: 0 }));

    expect(warnings()).toEqual([
      "「Suisho」: 評価関数が未検出です（<AI 名>/eval に nn.bin 等）。",
      "「Suisho」: 定跡が未検出です（<AI 名>/book に .db）。",
    ]);
  });

  test("読み直している間は前の一覧を出さない", async () => {
    await renderIndex(index(true));
    expect(warnings()).toHaveLength(1);

    scanAiRoot.mockReturnValue(new Promise(() => {}));
    fireEvent.click(scanButton());

    expect(warnings()).toEqual([]);
  });
});

describe("AI ライブラリタブの「次にやること」", () => {
  test("ルートが無ければフォルダの選択を勧める", async () => {
    aiRootValue.current = "";
    chooseAiRoot.mockResolvedValue({ success: true, data: null });
    render(<AiLibraryTab />);

    expect(hero().getByText("AI ライブラリのフォルダを選択してください")).toBeTruthy();
    expect(heroButtons()).toEqual(["フォルダを選択…"]);

    fireEvent.click(hero().getByRole("button", { name: "フォルダを選択…" }));
    await waitFor(() => expect(chooseAiRoot).toHaveBeenCalledTimes(1));
  });

  test("読んでいる間はボタンを出さない", () => {
    scanAiRoot.mockReturnValue(new Promise(() => {}));
    render(<AiLibraryTab />);

    expect(hero().getByText("フォルダを確認しています")).toBeTruthy();
    expect(heroButtons()).toEqual([]);
  });

  test("読めなければ原因を出し、読み直しと選び直しを出す", async () => {
    scanAiRoot.mockRejectedValue(new Error("ルートがありません"));
    render(<AiLibraryTab />);

    await waitFor(() => expect(hero().getByText("ルートがありません")).toBeTruthy());
    expect(heroButtons()).toEqual(["もう一度読み込む", "選択…"]);

    scanAiRoot.mockClear();
    scanAiRoot.mockResolvedValue(index(true));
    fireEvent.click(hero().getByRole("button", { name: "もう一度読み込む" }));
    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith(AI_ROOT));
    await waitFor(() => expect(badgeText()).toBe("注意あり"));
  });

  test("engines がフォルダでなければ、開いて確かめさせる", async () => {
    await renderIndex(index(true, "symlink"));

    expect(hero().getByText("engines がフォルダではありません")).toBeTruthy();
    expect(heroButtons()).toEqual(["engines/ を開く", "もう一度読み込む"]);

    fireEvent.click(hero().getByRole("button", { name: "engines/ を開く" }));
    await waitFor(() => expect(revealInFileManager).toHaveBeenCalledWith(`${AI_ROOT}/engines`));
  });

  test("engines/ が無ければ作成を主にし、ルートを開けるようにする", async () => {
    await renderIndex(index(false));

    expect(hero().getByText("engines/ フォルダを作成してください")).toBeTruthy();
    expect(heroButtons()).toEqual(["engines/ を作成", "AI ライブラリを開く"]);

    fireEvent.click(hero().getByRole("button", { name: "AI ライブラリを開く" }));
    await waitFor(() => expect(revealInFileManager).toHaveBeenCalledWith(AI_ROOT));

    fireEvent.click(hero().getByRole("button", { name: "engines/ を作成" }));
    await waitFor(() => expect(ensureEnginesDir).toHaveBeenCalledWith(AI_ROOT));
  });

  test("エンジンが0件なら、置き場を開いて読み直させる", async () => {
    await renderIndex(index(true));

    expect(hero().getByText("エンジン実行ファイルを置いてください")).toBeTruthy();
    expect(heroButtons()).toEqual(["engines/ を開く", "もう一度読み込む"]);
  });

  test("AI フォルダが0件なら、名前の欄へ運ぶ", async () => {
    await renderIndex(indexWithEngine());

    expect(hero().getByText("AI フォルダを作成してください")).toBeTruthy();
    expect(heroButtons()).toEqual(["AI 名の入力へ"]);

    fireEvent.click(hero().getByRole("button", { name: "AI 名の入力へ" }));
    expect(document.activeElement).toBe(screen.getByPlaceholderText("AI 名を入力"));
  });

  test("評価関数の無い AI フォルダがあれば、その名前で置き場を言う", async () => {
    await renderIndex(indexWithFolder("Suisho", { evalFiles: 0 }));

    expect(hero().getByText("「Suisho」に評価関数を置いてください")).toBeTruthy();
    expect(heroButtons()).toEqual(["AI ライブラリを開く", "もう一度読み込む"]);
  });

  test("定跡だけが無くても、土台は完成と言う", async () => {
    await renderIndex(indexWithFolder("Suisho", { bookFiles: 0 }));

    expect(hero().getByText("セットアップの土台は完成しています")).toBeTruthy();
    expect(heroButtons()).toEqual(["もう一度読み込む"]);
  });
});

describe("AI ライブラリタブの手順", () => {
  const STEPS = [
    "AI ライブラリを選択",
    "engines/ フォルダを作成",
    "エンジン実行ファイルを配置",
    "評価関数・定跡を配置",
  ];

  function stepStates() {
    return STEPS.map(stepState);
  }

  test("ルートが無ければ1段目だけが開く", () => {
    aiRootValue.current = "";
    render(<AiLibraryTab />);

    expect(stepStates()).toEqual(["active", "locked", "locked", "locked"]);
  });

  test("engines/ が無ければ2段目が開く", async () => {
    await renderIndex(index(false));

    expect(stepStates()).toEqual(["done", "active", "locked", "locked"]);
  });

  test("engines がフォルダでなければ2段目も塞ぐ", async () => {
    await renderIndex(index(true, "file"));

    expect(stepStates()).toEqual(["done", "locked", "locked", "locked"]);
  });

  test("読めていなければ2段目も塞ぐ", async () => {
    scanAiRoot.mockRejectedValue("読めません");
    render(<AiLibraryTab />);
    await waitFor(() => expect(badgeText()).toBe("エラー"));

    expect(stepStates()).toEqual(["done", "locked", "locked", "locked"]);
  });

  test("エンジンも AI フォルダも0件なら3段目と4段目が注意になる", async () => {
    await renderIndex(index(true));

    expect(stepStates()).toEqual(["done", "done", "warn", "warn"]);
  });

  test("読み直している間は、注意を保留する", async () => {
    await renderIndex(index(true));

    scanAiRoot.mockReturnValue(new Promise(() => {}));
    fireEvent.click(scanButton());

    expect(stepStates()).toEqual(["done", "done", "active", "locked"]);
  });

  test("全部そろえば全段が済みで、数を添える", async () => {
    await renderIndex(indexWithFolder("Suisho"));

    expect(stepStates()).toEqual(["done", "done", "done", "done"]);
    expect(screen.getByText("engines/ 検出済み")).toBeTruthy();
    expect(screen.getByText("1 個検出")).toBeTruthy();
    expect(screen.getByText("1 個のAI検出")).toBeTruthy();
  });

  test("済んだ段は本文を畳み、読み直しのボタンは処理中に押せない", async () => {
    await renderIndex(index(true));

    expect(screen.queryByText("engines/ を作成")).toBeNull();

    scanAiRoot.mockReturnValue(new Promise(() => {}));
    fireEvent.click(scanButton());

    const buttons = screen.getAllByRole<HTMLButtonElement>("button", {
      name: "もう一度読み込む",
    });
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  test("主カラムの作成は読んでいる間は押せない", async () => {
    await renderIndex(index(false));
    const main = within(screen.getByRole("region", { name: "AI ライブラリ" }));

    ensureEnginesDir.mockReturnValue(new Promise(() => {}));
    fireEvent.click(main.getByRole("button", { name: "engines/ を作成" }));

    expect(
      (main.getByRole("button", { name: "engines/ を作成" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("AI ライブラリタブの状態のカード", () => {
  test("読めていない間は数を言い切らない", async () => {
    scanAiRoot.mockRejectedValue("読めません");
    render(<AiLibraryTab />);
    await waitFor(() => expect(badgeText()).toBe("エラー"));

    expect(statusCard("engines フォルダ")).toEqual({ text: "engines フォルダ—", state: "todo" });
    expect(statusCard("エンジン")).toEqual({ text: "エンジン—", state: "todo" });
    expect(statusCard("AI フォルダ")).toEqual({ text: "AI フォルダ—", state: "todo" });
  });

  test("ルートが無ければ未設定", () => {
    aiRootValue.current = "";
    render(<AiLibraryTab />);

    expect(statusCard("AI ライブラリ")).toEqual({ text: "AI ライブラリ未設定", state: "todo" });
  });

  test("engines/ の4つの状態を言い分ける", async () => {
    await renderIndex(index(false));
    expect(statusCard("engines フォルダ")).toEqual({
      text: `engines フォルダなし${AI_ROOT}/engines`,
      state: "warn",
    });
    cleanup();

    await renderIndex(index(true, "file"));
    expect(statusCard("engines フォルダ").text).toBe(
      `engines フォルダフォルダでない${AI_ROOT}/engines`,
    );
    expect(statusCard("engines フォルダ").state).toBe("warn");
    cleanup();

    await renderIndex(index(true));
    expect(statusCard("engines フォルダ")).toEqual({
      text: `engines フォルダあり${AI_ROOT}/engines`,
      state: "ok",
    });
  });

  test("エンジンが0件なら、置き場と、AI フォルダを作れる順番を言う", async () => {
    await renderIndex(index(true));

    expect(statusCard("エンジン")).toEqual({
      text: "エンジン0 件engines/ に置いてください",
      state: "warn",
    });
    expect(statusCard("AI フォルダ")).toEqual({
      text: "AI フォルダ0 件エンジンを置いた後に作成できます",
      state: "warn",
    });
  });

  test("エンジンがあれば AI フォルダは下の欄から作れると言う", async () => {
    await renderIndex(indexWithEngine());

    expect(statusCard("エンジン")).toEqual({ text: "エンジン1 件検出済み", state: "ok" });
    expect(statusCard("AI フォルダ").text).toBe("AI フォルダ0 件下のフォームから作成できます");
  });

  test("別の OS 向けと読めないものは数えない", async () => {
    await renderIndex({
      ...index(true),
      engines: [
        { entry: "win.exe", path: "/w", kind: "file", launchability: "wrongPlatform" },
        { entry: "bad", path: "/b", kind: "file", launchability: "unreadable" },
        { entry: "off", path: "/o", kind: "file", launchability: "notExecutable" },
      ],
    });

    expect(statusCard("エンジン").text).toContain("1 件");
    expect(treeLines()).toContain("└─ 🔧 off");
    expect(treeLines().join()).not.toContain("win.exe");
  });

  test("評価関数のある AI フォルダだけを数える", async () => {
    await renderIndex(indexWithFolder("Suisho", { evalFiles: 0 }));

    expect(statusCard("AI フォルダ")).toEqual({
      text: "AI フォルダ1 件評価関数あり 0 件",
      state: "ok",
    });
  });

  test("長いルートは末尾を残して詰める", async () => {
    const root = `/Users/me/${"d".repeat(40)}/ai`;
    aiRootValue.current = root;
    await renderIndex(index(true));

    const short = `…${root.slice(-31)}`;
    expect(statusCard("AI ライブラリ").text).toBe(`AI ライブラリ設定済み${short}`);
    expect(screen.getByText(short, { selector: ".setupGuide__stepSummary" })).toBeTruthy();
  });

  test("32文字ちょうどのルートは詰めない", async () => {
    const root = `/${"d".repeat(31)}`;
    aiRootValue.current = root;
    await renderIndex(index(true));

    expect(statusCard("AI ライブラリ").text).toBe(`AI ライブラリ設定済み${root}`);
  });
});

describe("AI ライブラリタブの「検出されたAI」", () => {
  test("定跡が無くても警告の色にしない", async () => {
    await renderIndex(indexWithFolder("Suisho", { bookFiles: 0 }));

    const list = within(screen.getByRole("region", { name: "検出されたAI" }));
    expect(list.getByText("Suisho")).toBeTruthy();
    expect(list.getByText(`${AI_ROOT}/Suisho`)).toBeTruthy();
    expect(list.getByText(/評価関数/).textContent).toBe("評価関数 あり");
    expect(list.getByText(/定跡/).textContent).toBe("定跡 未設定");
  });

  test("評価関数が無ければ不足と言う", async () => {
    await renderIndex(indexWithFolder("Suisho", { evalFiles: 0 }));

    const list = within(screen.getByRole("region", { name: "検出されたAI" }));
    expect(list.getByText(/評価関数/).textContent).toBe("評価関数 不足");
  });
});

describe("AI フォルダの作成の欄", () => {
  test("空の名前では呼ばず、作成のボタンも押せない", async () => {
    await renderIndex(indexWithEngine());
    const input = screen.getByPlaceholderText("AI 名を入力");

    expect((screen.getByRole("button", { name: "作成" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});

    expect(createAiProfileDirs).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  test("Enter で作り、名前の前後の空白は落として渡す", async () => {
    await renderIndex(indexWithEngine());
    const input = screen.getByPlaceholderText("AI 名を入力");

    fireEvent.change(input, { target: { value: " Suisho " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(createAiProfileDirs).toHaveBeenCalledWith(AI_ROOT, "Suisho"));
  });

  test("Enter 以外のキーでは作らない", async () => {
    await renderIndex(indexWithEngine());
    const input = screen.getByPlaceholderText("AI 名を入力");

    fireEvent.change(input, { target: { value: "Suisho" } });
    fireEvent.keyDown(input, { key: "a" });
    await act(async () => {});

    expect(createAiProfileDirs).not.toHaveBeenCalled();
  });

  test("作っている間の Enter の連打は1回に畳む", async () => {
    await renderIndex(indexWithEngine());
    const input = screen.getByPlaceholderText("AI 名を入力");
    createAiProfileDirs.mockReturnValue(new Promise(() => {}));

    fireEvent.change(input, { target: { value: "Suisho" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});

    expect(createAiProfileDirs).toHaveBeenCalledTimes(1);
  });

  test("打ち直すと前の赤字が消える", async () => {
    await renderIndex(indexWithEngine());
    const input = screen.getByPlaceholderText("AI 名を入力");
    createAiProfileDirs.mockResolvedValue({
      success: false,
      error: { code: "invalid_name_separator" },
    });

    fireEvent.change(input, { target: { value: "a/b" } });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));
    const createError = () => document.querySelector(".setupGuide__createError")?.textContent;
    await waitFor(() => expect(createError()).not.toBe(""));
    expect(input.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(input, { target: { value: "ab" } });
    expect(createError()).toBe("");
  });

  test("名前では直せない失敗は AI ライブラリの診断へ回す", async () => {
    await renderIndex(indexWithEngine());
    createAiProfileDirs.mockResolvedValue({ success: false, error: { code: "not_found" } });

    fireEvent.change(screen.getByPlaceholderText("AI 名を入力"), { target: { value: "Suisho" } });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() => expect(badgeText()).toBe("エラー"));
    expect(document.querySelector(".setupGuide__createError")?.textContent).toBe("");
    expect(notify).not.toHaveBeenCalled();
  });

  test("作れたらそのルートを読み直す", async () => {
    await renderIndex(indexWithEngine());
    scanAiRoot.mockClear();

    fireEvent.change(screen.getByPlaceholderText("AI 名を入力"), { target: { value: "Suisho" } });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() => expect(scanAiRoot).toHaveBeenCalledWith(AI_ROOT));
  });
});

describe("AI ライブラリタブのパス", () => {
  /**
   * 前後の空白は走査と作成でだけ落ちる。`copyText` へ寄せたときに、同じ値を渡す呼び手で
   * 空白を落として別のパスにした退行があったので、呼び手ごとの値を固定する
   */
  test("走査は空白を落とした値で、開くとコピーは表示のままの値で渡す", async () => {
    const root = ` ${AI_ROOT} `;
    aiRootValue.current = root;
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await renderIndex(index(true));
    expect(scanAiRoot).toHaveBeenCalledWith(AI_ROOT);

    const main = within(screen.getByRole("region", { name: "AI ライブラリ" }));
    fireEvent.click(main.getByRole("button", { name: "開く" }));
    await waitFor(() => expect(revealInFileManager).toHaveBeenCalledWith(root));

    fireEvent.click(main.getByTitle("パスをコピー"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(root));
  });

  test("ルートが無ければ開くとコピーは押せない", () => {
    aiRootValue.current = "";
    render(<AiLibraryTab />);
    const main = within(screen.getByRole("region", { name: "AI ライブラリ" }));

    expect((main.getByRole("button", { name: "開く" }) as HTMLButtonElement).disabled).toBe(true);
    expect((main.getByTitle("パスをコピー") as HTMLButtonElement).disabled).toBe(true);
  });

  test("開けなかったフォルダの名前を題に出し、鍵はパスごとに分ける", async () => {
    revealInFileManager.mockResolvedValue({ success: false, error: "no" });
    await renderIndex(index(true));
    const main = within(screen.getByRole("region", { name: "AI ライブラリ" }));

    fireEvent.click(main.getByRole("button", { name: "開く" }));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));

    expect(notify.mock.calls[0][0]).toMatchObject({
      title: "AI ライブラリを開けませんでした",
      dedupeKey: `reveal:${AI_ROOT}`,
    });
  });

  test("engines/ の作成が落ちたら、読めていた engines/ を残して診断に出す", async () => {
    await renderIndex(index(false));
    ensureEnginesDir.mockRejectedValue(new Error("作れません"));

    fireEvent.click(hero().getByRole("button", { name: "engines/ を作成" }));

    await waitFor(() => expect(badgeText()).toBe("エラー"));
    expect(statusCard("engines フォルダ").text).toContain("なし");
    expect(hero().getByText("作れません")).toBeTruthy();
  });
});
