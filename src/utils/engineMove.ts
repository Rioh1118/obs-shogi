import type { JKFPlayer } from "json-kifu-format";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";

/**
 * 将棋の駒種類をエンジン用文字に変換
 */
export const kindToEngineChar = (kind: string): string => {
  const kindMap: { [key: string]: string } = {
    FU: "P", // 歩
    KY: "L", // 香
    KE: "N", // 桂
    GI: "S", // 銀
    KI: "G", // 金
    KA: "B", // 角
    HI: "R", // 飛
    OU: "K", // 王
    TO: "+P", // と
    NY: "+L", // 成香
    NK: "+N", // 成桂
    NG: "+S", // 成銀
    UM: "+B", // 馬
    RY: "+R", // 龍
  };
  return kindMap[kind] || kind;
};

/**
 * 将棋の座標(1-9, 1-9)をエンジン用座標に変換
 * @param x 横座標 (1-9, 右から左)
 * @param y 縦座標 (1-9, 上から下)
 * @returns エンジン用座標文字列 (例: "7g")
 */
export const coordToEnginePos = (x: number, y: number): string => {
  // x: 1-9 -> 9-1 (将棋は9筋が左端、1筋が右端)
  const engineX = 10 - x;
  // y: 1-9 -> a-i (1段目がa、9段目がi)
  const engineY = String.fromCharCode(96 + y); // 1->a, 2->b, ..., 9->i
  return `${engineX}${engineY}`;
};

/**
 * エンジン用座標を将棋座標に変換（逆変換）
 * @param enginePos エンジン用座標文字列 (例: "7g")
 * @returns 将棋座標 {x, y}
 */
export const enginePosToCoord = (
  enginePos: string,
): { x: number; y: number } => {
  if (enginePos.length !== 2) {
    throw new Error(`Invalid engine position format: ${enginePos}`);
  }

  const engineX = parseInt(enginePos[0]);
  const engineY = enginePos[1];

  const x = 10 - engineX;
  const y = engineY.charCodeAt(0) - 96; // a->1, b->2, ..., i->9

  return { x, y };
};

/**
 * IMoveFormatをエンジン用の指し手文字列に変換
 * @param moveFormat JKF形式の指し手
 * @returns エンジンが理解できる指し手文字列 (例: "7g7f", "G*5e")
 */
export const convertMoveToEngineFormat = (
  moveFormat: IMoveFormat,
): string | null => {
  if (!moveFormat.move) return null;

  const move = moveFormat.move;

  // 持ち駒を打つ場合
  if (!move.from && move.to && move.piece) {
    const kindChar = kindToEngineChar(move.piece);
    const toPos = coordToEnginePos(move.to.x, move.to.y);
    return `${kindChar}*${toPos}`;
  }

  // 通常の移動
  if (move.from && move.to) {
    const fromPos = coordToEnginePos(move.from.x, move.from.y);
    const toPos = coordToEnginePos(move.to.x, move.to.y);

    // 成りの判定
    const promote = move.promote ? "+" : "";

    return `${fromPos}${toPos}${promote}`;
  }

  return null;
};

/**
 * JKFPlayerから現在の局面までの指し手をエンジン形式で取得
 * @param jkfPlayer JKFPlayerインスタンス
 * @returns エンジン用指し手文字列の配列
 */
export const getMovesFromJKFPlayer = (jkfPlayer: JKFPlayer): string[] => {
  if (!jkfPlayer?.kifu?.moves) {
    return [];
  }

  const moves: string[] = [];

  // 初手(0番目)は通常初期局面なのでスキップし、1番目から処理
  for (
    let i = 1;
    i <= jkfPlayer.tesuu && i < jkfPlayer.kifu.moves.length;
    i++
  ) {
    const moveFormat = jkfPlayer.kifu.moves[i];

    // 特殊な指し手（投了など）はスキップ
    if (moveFormat.special) {
      break;
    }

    const engineMove = convertMoveToEngineFormat(moveFormat);
    if (engineMove) {
      moves.push(engineMove);
    }
  }

  return moves;
};

/**
 * 指し手配列からエンジン用position文字列を生成
 * @param moves エンジン用指し手文字列の配列
 * @param startPos 開始局面 (デフォルト: "startpos")
 * @returns position コマンド文字列
 */
export const createPositionCommand = (
  moves: string[],
  startPos: string = "startpos",
): string => {
  if (moves.length === 0) {
    return startPos;
  }
  return `${startPos} moves ${moves.join(" ")}`;
};

/**
 * エンジンの指し手文字列を日本語表記に変換（表示用）
 * @param engineMove エンジン用指し手文字列
 * @returns 日本語表記の指し手（簡易版）
 */
export const engineMoveToJapanese = (engineMove: string): string => {
  try {
    // 持ち駒打ちの場合
    if (engineMove.includes("*")) {
      const [piece, pos] = engineMove.split("*");
      const coord = enginePosToCoord(pos);
      const pieceJp = engineCharToKanji(piece);
      return `${coord.x}${coord.y}${pieceJp}打`;
    }

    // 通常の移動
    const isPromotion = engineMove.includes("+");
    const cleanMove = engineMove.replace("+", "");

    if (cleanMove.length >= 4) {
      const fromPos = cleanMove.substring(0, 2);
      const toPos = cleanMove.substring(2, 4);

      const fromCoord = enginePosToCoord(fromPos);
      const toCoord = enginePosToCoord(toPos);

      const promotion = isPromotion ? "成" : "";
      return `${fromCoord.x}${fromCoord.y}${toCoord.x}${toCoord.y}${promotion}`;
    }

    return engineMove; // 変換できない場合はそのまま
  } catch {
    return engineMove; // エラーの場合はそのまま
  }
};

/**
 * エンジン用駒文字を漢字に変換
 */
const engineCharToKanji = (engineChar: string): string => {
  const charMap: { [key: string]: string } = {
    P: "歩",
    "+P": "と",
    L: "香",
    "+L": "成香",
    N: "桂",
    "+N": "成桂",
    S: "銀",
    "+S": "成銀",
    G: "金",
    B: "角",
    "+B": "馬",
    R: "飛",
    "+R": "龍",
    K: "王",
  };
  return charMap[engineChar] || engineChar;
};

/**
 * 変換ロジックのテスト用ヘルパー
 */
export const testMoveConversion = () => {
  console.log("🧪 Testing move conversion...");

  // テストケース
  const testCases = [
    { x: 7, y: 7, expected: "3g" }, // 7七 -> 3g
    { x: 5, y: 5, expected: "5e" }, // 5五 -> 5e
    { x: 1, y: 1, expected: "9a" }, // 1一 -> 9a
    { x: 9, y: 9, expected: "1i" }, // 9九 -> 1i
  ];

  testCases.forEach(({ x, y, expected }) => {
    const result = coordToEnginePos(x, y);
    console.log(
      `${x}${y} -> ${result} (expected: ${expected}) ${result === expected ? "✅" : "❌"}`,
    );
  });

  // 逆変換テスト
  testCases.forEach(({ x, y, expected }) => {
    const coord = enginePosToCoord(expected);
    const match = coord.x === x && coord.y === y;
    console.log(
      `${expected} -> ${coord.x}${coord.y} (expected: ${x}${y}) ${match ? "✅" : "❌"}`,
    );
  });
};
