// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { useGame } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuFormat } from "@/entities/kifu/model/kifu";
import { Ok } from "@/shared/lib/result";

/**
 * **開いている棋譜を改名・移動しても、盤は載せ直さない。**
 *
 * ツリーは改名で `jkfData` を持ち越して `activeKifuPath` だけを張り替える。
 * その `jkfData` は**開いた時点の内容**なので、そこで載せ直すと盤・棋譜一覧・
 * カーソル・分岐の選択がその時点まで巻き戻り、次の1手で間の編集が消える。
 *
 * ここは橋だけでなく `GamePersistenceGate` ごと組む。**保存先の門番
 * （`persistIfPossible` の `absPath !== loadedAbsPath`）まで通さないと、
 * 「巻き戻らない」だけを見て「改名した先へ書ける」を落とす**——宛先を据え置く
 * 直し方でも巻き戻りは消えるが、以後の書き込みが全部止まる。
 */

const tree = {
  activeKifuPath: null as string | null,
  jkfData: null as JKFData | null,
  kifuFormat: "kif" as KifuFormat | null,
};

const written: { path: string; jkf: JKFData }[] = [];
const notify = vi.fn();

vi.mock("@/entities/file-tree", () => ({ useFileTree: () => tree }));
vi.mock("@/shared/lib/notification/useNotifications", () => ({
  useNotify: () => ({ notify, dismiss: vi.fn(), dismissByKey: vi.fn() }),
}));
vi.mock("@/entities/kifu/api/write", () => ({
  saveKifuToFile: (jkf: JKFData, filePath: string) => {
    written.push({ path: filePath, jkf });
    return Promise.resolve(Ok(undefined));
  },
}));

const { GamePersistenceGate } = await import("@/app/providers/gates/GamePersistenceGate");

/** 3手ぶんの枠。中身は見ないので指し手は要らない（コメントで編集を作る） */
const opened = (): JKFData => ({ header: {}, moves: [{}, {}, {}] });

/** 盤に載せられない棋譜（`game.md` の E16）。`preset: "OTHER"` で `initial.data.board` が無い */
const UNLOADABLE = {
  header: {},
  initial: { preset: "OTHER" },
  moves: [{}],
} as unknown as JKFData;

let game!: ReturnType<typeof useGame>;

function Harness() {
  game = useGame();
  return null;
}

/**
 * **要素は毎回作り直す。** 同じ要素オブジェクトを `rerender` に渡すと React が
 * 部分木ごと描き直しを飛ばすので、`tree` を書き換えても橋に届かない。
 */
const app = () => (
  <GamePersistenceGate>
    <Harness />
  </GamePersistenceGate>
);

/**
 * いま見ている手にコメントを1つ書く。**成否は必ず呼び出し側で見ること**——
 * `setCommentsByCursor` は投げないので、書けていなくても次の行へ進む。
 * 前提のつもりで書いた編集が落ちていると、`written` を見る assertion が
 * 「消えていない」を通してしまう。
 */
async function writeComment(text: string) {
  return await game.setCommentsByCursor(game.state.cursor!, [text]);
}

/** ツリーが棋譜を開いた状態から始める */
async function openKifu(path: string, jkf: JKFData) {
  tree.activeKifuPath = path;
  tree.jkfData = jkf;

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(app());
  });
  expect(game.state.loadedAbsPath, `前提の読み込みが失敗した: ${path}`).toBe(path);
  return view;
}

/**
 * 改名・移動を実物と同じ形で起こす。**`jkfData` は持ち越す**——
 * `active_kifu_reconciled` が `?? state.jkfData` で据え置くため。
 */
async function renameTo(view: ReturnType<typeof render>, nextPath: string) {
  tree.activeKifuPath = nextPath;
  await act(async () => {
    view.rerender(app());
  });
}

beforeEach(() => {
  tree.activeKifuPath = null;
  tree.jkfData = null;
  tree.kifuFormat = "kif";
  written.length = 0;
  notify.mockClear();
});

afterEach(() => cleanup());

describe("開いている棋譜の改名・移動", () => {
  test("宛先だけが新しいパスへ移る", async () => {
    const view = await openKifu("/ws/a.kif", opened());

    await renameTo(view, "/ws/b.kif");

    expect(game.state.loadedAbsPath).toBe("/ws/b.kif");
  });

  /**
   * **利用者から見た症状はこれ。** 50手目を見ていたなら 50手ぶん戻る。
   * 載せ直すと `loadGame` が `ROOT_CURSOR` で `game_loaded` を撃つため。
   */
  test("見ている手数が戻らない", async () => {
    const view = await openKifu("/ws/a.kif", opened());
    await act(async () => {
      game.nextMove();
    });
    await act(async () => {
      game.nextMove();
    });
    expect(game.state.cursor?.tesuu).toBe(2);

    await renameTo(view, "/ws/b.kif");

    expect(game.state.cursor?.tesuu).toBe(2);
  });

  /**
   * **改名の前に書いた編集が、盤から消えない。**
   *
   * ツリーが持つ `jkfData` は開いた時点のままで、編集はディスクと `state.jkf` にしか
   * 無い（`file-tree.state.jkfData` を保存で更新する経路は無い → #204）。
   * そこで載せ直すと、盤だけが編集前へ戻る。
   */
  test("改名の前に書いた編集が盤に残る", async () => {
    const view = await openKifu("/ws/a.kif", opened());
    await act(async () => {
      expect((await writeComment("改名前のメモ")).success, "前提の書き込みが失敗した").toBe(true);
    });

    await renameTo(view, "/ws/b.kif");

    expect(game.getCommentsByCursor(game.state.cursor!)).toEqual(["改名前のメモ"]);
  });

  /**
   * **失われ方の本体はここ。** 盤が編集前へ戻ったあと1手でも書くと、
   * 戻った内容が新しいパスへ保存されて**ディスクの編集まで消える**。
   * 利用者から見ると「保存したはずの手が消えている」なのでやり直そうとし、
   * その操作自体が上書きの引き金になる。
   */
  test("改名のあとに書いても、改名の前の編集を落とした内容を保存しない", async () => {
    const view = await openKifu("/ws/a.kif", opened());
    await act(async () => {
      expect((await writeComment("改名前のメモ")).success, "前提の書き込みが失敗した").toBe(true);
    });

    await renameTo(view, "/ws/b.kif");
    await act(async () => {
      game.nextMove();
    });
    await act(async () => {
      expect((await writeComment("改名後のメモ")).success).toBe(true);
    });

    const last = written[written.length - 1];
    expect(last?.path).toBe("/ws/b.kif");
    expect(last?.jkf.moves[0]?.comments).toEqual(["改名前のメモ"]);
    expect(last?.jkf.moves[1]?.comments).toEqual(["改名後のメモ"]);
  });

  /**
   * **宛先を据え置く直し方を落とす。** `persistence.absPath` は新しいパスで
   * 組み直されるので、`loadedAbsPath` が古いままだと門番の突き合わせが
   * 二度と一致せず、改名した棋譜への書き込みが全部止まる。
   */
  test("改名した先へ書ける", async () => {
    const view = await openKifu("/ws/a.kif", opened());

    await renameTo(view, "/ws/移動先/a.kif");
    await act(async () => {
      expect((await writeComment("メモ")).success).toBe(true);
    });

    expect(written.map((w) => w.path)).toEqual(["/ws/移動先/a.kif"]);
  });

  /**
   * **畳んでよいのは同じ `jkfData` のときだけ。** 参照ではなく「パスが変わったか」で
   * 判断すると、別の棋譜を開いても盤が前の棋譜のまま残る。
   */
  test("別の棋譜を開いたときは載せ直す", async () => {
    const view = await openKifu("/ws/a.kif", opened());
    await act(async () => {
      game.nextMove();
    });

    tree.activeKifuPath = "/ws/b.kif";
    tree.jkfData = { header: {}, moves: [{}, { comments: ["b の手"] }] };
    await act(async () => {
      view.rerender(app());
    });

    expect(game.state.loadedAbsPath).toBe("/ws/b.kif");
    expect(game.state.cursor?.tesuu).toBe(0);
    expect(game.state.jkf?.moves[1]?.comments).toEqual(["b の手"]);
  });

  /**
   * **盤に載らなかった棋譜を改名しても、宛先は動かさない。**
   *
   * 載せられなかった回は `activeKifuPath` だけが進み、盤には前の棋譜が残る
   * （`game.md` の E16）。そこで宛先だけを張り替えると門番の突き合わせが通り、
   * **前の棋譜が、改名した壊れたファイルへ書き込まれる。**
   */
  test("盤に載らなかった棋譜を改名しても、前の棋譜の宛先は動かない", async () => {
    const view = await openKifu("/ws/a.kif", opened());

    tree.activeKifuPath = "/ws/こわれた.kif";
    tree.jkfData = UNLOADABLE;
    await act(async () => {
      view.rerender(app());
    });
    expect(game.state.loadedAbsPath).toBe("/ws/a.kif");

    await renameTo(view, "/ws/こわれた2.kif");

    expect(game.state.loadedAbsPath).toBe("/ws/a.kif");

    await act(async () => {
      // 門番が止めるので Err。ここが Ok になったら、前の棋譜が改名先へ入っている
      expect((await writeComment("メモ")).success).toBe(false);
    });
    expect(written).toEqual([]);
  });
});
