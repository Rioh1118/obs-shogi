/**
 * `src-tauri/src/engine/game/types.ts` の写し。
 *
 * 綴りは ADR-0007（境界に出る型は camelCase、値つき enum は internally tagged）。
 * 線に出る実際の形は Rust 側の
 * `engine::game::types::tests::the_wire_shape_is_camel_case_all_the_way_down`
 * が固定している。**この写しを直したらあちらも見ること。**
 *
 * `entities/game` の型とは別物。あちらは「棋譜を読んでいる状態」で、
 * ここは「対局が進んでいる状態」。
 */
import type { AnalysisResult } from "@/entities/engine";

export type GameId = string;

/** SFEN の2番目のフィールド（`b` / `w`）と対応する */
export type Side = "black" | "white";

/**
 * 対局者。人とエンジンが同じ型に入る。
 *
 * 分けると、進行側が「相手が人かエンジンか」を至る所で見ることになり、
 * 人対人・人対エンジン・エンジン対エンジンを同じ経路で回せなくなる。
 */
export type PlayerSpec =
  | { kind: "human"; name: string }
  | {
      kind: "engine";
      name: string;
      enginePath: string;
      /** 省略時は実行ファイルの置き場 */
      workDir?: string | null;
      options?: Record<string, string>;
      /** 相手の手番の間も読ませるか */
      ponder?: boolean;
    };

/**
 * 片側の持ち時間。
 *
 * **秒読みとフィッシャーは同時に使えない**（どちらを優先するかがエンジンごとに
 * 割れるため、Rust 側が入口で断る）。3つとも 0 も断られる。
 */
export interface TimeLimit {
  mainMs: number;
  /** 1手ごとに与え直される */
  byoyomiMs: number;
  /** 着手できたときに持ち時間へ加算する量 */
  incrementMs: number;
}

export interface GameSettings {
  black: PlayerSpec;
  white: PlayerSpec;
  blackTime: TimeLimit;
  whiteTime: TimeLimit;
  /**
   * 根の局面の SFEN。**`startpos` は受け付けない**
   * （Rust 側が `position sfen` を前置するので壊れた行になる）
   */
  startSfen: string;
  /** 根から対局開始局面までに既に指されている手 */
  initialMoves?: string[];
  /**
   * エンジンの時間切れを GUI 側で成立させるか。既定 false。
   * この打ち切りが当たるのはたいてい GUI 側の取りこぼしのため
   */
  enforceEngineTimeout?: boolean;
}

/**
 * 終局の理由。
 *
 * **`rule` だけがフロント発**。詰み・千日手・持将棋・最大手数・反則は
 * すべて `endGameByRule` から入る。残りは Rust が自分で決める。
 *
 * その判定はまだ実装されていない → #354。
 */
export type GameOverReason =
  | "resign"
  | "declareWin"
  | "timeout"
  | "engineFailure"
  | "rule"
  | "aborted";

export interface GameResult {
  /** 引き分けなら null */
  winner: Side | null;
  reason: GameOverReason;
  detail: string | null;
}

export interface ClockView {
  remainingMs: number;
  /** 持ち時間が残っている間は秒読みの設定値のまま */
  byoyomiLeftMs: number;
}

export interface ClocksView {
  black: ClockView;
  white: ClockView;
}

export type GamePhaseView =
  | { phase: "thinking"; side: Side }
  /** `continueGame` か `endGameByRule` を呼ぶまで進まない。時計は止まっている */
  | { phase: "awaitingRuling"; lastMover: Side; usiMove: string }
  | { phase: "over"; result: GameResult };

export interface GameSnapshot {
  gameId: GameId;
  blackName: string;
  whiteName: string;
  phase: GamePhaseView;
  /**
   * Rust が持っている指し手列。**権威はこちら側の棋譜**で、
   * これは `continueGame` が毎手上書きする写し。食い違いの検出に使う
   */
  moves: string[];
  clocks: ClocksView;
}

/** `game-event` で届く。`type` で判別する */
export type GameEvent =
  | { type: "turnChanged"; gameId: GameId; side: Side; clocks: ClocksView }
  | { type: "searchInfo"; gameId: GameId; side: Side; result: AnalysisResult }
  /**
   * 手が決まった。**ここで対局は止まる。**
   *
   * この手の合法性と、指した後の局面が終局かどうか（詰み・千日手・持将棋・
   * 最大手数）を判定して、`continueGame` か `endGameByRule` を呼ぶこと。
   * どちらも呼ばないと次の手番は始まらない（30秒で中断される）。
   */
  | {
      type: "moveDecided";
      gameId: GameId;
      side: Side;
      usiMove: string;
      elapsedMs: number;
      clocks: ClocksView;
    }
  | { type: "clockUpdated"; gameId: GameId; clocks: ClocksView }
  | { type: "over"; gameId: GameId; result: GameResult; clocks: ClocksView };
