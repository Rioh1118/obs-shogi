// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GameProvider } from "../provider";
import { useGame } from "../useGame";
import type { GamePersistence } from "../types";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { Ok, type AsyncResult } from "@/shared/lib/result";
import { branchGenerationOf } from "@/entities/kifu/lib/branchGeneration";
import { branchIndexFromForkIndex } from "@/entities/kifu/model/branch";

/**
 * 書き込みは `persistIfPossible` で1列に流す。Rust 側は並行に走らせるので、
 * 順に流さないと**後に着地したほうが勝つ**（コメントの保存が分岐の削除を取り消す）。
 *
 * 列にすると「撃った時点」と「走る時点」が離れる。そこが**このブランチで
 * 最も高くついた取り違え**なので、宛先の固定をテストで押さえる。
 */

type Handle = { save: (jkf: JKFData) => AsyncResult<void, string>; release: () => void };

/** `save` を手で握れる保存先。返すのは呼び出し側 */
function makePersistence(
  absPath: string,
  written: { path: string; jkf: JKFData }[],
): {
  persistence: GamePersistence;
  pending: Handle[];
} {
  const pending: Handle[] = [];
  const persistence: GamePersistence = {
    absPath,
    save: (jkf) => {
      written.push({ path: absPath, jkf });
      let release!: () => void;
      const p = new Promise<Awaited<AsyncResult<void, string>>>((resolve) => {
        release = () => resolve(Ok(undefined));
      });
      pending.push({ save: () => p, release });
      return p;
    },
  };
  return { persistence, pending };
}

function Harness({ onReady }: { onReady: (game: ReturnType<typeof useGame>) => void }) {
  const game = useGame();
  onReady(game);
  return null;
}

const JKF_A: JKFData = { header: { WHO: "A" }, moves: [{}] };
const JKF_B: JKFData = { header: { WHO: "B" }, moves: [{}] };

/** te=2 に変化が2本ぶら下がった棋譜。分岐編集は `forks` の形しか見ない */
const JKF_FORKED: JKFData = {
  header: {},
  moves: [
    { comments: ["root"] },
    { comments: ["t1"] },
    { comments: ["main2"], forks: [[{ comments: ["f0"] }], [{ comments: ["f1"] }]] },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("書き込みの列", () => {
  // **撃った時点と走る時点で宛先が違う。** 走る時点の `persistence` と
  // `loadedAbsPath` は棋譜を切り替えると**揃って**新しいファイルへ移るので、
  // 「いまの2つ」を比べる門番は通ってしまう。通すと a.kif の棋譜が b.kif へ丸ごと入る。
  it("列で待っている書き込みは、待っている間に開いた別の棋譜へ書かない", async () => {
    const written: { path: string; jkf: JKFData }[] = [];
    const a = makePersistence("/ws/a.kif", written);
    const b = makePersistence("/ws/b.kif", written);

    let game!: ReturnType<typeof useGame>;
    const view = render(
      <GameProvider persistence={a.persistence}>
        <Harness onReady={(g) => (game = g)} />
      </GameProvider>,
    );

    await act(async () => {
      await game.loadGame(JKF_A, "/ws/a.kif");
    });

    // a.kif への書き込みを2本積む。1本目は握ったまま返さない
    let second: Promise<unknown> = Promise.resolve();
    await act(async () => {
      void game.setCommentsByCursor(game.state.cursor!, ["1本目"]); // async-result-ignored: 握ったまま返さない1本目
      await Promise.resolve();
    });
    await act(async () => {
      second = game.setCommentsByCursor(game.state.cursor!, ["2本目"]);
      await Promise.resolve();
    });

    expect(written.filter((w) => w.path === "/ws/a.kif")).toHaveLength(1);

    // 待っている間にツリーで b.kif を開く
    await act(async () => {
      view.rerender(
        <GameProvider persistence={b.persistence}>
          <Harness onReady={(g) => (game = g)} />
        </GameProvider>,
      );
      await game.loadGame(JKF_B, "/ws/b.kif");
    });

    // 1本目を返して、列に待っていた2本目を走らせる
    await act(async () => {
      a.pending[0]?.release();
      await second;
    });

    // **b.kif へ書かないだけでは足りない。** 撃った時点で `persistence` を固定した以上、
    // 走る時点の突き合わせを丸ごと消しても書かれる先は a.kif のままで、
    // このテストは緑になってしまう。**書かなかったこと**まで見る。
    expect(written).toHaveLength(1);
    await expect(second).resolves.toMatchObject({ success: false });
  });

  // `persistence` は `useMemo` で作り直されるので、同じパスを開き直すと identity が変わる。
  // 走る時点の突き合わせが無いと、**読み直した内容の上へ、列の中の古い棋譜が着地する**。
  it("同じ棋譜を開き直しても、列の中の古い書き込みは着地しない", async () => {
    const written: { path: string; jkf: JKFData }[] = [];
    const first = makePersistence("/ws/a.kif", written);
    const reopened = makePersistence("/ws/a.kif", written);

    let game!: ReturnType<typeof useGame>;
    const view = render(
      <GameProvider persistence={first.persistence}>
        <Harness onReady={(g) => (game = g)} />
      </GameProvider>,
    );

    await act(async () => {
      await game.loadGame(JKF_A, "/ws/a.kif");
    });

    let second: Promise<unknown> = Promise.resolve();
    await act(async () => {
      void game.setCommentsByCursor(game.state.cursor!, ["1本目"]); // async-result-ignored: 握ったまま返さない1本目
      await Promise.resolve();
    });
    await act(async () => {
      second = game.setCommentsByCursor(game.state.cursor!, ["2本目"]);
      await Promise.resolve();
    });

    // 同じパスを開き直す（`persistence` の identity だけが変わる）
    await act(async () => {
      view.rerender(
        <GameProvider persistence={reopened.persistence}>
          <Harness onReady={(g) => (game = g)} />
        </GameProvider>,
      );
      await game.loadGame(JKF_A, "/ws/a.kif");
    });

    await act(async () => {
      first.pending[0]?.release();
      await second;
    });

    expect(written).toHaveLength(1);
    await expect(second).resolves.toMatchObject({ success: false });
  });

  /**
   * 分岐の番号は `jkf_replaced` の時点でメモリ上もう詰まっている。
   * 世代を書き込みの成否まで待って進めると、**その間に走る書き込みが
   * 「詰まった配列に、詰める前の番号」を当てる**。門番は一度も発火しない。
   */
  it("分岐を消したら、書き込みの成否を待たずに番号の世代が進む", async () => {
    const written: { path: string; jkf: JKFData }[] = [];
    const a = makePersistence("/ws/a.kif", written);

    let game!: ReturnType<typeof useGame>;
    render(
      <GameProvider persistence={a.persistence}>
        <Harness onReady={(g) => (game = g)} />
      </GameProvider>,
    );

    await act(async () => {
      await game.loadGame(JKF_FORKED, "/ws/a.kif");
    });

    const before = branchGenerationOf("/ws/a.kif");

    // 削除を撃つ。書き込みは握ったまま返さない
    await act(async () => {
      const q = { te: 2, forkPointers: [], target: branchIndexFromForkIndex(0) };
      void game.deleteBranch(q); // async-result-ignored: 握ったまま返さない書き込み
      await Promise.resolve();
    });

    expect(written).toHaveLength(1);
    expect(branchGenerationOf("/ws/a.kif")).toBe(before + 1);
  });
});
