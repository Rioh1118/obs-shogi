export type {
  IJSONKifuFormat as JKFData,
  IMoveFormat as JKFMove,
  IStateFormat as JKFState,
  IHandFormat as JKFHand,
  IPiece as JKFPiece,
  IMoveMoveFormat as JKFMoveMove,
  ITimeFormat as JKFTime,
  IPlaceFormat as JKFPlace,
} from "json-kifu-format/dist/src/Formats";

// === JKF InitialPresetString型 ===
export type InitialPresetString =
  | "HIRATE" // 平手
  | "KY" // 香落ち
  | "KY_R" // 右香落ち
  | "KA" // 角落ち
  | "HI" // 飛車落ち
  | "HIKY" // 飛香落ち
  | "2" // 二枚落ち
  | "3" // 三枚落ち
  | "4" // 四枚落ち
  | "5" // 五枚落ち
  | "5_L" // 左五枚落ち
  | "6" // 六枚落ち
  | "8" // 八枚落ち
  | "10" // 十枚落ち
  | "OTHER"; // その他（dataを使用）

// === JKF Special情報の列挙体 ===
export const JKFSpecial = {
  TORYO: "TORYO", // 投了
  JISHOGI: "JISHOGI", // 持将棋
  SENNICHITE: "SENNICHITE", // 千日手
  TSUMI: "TSUMI", // 詰み
  FUZUMI: "FUZUMI", // 不詰
  TIME_UP: "TIME_UP", // 時間切れ
  CHUDAN: "CHUDAN", // 中断
  KACHI: "KACHI", // 勝ち宣言
} as const;

export type JKFSpecialType = (typeof JKFSpecial)[keyof typeof JKFSpecial];

// JKFMoveはshogi.jsの型なので変更しない
// 文字列のspecialをJKFSpecialTypeに変換する関数
export function isValidJKFSpecial(special: string): special is JKFSpecialType {
  return Object.values(JKFSpecial).includes(special as JKFSpecialType);
}
