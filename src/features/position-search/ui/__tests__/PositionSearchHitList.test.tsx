// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

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

function renderList(hits: PositionHit[]) {
  return render(
    <PositionSearchHitList
      hits={hits}
      activeIndex={0}
      onActiveIndexChange={() => {}}
      onAccept={() => {}}
      isSearching={false}
      error={null}
      resolveAbsPath={(h) => `/root/${h.cursor.tesuu}.kif`}
    />,
  );
}

afterEach(() => cleanup());

describe("PositionSearchHitList", () => {
  test("行の高さを決め打たない（カードがスロットからはみ出せる形を作らない）", () => {
    const { container } = renderList(HITS);

    const rows = [...container.querySelectorAll<HTMLElement>(".pos-search__rowWrap")];
    expect(rows.length).toBeGreaterThan(0);

    // 高さを決め打つと `react-window` が行の style に height を書く。
    // 実測に任せている限りここは空のまま
    for (const row of rows) {
      expect(row.style.height).toBe("");
    }
  });

  test("ヒットが無いときはカードを出さず、理由を1つだけ出す", () => {
    const { container, rerender } = renderList([]);
    expect(container.querySelectorAll(".pos-hit")).toHaveLength(0);

    rerender(
      <PositionSearchHitList
        hits={[]}
        activeIndex={0}
        onActiveIndexChange={() => {}}
        onAccept={() => {}}
        isSearching
        error={null}
        resolveAbsPath={() => null}
      />,
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});
