import { createContext } from "react";
import type { AsyncResult } from "@/shared/lib/result";
import type { BookRow } from "../lib/rows";
import type { BookError, BookInfo } from "./types";

/**
 * 定跡ビューの本体に出すもの。
 *
 * 真偽値を並べると、画面が同時に2つのことを言える。引くのに失敗したときに
 * 「この局面はこの定跡にありません」と断言する形が実際に出ていた。
 */
export type BookViewState =
  /** 定跡を開いていない */
  | { kind: "closed" }
  /** 開いている最中。GB 級は数分返らないので、何を開いているかを出す */
  | { kind: "opening"; path: string }
  /** 定跡は開いているが、盤に局面が無い。引く先が無いので、待っても何も起きない */
  | { kind: "noPosition" }
  /** 現局面を引いている最中 */
  | { kind: "looking" }
  /** 現局面の候補手 */
  | { kind: "rows"; rows: readonly BookRow[] }
  /** 引けたが、この局面は定跡に載っていない */
  | { kind: "absent" }
  /** 引けなかった。「載っていない」と混ぜない */
  | { kind: "unavailable" };

/**
 * 失敗と、どの操作が落ちたか。
 *
 * 帯の題は `origin` で決める。画面の状態から引くと、行が並んでいるところで定跡を開き損ねたときに
 * 「定跡の先を辿れませんでした」と付き、題と本文が食い違う。
 */
export type BookFailure = {
  origin: "open" | "lookup" | "walk" | "external";
  error: BookError;
};

export type BookContextType = {
  /** 開いている定跡。1冊だけを持つ */
  info: BookInfo | null;
  view: BookViewState;
  /**
   * 直近の失敗。`view` と同時に出しうる。先を辿るのに失敗しても候補手は出せるので、
   * 表を消さずに添える。
   *
   * 閉じる関数は持たない。出ている間はその場所の状態が直っていない
   * （`shared/ui/notification/InlineNotice` の doc）。消えるのは引き直し、開き直し、閉じるとき。
   */
  failure: BookFailure | null;

  /**
   * 定跡を開く。失敗は `failure` にも載るので、呼び手は戻り値の失敗を読まなくてもよい。
   * 開いている途中に閉じるか別の定跡を開くと、結果は捨てて `null` で返す。
   */
  openBook: (path: string) => AsyncResult<BookInfo | null, BookError>;
  close: () => void;
  /**
   * 定跡の外で起きた失敗を、この画面の帯に載せる。
   *
   * ファイルダイアログのために公開する。あちらも reject しうるが `BookError` を返す経路を通らないので、
   * これが無いと開けなかったときに何も出ない。
   */
  reportError: (error: BookError) => void;
};

export const BookContext = createContext<BookContextType | null>(null);
