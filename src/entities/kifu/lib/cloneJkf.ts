import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";

/**
 * JKF とその部分木を深くコピーする
 *
 * 複製は `structuredClone` に揃える。`JSON.parse(JSON.stringify(x))` は値を素通しせず、
 * `undefined` を持つキーを落とし `NaN` / `Infinity` / `-0` を別の値に潰す。
 * `sanitizeJkfMoves` は変化を全部落とした手に `forks: undefined` を残す
 * （`sanitizeJkf.ts` の `cleanForks.length > 0 ? cleanForks : undefined`）ので、
 * 複製の書き方でキーの有無が変わる。
 *
 * 型引数は保証ではなく目印。`JKFMove` は全プロパティが省略可なので、キーが1つ重なれば
 * どんなオブジェクトでも通る。関数・DOM ノード・React 要素を含む値を渡すと
 * `structuredClone` が実行時に `DataCloneError` を投げる。JKF の部分木を渡すことは
 * 呼び出し側が担保する。
 */
export function cloneJkf<T extends JKFData | JKFMove | JKFMove[] | JKFMove[][]>(value: T): T {
  return structuredClone(value);
}
