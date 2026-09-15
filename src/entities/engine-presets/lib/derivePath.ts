import { join } from "pathe";
import { isPresetConfigured, type EnginePreset } from "../model/types";
import type { EngineRuntimeConfig } from "@/entities/engine";
import { getParentPath } from "@/shared/lib/path";

type DerivedPaths = {
  engineDir: string;
  evalDir: string;
  bookDir: string | null;

  // 解析用workDir (ai_root/<ai_name>)
  workDir: string;
};

/**
 * プリセットからパスを導く。**外へ出さない** —— 呼ぶのは `runtimeConfigOf` だけで、
 * 出すと「パスだけ導いて設定は自分で組む」形が復活する（それが2箇所に割れていた元）。
 */
function derivePaths(preset: EnginePreset, aiRoot: string): DerivedPaths {
  const engineDir = getParentPath(preset.enginePath);
  const evalDir = getParentPath(preset.evalFilePath);
  const bookDir =
    preset.bookEnabled && preset.bookFilePath ? getParentPath(preset.bookFilePath) : null;

  const workDir = join(aiRoot, preset.aiName);

  return { engineDir, evalDir, bookDir, workDir };
}

/**
 * プリセットを、エンジンを起こすときの設定にする。**揃っていなければ `null`。**
 *
 * **ここが唯一の組み立て口。** プリセットのどの欄が設定のどの欄になるかを
 * 2箇所で書くと、`bookFile` の出し方を変える・欄を1つ足して流す、といった変更で
 * **tsc は片方だけ直しても通る**（必須欄が増える場合を除く）。
 * 結果は「解析では定跡を読むのに対局では読まない」で、
 * **起動して対局を1局進めるまで分からない。**
 *
 * `setoption` の合成（`usiOptionsOf`）はこの1段先に在って、そちらも共有されている。
 * 分けてあるのは、対局が `PlayerSpec.options` に並びのまま渡す必要があるため。
 */
export function runtimeConfigOf(preset: EnginePreset, aiRoot: string): EngineRuntimeConfig | null {
  if (!isPresetConfigured(preset)) return null;

  const { evalDir, bookDir, workDir } = derivePaths(preset, aiRoot);

  return {
    enginePath: preset.enginePath,
    workDir,
    evalDir,
    bookDir,
    // **`bookEnabled` を落とさない。** パスが残っていても、切ってあれば送らない
    bookFile: preset.bookEnabled ? preset.bookFilePath : null,
    options: preset.options,
  };
}
