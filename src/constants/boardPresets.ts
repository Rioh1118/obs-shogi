import {
  PIECE_TYPES,
  PLAYER_COLORS,
  createPiece,
  type PieceData,
} from "./shogi";

// 平手の初期配置
export const HIRATE_BOARD: PieceData[][] = [
  // 1段目（後手の駒）
  [
    createPiece(PLAYER_COLORS.GOTE, "KY"), // 1一香
    createPiece(PLAYER_COLORS.GOTE, "KE"), // 2一桂
    createPiece(PLAYER_COLORS.GOTE, "GI"), // 3一銀
    createPiece(PLAYER_COLORS.GOTE, "KI"), // 4一金
    createPiece(PLAYER_COLORS.GOTE, "OU"), // 5一玉
    createPiece(PLAYER_COLORS.GOTE, "KI"), // 6一金
    createPiece(PLAYER_COLORS.GOTE, "GI"), // 7一銀
    createPiece(PLAYER_COLORS.GOTE, "KE"), // 8一桂
    createPiece(PLAYER_COLORS.GOTE, "KY"), // 9一香
  ],
  // 2段目
  [
    null, // 1二
    createPiece(PLAYER_COLORS.GOTE, "HI"), // 2二飛
    null,
    null,
    null,
    null,
    null,
    createPiece(PLAYER_COLORS.GOTE, "KA"), // 8二角
    null, // 9二
  ],
  // 3段目（後手の歩）
  [
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 1三歩
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 2三歩
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 3三歩
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 4三歩
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 5三歩
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 6三歩
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 7三歩
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 8三歩
    createPiece(PLAYER_COLORS.GOTE, "FU"), // 9三歩
  ],
  // 4段目（空）
  [null, null, null, null, null, null, null, null, null],
  // 5段目（空）
  [null, null, null, null, null, null, null, null, null],
  // 6段目（空）
  [null, null, null, null, null, null, null, null, null],
  // 7段目（先手の歩）
  [
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 1七歩
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 2七歩
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 3七歩
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 4七歩
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 5七歩
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 6七歩
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 7七歩
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 8七歩
    createPiece(PLAYER_COLORS.SENTE, "FU"), // 9七歩
  ],
  // 8段目
  [
    null, // 1八
    createPiece(PLAYER_COLORS.SENTE, "KA"), // 2八角
    null,
    null,
    null,
    null,
    null,
    createPiece(PLAYER_COLORS.SENTE, "HI"), // 8八飛
    null, // 9八
  ],
  // 9段目（先手の駒）
  [
    createPiece(PLAYER_COLORS.SENTE, "KY"), // 1九香
    createPiece(PLAYER_COLORS.SENTE, "KE"), // 2九桂
    createPiece(PLAYER_COLORS.SENTE, "GI"), // 3九銀
    createPiece(PLAYER_COLORS.SENTE, "KI"), // 4九金
    createPiece(PLAYER_COLORS.SENTE, "OU"), // 5九王
    createPiece(PLAYER_COLORS.SENTE, "KI"), // 6九金
    createPiece(PLAYER_COLORS.SENTE, "GI"), // 7九銀
    createPiece(PLAYER_COLORS.SENTE, "KE"), // 8九桂
    createPiece(PLAYER_COLORS.SENTE, "KY"), // 9九香
  ],
];

// その他のプリセット
export const EMPTY_BOARD: PieceData[][] = Array(9)
  .fill(null)
  .map(() => Array(9).fill(null));

// 香落ち
export const KYOOCHI_BOARD: PieceData[][] = [
  // 1段目（後手の駒）- 1一香を削除
  [
    null, // 1一香落ち
    createPiece(PLAYER_COLORS.GOTE, "KE"), // 2一桂
    createPiece(PLAYER_COLORS.GOTE, "GI"), // 3一銀
    createPiece(PLAYER_COLORS.GOTE, "KI"), // 4一金
    createPiece(PLAYER_COLORS.GOTE, "OU"), // 5一玉
    createPiece(PLAYER_COLORS.GOTE, "KI"), // 6一金
    createPiece(PLAYER_COLORS.GOTE, "GI"), // 7一銀
    createPiece(PLAYER_COLORS.GOTE, "KE"), // 8一桂
    createPiece(PLAYER_COLORS.GOTE, "KY"), // 9一香
  ],
  // 以下は平手と同じ
  ...HIRATE_BOARD.slice(1),
];

// 角落ち
export const KAKUOCHI_BOARD: PieceData[][] = [
  // 1段目は平手と同じ
  HIRATE_BOARD[0],
  // 2段目 - 角を削除
  [
    null, // 1二
    createPiece(PLAYER_COLORS.GOTE, "HI"), // 2二飛
    null,
    null,
    null,
    null,
    null,
    null, // 8二角落ち
    null, // 9二
  ],
  // 以下は平手と同じ
  ...HIRATE_BOARD.slice(2),
];

// 飛車落ち
export const HISHAOCHI_BOARD: PieceData[][] = [
  // 1段目は平手と同じ
  HIRATE_BOARD[0],
  // 2段目 - 飛車を削除
  [
    null, // 1二
    null, // 2二飛車落ち
    null,
    null,
    null,
    null,
    null,
    createPiece(PLAYER_COLORS.GOTE, "KA"), // 8二角
    null, // 9二
  ],
  // 以下は平手と同じ
  ...HIRATE_BOARD.slice(2),
];

// 飛香落ち
export const HIKYOOCHI_BOARD: PieceData[][] = [
  // 1段目 - 1一香を削除
  [
    null, // 1一香落ち
    createPiece(PLAYER_COLORS.GOTE, "KE"), // 2一桂
    createPiece(PLAYER_COLORS.GOTE, "GI"), // 3一銀
    createPiece(PLAYER_COLORS.GOTE, "KI"), // 4一金
    createPiece(PLAYER_COLORS.GOTE, "OU"), // 5一玉
    createPiece(PLAYER_COLORS.GOTE, "KI"), // 6一金
    createPiece(PLAYER_COLORS.GOTE, "GI"), // 7一銀
    createPiece(PLAYER_COLORS.GOTE, "KE"), // 8一桂
    createPiece(PLAYER_COLORS.GOTE, "KY"), // 9一香
  ],
  // 2段目 - 飛車を削除
  [
    null, // 1二
    null, // 2二飛車落ち
    null,
    null,
    null,
    null,
    null,
    createPiece(PLAYER_COLORS.GOTE, "KA"), // 8二角
    null, // 9二
  ],
  // 以下は平手と同じ
  ...HIRATE_BOARD.slice(2),
];

// 二枚落ち
export const NIMAIOCHI_BOARD: PieceData[][] = [
  // 1段目は平手と同じ
  HIRATE_BOARD[0],
  // 2段目 - 飛車と角を削除
  [
    null, // 1二
    null, // 2二飛車落ち
    null,
    null,
    null,
    null,
    null,
    null, // 8二角落ち
    null, // 9二
  ],
  // 以下は平手と同じ
  ...HIRATE_BOARD.slice(2),
];

// プリセット名とボードデータのマッピング
export const BOARD_PRESETS = {
  HIRATE: HIRATE_BOARD,
  EMPTY: EMPTY_BOARD,
  KY: KYOOCHI_BOARD,
  KA: KAKUOCHI_BOARD,
  HI: HISHAOCHI_BOARD,
  HIKY: HIKYOOCHI_BOARD,
  "2": NIMAIOCHI_BOARD,
} as const;

export type PresetName = keyof typeof BOARD_PRESETS;

// プリセット名からボードデータを取得
export function getBoardFromPreset(presetName: string): PieceData[][] | null {
  return BOARD_PRESETS[presetName as PresetName] || null;
}

// プリセット名の一覧を取得
export function getAvailablePresets(): PresetName[] {
  return Object.keys(BOARD_PRESETS) as PresetName[];
}

// プリセットの表示名を取得
export function getPresetDisplayName(presetName: string): string {
  const displayNames: Record<string, string> = {
    HIRATE: "平手",
    EMPTY: "空盤",
    KY: "香落ち",
    KA: "角落ち",
    HI: "飛車落ち",
    HIKY: "飛香落ち",
    "2": "二枚落ち",
  };

  return displayNames[presetName] || presetName;
}
