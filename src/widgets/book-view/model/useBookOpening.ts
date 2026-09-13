import { useCallback } from "react";
import { rememberBook, useBook } from "@/entities/book";
import { useAppConfig } from "@/entities/app-config";
import { pickBookFile } from "@/shared/api/picker/pickBookFile";

/**
 * 定跡を開く導線。**操作列と空の画面の両方が押す**ので、ここに1つ置く。
 *
 * 控えるのは**開けたパスだけ。** 開けなかったものを「最近開いた定跡」に並べると、
 * 押すたびに同じ失敗が出る一覧ができる。
 */
export function useBookOpening() {
  const { openBook, reportError } = useBook();
  const { config, setDisplayConfig } = useAppConfig();
  const recents = config?.book_recent_paths;

  const open = useCallback(
    async (path: string): Promise<void> => {
      const opened = await openBook(path);
      if (!opened.success) return;

      void setDisplayConfig({ book_recent_paths: rememberBook(recents, path) }); // async-result-ignored: 控えを書き損ねても開いた定跡は使える。出す場所も無い
    },
    [openBook, setDisplayConfig, recents],
  );

  /**
   * ダイアログで選ばせてから開く。取り消したら何も起きない。
   *
   * **ダイアログが開けなかった回を黙って落とさない。** `invoke` なので
   * 権限の設定漏れやプラグインの初期化失敗で reject しうる。捕まえないと
   * 「📂 を押しても反応しない」画面になり、押し続ける以外にできることが無くなる。
   */
  const browse = useCallback(async (): Promise<void> => {
    let picked: string | null;
    try {
      picked = await pickBookFile();
    } catch (e) {
      reportError({
        code: "unknown",
        message: `定跡を選ぶ画面を開けませんでした（${String(e)}）。最近開いた定跡の一覧から選ぶこと`,
        path: null,
      });
      return;
    }

    if (picked) await open(picked);
  }, [open, reportError]);

  return { open, browse };
}
