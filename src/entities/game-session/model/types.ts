import type { ClocksView, GameId, GameResult, GameSettings, Side } from "../api/rust-types";

/** 手が決まった局面への裁定。`moveDecided` のたびに1つ返す */
export type GameRuling =
  /** 対局は続く。`continueGame` を呼ぶ */
  | { kind: "continue" }
  /**
   * 終局。`endGameByRule` を呼ぶ。
   *
   * `detail` は `over` の結末に載って返る説明で、文言は裁定を返す側が決める。
   */
  | { kind: "over"; winner: Side | null; detail: string };

/** 裁定に渡す、根からの進行。`entities/game` の `GameProgress` と同じ形 */
export type GameProgressView = {
  /** 対局の根の局面。`startpos` は受け付けない */
  startSfen: string;
  /** 根から現在までの USI 指し手。途中局面から始めた対局なら `initialMoves` も含む */
  usiMoves: readonly string[];
};

/**
 * 進行から裁定を返す実装。実体は `features/game-ruling` の `createRulingAdapter`。
 *
 * 判定は `entities/game` が持つが、あちらが `Side` をここから読むので、読み返すと
 * 互いを読み合う組ができて `src/__tests__/crossSliceImports.test.ts` が落ちる。
 * `AnalysisProvider` が `PositionSyncAdapter` を prop で受けるのと同じ形で外から渡す。
 *
 * 判定の失敗に何を返すかは実装が決める。`judge` が投げたときだけ、
 * `GameSessionProvider` が裁定を返せるよう終局にする。
 */
export type RulingAdapter = {
  judge: (progress: GameProgressView) => GameRuling;
};

/** Rust の台帳に載った対局が `live` でも `over` でも持つ欄 */
type StartedGame = {
  gameId: GameId;
  kifuPath: string | null;
  blackName: string;
  whiteName: string;
  /** 根からの指し手。`continueGame` に渡す列と同じもの */
  usiMoves: readonly string[];
  /**
   * 判定が投げた文言か、Rust が裁定を断った文言。`null` でなければ故障。
   *
   * Rust の断りは呼び直しで直らないので、載った対局は `RULING_TIMEOUT` で終局する。
   * 終局しても消さない。投げた中身と断りの文言はこの欄にしか残らない。
   */
  rulingFailure: string | null;
  /**
   * 対局の手を棋譜へ積めなかった理由。`null` でなければ棋譜が対局から遅れている。
   *
   * 対局は Rust の写しで進むので止まらない。止まるのは棋譜だけ。
   */
  boardFailure: string | null;
};

/**
 * 画面へ渡す対局の姿。`game-event` を畳み込んだ結果で、Rust が問い合わせに返す
 * `GameSnapshot` とは別物。
 *
 * 対局がどの棋譜のものかは Rust 側に欄が無いので、こちらだけが持つ。
 */
export type GameSessionView =
  /**
   * 対局を持っていない。
   *
   * `eventsUnavailable` が `null` でなければ出来事の購読が張れていない。
   * 始めても裁定を返せないので、`startRefusal` が断る。
   */
  | { kind: "idle"; eventsUnavailable: string | null }
  /**
   * `startGame` がまだ解決していない。数十秒続くことがある（`api/tauri.ts` の `startGame`）。
   *
   * Rust に取り消すコマンドは無い。`closeSession` で手放しても、起動は解決まで走り、
   * 解決してから畳む。
   */
  | { kind: "starting"; kifuPath: string | null }
  /** 対局中。手番と時計は Rust が決める */
  | (StartedGame & {
      kind: "live";
      /**
       * 人が座っている席。Rust はエンジンの席の着手と投了を断るので、操作できるのはここだけ。
       */
      humanSides: readonly Side[];
      /** いま着手を待っている側 */
      toMove: Side;
      /**
       * 最初の `turnChanged` を畳み込むまで `null`。0 で埋めると時間切れ寸前の対局に見える。
       */
      clocks: ClocksView | null;
      /** 手が決まり、次の `turnChanged` か `over` を待っているか */
      awaitingRuling: boolean;
    })
  /**
   * 終局。`GameSessionProvider` が `closeGame` でエンジンを落とす。
   *
   * `engineClosed` が `false` の間は、次の対局が断られる（`isHeld`）。
   */
  | (StartedGame & {
      kind: "over";
      result: GameResult;
      clocks: ClocksView;
      /** `closeGame` が通ったか */
      engineClosed: boolean;
      /**
       * `closeGame` が断られた理由。呼び直す者が居ないので、起きたままのプロセスを知る
       * 手掛かりはこの欄だけ。
       */
      closeFailure: string | null;
    })
  /**
   * 始められなかった。Rust は起動に失敗した対局を台帳に載せないので、畳むものが無く、
   * このまま `start` をやり直せる。
   *
   * 設定の誤りと内部の取り落としが同じ形で届くので、原因を断言しない
   * （`api/tauri.ts` の `startGame`）。
   */
  | { kind: "failed"; kifuPath: string | null; message: string };

/** いま対局を始められない理由。`startRefusal` が返す */
export type StartRefusal =
  /** エンジンが残っている対局がある。始めると押した回数だけプロセスが増える */
  | "held"
  /** 出来事の購読が張れていない。始めても裁定を返せず、必ず「アプリの異常」で終局する */
  | "events-unavailable";

/** 対局を始めるときに渡すもの */
export type GameStartRequest = {
  /** Rust へ渡す対局者・持ち時間・開始局面 */
  settings: GameSettings;
  /**
   * この対局が属する棋譜。
   *
   * Rust は棋譜を指す欄を持たないので、盤に出ている棋譜の対局かを判定できるのはこちらだけ。
   */
  kifuPath: string | null;
};
