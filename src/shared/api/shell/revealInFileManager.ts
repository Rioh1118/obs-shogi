import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { AsyncResult } from "@/shared/lib/result";

/**
 * ファイル管理ソフト（Finder / Explorer）でその場所を表示する。
 * **開くのは親フォルダ**で、渡したものが選択された状態になる——
 * そのフォルダの中は開かないので、「中に置いてください」と案内する側は
 * 「表示する」と書くこと。
 *
 * **`openPath` を選ばない。** `open_path` を許すと「既定のアプリでどのパスを
 * 起動してよいか」を scope で決めることになり、場所を見せるだけの用途に要らない
 * 権限が付く。いま何が許されているかは `src-tauri/capabilities/` が持ち、
 * 口と許可の対応は `src/__tests__/openerCapability.test.ts` が見ている。
 * `reveal_item_in_dir` は scope を持たない。**ただし通るのは実在するパスだけ**——
 * 入口で正規化（Windows は存在の確認）を通すので、無いパスは弾かれる。
 * ファイルとディレクトリの別は問わない。
 *
 * **失敗は投げずに返す。** 何が効かなかったかを言えるのは呼び出し元だけで、
 * ここで握り潰すと「押しても何も起きないボタン」になる。
 *
 * **空白だけのパスは何もせず成功を返す。** 押せるボタンの側でパスの有無は
 * 保証されていて、ここで失敗にすると「何も起きていないのに失敗の通知が出る」になる。
 */
export async function revealInFileManager(path: string): AsyncResult<void> {
  const p = (path ?? "").trim();
  if (!p) return { success: true, data: undefined };

  try {
    await revealItemInDir(p);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
