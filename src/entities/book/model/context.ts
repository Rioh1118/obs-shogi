import { createContext } from "react";
import type { AsyncResult } from "@/shared/lib/result";
import type { BookRow } from "../lib/rows";
import type { BookError, BookInfo } from "./types";

export type BookContextType = {
  /** 開いている定跡。**1冊だけ**（重ねて引くのは #96） */
  info: BookInfo | null;
  /** 開く／閉じるの最中 */
  isOpening: boolean;

  /**
   * 現局面の候補手。**いま盤に出ている局面のものだけが入る。**
   *
   * 局面が動いてから引き終わるまでは空で、古い局面の行は出ない
   * （→ `docs/state-transitions/book-view.md` の不変条件1）
   */
  rows: readonly BookRow[];
  /** 現局面を引いている最中 */
  isLooking: boolean;
  /**
   * 直近の失敗。**行と同時に出しうる** —— 先を辿るのに失敗しても候補手は出せるので、
   * 表を消さずにこれを添える。
   *
   * **閉じる口は持たない。** 出ているあいだはその場所の状態が直っていないという
   * ことなので、閉じても状態は変わらない（`shared/ui/notification/InlineNotice` の doc）。
   * 消えるのは、引き直したときと開き直したとき
   */
  error: BookError | null;

  /** 開く。**失敗は戻り値で返す**（`error` にも載るので、呼び手は読まなくてもよい） */
  openBook: (path: string) => AsyncResult<BookInfo, BookError>;
  close: () => void;
};

export const BookContext = createContext<BookContextType | null>(null);
