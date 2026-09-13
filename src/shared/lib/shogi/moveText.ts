import { Color, Record } from "tsshogi";

/** 日本語表記になった1手 */
export interface ConvertedMove {
  /** 例: `７六歩` */
  move: string;
  isBlack: boolean;
}

/**
 * 局面から指した手の列を、日本語表記にする。
 *
 * **読めなかった列は空を返す。** 途中まで読める列を途中まで返すと、
 * 呼び手は「その手数で終わる手順」と区別できない。
 *
 * `sfen` に指し手の列（`moves …`）を付けないこと。手順はこちらの引数で渡す。
 */
export function convertSfenSequence(sfen: string | null, sfenMoves: string[]): ConvertedMove[] {
  if (!sfen) {
    return [];
  }
  const usiString = `position sfen ${sfen} moves ${sfenMoves.join(" ")}`;

  const record = Record.newByUSI(usiString);
  if (record instanceof Error) {
    console.warn("[SFEN_CONVERTER] parse failed", {
      err: String(record),
      sfen: JSON.stringify(sfen),
      moves: sfenMoves.map((m) => JSON.stringify(m)),
      usi: JSON.stringify(usiString),
    });
    return [];
  }

  return record.moves.slice(1).map((move) => ({
    move: move.displayText,
    isBlack: move.prev!.nextColor === Color.BLACK,
  }));
}
