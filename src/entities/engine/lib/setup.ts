import type { SetOptionValue } from "../api/rust-types";
import type { EngineRuntimeConfig } from "../model/types";

/**
 * 起動した子へ送る `setoption` の全体。**並べた順に送られる**（`start_analysis_engine`）。
 *
 * **対局の面を戻すときも、ここを通すこと。** 対局は `start_game` に自分で並べて渡す形
 * （`PlayerSpec.options`）なので、合成を別に書くと**同じ規則が2箇所に生える**。
 * 片方だけ `BookDir` を足すような食い違いは、**エンジンが起動してから**しか出ない。
 *
 * **順序に意味がある。** プリセットの値を先に置き、置き場（`EvalDir` / `BookDir` /
 * `BookFile`）を後に置く —— 値の解釈が前の `setoption` に依存するエンジンがあるため
 * （`PlayerSpec.options` の doc）。プリセット側が同じ名前を持っていれば、
 * 位置は先のまま値だけが置き場のもので上書きされる（オブジェクトの鍵は最初に入った位置に残る）。
 */
export function usiOptionsOf(config: EngineRuntimeConfig): SetOptionValue[] {
  const merged: Record<string, string> = {
    ...config.options,
    EvalDir: config.evalDir,
    ...(config.bookDir ? { BookDir: config.bookDir } : {}),
    ...(config.bookFile ? { BookFile: config.bookFile } : {}),
  };
  return Object.entries(merged).map(([name, value]) => ({ name, value }));
}
