import type { KifuCursor } from "@/entities/kifu/model/cursor";

/**
 * ノートが出している面の識別子。「どのファイルの、どの手の、どの変化か」。
 *
 * **棋譜の識別子を混ぜる。** 手数と変化だけで作ると、別のファイルの同じ手数が
 * 同じ面になり、書き込みが返ってきたときの突き合わせが素通りする。
 *
 * `tesuuPointer` を使わない。あれを解く経路はリポジトリに1つも無く、
 * 組む側も `buildTesuuPointer` に寄せる規約なので、ここで別の読み方を増やさない。
 */
export function faceKey(cursor: KifuCursor, absPath: string | null): string {
  const path = (cursor.forkPointers ?? []).map((p) => `${p.te}:${p.forkIndex}`).join("|");
  return `${absPath ?? ""}__${cursor.tesuu}__${path}`;
}
