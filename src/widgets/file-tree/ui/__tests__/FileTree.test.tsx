// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import type { FsError } from "@/entities/file-tree/api/error";

/**
 * ツリー取得の失敗とファイル操作の失敗は、どちらも同じ `state.error` に積まれる。
 * 固定したいのは「ツリーが残っているなら消さない」こと。消すとそこからの操作が
 * 全部できなくなり、復帰路まで失う（`docs/state-transitions/file-tree.md` の S3）。
 */

const stub = {
  fileTree: null as { path: string; name: string } | null,
  isLoading: false,
  error: null as FsError | null,
};

const clearError = vi.fn();

// 再読み込みの結果。テストごとに差し替える
let nextError: FsError | null = null;
// 状態を動かしたあと画面を描き直すための口。`mount()` が差し込む
let repaint: (() => void) | null = null;
// 読み込みの完了タイミングを握る。読み込み中の画面を観測するために要る
let release: (() => void) | null = null;

/**
 * 実物と同じ順序で state を動かす。
 *
 * `loadFileTree` は最初の `await` より前に同期で `loading` を dispatch し、
 * reducer の `loading` は `error` を `null` にする。静的なスタブにすると
 * この2つが起きないので、「押した瞬間に失敗表示が消える」という実物の挙動が
 * テストから見えなくなる。
 */
const refreshTree = vi.fn(async () => {
  stub.isLoading = true;
  stub.error = null;
  repaint?.();

  await new Promise<void>((resolve) => {
    release = resolve;
  });

  stub.isLoading = false;
  stub.error = nextError;
  repaint?.();

  return nextError ? ({ success: false, error: nextError } as const) : ({ success: true } as const);
});

vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({
    fileTree: stub.fileTree,
    isLoading: stub.isLoading,
    error: stub.error,
    menu: null,
    deleteNode: vi.fn(),
    moveNode: vi.fn(),
    closeContextMenu: vi.fn(),
    startInlineRename: vi.fn(),
    clearError,
    refreshTree,
  }),
}));

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: { root_dir: "/root" } }),
}));

const openModal = vi.fn();
vi.mock("@/shared/lib/router/useURLParams", () => ({
  useURLParams: () => ({ openModal, closeModal: vi.fn(), updateParams: vi.fn(), params: {} }),
}));

// ツリーが描かれたかだけを見たいので、中身は差し替える
vi.mock("../RootNode", () => ({
  default: ({ node }: { node: { name: string } }) => <div data-testid="tree">{node.name}</div>,
}));

const { default: FileTree } = await import("../FileTree");

const TREE = { path: "/root", name: "root" };
const IO_ERROR: FsError = { code: "io", message: "os error 5", path: "/root/a.kif" };
// 読み直しても結果が変わらない失敗。原因は権限や入力の側にある
const DENIED: FsError = { code: "permission_denied", message: "denied", path: "/root/a.kif" };
const BAD_NAME: FsError = {
  code: "invalid_name_separator",
  message: "name contains a path separator",
  path: "/root",
};

beforeEach(() => {
  stub.fileTree = null;
  stub.isLoading = false;
  stub.error = null;
  nextError = null;
  repaint = null;
  release = null;
  clearError.mockClear();
  refreshTree.mockClear();
  openModal.mockClear();
});

// globals を有効にしていないので自動 cleanup が効かない。
// Modal は body へ portal するため、消さないと次のテストに残る
afterEach(cleanup);

/** `refreshTree` が state を動かしたときに描き直せる形でマウントする。 */
function mount() {
  const view = render(<FileTree />);
  repaint = () => view.rerender(<FileTree />);
  return view;
}

/**
 * 通知の本文。`getByRole("alert").textContent` は畳んだ `<details>` の中身まで
 * 拾うので、「本文に出ているか」「本文に出ていないか」はこちらで見る。
 */
function noticeBody() {
  return Array.from(screen.getByRole("alert").querySelectorAll(".fsError__lead"))
    .map((el) => el.textContent ?? "")
    .join("\n");
}

/** 再読み込みを押す。読み込み中のまま返るので、途中の画面を検査できる。 */
async function startRetry() {
  await act(async () => {
    screen.getByRole("button", { name: "再読み込み" }).click();
  });
}

/** 読み込みを完了させる。 */
async function finishRetry() {
  await act(async () => {
    release?.();
    await Promise.resolve();
  });
}

describe("FileTree の失敗表示", () => {
  test("ファイル操作が失敗しても、ツリーは残る", () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    expect(screen.getByTestId("tree")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("読み書きに失敗しました");
  });

  test("失敗した対象のパスが出る", () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    expect(screen.getByRole("alert").textContent).toContain("/root/a.kif");
  });

  test("Rust の生メッセージは畳んだ中に置き、そのまま本文にしない", () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    const detail = screen.getByText("技術的な詳細").closest("details");
    expect(detail).toBeTruthy();
    expect(detail!.hasAttribute("open")).toBe(false);
    expect(detail!.textContent).toContain("os error 5");
    // 畳んだ中にあることだけを見ると、本文にも出す実装で緑のままになる
    expect(noticeBody()).not.toContain("os error 5");
  });

  test("ツリーがまだ無いときは、その場に失敗を出す", () => {
    stub.fileTree = null;
    stub.error = { code: "permission_denied", message: "denied" };

    render(<FileTree />);

    expect(screen.queryByTestId("tree")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("権限がありません");
    // 「ルートディレクトリを選択してください」を出すと、原因を取り違えさせる
    expect(screen.queryByText(/ルートディレクトリを選択/)).toBeNull();
  });

  test("再読み込みを押すと読み直す", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    mount();
    await startRetry();

    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  test("ツリーが残っているときは閉じられる", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    await act(async () => {
      screen.getByRole("button", { name: "閉じる" }).click();
    });

    expect(clearError).toHaveBeenCalledTimes(1);
  });

  test("ツリーが無いときは閉じるを出さない。閉じても何も出せない", () => {
    stub.fileTree = null;
    stub.error = IO_ERROR;

    render(<FileTree />);

    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeTruthy();
  });

  test("失敗が無ければ何も出さない", () => {
    stub.fileTree = TREE;
    stub.error = null;

    render(<FileTree />);

    expect(screen.getByTestId("tree")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * 復帰に何が要るかで見せ方を変える（ADR-0004）。
 * 読み直しても直らない失敗に「再読み込み」を出すと、利用者は押し続ける。
 */
describe("段による出し分け", () => {
  test("入力が原因の失敗では、何を直せばよいかが本文に出る", () => {
    stub.fileTree = TREE;
    stub.error = BAD_NAME;

    mount();

    // 原因ごとに code を分けてあるので、本文だけで直し方が分かる
    expect(noticeBody()).toContain("/");
  });

  test("入力が原因の失敗では、再読み込みを出さない", () => {
    stub.fileTree = TREE;
    stub.error = BAD_NAME;

    mount();

    expect(screen.queryByRole("button", { name: "再読み込み" })).toBeNull();
  });

  test("一時的かもしれない失敗では、再読み込みを出す", () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    mount();

    expect(screen.getByRole("button", { name: "再読み込み" })).toBeTruthy();
  });

  test("ツリーが読めないまま直らない失敗なら、ワークスペースを選び直せる", async () => {
    stub.fileTree = null;
    stub.error = DENIED;

    mount();

    // 読み直しても直らないので再読み込みは出ない。閉じる先のツリーも無い。
    // ここで導線が無いとサイドバーの中で行き止まりになる
    await act(async () => {
      screen.getByRole("button", { name: "ワークスペースを選び直す" }).click();
    });

    expect(openModal).toHaveBeenCalledWith("settings", { tab: "workspace" });
  });

  test("開発者向けのログは本文に出さない", () => {
    stub.fileTree = TREE;
    stub.error = BAD_NAME;

    mount();

    // message は Rust と provider が入れるログ。利用者向けの文は code から引く
    expect(noticeBody()).not.toContain("path separator");
    expect(screen.getByText("技術的な詳細").closest("details")!.textContent).toContain(
      "path separator",
    );
  });

  test("段は見た目にも出る", () => {
    stub.fileTree = TREE;
    stub.error = DENIED;

    mount();

    expect(screen.getByRole("alert").className).toContain("fsError--danger");
  });
});

/**
 * 読み込み中は `error` が `null` に戻る（reducer の `loading`）。
 * ここを素通しにすると、失敗表示もツリーも押した瞬間に消えて、
 * この変更が直したはずの症状が再読み込み経路だけで再発する。
 */
describe("再読み込みの最中", () => {
  test("読み込み中でもツリーは消えない", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    mount();
    await startRetry();

    expect(screen.getByTestId("tree")).toBeTruthy();
  });

  test("読み込み中も、何が失敗したかは出したままにする", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    mount();
    await startRetry();

    expect(screen.getByRole("alert").textContent).toContain("読み書きに失敗しました");
  });

  test("読み込み中はボタンがそう表示し、押せない", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    mount();
    await startRetry();

    const btn = screen.getByRole("button", { name: "読み込み中..." });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  test("読み込みが成功したら失敗表示は消える", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;
    nextError = null;

    mount();
    await startRetry();
    await finishRetry();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("tree")).toBeTruthy();
  });

  test("読み込みが失敗し続けても、もう一度押せる", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;
    nextError = IO_ERROR;

    mount();
    await startRetry();
    await finishRetry();

    const btn = screen.getByRole("button", { name: "再読み込み" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    await startRetry();
    expect(refreshTree).toHaveBeenCalledTimes(2);
  });

  test("読み直しても直らない失敗では、再読み込みを出さない", () => {
    stub.fileTree = TREE;
    stub.error = DENIED;

    mount();

    expect(screen.queryByRole("button", { name: "再読み込み" })).toBeNull();
  });

  test("ツリーがまだ無いときは、読み込み中に Spinner を出す", async () => {
    stub.fileTree = null;
    stub.error = IO_ERROR;

    mount();
    await startRetry();

    // ツリーが無いなら見せるものが無いので、読み込み中の表示に切り替わってよい
    expect(screen.queryByTestId("tree")).toBeNull();
  });
});
