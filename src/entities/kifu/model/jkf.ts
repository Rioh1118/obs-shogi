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

export type InitialPresetString =
  | "HIRATE"
  | "KY"
  | "KY_R"
  | "KA"
  | "HI"
  | "HIKY"
  | "2"
  | "3"
  | "4"
  | "5"
  | "5_L"
  | "6"
  | "8"
  | "10"
  | "OTHER";

export const JKFSpecial = {
  TORYO: "TORYO",
  JISHOGI: "JISHOGI",
  SENNICHITE: "SENNICHITE",
  TSUMI: "TSUMI",
  FUZUMI: "FUZUMI",
  TIME_UP: "TIME_UP",
  CHUDAN: "CHUDAN",
  KACHI: "KACHI",
} as const;

export type JKFSpecialType = (typeof JKFSpecial)[keyof typeof JKFSpecial];

export function isValidJKFSpecial(s: string): s is JKFSpecialType {
  return Object.values(JKFSpecial).includes(s as JKFSpecialType);
}
