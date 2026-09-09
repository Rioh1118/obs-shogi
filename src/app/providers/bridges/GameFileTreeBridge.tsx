import { useEffect, useRef } from "react";
import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { getBaseName } from "@/shared/lib/path";
import { describeKifuLoadFailure, kifuLoadFailureTier } from "@/entities/game/lib/kifuLoadFailure";

/**
 * ツリーが開いた棋譜を盤に載せる。
 *
 * **改名・移動では載せ直さない。** ツリーは改名で `jkfData` を持ち越して
 * `activeKifuPath` だけを張り替えるので、そこで載せ直すと**開いた時点の内容**が
 * 盤に戻る——盤・棋譜一覧・カーソル・分岐の選択がその時点まで巻き戻り、
 * そこから1手指すと、間の編集を落とした棋譜が新しいパスへ保存される。
 * 見分けているのは `loadedJkfDataRef`（下の doc）。
 *
 * **載せられなかったことを利用者に伝えるのはここ**（`failure-surfacing.md` の F-31）。
 * ツリーと盤の合図がずれる唯一の場所がここなので（違いは `loadedAbsPath` の doc）、
 * 断りを出せるのもここだけ。
 * `game.state.error` を描かずに `notify` を呼ぶのは ADR-0004 決定6——状態としての
 * エラーと、利用者に届ける通知は別物で、通知を閉じても載せられなかったことは変わらない。
 */
export function GameFileTreeBridge() {
  const { activeKifuPath, jkfData, kifuFormat } = useFileTree();
  const { loadGame, renameLoadedPath, resetGame } = useGame();
  const { notify } = useNotify();

  /**
   * いま盤に載っている棋譜の元になった `jkfData`。
   * **載せ直しと改名を見分けられるのはこの参照だけ**——`entities/game` は
   * ツリーが持つ `jkfData` を見ないし、`entities/file-tree` は盤を見ない。
   *
   * 棋譜を開き直す経路（`openKifuNode`）は毎回ディスクから読み直して新しい
   * オブジェクトを作るので、**同じ参照で effect が走るのは改名・移動のときだけ**
   * （その性質は `entities/file-tree` の `jkfData` の doc が持ち、
   * `activeKifuReferenceIdentity.test.ts` が固定している）。
   *
   * **控えるのは `loadGame` が返ったあと。** 最初の読み込みが飛んでいる最中に来た改名は
   * 参照が一致せず、載せ直しになる。その窓では利用者の編集がまだ入り得ないので
   * 落ちるものは無い。
   */
  const loadedJkfDataRef = useRef<JKFData | null>(null);

  useEffect(() => {
    if (!(activeKifuPath && jkfData && kifuFormat)) {
      loadedJkfDataRef.current = null;
      resetGame();
      return;
    }

    if (loadedJkfDataRef.current === jkfData) {
      renameLoadedPath(activeKifuPath);
      return;
    }

    const run = async () => {
      const res = await loadGame(jkfData, activeKifuPath);
      if (res.success) {
        // **載せられた回だけ控える。** 落ちた回も控えると、盤には前の棋譜が
        // 載ったままなのに次の改名で `renameLoadedPath` が通り、
        // **前の棋譜が改名先のファイルへ書き込まれる**
        loadedJkfDataRef.current = jkfData;
        return;
      }

      notify({
        // 段は `code` から決まる（`kifuLoadFailureTier`）。ここで選ばない——
        // 選ぶと、2件目の呼び手が別の段にしても誰も気づかない
        tier: kifuLoadFailureTier(res.error),
        presentation: "modal",
        // **同じ棋譜で畳む。** 載せられなかった棋譜のノードは `FileNode` の関門
        // （`canSkipReopen`）を通るので、押すたびに `openKifuNode` が新しい `jkfData` を
        // 作り、この effect が撃ち直される。鍵が無いと、押した回数だけ積み上がる。
        dedupeKey: `kifu-unloadable:${activeKifuPath}`,
        title: `「${getBaseName(activeKifuPath)}」を盤に並べられませんでした`,
        // **本文は「何をすれば直るか」から書く**（`NotifyRequest` の `body`）。
        // 段が `danger` で動作を持たない以上、次の一手を書けるのはここだけ。
        //
        // **「開き直しても結果は変わらない」と言い切らない。** 落ちるのはその時点の
        // 中身のせいで、外で直せば載る（関門が2条件なので押し直しは実際に届く）。
        // 言い切ると、直せるファイルまで利用者が諦める——台帳の復帰欄も
        // 「ファイルを直すか、別の棋譜を選ぶ」と書いている。
        //
        // **前の棋譜が残っているかで場合分けしない。** 残っているかは
        // `view.hasKifu` で分かるが、依存に足すと盤が載っただけで載せ直しが走り、
        // ref に写すと render 中の書き込みになる（→ #471）。どちらの場合にも
        // 当てはまる書き方にして、場合分けそのものを持たない。
        //
        // 残った盤が読むだけになるのは、ツリーが掴んでいるパスだけが進むため。
        // 保存先が食い違っている間、書き込みは `persistIfPossible` の門番が全部止める。
        //
        // **解き方まで書く。** 前の棋譜をツリーで選び直すと `activeKifuPath` が戻り、
        // 門番の条件が解ける。関門（`FileNode` の `canSkipReopen`）がツリーと盤の両方を
        // 見ているので、その押し直しは実際に届く。
        body:
          // 「何が起きたか」は `code` から。復帰の手順だけがこの画面の話
          `${describeKifuLoadFailure(res.error)}` +
          "直してから開き直すか、別の棋譜を選んでください。" +
          "盤に前の棋譜が残っている場合、その棋譜は表示だけになり、編集しても保存されません——" +
          "続けて編集するには、その棋譜をツリーでもう一度選んでください。",
      });
    };

    void run();
  }, [activeKifuPath, jkfData, kifuFormat, loadGame, renameLoadedPath, resetGame, notify]);

  return null;
}
