import { useEffect } from "react";
import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { getBaseName } from "@/shared/lib/path";

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
 * ツリーと盤の合図がずれる唯一の場所がここなので（違いは `loadedAbsPath` の doc）、
 * 断りを出せるのもここだけ。
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
        // **同じ棋譜で畳む。** 載せられなかった棋譜のノードはツリーの関門を通る
        // （`FileNode` の `isActive` は盤とツリーの両方が指しているときだけ真）ので、
        // 押すたびに `openKifuNode` が新しい `jkfData` を作り、この effect が撃ち直される。
        // 鍵が無いと、押した回数だけ同じ文言が積み上がる。
        dedupeKey: `kifu-unloadable:${activeKifuPath}`,
        title: `「${getBaseName(activeKifuPath)}」を盤に並べられませんでした`,
        // **本文は「何をすれば直るか」から書く**（`NotifyRequest` の `body`）。
        // 段が `danger` で動作を持たない以上、次の一手を書けるのはここだけ。
        //
        // **前の棋譜が残っているかで場合分けしない。** 残っているかは
        // `view.hasKifu` で分かるが、依存に足すと盤が載っただけで載せ直しが走り、
        // ref に写すと render 中の書き込みになる（→ #471）。どちらの場合にも
        // 当てはまる書き方にして、場合分けそのものを持たない。
        //
        // 残った盤が読むだけになるのは、ツリーが掴んでいるパスだけが進むため。
        // 保存先が食い違っている間、書き込みは `persistIfPossible` の門番が全部止める。
        body:
          "別の棋譜を選んでください。同じファイルを開き直しても結果は変わりません。" +
          "盤に前の棋譜が残っている場合、その棋譜は表示だけになり、編集しても保存されません。",
      });
    };

    void run();
  }, [activeKifuPath, jkfData, kifuFormat, loadGame, resetGame, notify]);

  return null;
}
