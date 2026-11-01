import type { ClocksView, GameId, GameResult, Side } from "../api/rust-types";
import type { GameSessionView, GameStartRequest } from "./types";

/**
 * 進行中の対局1局ぶん。**画面ではなくここが持つ。**
 *
 * `usiMoves` は `continueGame` に渡す列そのもので、`startGame` に渡した
 * `initialMoves` から始まる（`api/tauri.ts`）。
 */
export type Session = {
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
  startFailure: string | null;
  /**
   * エンジンを落とし終えたか。**終局したら進行の側が自分で落とす。**
   *
   * 押させる形にしていた間は、押し忘れたぶんだけプロセスが残った ——
   * 終局は探索を畳まないので、`close_game` を通すまで最大2本が起きたままになる。
   */
  engineClosed: boolean;
  /** エンジンを落とせなかった理由。**押し直す人が居ないので、黙ると気づけない** */
  closeFailure: string | null;
};

export const IDLE: GameSessionView = { kind: "idle", eventsUnavailable: null };

/** 始めたばかりの対局 */
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
    // 最初の `turnChanged` が来るまでの仮。**手番の印に使わせない**
    // ——描く側は `clocks` が `null` の間を「まだ届いていない」として扱う
    toMove: "black",
    clocks: null,
    awaitingRuling: false,
    rulingFailure: null,
    boardFailure: null,
    result: null,
    startFailure: null,
    engineClosed: false,
    closeFailure: null,
  };
}

/** いま対局を指している識別子。**無ければ投げる**（`attempt` が値に畳む） */
export function requireGameId(session: Session | null): GameId {
  const gameId = session?.gameId;
  if (gameId == null) throw new Error("対局が走っていません");
  return gameId;
}

/**
 * 閉じる対象として残っている対局か。
 *
 * 始め損ねた対局は数えない —— Rust は起動に失敗した対局を台帳に載せないので、
 * 閉じる相手が居ない。数えると、設定を直してもやり直せなくなる。
 *
 * **落とし終えた対局も数えない。** 断る理由は「エンジンが起きたままだから」なので、
 * 落ちた後まで断ると、**結末を読んでいる間ずっと次の対局を始められない**
 * ——しかも畳む経路はもうどこにも無い（終局したエンジンは自分で落ちる）。
 */
export function isHeld(session: Session | null): boolean {
  if (session === null) return false;
  if (session.startFailure !== null) return false;
  return session.result === null || !session.engineClosed;
}

/**
 * 進行から画面の姿へ。
 *
 * **`startFailure` を `gameId === null` より先に見る。** 始め損ねた対局は両方が真になるので、
 * 逆にすると「エンジンを起こしています…」から抜けられなくなる（取り消す経路は無い）。
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
