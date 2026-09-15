import { useCallback } from "react";
import { colorToSide, isPrefixOf, toUsiMove, type MoveGate } from "@/entities/game";
import { useGameSession } from "@/entities/game-session";

/**
 * 対局中の盤の着手を受ける門。
 *
 * **対局中は、Rust が採るまで棋譜へ積まない。** 盤はそのままだと手番の所有者を
 * 見ずに積んで自動保存まで走るので、相手の手番で指せてしまうと
 * **Rust は着手を受けていないのに棋譜だけが1手先へ進む**。
 * 次の裁定に渡す指し手列が Rust の写しと食い違って断られ、
 * **呼び直しても直らないまま `RULING_TIMEOUT` で対局が畳まれる。**
 *
 * **手を受け付けている対局が無いときは素通し。** 棋譜を並べ替える普段の編集を止めない。
 *
 * **`starting` は素通しにしない。** `start_game` は評価関数の読み込みを待つので
 * 数十秒かかりうる。その間に盤を触れると、Rust の知らない手が棋譜に入る ——
 * 対局そのものは Rust の写しで進むので壊れないが、**棋譜が対局の記録として使えなくなる。**
 *
 * **`over` も素通しにしない。** 終局しても「閉じる」まで対局は残っていて、
 * その間の盤は普段の編集として受けて自動保存まで走る。止めないと
 * **時間切れで負けた局面から指し続けられる。** 止めるのは対局の線の先端だけ。
 *
 * どの層がこの門を持つかは `docs/spec/screens/play-view.md` が決めている
 * ——`entities/game`（盤）と `entities/game-session`（対局）の2つを束ねるので、
 * 置ける最下層がここ。
 */
export function useGameMoveGate(): MoveGate {
  const { view, submitMove } = useGameSession();

  const accept = useCallback<MoveGate["accept"]>(
    async (move, line) => {
      // 手を受け付けている対局が無い。盤は普段どおり
      if (view.kind !== "live" && view.kind !== "starting" && view.kind !== "over") return true;

      // **別の棋譜を触っている。** 対局は棋譜が入れ替わっても走り続けるので、
      // いま開いている別の棋譜の編集まで止めない
      if (view.kifuPath !== line.kifuPath) return true;

      // **終わった対局の記録には、その続きを足させない。**
      //
      // 終局しても閉じるまでは対局が残る。そこを素通しにすると、盤は普段の編集として
      // 受けて自動保存まで走る —— **時間切れで負けた局面から指し続けられる。**
      // 終局は棋譜に残らない（特殊手を挿す経路が無い。#115）ので、開き直すと
      // **対局がそのまま続いたようにしか見えない。**
      //
      // 止めるのは対局の線の先端だけ。遡って並べる検討は普段の操作なので通す。
      // 続きを足したくなったら「閉じる」を押す（`idle` になれば上で素通しになる）
      if (view.kind === "over") {
        return !isGameTip(line.usiMoves, view.usiMoves);
      }

      // まだ `gameId` が無い。**出す先が無いので積ませない**
      if (view.kind === "starting") return false;

      // **盤が対局の先端に居ないなら出さない。** 遡って分岐を並べるのは
      // 対局中も止めていない普通の操作で、そこで指した手は「次の1手」ではない。
      // 出すと Rust の写しに異物として載り、`continue_game` の突き合わせで
      // 弾かれて**対局そのものが中断される** —— 終局理由に出るのは
      // 「n手目を指せない」で、遡った操作とは結び付かない。
      //
      // **手数では見ない。** 同じ深さの別の線と区別が付かない（`lineUsiMoves`）
      if (!isGameTip(line.usiMoves, view.usiMoves)) return false;

      const side = colorToSide(move.color);

      // 相手の手番。**盤で指せてしまう形をここで止める**
      if (side !== view.toMove) return false;

      // エンジンの席。人が代わりに指すことはできない
      if (!view.humanSides.includes(side)) return false;

      const usiMove = toUsiMove(move);
      // 綴れない手は出さない。**Rust は形として通したうえで、
      // エンジンが解釈できない行を受け取る**
      if (usiMove === null) return false;

      const submitted = await submitMove(side, usiMove);
      return submitted.success;
    },
    [view, submitMove],
  );

  return { accept };
}

/**
 * 盤が対局の線の先端に居るか。**綴れない手が混じった線は「先端ではない」。**
 *
 * 根からの綴りを丸ごと突き合わせる（Rust の `accept_continue` と同じ形）。
 * **手数で見ない** —— 遡って分岐を並べた盤は同じ深さでも別の手順を辿っているので、
 * 深さだけで見ると分岐で指した手が「対局の次の1手」として扱われる。
 */
function isGameTip(
  lineUsiMoves: readonly string[] | null,
  gameUsiMoves: readonly string[],
): boolean {
  if (lineUsiMoves === null) return false;
  if (lineUsiMoves.length !== gameUsiMoves.length) return false;
  return isPrefixOf(lineUsiMoves, gameUsiMoves);
}
