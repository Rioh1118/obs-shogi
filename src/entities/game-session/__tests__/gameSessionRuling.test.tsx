// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { GameEvent, GameId, GameSettings } from "../api/rust-types";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import type { GameSessionContextValue } from "../model/context";
import type { GameRuling, RulingAdapter } from "../model/types";

/**
 * 対局の進行と裁定。表は `docs/state-transitions/game-session.md`、
 * 画面の側は `docs/spec/features/game-play.md`。
 *
 * 守っている不変条件は、手が決まったら必ず裁定が返ること。返らないと Rust は
 * 裁定待ちのまま止まり、`RULING_TIMEOUT` で終局する。
 */

/** Tauri を呼ぶ関数。`satisfies typeof import(...)` があるので、実物に増えたらここも増やす */
const tauri = vi.hoisted(() => ({
  startGame: vi.fn(),
  submitGameMove: vi.fn(async () => undefined),
  continueGame: vi.fn(async () => undefined),
  endGameByRule: vi.fn(async () => undefined),
  resignGame: vi.fn(async () => undefined),
  abortGame: vi.fn(async () => undefined),
  closeGame: vi.fn(async () => undefined),
  getGameState: vi.fn(),
  listGames: vi.fn(),
  ALREADY_OVER: "game is already over" as const,
}));

vi.mock("../api/tauri", () => tauri satisfies typeof import("../api/tauri"));

/** 張った購読。テストが `emit` で出来事を撃つ */
const events = vi.hoisted(() => ({
  emit: null as ((event: GameEvent) => void) | null,
  unlisten: vi.fn(),
  fail: null as string | null,
  gate: null as Promise<void> | null,
}));

vi.mock(
  "../api/events",
  () =>
    ({
      GAME_EVENT: "game-event",
      listenToGameEvents: async (callback: (event: GameEvent) => void) => {
        await events.gate;
        if (events.fail !== null) throw new Error(events.fail);
        events.emit = callback;
        return events.unlisten;
      },
    }) satisfies typeof import("../api/events"),
);

const { GameSessionProvider } = await import("../model/provider");
const { useGameSession } = await import("../model/useGameSession");

const GAME_ID = "g1" as GameId;

const SETTINGS: GameSettings = {
  black: { kind: "human", name: "先手" },
  white: { kind: "human", name: "後手" },
  blackTime: { mainMs: 600_000, byoyomiMs: 0, incrementMs: 0 },
  whiteTime: { mainMs: 600_000, byoyomiMs: 0, incrementMs: 0 },
  startSfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
};

const CLOCKS = {
  black: { mainMs: 600_000, byoyomiMs: 0 },
  white: { mainMs: 600_000, byoyomiMs: 0 },
  running: null,
};

/** 常に「まだ続く」を返す裁定器 */
const alwaysContinue: RulingAdapter = { judge: () => ({ kind: "continue" }) };

function rulingReturning(verdict: GameRuling): RulingAdapter {
  return { judge: vi.fn(() => verdict) };
}

/** `show` が偽なら本体を描かない。タブが閉じた状態を作る */
function Harness({ show }: { show: boolean }) {
  return show ? <Body /> : null;
}

function Body() {
  const { view } = useGameSession();
  return (
    <>
      <div data-testid="kind">{view.kind}</div>
      {/* 欄そのものを描く。`kind` だけだと、欄を落とす変異が素通りする */}
      <div data-testid="rulingFailure">
        {view.kind === "live" || view.kind === "over" ? (view.rulingFailure ?? "") : ""}
      </div>
      <div data-testid="closeFailure">{view.kind === "over" ? (view.closeFailure ?? "") : ""}</div>
      <div data-testid="engineClosed">{view.kind === "over" ? String(view.engineClosed) : ""}</div>
    </>
  );
}

let starter: (() => Promise<void>) | null = null;
let closer: (() => AsyncResult<void>) | null = null;
let latest: GameSessionContextValue | null = null;

function Starter() {
  const context = useGameSession();
  const { start, closeSession } = context;
  starter = () => start({ settings: SETTINGS, kifuPath: "/w/a.kif" });
  closer = closeSession;
  latest = context;
  return null;
}

/** いま provider が配っている値。`Starter` が描かれなかったら投げる */
function session(): GameSessionContextValue {
  if (latest === null) throw new Error("Starter が描かれていない");
  return latest;
}

/** `JSON.stringify` が投げる値 */
function cyclic(): unknown {
  const value: { self?: unknown } = {};
  value.self = value;
  return value;
}

/**
 * `start` を呼ぶ。`starter?.()` にしない。`Starter` が描かれていないと何も実行せずに通り、
 * 否定を見るテストが空振りで緑になる
 */
async function startOnce() {
  if (starter === null) throw new Error("Starter が描かれていない");
  await starter();
}

function mount(ruling: RulingAdapter, show = true) {
  return render(
    <GameSessionProvider ruling={ruling}>
      <Starter />
      <Harness show={show} />
    </GameSessionProvider>,
  );
}

/** いま描かれている状態の綴り */
function kindText(): string | null {
  return screen.getByTestId("kind").textContent;
}

/** 画面に出ている「裁定を返せなかった」の文言 */
function rulingFailureText(): string | null {
  return screen.getByTestId("rulingFailure").textContent;
}

/** 画面に出ている「エンジンを落とせなかった」の文言 */
function closeFailureText(): string | null {
  return screen.getByTestId("closeFailure").textContent;
}

async function emit(event: GameEvent) {
  await act(async () => {
    events.emit?.(event);
    await Promise.resolve();
  });
}

beforeEach(() => {
  events.emit = null;
  events.fail = null;
  events.gate = null;
  starter = null;
  closer = null;
  latest = null;
  tauri.startGame.mockResolvedValue(GAME_ID);
  vi.clearAllMocks();
  tauri.startGame.mockResolvedValue(GAME_ID);
  // 消費されなかった `mockRejectedValueOnce` を次のテストへ持ち越さない
  tauri.closeGame.mockReset();
  tauri.closeGame.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("対局の進行", () => {
  test("手が決まったら裁定を返す。渡すのは根からの全手", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });

    expect(tauri.continueGame).toHaveBeenCalledWith(GAME_ID, ["7g7f"]);
  });

  test("2手目は1手目を含めて返す。写しがずれると Rust が断る", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    for (const usiMove of ["7g7f", "3c3d"]) {
      await emit({
        type: "moveDecided",
        gameId: GAME_ID,
        side: "black",
        usiMove,
        elapsedMs: 1000,
        clocks: CLOCKS,
      });
    }

    expect(tauri.continueGame).toHaveBeenLastCalledWith(GAME_ID, ["7g7f", "3c3d"]);
  });

  test("終局と裁定されたら `endGameByRule` を返す", async () => {
    mount(rulingReturning({ kind: "over", winner: "black", detail: "詰み" }));
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });

    expect(tauri.endGameByRule).toHaveBeenCalledWith(GAME_ID, "black", "詰み");
    expect(tauri.continueGame).not.toHaveBeenCalled();
  });

  /** 裁定をドックのタブの中に置くと、別のタブを開いただけで返す者が居なくなる */
  test("本体が畳まれていても裁定は返る", async () => {
    const { rerender } = mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    rerender(
      <GameSessionProvider ruling={alwaysContinue}>
        <Starter />
        <Harness show={false} />
      </GameSessionProvider>,
    );
    expect(screen.queryByTestId("kind")).toBeNull();

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });

    expect(tauri.continueGame).toHaveBeenCalledWith(GAME_ID, ["7g7f"]);
  });

  /**
   * `gameId` は `startGame` が解決するまで手に入らない。その前に届いた出来事を
   * `gameId` の不一致で捨てると、起動直後に終局した対局の `over` を落とす。
   */
  test("`gameId` が解決する前に届いた `over` を捨てない", async () => {
    let resolveStart: (id: GameId) => void = () => {};
    tauri.startGame.mockReturnValue(
      new Promise<GameId>((resolve) => {
        resolveStart = resolve;
      }),
    );

    mount(alwaysContinue);

    // `act` を入れ子にしない。解決していない `start` を中で待つと、以後の描画が壊れる
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = startOnce();
    });
    expect(kindText()).toBe("starting");

    // 対局が始まったことを知る前に、その対局の終局が届く
    await act(async () => {
      events.emit?.({
        type: "over",
        gameId: GAME_ID,
        result: { winner: "white", reason: "engineFailure", detail: null },
        clocks: CLOCKS,
      });
      resolveStart(GAME_ID);
      await pending;
    });

    expect(kindText()).toBe("over");
  });

  test("走っている対局があるうちは始めない。押した回数だけエンジンが増えない", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
      await startOnce();
    });

    expect(tauri.startGame).toHaveBeenCalledTimes(1);
  });

  test("購読が張れていなければ始めない。始めても裁定を返せない", async () => {
    events.fail = "listen failed";
    mount(alwaysContinue);

    await act(async () => {
      await Promise.resolve();
    });
    expect(kindText()).toBe("idle");

    await act(async () => {
      await startOnce();
    });

    expect(tauri.startGame).not.toHaveBeenCalled();
  });

  test("裁定を返せなかったら黙らない", async () => {
    tauri.continueGame.mockRejectedValueOnce(new Error("not awaiting a ruling"));
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });

    // `kind` だけを見ると、欄を落とす変異が素通りする
    expect(kindText()).toBe("live");
    expect(rulingFailureText()).toBe("not awaiting a ruling");
  });

  /**
   * 中断や時間切れが裁定の往復に入ると、飛んでいた `continue_game` が `ALREADY_OVER` で
   * 断られる。故障として載せると、自分で中断した対局に裁定の故障が残る。
   */
  test("もう終わっていたという断りは、故障として出さない", async () => {
    tauri.continueGame.mockRejectedValueOnce(new Error("game is already over"));
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });

    expect(rulingFailureText()).toBe("");
  });

  test("手番が移ったら、裁定の断りは消える", async () => {
    tauri.continueGame.mockRejectedValueOnce(new Error("not awaiting a ruling"));
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });
    expect(rulingFailureText()).toBe("not awaiting a ruling");

    await emit({ type: "turnChanged", gameId: GAME_ID, side: "white", clocks: CLOCKS });

    expect(rulingFailureText()).toBe("");
  });

  test("終局しても、裁定を返せなかったことは残る", async () => {
    tauri.continueGame.mockRejectedValueOnce(new Error("move list is not the current one"));
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });
    // Rust が `RULING_TIMEOUT` で畳む。理由は「アプリの異常」で届く
    await emit({
      type: "over",
      gameId: GAME_ID,
      result: { winner: null, reason: "rulingTimeout", detail: "no ruling came back from the app" },
      clocks: CLOCKS,
    });

    expect(kindText()).toBe("over");
    expect(rulingFailureText()).toBe("move list is not the current one");
  });

  test("判定が投げても裁定は返す", async () => {
    const throwing: RulingAdapter = {
      judge: () => {
        throw new Error("shogi.js が投げた");
      },
    };
    mount(throwing);
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });

    expect(tauri.endGameByRule).toHaveBeenCalledWith(
      GAME_ID,
      null,
      "判定できなかったため終局にしました",
    );
    expect(rulingFailureText()).toBe("shogi.js が投げた");
  });

  /** 終局はエンジンを落とさないので、`close_game` を通すまで最大2本が起きたままになる */
  test("終局したら、押されなくてもエンジンを落とす", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    expect(tauri.closeGame).not.toHaveBeenCalled();

    await emit({
      type: "over",
      gameId: GAME_ID,
      result: { winner: "black", reason: "resign", detail: null },
      clocks: CLOCKS,
    });

    expect(tauri.closeGame).toHaveBeenCalledWith(GAME_ID);
    expect(screen.getByTestId("engineClosed").textContent).toBe("true");
    // 結末は残す。消すと結果を渡す先が無くなり、最後の手を積む `GameMoveBridge` も止まる
    expect(kindText()).toBe("over");
  });

  /** 呼び直す者が居ないので、残さないと起きたままのプロセスに気づけない */
  test("エンジンを落とせなかったら、その理由を画面へ出す", async () => {
    tauri.closeGame.mockRejectedValueOnce(new Error("the game is busy"));
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    await emit({
      type: "over",
      gameId: GAME_ID,
      result: { winner: "black", reason: "resign", detail: null },
      clocks: CLOCKS,
    });

    expect(closeFailureText()).toBe("the game is busy");
    expect(screen.getByTestId("engineClosed").textContent).toBe("false");
    expect(kindText()).toBe("over");
  });

  /** 断る理由はエンジンが起きたままなことなので、落ちた後まで断ると次を始められない */
  test("終局した対局が残っていても、次の対局を始められる", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    await emit({
      type: "over",
      gameId: GAME_ID,
      result: { winner: "black", reason: "resign", detail: null },
      clocks: CLOCKS,
    });

    await act(async () => {
      await startOnce();
    });

    expect(tauri.startGame).toHaveBeenCalledTimes(2);
  });

  test("始め損ねた対局は、閉じずにやり直せる", async () => {
    tauri.startGame.mockRejectedValueOnce(new Error("engine did not answer usiok"));
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    expect(kindText()).toBe("failed");

    await act(async () => {
      await startOnce();
    });

    expect(tauri.startGame).toHaveBeenCalledTimes(2);
    expect(kindText()).toBe("live");
  });

  /** Rust は起動に失敗した対局を台帳に載せないので、`close_game` を呼ぶと断られる */
  test("始め損ねた対局は、エンジンを呼ばずに片付く", async () => {
    tauri.startGame.mockRejectedValueOnce(new Error("engine did not answer usiok"));
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    expect(kindText()).toBe("failed");

    await act(async () => {
      await closer?.();
    });

    expect(tauri.closeGame).not.toHaveBeenCalled();
    expect(kindText()).toBe("idle");
  });

  test("別の対局のイベントは畳み込まない", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "over",
      gameId: "other" as GameId,
      result: { winner: "black", reason: "resign", detail: null },
      clocks: CLOCKS,
    });

    expect(kindText()).toBe("live");
  });
});

describe("画面へ渡す姿", () => {
  const RUNNING_CLOCKS = {
    ...CLOCKS,
    running: { side: "white" as const, mainZeroAt: 1, byoyomiZeroAt: 2 },
  };

  test("対局中は、席と手番と時計と指し手を渡す", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await session().start({
        settings: {
          ...SETTINGS,
          white: { kind: "engine", name: "水匠", enginePath: "/e/suisho" },
          initialMoves: ["2g2f"],
        },
        kifuPath: "/w/a.kif",
      });
    });

    await emit({ type: "turnChanged", gameId: GAME_ID, side: "white", clocks: RUNNING_CLOCKS });

    expect(session().view).toEqual({
      kind: "live",
      gameId: GAME_ID,
      kifuPath: "/w/a.kif",
      blackName: "先手",
      whiteName: "水匠",
      humanSides: ["black"],
      toMove: "white",
      clocks: RUNNING_CLOCKS,
      usiMoves: ["2g2f"],
      awaitingRuling: false,
      rulingFailure: null,
      boardFailure: null,
    });
  });

  test("最初の出来事が届くまで、時計は `null` のまま", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    const { view } = session();
    expect(view.kind === "live" ? view.clocks : "live でない").toBeNull();
  });

  test("手が決まってから手番が移るまでが裁定待ち", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: CLOCKS,
    });
    expect(session().view).toMatchObject({ awaitingRuling: true, usiMoves: ["7g7f"] });

    await emit({ type: "turnChanged", gameId: GAME_ID, side: "white", clocks: CLOCKS });
    expect(session().view).toMatchObject({ awaitingRuling: false, toMove: "white" });
  });

  test("終局は、結末と終局時の時計を渡す", async () => {
    const result = { winner: "black", reason: "resign", detail: null } as const;
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await emit({ type: "over", gameId: GAME_ID, result, clocks: RUNNING_CLOCKS });

    expect(session().view).toEqual({
      kind: "over",
      gameId: GAME_ID,
      kifuPath: "/w/a.kif",
      blackName: "先手",
      whiteName: "後手",
      result,
      clocks: RUNNING_CLOCKS,
      usiMoves: [],
      rulingFailure: null,
      boardFailure: null,
      engineClosed: true,
      closeFailure: null,
    });
  });

  test("`moveDecided` は時計を進め、指し手列の同一性を変える", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    const { view: before } = session();

    await emit({
      type: "moveDecided",
      gameId: GAME_ID,
      side: "black",
      usiMove: "7g7f",
      elapsedMs: 1000,
      clocks: RUNNING_CLOCKS,
    });

    const { view: after } = session();
    if (before.kind !== "live" || after.kind !== "live") throw new Error("live でない");
    expect(after.clocks).toEqual(RUNNING_CLOCKS);
    // `GameMoveBridge` は列の同一性で積み直しを起こす
    expect(after.usiMoves).not.toBe(before.usiMoves);
    expect(before.usiMoves).toEqual([]);
  });

  test("`clockUpdated` は時計だけを動かし、指し手列の同一性を変えない", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    const { view: before } = session();

    await emit({ type: "clockUpdated", gameId: GAME_ID, clocks: RUNNING_CLOCKS });

    const { view: after } = session();
    if (before.kind !== "live" || after.kind !== "live") throw new Error("live でない");
    expect(after.clocks).toEqual(RUNNING_CLOCKS);
    expect(after.usiMoves).toBe(before.usiMoves);
  });

  test("読み筋の出来事は姿を変えない", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    const { view: before } = session();

    await emit({
      type: "searchInfo",
      gameId: GAME_ID,
      side: "black",
      result: {} as Extract<GameEvent, { type: "searchInfo" }>["result"],
    });

    expect(session().view).toBe(before);
  });

  test("始められなかったら、棋譜の場所と断りの文言を渡す", async () => {
    tauri.startGame.mockRejectedValueOnce("engine did not answer usiok");
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    expect(session().view).toEqual({
      kind: "failed",
      kifuPath: "/w/a.kif",
      message: "engine did not answer usiok",
    });
  });

  test("購読が張れなければ、`idle` にその文言を載せる", async () => {
    events.fail = "listen failed";
    mount(alwaysContinue);
    await act(async () => {
      await Promise.resolve();
    });

    expect(session().view).toEqual({ kind: "idle", eventsUnavailable: "listen failed" });
  });

  test("棋譜へ積めなかったことを載せ、`null` で取り消す", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await act(async () => session().reportBoardFailure("保存できません"));
    expect(session().view).toMatchObject({ boardFailure: "保存できません" });

    await act(async () => session().reportBoardFailure(null));
    expect(session().view).toMatchObject({ boardFailure: null });
  });

  test("棋譜の失敗が同じなら描き直さない", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    const { view: before } = session();

    await act(async () => session().reportBoardFailure(null));

    expect(session().view).toBe(before);
  });

  test("対局が無いときの棋譜の失敗は捨てる", async () => {
    mount(alwaysContinue);

    await act(async () => session().reportBoardFailure("保存できません"));

    expect(session().view).toEqual({ kind: "idle", eventsUnavailable: null });
  });
});

describe("始められるかの判定", () => {
  test("対局が無ければ `null` を返す", async () => {
    mount(alwaysContinue);

    expect(await session().startRefusal()).toBeNull();
  });

  test("走っている対局があれば `held` を返す", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    expect(await session().startRefusal()).toBe("held");
  });

  test("エンジンを落とせなかった終局は `held` のまま", async () => {
    tauri.closeGame.mockRejectedValueOnce(new Error("the game is busy"));
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    await emit({
      type: "over",
      gameId: GAME_ID,
      result: { winner: "black", reason: "resign", detail: null },
      clocks: CLOCKS,
    });

    expect(await session().startRefusal()).toBe("held");
  });

  test("落とし終えた終局と始め損ねた対局は `null` を返す", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    await emit({
      type: "over",
      gameId: GAME_ID,
      result: { winner: "black", reason: "resign", detail: null },
      clocks: CLOCKS,
    });
    expect(await session().startRefusal()).toBeNull();

    tauri.startGame.mockRejectedValueOnce(new Error("engine did not answer usiok"));
    await act(async () => {
      await startOnce();
    });
    expect(await session().startRefusal()).toBeNull();
  });

  test("購読が張れていなければ `events-unavailable` を返す", async () => {
    events.fail = "listen failed";
    mount(alwaysContinue);

    expect(await session().startRefusal()).toBe("events-unavailable");
  });

  test("待っている間に始まった対局を数える", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await Promise.resolve();
    });

    let answer: string | null | undefined;
    await act(async () => {
      const started = startOnce();
      await Promise.resolve();
      answer = await session().startRefusal();
      await started;
    });

    expect(answer).toBe("held");
  });

  test("購読の結果が出るまで待ってから答える", async () => {
    let settle: () => void = () => {};
    events.gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    events.fail = "listen failed";
    mount(alwaysContinue);

    let answer: string | null | undefined;
    await act(async () => {
      void session()
        .startRefusal()
        .then((refusal) => {
          answer = refusal;
        });
      await Promise.resolve();
    });
    expect(answer).toBeUndefined();

    await act(async () => {
      settle();
      await events.gate;
    });
    expect(answer).toBe("events-unavailable");
  });
});

describe("`startGame` の待ちの間", () => {
  /** 解決を手で進める `startGame` を置く */
  function holdStart() {
    let resolve: (id: GameId) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    tauri.startGame.mockReturnValueOnce(
      new Promise<GameId>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
    );
    return {
      resolve: (id: GameId) => resolve(id),
      reject: (reason: unknown) => reject(reason),
    };
  }

  test("溜めた出来事を届いた順に流し直す", async () => {
    const held = holdStart();
    mount(alwaysContinue);
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = startOnce();
    });

    await act(async () => {
      for (const usiMove of ["7g7f", "3c3d"]) {
        events.emit?.({
          type: "moveDecided",
          gameId: GAME_ID,
          side: "black",
          usiMove,
          elapsedMs: 1,
          clocks: CLOCKS,
        });
      }
      held.resolve(GAME_ID);
      await pending;
    });

    expect(session().view).toMatchObject({ usiMoves: ["7g7f", "3c3d"] });
    expect(tauri.continueGame).toHaveBeenLastCalledWith(GAME_ID, ["7g7f", "3c3d"]);
  });

  test("溜めた中の別の対局の出来事は流し直しで捨てる", async () => {
    const held = holdStart();
    mount(alwaysContinue);
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = startOnce();
    });

    await act(async () => {
      events.emit?.({
        type: "over",
        gameId: "other" as GameId,
        result: { winner: "black", reason: "resign", detail: null },
        clocks: CLOCKS,
      });
      held.resolve(GAME_ID);
      await pending;
    });

    expect(kindText()).toBe("live");
    expect(tauri.closeGame).not.toHaveBeenCalled();
  });

  test("起動が失敗したら、溜めた出来事を次の対局へ持ち越さない", async () => {
    const held = holdStart();
    mount(alwaysContinue);
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = startOnce();
    });
    await act(async () => {
      events.emit?.({
        type: "over",
        gameId: GAME_ID,
        result: { winner: "white", reason: "engineFailure", detail: null },
        clocks: CLOCKS,
      });
      held.reject(new Error("engine did not answer usiok"));
      await pending;
    });
    expect(kindText()).toBe("failed");

    await act(async () => {
      await startOnce();
    });

    expect(kindText()).toBe("live");
  });

  test("待っている間に手放した対局は、解決したら閉じる", async () => {
    const held = holdStart();
    mount(alwaysContinue);
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = startOnce();
    });
    await act(async () => {
      await session().closeSession();
    });
    expect(kindText()).toBe("idle");
    expect(tauri.closeGame).not.toHaveBeenCalled();

    await act(async () => {
      held.resolve(GAME_ID);
      await pending;
    });

    expect(tauri.closeGame).toHaveBeenCalledWith(GAME_ID);
    expect(kindText()).toBe("idle");
  });

  test("待っている間に手放した対局の断りは、次の対局へ書かない", async () => {
    const held = holdStart();
    mount(alwaysContinue);
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = startOnce();
    });
    await act(async () => {
      await session().closeSession();
      await startOnce();
    });

    await act(async () => {
      held.reject(new Error("engine did not answer usiok"));
      await pending;
    });

    expect(kindText()).toBe("live");
  });

  test("手放した対局の断りは、次の対局の溜めを消さない", async () => {
    const abandoned = holdStart();
    const next = holdStart();
    mount(alwaysContinue);
    let first: Promise<void> | undefined;
    await act(async () => {
      first = startOnce();
    });
    await act(async () => {
      await session().closeSession();
    });
    let second: Promise<void> | undefined;
    await act(async () => {
      second = startOnce();
    });

    await act(async () => {
      events.emit?.({
        type: "over",
        gameId: GAME_ID,
        result: { winner: "white", reason: "engineFailure", detail: null },
        clocks: CLOCKS,
      });
      abandoned.reject(new Error("engine did not answer usiok"));
      await first;
      next.resolve(GAME_ID);
      await second;
    });

    expect(kindText()).toBe("over");
  });
});

describe("操作の断り", () => {
  test("対局が無ければ呼ばずに断る", async () => {
    mount(alwaysContinue);

    await expect(session().submitMove("black", "7g7f")).resolves.toEqual(
      Err("対局が走っていません"),
    );
    await expect(session().resign("black")).resolves.toEqual(Err("対局が走っていません"));
    await expect(session().abort()).resolves.toEqual(Err("対局が走っていません"));
    expect(tauri.submitGameMove).not.toHaveBeenCalled();
    expect(tauri.resignGame).not.toHaveBeenCalled();
    expect(tauri.abortGame).not.toHaveBeenCalled();
  });

  test("通した操作は対局の識別子を付けて呼び、`Ok` を返す", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await expect(session().submitMove("black", "7g7f")).resolves.toEqual(Ok(undefined));
    await expect(session().resign("white")).resolves.toEqual(Ok(undefined));
    await expect(session().abort()).resolves.toEqual(Ok(undefined));

    expect(tauri.submitGameMove).toHaveBeenCalledWith(GAME_ID, "black", "7g7f");
    expect(tauri.resignGame).toHaveBeenCalledWith(GAME_ID, "white");
    expect(tauri.abortGame).toHaveBeenCalledWith(GAME_ID);
  });

  test.each([
    ["文字列", "game is already over", "game is already over"],
    ["Error", new Error("the game is busy"), "the game is busy"],
    ["オブジェクト", { code: 1 }, '{"code":1}'],
    ["空のオブジェクト", {}, "原因を取得できませんでした"],
    ["undefined", undefined, "原因を取得できませんでした"],
    ["循環参照", cyclic(), "原因を取得できませんでした"],
  ])("断りの文言: %s", async (_name, rejection, message) => {
    tauri.submitGameMove.mockRejectedValueOnce(rejection);
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });

    await expect(session().submitMove("black", "7g7f")).resolves.toEqual(Err(message));
  });

  test("閉じられなかった対局は手放さず、呼び直せる", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    tauri.closeGame.mockRejectedValueOnce(new Error("the game is busy"));

    let closed: Awaited<ReturnType<NonNullable<typeof closer>>> | undefined;
    await act(async () => {
      closed = await closer?.();
    });
    expect(closed).toEqual(Err("the game is busy"));
    expect(kindText()).toBe("live");

    await act(async () => {
      closed = await closer?.();
    });
    expect(closed).toEqual(Ok(undefined));
    expect(kindText()).toBe("idle");
  });

  /**
   * 終局したエンジンは `close_game` を通して台帳から外れている。もう一度通すと
   * Rust は `unknown game` で断り、結末が手放せなくなる。
   */
  test("エンジンを落とし終えた対局は、呼び直さずに手放す", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    await emit({
      type: "over",
      gameId: GAME_ID,
      result: { winner: "black", reason: "resign", detail: null },
      clocks: CLOCKS,
    });
    expect(tauri.closeGame).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("engineClosed").textContent).toBe("true");
    tauri.closeGame.mockRejectedValueOnce("unknown game: g1");

    let closed: Awaited<ReturnType<NonNullable<typeof closer>>> | undefined;
    await act(async () => {
      closed = await closer?.();
    });

    expect(closed).toEqual(Ok(undefined));
    expect(tauri.closeGame).toHaveBeenCalledTimes(1);
    expect(kindText()).toBe("idle");
  });

  /**
   * 本物の `close_game` は畳む前に中断を通すので、応答より先に `over` が届く。
   * それを受けた2本目の `close_game` は断られるが、手放す妨げにはならない。
   */
  test("走っている対局を手放す間に届いた `over` と2本目の断りで止まらない", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    tauri.closeGame.mockImplementationOnce(async () => {
      tauri.closeGame.mockRejectedValueOnce("the game is being closed: g1");
      await emit({
        type: "over",
        gameId: GAME_ID,
        result: { winner: null, reason: "aborted", detail: null },
        clocks: CLOCKS,
      });
    });

    let closed: Awaited<ReturnType<NonNullable<typeof closer>>> | undefined;
    await act(async () => {
      closed = await closer?.();
    });

    expect(closed).toEqual(Ok(undefined));
    expect(tauri.closeGame).toHaveBeenCalledTimes(2);
    expect(kindText()).toBe("idle");
  });

  test("手放す途中で `busy` に断られた対局は、`over` の姿で残る", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
    });
    tauri.closeGame.mockImplementationOnce(async () => {
      tauri.closeGame.mockRejectedValueOnce("the game is busy and could not be closed: g1");
      await emit({
        type: "over",
        gameId: GAME_ID,
        result: { winner: null, reason: "aborted", detail: null },
        clocks: CLOCKS,
      });
      throw new Error("the game is busy and could not be closed: g1");
    });

    let closed: Awaited<ReturnType<NonNullable<typeof closer>>> | undefined;
    await act(async () => {
      closed = await closer?.();
    });

    expect(closed).toEqual(Err("the game is busy and could not be closed: g1"));
    expect(kindText()).toBe("over");
    expect(closeFailureText()).toBe("the game is busy and could not be closed: g1");
  });

  test("対局が無ければ閉じても何も起きない", async () => {
    mount(alwaysContinue);

    await expect(session().closeSession()).resolves.toEqual(Ok(undefined));
    expect(tauri.closeGame).not.toHaveBeenCalled();
  });
});
