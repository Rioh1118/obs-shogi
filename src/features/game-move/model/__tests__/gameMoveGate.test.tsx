// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { Color } from "shogi.js";
import type { BoardLine, StandardMoveFormat } from "@/entities/game";
import type { GameSessionView } from "@/entities/game-session";
import { Err, Ok } from "@/shared/lib/result";

/**
 * 対局中の盤の着手を通す門。
 *
 * **守るのは1つ** —— 対局中は、Rust が採った手しか棋譜へ積まない。
 * 積んでしまうと、Rust の写しと食い違った指し手列で裁定を返すことになり、
 * 断られたまま `RULING_TIMEOUT` で対局が畳まれる。
 */

/**
 * 対局への口。**`satisfies typeof import(...)` が落ちるので、
 * 実物に口が増えたらここも増やすことになる**（門が見るのは `view` と `submitMove` だけ）。
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

const { useGameMoveGate } = await import("../useGameMoveGate");

const KIFU = "/w/game.kif";

/** 7六歩。**先手の手** */
const BLACK_MOVE: StandardMoveFormat = {
  from: { x: 7, y: 7 },
  to: { x: 7, y: 6 },
  piece: "FU",
  color: Color.Black,
};

const WHITE_MOVE: StandardMoveFormat = {
  from: { x: 3, y: 3 },
  to: { x: 3, y: 4 },
  piece: "FU",
  color: Color.White,
};

/** 先手が人、後手がエンジンで、先手の手番の対局 */
function liveView(over: Partial<Extract<GameSessionView, { kind: "live" }>> = {}): GameSessionView {
  return {
    kind: "live",
    gameId: "g1" as never,
    kifuPath: KIFU,
    blackName: "あなた",
    whiteName: "エンジン",
    humanSides: ["black"],
    toMove: "black",
    clocks: null,
    usiMoves: [],
    awaitingRuling: false,
    rulingFailure: null,
    boardFailure: null,
    ...over,
  };
}

/**
 * 盤の線を組む。**既定は「対局の先端に居る」** ——
 * 線がずれている形は、そのつど `usiMoves` を渡して作る。
 */
function accept(move: StandardMoveFormat, line: Partial<BoardLine> = {}): Promise<boolean> {
  const { result } = renderHook(() => useGameMoveGate());
  const view = session.view;
  const played = view.kind === "live" ? view.usiMoves : [];
  return result.current.accept(move, { kifuPath: KIFU, usiMoves: [...played], ...line });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.submitMove.mockResolvedValue(Ok(undefined));
  session.view = { kind: "idle", eventsUnavailable: null };
});

afterEach(() => {
  cleanup();
});

describe("対局中の着手", () => {
  test("対局していなければ素通し。**普段の編集を止めない**", async () => {
    await expect(accept(BLACK_MOVE)).resolves.toBe(true);
    expect(session.submitMove).not.toHaveBeenCalled();
  });

  test("自分の手番なら、Rust が採ってから積む", async () => {
    session.view = liveView();

    await expect(accept(BLACK_MOVE)).resolves.toBe(true);
    expect(session.submitMove).toHaveBeenCalledWith("black", "7g7f");
  });

  /**
   * **これが無いと、Rust が受けていないのに棋譜だけが1手先へ進む。**
   *
   * **人が座っている側の手で見る** —— 相手がエンジンの手を出そうとする形だと、
   * 席の検査だけでも止まってしまい、手番の検査を1度も通らない。
   */
  test("自分の席でも、相手の手番では積まない", async () => {
    session.view = liveView({ toMove: "white", humanSides: ["black", "white"] });

    await expect(accept(BLACK_MOVE)).resolves.toBe(false);
    expect(session.submitMove).not.toHaveBeenCalled();
  });

  test("エンジンの席は、人が代わりに指せない", async () => {
    session.view = liveView({ toMove: "white", humanSides: ["black"] });

    await expect(accept(WHITE_MOVE)).resolves.toBe(false);
    expect(session.submitMove).not.toHaveBeenCalled();
  });

  /**
   * **採られなかったら積まない。** 着手が届くのと持ち時間が尽きるのが同じ tick に
   * 入ると断られる（`moveDecided` は出ず `over { timeout }` が届く）。
   */
  test("Rust が断ったら積まない", async () => {
    session.view = liveView();
    session.submitMove.mockResolvedValue(Err("game is already over") as never);

    await expect(accept(BLACK_MOVE)).resolves.toBe(false);
  });

  /**
   * **対局は棋譜が入れ替わっても走り続ける。** 別の棋譜を開いている間の編集まで
   * 止めると、対局中は他の棋譜を1手も並べ替えられなくなる。
   */
  test("別の棋譜を触っているだけなら素通し", async () => {
    session.view = liveView();

    await expect(accept(BLACK_MOVE, { kifuPath: "/w/other.kif" })).resolves.toBe(true);
    expect(session.submitMove).not.toHaveBeenCalled();
  });

  /**
   * **`start_game` は評価関数の読み込みを待つ。** 重いエンジンでは数十秒かかり、
   * その間も盤は触れる。素通しにすると、Rust の知らない手が棋譜に入ったまま対局が始まり、
   * **棋譜が対局の記録として使えなくなる**（対局そのものは Rust の写しで進むので、
   * 食い違いは終局まで誰も気づかない）。
   *
   * 出す先の `gameId` がまだ無いので、**採ってもらうこともできない**。
   */
  test("始まりきる前の盤は、同じ棋譜なら止める", async () => {
    session.view = { kind: "starting", kifuPath: KIFU };

    await expect(accept(BLACK_MOVE)).resolves.toBe(false);
    expect(session.submitMove).not.toHaveBeenCalled();
  });

  test("始まりきる前でも、別の棋譜なら素通し", async () => {
    session.view = { kind: "starting", kifuPath: KIFU };

    await expect(accept(BLACK_MOVE, { kifuPath: "/w/other.kif" })).resolves.toBe(true);
  });

  /**
   * **遡って分岐を並べるのは、対局中も止めていない普通の操作。**
   * そこで指した手は「対局の次の1手」ではない。
   *
   * 出すと Rust の写しに異物として載り（`validate_usi_move` は書式しか見ない）、
   * `continue_game` の突き合わせで弾かれて**対局そのものが中断される**。
   * 終局理由に出るのは「n手目を指せない」で、遡った操作とは結び付かない。
   * 運悪くその手が本譜の局面でも合法なら中断もせず、
   * **盤とエンジンが別の局面を進み続ける。**
   */
  test("遡った先で指した手は出さない", async () => {
    session.view = liveView({ usiMoves: ["7g7f", "3c3d", "2g2f", "8c8d"], toMove: "black" });

    // 盤は2手目まで戻って、そこから別の手を指している
    await expect(accept(BLACK_MOVE, { usiMoves: ["7g7f", "3c3d"] })).resolves.toBe(false);
    expect(session.submitMove).not.toHaveBeenCalled();
  });

  /**
   * **手数が合っていても、辿った線が違えば出さない。**
   * `tesuu` で見ると通ってしまう形（CLAUDE.md の「`tesuu` では判定できない」）。
   */
  test("手数が同じでも、別の線なら出さない", async () => {
    session.view = liveView({ usiMoves: ["7g7f", "3c3d"], toMove: "black" });

    await expect(accept(BLACK_MOVE, { usiMoves: ["2g2f", "3c3d"] })).resolves.toBe(false);
    expect(session.submitMove).not.toHaveBeenCalled();
  });

  /** **綴れない手が線に混じったら、一致とも不一致とも言えない。** 出さない */
  test("線を綴れないなら出さない", async () => {
    session.view = liveView();

    await expect(accept(BLACK_MOVE, { usiMoves: null })).resolves.toBe(false);
    expect(session.submitMove).not.toHaveBeenCalled();
  });

  test("綴れない手は出さない", async () => {
    session.view = liveView();

    await expect(accept({ to: { x: 5, y: 5 }, piece: "OU", color: Color.Black })).resolves.toBe(
      false,
    );
    expect(session.submitMove).not.toHaveBeenCalled();
  });
});
