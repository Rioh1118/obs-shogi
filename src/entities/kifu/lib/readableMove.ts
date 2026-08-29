import { JKFPlayer } from "json-kifu-format";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";

/**
 * 指し手を日本語の棋譜表記にする
 *
 * 例: `"☗７六歩"` / `"☖同　角不成"` / `"☗５三銀打"` / `"☗７七銀左上"`
 *
 * 組み立てを JKFPlayer に任せるのは、相対表記・不成・曖昧な駒打ちの「打」が
 * すべて揃っているため。棋譜ストリーム側は `JKFPlayer.getReadableKifu()` 経由で同じ関数に
 * 行き着くので、両方の一覧で同じ手が同じ文字列になる。
 *
 * 投了・中断（`special`）も同じ関数が扱う。手も special も無い入力（手数0の枠など）は
 * 空文字を返すので、呼び出し側で代替の文言を出すこと。
 *
 * **正規化を通した手を渡すこと。** 手番（`color`）も「同」も相対表記も、手そのものではなく
 * 正規化が埋める。手で組んだ JKF を `new JKFPlayer()` に渡しただけでは何も付かず、
 * `☗５八金右` が `☖５八金` になる。`color` が無い手は例外も空文字も出さず、
 * 黙って後手の記号が付く。
 */
export function readableMove(mf: IMoveFormat): string {
  if (!mf.move && !mf.special) return "";
  return JKFPlayer.moveToReadableKifu(mf);
}
