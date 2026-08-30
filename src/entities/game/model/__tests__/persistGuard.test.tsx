// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GameProvider } from "../provider";
import { useGame } from "../useGame";
import type { GamePersistence } from "../types";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import { branchIndexFromForkIndex } from "@/entities/kifu/model/branch";

/**
 * **書き込み先が、いま読み込んでいる棋譜と同じときだけ書く**（#245 / #204）。
 *
 * `persistence` は `activeKifuPath`（file-tree 側）から組まれ、`state.loadedAbsPath` は
 * 橋渡しの effect が走ってから追いつく。そのずれの中で書くと、
 * **前の棋譜が新しく開いたファイルへ入る**。
 */

function makePersistence(
  absPath: string,
  written: { path: string; jkf: JKFData }[],
  result: Awaited<AsyncResult<void, string>> = Ok(undefined),
): GamePersistence {
  return {
    absPath,
    save: (jkf) => {
      written.push({ path: absPath, jkf });
      return Promise.resolve(result);
    },
  };
}

function Harness({ onReady }: { onReady: (game: ReturnType<typeof useGame>) => void }) {
  const game = useGame();
  onReady(game);
  return null;
}

const JKF_A: JKFData = { header: { WHO: "A" }, moves: [{}] };

/** te=2 に変化が2本ぶら下がった棋譜。分岐編集は `forks` の形しか見ない */
const JKF_FORKED: JKFData = {
  header: {},
  moves: [
    { comments: ["root"] },
    { comments: ["t1"] },
    { comments: ["main2"], forks: [[{ comments: ["f0"] }], [{ comments: ["f1"] }]] },
  ],
};

afterEach(cleanup);

describe("保存先の門番", () => {
  it("宛先と読み込んでいる棋譜が同じなら書く", async () => {
    const written: { path: string; jkf: JKFData }[] = [];
    let game!: ReturnType<typeof useGame>;
    render(
      <GameProvider persistence={makePersistence("/ws/a.kif", written)}>
        <Harness onReady={(g) => (game = g)} />
      </GameProvider>,
    );

    await act(async () => {
      await game.loadGame(JKF_A, "/ws/a.kif");
    });
    await act(async () => {
      await game.setCommentsByCursor(game.state.cursor!, ["メモ"]); // async-result-ignored: 書けた先だけを見る
    });

    expect(written.map((w) => w.path)).toEqual(["/ws/a.kif"]);
  });

  // 橋渡しの effect が追いつく前の1コミットぶんのずれ。ここで書くと
  // **前の棋譜が新しく開いたファイルへ丸ごと入る**
  it("宛先が別のファイルを指している間は書かない", async () => {
    const written: { path: string; jkf: JKFData }[] = [];
    let game!: ReturnType<typeof useGame>;
    const view = render(
      <GameProvider persistence={makePersistence("/ws/a.kif", written)}>
        <Harness onReady={(g) => (game = g)} />
      </GameProvider>,
    );

    await act(async () => {
      await game.loadGame(JKF_A, "/ws/a.kif");
    });

    // 宛先だけ b.kif へ進む（`loadGame` はまだ a.kif のまま）
    await act(async () => {
      view.rerender(
        <GameProvider persistence={makePersistence("/ws/b.kif", written)}>
          <Harness onReady={(g) => (game = g)} />
        </GameProvider>,
      );
    });

    let res: Awaited<AsyncResult<void, string>> = Err("未実行");
    await act(async () => {
      res = await game.setCommentsByCursor(game.state.cursor!, ["メモ"]);
    });

    expect(written).toEqual([]);
    expect(res).toMatchObject({ success: false });
  });

  // **失敗したらメモリを戻す**（ADR-0004 決定7）。戻さないと、候補列が1つ減った状態に
  // 同じ添字で再試行が当たって別の枝が消える
  it("書き込みに失敗したら、置き換える前の棋譜へ戻す", async () => {
    const written: { path: string; jkf: JKFData }[] = [];
    let game!: ReturnType<typeof useGame>;
    render(
      <GameProvider persistence={makePersistence("/ws/a.kif", written, Err("Permission denied"))}>
        <Harness onReady={(g) => (game = g)} />
      </GameProvider>,
    );

    await act(async () => {
      await game.loadGame(JKF_A, "/ws/a.kif");
    });
    const beforeJkf = game.state.jkf;

    await act(async () => {
      await game.setCommentsByCursor(game.state.cursor!, ["メモ"]); // async-result-ignored: 巻き戻しだけを見る
    });

    expect(written).toHaveLength(1);
    expect(game.state.jkf).toBe(beforeJkf);
    expect(game.getCommentsByCursor(game.state.cursor!)).toEqual([]);
  });

  // **コメントの保存では「操作中」を立てない。** 立てると、打鍵が止まった 900ms 後に
  // 棋譜一覧の全行が書き込みの間だけ反応しなくなる。合図も無くクリックが捨てられる。
  it("コメントの保存は棋譜一覧を止めない", async () => {
    const written: { path: string; jkf: JKFData }[] = [];
    let release!: () => void;
    const held = new Promise<Awaited<AsyncResult<void, string>>>((r) => {
      release = () => r(Ok(undefined));
    });

    let game!: ReturnType<typeof useGame>;
    render(
      <GameProvider
        persistence={{
          absPath: "/ws/a.kif",
          save: (jkf) => {
            written.push({ path: "/ws/a.kif", jkf });
            return held;
          },
        }}
      >
        <Harness onReady={(g) => (game = g)} />
      </GameProvider>,
    );

    await act(async () => {
      await game.loadGame(JKF_A, "/ws/a.kif");
    });

    await act(async () => {
      void game.setCommentsByCursor(game.state.cursor!, ["メモ"]); // async-result-ignored: 握ったまま返さない
      await Promise.resolve();
    });

    expect(written).toHaveLength(1);
    expect(game.state.isLoading).toBe(false);

    await act(async () => {
      release();
    });
  });

  // reducer.ts が巻き戻しの理由として名指ししている経路。戻さないと、候補列が
  // 1つ減った状態に同じ添字で再試行が当たって**別の枝が消える**。
  it("分岐の削除に失敗したら、消える前の棋譜へ戻す", async () => {
    const written: { path: string; jkf: JKFData }[] = [];
    let game!: ReturnType<typeof useGame>;
    render(
      <GameProvider persistence={makePersistence("/ws/a.kif", written, Err("Permission denied"))}>
        <Harness onReady={(g) => (game = g)} />
      </GameProvider>,
    );

    await act(async () => {
      await game.loadGame(JKF_FORKED, "/ws/a.kif");
    });
    const beforeJkf = game.state.jkf;

    await act(async () => {
      const q = { te: 2, forkPointers: [], target: branchIndexFromForkIndex(0) };
      await game.deleteBranch(q); // async-result-ignored: 巻き戻しだけを見る
    });

    expect(written).toHaveLength(1);
    expect(game.state.jkf).toBe(beforeJkf);
    expect(game.state.jkf?.moves[2]?.forks).toHaveLength(2);
  });
});
