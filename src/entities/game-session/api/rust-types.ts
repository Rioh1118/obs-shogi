/**
 * `src-tauri/src/engine/game/types.rs` の写し。
 *
 * 綴りは ADR-0007（境界に出る型は camelCase、値つき enum は internally tagged）。
 * **ただし `searchInfo` が運ぶ `AnalysisResult` だけは snake_case のまま**
 * （`engine/types.rs` は ADR-0007 の移行対象外として据え置かれている）。
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
/**
 * 片側の持ち時間。
 *
 * **通る形は4つ。**
 *
 * - 切れ負け: `mainMs > 0`、秒読みも加算も 0
 * - 秒読み: `byoyomiMs > 0`。`mainMs` は 0 でもよい
 * - フィッシャー: `incrementMs > 0`。`mainMs` は 0 でもよい
 * - 秒読み付きの持ち時間: `mainMs > 0 && byoyomiMs > 0`
 *
 * **弾かれる形**（`startGame` が英文の `Err` で reject する）。
 *
 * - 秒読みと加算を同時に指定した（どちらを優先するかがエンジンごとに割れる）
 * - 3つとも 0（初手で必ず時間切れになる）
 * - どれか1つが24時間を超えた
 * - 先手と後手で、片方が秒読み・もう片方が加算（`go` に両方は載せられない）
 */
export interface TimeLimit {
  mainMs: number;
  /** 1手ごとに与え直される */
  byoyomiMs: number;
  /**
   * 着手できたときに持ち時間へ加算する量。
   *
   * **開始時の残り時間には初手ぶんが既に積まれている**
   * （`ClockView.mainMs` は `mainMs + incrementMs` から始まる）。
   * 積まないと「持ち時間0のフィッシャー」で初手に使える時間が 0 になる。
   * 設定した値をそのまま画面に出したいなら `GameSettings` 側を見ること
   */
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
 * **こちらの呼び出しから入るのは3つ。**
 *
 * - `rule` — `endGameByRule`。詰み・千日手・持将棋・最大手数・反則。
 *   **その判定はまだ実装されていない** → #354
 * - `resign` — `resignGame`（人間の投了）。エンジンの投了は Rust が決める
 * - `aborted` — `abortGame`。**ただし「裁定を30秒返さなかった」ときも
 *   同じ値になる。** いまの型では区別できない
 *
 * `timeout` / `engineFailure` / `declareWin` は Rust が決める。
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

/**
 * 片側の時計。**2つの欄で性質が違う。**
 *
 * `mainMs` は止まっている値なので、動いている側では手番開始時の古い値。
 * `byoyomiMs` は設定値で常に正しく、**動いている側のクランプに要る**。
 */
export interface ClockView {
  /**
   * 持ち時間の残り。動いている側は `RunningClock.mainZeroAt` を使う。
   *
   * 開始時は `TimeLimit.mainMs + incrementMs`。
   * **利用者が設定した持ち時間そのものではない**（→ `TimeLimit.incrementMs`）
   */
  mainMs: number;
  /** 秒読みの設定値。1手ごとに与え直されるので常にこの値 */
  byoyomiMs: number;
}

/**
 * 動いている側と、その表示が 0 になる時刻（UNIX epoch のミリ秒）。
 *
 * **減っていく値ではなく、尽きる時刻が来る。** こちら側は
 * `deadline - Date.now()` をクランプして出すだけで、
 * 減らすループも「持ち時間の後に秒読み」の規則も持たない。
 * その規則は Rust の中で完結する。
 *
 * ```ts
 * const main = Math.max(0, running.mainZeroAt - Date.now());
 * const byoyomi = Math.min(clock.byoyomiMs, Math.max(0, running.byoyomiZeroAt - Date.now()));
 * ```
 *
 * **時間切れの判定には使わないこと。** それは Rust が単調時計で測って
 * `over` を出す。ここの時刻は表示のためだけで、壁時計が飛べばずれる
 * （次の更新で入れ直る）。
 */
export interface RunningClock {
  side: Side;
  mainZeroAt: number;
  byoyomiZeroAt: number;
}

export interface ClocksView {
  black: ClockView;
  white: ClockView;
  /**
   * 動いている時計。**null を「対局が止まった」と読まないこと。**
   *
   * null になるのは4つ。
   *
   * 1. 裁定待ち（`awaitingRuling`）
   * 2. 終局後（`over`）
   * 3. **手番だが Rust がまだエンジンに考え始めさせていない**（前の思考の畳み待ち）。
   *    `phase` は `thinking` のまま。通常は数百ミリ秒、長くて10秒
   * 4. **Rust 側の壁時計が取れない**。`phase` は何でもありうる
   *
   * 3 は毎手通る。`turnChanged` を null で受け取ってから、
   * 次の `clockUpdated` で動き出す。**そこで時計を止めて描くと、
   * 相手の手番の頭で毎回止まって見える。**
   */
  running: RunningClock | null;
}

export type GamePhaseView =
  /** 着手を待っている。**時計が動いているとは限らない**（`ClocksView.running` の 3） */
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
