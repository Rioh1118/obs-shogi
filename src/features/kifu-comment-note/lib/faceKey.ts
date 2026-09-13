import type { CursorPath } from "@/entities/kifu/model/cursor";

/**
 * ノートが出している面の識別子。「どの棋譜の、どの手の、どの変化か」。
 *
 * **盤に載っている棋譜の識別子を混ぜる。** 手数と変化だけで作ると、別の棋譜の同じ手数が
 * 同じ面になり、書き込みが返ってきたときの突き合わせが素通りする。
 *
 * **混ぜるのはパスではなく `boardSeq`。** パスは改名・移動でも動くので、名前を直しただけで
 * 鍵が変わる——`KifuCommentNote` は鍵が変わった面を別の面として組み直すので、
 * **書きかけの本文がそこで捨てられる**。
 *
 * `tesuuPointer` を使わない。あれを解く経路はリポジトリに1つも無く、
 * そもそも受け取るのは `CursorPath` なので観測値を持たない。要求から鍵を組むなら
 * `cursorKey` に寄せる規約で、ここで別の読み方を増やさない。
 */
export function faceKey(cursor: CursorPath, boardSeq: number): string {
  const path = (cursor.forkPointers ?? []).map((p) => `${p.te}:${p.forkIndex}`).join("|");
  return `${boardSeq}__${cursor.tesuu}__${path}`;
}
