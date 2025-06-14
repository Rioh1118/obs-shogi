// 変換後の指し手データ型
export interface ConvertedMove {
  move: string; // 日本語表記（例: "７六歩"）
  isBlack: boolean; // 先手かどうか
  sfenMove: string; // 元のSFEN表記
}

// SFEN -> 日本語変換ユーティリティ
const PIECE_MAP: Record<string, string> = {
  K: "玉",
  R: "飛",
  B: "角",
  G: "金",
  S: "銀",
  N: "桂",
  L: "香",
  P: "歩",
  k: "玉",
  r: "飛",
  b: "角",
  g: "金",
  s: "銀",
  n: "桂",
  l: "香",
  p: "歩",
  "+R": "龍",
  "+B": "馬",
  "+S": "成銀",
  "+N": "成桂",
  "+L": "成香",
  "+P": "と",
  "+r": "龍",
  "+b": "馬",
  "+s": "成銀",
  "+n": "成桂",
  "+l": "成香",
  "+p": "と",
};

const RANK_MAP: Record<string, string> = {
  a: "一",
  b: "二",
  c: "三",
  d: "四",
  e: "五",
  f: "六",
  g: "七",
  h: "八",
  i: "九",
};

const FILE_MAP: Record<string, string> = {
  "1": "１",
  "2": "２",
  "3": "３",
  "4": "４",
  "5": "５",
  "6": "６",
  "7": "７",
  "8": "８",
  "9": "９",
};

// SFEN文字列から先手番かどうかを判定
function isBlackMoveFromSfen(sfenMove: string): boolean {
  if (!sfenMove) return true;

  // 持ち駒打ちの場合（例: G*5b, g*5b）
  if (sfenMove.includes("*")) {
    const piece = sfenMove[0];
    return piece === piece.toUpperCase(); // 大文字なら先手
  }

  // 通常移動の場合は盤面情報が必要なので、デフォルトで先手とする
  // より正確な判定には盤面状態が必要
  return true;
}

// 単一の指し手をSFENから日本語に変換
function convertSfenMoveToJapanese(sfenMove: string): string {
  if (!sfenMove) return "";

  // 持ち駒打ち（例: G*5b）
  if (sfenMove.includes("*")) {
    const [piece, position] = sfenMove.split("*");
    const file = position[0];
    const rank = position[1];

    const pieceName = PIECE_MAP[piece] || piece;
    const fileJp = FILE_MAP[file] || file;
    const rankJp = RANK_MAP[rank] || rank;

    return `${fileJp}${rankJp}${pieceName}`;
  }

  // 通常の移動（例: 7g7f, 8h2b+）
  const isPromotion = sfenMove.endsWith("+");
  const move = isPromotion ? sfenMove.slice(0, -1) : sfenMove;

  if (move.length >= 4) {
    const toFile = move[2];
    const toRank = move[3];

    const fileJp = FILE_MAP[toFile] || toFile;
    const rankJp = RANK_MAP[toRank] || toRank;

    const suffix = isPromotion ? "成" : "";
    return `${fileJp}${rankJp}${suffix}`;
  }

  return sfenMove;
}

// SFEN手順配列を日本語データ配列に変換
export function convertSfenSequence(sfenMoves: string[]): ConvertedMove[] {
  if (sfenMoves.length === 0) return [];

  // 最初の手から先手番かどうかを判定
  const startsWithBlack = isBlackMoveFromSfen(sfenMoves[0]);

  return sfenMoves.map((sfenMove, index) => {
    const isBlack = startsWithBlack ? index % 2 === 0 : index % 2 === 1;
    const move = convertSfenMoveToJapanese(sfenMove);

    return {
      move,
      isBlack,
      sfenMove,
    };
  });
}

// 評価値フォーマット
export function formatEvaluation(evaluation: number | null): string {
  if (evaluation === null) return "---";
  return evaluation > 0 ? `+${evaluation}` : `${evaluation}`;
}

// 評価値をパーセンテージに変換（評価バー用）
// -3000〜+3000を0〜100%にマッピング、範囲外はクランプ
export function evaluationToPercentage(evaluation: number | null): number {
  if (evaluation === null) return 50;

  // -3000以下なら0%、+3000以上なら100%
  if (evaluation <= -3000) return 0;
  if (evaluation >= 3000) return 100;

  // -3000〜+3000を0〜100%にリニアマッピング
  return ((evaluation + 3000) / 6000) * 100;
}
