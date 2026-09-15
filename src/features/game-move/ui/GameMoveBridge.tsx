import { useEffect } from "react";
import { fromUsiMove, useGame } from "@/entities/game";
import { useGameSession } from "@/entities/game-session";

/**
 * 対局で決まった手を盤へ載せる。
 *
 * **こちらが出していない手を積むのはここだけ。** 人の手は盤から出て
 * `useGameMoveGate` を通って積まれるが、**エンジンが決めた手は誰も積んでいない**。
 * 積まないと盤の手番が相手側で止まり、次にこちらが指す手は「相手の手番」として
 * 門に落とされる —— **クリックしても何も起きないまま時計が切れて負ける**
 * （断りの出し先は盤に無い。#277）。
 *
 * **`GameProvider` の内側に置くこと**（`useGame` を読む）。
 *
 * **1回に1手だけ積む。** 積めば盤が描き直り、この効果がもう一度走る。
 * まとめて積もうとすると、`await` の間に盤が別の棋譜へ入れ替わる窓ができる。
 */
export function GameMoveBridge() {
  const { view } = useGameSession();
  const { view: board, state, makeMove } = useGame();

  const running = view.kind === "live" || view.kind === "over" ? view : null;
  const usiMoves = running?.usiMoves;
  const kifuPath = running?.kifuPath ?? null;

  const player = board.player;
  const loadedAbsPath = state.loadedAbsPath;

  useEffect(() => {
    if (usiMoves === undefined || player === null) return;

    // **別の棋譜を見ている間は載せない。** 対局は棋譜が入れ替わっても走り続けるので、
    // ここで積むと関係の無い棋譜へ対局の手が入る
    if (kifuPath !== loadedAbsPath) return;

    // **末尾の1手ぶんだけ遅れているときにしか積まない。**
    // 盤の手数で「どこまで積んだか」を見るので、人の手を二度積むことは無い
    // （盤から出た手は既に入っている）。**過去へ戻って見ているときも積まない**
    // —— まとめて積み直すと、遡って見ていた枝に対局の手が生える
    if (player.tesuu !== usiMoves.length - 1) return;

    const move = fromUsiMove(usiMoves[player.tesuu], player.shogi, player.shogi.turn);
    // 綴りを戻せない＝盤と対局の局面がずれている。**黙って積まない**
    if (move === null) return;

    void makeMove(move); // async-result-ignored: 盤には出す場所が無い → #277
  }, [usiMoves, player, kifuPath, loadedAbsPath, makeMove]);

  return null;
}
