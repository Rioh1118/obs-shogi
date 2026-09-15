// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { GameEvent, GameId, GameSettings } from "../api/rust-types";
import type { AsyncResult } from "@/shared/lib/result";
import type { GameRuling, RulingAdapter } from "../model/types";

/**
 * 対局の進行と裁定。表は `docs/state-transitions/game-session.md`（Rust 側）、
 * 画面の側は `docs/spec/screens/play-view.md`。
 *
 * ここが守っているのは1つ —— **手が決まったら必ず裁定が返る**。
 * 返らないと Rust は裁定待ちのまま止まり、`RULING_TIMEOUT` で対局が中断される。
 * **画面を畳んでも返ること**まで見る（ドックのタブは選ばれていない間アンマウントされる）。
 */

/**
 * Tauri の口。**9本すべてを並べる** —— `satisfies typeof import(...)` が
 * 落ちるので、実物に口が増えたらここも増やすことになる
 */
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

/** 張った購読。**テストから撃つ側** */
const events = vi.hoisted(() => ({
  emit: null as ((event: GameEvent) => void) | null,
  unlisten: vi.fn(),
  fail: null as string | null,
}));

vi.mock(
  "../api/events",
  () =>
    ({
      GAME_EVENT: "game-event",
      listenToGameEvents: async (callback: (event: GameEvent) => void) => {
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

/** 進行を撃つだけの器。**本体は描かない**（畳んだ状態を作るため） */
function Harness({ show }: { show: boolean }) {
  return show ? <Body /> : null;
}

function Body() {
  const { view } = useGameSession();
  return (
    <>
      <div data-testid="kind">{view.kind}</div>
      {/* **欄そのものを描く。** `kind` だけだと「黙った」変異が素通りする */}
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

function Starter() {
  const { start, closeSession } = useGameSession();
  starter = () => start({ settings: SETTINGS, kifuPath: "/w/a.kif" });
  closer = closeSession;
  return null;
}

/**
 * `start` を撃つ。**`starter?.()` にしない** —— `Starter` が描かれなかった回に
 * 何も実行せずに通ってしまい、否定を見るテストが空振りで緑になる
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
  starter = null;
  closer = null;
  tauri.startGame.mockResolvedValue(GAME_ID);
  vi.clearAllMocks();
  tauri.startGame.mockResolvedValue(GAME_ID);
});

afterEach(() => {
  cleanup();
});

describe("対局の進行", () => {
  test("手が決まったら裁定を返す。**渡すのは根からの全手**", async () => {
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

  test("2手目は1手目を含めて返す。**写しがずれると Rust が reject する**", async () => {
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

  /**
   * **これがこの層を置いた理由。** 裁定を対局ビューの中に置くと、
   * 別のタブを開いた瞬間に返す者が居なくなり、対局が `RULING_TIMEOUT` で中断される。
   */
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
   * **`gameId` は `startGame` が解決するまで手に入らない。**
   * 最初の `turnChanged` と最初の `go` はその前に走るので、
   * 素直に `event.gameId !== myGameId` で捨てると、起動直後に終わった対局の
   * `over` を必ず落とす（`api/tauri.ts` の `startGame`）。
   */
  test("`gameId` が解決する前に届いた `over` を捨てない", async () => {
    let resolveStart: (id: GameId) => void = () => {};
    tauri.startGame.mockReturnValue(
      new Promise<GameId>((resolve) => {
        resolveStart = resolve;
      }),
    );

    mount(alwaysContinue);

    // **`act` を入れ子にしない。** 解決していない `start` を中で待つと
    // 2つの `act` の範囲が混ざり、以後の描画が壊れる
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

  test("走っている対局があるうちは始めない。**押した回数だけエンジンが増えない**", async () => {
    mount(alwaysContinue);
    await act(async () => {
      await startOnce();
      await startOnce();
    });

    expect(tauri.startGame).toHaveBeenCalledTimes(1);
  });

  test("購読が張れていなければ始めない。**始めても裁定を返せない**", async () => {
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

    // **文言が画面に出ていること。** `kind` だけを見ると、欄を落とす変異が素通りする
    expect(kindText()).toBe("live");
    expect(rulingFailureText()).toBe("not awaiting a ruling");
  });

  /**
   * **「もう終わっていた」は故障ではない。**
   *
   * 「中断」は `awaitingRuling` の間も押せる。押すと Rust は `Phase::Over` になり、
   * 飛んでいた `continue_game` が `ALREADY_OVER` で断られる。これを故障として立てると、
   * **自分で中断した利用者の終局画面に**「アプリが裁定を返せなかったため中断されました
   * （game is already over）」が `role="alert"` で出る。
   * 時間切れが裁定の往復に重なった回も同じ。
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
    // Rust が `RULING_TIMEOUT` で畳む。**理由は利用者の中断と同じ値で届く**（#362）
    await emit({
      type: "over",
      gameId: GAME_ID,
      result: { winner: null, reason: "aborted", detail: "no ruling came back from the app" },
      clocks: CLOCKS,
    });

    expect(kindText()).toBe("over");
    expect(rulingFailureText()).toBe("not awaiting a ruling");
  });

  test("判定が投げても裁定は返す。**返さないと30秒で対局が死ぬ**", async () => {
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
      "判定できなかったため中断しました",
    );
    expect(rulingFailureText()).toBe("shogi.js が投げた");
  });

  /**
   * **終局したらエンジンを落とす。利用者に押させない。**
   *
   * 終局は探索を畳まないので、`close_game` を通すまで1局あたり最大2本が起きたまま。
   * 押す口を置いていた間は、押し忘れがそのままプロセスの残りになった。
   */
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
    // **結末は残す。** 畳むと結果を出す先が無くなり、最後の1手を積む橋も止まる
    expect(kindText()).toBe("over");
  });

  /**
   * **落とせなかったことを黙らない。**
   *
   * 落とすのは進行の側で、押し直す利用者が居ない ——
   * 出さないと、起きたままのプロセスに気づく手段が1つも無い。
   */
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

  /**
   * **落とし終えた対局は、次を始めるのを邪魔しない。**
   *
   * 断る理由は「エンジンが起きたままだから」なので、落ちた後まで断ると
   * 結末を読んでいる間ずっと次の対局を始められない —— しかも畳む口はもう無い。
   */
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

  /**
   * **始め損ねた対局には落とす相手が居ない。**
   *
   * Rust は起動に失敗した対局を台帳に載せず、起こしたプロセスも自分で落とす。
   * ここで `close_game` を呼ぶと、知らない識別子として断られたぶんが
   * **片付けの失敗として画面に出る**。
   */
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
