import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import { listenToGameEvents } from "../api/events";
import {
  abortGame,
  closeGame,
  continueGame,
  endGameByRule,
  resignGame,
  startGame,
  submitGameMove,
  ALREADY_OVER,
} from "../api/tauri";
import type { GameEvent, GameId, Side } from "../api/rust-types";
import { GameSessionContext, type GameSessionContextValue } from "./context";
import { createSession, IDLE, isHeld, requireGameId, toView, type Session } from "./session";
import type {
  GameRuling,
  GameSessionView,
  GameStartRequest,
  RulingAdapter,
  StartRefusal,
} from "./types";

/** 投げる呼び出しを `Result` にする。断りの文言は `messageOf` を通して呼び手へ返す */
async function attempt(run: () => Promise<void>): AsyncResult<void> {
  try {
    await run();
    return Ok(undefined);
  } catch (error) {
    return Err(messageOf(error));
  }
}

/**
 * 投げられた値を断りの文言にする。
 *
 * Tauri の `invoke` は Rust の `Err(String)` を文字列で返すが、IPC の層が落ちたときは
 * 文字列でも `Error` でもない値が来る。`String(値)` は `[object Object]` になり原因が消えるので、
 * JSON で読めるなら JSON にする。
 */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  try {
    const json = JSON.stringify(error);
    if (json !== undefined && json !== "{}") return json;
  } catch {
    // 循環参照。下の定型文へ落とす
  }
  return "原因を取得できませんでした";
}

/**
 * 対局の進行を持ち、手が決まるたびに裁定を Rust へ返す。
 *
 * 呼び手が守ること。
 *
 * - `RuntimeProviders` に置き、ドックのタブの中に置かない。タブは選ばれていない間
 *   アンマウントされるので、裁定を返す者が居なくなり、対局が `RULING_TIMEOUT` で終局する
 * - 棋譜の有無で外れない位置に置く。対局中に別の棋譜を開いても対局は走り続ける
 * - アプリ全体で1つだけ mount する。2つあると `game-event` を二重に受け、同じ手に
 *   2つの裁定を返す
 *
 * 持てる対局は1局だけで、2局目は `startRefusal` が断る。`start_game` は台帳に載る数を
 * 見ず、1局あたりエンジンのプロセスが最大2本立つ。
 */
export function GameSessionProvider({
  children,
  ruling,
}: {
  children: ReactNode;
  ruling: RulingAdapter;
}) {
  /**
   * 進行の権威。state ではなく ref に置く。
   *
   * 出来事は描画を待たずに続けて届くので、state を読むと1手前の指し手列で
   * `continueGame` を呼ぶことがある。Rust の写しと食い違って断られ、呼び直しても直らない。
   */
  const sessionRef = useRef<Session | null>(null);

  /** 描くための写し。`publish` 以外で書かない */
  const [view, setView] = useState<GameSessionView>(IDLE);

  /**
   * `gameId` が解決する前に届いた出来事。`start` が解決した後に流し直す。
   *
   * 最初の `turnChanged` と最初の `go` は `start_game` が返る前に走るので、
   * 最初の `go` で落ちたエンジンの `over` もここに溜まる（`api/tauri.ts` の `startGame`）。
   */
  const pendingEventsRef = useRef<GameEvent[]>([]);

  /** 裁定を返す実装。`answerRuling` の依存を増やさないよう ref に写す */
  const rulingRef = useRef(ruling);
  rulingRef.current = ruling;

  /**
   * 出来事の購読が張れなかったときの文言。`null` でなければ `startRefusal` が断る。
   *
   * 張れていないまま始めると手が決まっても裁定を返せず、必ず `RULING_TIMEOUT` で終局する。
   */
  const [eventsUnavailable, setEventsUnavailable] = useState<string | null>(null);
  /**
   * `eventsUnavailable` と同じ値。描画ではなく購読の結果が書く。
   *
   * render 中に state から写すと、`catch` が走ってから再描画が commit されるまでの間、
   * `startRefusal` が「張れている」と読む。
   */
  const eventsUnavailableRef = useRef<string | null>(null);

  /** 購読の成否が決まるまでの待ち。`startRefusal` が待つ */
  const listenSettledRef = useRef<Promise<void> | null>(null);

  const publish = useCallback(() => {
    setView(toView(sessionRef.current, eventsUnavailableRef.current));
  }, []);

  /**
   * `moveDecided` を受けた手へ裁定を返す。
   *
   * 断りは呼び直しで直らないので再試行しない。文言は `rulingFailure` に載せる。
   */
  const answerRuling = useCallback(
    async (session: Session, gameId: GameId) => {
      // 判定が投げても裁定は返す。返さないと対局は `RULING_TIMEOUT` で「アプリの異常」になる。
      // 終局にするのは、`createRulingAdapter` が判定の失敗を終局にするのと同じ向き
      let verdict: GameRuling;
      try {
        verdict = rulingRef.current.judge({
          startSfen: session.startSfen,
          usiMoves: session.usiMoves,
        });
      } catch (error) {
        // 文言に「中断」と書かない。その語は利用者の意思で終わらせたときのもの（ADR-0011 決定1）
        verdict = { kind: "over", winner: null, detail: "判定できなかったため終局にしました" };
        if (sessionRef.current?.gameId === gameId) {
          sessionRef.current.rulingFailure = messageOf(error);
          publish();
        }
      }

      try {
        if (verdict.kind === "continue") {
          await continueGame(gameId, [...session.usiMoves]);
        } else {
          await endGameByRule(gameId, verdict.winner, verdict.detail);
        }
        return;
      } catch (error) {
        if (sessionRef.current?.gameId !== gameId) return;

        // 中断や時間切れが裁定の往復に入っただけで、故障ではない。結末は `over` が運ぶ。
        // `rulingFailure` に載せると、自分で中断した対局が故障として残る
        if (messageOf(error) === ALREADY_OVER) return;

        // 断られた対局は `RULING_TIMEOUT` の後に `rulingTimeout` で終局する。
        // `over` の `detail` は Rust の文言で、断られた呼び出しの文言はここにしか残らない
        sessionRef.current.rulingFailure = messageOf(error);
        publish();
      }
    },
    [publish],
  );

  /**
   * 終局した対局のエンジンを落とす。
   *
   * 終局はエンジンを落とさないので、`close_game` を通すまで1局あたり最大2本が起きたままになる。
   *
   * `sessionRef` は残す。消すと結末を渡す先が無くなり、最後の手を棋譜へ積む
   * `GameMoveBridge` も止まる。結末は次の対局が始まるまで残る。
   */
  const retireEngines = useCallback(
    async (session: Session, gameId: GameId) => {
      try {
        await closeGame(gameId);
        if (sessionRef.current !== session) return;
        session.engineClosed = true;
      } catch (error) {
        if (sessionRef.current !== session) return;
        // 呼び直す者が居ないので、残さないと起きたままのプロセスに気づけない
        session.closeFailure = messageOf(error);
      }
      publish();
    },
    [publish],
  );

  const applyEvent = useCallback(
    (event: GameEvent) => {
      const session = sessionRef.current;
      if (session === null) return;

      // 解決前は溜める。ここで `gameId` を突き合わせると、起動直後に終局した対局の `over` を捨てる
      if (session.gameId === null) {
        pendingEventsRef.current.push(event);
        return;
      }
      // 1局しか持たないので、届くのは手放した前の対局のもの
      if (event.gameId !== session.gameId) return;

      switch (event.type) {
        case "turnChanged":
          session.toMove = event.side;
          session.clocks = event.clocks;
          session.awaitingRuling = false;
          // 手番が移ったなら裁定は通っている。消さないと直った対局に故障が残る
          session.rulingFailure = null;
          break;

        case "clockUpdated":
          session.clocks = event.clocks;
          break;

        case "moveDecided": {
          // 作り直す。内容が変わったときだけ同一性が変わる（`toView` の `usiMoves`）
          session.usiMoves = [...session.usiMoves, event.usiMove];
          session.clocks = event.clocks;
          session.awaitingRuling = true;
          publish();
          void answerRuling(session, session.gameId);
          return;
        }

        case "over":
          session.over = { result: event.result, clocks: event.clocks };
          void retireEngines(session, session.gameId);
          break;

        // 読み筋を出す面がまだ無いので捨てる。置き場は ADR-0011 決定4 が決めてある
        case "searchInfo":
          return;
      }

      publish();
    },
    [answerRuling, publish, retireEngines],
  );

  /** 購読の中から読む `applyEvent`。購読の effect の依存を空に保つために ref を通す */
  const applyEventRef = useRef(applyEvent);
  applyEventRef.current = applyEvent;

  // 購読はアプリの寿命で張り続ける。`startGame` を呼んでから張ると、`start_game` が
  // 返る前に飛ぶ最初の `turnChanged` を取りこぼす
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    listenSettledRef.current = listenToGameEvents((event) => {
      // 直に渡すと、依存が動くたびに購読を張り直す。その間に届いた `moveDecided` は
      // 裁定が返らず、対局が `RULING_TIMEOUT` で終局する
      applyEventRef.current(event);
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
        eventsUnavailableRef.current = null;
        setEventsUnavailable(null);
      })
      .catch((error: unknown) => {
        // 張れなかったことを知る経路は他に無い
        if (disposed) return;
        eventsUnavailableRef.current = messageOf(error);
        setEventsUnavailable(eventsUnavailableRef.current);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 購読の可否は `publish` を通らずに変わるので、ここで写しに反映させる
  useEffect(() => {
    publish();
  }, [eventsUnavailable, publish]);

  const reportBoardFailure = useCallback(
    (message: string | null) => {
      const session = sessionRef.current;
      if (session === null) return;
      if (session.boardFailure === message) return;

      session.boardFailure = message;
      publish();
    },
    [publish],
  );

  const startRefusal = useCallback(async (): Promise<StartRefusal | null> => {
    // 待たないと、起動直後の1局目だけ購読の成否が分からないまま始まる。
    // 待っている間に別の対局が始まることがあるので、判定はこの後に置く
    await listenSettledRef.current;

    if (isHeld(sessionRef.current)) return "held";

    if (eventsUnavailableRef.current !== null) return "events-unavailable";

    return null;
  }, []);

  const start = useCallback(
    async (request: GameStartRequest) => {
      // 呼び手が見た後、棋譜を作る間に状態が動くことがあるので、もう一度見る
      if ((await startRefusal()) !== null) return;

      const mine = createSession(request);
      sessionRef.current = mine;
      pendingEventsRef.current = [];
      publish();

      let gameId: GameId;
      try {
        gameId = await startGame(request.settings);
      } catch (error) {
        // 待っている間に手放され、別の対局が始まっていることがある
        if (sessionRef.current !== mine) return;
        mine.startFailure = messageOf(error);
        pendingEventsRef.current = [];
        publish();
        return;
      }

      // 待っている間に手放された。Rust の台帳には載っているので、ここで畳む
      if (sessionRef.current !== mine) {
        void closeGame(gameId);
        return;
      }

      mine.gameId = gameId;

      // `gameId` が入ったので、流し直すと別の対局の出来事は捨てられる
      const buffered = pendingEventsRef.current;
      pendingEventsRef.current = [];
      for (const event of buffered) applyEvent(event);

      publish();
    },
    [applyEvent, publish, startRefusal],
  );

  const submitMove = useCallback(async (side: Side, usiMove: string): AsyncResult<void> => {
    return await attempt(() => submitGameMove(requireGameId(sessionRef.current), side, usiMove));
  }, []);

  const resign = useCallback(async (side: Side): AsyncResult<void> => {
    return await attempt(() => resignGame(requireGameId(sessionRef.current), side));
  }, []);

  const abort = useCallback(async (): AsyncResult<void> => {
    return await attempt(() => abortGame(requireGameId(sessionRef.current)));
  }, []);

  const closeSession = useCallback(async (): AsyncResult<void> => {
    const session = sessionRef.current;
    if (session === null) return Ok(undefined);

    const { gameId } = session;

    // 始められなかった対局も、エンジンを落とし終えた対局も、Rust の台帳に居ない。
    // `close_game` を通すと `unknown game` で断られ、結末を手放せなくなる
    if (gameId !== null && !session.engineClosed) {
      // 落ちるまで手放さない。先に捨てると、断られたときに呼び直す `gameId` が残らず、
      // エンジンが起きたまま `view` だけが `idle` に戻る
      const closed = await attempt(() => closeGame(gameId));
      if (!closed.success) return closed;
    }

    sessionRef.current = null;
    pendingEventsRef.current = [];
    publish();
    return Ok(undefined);
  }, [publish]);

  const value = useMemo<GameSessionContextValue>(
    () => ({
      view,
      start,
      startRefusal,
      submitMove,
      resign,
      abort,
      closeSession,
      reportBoardFailure,
    }),
    [view, start, startRefusal, submitMove, resign, abort, closeSession, reportBoardFailure],
  );

  return <GameSessionContext.Provider value={value}>{children}</GameSessionContext.Provider>;
}
