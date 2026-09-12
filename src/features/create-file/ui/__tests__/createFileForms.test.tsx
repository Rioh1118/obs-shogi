// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import type { FileTreeNode, FsError } from "@/entities/file-tree";
import * as parse from "@/entities/kifu/api/parse";

/**
 * インポートは、失敗を出す場所を自分で持つ。
 *
 * provider の `failToCaller` は衝突以外を積まない。フォームが `result.error` を
 * 捨てると失敗がどこにも出ず、押しても何も起きない画面になる。
 *
 * 組んだ局面から作る側は `features/position-editor` の `createForm.test.tsx`。
 */

const createNewFile = vi.fn();
const importKifuFile = vi.fn();

/** 保存先の一覧に要る欄だけを持つツリー。描画に要る `displayInfo` は使わない */
const dir = (name: string, path: string, children: FileTreeNode[] = []): FileTreeNode =>
  ({
    name,
    path,
    isDirectory: true,
    children,
    displayInfo: { iconType: "folder" },
  }) as FileTreeNode;

/**
 * ツリーは操作のたびに丸ごと読み直される（`loadFileTree`）ので、差し替えられる形で持つ。
 * **ファイルを見張る仕組みは無い** —— 入れ替わる口は、ツリーを触る操作と、
 * 開いたときの `dir=` が現在のツリーに無い場合。
 */
let fileTree: FileTreeNode = dir("root", "/root");

// 差し替えるのは実体の側。barrel は再 export なので、こちらを差し替えれば通る
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({ createNewFile, importKifuFile, fileTree }),
}));

const { default: KifuImportForm } = await import("../KifuImportForm");

const BAD_NAME: FsError = {
  code: "invalid_name_separator",
  message: "name contains a path separator",
  path: "/root",
};
const CONFLICT: FsError = {
  code: "already_exists",
  message: "destination already exists",
  path: "/root/a.kif",
};

// 読める最小の kif。インポートの送信条件（棋譜として読めたこと）を満たすために要る
const KIF_TEXT = "手数----指手---------消費時間--\n   1 ７六歩(77)   ( 0:00/00:00:00)\n";

/**
 * 読めずに投げるテキスト
 *
 * **ただの文章では投げない。** KIF / KI2 / CSA のインポータは指し手を1つも
 * 読み取れなくても空の record を返すので、`{` で始めて JKF として読ませる。
 */
const BROKEN_JKF = "{ これは JSON ではない";

const onCreated = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  createNewFile.mockReset();
  importKifuFile.mockReset();
  onCreated.mockReset();
  onCancel.mockReset();
  fileTree = dir("root", "/root");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function submitForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("form is not rendered");
  await act(async () => {
    fireEvent.submit(form);
  });
}

describe("KifuImportForm", () => {
  function fillImport() {
    typeInto("棋譜テキスト", KIF_TEXT);
    typeInto("ファイル名", "研究");
  }

  /**
   * 貼られた棋譜を読んだ結果の3状態（仕様書の「インポートタブ」の表）。
   *
   * **未入力では何も出さない。** 貼る前に「貼ってください」と言う場所は、
   * 貼る欄の placeholder が既に持っている。
   */
  describe("貼った棋譜を読んだ結果", () => {
    test("未入力なら何も出さない", () => {
      render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

      expect(screen.queryByText(/読めました/)).toBeNull();
      expect(screen.queryByText("棋譜として読めませんでした")).toBeNull();
    });

    test("読めたら、何として読んだかと手数を出す", () => {
      render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

      typeInto("棋譜テキスト", KIF_TEXT);

      expect(screen.getByText(/棋譜として読めました/)).toBeTruthy();
      expect(screen.getByText("kif ／ 1手")).toBeTruthy();
    });

    test("読めなかったら、段に載せて利用者向けの一文を見える位置に出す", () => {
      render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

      typeInto("棋譜テキスト", BROKEN_JKF);

      const notice = screen.getByText("棋譜として読めませんでした").closest(".notice");
      // 段は danger（同じテキストを貼り直しても直らない）。畳んだ中ではなく、
      // 見える位置に理由が出ていること
      expect(notice?.className).toContain("notice--danger");
      expect(notice?.textContent).toContain("解析に失敗");
      expect(document.querySelector("details")).toBeNull();
    });

    /**
     * 棋譜でない文章は**投げずに**「0手の棋譜」として返る
     * （`parseKifuStringToJKF` の doc）。投げなかったことを「読めた」と読むと、
     * 「読めました」と言い切ったうえで中身の無いファイルを作り、
     * 貼ったテキストごと器を閉じる。
     */
    test("棋譜でない文章は、読めなかったことにする", () => {
      render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

      typeInto("棋譜テキスト", "これは棋譜ではないただの文章です");

      expect(screen.getByText("棋譜として読めませんでした")).toBeTruthy();
      expect(screen.queryByText(/読めました/)).toBeNull();
    });

    test("指し手を1つも読み取れないものでは、作成を押せない", () => {
      render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

      typeInto("ファイル名", "研究");
      typeInto("棋譜テキスト", "これは棋譜ではないただの文章です");

      expect(screen.getByRole<HTMLButtonElement>("button", { name: /作成/ }).disabled).toBe(true);
    });

    /**
     * 判定が返す `cause` は開発者向け（tsshogi の英文）。**画面はそれを出さない。**
     * 代わりに、この入口で何をすればよいかをここが足す。
     */
    test("開発者向けの手掛かりは画面に出さず、この面の直し方を足す", () => {
      vi.spyOn(parse, "readKifuText").mockReturnValue({
        readable: false,
        message: "棋譜形式の判定に失敗しました。",
        cause: "RangeError: Maximum call stack size exceeded",
      });
      render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

      typeInto("棋譜テキスト", KIF_TEXT);

      const notice = screen.getByText("棋譜として読めませんでした").closest(".notice");
      expect(notice?.textContent).toContain("棋譜形式の判定に失敗しました。");
      expect(notice?.textContent).not.toContain("Maximum call stack");
      expect(notice?.textContent).toContain("貼り付けてください");
    });

    test("読めないうちは作成を押せない", () => {
      render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

      typeInto("ファイル名", "研究");
      typeInto("棋譜テキスト", BROKEN_JKF);

      expect(screen.getByRole<HTMLButtonElement>("button", { name: /作成/ }).disabled).toBe(true);
    });
  });

  test("インポートに失敗したら理由が出る", async () => {
    importKifuFile.mockResolvedValue({ success: false, error: BAD_NAME });
    render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

    fillImport();
    await submitForm();

    expect(importKifuFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText("名前に / や \\ は使えません")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });

  // 拡張子を落とすのは送るときだけ（`kifuFileName`）。打鍵のたびに落とすと、
  // `.kif` の `f` を打った瞬間に4文字消える
  test("拡張子まで打っても、打った文字は欄から消えない", () => {
    render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

    typeInto("ファイル名", "45角戦法.kif");

    expect(screen.getByLabelText<HTMLInputElement>("ファイル名").value).toBe("45角戦法.kif");
  });

  test("打った拡張子は二重に付かない", async () => {
    importKifuFile.mockResolvedValue({ success: true, data: "/root/45角戦法.kif" });
    render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

    typeInto("棋譜テキスト", KIF_TEXT);
    typeInto("ファイル名", "45角戦法.kif");
    await submitForm();

    expect(importKifuFile).toHaveBeenCalledWith("/root", "45角戦法.kif", expect.any(String));
  });

  /**
   * 状態遷移表の (I, X14)。
   *
   * `Select` は選択肢に無い値をプレースホルダで描くので、値だけ残すと
   * **画面が「選んでいない」と言っているのに消えたパスへ書きに行く**。
   */
  test("選んでいた保存先が消えたら、根へ戻す", async () => {
    importKifuFile.mockResolvedValue({ success: true, data: "/root/研究.kif" });
    fileTree = dir("root", "/root", [dir("角換わり", "/root/角換わり")]);
    const view = render(
      <KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root/角換わり" />,
    );
    // `collectDirs` は根を「/」、その下を根からの相対で名乗らせる
    expect(screen.getByLabelText("保存先").textContent).toBe("/角換わり");

    // ツリーを読み直したら、選んでいたフォルダだけが無くなっていた
    fileTree = dir("root", "/root");
    view.rerender(
      <KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root/角換わり" />,
    );

    expect(screen.getByLabelText("保存先").textContent).toBe("/");

    fillImport();
    await submitForm();
    expect(importKifuFile).toHaveBeenCalledWith("/root", "研究.kif", expect.any(String));
  });

  test("衝突は別名を選ぶ対話が引き取るので、フォーム側では出さない", async () => {
    importKifuFile.mockResolvedValue({ success: false, error: CONFLICT });
    render(<KifuImportForm onCreated={onCreated} onCancel={onCancel} dirPath="/root" />);

    fillImport();
    await submitForm();

    expect(importKifuFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("同じ名前のものが既にあります")).toBeNull();
  });
});
