import { invoke } from "@tauri-apps/api/core";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import { asBookError } from "./error";
import type { BookError, BookInfo, BookLine, BookMove } from "../model/types";

/**
 * 定跡を開いてハンドルを受け取る。画面からは `useBook().openBook` を呼ぶ。
 * こちらは前の定跡を閉じず、開いている最中を画面に出さない。
 *
 * パスに置き場の規約は無い。エンジンに食わせる定跡は AI ライブラリに置くが、
 * ビューが覗くのは任意のパス（`docs/spec/features/book.md`）。
 *
 * TODO(#197): 大きい定跡では返るまで待つ。上限も進捗も中断も無い。
 */
export function openBookFile(path: string): AsyncResult<BookInfo, BookError> {
  return invokeBook(() => invoke<BookInfo>("open_book", { input: { path } }));
}

/** 局面の候補手を返す。未収録の局面は空で、失敗ではない。 */
export function lookupBookMoves(handle: number, sfen: string): AsyncResult<BookMove[], BookError> {
  return invokeBook(() => invoke<BookMove[]>("lookup_book_moves", { input: { handle, sfen } }));
}

/**
 * 候補手それぞれの先を、定跡が続くかぎり辿る。返る並びは `moves` と同じ。
 *
 * 候補 N 本分の線を辿るので、引くより桁違いに重い。先に候補手を出し、終わってからこちらを足すこと。
 */
export function walkBookLines(
  handle: number,
  sfen: string,
  moves: readonly string[],
): AsyncResult<BookLine[], BookError> {
  return invokeBook(() =>
    invoke<BookLine[]>("walk_book_lines", { input: { handle, sfen, moves: [...moves] } }),
  );
}

export function closeBook(handle: number): AsyncResult<void, BookError> {
  return invokeBook(() => invoke<void>("close_book", { input: { handle } }));
}

/**
 * 開いている定跡を全部返す。
 *
 * 孤児を拾うために使う。ハンドルはフロントの変数にしか無いので、webview が作り直されると
 * 閉じる術が無くなり、定跡分のメモリがプロセスの終わりまで残る。
 */
export function listBooks(): AsyncResult<BookInfo[], BookError> {
  return invokeBook(() => invoke<BookInfo[]>("list_books"));
}

/**
 * `invoke` の失敗を `BookError` にして返す。
 *
 * 名前を `call` のように一般的にしない。`src/__tests__/asyncResultUse.test.ts` は
 * `AsyncResult` を返す宣言の名前で呼び出しを拾うので、関係の無いファイルの同名の呼び出しまで止める。
 */
async function invokeBook<T>(run: () => Promise<T>): AsyncResult<T, BookError> {
  try {
    return Ok(await run());
  } catch (e) {
    return Err(asBookError(e));
  }
}
