import type {
  IMoveMoveFormat,
  IPlaceFormat,
} from "json-kifu-format/dist/src/Formats";
import type { Kind } from "shogi.js";

/**
 * 座標を将棋の記法に変換
 */
function formatPlace(place: IPlaceFormat): string {
  const x = place.x;
  const y = "一二三四五六七八九"[place.y - 1];
  return `${x}${y}`;
}

/**
 * 駒の種類を日本語表記に変換
 */
function formatPiece(kind: Kind): string {
  const pieceMap: Record<Kind, string> = {
    FU: "歩",
    KY: "香",
    KE: "桂",
    GI: "銀",
    KI: "金",
    KA: "角",
    HI: "飛",
    OU: "王",
    TO: "と",
    NY: "成香",
    NK: "成桂",
    NG: "成銀",
    UM: "馬",
    RY: "龍",
  };
  return pieceMap[kind] || kind;
}

/**
 * 手を日本語の棋譜記法に変換
 * 例: "７六歩", "２二角成", "同銀", "５三銀打"
 */
export function formatMove(move?: IMoveMoveFormat): string {
  if (!move) return "";

  let result = "";

  // 移動先
  if (move.same) {
    result += "同";
  } else if (move.to) {
    result += formatPlace(move.to);
  }

  // 駒の種類
  result += formatPiece(move.piece);

  // 成り
  if (move.promote) {
    result += "成";
  }

  // 駒打ち（fromがない場合）
  if (!move.from) {
    result += "打";
  }

  // 相対表記（「右」「左」「直」など）
  if (move.relative) {
    result += `(${move.relative})`;
  }

  return result;
}

/**
 * 2つの手が同じかどうかを比較
 * @param move1 比較する手1
 * @param move2 比較する手2
 * @param strict 厳密比較モード（relative等も含む）
 * @returns 同じ手ならtrue
 */
export function isSameMove(
  move1?: IMoveMoveFormat,
  move2?: IMoveMoveFormat,
  strict: boolean = false,
): boolean {
  if (!move1 || !move2) return false;

  // 基本的な比較
  const basicSame =
    move1.piece === move2.piece &&
    move1.color === move2.color &&
    move1.promote === move2.promote &&
    isSamePlace(move1.from, move2.from) &&
    isSamePlace(move1.to, move2.to);

  if (!basicSame) return false;

  // 厳密比較モード
  if (strict) {
    return (
      move1.same === move2.same &&
      move1.capture === move2.capture &&
      move1.relative === move2.relative
    );
  }

  return true;
}

/**
 * 2つの座標が同じかどうかを比較
 */
function isSamePlace(place1?: IPlaceFormat, place2?: IPlaceFormat): boolean {
  if (!place1 && !place2) return true;
  if (!place1 || !place2) return false;
  return place1.x === place2.x && place1.y === place2.y;
}

/**
 * 手のハッシュ値を生成（高速な比較用）
 */
export function getMoveHash(move: IMoveMoveFormat): string {
  const from = move.from ? `${move.from.x}${move.from.y}` : "00";
  const to = move.to ? `${move.to.x}${move.to.y}` : "00";
  const promote = move.promote ? "+" : "";
  return `${move.color}_${from}_${to}_${move.piece}${promote}`;
}
