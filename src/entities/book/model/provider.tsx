import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AsyncResult } from "@/shared/lib/result";
import {
  closeBook,
  listBooks,
  lookupBookMoves,
  // **別名にするのは名前がぶつかるから。** この provider が配る口も `openBook` で、
  // 素の綴りは呼び手（画面）の側に取ってある —— 失敗を握り潰した呼び出しを
  // `src/__tests__/asyncResultUse.test.ts` が名前で拾うので、
  // 画面が押して開けなかった回を見てほしいのはそちら
  openBook as openBookFile,
  walkBookLines,
} from "../api/commands";
import { attachLines, type BookRow } from "../lib/rows";
import { BookContext, type BookContextType } from "./context";
import type { BookError, BookInfo } from "./types";

type Props = {
  children: ReactNode;
  /**
   * いま盤に出ている局面。**呼び手が渡す。**
   *
   * ここで `useGame` を読むと `entities` どうしの横断になる。渡す係は
   * `app/providers/gates/BookPositionGate`。
   */
  currentSfen: string | null;
};

/** 引いた結果と、それが属する局面 */
type Looked = { sfen: string; rows: BookRow[] };

/**
 * 開いている定跡と、現局面の候補手を持つ。
 *
 * **呼び手が守ること。**
 *
 * - **ドックより上に置くこと。** 定跡ビューの中で開くと、タブを移るたびに
 *   定跡が閉じて開き直される —— GB 級のファイルでは移動そのものが止まる。
 *   `AnalysisProvider` を `entities` へ下げたのと同じ理由
 * - `currentSfen` は盤の現局面。**指し手の列が付いた綴りを渡さないこと**
 *   （Rust の `to_book_key` が `moves` 付きを拒む）
 *
 * 遷移は `docs/state-transitions/book-view.md`。
 */
export function BookProvider({ children, currentSfen }: Props) {
  const [info, setInfo] = useState<BookInfo | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [isLooking, setIsLooking] = useState(false);
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
    if (!info || !currentSfen) {
      setLooked(null);
      setIsLooking(false);
      return;
    }

    // **走っている引きを捨てる。** 局面は引き終わるのを待ってくれないので、
    // 遅れて届いた結果を当てると、盤と違う局面の候補手が表に残る
    // （→ `book-view.md` ★A）
    let cancelled = false;
    setIsLooking(true);
    setError(null);

    void (async () => {
      const found = await lookupBookMoves(info.handle, currentSfen);
      if (cancelled) return;

      if (!found.success) {
        setError(found.error);
        setLooked(null);
        setIsLooking(false);
        return;
      }

      const moves = found.data;
      // **先に候補手を出す。** 辿るのは引くより桁違いに重いので、
      // 待たせると局面を進めるたびに表が空のまま止まって見える
      setLooked({ sfen: currentSfen, rows: moves.map((move) => ({ move, line: null })) });
      setIsLooking(false);

      if (moves.length === 0) return;

      const walked = await walkBookLines(
        info.handle,
        currentSfen,
        moves.map((move) => move.usiMove),
      );
      if (cancelled) return;

      if (!walked.success) {
        // **表は消さない。** 引けてはいるので、埋まらないのは「この先」列だけ
        setError(walked.error);
        return;
      }

      setLooked({ sfen: currentSfen, rows: attachLines(moves, walked.data) });
    })();

    return () => {
      cancelled = true;
    };
  }, [info, currentSfen]);

  // 戻り値の型をここに書くのは、`src/__tests__/asyncResultUse.test.ts` が宣言から
  // 名前を拾うため。外すと、この口を投げっぱなしで呼んだ画面が機械の目から消える
  const openBook = useCallback(
    async (path: string): AsyncResult<BookInfo, BookError> => {
      setIsOpening(true);
      setError(null);

      const opened = await openBookFile(path);
      setIsOpening(false);

      if (!opened.success) {
        setError(opened.error);
        return opened;
      }

      // 1冊だけ持つ。開き直す前に前のものを閉じないと、ハンドルとメモリが積み上がる
      if (info) void closeBook(info.handle); // async-result-ignored: 既に別の定跡へ移っていて、出す場所が無い
      setInfo(opened.data);
      setLooked(null);

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

  // **局面が食い違う行を出さない。** 引き直している間、前の局面の行は残っているが、
  // それは盤に出ている局面のものではない（不変条件1）
  const rows = looked !== null && looked.sfen === currentSfen ? looked.rows : EMPTY_ROWS;

  const value = useMemo<BookContextType>(
    () => ({ info, isOpening, rows, isLooking, error, openBook, close }),
    [info, isOpening, rows, isLooking, error, openBook, close],
  );

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

/** 毎回新しい配列を作らない。作ると `value` が毎レンダ別物になり、購読側が描き直される */
const EMPTY_ROWS: readonly BookRow[] = [];
