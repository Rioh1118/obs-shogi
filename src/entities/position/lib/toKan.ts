import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";

/**
 * 駒種を漢字にする
 *
 * 引数が `string` なのは、持ち駒が `Kind` ではなく素の文字列で運ばれてくるため
 * （`PreviewData.hands`）。`Kind` でない値が来たらそのまま返す。
 */
export function toKan(kind: string): string {
  return JKFPlayer.kindToKan(kind as Kind) ?? kind;
}
