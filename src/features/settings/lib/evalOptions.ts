import type { ProfileCandidate } from "@/entities/ai-library/api/aiLibrary";

/**
 * 選んだ評価関数のフォルダの `eval_options.txt` が決める値（名前 → 値）。
 *
 * やねうら王は `isready` で評価関数フォルダの `eval_options.txt` を読み、送った値を上書きする
 * （`docs/spec/features/eval-files.md` の AC-E2）。評価関数を AI ライブラリから選んでいなければ空
 */
export function evalOptionsFor(
  profiles: ProfileCandidate[],
  evalFilePath: string,
): ReadonlyMap<string, string> {
  const profile = profiles.find((p) => p.eval_files.some((f) => f.path === evalFilePath));
  return new Map((profile?.eval_options ?? []).map((o) => [o.name, o.value]));
}
