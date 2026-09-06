import { useEffect } from "react";
import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";

/**
 * ツリーが開いた棋譜を盤に載せる。
 *
 * **`activeKifuPath` が変わるたびに載せ直す。** 改名・移動では file-tree が
 * `jkfData` を持ち越してパスだけを張り替えるので、この effect は
 * **開いた時点の内容で載せ直す**——盤・棋譜一覧・カーソル・分岐の選択が
 * その時点まで戻り、そこから1手指すとディスクの手が消える。
 *
 * TODO(#262): 「同じ棋譜でパスだけが変わった」を見分けて載せ直しを飛ばす。
 */
export function GameFileTreeBridge() {
  const { activeKifuPath, jkfData, kifuFormat } = useFileTree();
  const { loadGame, resetGame } = useGame();

  useEffect(() => {
    const run = async () => {
      if (activeKifuPath && jkfData && kifuFormat) {
        await loadGame(jkfData, activeKifuPath);
      } else {
        resetGame();
      }
    };
    void run();
  }, [activeKifuPath, jkfData, kifuFormat, loadGame, resetGame]);

  return null;
}
