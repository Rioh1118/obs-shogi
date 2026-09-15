// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { GameSessionView } from "@/entities/game-session";
import { Err, Ok } from "@/shared/lib/result";

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

  test("「閉じる」でエンジンを落とす", async () => {
    session.view = overView();
    render(<GameOverModal />);

    await click("閉じる");

    expect(session.closeSession).toHaveBeenCalledTimes(1);
  });

  /** **落とせなかったら、押した場所に理由を返す。** 他に出す場がない */
  test("閉じられなければ理由を出し、押し直せる", async () => {
    session.view = overView();
    session.closeSession.mockResolvedValue(Err("engine is busy") as never);
    render(<GameOverModal />);

    await click("閉じる");

    expect(screen.getByRole("alert").textContent).toContain("engine is busy");
    expect(screen.getByRole("button", { name: "閉じる" })).not.toBeNull();
  });

  test("「盤を見る」では対局を閉じない", async () => {
    session.view = overView();
    render(<GameOverModal />);

    await click("盤を見る");

    expect(session.closeSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
  });

  /**
   * **見送りを真偽で持つと、2局目以降の終局が一度も出ない。**
   * 下ろしたままの旗が次の対局まで残る。
   */
  test("見送った後でも、別の対局の終局は出る", async () => {
    session.view = overView();
    const { rerender } = render(<GameOverModal />);

    await click("盤を見る");
    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();

    session.view = overView({ gameId: "g2" as never });
    rerender(<GameOverModal />);

    expect(screen.getByRole("button", { name: "閉じる" })).not.toBeNull();
  });

  /** **裁定を返せなかったことを終局と一緒に消さない**（#362） */
  test("裁定を返せなかった理由を残す", () => {
    session.view = overView({ rulingFailure: "ruling rejected" });
    render(<GameOverModal />);

    expect(screen.getByRole("alert").textContent).toContain("ruling rejected");
  });
});
