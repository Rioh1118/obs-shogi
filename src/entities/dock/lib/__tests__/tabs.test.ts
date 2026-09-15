import { describe, expect, test, vi } from "vitest";
import type { DockViewType } from "@/shared/lib/router/useURLParams";

/**
 * ドックのタブ一覧と、いま出すビューの決め方。
 *
 * 表は `docs/state-transitions/dock-tabs.md`。ここが見るのは**綴りから一覧へ**と
 * **一覧の中から1枚へ**の2つで、部品の出し入れは `widgets/dock` 側の検査が見る。
 *
 * **名簿を差し替えて試す。** 実在するビューが解析1枚しか無いので、本物の名簿だけだと
 * 「外せるビューを外す」「既定では出さないビューを出す」がどちらも踏めない。
 */
const FAKE = vi.hoisted(() => [
  { key: "analysis", label: "解析", removable: false, defaultVisible: true },
  { key: "book", label: "定跡", removable: true, defaultVisible: true },
  { key: "engineLog", label: "エンジンログ", removable: true, defaultVisible: false },
]);

vi.mock("../../model/views", () => ({
  DOCK_VIEWS: FAKE,
  dockViewMeta: (key: string) => FAKE.find((v) => v.key === key),
  dockViewLabel: (key: string) => FAKE.find((v) => v.key === key)?.label ?? key,
}));

const { moveDockTab, resolveDockTabs, resolveDockView, resolveStartupTab, toggleDockTab } =
  await import("../tabs");

/** 名簿を差し替えているので、綴りは `DockViewType` の外にある。**取り繕うのはここだけ** */
const view = (key: string) => key as DockViewType;
const list = (...keys: string[]) => keys.map(view);

/**
 * 差し替えた名簿の顔ぶれ。**既定はこれを渡す** ——
 * 渡さない（＝知らなかった）形は、それだけを見る試験で扱う。
 */
const KNOWN = ["analysis", "book", "engineLog"];

describe("タブ一覧", () => {
  test("設定が無ければ、既定で出すことになっているものだけが並ぶ", () => {
    expect(resolveDockTabs(null, KNOWN)).toEqual(["analysis", "book"]);
  });

  test("設定の並び順のまま出す", () => {
    expect(resolveDockTabs(["book", "analysis"], KNOWN)).toEqual(["book", "analysis"]);
  });

  test("既定では出さないビューも、設定に在れば出す", () => {
    expect(resolveDockTabs(["analysis", "engineLog"], KNOWN)).toEqual(["analysis", "engineLog"]);
  });

  test("名簿に無い綴りは捨てる", () => {
    expect(resolveDockTabs(["analysis", "kifuGraph"], KNOWN)).toEqual(["analysis"]);
  });

  test("同じ綴りが2つ在っても1つにする", () => {
    expect(resolveDockTabs(["book", "book", "analysis"], KNOWN)).toEqual(["book", "analysis"]);
  });

  /**
   * **一覧に無いことは「外した」を意味しない。**
   *
   * 設定「表示」はチェックを1つ触っただけでもその時点の一覧を丸ごと書くので、
   * 新しいビューを名簿に足すと、**一度でも設定を触った利用者全員の一覧から漏れる。**
   * `removable: true` のビューは入れ直しの対象でもないので、永久に出ない。
   *
   * 出す口がそのビューの中にしか無ければ機能ごと到達できなくなり、
   * 始める口が外に在るビュー（対局）では、エンジンが起きて盤が独りでに動くのに
   * 進行も結果も「閉じる」も画面のどこにも無い、という状態になる。
   */
  test("選ぶ機会が無かったビューは、既定で出すものなら足す", () => {
    // `book` を知らなかったころの設定。**外したのではなく、まだ無かった**
    expect(resolveDockTabs(["analysis"], ["analysis", "engineLog"])).toEqual(["analysis", "book"]);
  });

  /** **この欄より前の版が書いた設定。** 何も知らなかったものとして扱う */
  test("知っていた顔ぶれが残っていなければ、既定で出すものを足す", () => {
    expect(resolveDockTabs(["analysis"], null)).toEqual(["analysis", "book"]);
  });

  /** **選ぶ機会があったなら、外した意思を尊重する。** 足し直さない */
  test("選べたのに入れなかったビューは足さない", () => {
    expect(resolveDockTabs(["analysis"], KNOWN)).toEqual(["analysis"]);
  });

  /** 既定で出さないビューは、知らなかったとしても勝手に出さない */
  test("既定で出さないビューは、知らなかったとしても足さない", () => {
    expect(resolveDockTabs(["analysis", "book"], [])).toEqual(["analysis", "book"]);
  });

  // ADR-0010 決定1。空のドックという状態を作らない
  test("外せないビューは、設定が落としていても入れ直す", () => {
    expect(resolveDockTabs(["book"], KNOWN)).toEqual(["book", "analysis"]);
    expect(resolveDockTabs([], KNOWN)).toEqual(["analysis"]);
  });
});

describe("いま出すビュー", () => {
  const tabs = list("analysis", "book");

  test("URL の綴りが最優先", () => {
    expect(resolveDockView(tabs, { fromUrl: "book", startupTab: "analysis" })).toBe("book");
  });

  test("URL が無ければ、起動時に開くと決めてあるタブ", () => {
    expect(resolveDockView(tabs, { startupTab: "book", lastTab: "analysis" })).toBe("book");
  });

  test("起動時のタブを決めていなければ、前回のもの", () => {
    expect(resolveDockView(tabs, { startupTab: null, lastTab: "book" })).toBe("book");
  });

  test("何も無ければ一覧の先頭", () => {
    expect(resolveDockView(tabs, {})).toBe("analysis");
  });

  // 一覧から外したタブが URL や設定に残っているだけで、タブ列に無いものが本体に出る
  test("一覧に無い綴りは、どの段でも飛ばす", () => {
    const only = list("analysis");

    expect(resolveDockView(only, { fromUrl: "book", startupTab: "book", lastTab: "book" })).toBe(
      "analysis",
    );
  });
});

describe("起動時に開くタブ", () => {
  const tabs = list("analysis", "book");

  test("一覧に在れば、その綴り", () => {
    expect(resolveStartupTab(tabs, "book")).toBe("book");
  });

  // 設定画面がこれを通さないと、一覧の外を指したまま「決めておく」を選んで見せる
  test("一覧に無い綴りは「前回のもの」に落ちる", () => {
    expect(resolveStartupTab(list("analysis"), "book")).toBeNull();
  });

  test("名簿に無い綴りも「前回のもの」に落ちる", () => {
    expect(resolveStartupTab(tabs, "kifuGraph")).toBeNull();
    expect(resolveStartupTab(tabs, null)).toBeNull();
  });
});

describe("一覧の出し入れ", () => {
  test("入っていないものは末尾に足す", () => {
    expect(toggleDockTab(list("analysis"), view("book"))).toEqual(["analysis", "book"]);
  });

  test("入っているものは外す", () => {
    expect(toggleDockTab(list("analysis", "book"), view("book"))).toEqual(["analysis"]);
  });

  // 契約は「**一覧に在る**外せないビューは外れない」。無い側は足す
  test("一覧に無ければ、外せないビューでも足す", () => {
    expect(toggleDockTab([], view("analysis"))).toEqual(["analysis"]);
  });

  test("外せないビューは外れない", () => {
    expect(toggleDockTab(list("analysis", "book"), view("analysis"))).toEqual(["analysis", "book"]);
  });
});

describe("並べ替え", () => {
  test("隣と入れ替える", () => {
    expect(moveDockTab(list("analysis", "book"), view("book"), -1)).toEqual(["book", "analysis"]);
    expect(moveDockTab(list("analysis", "book"), view("analysis"), 1)).toEqual([
      "book",
      "analysis",
    ]);
  });

  test("端で押しても動かない", () => {
    expect(moveDockTab(list("analysis", "book"), view("analysis"), -1)).toEqual([
      "analysis",
      "book",
    ]);
    expect(moveDockTab(list("analysis", "book"), view("book"), 1)).toEqual(["analysis", "book"]);
  });
});
