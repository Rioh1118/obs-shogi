// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GameProvider } from "../provider";
import { useGame } from "../useGame";
import type { GamePersistence } from "../types";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";

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
});
