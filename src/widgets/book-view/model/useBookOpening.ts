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
  const { openBook, isOpening } = useBook();
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

  /** ダイアログで選ばせてから開く。取り消したら何も起きない */
  const browse = useCallback(async (): Promise<void> => {
    const picked = await pickBookFile();
    if (picked) await open(picked);
  }, [open]);

  return { open, browse, isOpening };
}
