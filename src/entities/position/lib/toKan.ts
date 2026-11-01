import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";

/** 駒種を漢字にする。表に無い綴りが棋譜から来たら、そのまま返す */
export function toKan(kind: Kind): string {
  return JKFPlayer.kindToKan(kind) ?? kind;
}
