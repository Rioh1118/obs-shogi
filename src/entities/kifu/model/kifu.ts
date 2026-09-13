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

/**
 * 名前の末尾に付いている、扱える形式の拡張子
 *
 * **一覧から作る。** 綴りを別に書くと、形式を1つ足したときに増えるのが片方だけになる。
 */
const KNOWN_EXTENSION = new RegExp(
  `\\.(${KIFU_FORMAT_OPTIONS.map((option) => option.value).join("|")})$`,
  "i",
);

/**
 * 打った名前と選んだ形式から、書き込むファイル名を作る
 *
 * **拡張子を落とす口はここだけ。** 打っている最中に落とすと、`.kif` の `f` を打った
 * 瞬間に4文字が消える。一度も落とさないと `45角戦法.kif.kif` ができる。
 *
 * 名前が空、あるいは拡張子しか打たれていないときは空を返す。
 * 送る側はこれで「まだ押せない」を判定できる ——
 * `name.trim()` で判定すると、`.kif` とだけ打った状態が押せてしまう。
 */
export function kifuFileName(name: string, format: KifuFormat): string {
  const base = name.trim().replace(KNOWN_EXTENSION, "").trim();
  return base ? `${base}.${format}` : "";
}

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
