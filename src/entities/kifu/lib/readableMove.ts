import { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

/**
 * 指し手を日本語の棋譜表記にする
 *
 * 例: `"☗７六歩"` / `"☖同　角不成"` / `"☗５三銀打"` / `"☗７七銀左上"`
 *
 * 組み立てを JKFPlayer に任せるのは、手番記号・相対表記・不成・曖昧な駒打ちの「打」が
 * すべて揃っているため。棋譜ストリーム側は `JKFPlayer.getReadableKifu()` 経由で同じ関数に
 * 行き着くので、両方の一覧で同じ手が同じ文字列になる。
 *
 * 扱うのは指し手だけ。投了や中断（`IMoveFormat.special`）は受け取らないので、
 * それらを含む一覧では項目数まで揃うとは限らない。
 *
 * 「同」と相対表記は手そのものではなく正規化が埋める。手で組んだ JKF を
 * `new JKFPlayer()` に渡しただけでは埋まらず `☗５八金右` が `☗５八金` になる。
 * パーサか `Normalizer` を通した手を渡すこと。
 */
export function readableMove(move: IMoveMoveFormat): string {
  return JKFPlayer.moveToReadableKifu({ move });
}
