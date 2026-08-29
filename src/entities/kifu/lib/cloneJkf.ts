import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";

/**
 * JKF とその部分木を深くコピーする
 *
 * 複製は `structuredClone` に揃える。`JSON.parse(JSON.stringify(x))` は値を素通しせず、
 * `undefined` を持つキーを落とし `NaN` / `Infinity` / `-0` を別の値に潰す。
 * 分岐編集は `forks` を付け外ししながら複製を重ねるので、どのキーが残るかを
 * 複製の書き方に依存させない。
 *
 * 型引数を JKF の部分木に絞ってあるのは、汎用の deep clone として使われないため。
 * `structuredClone` は関数や DOM ノードを含む値では throw する。
 */
export function cloneJkf<T extends JKFData | JKFMove | JKFMove[] | JKFMove[][]>(value: T): T {
  return structuredClone(value);
}
