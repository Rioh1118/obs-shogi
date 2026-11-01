import type { ClocksView, GameId, GameResult, Side } from "../api/rust-types";
import type { GameSessionView, GameStartRequest } from "./types";

/**
 * 進行中の対局1局ぶんの記録。`GameSessionProvider` が1つだけ持ち、書き換えるのもそこだけ。
 *
 * 書き換えながら持つので、画面へ渡すときは `toView` を通す。
 */
export type Session = {
  /** `startGame` が解決するまで `null`。始められなかった対局は `null` のまま残る */
  gameId: GameId | null;
  kifuPath: string | null;
  startSfen: string;
  /** `continueGame` に渡す列そのもの。`startGame` に渡した `initialMoves` から始まる */
  usiMoves: string[];
  blackName: string;
  whiteName: string;
  humanSides: Side[];
  toMove: Side;
  clocks: ClocksView | null;
  awaitingRuling: boolean;
  rulingFailure: string | null;
  /**
   * 対局の手を棋譜へ積めなかった理由。`null` でなければ棋譜が対局から遅れている。
   *
   * 対局そのものは Rust の写しで進むので止まらない。止まるのは棋譜だけで、
   * 黙っていると、終局後に開き直したとき初めて後半が無いことに気づく。
   */
  boardFailure: string | null;
  /** 終局の結末と、その時の時計。`over` イベントが必ず両方を運ぶ */
  over: { result: GameResult; clocks: ClocksView } | null;
  startFailure: string | null;
  /**
   * `closeGame` が通ったか。
   *
   * 終局はエンジンを落とさないので、通るまで1局あたり最大2本が起きたままになる。
   */
  engineClosed: boolean;
  /** `closeGame` が断られた理由。押し直す人が居ないので、黙ると気づけない */
  closeFailure: string | null;
};

export const IDLE: GameSessionView = { kind: "idle", eventsUnavailable: null };

/** 始めたばかりの対局を作る */
export function createSession(request: GameStartRequest): Session {
  return {
    gameId: null,
    kifuPath: request.kifuPath,
    startSfen: request.settings.startSfen,
    usiMoves: [...(request.settings.initialMoves ?? [])],
    blackName: request.settings.black.name,
    whiteName: request.settings.white.name,
    humanSides: (["black", "white"] as const).filter(
      (side) => request.settings[side].kind === "human",
    ),
    // 最初の `turnChanged` が来るまでの仮の値。Rust は `start_game` が返る前にそれを出す
    toMove: "black",
    clocks: null,
    awaitingRuling: false,
    rulingFailure: null,
    boardFailure: null,
    over: null,
    startFailure: null,
    engineClosed: false,
    closeFailure: null,
  };
}

/** いま操作を送れる対局の識別子を返す。無ければ投げ、呼び手の `attempt` が断りの値にする */
export function requireGameId(session: Session | null): GameId {
  const gameId = session?.gameId;
  if (gameId == null) throw new Error("対局が走っていません");
  return gameId;
}

/**
 * エンジンが残っている対局か。真なら次の対局を始めない。
 *
 * 始められなかった対局は数えない。Rust は起動に失敗した対局を台帳に載せないので、
 * 数えると設定を直してもやり直せなくなる。
 *
 * `closeGame` が通った終局も数えない。断る理由はエンジンが起きたままなことなので、
 * 通った後まで断ると、結末が残っている間ずっと次の対局を始められない。
 *
 * `closeGame` が断られた終局は数える。`start` が畳み直す処理はまだ無く、
 * `closeSession` にも本番の呼び手が無いので、いまの復帰はアプリの再起動だけ（ADR-0011 決定1）。
 */
export function isHeld(session: Session | null): boolean {
  if (session === null) return false;
  if (session.startFailure !== null) return false;
  return session.over === null || !session.engineClosed;
}

/**
 * 対局の記録を画面の姿へ写す。
 *
 * `startFailure` を `gameId === null` より先に見る。始められなかった対局は両方が真で、
 * 逆の順では `failed` にならず `starting` のまま残る。
 */
export function toView(session: Session | null, eventsUnavailable: string | null): GameSessionView {
  if (session === null) {
    return eventsUnavailable === null ? IDLE : { kind: "idle", eventsUnavailable };
  }

  if (session.startFailure !== null) {
    return { kind: "failed", kifuPath: session.kifuPath, message: session.startFailure };
  }
  if (session.gameId === null) {
    return { kind: "starting", kifuPath: session.kifuPath };
  }
  if (session.over !== null) {
    return {
      kind: "over",
      gameId: session.gameId,
      kifuPath: session.kifuPath,
      blackName: session.blackName,
      whiteName: session.whiteName,
      result: session.over.result,
      clocks: session.over.clocks,
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
    // 写しを作らない。`clockUpdated` のたびに同一性が変わると、手が増えていないのに
    // 指し手列を読む側が起こされる。列は `moveDecided` が作り直すので中身は変わらない
    usiMoves: session.usiMoves,
    awaitingRuling: session.awaitingRuling,
    rulingFailure: session.rulingFailure,
    boardFailure: session.boardFailure,
  };
}
