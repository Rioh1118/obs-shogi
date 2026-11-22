import { Position } from "tsshogi";

/**
 * 局面の手番の側が、自分の手で毎回王手をかけ続ける手順か。
 *
 * 途中で指せない手があれば偽。最後の局面が詰んでいるかは見ない
 */
export function everyAttackGivesCheck(sfen: string, usiMoves: readonly string[]): boolean {
  const position = Position.newBySFEN(sfen);
  if (!position || usiMoves.length === 0) return false;

  return usiMoves.every((usi, at) => {
    const move = position.createMoveByUSI(usi);
    if (!move || !position.doMove(move)) return false;
    // 奇数手目が攻め方。指した後の手番（受け方）の玉に王手がかかっているか
    return at % 2 === 1 || position.checked;
  });
}
