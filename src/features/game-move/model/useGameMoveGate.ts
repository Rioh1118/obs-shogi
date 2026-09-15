import { useCallback } from "react";
import { colorToSide, toUsiMove, type MoveGate } from "@/entities/game";
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
 * どの層がこの門を持つかは `docs/spec/screens/play-view.md` が決めている
 * ——`entities/game`（盤）と `entities/game-session`（対局）の2つを束ねるので、
 * 置ける最下層がここ。
 */
export function useGameMoveGate(): MoveGate {
  const { view, submitMove } = useGameSession();

  const accept = useCallback<MoveGate["accept"]>(
    async (move, kifuPath) => {
      // 手を受け付けている対局が無い。盤は普段どおり
      if (view.kind !== "live" && view.kind !== "starting") return true;

      // **別の棋譜を触っている。** 対局は棋譜が入れ替わっても走り続けるので、
      // いま開いている別の棋譜の編集まで止めない
      if (view.kifuPath !== kifuPath) return true;

      // まだ `gameId` が無い。**出す先が無いので積ませない**
      if (view.kind === "starting") return false;

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
