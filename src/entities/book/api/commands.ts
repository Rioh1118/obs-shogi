import { invoke } from "@tauri-apps/api/core";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import { asBookError } from "./error";
import type { BookError, BookInfo, BookLine, BookMove } from "../model/types";

/**
 * 定跡を開いてハンドルを受け取る。
 *
 * **パスに置き場の規約は無い。** エンジンに食わせる定跡は AI ライブラリに置くが、
 * ビューが覗くのは任意のパス（→ `docs/spec/features/book.md`）。
 *
 * 大きい定跡では**返るまで待つ**。上限も進捗も中断も無い（→ #197）。
 */
export function openBook(path: string): AsyncResult<BookInfo, BookError> {
  return invokeBook(() => invoke<BookInfo>("open_book", { input: { path } }));
}

/** 局面の候補手。**未収録の局面は空**（失敗ではない） */
export function lookupBookMoves(handle: number, sfen: string): AsyncResult<BookMove[], BookError> {
  return invokeBook(() => invoke<BookMove[]>("lookup_book_moves", { input: { handle, sfen } }));
}

/**
 * 候補手それぞれの先を、定跡が続くかぎり辿る。**返る並びは `moves` と同じ。**
 *
 * **引くより桁違いに重い。** 候補 N 本ぶんの線を辿るので、引いた結果を出すのと
 * 同じ待ち方をさせないこと（先に候補手を出し、届いた順にこちらを足す）。
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
 * **孤児を拾うための口。** ハンドルはフロントの変数にしか無いので、webview が
 * 作り直されると閉じる術が無くなり、定跡ぶんのメモリがプロセス終了まで残る。
 */
export function listBooks(): Promise<BookInfo[]> {
  return invoke<BookInfo[]>("list_books");
}

/**
 * `invoke` の失敗を [`BookError`] にして返す。
 *
 * **名前を `call` のような一般的な綴りにしない。** 失敗を握り潰した呼び出しを
 * 名前で拾う機械（`src/__tests__/asyncResultUse.test.ts`）があり、
 * よくある綴りを `AsyncResult` の宣言として置くと、**関係の無いファイルの
 * 同名の呼び出しまで咎められる。**
 */
async function invokeBook<T>(run: () => Promise<T>): AsyncResult<T, BookError> {
  try {
    return Ok(await run());
  } catch (e) {
    return Err(asBookError(e));
  }
}
