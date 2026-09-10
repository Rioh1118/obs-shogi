import type { InitialPresetString } from "./jkf";

export interface HandicapOption<T extends string> {
  value: T;
  label: string;
}

/**
 * 手合割の一覧
 *
 * **型はこの一覧から導く**（下の `HandicapPreset`）。`InitialPresetString` から
 * 引き算して型を作ると、綴りが型に在るのに一覧に無い状態が黙って生まれる
 * —— 実際 `HIKY`（飛香落ち）は `InitialPresetString` に在って `shogi.js` でも組めるが、
 * この一覧には無い。型が一覧より広いと、選べない値が entities の API に載る。
 *
 * 既定値は先頭から引く（`DEFAULT_HANDICAP`）。**並べ替えると既定値が変わる。**
 */
export const HANDICAP_PRESETS = [
  { value: "HIRATE", label: "平手" },
  { value: "KY", label: "香落ち" },
  { value: "KY_R", label: "右香落ち" },
  { value: "KA", label: "角落ち" },
  { value: "HI", label: "飛車落ち" },
  { value: "2", label: "二枚落ち" },
  { value: "3", label: "三枚落ち" },
  { value: "4", label: "四枚落ち" },
  { value: "5", label: "五枚落ち" },
  { value: "5_L", label: "左五枚落ち" },
  { value: "6", label: "六枚落ち" },
  { value: "8", label: "八枚落ち" },
  { value: "10", label: "十枚落ち" },
] as const satisfies readonly HandicapOption<InitialPresetString>[];

/**
 * 手合割として選べるプリセット
 *
 * 一覧に在る綴りだけ。`OTHER`（プリセットではなく `data` で局面を与える）も、
 * 一覧に載せていない `HIKY` も、この型には入らない。
 */
export type HandicapPreset = (typeof HANDICAP_PRESETS)[number]["value"];

export const DEFAULT_HANDICAP: HandicapPreset = HANDICAP_PRESETS[0].value;
