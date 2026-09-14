import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listenToGameEvents } from "../api/events";
import {
  abortGame,
  closeGame,
  continueGame,
  endGameByRule,
  resignGame,
  startGame,
} from "../api/tauri";
import type { ClocksView, GameEvent, GameId, GameResult, Side } from "../api/rust-types";
import { GameSessionContext } from "./context";
import type { GameSessionView, GameStartRequest, RulingAdapter } from "./types";

/**
 * 進行中の対局1局ぶん。**画面ではなくここが持つ。**
 *
 * `usiMoves` は `continueGame` に渡す列そのもので、`startGame` に渡した
 * `initialMoves` から始まる（`api/tauri.ts`）。
 */
interface Session {
  gameId: GameId | null;
  kifuPath: string | null;
  startSfen: string;
  usiMoves: string[];
  blackName: string;
  whiteName: string;
  humanSides: Side[];
  toMove: Side;
  clocks: ClocksView | null;
  awaitingRuling: boolean;
  rulingFailure: string | null;
  result: GameResult | null;
  failure: string | null;
}

const IDLE: GameSessionView = { kind: "idle", eventsUnavailable: null };

/**
 * 対局の進行を持つ層。
 *
 * **呼び手が守ること。**
 *
 * - **ドックのタブの中に置かない。** タブは選ばれていない間アンマウントされるので、
 *   裁定を返す者が居なくなり、対局が `RULING_TIMEOUT` で中断される。
 *   置き場は `RuntimeProviders`（`AnalysisProvider` と同じ理由だが、
 *   破れたときに失うのは表示ではなく**対局そのもの**）
 * - **棋譜の有無で畳まれない位置に置くこと。** 対局中に別の棋譜を開くと
 *   ドックごと作り直されるが、対局は走り続けている
 * - `ruling` は**アプリ全体で1つ**を渡すこと。2つあると、同じ手に2つの裁定が出る
 *
 * **持てる対局は1局だけ。** `start_game` は台帳に載る数を見ないので
 * （1局あたりエンジンのプロセスが最大2本立つ）、押した回数だけ増えないように
 * ここで断る。Rust 側にも上限を置く話は #382。
 */
export function GameSessionProvider({
  children,
  ruling,
}: {
  children: ReactNode;
  ruling: RulingAdapter;
}) {
  /**
   * 進行の権威。**state ではなく ref に置く。**
   *
   * イベントの畳み込みは `await` を跨ぐ（裁定を投げてから次のイベントが来る）ので、
   * state を読むと**1手前の指し手列**で `continueGame` を呼ぶ窓ができる。
   * そこがずれると Rust の写しと食い違って reject され、呼び直しても直らない。
   */
  const sessionRef = useRef<Session | null>(null);

  /** 描くための写し。`publish` 以外で書かない */
  const [view, setView] = useState<GameSessionView>(IDLE);

  /**
   * `gameId` が解決する前に届いたイベント。
   *
   * **捨てない。** 最初の `turnChanged` と最初の `go` は `start_game` が返る前に走り、
   * 評価関数のパスを間違えたエンジンは起動段を通って最初の `go` で落ちるので、
   * `over` までここに溜まる（`api/tauri.ts` の `startGame`）。
   */
  const pendingRef = useRef<GameEvent[]>([]);

  /** 裁定を返す口。**effect の中から読むので ref に映す**（毎回張り直さないため） */
  const rulingRef = useRef(ruling);
  rulingRef.current = ruling;

  /**
   * 出来事の購読が張れなかったときの文言。
   *
   * **張れていないまま対局を始めると、手が決まっても裁定を返す者が居ない**ので、
   * 必ず `RULING_TIMEOUT` で中断される。始めさせないための旗で、
   * `null` でなければ `start` が断る。
   */
  const [eventsUnavailable, setEventsUnavailable] = useState<string | null>(null);
  const eventsUnavailableRef = useRef<string | null>(null);
  eventsUnavailableRef.current = eventsUnavailable;

  const publish = useCallback(() => {
    setView(toView(sessionRef.current, eventsUnavailableRef.current));
  }, []);

  /**
   * 裁定を返す。**`moveDecided` を受けたら必ずここを通る。**
   *
   * 断りは呼び直しで直らないので、再試行しない。代わりに文言を画面へ出す
   * （出さないと、対局だけが止まって画面は動いたままになる）。
   */
  const answerRuling = useCallback(
    async (session: Session, gameId: GameId) => {
      const verdict = rulingRef.current.judge({
        startSfen: session.startSfen,
        usiMoves: session.usiMoves,
      });

      try {
        if (verdict.kind === "continue") {
          await continueGame(gameId, [...session.usiMoves]);
        } else {
          await endGameByRule(gameId, verdict.winner, verdict.detail);
        }
      } catch (error) {
        // **`over` が来れば上書きされる。** 来ないまま `RULING_TIMEOUT` に達した回だけ
        // これが残り、そのときは「裁定が返らなかった」として畳まれる（#362 で
        // 利用者の中断と同じ値になる）
        if (sessionRef.current?.gameId === gameId) {
          sessionRef.current.rulingFailure = messageOf(error);
          publish();
        }
      }
    },
    [publish],
  );

  const apply = useCallback(
    (event: GameEvent) => {
      const session = sessionRef.current;
      if (session === null) return;

      // **解決前は溜める。** ここで `gameId` を突き合わせると、起動直後に
      // 終わった対局の `over` を必ず捨てることになる
      if (session.gameId === null) {
        pendingRef.current.push(event);
        return;
      }
      // 別の対局のもの。1局しか持たないので、届くのは閉じ損ねた前の対局のぶん
      if (event.gameId !== session.gameId) return;

      switch (event.type) {
        case "turnChanged":
          session.toMove = event.side;
          session.clocks = event.clocks;
          session.awaitingRuling = false;
          break;

        case "clockUpdated":
          session.clocks = event.clocks;
          break;

        case "moveDecided": {
          session.usiMoves.push(event.usiMove);
          session.clocks = event.clocks;
          session.awaitingRuling = true;
          publish();
          void answerRuling(session, session.gameId);
          return;
        }

        case "over":
          session.result = event.result;
          session.clocks = event.clocks;
          session.awaitingRuling = false;
          break;

        // 対局中のエンジンの読み筋。**畳み込む先をまだ持っていない**——
        // 出すのは対局ビューの仕事で、置き場が決まるまで捨てる（→ 画面仕様の
        // 「いま満たしていないこと」）
        case "searchInfo":
          return;
      }

      publish();
    },
    [answerRuling, publish],
  );

  /**
   * 購読はアプリの寿命で張りっぱなしにする。
   *
   * **`startGame` を呼んでから張ると必ず取りこぼす**（最初の `turnChanged` は
   * `start_game` が返る前に飛ぶ）。張る/外すを対局ごとにすると、その窓が毎局できる。
   */
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    listenToGameEvents((event) => {
      apply(event);
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
        setEventsUnavailable(null);
      })
      .catch((error: unknown) => {
        // **黙って捨てない。** 張れていないことに気づける場所が他に無く、
        // 気づかないまま始めた対局は「押したのに何も起きない」で終わる
        if (!disposed) setEventsUnavailable(messageOf(error));
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [apply]);

  // 購読の可否は `publish` を通らずに変わるので、ここで写しに反映させる
  useEffect(() => {
    publish();
  }, [eventsUnavailable, publish]);

  const start = useCallback(
    async (request: GameStartRequest) => {
      // **走っている対局があるうちは始めない。** 終局していても `closeGame` を
      // 通していなければエンジンは起きたままなので、断る側に倒す
      if (sessionRef.current !== null) return;

      // 出来事が届かないなら、始めても裁定を返せない
      if (eventsUnavailableRef.current !== null) return;

      sessionRef.current = {
        gameId: null,
        kifuPath: request.kifuPath,
        startSfen: request.settings.startSfen,
        usiMoves: [...(request.settings.initialMoves ?? [])],
        blackName: request.settings.black.name,
        whiteName: request.settings.white.name,
        humanSides: (["black", "white"] as const).filter(
          (side) => request.settings[side].kind === "human",
        ),
        // 最初の `turnChanged` が来るまでの仮。**盤には出さない**（`clocks` が
        // `null` のうちは対局ビューが手番を描かない）
        toMove: "black",
        clocks: null,
        awaitingRuling: false,
        rulingFailure: null,
        result: null,
        failure: null,
      };
      pendingRef.current = [];
      publish();

      let gameId: GameId;
      try {
        gameId = await startGame(request.settings);
      } catch (error) {
        if (sessionRef.current !== null) {
          sessionRef.current.failure = messageOf(error);
          sessionRef.current.gameId = null;
        }
        pendingRef.current = [];
        publish();
        return;
      }

      const session = sessionRef.current;
      // 待っている間に閉じられた
      if (session === null) return;

      session.gameId = gameId;

      // **溜めたものを流し直す。** `apply` は `gameId` が入った後なので、
      // ここから先は突き合わせが効く
      const buffered = pendingRef.current;
      pendingRef.current = [];
      for (const event of buffered) apply(event);

      publish();
    },
    [apply, publish],
  );

  const resign = useCallback(async (side: Side) => {
    const gameId = sessionRef.current?.gameId;
    if (gameId == null) return;
    await resignGame(gameId, side);
  }, []);

  const abort = useCallback(async () => {
    const gameId = sessionRef.current?.gameId;
    if (gameId == null) return;
    await abortGame(gameId);
  }, []);

  const close = useCallback(async () => {
    const session = sessionRef.current;
    if (session === null) return;

    // **先に手放す。** `closeGame` は「止める → 畳み待ち → 落とす」の順で
    // 時間がかかるので、待つ間ずっと終局した対局が画面に残る。
    // 落とせなかった場合は `Err` が投げられ、呼び出し側が出す
    sessionRef.current = null;
    pendingRef.current = [];
    publish();

    if (session.gameId !== null) await closeGame(session.gameId);
  }, [publish]);

  return (
    <GameSessionContext.Provider value={{ view, start, resign, abort, close }}>
      {children}
    </GameSessionContext.Provider>
  );
}

/** 進行から画面の姿へ。**判定の順は「始まっていない → 終わった → 進んでいる」** */
function toView(session: Session | null, eventsUnavailable: string | null): GameSessionView {
  if (session === null) {
    return eventsUnavailable === null ? IDLE : { kind: "idle", eventsUnavailable };
  }

  if (session.failure !== null) {
    return { kind: "failed", kifuPath: session.kifuPath, message: session.failure };
  }
  if (session.gameId === null) {
    return { kind: "starting", kifuPath: session.kifuPath };
  }
  if (session.result !== null) {
    return {
      kind: "over",
      gameId: session.gameId,
      kifuPath: session.kifuPath,
      blackName: session.blackName,
      whiteName: session.whiteName,
      result: session.result,
      // `over` は必ず時計を載せて届くので、ここに来た時点で `null` ではない
      clocks: session.clocks ?? emptyClocks(),
      usiMoves: [...session.usiMoves],
    };
  }
  return {
    kind: "live",
    gameId: session.gameId,
    kifuPath: session.kifuPath,
    blackName: session.blackName,
    whiteName: session.whiteName,
    humanSides: [...session.humanSides],
    toMove: session.toMove,
    clocks: session.clocks,
    usiMoves: [...session.usiMoves],
    awaitingRuling: session.awaitingRuling,
    rulingFailure: session.rulingFailure,
  };
}

/**
 * 終局の時計が1度も届かなかったときの埋め草。
 *
 * **`over` は必ず時計を載せるので、通る経路は無い。** それでも 0 を置くのは、
 * `null` を許すと終局の表示だけが「時計が無い」枝を持つことになるため。
 */
function emptyClocks(): ClocksView {
  const zero = { mainMs: 0, byoyomiMs: 0 };
  return { black: zero, white: zero, running: null };
}

/** 断りの文言。**そのまま画面に出る**ので、内部の語に置き換えない */
function messageOf(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}
