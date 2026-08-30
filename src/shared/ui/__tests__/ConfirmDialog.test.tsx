// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConfirmDialog from "../ConfirmDialog";

/**
 * 取り消せない操作の最後の関門（ADR-0004 決定8）。
 *
 * ここが嘘をつくと、利用者は「止めた」「やめた」と信じたまま、
 * 棋譜ファイルが書き換わったことに気づかない。
 */

afterEach(cleanup);

function open(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  return render(
    <ConfirmDialog
      title="変化1を削除しますか？"
      onConfirm={props.onConfirm ?? (() => {})}
      onCancel={props.onCancel ?? (() => {})}
      {...props}
    />,
  );
}

describe("実行中", () => {
  /**
   * **走っている書き込みを止める経路は無い。** `onCancel` はどの呼び出し元でも
   * 確認を閉じるだけで、削除はそのまま完了してファイルも書き換わる。
   * 「キャンセル」のまま出すと、押した人は止めたと信じて閉じる。
   */
  it("キャンセルではなく「閉じる」と書く", () => {
    open({ isLoading: true });

    expect(screen.queryByText("キャンセル")).toBeNull();
    expect(screen.getByText("閉じる")).toBeTruthy();
    expect(screen.getByText("閉じても、この操作は続きます。")).toBeTruthy();
  });

  it("閉じる道は塞がない", () => {
    // 書き込みが返ってこないとき（ネットワーク越しのワークスペース、
    // 他プロセスが掴んでいる）に塞ぐと、出口ゼロの行き止まりになる
    const onCancel = vi.fn();
    open({ isLoading: true, onCancel });

    screen.getByText("閉じる").click();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("失敗したあと", () => {
  // 失敗の間に棋譜が変わっていると、同じ指定が**別のもの**を指す
  // （分岐の削除では隣の変化が消える）。確認を閉じて選び直させる。
  it("実行ボタンを押せなくする", () => {
    const onConfirm = vi.fn();
    open({ error: "Permission denied (os error 13)", onConfirm });

    const button = screen.getByText("削除する").closest("button")!;
    expect(button.disabled).toBe(true);

    button.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("理由を確認文の続きではなく独立した箱で出す", () => {
    open({ subtitle: "3手が消えます。", error: "Permission denied (os error 13)" });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("実行できませんでした。");
    expect(alert.textContent).toContain("Permission denied (os error 13)");
    expect(alert.textContent).not.toContain("3手が消えます。");
  });
});
