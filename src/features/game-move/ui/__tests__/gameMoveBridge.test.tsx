// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { JKFPlayer } from "json-kifu-format";
import type { GameSessionView } from "@/entities/game-session";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";

/**
 * エンジンが決めた手を盤へ載せる橋。
 *
 * **これが無いと人対エンジンが1手目で固まる** —— Rust は `moveDecided` を出すが、
 * 盤に積む者が居ないので手番が返ってこない。
 *
 * ここで見るのは「**どこまで積んだか**」の見分け方。
 * 盤の手数で見ると、遡って分岐を並べた盤と、まだ積んでいない対局の線が区別できない。
 */

const KIFU = "/w/game.kif";

/** ▲7六歩 △3四歩 ▲2六歩 △8四歩 */
const MOVES = [
  { from: { x: 7, y: 7 }, to: { x: 7, y: 6 }, piece: "FU", color: 0 },
  { from: { x: 3, y: 3 }, to: { x: 3, y: 4 }, piece: "FU", color: 1 },
  { from: { x: 2, y: 7 }, to: { x: 2, y: 6 }, piece: "FU", color: 0 },
  { from: { x: 8, y: 3 }, to: { x: 8, y: 4 }, piece: "FU", color: 1 },
];

const USI = ["7g7f", "3c3d", "2g2f", "8c8d"];

/** `persistIfPossible` が断るときの文言 */
const SAVE_REFUSED = "保存先が決まっていません";

/** `count` 手ぶんの棋譜を組み、`at` 手目へ置いた盤を返す */
function boardAt(count: number, at: number): JKFPlayer {
  const player = new JKFPlayer({
    header: {},
    initial: { preset: "HIRATE" },
    moves: [{}, ...MOVES.slice(0, count).map((move) => ({ move }))],
  } as never);
  player.goto(at);
  return player;
}

/**
 * ▲2六歩 △3四歩 ▲7六歩 —— 同じ3手でも**順が違う別の線**。
 *
 * **手数は対局の1手前にそろえてある。** そろえないと、手数で見ている実装でも
 * 別の理由で止まってしまい、この試験が線を見ていることを確かめられない。
 */
function otherLine(): JKFPlayer {
  const player = new JKFPlayer({
    header: {},
    initial: { preset: "HIRATE" },
    moves: [{}, { move: MOVES[2] }, { move: MOVES[1] }, { move: MOVES[0] }],
  } as never);
  player.goto(3);
  return player;
}

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

const board = vi.hoisted(() => ({
  player: null as JKFPlayer | null,
  loadedAbsPath: null as string | null,
  makeMove: vi.fn((): AsyncResult<void> => Promise.resolve(Ok(undefined))),
}));

vi.mock(
  "@/entities/game-session",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/game-session")>()),
      useGameSession: () => session,
    }) satisfies typeof import("@/entities/game-session"),
);

/**
 * 盤への口。**橋が読むのは3つだけ**なので、それ以外は埋めない
 * （埋めると盤の器を丸ごと組むことになり、この試験が見たい「積む条件」から離れる）。
 *
 * **戻り値だけを絞る。** `satisfies` は口の顔ぶれを見ていて、
 * 実物に口が増えればここも落ちる
 */
vi.mock(
  "@/entities/game",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/game")>()),
      useGame: () =>
        ({
          view: { player: board.player },
          state: { loadedAbsPath: board.loadedAbsPath },
          makeMove: board.makeMove,
        }) as unknown as ReturnType<typeof import("@/entities/game").useGame>,
    }) satisfies typeof import("@/entities/game"),
);

const { GameMoveBridge } = await import("../GameMoveBridge");

/** 4手進んだ対局。**盤がどこに居るかは各試験が決める** */
function liveView(usiMoves: string[]): GameSessionView {
  return {
    kind: "live",
    gameId: "g1" as never,
    kifuPath: KIFU,
    blackName: "あなた",
    whiteName: "エンジン",
    humanSides: ["black"],
    toMove: "black",
    clocks: null,
    usiMoves,
    awaitingRuling: false,
    rulingFailure: null,
    boardFailure: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  board.makeMove.mockResolvedValue(Ok(undefined));
  board.loadedAbsPath = KIFU;
  session.view = { kind: "idle", eventsUnavailable: null };
});

afterEach(() => {
  cleanup();
});

describe("エンジンの手を盤へ載せる", () => {
  test("1手遅れている盤に、その手を積む", () => {
    session.view = liveView(USI.slice(0, 1));
    board.player = boardAt(0, 0);

    render(<GameMoveBridge />);

    expect(board.makeMove).toHaveBeenCalledTimes(1);
    expect(board.makeMove).toHaveBeenCalledWith(expect.objectContaining({ to: { x: 7, y: 6 } }));
  });

  /**
   * **2手以上遅れた盤も追いつけること。**
   *
   * 手数の等号（`tesuu === usiMoves.length - 1`）で見ていると、
   * 遡って眺めている間にエンジンの手が2手決まった対局からは**二度と追いつかない** ——
   * 差は縮まらないまま、対局タブだけが手数を数え続け、
   * 終局後に開き直すと後半が丸ごと無い棋譜が残る。エラーも帯も出ない。
   */
  test("2手遅れていても、1手ずつ追いつく", () => {
    session.view = liveView(USI);
    board.player = boardAt(2, 2);

    render(<GameMoveBridge />);

    // 盤に積むのは3手目。**まとめて積まない**（1回の描画で1手）
    expect(board.makeMove).toHaveBeenCalledTimes(1);
    expect(board.makeMove).toHaveBeenCalledWith(expect.objectContaining({ to: { x: 2, y: 6 } }));
  });

  /**
   * **遡って分岐を並べた盤に、対局の手を生やさない。**
   *
   * 手数で見ると、この盤は「3手目まで積んだ対局の線」と区別が付かない。
   */
  test("別の線を辿っている盤には積まない", () => {
    session.view = liveView(USI);
    board.player = otherLine();

    render(<GameMoveBridge />);

    expect(board.makeMove).not.toHaveBeenCalled();
  });

  test("先端に追いついていれば積まない", () => {
    session.view = liveView(USI);
    board.player = boardAt(4, 4);

    render(<GameMoveBridge />);

    expect(board.makeMove).not.toHaveBeenCalled();
  });

  /**
   * **積めなかった位置を二度出さない。**
   *
   * 積めなかった `makeMove` は `jkf_restored` で盤を戻す。戻った盤はまた同じ位置で
   * 先頭一致するので、控えが無いと**積む→書けない→戻す→積む**が止まらない。
   * ディスクの故障は要らない —— 盤に載せられなかった棋譜を選ぶと
   * `persistIfPossible` が永久に断るので、書き込みを1回もせずに描き直しだけが回る。
   *
   * **戻ってきた盤を作り直すこと。** `jkf_restored` は `state.jkf` と `state.cursor` を
   * 戻すので `cursorView` が `player` を組み直す —— 同じ局面でも**別の物**になり、
   * 効果の依存が動いて走り直す。使い回すと依存が変わらず、
   * 控えが無い実装でも1回で終わってしまう。
   */
  test("積めなかった位置は、盤が戻ってきても出し直さない", async () => {
    board.makeMove.mockResolvedValue(Err(SAVE_REFUSED));
    session.view = liveView(USI.slice(0, 1));
    board.player = boardAt(0, 0);

    const { rerender } = render(<GameMoveBridge />);
    await act(async () => {});

    // 書けずに戻された盤。局面は同じで、物としては別
    board.player = boardAt(0, 0);
    rerender(<GameMoveBridge />);

    expect(board.makeMove).toHaveBeenCalledTimes(1);
  });

  /** **黙らない。** 対局は Rust の写しで進むので、棋譜だけが遅れて終局まで気づかれない */
  test("積めなかったことを対局へ伝える", async () => {
    board.makeMove.mockResolvedValue(Err(SAVE_REFUSED));
    session.view = liveView(USI.slice(0, 1));
    board.player = boardAt(0, 0);

    render(<GameMoveBridge />);
    await act(async () => {});

    expect(session.reportBoardFailure).toHaveBeenCalledWith(SAVE_REFUSED);
  });

  /**
   * **対局は棋譜が入れ替わっても走り続ける。**
   * 別の棋譜を見ている間に積むと、関係の無い棋譜へ対局の手が入る。
   */
  test("別の棋譜を見ている間は積まない", () => {
    session.view = liveView(USI);
    board.player = boardAt(0, 0);
    board.loadedAbsPath = "/w/other.kif";

    render(<GameMoveBridge />);

    expect(board.makeMove).not.toHaveBeenCalled();
  });
});

/**
 * **終局した対局の棋譜を、利用者が遡れること。**
 *
 * 橋は「先頭一致していて短い盤＝まだ積んでいない」と読む。終局後もそう読むと、
 * **遡った盤を「遅れている盤」と取り違えて1手ずつ押し戻す** ——
 * 1回の描画で1手進むので、利用者は先端から動けない。
 *
 * 終局後は追いつく相手がもう増えないので、一度届けたら押すのをやめる。
 */
describe("終局した対局の盤", () => {
  function overView(usiMoves: string[]): GameSessionView {
    return {
      kind: "over",
      gameId: "g1" as never,
      kifuPath: KIFU,
      blackName: "エンジンA",
      whiteName: "エンジンB",
      result: { reason: "resign", winner: "black", detail: null } as never,
      clocks: {
        black: { mainMs: 0, byoyomiMs: 0 },
        white: { mainMs: 0, byoyomiMs: 0 },
        running: null,
      },
      usiMoves,
      rulingFailure: null,
      boardFailure: null,
    };
  }

  /** **終局の1手は届ける。** 届けないと最後の手が棋譜に入らない */
  test("終局しても、まだ届いていない手は積む", () => {
    session.view = overView(USI);
    board.player = boardAt(3, 3);

    render(<GameMoveBridge />);

    expect(board.makeMove).toHaveBeenCalledTimes(1);
  });

  /**
   * **先端まで届いた後に遡った盤を、押し戻さない。**
   * これが効いていないと、終局後の棋譜は先端に貼り付いて並べ替えられない。
   */
  test("先端まで届いた後は、遡っても押し戻さない", () => {
    session.view = overView(USI);
    board.player = boardAt(4, 4);

    const { rerender } = render(<GameMoveBridge />);
    expect(board.makeMove).not.toHaveBeenCalled();

    // 利用者が2手目まで遡った
    board.player = boardAt(4, 2);
    rerender(<GameMoveBridge />);

    expect(board.makeMove).not.toHaveBeenCalled();
  });
});
