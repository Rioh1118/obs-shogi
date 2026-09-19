import { useEffect, useRef } from "react";
import { fromUsiMove, isPrefixOf, lineUsiMoves, useGame } from "@/entities/game";
import { useGameSession, type GameId } from "@/entities/game-session";

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
  const { view, reportBoardFailure } = useGameSession();
  const { view: board, state, makeMove } = useGame();

  const running = view.kind === "live" || view.kind === "over" ? view : null;
  const usiMoves = running?.usiMoves;
  const kifuPath = running?.kifuPath ?? null;
  const gameId = running?.gameId ?? null;
  const isOver = view.kind === "over";

  /**
   * 先端まで届け終えた対局。**届けたら、その対局にはもう押さない。**
   *
   * 橋は「先頭一致していて短い盤＝まだ積んでいない」と読むが、その読みが正しいのは
   * **積む相手がまだ増えるあいだ**だけ。終局した対局で同じように読むと、
   * 利用者が遡った盤を「遅れている盤」と取り違えて1手ずつ押し戻す ——
   * 1回の描画で1手進むので、**終局した棋譜は先端に貼り付いて動かせなくなる。**
   */
  const settledRef = useRef<GameId | null>(null);

  /**
   * 最後に積もうとした位置。**積めなかった位置を覚えておくために持つ。**
   *
   * 棋譜が入れ替わるか、対局が先へ進むまでは同じ位置を出し直さない。
   */
  const attemptedRef = useRef<{ kifuPath: string | null; at: number } | null>(null);

  const player = board.player;
  const loadedAbsPath = state.loadedAbsPath;

  useEffect(() => {
    if (usiMoves === undefined || player === null) return;

    // **別の棋譜を見ている間は載せない。** 対局は棋譜が入れ替わっても走り続けるので、
    // ここで積むと関係の無い棋譜へ対局の手が入る
    if (kifuPath !== loadedAbsPath) return;

    // 届け終えた対局。**遡ったのは利用者なので、追いかけない**
    if (isOver && settledRef.current === gameId) return;

    // **盤が対局の線の上に居るときだけ積む。**
    //
    // **手数で見ない。** 遡って分岐を並べた盤は、同じ深さでも別の手順を辿っている。
    // そこへ積むと、遡って見ていた枝に対局の手が生える。
    // 手数の一致だけを条件にすると、その枝を「まだ積んでいない対局の線」と読む。
    //
    // 先頭一致で見るので、**2手以上遅れた盤も追いつく**（1回の描画で1手ずつ）。
    // 等号で見ると、遡っている間に2手決まった対局からは二度と追いつけない
    // —— 差が縮まらないまま、棋譜だけが対局から置き去りになる。
    const line = lineUsiMoves(player);
    if (line === null || !isPrefixOf(line, usiMoves)) return;

    // 盤が先端に追いついている。積むものは無い
    if (line.length === usiMoves.length) {
      // **終局した対局はここで打ち止め。** 手はもう増えないので、この先に
      // 短い盤が来たら「遅れている」のではなく**利用者が遡った**ということ
      if (isOver) settledRef.current = gameId;
      return;
    }

    const move = fromUsiMove(usiMoves[line.length], player.shogi, player.shogi.turn);
    // 綴りを戻せない＝盤と対局の局面がずれている。**黙って積まない**
    if (move === null) return;

    // **同じ位置を二度出さない。**
    //
    // 積めなかった `makeMove` は `jkf_restored` で盤を戻す（`entities/game` の `edit`）。
    // 戻った盤はまた同じ位置で先頭一致するので、控えが無いと
    // **積む→書けない→戻す→積む**が止まらない。ディスクの故障は要らない ——
    // 盤に載せられなかった棋譜を選ぶと `persistIfPossible` が永久に断るので、
    // そこからは書き込みを1回もせずに描き直しだけが回る。
    //
    // **待つ前に控える。** 戻す `dispatch` は `makeMove` が解決するより先に走るので、
    // 解決を待ってから控えると、その前にこの効果がもう一度走る。
    const attempted = attemptedRef.current;
    if (attempted !== null && attempted.kifuPath === kifuPath && attempted.at === line.length) {
      return;
    }
    attemptedRef.current = { kifuPath, at: line.length };

    // **結果を控えてから読む。** `void makeMove(...).then(...)` と続けて書くと、
    // 戻り値の読み落としを見る走査が「読まずに撃った」形として拾う（`.then` を見ていない）
    const appended = makeMove(move);

    void appended.then((result) => {
      // **積めたら控えを捨てる。** 残すと、遡って見てから先端へ戻ったときに
      // 同じ位置を積み直せなくなる
      if (result.success) {
        attemptedRef.current = null;
        reportBoardFailure(null);
        return;
      }
      reportBoardFailure(result.error);
    });
  }, [usiMoves, player, kifuPath, loadedAbsPath, makeMove, reportBoardFailure, gameId, isOver]);

  return null;
}
