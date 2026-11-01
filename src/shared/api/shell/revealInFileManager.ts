import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { AsyncResult } from "@/shared/lib/result";

/**
 * ファイル管理ソフト（Finder、Explorer）でその場所を表示する。
 *
 * 開くのは親フォルダで、渡したものが選択された状態になる。そのフォルダの中は開かないので、
 * 「中に置いてください」と案内する側は「表示する」と書く。
 *
 * `openPath` は使わない。`open_path` を許すと起動してよいパスを scope で決めることになり、
 * 場所を見せるだけの用途に要らない権限が付く。許可は `src-tauri/capabilities/` が持ち、
 * コマンドとの対応は `src/__tests__/openerCapability.test.ts` が見ている。
 * `reveal_item_in_dir` は scope を持たないが、入口で正規化を通すので実在しないパスは弾かれる。
 *
 * 失敗は投げずに返す。何が効かなかったかを言えるのは呼び手だけで、握り潰すと押しても何も起きないボタンになる。
 * 空白だけのパスは何もせず成功を返す。押せるボタンの側でパスの有無は保証されている。
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
