import type { InitialPresetString, JKFState } from "./jkf";

/**
 * 保存できる形式の選択肢
 *
 * **選択肢を並べる側で写さない。** 表示名が綴りと同じなので写しても気づきにくく、
 * 写すと、形式を1つ足したときに増えるのが片方だけになる。
 *
 * 型をこの一覧から導くのは、`satisfies` が見るのが片方向だけだから ——
 * 型に綴りを足しても一覧は4件のまま tsc が通る。
 */
export const KIFU_FORMAT_OPTIONS = [
  { value: "kif", label: "kif" },
  { value: "ki2", label: "ki2" },
  { value: "csa", label: "csa" },
  { value: "jkf", label: "jkf" },
] as const satisfies readonly { value: string; label: string }[];

export type KifuFormat = (typeof KIFU_FORMAT_OPTIONS)[number]["value"];

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
