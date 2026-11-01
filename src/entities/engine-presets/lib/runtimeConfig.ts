import { isPresetConfigured, type EnginePreset } from "../model/types";
import type { EngineRuntimeConfig } from "@/entities/engine";

/**
 * プリセットを、エンジンを起動するときの設定にする。揃っていなければ `null`。
 *
 * **ここが唯一の組み立て関数。** プリセットのどの欄が設定のどの欄になるかを2か所で書くと、定跡の
 * 出し方を変えるなどの変更で、片方だけ直しても tsc が通る（必須欄が増える場合を除く）。
 *
 * USI の名前は組まない。評価関数と定跡はパスのまま渡し、どの名前で送るかは Rust が起動のたびの
 * 申告から決める（`binding.rs`）。評価関数は必須でない（指定できないエンジンがある）
 */
export function runtimeConfigOf(preset: EnginePreset): EngineRuntimeConfig | null {
  if (!isPresetConfigured(preset)) return null;

  const evalPath = preset.evalFilePath.trim();
  const bookPath = (preset.bookFilePath ?? "").trim();
  return {
    enginePath: preset.enginePath,
    evalPath: evalPath || null,
    // 定跡を選んであれば、解析で使わなくても渡す。`equalRuntime` がパスまで比べるので、定跡を
    // 差し替えたら起動し直す。使わないときは Rust が切る（`null` でも同じく切る）
    book: bookPath ? { path: bookPath, useInAnalysis: preset.bookEnabled } : null,
    values: preset.options,
  };
}
