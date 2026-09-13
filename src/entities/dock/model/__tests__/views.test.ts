import { describe, expect, test } from "vitest";
import { DOCK_VIEWS } from "../views";

/**
 * **本物の名簿に当てる。** 一覧と解決の検査（`lib/__tests__/tabs.test.ts`）は
 * 名簿を差し替えるので、実在するビューの素性はそこでは1つも見ていない。
 */
describe("ドックのビューの名簿", () => {
  /**
   * `resolveDockTabs` は「返る一覧は必ず1枚以上ある」と名乗り、`resolveDockView` は
   * その前提で `tabs[0]` を返す。**`noUncheckedIndexedAccess` が無いので tsc は止めない。**
   *
   * 全部を外せる名簿では、設定に `dock_tabs: []` を持っている利用者の画面で
   * `undefined` がビューの綴りとして返り、`Dock` の分割代入が落ちる ——
   * **ドックの境界の外**なので、畳まれるのは作業画面ごと。設定に残るので開き直しても同じ。
   */
  test("外せないビューが1枚以上ある", () => {
    expect(DOCK_VIEWS.some((view) => !view.removable)).toBe(true);
  });

  /** 既定で出すものが1枚も無いと、設定を持たない利用者のドックが空になる */
  test("既定で出すビューが1枚以上ある", () => {
    expect(DOCK_VIEWS.some((view) => view.defaultVisible)).toBe(true);
  });

  test("綴りが重複していない", () => {
    const keys = DOCK_VIEWS.map((view) => view.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
