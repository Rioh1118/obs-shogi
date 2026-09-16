// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { GameSessionView } from "@/entities/game-session";
import { Ok } from "@/shared/lib/result";

/**
 * 終局を知らせる面。
 *
 * **守るのは2つ。**
 *
 * - 終局が見えること（エンジンが黙って起きたまま残らない）
 * - **一度見送っても、次の対局の終局は出ること**
 */

const session = vi.hoisted(() => ({
  view: { kind: "idle", eventsUnavailable: null } as GameSessionView,
  submitMove: vi.fn(async () => Ok(undefined)),
  start: vi.fn(async () => undefined),
  resign: vi.fn(async () => Ok(undefined)),
  abort: vi.fn(async () => Ok(undefined)),
  closeSession: vi.fn(async () => Ok(undefined)),
  reportBoardFailure: vi.fn(),
  startRefusal: vi.fn(async () => null),
}));

vi.mock(
  "@/entities/game-session",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/game-session")>()),
      useGameSession: () => session,
    }) satisfies typeof import("@/entities/game-session"),
);

const { GameOverModal } = await import("../GameOverModal");

function overView(over: Partial<Extract<GameSessionView, { kind: "over" }>> = {}): GameSessionView {
  return {
    kind: "over",
    gameId: "g1" as never,
    kifuPath: "/w/game.kif",
    blackName: "あなた",
    whiteName: "エンジン",
    result: { reason: "timeout", winner: "white", detail: null } as never,
    clocks: {
      black: { mainMs: 0, byoyomiMs: 0 },
      white: { mainMs: 0, byoyomiMs: 0 },
      running: null,
    },
    usiMoves: ["7g7f", "3c3d"],
    rulingFailure: null,
    boardFailure: null,
    engineClosed: true,
    closeFailure: null,
    ...over,
  };
}

/** ボタンを押す。**`user-event` はこのリポジトリに入っていない** */
function click(name: string) {
  const button = screen.getByRole("button", { name });
  return act(async () => {
    button.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.closeSession.mockResolvedValue(Ok(undefined));
  session.view = { kind: "idle", eventsUnavailable: null };
});

afterEach(cleanup);

describe("終局を知らせる面", () => {
  test("対局が終わっていなければ出さない", () => {
    render(<GameOverModal />);

    expect(screen.queryByText("閉じる")).toBeNull();
  });

  test("終局したら、勝敗と理由を出す", () => {
    session.view = overView();
    render(<GameOverModal />);

    expect(screen.getByText(/エンジン の勝ち/)).not.toBeNull();
    expect(screen.getByText(/時間切れ/)).not.toBeNull();
  });

  /** **始め損ねた対局には落とす相手が居ない。** 断りは V4 の帯が出す */
  test("始められなかった対局では出さない", () => {
    session.view = { kind: "failed", kifuPath: "/w/game.kif", message: "起動できない" };
    render(<GameOverModal />);

    expect(screen.queryByText("閉じる")).toBeNull();
  });

  /**
   * **エンジンを落とす口はここに無い。** 終局した時点で進行の側が落としている。
   * 置くと「利用者が押すまでプロセスが残る」形に戻る。
   */
  test("閉じても対局へは何も投げない", async () => {
    session.view = overView();
    render(<GameOverModal />);

    await click("閉じる");

    expect(session.closeSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
  });

  /** **選ばせない。** 2つ並べていた間は、どちらが何を畳むのか読めなかった */
  test("押せる口は「閉じる」ひとつだけ", () => {
    session.view = overView();
    render(<GameOverModal />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["閉じる"]);
  });

  /** **落とせなかったことを黙らない。** 押し直す人が居ないので、出さないと気づけない */
  test("エンジンを落とせなかった理由を出す", () => {
    session.view = overView({ engineClosed: false, closeFailure: "the game is busy" });
    render(<GameOverModal />);

    expect(screen.getByRole("alert").textContent).toContain("the game is busy");
  });

  /**
   * **見送りを真偽で持つと、2局目以降の終局が一度も出ない。**
   * 下ろしたままの旗が次の対局まで残る。
   */
  test("閉じた後でも、別の対局の終局は出る", async () => {
    session.view = overView();
    const { rerender } = render(<GameOverModal />);

    await click("閉じる");
    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();

    session.view = overView({ gameId: "g2" as never });
    rerender(<GameOverModal />);

    expect(screen.getByRole("button", { name: "閉じる" })).not.toBeNull();
  });

  /**
   * **裁定を返せなかったことを終局と一緒に消さない。** 判定が投げて
   * `endGameByRule` が通った回、理由の欄は「規則による終局（判定できなかった…）」
   * までしか言えず、**投げた中身を出せる欄がこの帯しか無い**
   */
  test("裁定を返せなかった理由を残す", () => {
    session.view = overView({ rulingFailure: "ruling rejected" });
    render(<GameOverModal />);

    expect(screen.getByRole("alert").textContent).toContain("ruling rejected");
  });
});
