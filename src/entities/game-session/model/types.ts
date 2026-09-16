import type { ClocksView, GameId, GameResult, GameSettings, Side } from "../api/rust-types";

/**
 * 裁定の答え。**`moveDecided` を受けたら必ずどちらかを返す。**
 *
 * どちらも返さないと Rust は裁定待ちのまま止まり、`RULING_TIMEOUT` で畳まれる
 * （`api/tauri.ts` の `continueGame`）。
 */
export type GameRuling =
  /** まだ続く。`continueGame` を投げる */
  | { kind: "continue" }
  /**
   * 終局。`endGameByRule` を投げる。
   *
   * `detail` は棋譜と画面に残る説明で、**文言を決めるのは裁定を返す側**
   * （`judgeGameOutcome` は種別と勝者しか返さない）。
   */
  | { kind: "over"; winner: Side | null; detail: string };

/** 根からの進行。`judgeGameOutcome` の `GameProgress` と同じ形 */
export interface GameProgressView {
  /** 対局の根の局面。**`startpos` は受け付けない** */
  startSfen: string;
  /** 根から現在までの USI 指し手。途中局面から始めた対局なら `initialMoves` も含む */
  usiMoves: readonly string[];
}

/**
 * 裁定を返す口。**注入で受ける。**
 *
 * 判定そのものは `entities/game`（`judgeGameOutcome`）が持っているが、
 * **このスライスから直に読めない** —— あちらが `Side` をここから取っているので、
 * 読み返すと互いを読み合う組ができて `src/__tests__/crossSliceImports.test.ts` が落ちる。
 * `AnalysisProvider` が `PositionSyncAdapter` を prop で受けているのと同じ形で外から渡す。
 *
 * **判定が失敗したときに何を返すかも、渡す側が決める。** ここで既定を持つと、
 * 「詰んでいるのに続行を返す」のような既定が2箇所に生える。
 */
export interface RulingAdapter {
  judge: (progress: GameProgressView) => GameRuling;
}

/**
 * 画面に出る対局の姿。**`GameSnapshot`（Rust が返す形）とは別物。**
 *
 * あちらは問い合わせの返り値で、こちらは**イベントを畳み込んだ結果**。
 * 対局がどの棋譜のものかは Rust 側に欄が無いので、こちらだけが持つ。
 */
export type GameSessionView =
  /**
   * 対局を持っていない。
   *
   * `eventsUnavailable` が `null` でなければ**出来事の購読そのものが張れていない**。
   * このまま始めると、手が決まっても裁定を返す者が居ないので
   * 必ず `RULING_TIMEOUT` で畳まれる。**始めさせないこと。**
   */
  | { kind: "idle"; eventsUnavailable: string | null }
  /**
   * `startGame` がまだ解決していない。
   *
   * **数十秒続きうる**（評価関数の重いエンジン）。取り消す口は無いので、
   * 押した側はここで待つことになる（`api/tauri.ts` の `startGame`）。
   */
  | { kind: "starting"; kifuPath: string | null }
  /** 対局中。手番と時計は Rust が決める */
  | {
      kind: "live";
      gameId: GameId;
      kifuPath: string | null;
      blackName: string;
      whiteName: string;
      /**
       * 人が座っている席。**投了できるのはここだけ。**
       *
       * `resignGame` はエンジンの席を指すと Rust が断るので、
       * エンジン同士の対局には投了の口が無い（中断しかできない）。
       */
      humanSides: readonly Side[];
      /** いま着手を待っている側 */
      toMove: Side;
      /**
       * **最初のイベントが届くまで `null`。**
       *
       * `startGame` は最初の `turnChanged` を返る前に投げるが、こちらが
       * それを畳み込むまでは持ち時間の値をどこからも取れない。0 で埋めると
       * 「時間切れ寸前の対局」として描かれる
       */
      clocks: ClocksView | null;
      /** 根からの指し手。**`continueGame` に渡している列と同じもの** */
      usiMoves: readonly string[];
      /** 手が決まってから裁定を返すまでの窓に居るか */
      awaitingRuling: boolean;
      /**
       * 裁定を返せなかったときの文言。**`null` でなければ故障。**
       *
       * 裁定の断りは**どれも呼び直しで直らない**（`api/tauri.ts` の `continueGame`）
       * ので、ここに載った時点で対局は `RULING_TIMEOUT` に向かっている。
       * 黙って捨てると、画面は動いているのに対局だけが止まる
       */
      rulingFailure: string | null;
      /**
       * 対局の手を棋譜へ積めなかった理由。**`null` でなければ棋譜が対局から遅れている。**
       *
       * 対局は Rust の写しで進むので止まらない。**止まるのは棋譜だけ。**
       */
      boardFailure: string | null;
    }
  /**
   * 終局。**エンジンは進行の側が自分で落とす**（`closeGame` を利用者に押させない）。
   *
   * 落とし終えるまでの短い間だけ `engineClosed` が `false` で、
   * その間に始めようとする対局は断られる（`heldSessionOf`）。
   */
  | {
      kind: "over";
      gameId: GameId;
      kifuPath: string | null;
      blackName: string;
      whiteName: string;
      result: GameResult;
      clocks: ClocksView;
      usiMoves: readonly string[];
      /**
       * 裁定を返せなかったまま終局した場合の文言。
       *
       * **終局と一緒に消さない。** 理由が `rulingTimeout` なら「アプリの異常」は
       * 理由の欄が言えるが、**断られた裁定が `endGameByRule` で通った回は
       * 理由が `rule` になる**——そのとき故障を言える欄はここしか無い。
       * 何が起きたかを言うのもこちらで、理由の欄は名詞1つしか持たない。
       */
      rulingFailure: string | null;
      /**
       * 対局の手を棋譜へ積めなかった理由。**`null` でなければ棋譜が対局から遅れている。**
       *
       * 対局は Rust の写しで進むので止まらない。**止まるのは棋譜だけ。**
       */
      boardFailure: string | null;
      /** エンジンを落とし終えたか。**`false` のうちは次の対局を始められない** */
      engineClosed: boolean;
      /**
       * エンジンを落とせなかった理由。
       *
       * **黙らない。** 落とすのは進行の側で、押し直す利用者が居ない ——
       * 出さないと、起きたままのプロセスに気づく手段が1つも無い。
       */
      closeFailure: string | null;
    }
  /**
   * 始められなかった。**`gameId` が無いので閉じる対象も無い**
   * ——Rust は起動に失敗した対局を台帳に載せず、起こしたプロセスも自分で落とす。
   *
   * 設定の誤り（実行ファイルが `usiok` で答えない、`setoption` が拒まれた）と
   * 内部の取り落としが同じ形で届くので、**原因を断言しない**
   * （`api/tauri.ts` の `startGame`）。
   *
   * **ここから `start` をやり直せる。** 閉じる対象が無いので、
   * 「閉じる」を通させる理由が無い。
   */
  | { kind: "failed"; kifuPath: string | null; message: string };

/**
 * いま対局を始められない理由。
 *
 * **押せるかの判定も、実際に断る判定も、同じ関数から引くこと。**
 * 画面が `view` から組み直すと材料が違う —— `view` は描画時の写しなので、
 * **購読が張り終わる前に押した1回**を「張れている」と読む。
 */
export type StartRefusal =
  /** 閉じていない対局がある。エンジンが起きたままなので、押した回数だけ増える */
  | "held"
  /** 出来事の購読が張れていない。始めても裁定を返せず、必ず中断される */
  | "events-unavailable";

/** 対局を始めるときに渡すもの。**宛先が2つに割れている** */
export interface GameStartRequest {
  /** Rust へ渡す対局者・持ち時間・開始局面 */
  settings: GameSettings;
  /**
   * この対局が属する棋譜。**Rust は持たない。**
   *
   * `GameSettings` にも `GameSnapshot` にも棋譜を指す欄が1つも無いので、
   * 「いま盤に出ている棋譜の対局か」を判定できるのはこちら側だけ。
   */
  kifuPath: string | null;
}
