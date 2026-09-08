// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import { GameProvider } from "../provider";
import { useGame } from "../useGame";
import type { GameContextType } from "../types";
import type { JKFData } from "@/entities/kifu/model/jkf";

/** provider の外へ context を取り出す。操作は `act` で包んで呼ぶ */
function mountGame() {
  const seen: { current: GameContextType | null } = { current: null };

  function Probe() {
    const game = useGame();
    useEffect(() => {
      seen.current = game;
    });
    seen.current = game;
    return null;
  }

  render(
    <GameProvider>
      <Probe />
    </GameProvider>,
  );

  return seen;
}

describe("loadGame", () => {
  test("読み込めた棋譜は state に入り、カーソルは開始局面", async () => {
    const game = mountGame();
    const jkf: JKFData = { header: {}, moves: [{}, { comments: ["t1"] }] };

    await act(async () => {
      expect((await game.current!.loadGame(jkf, "/ok.kif")).success).toBe(true);
    });

    expect(game.current!.state.jkf).not.toBeNull();
    expect(game.current!.state.cursor?.tesuu).toBe(0);
    expect(game.current!.state.loadedAbsPath).toBe("/ok.kif");
    expect(game.current!.state.error).toBeNull();
  });

  /**
   * 盤に載せられない `initial` を持つ棋譜を弾く（`game.md` の E16）。
   *
   * これを見ているのは `loadGame` の `buildPlayer(nextJkf, ROOT_CURSOR)` **1行だけ**で、
   * 返り値を使わないので消しても tsc も lint も通る。消すと壊れた棋譜が
   * `state.jkf` に入り、`cursorView` の catch が `player: null` を返して
   * **盤も棋譜ペインも空・文言なし・`error` すら null** になる。
   */
  test("盤に載せられない棋譜は state に入れず、理由を error に残す", async () => {
    const game = mountGame();
    const broken = { header: {}, initial: { preset: "OTHER" }, moves: [{}] } as unknown as JKFData;

    await act(async () => {
      const res = await game.current!.loadGame(broken, "/broken.kif");
      // **`Err` を返すことが唯一の伝達路。** `state.error` を描いている場所は
      // 無いので（#277）、これを捨てると F-31 が黙って通る
      expect(res.success).toBe(false);
    });

    expect(game.current!.state.jkf).toBeNull();
    expect(game.current!.state.error).not.toBeNull();
  });

  /**
   * **どのファイルが載らなかったかを残す。** `error` は文字列でパスを持たないので、
   * その棋譜が載るのを待っている側（`usePositionHitNavigation`）が要求と突き合わせられない。
   */
  test("載せられなかった宛先と、その回数を残す", async () => {
    const game = mountGame();
    const broken = { header: {}, initial: { preset: "OTHER" }, moves: [{}] } as unknown as JKFData;

    await act(async () => {
      await game.current!.loadGame(broken, "/broken.kif");
    });

    expect(game.current!.state.loadFailedAbsPath).toBe("/broken.kif");
    expect(game.current!.state.loadFailedSeq).toBe(1);

    // 2度目の失敗は回数だけが進む。**進まないと、待っている側が
    // 「前の回の失敗」と「いまの失敗」を区別できない**
    await act(async () => {
      await game.current!.loadGame(broken, "/broken.kif");
    });

    expect(game.current!.state.loadFailedSeq).toBe(2);
  });

  /** 載ったら宛先は消える。**回数は戻さない**（戻すと控えた値と別の失敗が一致しうる） */
  test("次に載せられたら宛先は消え、回数は戻らない", async () => {
    const game = mountGame();
    const broken = { header: {}, initial: { preset: "OTHER" }, moves: [{}] } as unknown as JKFData;
    const ok: JKFData = { header: {}, moves: [{}] };

    await act(async () => {
      await game.current!.loadGame(broken, "/broken.kif");
    });
    await act(async () => {
      await game.current!.loadGame(ok, "/ok.kif");
    });

    expect(game.current!.state.loadFailedAbsPath).toBeNull();
    expect(game.current!.state.loadFailedSeq).toBe(1);
  });

  test("棋譜を閉じたら宛先も消える", async () => {
    const game = mountGame();
    const broken = { header: {}, initial: { preset: "OTHER" }, moves: [{}] } as unknown as JKFData;

    await act(async () => {
      await game.current!.loadGame(broken, "/broken.kif");
    });
    await act(async () => {
      game.current!.resetGame();
    });

    expect(game.current!.state.loadFailedAbsPath).toBeNull();
  });
});

/**
 * `hasKifu` は**画面を丸ごと切り替える側**の綴り（盤の内側の判定は別の問い。
 * `GameView` の doc を見る）。読み手は `player` も `shogi` も知らない形で問える必要がある。
 *
 * **壊れても例外は出ない**——切り替えが狂って空の作業面が出るか、
 * 棋譜があるのに WelcomeScreen が出るだけ。
 */
describe("hasKifu", () => {
  test("何も読み込んでいなければ偽", () => {
    const game = mountGame();

    expect(game.current!.view.hasKifu).toBe(false);
  });

  test("読み込めた棋譜があれば真", async () => {
    const game = mountGame();
    const jkf: JKFData = { header: {}, moves: [{}, { comments: ["t1"] }] };

    await act(async () => {
      await game.current!.loadGame(jkf, "/ok.kif");
    });

    expect(game.current!.view.hasKifu).toBe(true);
  });

  test("読み込みに失敗したら偽のまま", async () => {
    const game = mountGame();
    const broken = { header: {}, initial: { preset: "OTHER" }, moves: [{}] } as unknown as JKFData;

    await act(async () => {
      await game.current!.loadGame(broken, "/broken.kif");
    });

    expect(game.current!.view.hasKifu).toBe(false);
  });

  test("閉じたら偽に戻る", async () => {
    const game = mountGame();
    const jkf: JKFData = { header: {}, moves: [{}] };

    await act(async () => {
      await game.current!.loadGame(jkf, "/ok.kif");
    });
    await act(async () => {
      game.current!.resetGame();
    });

    expect(game.current!.view.hasKifu).toBe(false);
  });
});
