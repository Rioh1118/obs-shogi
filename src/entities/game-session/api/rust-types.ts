/**
 * `src-tauri/src/engine/game/types.rs` の写し。`entities/game` の型とは別物で、
 * あちらは棋譜を読んでいる状態、ここは対局が進んでいる状態を表す。
 *
 * 綴りは ADR-0007（camelCase、値つき enum は internally tagged）。`searchInfo` が運ぶ
 * `AnalysisResult` だけは snake_case のまま（`engine/types.rs` は移行の対象外）。
 *
 * Rust の検査が2つある。線に出る形は
 * `engine::game::types::tests::the_wire_shape_is_camel_case_all_the_way_down`、
 * Rust の欄がここに全部あることは `the_typescript_copy_has_every_field` が見る。
 * 逆向き（ここにあって Rust に無い欄）は serde が捨てるので見ていない。
 */
import type { AnalysisResult, SetOptionValue } from "@/entities/engine";

declare const gameIdBrand: unique symbol;

/**
 * 対局を指す値。線に出る形は文字列で、Rust 側も newtype で持つ。
 *
 * brand を付けるのは、`submitGameMove(usiMove, side, gameId)` と引数を並べ替えたときに
 * tsc で止めるため。`as GameId` は書かず、`startGame`、`listGames`、`getGameState`、
 * `game-event` が返した値を使う。
 */
export type GameId = string & { readonly [gameIdBrand]: true };

/** SFEN の2番目のフィールド（`b` / `w`）と対応する */
export type Side = "black" | "white";

/**
 * 対局者1人の設定。人とエンジンを1つの型にして、組み合わせによらず同じ経路で進める。
 */
export type PlayerSpec =
  | {
      kind: "human";
      /**
       * 対局者の表示名。上限は Rust の `MAX_NAME_BYTES` で、超えると `startGame` が断る。
       * バイトで数えるので、日本語なら上限の約 1/3 の文字数。
       */
      name: string;
    }
  | {
      kind: "engine";
      /**
       * 対局者の表示名。上限は `human` と同じ。
       *
       * エンジンの `id name` をそのまま入れない。長さを見ずに保持される値なので、
       * 長い名乗りのエンジンを選ぶと、利用者が入力していない値で `startGame` が断られる。
       */
      name: string;
      enginePath: string;
      /** 省略時は実行ファイルの置き場 */
      workDir?: string | null;
      /**
       * `setoption` で送る値。並べた順に送られる。
       *
       * 連想配列にしないのは、値の解釈が前の `setoption` に依存するエンジンがあるため
       * （`EvalDir` を変えてから `EvalFile` を指す）。順序が崩れると同じ設定で棋力が変わる。
       *
       * 件数は Rust の `MAX_SENT_OPTIONS`、名前と値の長さは `MAX_WIRE_FIELD` まで。超えると
       * `startGame` が断る。
       */
      options?: SetOptionValue[];
      /** 相手の手番の間も読ませるか */
      ponder?: boolean;
    };

/**
 * 片側の持ち時間。
 *
 * 通る形は4つ。
 *
 * - 切れ負け: `mainMs > 0`、秒読みも加算も 0
 * - 秒読み: `byoyomiMs > 0`。`mainMs` は 0 でもよい
 * - フィッシャー: `incrementMs > 0`。`mainMs` は 0 でもよい
 * - 秒読み付きの持ち時間: `mainMs > 0 && byoyomiMs > 0`
 *
 * 断られる形は `TimeLimit::validate` と `validate_settings` が持ち、理由は
 * `startGame` の `Err` の文言に出る。
 */
export type TimeLimit = {
  mainMs: number;
  /** 1手ごとに与え直される */
  byoyomiMs: number;
  /**
   * 着手できたときに持ち時間へ加算する量。
   *
   * 開始時の残り時間には初手のぶんが積まれている（→ `ClockView.mainMs`）。積まないと、
   * 持ち時間0のフィッシャーで初手に使える時間が 0 になる。
   */
  incrementMs: number;
};

export type GameSettings = {
  black: PlayerSpec;
  white: PlayerSpec;
  blackTime: TimeLimit;
  whiteTime: TimeLimit;
  /**
   * 根の局面の SFEN。`startpos` は受け付けない（Rust が `position sfen` を前置する）。
   *
   * 長さの上限は Rust の `MAX_WIRE_FIELD`。毎手 `position` の1行に載るため。
   */
  startSfen: string;
  /**
   * 根から対局開始局面までに指されている手。
   *
   * Rust の `MAX_PLIES` より少なくなければ断られる。最低1手は指せる必要があるため。
   */
  initialMoves?: string[];
  /**
   * エンジンの時間切れを GUI 側で成立させるか。既定 false。
   * この打ち切りが当たるのはたいてい GUI 側の取りこぼしのため
   */
  enforceEngineTimeout?: boolean;
};

/**
 * 終局の理由。画面の語は ADR-0011 決定1 にある。
 *
 * こちらの呼び出しから入るのは3つで、残りは Rust が決める。
 *
 * - `rule`: `endGameByRule` か、Rust が手数の上限（`MAX_PLIES`）に当たったとき。
 *   後者は呼んでいないのに届き、`detail` は Rust の英文。自分の呼び出しのこだまとして捨てない
 * - `resign`: `resignGame`。エンジンの投了は Rust が決める
 * - `aborted`: `abortGame`。走っている対局への `closeGame` も、畳む前に中断を通すのでここへ入る
 *
 * `rulingTimeout` は「アプリの異常」で、裁定が `RULING_TIMEOUT` の間返らず Rust が終局させた
 * 対局。利用者の `aborted` とは対処が正反対なので値を分ける。
 *
 * 画面の語へ直す写しはいま無い。作るときは `Record<GameOverReason, string>` で持ち、
 * 網羅を tsc に見させる。Rust にだけ綴りを足すと `src/__tests__/gameOverReasonWire.test.ts`
 * が落ちる。
 */
export type GameOverReason =
  | "resign"
  | "declareWin"
  | "timeout"
  | "engineFailure"
  | "rule"
  | "aborted"
  | "rulingTimeout";

export type GameResult = {
  /** 引き分けなら null */
  winner: Side | null;
  reason: GameOverReason;
  detail: string | null;
};

/** 片側の時計 */
export type ClockView = {
  /**
   * 持ち時間の残り。止まっている値なので、動いている側では手番開始時の値のまま。
   * その側の残りは `RunningClock.mainZeroAt` から求める。
   *
   * 開始時は `TimeLimit.mainMs + incrementMs` で、設定した持ち時間そのものではない。
   */
  mainMs: number;
  /** 秒読みの設定値。1手ごとに与え直されるので常にこの値で、動いている側の表示の上限になる */
  byoyomiMs: number;
};

/**
 * 動いている側と、その表示が 0 になる時刻（UNIX epoch のミリ秒）。
 *
 * 減る値ではなく尽きる時刻を受け、「持ち時間の後に秒読み」の規則を Rust に閉じる。
 * 表示は次の形で求める。
 *
 * ```ts
 * const main = Math.max(0, running.mainZeroAt - Date.now());
 * const byoyomi = Math.min(clock.byoyomiMs, Math.max(0, running.byoyomiZeroAt - Date.now()));
 * ```
 *
 * 時間切れの判定には使わない。Rust が単調時計で測って `over` を出す。
 * ここの時刻は表示のためだけで、壁時計が飛べばずれ、次の更新で入れ直る。
 */
export type RunningClock = {
  side: Side;
  mainZeroAt: number;
  byoyomiZeroAt: number;
};

export type ClocksView = {
  black: ClockView;
  white: ClockView;
  /**
   * 動いている時計。`null` は対局が止まったことを意味しない。
   *
   * `null` になるのは4つ。
   *
   * 1. 裁定待ち
   * 2. 終局後
   * 3. 手番だが、止めた探索の畳み待ちで `go` をまだ出していない。`phase` は `thinking` の
   *    まま。通常は数百ミリ秒、長くて `SETTLE_TIMEOUT`
   * 4. Rust の壁時計が取れない。`phase` は何でもありうる
   *
   * 3 は渡す先に畳む探索があったときだけ起き、`ponder` の既定は false なので既定の設定では
   * 起きない。それ以外の `turnChanged` は `running` を載せて届く。受け手は有無で分岐する。
   * 毎手 `null` と決め打って捨てると、次の `clockUpdated` まで期限を持たず止まって見える。
   */
  running: RunningClock | null;
};

export type GamePhaseView =
  /** 着手を待っている。時計が動いているとは限らない（`ClocksView.running` の 3） */
  | { phase: "thinking"; side: Side }
  /** `continueGame` か `endGameByRule` を呼ぶまで進まない。時計は止まっている */
  | { phase: "awaitingRuling"; lastMover: Side; usiMove: string }
  | { phase: "over"; result: GameResult };

export type GameSnapshot = {
  gameId: GameId;
  blackName: string;
  whiteName: string;
  phase: GamePhaseView;
  /**
   * Rust が持つ指し手列。権威はこちらの指し手列で、これは `continueGame` が毎手上書きする写し
   */
  moves: string[];
  clocks: ClocksView;
};

/** `game-event` で届く。`type` で判別する */
export type GameEvent =
  | { type: "turnChanged"; gameId: GameId; side: Side; clocks: ClocksView }
  | { type: "searchInfo"; gameId: GameId; side: Side; result: AnalysisResult }
  /**
   * 手が決まり、対局が裁定待ちで止まった。
   *
   * 裁定を判定して `continueGame` か `endGameByRule` を呼ぶ。どちらも呼ばないと次の手番は
   * 始まらず、`RULING_TIMEOUT` で終局する。
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
