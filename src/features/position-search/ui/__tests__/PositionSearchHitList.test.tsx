// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { PositionHit } from "@/entities/search";
import PositionSearchHitList from "../PositionSearchHitList";

/**
 * 行は絶対配置で置かれるので、**スロットより背の高いカードは隣を押しのけず、覆う**。
 * スロットの高さを数値で決め打つと、その数値とカードの実寸を繋ぐものが何も無くなり、
 * 文字サイズや余白を動かしただけで重なりが戻る。
 *
 * ここで見ているのは「重なっていないこと」ではなく、**重なりようがない形になっていること**。
 * happy-dom はレイアウトを持たないので実寸は測れないが、
 * 高さを決め打つと `react-window` が行に `height` を書き込むので、そこは観測できる。
 */

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: { root_dir: "/root" } }),
}));

vi.mock("@/entities/game", () => ({
  useGame: () => ({ state: { loadedAbsPath: "/root/a.kif" } }),
}));

function hitAt(tesuu: number): PositionHit {
  return {
    fileId: tesuu,
    cursor: { tesuu, forkPointers: [] },
  } as unknown as PositionHit;
}

const HITS = Array.from({ length: 12 }, (_, i) => hitAt(i + 1));

function renderList(hits: PositionHit[], overrides: Partial<ListProps> = {}) {
  return render(
    <PositionSearchHitList
      hits={hits}
      activeIndex={0}
      onActiveIndexChange={() => {}}
      onAccept={() => {}}
      isSearching={false}
      error={null}
      resolveAbsPath={(h) => `/root/${h.cursor.tesuu}.kif`}
      hasQuery
      indexHealth="ok"
      sessionStale={false}
      {...overrides}
    />,
  );
}

type ListProps = ComponentProps<typeof PositionSearchHitList>;

afterEach(() => cleanup());

describe("PositionSearchHitList", () => {
  test("行の高さを決め打たない（カードがスロットからはみ出せる形を作らない）", () => {
    const { container } = renderList(HITS);

    // 行そのものがカード（`option`）。仮想リストの style は直接ここへ当たる
    const rows = [...container.querySelectorAll<HTMLElement>(".pos-hit")];
    expect(rows.length).toBeGreaterThan(0);

    // 高さを決め打つと `react-window` が行の style に height を書く。
    // 実測に任せている限りここは空のまま
    for (const row of rows) {
      expect(row.style.height).toBe("");
    }
  });

  /**
   * `listbox` と `option` のあいだに要素を挟むと、支援技術から見て option が
   * listbox の子でなくなり、件数も現在位置も伝わらない。仮想化で行が歯抜けになるぶん、
   * 位置は `aria-posinset` / `aria-setsize` が各行に持つ必要もある。
   */
  test("option が listbox の直接の子で、位置と総数を持つ", () => {
    const { container } = renderList(HITS);

    const listbox = container.querySelector<HTMLElement>('[role="listbox"]');
    expect(listbox).not.toBeNull();

    const options = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.length).toBeGreaterThan(1);

    for (const option of options) {
      expect(option.parentElement).toBe(listbox);
      expect(option.getAttribute("aria-setsize")).toBe(String(HITS.length));
      expect(option.getAttribute("aria-posinset")).not.toBeNull();
    }
  });

  test("Tab の止まり場は選択している行だけ", () => {
    const { container } = renderList(HITS, { activeIndex: 2 });

    const options = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    const tabbable = options.filter((o) => o.tabIndex === 0);

    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].getAttribute("aria-selected")).toBe("true");
  });

  /**
   * 焦点と選択が割れると、リングと面が別の行を指し、Enter で開くのは面のほうになる。
   * 読み上げは焦点を追うので、選択していない行を読む。
   */
  test("選択している行が焦点を持つ", () => {
    const { container } = renderList(HITS, { activeIndex: 3 });

    const options = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(document.activeElement).toBe(options[3]);
    expect(options[3].getAttribute("aria-selected")).toBe("true");
  });

  test("ヒットが無いときはカードを出さず、理由を1つだけ出す", () => {
    const { container } = renderList([], { isSearching: true });
    expect(container.querySelectorAll(".pos-hit")).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  /**
   * 結果はチャンクで届くので `isSearching` は一覧が育っている間ずっと真。
   * ここで行を殺すと、利用者から見ると「ずっと押せない」になる。
   */
  test("検索中でも、届いたヒットは選べる", () => {
    const onActiveIndexChange = vi.fn();
    const { container } = renderList(HITS, { isSearching: true, onActiveIndexChange });

    const cards = [...container.querySelectorAll<HTMLButtonElement>(".pos-hit")];
    expect(cards.length).toBeGreaterThan(1);
    expect(cards.some((c) => c.disabled)).toBe(false);

    fireEvent.click(cards[1]);
    expect(onActiveIndexChange).toHaveBeenCalledWith(1);
  });

  /**
   * 2打目の `click` と `dblclick` を並べているのは、ブラウザが実際にその順で出すから。
   * `dblclick` だけを撃つと、`click` を見ている実装が素通りして緑になる。
   *
   * 一覧は仮想化されているので、車輪で送ると**ポインタを動かさないまま**別の行が
   * 同じ場所へ来る。OS は打鍵間隔とポインタの移動だけを見るので2打目は
   * `detail: 2` で届き、`dblclick` は2打目が落ちた行に出る。
   */
  test("1打目と別の行に落ちた2打目では開かない（車輪で送ってから押した行）", () => {
    const onAccept = vi.fn();
    const onActiveIndexChange = vi.fn();
    // 1打目は行0に落ちて、行0が選ばれている
    const { container } = renderList(HITS, { activeIndex: 0, onAccept, onActiveIndexChange });

    const cards = [...container.querySelectorAll<HTMLButtonElement>(".pos-hit")];
    fireEvent.click(cards[3], { detail: 2 });
    fireEvent.dblClick(cards[3], { detail: 2 });

    expect(onAccept).not.toHaveBeenCalled();
    expect(onActiveIndexChange).toHaveBeenCalledWith(3);
  });

  test("2打とも同じ行なら開く", () => {
    const onAccept = vi.fn();
    // 1打目が選んだ行を、そのまま2打目が押す
    const { container } = renderList(HITS, { activeIndex: 3, onAccept });

    const cards = [...container.querySelectorAll<HTMLButtonElement>(".pos-hit")];
    fireEvent.click(cards[3], { detail: 2 });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(HITS[3]);
  });

  /**
   * 3打目まで数える。`detail === 2` だけを見ると、「行Aを押す → 行Bを押す →
   * 行Bをもう一度押す」で行Bのダブルクリックが取りこぼされる。
   */
  test("3打目でも、直前の打鍵と同じ行なら開く", () => {
    const onAccept = vi.fn();
    const { container } = renderList(HITS, { activeIndex: 3, onAccept });

    const cards = [...container.querySelectorAll<HTMLButtonElement>(".pos-hit")];
    fireEvent.click(cards[3], { detail: 3 });

    expect(onAccept).toHaveBeenCalledWith(HITS[3]);
  });

  test("1打目では開かない", () => {
    const onAccept = vi.fn();
    const { container } = renderList(HITS, { activeIndex: 3, onAccept });

    const cards = [...container.querySelectorAll<HTMLButtonElement>(".pos-hit")];
    fireEvent.click(cards[3], { detail: 1 });

    expect(onAccept).not.toHaveBeenCalled();
  });
});
