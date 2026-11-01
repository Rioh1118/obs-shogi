import type { ReactNode } from "react";
import type { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { Color, Kind } from "shogi.js";

import type { JKFData } from "@/entities/kifu/model/jkf";
import type { AsyncResult } from "@/shared/lib/result";
import {
  asBranchPlan,
  type BranchPlan,
  type CursorPath,
  type KifuCursor,
} from "@/entities/kifu/model/cursor";
import type { DeleteQuery, SwapQuery } from "@/entities/kifu/model/branch";

import type { IMove as ShogiMove } from "shogi.js";
export type { IMove as ShogiMove } from "shogi.js";

export type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

/**
 * 盤に載せられなかった理由。呼び出し側は段と文言を `code` から決める。
 *
 * 例外の `message` は `shogi.js` の英文なので、そのまま渡すと呼び出し側が自前の文言を書き、
 * 段と文言を決める場所が分かれる。`entities/file-tree` の `describeFsError` と同じ形にする。
 *
 * `cause` は診断のためだけに持つ。内部の語が混ざるので利用者に出さない。
 */
export type KifuLoadFailure = {
  /** `initial` から局面を組めない（`game.md` の E16） */
  code: "unplayable_initial";
  absPath: string;
  cause: string;
};

export type GameContextState = {
  jkf: JKFData | null;

  /** 現在局面 */
  cursor: KifuCursor | null;

  /**
   * 将来の forward / goToIndex / goToEnd で使う進路計画
   * 現在地点までの forkPointers も含む
   */
  branchPlan: BranchPlan;

  selectedPosition: SelectedPosition | null;

  /**
   * 盤に載っている棋譜のパス。
   *
   * 動くのは `game_loaded`、`reset_state`、`path_renamed` だけなので、載せられなかったとき
   * （`game.md` の E16）は前の棋譜を指したまま残る。
   *
   * ツリーの `activeKifuPath` とはずれる。あちらは構文として読めた時点で進み、
   * 盤に載るかは `loadGame` の `buildPlayer` まで来ないと分からない。
   * いま画面に出ている棋譜を問うならこちら、ツリーが開いたパスを問うならあちらを読む。
   */
  loadedAbsPath: string | null;

  /**
   * 盤の中身が入れ替わった回数。単調増加で、戻らない。
   *
   * 進むのは `game_loaded` と `reset_state`。`path_renamed` では進まない。
   * 改名と移動で変わるのは名前だけで、盤に並んでいるものは同じ。
   *
   * **「まだ同じ棋譜か」を問う読み手は、`loadedAbsPath` でなくこちらを見る。**
   * あちらは改名で動くので、パスの変化を別の棋譜と読むと、名前を直しただけで
   * その棋譜に紐づけて開いていたものが捨てられる。読み手は次の3つ。
   *
   * - `useResetOrientationOnKifuChange`（向きを落とすか）
   * - `KifuStreamList`（開いている面・確認ダイアログを畳むか）
   * - `KifuCommentNote`（書きかけの本文を、いまの棋譜へ書いてよいか）
   *
   * 名前そのものを問う読み手は `loadedAbsPath` を見る（`FileNode` の `canSkipReopen`、
   * `useHeaderCenterInfo`、`usePositionHitNavigation`）。
   *
   * 閉じても戻さない。戻すと、控えた値と同じ回数で別の入れ替わりが観測されうる。
   */
  boardSeq: number;

  /**
   * 盤に載せられなかった棋譜のパス（`game.md` の E16）。載るまで、または閉じるまで残る。
   *
   * `loadedAbsPath` が動かないことでは代用できない。読み込みの最中も
   * 「まだ載っていない」なので、失敗と区別が付かない。
   *
   * `error` と別に持つのは、あちらが文字列でパスを持たないため。
   * どのファイルの失敗かが分からないと、待っている要求と突き合わせられない。
   */
  loadFailedAbsPath: string | null;

  /**
   * `loadFailedAbsPath` が立った回数。単調増加で、戻らない。
   *
   * パスだけでは「いつ失敗したか」が分からない。待っている側は要求を出した時点の値を
   * 控えておき、それより進んでいるときだけ自分の要求が落ちたと読む
   * （`usePositionHitNavigation`）。
   *
   * 印を試行の開始で落とす形では足りない。ツリーから開く経路は `openKifuNode` が
   * ディスクを読み終えるまで `loadGame` に届かないので、その間に走った effect が
   * 前の失敗の印を読む。
   */
  loadFailedSeq: number;

  /**
   * 利用者を待たせている書き込みが1つ以上あるか。`blockingWrites > 0` と同じ値。
   *
   * 棋譜一覧の行はこれを見て無効になる。コメントの自動保存は打鍵が止まった 900ms 後に
   * 走り、次の手を押す瞬間と重なるので、立てると押した手が合図も無く捨てられる。
   *
   * 真偽値のまま `finally` で降ろさない。書き込みは並行して起動しうるので、
   * 先に終わった1つが降ろすと、残りの書き込みの最中に確認ダイアログが押し直せる状態へ戻る。
   */
  isLoading: boolean;
  /** 利用者を待たせている書き込みの本数。`isLoading` を導く */
  blockingWrites: number;
  error: string | null;
};

export type GameView = {
  player: JKFPlayer | null;

  /**
   * 盤に載せられる棋譜があるか。画面を丸ごと切り替える側が読む
   * （`AppLayout` の `WelcomeScreen` との分岐、ヘッダの中央）。
   *
   * いまは `player !== null` と同じ値になる。`buildCursorView` が `player` に入れるのは
   * `null` か `buildPlayer` の返り値だけで、`JKFPlayer` は必ず `shogi` を持つ。
   *
   * 盤の内側はこれを読まない。`Board` は `player?.shogi` で描画を止め、`Hand` は空の駒台を
   * 描く。問うているのが部品ごとの描き方なので、別の判定にしてある。
   */
  hasKifu: boolean;

  legalMoves: ShogiMove[];
  lastMove: ShogiMove | null;
  currentMove: IMoveMoveFormat | undefined;
  currentComments: string[];
  currentTurn: Color;

  /** branchPlan を考慮した終端手数 */
  totalMoves: number;

  /**
   * 現在の局面の SFEN。棋譜カーソルから導かれる射影であり、駒の選択には依存しない。
   * 手数フィールドは常に 1 以上（SFEN の手数は 1 始まり）。
   * 局面を組み立てられない間は null。
   */
  currentSfen: string | null;
};

export type GameAction =
  | {
      type: "game_loaded";
      payload: {
        jkf: JKFData;
        absPath: string;
        cursor: KifuCursor;
      };
    }
  | {
      type: "navigated";
      payload: {
        cursor: KifuCursor;
        branchPlan: BranchPlan;
      };
    }
  | {
      type: "jkf_replaced";
      payload: {
        jkf: JKFData;
        cursor: KifuCursor;
        branchPlan: BranchPlan;
      };
    }
  | {
      type: "jkf_restored";
      payload: {
        jkf: JKFData | null;
        cursor: KifuCursor | null;
        branchPlan: BranchPlan;
        /**
         * 戻す前に置いたはずの棋譜。いまの `jkf` がこれでなければ戻さない。
         *
         * 書き込みを待っている間に、別のファイルの読み込みや次の手が入る。無条件に戻すと、
         * その編集や読み込みが消える。
         * `cloneJkf` も `loadGame` も必ず新しいオブジェクトを作るので、参照の同一性で判定できる。
         */
        expectedJkf: JKFData;
        /**
         * カーソルも戻すか。
         *
         * 局面を動かさない書き込み（コメント）では戻さない。戻すと、書き込みを
         * 待っている間に利用者が進めた手数まで巻き戻り、盤と一覧が黙って戻る。
         * 指した手の巻き戻しは「その手を取り消す」なので戻す。
         *
         * **`false` にしてよいのは、棋譜の形（`moves` / `forks`）を変えない書き込みだけ。**
         * 形を変える書き込みで `false` にすると、進んだカーソルと戻した棋譜が組み合わさり、
         * `buildPlayer` が throw して盤が「棋譜ファイルを選択してください」に落ちる。
         * いま `false` が渡るのは `setCommentsByCursor` だけで、`comments` しか触らない。
         */
        restoreCursor: boolean;
      };
    }
  /**
   * 盤に載っている棋譜が改名または移動された。張り替えるのは宛先だけ。
   *
   * 盤に並んでいるものは変わらないので `jkf` / `cursor` / `branchPlan` に触らない。
   * 載せ直すと、file-tree が開いた時点で持った `jkfData` で置き換わり、
   * 盤も棋譜一覧もカーソルもその時点まで戻る。
   *
   * 宛先は動かす。`persistence.absPath` は新しいパスで組み直されるので、
   * `loadedAbsPath` を据え置くと `persistIfPossible` の突き合わせが一致しなくなり、
   * 以後の書き込みが全部止まる。
   */
  | {
      type: "path_renamed";
      payload: { absPath: string };
    }
  | {
      type: "set_selection";
      payload: SelectedPosition;
    }
  | {
      type: "clear_selection";
    }
  // 真偽値でなく数える。並行する書き込みのうち先に終わった1つが「操作中」を解くため
  // （`isLoading` の doc）。
  // 撃った回数と同じだけ、**同じ `blocking` で** `write_ended` を撃つこと（`finally` で1回）。
  | {
      type: "write_started";
      payload: { blocking: boolean };
    }
  | {
      type: "write_ended";
      payload: { blocking: boolean };
    }
  | {
      type: "set_error";
      payload: string;
    }
  /**
   * 盤に載せられなかった（E16）。`error` と違いどのファイルかを持つので、
   * その棋譜を待っている側が要求を捨てられる。
   */
  | {
      type: "load_failed";
      payload: { absPath: string };
    }
  // 書き込みが失敗したときの `set_error`。待っている間に棋譜が別物に
  // なっていたら積まない（`jkf_restored` の `expectedJkf` と同じ判定）。
  | {
      type: "write_failed";
      payload: {
        error: string;
        /** 書こうとした棋譜。いまの `jkf` がこれでなければ、この失敗は積まない */
        expectedJkf: JKFData;
      };
    }
  | {
      type: "clear_error";
    }
  | {
      type: "reset_state";
    };

export const initialGameState: GameContextState = {
  jkf: null,
  cursor: null,
  branchPlan: asBranchPlan([]),
  selectedPosition: null,
  loadedAbsPath: null,
  boardSeq: 0,
  loadFailedAbsPath: null,
  loadFailedSeq: 0,
  isLoading: false,
  blockingWrites: 0,
  error: null,
};

export type StandardMoveFormat = {
  from?: { x: number; y: number };
  to: { x: number; y: number };
  piece: Kind;
  promote?: boolean;
  color: Color;
};

export type GamePersistence = {
  /**
   * `save` が書き込む先。
   *
   * `persistence` は `activeKifuPath`（file-tree 側）から組まれ、`state.loadedAbsPath` が
   * 追いつくのは橋渡しの effect が走った後になる。このずれの中で書くと
   * **前の棋譜が新しいファイルへ入る**ので、突き合わせられるように宛先を値で持たせる。
   */
  absPath: string;
  save: (jkf: JKFData) => AsyncResult<void, string>;
};

export type GameContextType = {
  state: GameContextState;
  view: GameView;

  /**
   * 棋譜を盤に載せる。投げず、載せられなければ `Err` で `KifuLoadFailure` が返る。
   *
   * `state.error` にも積むが、それを描く部品は無い。伝えるのはこの戻り値を読む側の仕事で、
   * 捨てると盤も棋譜一覧も前の棋譜のまま何も出ない（`failure-surfacing.md` の F-31）。
   */
  loadGame: (jkf: JKFData, absPath: string) => AsyncResult<void, KifuLoadFailure>;
  resetGame: () => void;

  /**
   * 盤に載っている棋譜の宛先だけを、改名または移動の後のパスへ張り替える。
   * ディスクの改名は済んでいる前提で、盤、カーソル、分岐の選択、`boardSeq` は動かない。
   *
   * **同じ棋譜であることを確かめてから呼ぶこと。** 確かめられるのは
   * `GameFileTreeBridge` だけで、ツリーが持つ `jkfData` の同一性がその根拠
   * （`entities/file-tree` の `jkfData` の doc）。別の棋譜を指して呼ぶと
   * `persistIfPossible` の突き合わせが通り、盤の棋譜が別のファイルへ書き込まれる。
   */
  renameLoadedPath: (absPath: string) => void;

  goToIndex: (index: number) => void;
  nextMove: () => void;
  previousMove: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  selectSquare: (x: number, y: number, promote?: boolean) => Promise<void>;
  selectHand: (color: Color, kind: Kind) => void;
  clearSelection: () => void;

  // 棋譜を書き換える操作。どれも throw せず、失敗は `Err` で返る。
  //
  // `state.error` にも積むが、それを描く部品はまだ無い。
  // 戻り値を捨てると、書けなかったことが利用者にも呼び出し側にも届かない。
  // 捨てるのが正しい呼び出しは `// async-result-ignored: <理由>` を付けること
  // （`src/__tests__/asyncResultUse.test.ts`）。
  //
  // `Ok` は棋譜が意図どおりになったことを表す。変える必要が無かった場合も `Ok` を返す。
  makeMove: (move: StandardMoveFormat) => AsyncResult<void, string>;
  swapBranches: (q: SwapQuery) => AsyncResult<void, string>;
  deleteBranch: (q: DeleteQuery) => AsyncResult<void, string>;

  getCommentsByCursor: (cursor: CursorPath | null) => string[];
  setCommentsByCursor: (cursor: CursorPath, comments: string[]) => AsyncResult<void, string>;

  clearError: () => void;

  canGoForward: () => boolean;
  canGoBackward: () => boolean;

  getCurrentTurn: () => Color;
  getCurrentMoveIndex: () => number;
  getTotalMoves: () => number;

  /**
   * 指定の位置へ盤を移す。
   *
   * `CursorPath` を取るのは `tesuuPointer` を読まないから。着いた先の
   * `KifuCursor` は `cursorFromPlayer` が player から作り直す。要求した局面に
   * 着いたかは `state.cursor` を見ること。
   *
   * `cursor.tesuu` より先の `ForkPointer` は捨てずに `branchPlan` へ引き継ぐ。
   */
  applyCursor: (cursor: CursorPath) => void;
};

/**
 * 盤で決まった手を、棋譜へ積む前に通すかを決める判定。
 *
 * 対局中に Rust が採るまで積まないために要る。盤は手番の所有者を見ないので、
 * これが無いと相手の手番でも積んで自動保存まで走る。
 *
 * 注入で受けるのは、対局（`entities/game-session`）を知っているのが上の層だから。
 * ここから読むと互いを読み合う組ができる。
 */
export type MoveGate = {
  /** `false` なら積まない */
  accept: (move: StandardMoveFormat, line: BoardLine) => Promise<boolean>;
};

/**
 * 盤がいま辿っている線。`MoveGate` はこれだけで対局の先端かを判じる。
 *
 * 手数は渡さない。同じ深さの別の線と見分けが付かないので、
 * `MoveGate` が対局の次の1手と分岐で指した手を取り違える。
 */
export type BoardLine = {
  /**
   * 盤にいま載っている棋譜。対局は棋譜が入れ替わっても走り続けるので、
   * 別の棋譜を触っているだけの操作を止めないために渡す。
   */
  kifuPath: string | null;
  /** 根からの USI の綴り。綴れない手があれば `null`（`lineUsiMoves`） */
  usiMoves: string[] | null;
};

export type GameProviderProps = {
  children: ReactNode;
  persistence?: GamePersistence;
  /** 省略すると素通しになる。対局を知らない呼び手（テスト）はそのまま指せる */
  moveGate?: MoveGate;
};
