import type { InitialPresetString, JKFState } from "./jkf";

export type KifuFormat = "jkf" | "kif" | "ki2" | "csa";

/**
 * 保存できる形式の選択肢
 *
 * 同じ4件を3つのフォームが並べていた。表示名が綴りと同じなので写しても気づきにくく、
 * 形式を1つ足したときに増えるのは片方だけになる。
 */
export const KIFU_FORMAT_OPTIONS = [
  { value: "kif", label: "kif" },
  { value: "ki2", label: "ki2" },
  { value: "csa", label: "csa" },
  { value: "jkf", label: "jkf" },
] as const satisfies readonly { value: KifuFormat; label: string }[];

export interface KifuCreationOptions {
  fileName: string;
  format: KifuFormat;

  gameInfo: {
    black?: string;
    white?: string;
    date?: string;
    tags?: string[];
    note?: string;
  };

  initialPosition: {
    preset: InitialPresetString;
    data?: JKFState;
  };
}
