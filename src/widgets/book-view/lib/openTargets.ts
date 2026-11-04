import { bookFileName, bookParentPath, readRecentBooks } from "@/entities/book";

/** 空の画面に並べる「押せば開く」1件 */
export type BookOpenTarget = {
  path: string;
  /** ファイル名 */
  name: string;
  /** 見分けるための添え書き。置き場か、なぜ勧めているか */
  note: string;
};

type Sources = {
  /** いま選んでいるプリセットで使う定跡ファイル（`bookInUse` でなければ `null`） */
  presetBookPath: string | null;
  /** そのプリセットの名前。添え書きに出す */
  presetName: string | null;
  /** 設定に残っている「最近開いた定跡」 */
  recents: readonly string[] | null | undefined;
};

/**
 * 空の画面に出す一覧を組む。
 *
 * 束を2つに分けるのは、探し方が違うから。プリセットの定跡は、いま選んでいるプリセットに
 * 結び付けた定跡で、いちばん見たい1件。最近開いたものは、さっき見ていたもの。
 *
 * AI ライブラリは列挙しない。あちらはエンジンに渡す定跡を選ぶ場所で、ビューが開くのは
 * 任意のパス（`docs/spec/features/book.md`）。一覧を混ぜると、プリセットの設定欄と
 * ビューが見ている定跡が同じものに見える。
 *
 * 同じパスが2つの束に居たら、勧める理由が強いプリセット側だけに残す。
 * 開いている定跡は外さない。一覧を出すのは、定跡を開いていない画面だけ（`BookView` の `closed`）。
 */
export function bookOpenTargets(sources: Sources): {
  fromPreset: BookOpenTarget[];
  recent: BookOpenTarget[];
} {
  const { presetBookPath, presetName, recents } = sources;

  const fromPreset = presetBookPath
    ? [
        {
          path: presetBookPath,
          name: bookFileName(presetBookPath),
          note: presetName ? `${presetName} の定跡` : "選んでいるプリセットの定跡",
        },
      ]
    : [];

  const recent = readRecentBooks(recents)
    .filter((path) => path !== presetBookPath)
    .map((path) => ({
      path,
      name: bookFileName(path),
      note: bookParentPath(path),
    }));

  return { fromPreset, recent };
}
