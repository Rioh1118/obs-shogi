import { useEffect } from "react";
import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";
import { useNotify } from "@/shared/lib/notification/useNotifications";

function basename(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * ツリーが開いた棋譜を盤に載せる。
 *
 * **`activeKifuPath` が変わるたびに載せ直す。** 改名・移動では file-tree が
 * `jkfData` を持ち越してパスだけを張り替えるので、この effect は
 * **開いた時点の内容で載せ直す**——盤・棋譜一覧・カーソル・分岐の選択が
 * その時点まで戻り、そこから1手指すとディスクの手が消える。
 *
 * TODO(#262): 「同じ棋譜でパスだけが変わった」を見分けて載せ直しを飛ばす。
 *
 * **載せられなかったことを利用者に伝えるのはここ**（`failure-surfacing.md` の F-31）。
 * ツリーは構文として読めれば通すので、盤に載るかはここまで来ないと分からない。
 * `game.state.error` を描かずに `notify` を呼ぶのは ADR-0004 決定6——状態としての
 * エラーと、利用者に届ける通知は別物で、通知を閉じても載せられなかったことは変わらない。
 */
export function GameFileTreeBridge() {
  const { activeKifuPath, jkfData, kifuFormat } = useFileTree();
  const { loadGame, resetGame } = useGame();
  const { notify } = useNotify();

  useEffect(() => {
    if (!(activeKifuPath && jkfData && kifuFormat)) {
      resetGame();
      return;
    }

    const run = async () => {
      const res = await loadGame(jkfData, activeKifuPath);
      if (res.success) return;

      notify({
        tier: "danger",
        presentation: "modal",
        // **同じ棋譜で畳む。** StrictMode では effect が2回走り、載せ直しも
        // 同じパスで繰り返される。鍵が無いと同じ文言が積み上がる
        dedupeKey: `kifu-unloadable:${activeKifuPath}`,
        title: `「${basename(activeKifuPath)}」を盤に並べられませんでした`,
        // 段が `danger` なのは、同じ棋譜をもう一度開いても同じ結果になるから。
        // 直すにはファイルそのものを直すか、別の棋譜を選ぶしかない
        body: "開始局面を読み取れません。ファイルが壊れている可能性があります。盤には前の棋譜が残っています。",
      });
    };

    void run();
  }, [activeKifuPath, jkfData, kifuFormat, loadGame, resetGame, notify]);

  return null;
}
