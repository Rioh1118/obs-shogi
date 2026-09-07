import type { ReactNode } from "react";
import { JKFPlayer } from "json-kifu-format";
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

export interface GameContextState {
  jkf: JKFData | null;

  /** 現在局面 */
  cursor: KifuCursor | null;

  /**
   * 将来の forward / goToIndex / goToEnd で使う進路計画
   * 現在地点までの forkPointers も含む
   */
  branchPlan: BranchPlan;

  selectedPosition: SelectedPosition | null;

  /** 現在ロードしている棋譜ファイル（未選択なら null） */
  loadedAbsPath: string | null;

  /**
   * 盤に載せられなかった棋譜のパス（`game.md` の E16）。載るまで、または閉じるまで残る。
   *
   * **`loadedAbsPath` が動かないことでは代用できない。** 読み込みが進行中の1レンダぶんも
   * 「まだ載っていない」なので、その2つは区別が付かない。**待っている側が
   * 「もう来ない」と判断できる唯一の合図**がこれ（`usePositionHitNavigation`）。
   *
   * `error` と別に持つのは、あちらが文字列でパスを持たないため。
   * どのファイルの失敗かが分からないと、待っている要求と突き合わせられない
   */
  loadFailedAbsPath: string | null;

  /**
   * **利用者を待たせている**書き込みが1つ以上あるか。`blockingWrites > 0` の射影。
   *
   * これを見て棋譜一覧の行が無効になる。だから
   * **利用者が起動していない書き込み（コメントの自動保存）では立てない**。
   * 自動保存は打鍵が止まった 900ms 後に撃つので、書き終えて次の手をクリックする
   * 瞬間と正確に重なる。そこで行が反応しなくなると、合図も無くクリックが捨てられる。
   *
   * **真偽値のまま `finally` で降ろさない。** 書き込みは並行して起動しうるので、
   * 先に終わった1つが false を撃つと、まだ走っている書き込みの最中に「操作中」が解け、
   * 確認ダイアログが押し直せる状態へ戻る。
   */
  isLoading: boolean;
  /** 利用者を待たせている書き込みの本数。`isLoading` を導く */
  blockingWrites: number;
  error: string | null;
}

export interface GameView {
  player: JKFPlayer | null;

  /**
   * 盤に載せられる棋譜があるか。**画面を丸ごと切り替える側の綴りはこれ**
   * （`AppLayout` の `WelcomeScreen` との分岐、ヘッダの中央）。
   *
   * `player` があれば `shogi` も必ずある——`loadGame` が `buildPlayer` で門番していて、
   * `cursorView` が `player` に入れるのは `null` か `buildPlayer` の返り値だけ。
   * `?.shogi` を残してあるのは `cursorView` の catch を将来ゆるめたときの保険で、
   * **いま `player !== null` と同値**。
   *
   * **盤の内側は寄せていない。** `Board` は `player?.shogi` を直に見て自分の描画を
   * 止める。`Hand` は止めず、空の駒台を描く。あちらは「この部品が描けるか」で、
   * こちらとは別の問い。
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
}

export type GameAction =
  | {
      type: "game_loaded";
      payload: {
        jkf: JKFData;
        absPath: string | null;
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
         * 戻す前に置いたはずの棋譜。**いまの `jkf` がこれでなければ戻さない。**
         *
         * 書き込みを待っている間に、別のファイルが読み込まれたり次の手が指されたりする。
         * 無条件に戻すと、その編集や読み込みを**巻き戻しが消す**。
         * `cloneJkf` も `loadGame` も必ず新しいオブジェクトを作るので、参照の同一性で判定できる。
         */
        expectedJkf: JKFData;
        /**
         * カーソルも戻すか。
         *
         * **局面を動かさない書き込み（コメント）では戻さない。** 戻すと、書き込みを
         * 待っている間に利用者が進めた手数まで巻き戻り、盤と一覧が黙って戻る。
         * 指した手の巻き戻しは「その手を取り消す」なので戻す。
         *
         * **`false` にしてよいのは、棋譜の形（`moves` / `forks`）を変えない書き込みだけ。**
         * 形を変えるのにカーソルを動かさない書き込みで `false` にすると、
         * 進んだカーソルと戻した棋譜が組み合わさり、`buildPlayer` が throw して
         * 盤が「棋譜ファイルを選択してください」に落ちる。
         * いま `false` が渡るのは `setCommentsByCursor` だけで、`comments` しか触らない。
         */
        restoreCursor: boolean;
      };
    }
  | {
      type: "set_selection";
      payload: SelectedPosition | null;
    }
  | {
      type: "clear_selection";
    }
  // 数える。**真偽値を撃たない。** 並行する書き込みのうち先に終わった1つが
  // 「操作中」を解いてしまうため（`isLoading` の doc を参照）。
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
      payload: string | null;
    }
  /**
   * 盤に載せられなかった（E16）。`error` と違い**どのファイルかを持つ**ので、
   * その棋譜を待っている側が要求を捨てられる
   */
  | {
      type: "load_failed";
      payload: { absPath: string | null };
    }
  // 書き込みが失敗したときの `set_error`。**待っている間に棋譜が別物に
  // なっていたら積まない**（`jkf_restored` の `expectedJkf` と同じ判定）。
  | {
      type: "write_failed";
      payload: {
        error: string;
        /** 書こうとした棋譜。いまの `jkf` がこれでなければ、この失敗はもう誰のものでもない */
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
  loadFailedAbsPath: null,
  isLoading: false,
  blockingWrites: 0,
  error: null,
};

export interface JKFPlayerHelpers {
  isLegalMove: (player: JKFPlayer, move: ShogiMove) => boolean;
  canPromoteMove: (player: JKFPlayer, move: ShogiMove) => boolean;
  mustPromoteMove: (player: JKFPlayer, move: ShogiMove) => boolean;
}

export interface StandardMoveFormat {
  from?: { x: number; y: number };
  to: { x: number; y: number };
  piece: Kind;
  promote?: boolean;
  color: Color;
}

export type GamePersistence = {
  /**
   * `save` が書き込む先。
   *
   * **`save` だけでは、いま読み込んでいる棋譜へ書くのかが分からない。**
   * `persistence` を組むのは `activeKifuPath`（file-tree 側）で、
   * `state.jkf` / `state.loadedAbsPath` が追いつくのは橋渡しの effect が走った後。
   * その1コミットぶんのずれの中で書くと、**前の棋譜が新しいファイルへ入る。**
   * 突き合わせられるように、宛先を値として持たせる。
   */
  absPath: string;
  save: (jkf: JKFData) => AsyncResult<void, string>;
};

export interface GameContextType {
  state: GameContextState;
  view: GameView;
  helpers: JKFPlayerHelpers;

  /**
   * 棋譜を盤に載せる。**投げない。** 載せられなければ `Err` で理由が返る。
   *
   * `state.error` にも積むが、それを描いている場所は無い（#277）。載せられなかった
   * ことを利用者に伝えるのはこの戻り値を読む側の仕事で、捨てると**盤も棋譜一覧も
   * 前の棋譜のまま、何も出ない**（`failure-surfacing.md` の F-31）。
   */
  loadGame: (jkf: JKFData, absPath: string | null) => AsyncResult<void, string>;
  resetGame: () => void;

  goToIndex: (index: number) => void;
  nextMove: () => void;
  previousMove: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  selectSquare: (x: number, y: number, promote?: boolean) => Promise<void>;
  selectHand: (color: Color, kind: Kind) => void;
  clearSelection: () => void;

  // 棋譜を書き換える操作。**どれも throw しない。** 失敗は `Err` で返る。
  //
  // `state.error` にも積むが、それを描いている場所はまだ無い（#277）。
  // 戻り値を捨てると、書けなかったことが利用者にも呼び出し側にも届かない。
  // 捨てるのが正しい呼び出しは `// async-result-ignored: <理由>` を付けること
  // （`src/__tests__/asyncResultUse.test.ts`）。
  //
  // `Ok` は「棋譜が意図どおりになった」。**何も変えなかった場合も `Ok`**
  // （変える必要が無かったのは失敗ではない）。
  makeMove: (move: StandardMoveFormat) => AsyncResult<void, string>;
  swapBranches: (q: SwapQuery) => AsyncResult<void, string>;
  deleteBranch: (q: DeleteQuery) => AsyncResult<void, string>;

  getCommentsByCursor: (cursor: CursorPath | null) => string[];
  setCommentsByCursor: (cursor: CursorPath, comments: string[]) => AsyncResult<void, string>;
  setCurrentComments: (comments: string[]) => AsyncResult<void, string>;

  clearError: () => void;

  isAtStart: () => boolean;
  isAtEnd: () => boolean;
  canGoForward: () => boolean;
  canGoBackward: () => boolean;

  getCurrentTurn: () => Color;
  getCurrentMoveIndex: () => number;
  getTotalMoves: () => number;

  getCurrentMove: () => IMoveMoveFormat | undefined;
  getCurrentComments: () => string[];

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
}

export interface GameProviderProps {
  children: ReactNode;
  persistence?: GamePersistence;
}
