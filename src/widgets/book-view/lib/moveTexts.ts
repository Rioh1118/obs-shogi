import type { BookMove } from "@/entities/book";
import { convertSfenSequence } from "@/shared/lib/shogi/moveText";

/** 表に出す、1行ぶんの指し手の綴り */
type BookMoveTexts = {
  /** 日本語表記。読めなければ USI のまま */
  move: string;
  /** 応手。定跡が持っていなければ `"—"` */
  ponder: string;
};

/**
 * 候補手と応手を日本語にする。
 *
 * **応手が読めなくても、指し手は日本語にする。** 2手まとめて変換すると、
 * 応手のほうが局面に当たらない定跡（壊れた行・別の初期配置向け）で
 * **候補手まで USI のまま出る** —— 読めない欄は1つで済ませる。
 *
 * 読めなかった綴りは伏せずにそのまま出す。伏せると、定跡に何が書いてあるのかを
 * 画面から確かめる手段が無くなる。
 */
export function bookMoveTexts(sfen: string | null, move: BookMove): BookMoveTexts {
  if (move.ponder) {
    const both = convertSfenSequence(sfen, [move.usiMove, move.ponder]);
    if (both.length === 2) {
      return { move: both[0].move, ponder: both[1].move };
    }
  }

  const only = convertSfenSequence(sfen, [move.usiMove]);

  return {
    move: only[0]?.move ?? move.usiMove,
    ponder: move.ponder ?? "—",
  };
}
