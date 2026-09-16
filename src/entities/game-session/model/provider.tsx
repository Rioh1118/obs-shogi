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
import type { ClocksView, GameEvent, GameId, GameResult, Side } from "../api/rust-types";
import { GameSessionContext, type GameSessionContextValue } from "./context";
import type {
  GameRuling,
  GameSessionView,
  GameStartRequest,
  RulingAdapter,
  StartRefusal,
} from "./types";

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
  /**
   * 対局の手を棋譜へ積めなかった理由。**`null` でなければ、棋譜が対局から遅れている。**
   *
   * 対局そのものは Rust の写しで進むので止まらない。止まるのは棋譜だけで、
   * 黙っていると**終局後に開き直したとき初めて**後半が無いことに気づく。
   */
  boardFailure: string | null;
  result: GameResult | null;
  failure: string | null;
  /**
   * エンジンを落とし終えたか。**終局したら進行の側が自分で落とす。**
   *
   * 押させる形にしていた間は、押し忘れたぶんだけプロセスが残った ——
   * 終局は探索を畳まないので、`close_game` を通すまで最大2本が起きたままになる。
   */
  engineClosed: boolean;
  /** エンジンを落とせなかった理由。**押し直す人が居ないので、黙ると気づけない** */
  closeFailure: string | null;
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
 * - **アプリ全体で1つだけ mount すること。** 2つあると `game-event` を二重に
 *   畳み込み、同じ手に2つの裁定が出る（`ruling` 自体は無状態でよい）
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
  /**
   * 同じ値の写し。**描画ではなく購読の結果が書く。**
   *
   * render 中に `state` から写すと、`catch` が走ってから再描画が commit されるまでの間、
   * `start` は「張れている」と読む。守りたいのはまさにその窓なので、
   * 非同期の結果が直接ここへ書く。
   */
  const eventsUnavailableRef = useRef<string | null>(null);

  /**
   * 購読が張り終わるまでの待ち。**`start` はこれを待ってから始める。**
   *
   * 待たないと、起動直後に押した1局目だけが「張れているか分からないまま」始まる。
   */
  const listenSettledRef = useRef<Promise<void> | null>(null);

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
      // **判定が投げても裁定は返す。** 中身は注入された他スライスのコードで、
      // 利用者由来の SFEN とエンジンが返した指し手の上で将棋のライブラリを回す。
      // 投げたまま返さないと、画面は「裁定中」のまま 30 秒後に対局が死ぬ。
      // **終局として畳むのは、判定を組む側（`RulingAdapter` の呼び手）が
      // 「判定が落ちたら終局」と決めているのと同じ向き**
      let verdict: GameRuling;
      try {
        verdict = rulingRef.current.judge({
          startSfen: session.startSfen,
          usiMoves: session.usiMoves,
        });
      } catch (error) {
        verdict = { kind: "over", winner: null, detail: "判定できなかったため中断しました" };
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

        // **もう終わっていた、は故障ではない。** 中断や時間切れが裁定の往復に
        // 入っただけで、結末は `over` イベントが持っている。ここで立てると、
        // 自分で「中断」を押した利用者の終局画面に
        // 「アプリが裁定を返せなかったため中断されました」が出る
        if (messageOf(error) === ALREADY_OVER) return;

        // **対局は止まらない。** Rust は `RULING_TIMEOUT` の後に
        // `over { reason: "rulingTimeout" }` を出す。この文言が見えるのはそれまでの間と、
        // 終局後は `over` の欄に引き継いだぶん——理由の欄は「アプリの異常」としか
        // 言えないので、何が起きたかを持つのはこの文言だけ
        sessionRef.current.rulingFailure = messageOf(error);
        publish();
      }
    },
    [publish],
  );

  /**
   * 終局したエンジンを落とす。**利用者に押させない。**
   *
   * 終局は探索を畳まないので、`close_game` を通すまで1局あたり最大2本が起きたまま。
   * 押す口を置いていた間は、押し忘れがそのままプロセスの残りになった。
   *
   * **進行は畳まない。** `sessionRef` を消すと結果を出す先が無くなり、
   * 最後の1手を棋譜へ積む途中の橋（`GameMoveBridge`）も止まる。
   * ここで落とすのは Rust 側のプロセスだけで、結末は次の対局が始まるまで残す。
   */
  const retireEngines = useCallback(
    async (session: Session, gameId: GameId) => {
      try {
        await closeGame(gameId);
        if (sessionRef.current !== session) return;
        session.engineClosed = true;
      } catch (error) {
        if (sessionRef.current !== session) return;
        // **黙らない。** 押し直す人が居ないので、出さないと起きたままのプロセスに
        // 気づく手段が1つも無い
        session.closeFailure = messageOf(error);
      }
      publish();
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
          // **手番が移ったなら裁定は通っている。** 消さないと、直った対局に
          // 「このままだと中断されます」が最後まで残る
          session.rulingFailure = null;
          break;

        case "clockUpdated":
          session.clocks = event.clocks;
          break;

        case "moveDecided": {
          // **作り直す。** 写しを配らない代わりに、内容が変わったときだけ
          // 同一性が変わる形にする（`toView` の `usiMoves`）
          session.usiMoves = [...session.usiMoves, event.usiMove];
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
          // **終局はエンジンを畳まない。** 押させる形にしていた間は、押し忘れたぶんだけ
          // プロセスが残った。結末が決まった時点でこちらから落とす
          void retireEngines(session, session.gameId);
          break;

        // 対局中のエンジンの読み筋。**畳み込む先をまだ持っていない**——
        // 出すのは対局ビューの仕事で、置き場が決まるまで捨てる（→ 画面仕様の
        // 「いま満たしていないこと」）
        case "searchInfo":
          return;
      }

      publish();
    },
    [answerRuling, publish, retireEngines],
  );

  /** 購読の中から読む口。**effect の依存を空に保つため**（→ 購読の doc） */
  const applyRef = useRef(apply);
  applyRef.current = apply;

  /**
   * 購読はアプリの寿命で張りっぱなしにする。**依存は空。**
   *
   * **`startGame` を呼んでから張ると必ず取りこぼす**（最初の `turnChanged` は
   * `start_game` が返る前に飛ぶ）。張る/外すを対局ごとにすると、その窓が毎局できる。
   */
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    listenSettledRef.current = listenToGameEvents((event) => {
      // **ref を通す。** 直に `apply` を渡すと effect がそれに依存することになり、
      // 依存が動いた回に購読を張り直す窓ができる。その窓に `moveDecided` が落ちると
      // 裁定が返らず、対局が `RULING_TIMEOUT` で中断される
      applyRef.current(event);
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
        // **黙って捨てない。** 張れていないことに気づける場所が他に無く、
        // 気づかないまま始めた対局は「押したのに何も起きない」で終わる
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

  /**
   * 棋譜へ積めなかったことを控える。**進行そのものには触らない。**
   *
   * `sessionRef` が権威なので、そちらへ書いてから `publish` で描き直す
   * （`answerRuling` が `rulingFailure` を扱うのと同じ形）。
   */
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

  /**
   * いま始められない理由。**`null` なら始められる。**
   *
   * **`start` と押す側が同じものを通すこと。** 押す側は「棋譜を作る前に」断りを知る
   * 必要がある —— `start` は断っても何も起きないので、先に作ってしまうと
   * **対局していない棋譜が1枚できて、ドックだけが対局タブへ移る。**
   *
   * 押せるかを `view` から組み直すと材料が違う。こちらは `listenSettledRef` を
   * 待った後の ref を見るのに対し、`view` は描画時の写しなので、
   * **購読が張り終わる前に押した1回**を「張れている」と読む。
   */
  const startRefusal = useCallback(async (): Promise<StartRefusal | null> => {
    // **閉じる対象が残っているうちは始めない。** 走っている対局はもちろん、
    // 終局した対局も `closeGame` を通すまでエンジンが起きたままなので、
    // 押した回数だけプロセスが増える。
    // **始め損ねた対局（`failed`）は別** —— Rust は起動に失敗した対局を台帳に載せず、
    // 起こしたプロセスも自分で落とすので、閉じるものが無い。捨ててやり直す
    if (heldSessionOf(sessionRef.current) !== null) return "held";

    // **購読が張り終わるのを待つ。** 待たずに始めると、起動直後の1局目だけ
    // 「張れているか分からないまま」走り出す
    await listenSettledRef.current;

    // 待っている間に別の対局が始まっていることがある。**待った後にもう一度見る**
    if (heldSessionOf(sessionRef.current) !== null) return "held";

    // 出来事が届かないなら、始めても裁定を返せない
    if (eventsUnavailableRef.current !== null) return "events-unavailable";

    return null;
  }, []);

  const start = useCallback(
    async (request: GameStartRequest) => {
      // **押す側が先に見ていても、ここでもう一度見る。** 権威は `sessionRef` の側で、
      // 押す側が見てから棋譜を作るまでの間に状態は動きうる
      if ((await startRefusal()) !== null) return;

      const mine: Session = {
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
        boardFailure: null,
        result: null,
        failure: null,
        engineClosed: false,
        closeFailure: null,
      };
      sessionRef.current = mine;
      pendingRef.current = [];
      publish();

      let gameId: GameId;
      try {
        gameId = await startGame(request.settings);
      } catch (error) {
        // **同じものかを見る。** `!== null` で見ると、待っている間に閉じられて
        // 別の対局が始まっていた回に、こちらの断りをその対局へ書き込む
        if (sessionRef.current !== mine) return;
        mine.failure = messageOf(error);
        mine.gameId = null;
        pendingRef.current = [];
        publish();
        return;
      }

      // 待っている間に閉じられたか、別の対局に入れ替わった。
      // **Rust の台帳には載っているので、置き去りにせず閉じる**
      if (sessionRef.current !== mine) {
        void closeGame(gameId);
        return;
      }

      mine.gameId = gameId;

      // **溜めたものを流し直す。** `apply` は `gameId` が入った後なので、
      // ここから先は突き合わせが効く
      const buffered = pendingRef.current;
      pendingRef.current = [];
      for (const event of buffered) apply(event);

      publish();
    },
    [apply, publish, startRefusal],
  );

  const submitMove = useCallback(async (side: Side, usiMove: string): AsyncResult<void> => {
    return await attempt(() => submitGameMove(requireGameId(), side, usiMove));
  }, []);

  const resign = useCallback(
    async (side: Side): AsyncResult<void> => attempt(() => resignGame(requireGameId(), side)),
    [],
  );

  const abort = useCallback(
    async (): AsyncResult<void> => attempt(() => abortGame(requireGameId())),
    [],
  );

  const closeSession = useCallback(async (): AsyncResult<void> => {
    const session = sessionRef.current;
    if (session === null) return Ok(undefined);

    // **始め損ねた対局には閉じる相手が居ない**（台帳に載っていない）ので、捨てるだけ
    if (session.gameId === null) {
      sessionRef.current = null;
      pendingRef.current = [];
      publish();
      return Ok(undefined);
    }

    // **落ちるまで手放さない。** 先に捨てると `gameId` が消えて呼び直せなくなり、
    // 断られた回にエンジンが起きたまま画面だけが「対局していません」に戻る
    const closed = await attempt(() => closeGame(session.gameId as GameId));
    if (!closed.success) return closed;

    sessionRef.current = null;
    pendingRef.current = [];
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

  /** いま対局を指している識別子。**無ければ投げる**（`attempt` が値に畳む） */
  function requireGameId(): GameId {
    const gameId = sessionRef.current?.gameId;
    if (gameId == null) throw new Error("対局が走っていません");
    return gameId;
  }
}

/** 投げる呼び出しを値に畳む。**断りの文言はそのまま画面へ出る** */
async function attempt(run: () => Promise<void>): AsyncResult<void> {
  try {
    await run();
    return Ok(undefined);
  } catch (error) {
    return Err(messageOf(error));
  }
}

/**
 * 閉じる対象として残っている対局。**無ければ `null`。**
 *
 * 始め損ねた対局は数えない —— Rust は起動に失敗した対局を台帳に載せないので、
 * 閉じる相手が居ない。数えると、設定を直してもやり直せなくなる。
 *
 * **落とし終えた対局も数えない。** 断る理由は「エンジンが起きたままだから」なので、
 * 落ちた後まで断ると、**結末を読んでいる間ずっと次の対局を始められない**
 * ——しかも畳む口はもうどこにも無い（終局したエンジンは自分で落ちる）。
 */
function heldSessionOf(session: Session | null): Session | null {
  if (session === null) return null;
  if (isFailed(session)) return null;
  if (session.result !== null && session.engineClosed) return null;
  return session;
}

/** 始め損ねた対局か。**閉じる相手が居ないので、残っていても次を始めてよい** */
function isFailed(session: Session): boolean {
  return session.failure !== null;
}

/**
 * 進行から画面の姿へ。
 *
 * **`failure` を `gameId === null` より先に見る。** 始め損ねた対局は両方が真になるので、
 * 逆にすると「エンジンを起こしています…」から抜けられなくなる（取り消す口は無い）。
 */
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
      usiMoves: session.usiMoves,
      rulingFailure: session.rulingFailure,
      boardFailure: session.boardFailure,
      engineClosed: session.engineClosed,
      closeFailure: session.closeFailure,
    };
  }
  return {
    kind: "live",
    gameId: session.gameId,
    kifuPath: session.kifuPath,
    blackName: session.blackName,
    whiteName: session.whiteName,
    humanSides: session.humanSides,
    toMove: session.toMove,
    clocks: session.clocks,
    // **写さない。** `clockUpdated` は 500ms ごとに来るので、写すと手が増えていない
    // tick でも同一性だけが変わり、指し手列を購読する側が毎秒2回起こされる。
    // 中身を書き替えないことは `moveDecided` の側（積むときに作り直す）が守る
    usiMoves: session.usiMoves,
    awaitingRuling: session.awaitingRuling,
    rulingFailure: session.rulingFailure,
    boardFailure: session.boardFailure,
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

/**
 * 断りの文言。**そのまま画面に出る**ので、内部の語に置き換えない。
 *
 * Tauri の `invoke` は Rust の `Err(String)` を文字列で返すので普段は読めるが、
 * IPC の層が落ちた回は文字列でも `Error` でもない値が来る。
 * **`String(値)` に頼らない** —— `[object Object]` は「エラーが発生しました」と
 * 同じ情報量で、開発者にとっても原因が消える。
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
