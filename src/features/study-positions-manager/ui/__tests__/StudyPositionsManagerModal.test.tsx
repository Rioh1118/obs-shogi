// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { StudyPosition } from "@/entities/study-positions/model/types";

/**
 * 課題局面の一覧（`docs/spec/screens/study-positions.md`）。
 *
 * 絞り込みは状態、本文、タグの順に通し、タグの候補は本文までの結果から数える。
 * 選択は表示中の一覧に必ず1つあり、子の対話を開いている間は絞り込みを捨てない。
 */

const closeModal = vi.fn();
const openModal = vi.fn();
const params: { modal?: string; returnTo?: string } = {};

vi.mock(
  "@/shared/lib/router/useURLParams",
  () =>
    ({
      useURLParams: () =>
        ({ params, closeModal, openModal }) as unknown as ReturnType<
          typeof import("@/shared/lib/router/useURLParams").useURLParams
        >,
    }) satisfies typeof import("@/shared/lib/router/useURLParams"),
);

const deletePosition = vi.fn();
let positions: StudyPosition[] = [];

vi.mock("@/entities/study-positions/model/useStudyPositions", () => {
  const mocked = {
    useStudyPositions: () =>
      ({
        state: { positions, error: null },
        deletePosition,
      }) as unknown as ReturnType<
        typeof import("@/entities/study-positions/model/useStudyPositions").useStudyPositions
      >,
  };
  return mocked satisfies typeof import("@/entities/study-positions/model/useStudyPositions");
});

const { default: StudyPositionsManagerModal } = await import("../StudyPositionsManagerModal");

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const AFTER_76 = "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2";
const AFTER_34 = "lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL b - 3";

function position(
  over: Partial<StudyPosition> & Pick<StudyPosition, "id" | "sfen">,
): StudyPosition {
  return {
    label: "",
    description: "",
    state: "inbox",
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const KAKU = position({
  id: "kaku",
  sfen: HIRATE,
  label: "角換わり",
  description: "腰掛銀の急所",
  state: "active",
  tags: ["角換わり", "急所"],
  createdAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-01-03T00:00:00Z",
});
const YAGURA = position({
  id: "yagura",
  sfen: AFTER_76,
  label: "矢倉",
  description: "",
  state: "active",
  tags: ["矢倉", "急所"],
  createdAt: "2026-01-03T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const FURI = position({
  id: "furi",
  sfen: AFTER_34,
  label: "四間飛車",
  description: "",
  state: "done",
  tags: ["振り飛車"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
});

beforeEach(() => {
  params.modal = "study-positions";
  params.returnTo = undefined;
  positions = [KAKU, YAGURA, FURI];
  closeModal.mockReset();
  openModal.mockReset();
  deletePosition.mockReset();
});
afterEach(cleanup);

const list = () => screen.getByRole("listbox", { name: "課題局面一覧" });
const rowLabels = () =>
  within(list())
    .queryAllByRole("option")
    .map((row) => row.querySelector(".sp-list-item__label")?.textContent);
const selectedLabel = () =>
  within(list())
    .getAllByRole("option")
    .find((row) => row.getAttribute("aria-selected") === "true")
    ?.querySelector(".sp-list-item__label")?.textContent;
const detailTitle = () => document.querySelector(".sp-detail__label")?.textContent;
const searchInput = () => screen.getByPlaceholderText<HTMLInputElement>("ラベル・メモを検索");
const root = () => screen.getByRole("region", { name: "課題局面" });

function type(value: string) {
  fireEvent.change(searchInput(), { target: { value } });
}

function key(target: Element, k: string) {
  return fireEvent.keyDown(target, { key: k });
}

describe("StudyPositionsManagerModal", () => {
  test("開いていなければ何も描かない", () => {
    params.modal = undefined;
    render(<StudyPositionsManagerModal />);

    expect(document.querySelector(".sp-manager")).toBeNull();
  });

  test("既定は更新日の新しい順で、先頭を選ぶ", () => {
    render(<StudyPositionsManagerModal />);

    expect(rowLabels()).toEqual(["角換わり", "四間飛車", "矢倉"]);
    expect(selectedLabel()).toBe("角換わり");
    expect(detailTitle()).toBe("角換わり");
  });

  test("状態のタブは絞り込む前の件数を出し、押すとその状態だけにする", () => {
    render(<StudyPositionsManagerModal />);
    type("角");

    const tabs = screen.getByRole("tablist", { name: "研究状態" });
    const countOf = (name: string) =>
      within(tabs)
        .getAllByRole("tab")
        .find((t) => t.querySelector(".state-tab-nav__label")?.textContent === name)
        ?.querySelector(".state-tab-nav__count")?.textContent;
    expect(countOf("全て")).toBe("3");
    expect(countOf("研究中")).toBe("2");
    expect(countOf("完了")).toBe("1");
    expect(countOf("未整理")).toBe("0");

    type("");
    fireEvent.click(
      within(tabs)
        .getAllByRole("tab")
        .find((t) => t.textContent?.startsWith("完了"))!,
    );
    expect(rowLabels()).toEqual(["四間飛車"]);
  });

  test("本文の検索はラベル、メモ、タグを大文字小文字を区別せずに見る", () => {
    positions = [
      KAKU,
      position({ id: "en", sfen: AFTER_76, label: "Opening", updatedAt: "2026-01-02T00:00:00Z" }),
      FURI,
    ];
    render(<StudyPositionsManagerModal />);

    type("腰掛");
    expect(rowLabels()).toEqual(["角換わり"]);
    type("振り飛車");
    expect(rowLabels()).toEqual(["四間飛車"]);
    type("OPEN");
    expect(rowLabels()).toEqual(["Opening"]);
  });

  test("絞り込んだ件数は、状態で絞った件数に対して出す", () => {
    render(<StudyPositionsManagerModal />);
    const count = () => document.querySelector(".sp-manager__count")?.textContent;

    expect(count()).toBe("3件");
    type("急所");
    expect(count()).toBe("2件 / 3件中");
  });

  test("タグは全部を満たす局面だけに絞り、候補は本文の結果から数える", () => {
    render(<StudyPositionsManagerModal />);
    type("矢倉");
    fireEvent.click(screen.getByTitle("タグで絞り込む"));

    const section = (name: string) =>
      [...document.querySelectorAll<HTMLElement>(".tag-panel__section")].find(
        (s) => s.querySelector(".tag-panel__sectionLabel")?.textContent === name,
      );
    const chipsOf = (name: string) =>
      [...(section(name)?.querySelectorAll(".tag-panel__chip") ?? [])].map((c) => c.textContent);
    // 本文の結果（矢倉だけ）に多いタグ。よく使うタグは、その残りを全体から出す
    expect(chipsOf("現在の結果に多いタグ")).toEqual(["矢倉", "急所"]);
    expect(chipsOf("よく使うタグ")).toEqual(["角換わり", "振り飛車"]);

    fireEvent.click(within(section("現在の結果に多いタグ")!).getByRole("button", { name: "急所" }));
    type("");
    expect(rowLabels()).toEqual(["角換わり", "矢倉"]);
    // 本文を空にすると、候補は全体から数え直す。「急所」は2件で先頭に来る
    expect(chipsOf("現在の結果に多いタグ")[0]).toBe("急所");
    fireEvent.click(
      within(section("現在の結果に多いタグ")!).getByRole("button", { name: "角換わり" }),
    );
    expect(rowLabels()).toEqual(["角換わり"]);
    expect(document.querySelector(".sp-manager__filterBadge")?.textContent).toBe("2");
  });

  test("選んだタグは札で外せ、クリアで全部外れる", () => {
    render(<StudyPositionsManagerModal />);
    fireEvent.click(screen.getByTitle("タグで絞り込む"));
    fireEvent.click(screen.getAllByRole("button", { name: "急所" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "矢倉" })[0]);
    expect(rowLabels()).toEqual(["矢倉"]);

    fireEvent.click(screen.getByRole("button", { name: "矢倉を解除" }));
    expect(rowLabels()).toEqual(["角換わり", "矢倉"]);
    fireEvent.click(screen.getByRole("button", { name: "クリア" }));
    expect(rowLabels()).toEqual(["角換わり", "四間飛車", "矢倉"]);
  });

  test("タグの欄の Escape は、語があれば消し、無ければ枠を閉じる", () => {
    render(<StudyPositionsManagerModal />);
    fireEvent.click(screen.getByTitle("タグで絞り込む"));
    const input = screen.getByPlaceholderText("タグを検索");
    fireEvent.change(input, { target: { value: "急" } });

    expect(key(input, "Escape")).toBe(false);
    expect((input as HTMLInputElement).value).toBe("");
    expect(key(input, "Escape")).toBe(false);
    expect(document.querySelector(".tag-panel")).toBeNull();
  });

  test("並べ替えを選ぶと、その順に並べて一覧を閉じる", () => {
    render(<StudyPositionsManagerModal />);
    const pick = (label: string) => {
      fireEvent.click(document.querySelector(".sp-manager__sortTrigger")!);
      fireEvent.click(screen.getByRole("button", { name: label }));
    };

    pick("更新日↑");
    expect(rowLabels()).toEqual(["矢倉", "四間飛車", "角換わり"]);
    expect(document.querySelector(".sp-manager__sortMenu")).toBeNull();
    pick("作成日↓");
    expect(rowLabels()).toEqual(["矢倉", "角換わり", "四間飛車"]);
    pick("ラベル順");
    expect(rowLabels()).toEqual(
      [...rowLabels()].sort((a, b) => (a ?? "").localeCompare(b ?? "", "ja")),
    );
    expect(document.querySelector(".sp-manager__sortTrigger")?.textContent).toBe("ラベル順");
  });

  test("j / k と矢印で選択が動き、端で止まる", () => {
    render(<StudyPositionsManagerModal />);

    key(root(), "j");
    expect(selectedLabel()).toBe("四間飛車");
    key(root(), "ArrowDown");
    key(root(), "ArrowDown");
    expect(selectedLabel()).toBe("矢倉");
    key(root(), "k");
    expect(selectedLabel()).toBe("四間飛車");
    key(root(), "ArrowUp");
    key(root(), "ArrowUp");
    expect(selectedLabel()).toBe("角換わり");
  });

  test("入力欄の中では選択の鍵を扱わない", () => {
    render(<StudyPositionsManagerModal />);

    expect(key(searchInput(), "j")).toBe(true);
    expect(key(searchInput(), "ArrowDown")).toBe(true);
    expect(selectedLabel()).toBe("角換わり");
  });

  test("s と e は選んだ局面で検索と編集を開き、戻り先を一覧にする", () => {
    render(<StudyPositionsManagerModal />);
    key(root(), "j");

    expect(key(root(), "s")).toBe(false);
    expect(openModal).toHaveBeenLastCalledWith("position-search", {
      sfen: AFTER_34,
      returnTo: "study-positions",
    });
    expect(key(root(), "e")).toBe(false);
    expect(openModal).toHaveBeenLastCalledWith("study-position-save", {
      sfen: AFTER_34,
      returnTo: "study-positions",
    });
  });

  test("扱わない鍵は止めない", () => {
    render(<StudyPositionsManagerModal />);

    expect(key(root(), "x")).toBe(true);
    expect(openModal).not.toHaveBeenCalled();
  });

  test("詳細のボタンは選んだ局面で対話を開く", () => {
    render(<StudyPositionsManagerModal />);
    fireEvent.click(within(list()).getByText("矢倉"));

    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    expect(openModal).toHaveBeenLastCalledWith("study-position-save", {
      sfen: AFTER_76,
      returnTo: "study-positions",
    });
    fireEvent.click(screen.getByRole("button", { name: "棋譜を作成" }));
    expect(openModal).toHaveBeenLastCalledWith("sfen-kifu-create", {
      sfen: AFTER_76,
      returnTo: "study-positions",
    });
    fireEvent.click(screen.getByRole("button", { name: "局面検索" }));
    expect(openModal).toHaveBeenLastCalledWith("position-search", {
      sfen: AFTER_76,
      returnTo: "study-positions",
    });
  });

  test("選んでいた局面が絞り込みで消えたら、先頭へ寄せ直す", () => {
    render(<StudyPositionsManagerModal />);
    fireEvent.click(within(list()).getByText("矢倉"));

    type("角");
    expect(selectedLabel()).toBe("角換わり");
    expect(detailTitle()).toBe("角換わり");
  });

  test("検索の欄の Escape は、語があれば消して止め、無ければ対話を閉じる", () => {
    render(<StudyPositionsManagerModal />);
    type("角");

    key(searchInput(), "Escape");
    expect(searchInput().value).toBe("");
    expect(closeModal).not.toHaveBeenCalled();
    key(searchInput(), "Escape");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  test("検索の消すボタンは語を消し、欄へ焦点を戻す", () => {
    render(<StudyPositionsManagerModal />);
    type("角");

    fireEvent.click(screen.getByRole("button", { name: "検索クリア" }));
    expect(searchInput().value).toBe("");
    expect(document.activeElement).toBe(searchInput());
  });

  test("1件も無ければ保存の案内を出し、詳細は選ぶよう促す", () => {
    positions = [];
    render(<StudyPositionsManagerModal />);

    expect(screen.getByText("課題局面がまだ保存されていません")).toBeTruthy();
    expect(screen.getByText("局面を選択してください")).toBeTruthy();
    expect(screen.queryByText("この条件に一致する局面はありません")).toBeNull();
  });

  test("絞り込みで0件なら、条件をクリアで状態、本文、タグを全部外す", () => {
    render(<StudyPositionsManagerModal />);
    fireEvent.click(screen.getByTitle("タグで絞り込む"));
    fireEvent.click(screen.getAllByRole("button", { name: "急所" })[0]);
    fireEvent.click(
      within(screen.getByRole("tablist"))
        .getAllByRole("tab")
        .find((t) => t.textContent?.startsWith("研究中"))!,
    );
    type("存在しない");
    expect(screen.getByText("この条件に一致する局面はありません")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(rowLabels()).toEqual(["角換わり", "四間飛車", "矢倉"]);
    expect(searchInput().value).toBe("");
  });

  test("行は手番と手数を出し、タグは2つまでと残りの数を出す", () => {
    positions = [{ ...KAKU, sfen: AFTER_76, tags: ["a", "b", "c", "d"] }];
    render(<StudyPositionsManagerModal />);

    const row = within(list()).getByRole("option");
    expect(row.querySelector(".sp-list-item__meta")?.textContent).toBe("後手 2手目");
    expect([...row.querySelectorAll(".sp-list-item__tag")].map((t) => t.textContent)).toEqual([
      "#a",
      "#b",
    ]);
    expect(row.querySelector(".sp-list-item__tagMore")?.textContent).toBe("+2");
  });

  test("閉じたら絞り込みを捨てる", () => {
    const { rerender } = render(<StudyPositionsManagerModal />);
    type("角");

    params.modal = undefined;
    rerender(<StudyPositionsManagerModal />);
    params.modal = "study-positions";
    rerender(<StudyPositionsManagerModal />);

    expect(searchInput().value).toBe("");
    expect(rowLabels()).toEqual(["角換わり", "四間飛車", "矢倉"]);
  });

  test("子の対話を開いている間（戻り先が一覧）は絞り込みと選択を残す", () => {
    const { rerender } = render(<StudyPositionsManagerModal />);
    type("急所");
    key(root(), "j");

    params.modal = "study-position-save";
    params.returnTo = "study-positions";
    rerender(<StudyPositionsManagerModal />);
    expect(document.querySelector(".sp-manager")).toBeNull();
    params.modal = "study-positions";
    params.returnTo = undefined;
    rerender(<StudyPositionsManagerModal />);

    expect(searchInput().value).toBe("急所");
    expect(selectedLabel()).toBe("矢倉");
  });

  test("削除は確認してから、選んだ局面を消す", async () => {
    deletePosition.mockResolvedValue(undefined);
    render(<StudyPositionsManagerModal />);
    fireEvent.click(within(list()).getByText("矢倉"));

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByText("「矢倉」を削除しますか？")).toBeTruthy();
    expect(deletePosition).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    });
    expect(deletePosition).toHaveBeenCalledWith("yagura");
  });
});
