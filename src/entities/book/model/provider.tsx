import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ok, type AsyncResult } from "@/shared/lib/result";
import {
  closeBook,
  listBooks,
  lookupBookMoves,
  openBookFile,
  walkBookLines,
} from "../api/commands";
import { attachLines, failedRows, pendingRows, type BookRow } from "../lib/rows";
import { BookContext, type BookContextType, type BookFailure, type BookViewState } from "./context";
import type { BookError, BookInfo } from "./types";

type Props = {
  children: ReactNode;
  /** いま盤に出ている局面。置き場の制約は `app/providers/gates/BookPositionGate.tsx` の doc */
  currentSfen: string | null;
};

/**
 * 引き終えた結果と、それがどの定跡のどの局面のものか。
 *
 * 局面だけでは足りない。開き直した直後は局面が同じままなので、
 * 前の定跡から引いた候補手が新しい定跡の行として表に出る。
 */
type Looked = {
  handle: number;
  sfen: string;
  /** 引けなかったら `null`。「載っていない」（空の配列）と混ぜない */
  rows: BookRow[] | null;
};

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

  // どの定跡のどの局面かが揃うまでは、引いている最中として出す
  if (looked === null || looked.handle !== info.handle || looked.sfen !== currentSfen) {
    return { kind: "looking" };
  }

  if (looked.rows === null) return { kind: "unavailable" };
  if (looked.rows.length === 0) return { kind: "absent" };
  return { kind: "rows", rows: looked.rows };
}

/**
 * 開いている定跡と、現局面の候補手を持つ。遷移は `docs/state-transitions/book-view.md`。
 *
 * `currentSfen` に指し手の列が付いた綴りを渡さないこと（Rust の `to_book_key` が拒む）。
 *
 * `await` を跨いで state を読まない。定跡を開くのも引くのも、返るまでに利用者が別の定跡へ移れる。
 * レンダのクロージャが掴んだ `info` を使うと、いま開いている定跡に前の定跡の結果や失敗が当たる。
 * 現在地は `infoRef` が持ち、開いている途中の割り込みは `openSeqRef` が数える。
 */
export function BookProvider({ children, currentSfen }: Props) {
  const [info, setInfo] = useState<BookInfo | null>(null);
  /** 開こうとしているパス。開いている最中を画面に出すために持つ */
  const [opening, setOpening] = useState<string | null>(null);
  const [looked, setLooked] = useState<Looked | null>(null);
  const [failure, setFailure] = useState<BookFailure | null>(null);

  /**
   * いま開いている定跡。`await` の後で現在地を確かめるのはこちら。
   *
   * レンダ時に代入すると、`setInfo` の後にレンダが来るまで古い値のままで、掃除が走る前に
   * 返った結果が現在地を取り違える。書くのは `setBook` だけ。
   */
  const infoRef = useRef<BookInfo | null>(null);
  /**
   * 開く操作と閉じる操作の通し番号。開いている途中に割り込まれたかを見る。
   *
   * `open_book` は上限も中断も無く、GB 級では数分返らない。その間に閉じる操作や別の定跡が
   * 押されたら、返ってきたハンドルは捨てて閉じる。
   */
  const openSeqRef = useRef(0);

  const setBook = useCallback((next: BookInfo | null) => {
    infoRef.current = next;
    setInfo(next);
  }, []);

  useEffect(() => {
    // webview が作り直されると、前の版が開いたハンドルを閉じる者が居なくなる。
    // `list_books` はマウントごとに1度だけ呼ぶので、後から自分が開いたものは含まない
    void (async () => {
      const orphans = await listBooks();
      // 掃除に失敗しても、これから開く側の邪魔はしない。前の版の定跡について案内できる操作も無い
      if (!orphans.success) return;

      for (const orphan of orphans.data) {
        await closeBook(orphan.handle); // async-result-ignored: 前の版が開いたものなので、閉じ損ねても案内できる操作が無い
      }
    })();

    return () => {
      // 番号を進めて、畳まれた後に返ってくるハンドルを捨てる側へ回す
      openSeqRef.current += 1;
      const open = infoRef.current;
      if (open) void closeBook(open.handle); // async-result-ignored: 畳まれた後に出す場所が無い
    };
  }, []);

  useEffect(() => {
    if (!info || !currentSfen) return;

    // 局面は引き終わるのを待たないので、遅れて届いた結果を当てると、
    // 盤と違う局面の候補手が表に残る（`book-view.md` の ※A）
    let cancelled = false;
    setFailure(null);

    const handle = info.handle;
    const sfen = currentSfen;

    /**
     * この引きの結果を、もう当ててはいけないか。
     *
     * `cancelled` だけでは足りない。掃除が走るのは再レンダが commit された時点で、`setBook` が
     * 定跡を差し替えた時点ではない。その隙間に返った結果が、開き直した定跡に当たる。
     */
    const stale = () => cancelled || infoRef.current?.handle !== handle;

    void (async () => {
      const found = await lookupBookMoves(handle, sfen);
      if (stale()) return;

      if (!found.success) {
        setFailure({ origin: "lookup", error: found.error });
        // 閉じられたハンドルは開いていない状態へ戻す。戻さないと操作列は閉じた定跡の名前を出し続け、
        // 盤を動かすたびに同じ失敗が出る。開き直せる画面は定跡を開いていない画面のほう
        if (found.error.code === "invalid_handle") {
          setBook(null);
          setLooked(null);
          return;
        }
        setLooked({ handle, sfen, rows: null });
        return;
      }

      const moves = found.data;
      // 先に候補手を出す。辿るのは重いので、待たせると局面を進めるたびに表が空のまま止まって見える
      setLooked({ handle, sfen, rows: pendingRows(moves) });

      if (moves.length === 0) return;

      const walked = await walkBookLines(
        handle,
        sfen,
        moves.map((move) => move.usiMove),
      );
      if (stale()) return;

      // 引けてはいるので表は消さない。列は「辿っています」のままにしない（`BookRowLine` の doc）
      if (!walked.success) {
        setFailure({ origin: "walk", error: walked.error });
        setLooked({ handle, sfen, rows: failedRows(moves) });
        return;
      }

      setLooked({ handle, sfen, rows: attachLines(moves, walked.data) });
    })();

    return () => {
      cancelled = true;
    };
  }, [info, currentSfen, setBook]);

  const openBook = useCallback(
    // 戻り値の型をここに書くのは、`src/__tests__/asyncResultUse.test.ts` が宣言から
    // 名前を拾うため。外すと、この関数を投げっぱなしで呼んだ画面が機械の目から消える
    async (path: string): AsyncResult<BookInfo | null, BookError> => {
      const seq = ++openSeqRef.current;
      setOpening(path);
      setFailure(null);

      const opened = await openBookFile(path);

      // 割り込まれていたら閉じて捨てる。閉じないと、利用者が閉じたはずの定跡が数分後に開く
      if (openSeqRef.current !== seq) {
        if (opened.success) void closeBook(opened.data.handle); // async-result-ignored: 捨てる定跡なので、閉じ損ねても案内できる操作が無い
        return Ok(null);
      }

      setOpening(null);

      if (!opened.success) {
        setFailure({ origin: "open", error: opened.error });
        return opened;
      }

      // 1冊だけ持つ。前のものを閉じないと、ハンドルとメモリが積み上がる。
      // 現在地は `infoRef` で見る。レンダのクロージャが掴んだ `info` は数分古いことがある
      const previous = infoRef.current;
      if (previous) void closeBook(previous.handle); // async-result-ignored: 既に別の定跡へ移っていて、出す場所が無い
      setBook(opened.data);

      return opened;
    },
    [setBook],
  );

  const close = useCallback(() => {
    // 開いている途中でも押せる。番号を進めて、返ってくるハンドルを捨てる側へ回す
    openSeqRef.current += 1;
    setOpening(null);

    const open = infoRef.current;
    if (open) void closeBook(open.handle); // async-result-ignored: 閉じ終わった画面に出す場所が無い
    setBook(null);
    setLooked(null);
    setFailure(null);
  }, [setBook]);

  const reportError = useCallback(
    (error: BookError) => setFailure({ origin: "external", error }),
    [],
  );

  // 引いている最中を state に持たない。持つと、定跡が入ったレンダと引き始めるレンダの間に
  // 「この局面はこの定跡にありません」が描かれる frame が挟まる
  const view = useMemo(
    () => viewState({ info, opening, looked, currentSfen }),
    [info, opening, looked, currentSfen],
  );

  const value = useMemo<BookContextType>(
    () => ({ info, view, failure, openBook, close, reportError }),
    [info, view, failure, openBook, close, reportError],
  );

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}
