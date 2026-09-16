// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { GameSessionView } from "@/entities/game-session";
import { Ok } from "@/shared/lib/result";

/**
 * ヘッダの「対局の行」。
 *
 * 守っているもの（ADR-0011 決定2）。
 *
 * - 走っている対局の間だけ出て、終局で消える
 * - 手番の印が `toMove` から出る。**裁定待ちで消えない**
 * - 時計の規則（最初のイベントまで `—`／止まっている側は最後に届いた値／
 *   秒読みは 0 のとき出さない）
 * - 盤の棋譜と対局の棋譜が違う間は、行が自分でその印を出す
 */

// この行が読むのは `view` だけ。残りは進行の口で、押す場所がここには1つも無い
const session = vi.hoisted(() => ({
  view: { kind: "idle", eventsUnavailable: null } as GameSessionView,
  start: vi.fn(async () => undefined),
  startRefusal: vi.fn(async () => null),
  reportBoardFailure: vi.fn(),
  submitMove: vi.fn(async () => Ok(undefined)),
  resign: vi.fn(async () => Ok(undefined)),
  abort: vi.fn(async () => Ok(undefined)),
  closeSession: vi.fn(async () => Ok(undefined)),
}));
const board = vi.hoisted(() => ({ loadedKifuPath: "/w/game.kif" as string | null }));

vi.mock(
  "@/entities/game-session",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/game-session")>()),
      useGameSession: () => session,
    }) satisfies typeof import("@/entities/game-session"),
);

// 差し替えるのは盤に載っている棋譜だけ。手番の記号は現物の `sideToColor` を通す
vi.mock(
  "@/entities/game",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/game")>()),
      useLoadedKifuPath: () => board.loadedKifuPath,
    }) satisfies typeof import("@/entities/game"),
);

const { default: HeaderGameLine } = await import("../HeaderGameLine");

function liveView(live: Partial<Extract<GameSessionView, { kind: "live" }>> = {}): GameSessionView {
  return {
    kind: "live",
    gameId: "g1" as never,
    kifuPath: "/w/game.kif",
    blackName: "あなた",
    whiteName: "YaneuraOu",
    humanSides: ["black"],
    toMove: "black",
    clocks: {
      black: { mainMs: 468_000, byoyomiMs: 30_000 },
      white: { mainMs: 252_000, byoyomiMs: 30_000 },
      running: null,
    },
    usiMoves: [],
    awaitingRuling: false,
    rulingFailure: null,
    boardFailure: null,
    ...live,
  };
}

function mount() {
  return render(<HeaderGameLine />).container;
}

function sideOf(container: HTMLElement, name: string) {
  const found = [...container.querySelectorAll(".app-header__game-side")].find(
    (el) => el.querySelector(".app-header__game-name")?.textContent === name,
  );
  if (found === undefined) throw new Error(`席が見つからない: ${name}`);
  return found;
}

beforeEach(() => {
  session.view = { kind: "idle", eventsUnavailable: null };
  board.loadedKifuPath = "/w/game.kif";
});

afterEach(cleanup);

describe("対局の行が出る条件", () => {
  test("対局を持っていなければ行そのものが無い", () => {
    expect(mount().querySelector(".app-header__game")).toBeNull();
  });

  test("対局中は出る", () => {
    session.view = liveView();
    expect(mount().querySelector(".app-header__game")).not.toBeNull();
  });

  /** **終局で消える。** 終局後に残り時間を見る場所はまだ無い（→ ADR-0011 決定4） */
  test("終局すると消える", () => {
    session.view = {
      kind: "over",
      gameId: "g1" as never,
      kifuPath: "/w/game.kif",
      blackName: "あなた",
      whiteName: "YaneuraOu",
      result: { reason: "resign", winner: "white", detail: null } as never,
      clocks: {
        black: { mainMs: 1_000, byoyomiMs: 0 },
        white: { mainMs: 2_000, byoyomiMs: 0 },
        running: null,
      },
      usiMoves: [],
      rulingFailure: null,
      boardFailure: null,
      engineClosed: true,
      closeFailure: null,
    };

    expect(mount().querySelector(".app-header__game")).toBeNull();
  });

  /** 始めている途中は時計の値がどこからも取れない。行を出すのは走り出してから */
  test("エンジンを起こしている間はまだ出ない", () => {
    session.view = { kind: "starting", kifuPath: "/w/game.kif" };
    expect(mount().querySelector(".app-header__game")).toBeNull();
  });
});

describe("手番の印", () => {
  test("`toMove` の側に付く", () => {
    session.view = liveView({ toMove: "white" });
    const container = mount();

    expect(sideOf(container, "YaneuraOu").className).toContain("--turn");
    expect(sideOf(container, "あなた").className).not.toContain("--turn");
  });

  /**
   * **`running` を手番の印に流用しない。** 裁定待ちや畳み待ちでは `running` が
   * `null` になる（`ClocksView.running` の doc）ので、その窓で手番が消える
   */
  test("動いている時計が無くても消えない", () => {
    session.view = liveView({ toMove: "black", awaitingRuling: true });
    const container = mount();

    expect(session.view.kind === "live" && session.view.clocks?.running).toBeNull();
    expect(sideOf(container, "あなた").className).toContain("--turn");
  });
});

describe("時計", () => {
  /** **最初のイベントが届くまでは数字を出さない。** 0 で埋めると時間切れ寸前に見える */
  test("時計がまだ届いていなければ数字を出さない", () => {
    session.view = liveView({ clocks: null });
    const container = mount();

    expect(sideOf(container, "あなた").querySelector(".app-header__game-clock")?.textContent).toBe(
      "—",
    );
  });

  test("止まっている時計は最後に届いた残りを出す", () => {
    session.view = liveView();
    const container = mount();

    expect(sideOf(container, "あなた").querySelector(".app-header__game-clock")?.textContent).toBe(
      "7:48",
    );
    expect(
      sideOf(container, "YaneuraOu").querySelector(".app-header__game-clock")?.textContent,
    ).toBe("4:12");
  });

  test("秒読みは 0 のとき出さない", () => {
    session.view = liveView({
      clocks: {
        black: { mainMs: 468_000, byoyomiMs: 0 },
        white: { mainMs: 252_000, byoyomiMs: 30_000 },
        running: null,
      },
    });
    const container = mount();

    expect(
      sideOf(container, "あなた").querySelector(".app-header__game-byoyomi")?.textContent,
    ).toBe("");
    expect(
      sideOf(container, "YaneuraOu").querySelector(".app-header__game-byoyomi")?.textContent,
    ).toBe("0:30");
  });
});

describe("別の棋譜の対局", () => {
  test("盤の棋譜と同じなら印を出さない", () => {
    session.view = liveView({ kifuPath: "/w/game.kif" });
    board.loadedKifuPath = "/w/game.kif";

    expect(mount().querySelector(".app-header__game-foreign")).toBeNull();
  });

  test("違う棋譜を開いている間は印を出す", () => {
    session.view = liveView({ kifuPath: "/w/game.kif" });
    board.loadedKifuPath = "/w/another.kif";

    expect(mount().querySelector(".app-header__game-foreign")).not.toBeNull();
  });
});
