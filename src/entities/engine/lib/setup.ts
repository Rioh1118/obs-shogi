import type { EngineInfo, EngineSettings } from "../api/rust-types";
import { applyEngineSettings, getEngineInfo, initializeEngine } from "../api/tauri";
import type { EngineRuntimeConfig } from "../model/types";

/**
 * 起動した子へ送る `setoption` の全体。
 *
 * **解析と対局で同じものを送る。** 対局は `start_game` に自分で並べて渡す形
 * （`PlayerSpec.options`）なので、合成をここへ出していないと**同じ規則が2箇所に生える**。
 * 片方だけ `BookDir` を足すような食い違いは、**エンジンが起動してから**しか出ない。
 *
 * **順序に意味がある。** プリセットの値を先に置き、置き場（`EvalDir` / `BookDir` /
 * `BookFile`）を後に置く —— 値の解釈が前の `setoption` に依存するエンジンがあるため
 * （`PlayerSpec.options` の doc）。プリセット側が同じ名前を持っていれば、
 * 位置は先のまま値だけが置き場のもので上書きされる。
 *
 * **その順序が届くのは対局だけ。** `PlayerSpec.options` は `Vec` なので並びのまま渡るが、
 * 解析が渡す `EngineSettings.options` は `HashMap` で、**反復順は実行ごとに変わる**
 * （`src-tauri/src/engine/analyzer.rs` がそのまま `setoption` にする）。
 * 解析だけが「同じ設定なのに実行のたび並びが違う」状態にある（#579）。
 * ここで順序を組むのは、**直したときに送る側を書き換えずに済ませる**ため。
 */
export function usiOptionsOf(config: EngineRuntimeConfig): Record<string, string> {
  return {
    ...config.options,
    EvalDir: config.evalDir,
    ...(config.bookDir ? { BookDir: config.bookDir } : {}),
    ...(config.bookFile ? { BookFile: config.bookFile } : {}),
  };
}

export async function setupYaneuraOuEngine(config: EngineRuntimeConfig): Promise<EngineInfo> {
  // 起動
  await initializeEngine(config.enginePath, config.workDir);

  // setoption群
  const settings: EngineSettings = { options: usiOptionsOf(config) };
  await applyEngineSettings(settings);

  // info取得
  const info = await getEngineInfo();
  if (!info) throw new Error("Failed to get engine info");

  return info;
}
