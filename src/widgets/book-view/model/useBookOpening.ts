import { useCallback } from "react";
import { rememberBook, useBook } from "@/entities/book";
import { useAppConfig } from "@/entities/app-config";
import { pickBookFile } from "@/shared/api/picker/pickBookFile";

/**
 * 定跡を開く操作を返す。操作列と空の画面の両方が使うので、ここに1つ置く。
 *
 * 最近開いた定跡の一覧に載せるのは、開けたパスだけ。開けなかったものを並べると、
 * 押すたびに同じ失敗が出る一覧ができる。中止した定跡も、`openBook` が `null` を返すので載せない。
 */
export function useBookOpening() {
  const { openBook, reportError } = useBook();
  const { config, setDisplayConfig } = useAppConfig();
  const recents = config?.book_recent_paths;

  const open = useCallback(
    async (path: string): Promise<void> => {
      const opened = await openBook(path);
      if (!opened.success || opened.data === null) return;

      void setDisplayConfig({ book_recent_paths: rememberBook(recents, path) }); // async-result-ignored: 一覧を書き損ねても開いた定跡は使える。出す場所も無い
    },
    [openBook, setDisplayConfig, recents],
  );

  /**
   * ダイアログで選ばせてから開く。取り消したら何も起きない。
   *
   * ダイアログを開けなかったときは失敗の帯へ渡す。ダイアログは `invoke` を通るので、
   * 権限の設定漏れやプラグインの初期化失敗で reject しうる。捕まえないと、
   * 📂 を押しても反応しない画面になり、押し続ける以外にできることが無くなる。
   */
  const browse = useCallback(async (): Promise<void> => {
    let picked: string | null;
    try {
      picked = await pickBookFile();
    } catch (e) {
      reportError({
        code: "unknown",
        message: `定跡を選択する画面を開けませんでした（${String(e)}）。最近開いた定跡の一覧から選択してください。`,
        path: null,
      });
      return;
    }

    if (picked) await open(picked);
  }, [open, reportError]);

  return { open, browse };
}
