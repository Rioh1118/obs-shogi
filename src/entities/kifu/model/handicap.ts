import type { InitialPresetString } from "./jkf";

/**
 * 手合割として選べるプリセット
 *
 * `OTHER` は「プリセットではなく `data` で局面を与える」を表す綴りなので、
 * 手合割の選択肢には入らない。
 */
export type HandicapPreset = Exclude<InitialPresetString, "OTHER">;

export interface HandicapOption {
  value: HandicapPreset;
  label: string;
}

/**
 * 手合割の一覧
 *
 * 先頭が既定値になる面が複数あるので、順序に意味がある。
 * 平手を先頭から動かさないこと。
 */
export const HANDICAP_PRESETS: readonly HandicapOption[] = [
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
];

export const DEFAULT_HANDICAP: HandicapPreset = HANDICAP_PRESETS[0].value;

export function isHandicapPreset(value: string): value is HandicapPreset {
  return HANDICAP_PRESETS.some((preset) => preset.value === value);
}
