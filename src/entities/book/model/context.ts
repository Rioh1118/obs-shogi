import { createContext } from "react";
import type { AsyncResult } from "@/shared/lib/result";
import type { BookRow } from "../lib/rows";
import type { BookError, BookInfo } from "./types";

/**
 * 本体に出すもの。**1つの値で決める。**
 *
 * 真偽値を並べると、画面が同時に2つのことを言える —— 引くのに失敗した回に
 * 「この局面はこの定跡にありません」と断言する形が実際に出ていた。
 * それはこの画面でいちばん誤解が高くつく文言で、利用者は*事実*として読み、
 * 自分の定跡の中身を誤って判断する。
 *
 * **`switch` の腕を網羅させる。** 綴りを足して本体を足さないと tsc が落ちる。
 */
export type BookViewState =
  /** 定跡を開いていない */
  | { kind: "closed" }
  /** 開いている最中。**GB 級は数分返らない**ので、何を開いているかを出す */
  | { kind: "opening"; path: string }
  /**
   * 定跡は開いているが、盤に局面が無い。
   *
   * **「引いています」と言わない。** 引く先が無いので、待っても何も起きない
   */
  | { kind: "noPosition" }
  /** 現局面を引いている最中 */
  | { kind: "looking" }
  /** 現局面の候補手 */
  | { kind: "rows"; rows: readonly BookRow[] }
  /** 引けたが、この局面は定跡に載っていない */
  | { kind: "absent" }
  /** 引けなかった。**「載っていない」と混ぜない** */
  | { kind: "unavailable" };

export type BookContextType = {
  /** 開いている定跡。**1冊だけ**（重ねて引くのは #96） */
  info: BookInfo | null;
  /** 本体に出すもの */
  view: BookViewState;
  /**
   * 直近の失敗。**本体と同時に出しうる** —— 先を辿るのに失敗しても候補手は出せるので、
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
  /**
   * 定跡の外で起きた失敗を、この画面の帯に載せる。
   *
   * **口を開けているのはファイルダイアログのため。** あちらは `invoke` なので
   * reject しうるが、`BookError` を返す経路を通らない。ここが無いと、
   * ダイアログを開けなかった回は**何も起きず何も出ない**。
   */
  reportError: (error: BookError) => void;
};

export const BookContext = createContext<BookContextType | null>(null);
