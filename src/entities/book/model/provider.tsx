import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AsyncResult } from "@/shared/lib/result";
import {
  closeBook,
  listBooks,
  lookupBookMoves,
  openBookFile,
  walkBookLines,
} from "../api/commands";
import { attachLines, failedRows, pendingRows, type BookRow } from "../lib/rows";
import { BookContext, type BookContextType, type BookViewState } from "./context";
import type { BookError, BookInfo } from "./types";

type Props = {
  children: ReactNode;
  /**
   * いま盤に出ている局面。**呼び手が渡す。**
   *
   * 置き場の制約は `app/providers/gates/BookPositionGate.tsx` の doc が持つ。
   */
  currentSfen: string | null;
};

/**
 * 引き終えた結果と、それが**どの定跡のどの局面のものか**。
 *
 * 局面だけでは足りない。開き直した直後は局面が同じままなので、
 * 前の定跡から引いた候補手が新しい定跡の行として表に出る ——
 * どの定跡から来た行かは画面から確かめようが無い。
 */
type Looked = {
  handle: number;
  sfen: string;
  /** 引けなかった回は `null`。**「載っていない」（空の配列）と混ぜない** */
  rows: BookRow[] | null;
};

/**
 * 開いている定跡と、現局面の候補手を持つ。
 *
 * **置き場の制約は `app/providers/gates/BookPositionGate.tsx` の doc が持つ。**
 * 同じ理由を写さない —— 置き場を動かした回に片方だけ直る。
 *
 * `currentSfen` に指し手の列が付いた綴りを渡さないこと
 * （Rust の `to_book_key` が `moves` 付きを拒む）。
 *
 * 遷移は `docs/state-transitions/book-view.md`。
 */
export function BookProvider({ children, currentSfen }: Props) {
  const [info, setInfo] = useState<BookInfo | null>(null);
  /** 開こうとしているパス。**開いている最中を画面に出すために持つ** */
  const [opening, setOpening] = useState<string | null>(null);
  const [looked, setLooked] = useState<Looked | null>(null);
  const [error, setError] = useState<BookError | null>(null);

  // 畳まれるときに閉じるために、最新のハンドルを effect のクロージャの外へ出す。
  // 依存に `info` を入れて掃除させると、**開き直すたびに掃除が走って自分を閉じる**
  const infoRef = useRef<BookInfo | null>(null);
  infoRef.current = info;

  useEffect(() => {
    // **自分が開く前に在ったものだけを閉じる。** webview が作り直されると、
    // 前の版が開いたハンドルを閉じる者が居なくなり、定跡ぶんのメモリが
    // プロセスの終わりまで残る。`list_books` はここで1度だけ呼ぶので、
    // 後から自分が開いたものを巻き込まない
    void (async () => {
      try {
        for (const orphan of await listBooks()) {
          await closeBook(orphan.handle); // async-result-ignored: 前の版が開いたものなので、閉じ損ねても案内できる操作が無い
        }
      } catch {
        // 掃除に失敗しても、これから開く側の邪魔はしない。
        // 出す場所も無い（この時点で画面はまだ何も言っていない）
      }
    })();

    return () => {
      const open = infoRef.current;
      if (open) void closeBook(open.handle); // async-result-ignored: 畳まれた後に出す場所が無い
    };
  }, []);

  useEffect(() => {
    if (!info || !currentSfen) return;

    // **走っている引きを捨てる。** 局面は引き終わるのを待ってくれないので、
    // 遅れて届いた結果を当てると、盤と違う局面の候補手が表に残る
    // （→ `book-view.md` ※A）
    let cancelled = false;
    setError(null);

    // 掃除の合図より先に届く結果があるので、届いた側でも突き合わせられるように掴む
    const handle = info.handle;
    const sfen = currentSfen;

    void (async () => {
      const found = await lookupBookMoves(handle, sfen);
      if (cancelled) return;

      if (!found.success) {
        setError(found.error);
        // **閉じられたハンドルは、開いていない状態へ戻す。** 戻さないと操作列は
        // 閉じた定跡の名前を出し続け、盤を動かすたびに同じ失敗が出る。
        // 復帰操作（開き直す）を踏める画面は、定跡を開いていない画面のほう
        if (found.error.code === "invalid_handle") {
          setInfo(null);
          setLooked(null);
          return;
        }
        setLooked({ handle, sfen, rows: null });
        return;
      }

      const moves = found.data;
      // **先に候補手を出す。** 辿るのは引くより桁違いに重いので、
      // 待たせると局面を進めるたびに表が空のまま止まって見える
      setLooked({ handle, sfen, rows: pendingRows(moves) });

      if (moves.length === 0) return;

      const walked = await walkBookLines(
        handle,
        sfen,
        moves.map((move) => move.usiMove),
      );
      if (cancelled) return;

      // **表は消さない。** 引けてはいるので、埋まらないのは「この先」列だけ。
      // ただし**列は「辿っています」のままにしない**（`BookRowLine` の doc）
      if (!walked.success) {
        setError(walked.error);
        setLooked({ handle, sfen, rows: failedRows(moves) });
        return;
      }

      setLooked({ handle, sfen, rows: attachLines(moves, walked.data) });
    })();

    return () => {
      cancelled = true;
    };
  }, [info, currentSfen]);

  const openBook = useCallback(
    // 戻り値の型をここに書くのは、`src/__tests__/asyncResultUse.test.ts` が宣言から
    // 名前を拾うため。外すと、この口を投げっぱなしで呼んだ画面が機械の目から消える
    async (path: string): AsyncResult<BookInfo, BookError> => {
      setOpening(path);
      setError(null);

      const opened = await openBookFile(path);
      setOpening(null);

      if (!opened.success) {
        setError(opened.error);
        return opened;
      }

      // 1冊だけ持つ。開き直す前に前のものを閉じないと、ハンドルとメモリが積み上がる
      if (info) void closeBook(info.handle); // async-result-ignored: 既に別の定跡へ移っていて、出す場所が無い
      setInfo(opened.data);

      return opened;
    },
    [info],
  );

  const close = useCallback(() => {
    if (!info) return;
    void closeBook(info.handle); // async-result-ignored: 閉じ終わった画面に出す場所が無い
    setInfo(null);
    setLooked(null);
    setError(null);
  }, [info]);

  const reportError = useCallback((reported: BookError) => setError(reported), []);

  // **引いている最中を state に持たない。** 持つと、定跡が入ったレンダと
  // 引き始めるレンダの間に「引き終えて空」に見える frame が挟まり、
  // **引き始めてもいないのに「この局面はこの定跡にありません」が描かれる。**
  const view = useMemo(
    () => viewState({ info, opening, looked, currentSfen }),
    [info, opening, looked, currentSfen],
  );

  const value = useMemo<BookContextType>(
    () => ({ info, view, error, openBook, close, reportError }),
    [info, view, error, openBook, close, reportError],
  );

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

function viewState(input: {
  info: BookInfo | null;
  opening: string | null;
  looked: Looked | null;
  currentSfen: string | null;
}): BookViewState {
  const { info, opening, looked, currentSfen } = input;

  if (opening !== null) return { kind: "opening", path: opening };
  if (info === null) return { kind: "closed" };
  if (currentSfen === null) return { kind: "noPosition" };

  // **どの定跡のどの局面かが揃って初めて出す。** 揃うまでは引いている最中
  if (looked === null || looked.handle !== info.handle || looked.sfen !== currentSfen) {
    return { kind: "looking" };
  }

  if (looked.rows === null) return { kind: "unavailable" };
  if (looked.rows.length === 0) return { kind: "absent" };
  return { kind: "rows", rows: looked.rows };
}
