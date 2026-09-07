// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { GameProvider } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";
import type { NotifyRequest } from "@/shared/lib/notification/types";

/**
 * 盤に載せられなかったことを利用者へ届けるのはこの橋
 * （`failure-surfacing.md` の F-31 / #434）。
 *
 * **ツリーは構文として読めれば通す。** 盤に載るかは `loadGame` まで来ないと
 * 分からないので、ここが黙ると盤も棋譜一覧も前の棋譜のまま何も出ない。
 * `loadGame` は投げないので、**戻り値を捨てても型検査もレンダも通る**。
 */

const tree = {
  activeKifuPath: null as string | null,
  jkfData: null as JKFData | null,
  kifuFormat: "kif" as string | null,
};

const notify = vi.fn<(request: NotifyRequest) => void>();

// **毎回新しい参照を返す。** 同じオブジェクトを返すと、値を書き換えても React へ
// 伝わらず、棋譜を切り替える経路そのものがテストから書けなくなる
vi.mock("@/entities/file-tree", () => ({ useFileTree: () => ({ ...tree }) }));
vi.mock("@/shared/lib/notification/useNotifications", () => ({
  useNotify: () => ({ notify, dismiss: vi.fn(), dismissByKey: vi.fn() }),
}));

const { GameFileTreeBridge } = await import("../GameFileTreeBridge");

const OK: JKFData = { header: {}, moves: [{}] };

/** `game.md` の E16。`preset: "OTHER"` で `initial.data.board` が無い */
const UNLOADABLE = {
  header: {},
  initial: { preset: "OTHER" },
  moves: [{}],
} as unknown as JKFData;

// **毎回新しい要素を作る。** 同じ要素オブジェクトを渡し直すと React が
// サブツリーごと畳んでしまい、`rerender` しても橋が描き直されない
const app = () => (
  <GameProvider>
    <GameFileTreeBridge />
  </GameProvider>
);

async function mountWith(path: string | null, jkf: JKFData | null) {
  tree.activeKifuPath = path;
  tree.jkfData = jkf;

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(app());
  });

  /** ツリーが別の棋譜を開いた、を実物と同じ順序で起こす */
  return async (nextPath: string, nextJkf: JKFData) => {
    tree.activeKifuPath = nextPath;
    tree.jkfData = nextJkf;
    await act(async () => {
      view.rerender(app());
    });
  };
}

beforeEach(() => {
  notify.mockClear();
  tree.kifuFormat = "kif";
});

afterEach(() => cleanup());

describe("ツリーが開いた棋譜を盤に載せる橋", () => {
  test("盤に載せられなければ、どのファイルかを添えて出す", async () => {
    await mountWith("/ws/こわれた.kif", UNLOADABLE);

    expect(notify).toHaveBeenCalledTimes(1);
    const req = notify.mock.calls[0][0];
    expect(req.tier).toBe("danger");
    expect(req).toHaveProperty("presentation", "modal");
    // 見出しにファイル名が要る。開いた直後に出るとはいえ、どのファイルの話かは
    // 通知の中にしか無い
    expect(req).toHaveProperty("title", expect.stringContaining("こわれた.kif"));
  });

  /**
   * **段は `danger`。** 同じ棋譜をもう一度開いても同じ結果になるので、
   * `warning`（同じ操作をもう一度で直る見込みがある）にしてはいけない。
   */
  test("押しても直らないので、動作は付けない", async () => {
    await mountWith("/ws/こわれた.kif", UNLOADABLE);

    const req = notify.mock.calls[0][0];
    expect(req).not.toHaveProperty("actions", expect.anything());
  });

  /**
   * `danger` は動作を持たないので、**次に何をすればよいかを書けるのは本文だけ**
   * （`NotifyRequest` の `body` は「何をすれば直るか」）。
   * 起きたことだけを書くと、閉じたあと利用者は「壊れているらしい」までしか分からない。
   */
  test("本文に、次に何をすればよいかを書く", async () => {
    await mountWith("/ws/こわれた.kif", UNLOADABLE);

    expect(notify.mock.calls[0][0]).toHaveProperty(
      "body",
      expect.stringContaining("別の棋譜を選んで"),
    );
  });

  /**
   * **前の棋譜が残っていない回**（起動後いちばん最初に開いたファイルが壊れていた）でも
   * 同じ本文が出る。「盤には前の棋譜が残っています」と言い切ると、`WelcomeScreen` を
   * 見ている利用者が無い棋譜を探すことになる。
   */
  test("前の棋譜が無くても嘘にならない本文にする", async () => {
    await mountWith("/ws/こわれた.kif", UNLOADABLE);

    expect(notify.mock.calls[0][0]).toHaveProperty(
      "body",
      expect.stringContaining("残っている場合"),
    );
  });

  /**
   * 載せられなかった棋譜は押し直せる（`FileNode` の関門は盤とツリーの両方を見る）。
   * 押すたびに `openKifuNode` が新しい `jkfData` を作ってこの effect を撃ち直すので、
   * 鍵が無いと押した回数だけ同じ文言が積み上がる。
   */
  test("同じ棋譜で畳む鍵を持つ", async () => {
    await mountWith("/ws/こわれた.kif", UNLOADABLE);

    expect(notify.mock.calls[0][0]).toHaveProperty(
      "dedupeKey",
      expect.stringContaining("/ws/こわれた.kif"),
    );
  });

  test("盤に載せられたら何も出さない", async () => {
    await mountWith("/ws/a.kif", OK);

    expect(notify).not.toHaveBeenCalled();
  });

  test("開いている棋譜が無ければ何も出さない", async () => {
    await mountWith(null, null);

    expect(notify).not.toHaveBeenCalled();
  });

  /**
   * **#434 が実際に踏む筋。** 前の棋譜が載っている状態から、盤に載せられない棋譜へ
   * 切り替える。マウント時にしか出さない実装でも上の4本は緑になるので、
   * 切り替えを踏むのはここだけ。
   */
  test("載っている棋譜から載せられない棋譜へ切り替えたときに出す", async () => {
    const switchTo = await mountWith("/ws/a.kif", OK);
    expect(notify).not.toHaveBeenCalled();

    await switchTo("/ws/こわれた.kif", UNLOADABLE);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toHaveProperty(
      "title",
      expect.stringContaining("こわれた.kif"),
    );
  });

  /** 載せられなかった後で別の棋譜が載れば、そちらでは何も出さない */
  test("載せられなかった後に載る棋譜へ切り替えれば、それ以上出さない", async () => {
    const switchTo = await mountWith("/ws/こわれた.kif", UNLOADABLE);
    expect(notify).toHaveBeenCalledTimes(1);

    await switchTo("/ws/b.kif", OK);

    expect(notify).toHaveBeenCalledTimes(1);
  });
});
