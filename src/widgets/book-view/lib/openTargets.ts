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
  /** いま選んでいるプリセットの定跡ファイル（解析で使うかに依らない） */
  presetBookPath: string | null;
  /** そのプリセットの名前。添え書きに出す */
  presetName: string | null;
  /** 設定に残っている「最近開いた定跡」 */
  recents: readonly string[] | null | undefined;
  /** いま開いている定跡。**一覧から外す**（押しても何も起きない行になる） */
  openPath: string | null;
};

/**
 * 空の画面に出す一覧を組む。
 *
 * **2つの束に分けるのは、探し方が違うから。** プリセットの定跡は「いま選んでいるプリセットに
 * 結び付けた定跡」で、いちばん見たい1件（解析で使うかどうかは別。切ってあっても出す）。
 * 最近開いたものは「さっき見ていたもの」。
 *
 * **AI ライブラリを列挙しない。** そちらは*エンジンに食わせる*定跡を選ぶ場所で、
 * ビューが覗くのは任意のパス（→ `docs/spec/features/book.md`）。
 * 一覧を混ぜると、プリセットの設定欄とビューが見ている定跡が同じものに見える
 * —— 用途が別なので UI で混ぜない（#96）。
 *
 * 同じパスが2つの束に居たら**プリセット側だけに残す**（勧める理由が強いほうを出す）。
 */
export function bookOpenTargets(sources: Sources): {
  fromPreset: BookOpenTarget[];
  recent: BookOpenTarget[];
} {
  const { presetBookPath, presetName, recents, openPath } = sources;

  const fromPreset =
    presetBookPath && presetBookPath !== openPath
      ? [
          {
            path: presetBookPath,
            name: bookFileName(presetBookPath),
            note: presetName ? `${presetName} の定跡` : "選んでいるプリセットの定跡",
          },
        ]
      : [];

  const recent = readRecentBooks(recents)
    .filter((path) => path !== openPath && path !== presetBookPath)
    .map((path) => ({
      path,
      name: bookFileName(path),
      note: bookParentPath(path),
    }));

  return { fromPreset, recent };
}
