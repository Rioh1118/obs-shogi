import { usiOptionsOf } from "@/entities/engine";
import { derivePaths } from "@/entities/engine-presets/lib/derivePath";
import { isPresetConfigured, type EnginePreset } from "@/entities/engine-presets/model/types";
import type { PlayerSpec } from "@/entities/game-session";

/** 席に座れるもの。**プリセットが揃っていないエンジンは座れない** */
export type SeatChoice = { kind: "human" } | { kind: "engine"; presetId: string };

export const HUMAN_SEAT: SeatChoice = { kind: "human" };

/**
 * 人が座る席。
 *
 * **名前の上限はバイト数**（Rust の `MAX_NAME_BYTES`）で、超えると `start_game` が断る。
 * 切り詰めないのは Rust 側の決めなので、こちらも黙って切らない —— 長すぎることは
 * 断りの文言として返る。
 */
export function humanPlayer(name: string): PlayerSpec {
  return { kind: "human", name };
}

/**
 * エンジンが座る席。**プリセットが揃っていなければ `null`。**
 *
 * `name` に**エンジンが名乗る `id name` を使わない** —— あちらは長さを見ずに
 * 保持される値で、長い名乗りを返す実行ファイルを選ぶと、利用者が1文字も
 * 入力していないのに `start_game` が落ちる（`PlayerSpec` の doc）。
 * 使うのは利用者が付けたプリセットの見出し。
 *
 * `setoption` の中身は**解析と同じ合成**を通す（`usiOptionsOf`）。
 * 別々に組むと、片方だけ `BookDir` を送るような食い違いが起きて、
 * **エンジンが起動してからしか気づけない。**
 */
export function enginePlayer(
  preset: EnginePreset,
  aiRoot: string,
  ponder: boolean,
): PlayerSpec | null {
  if (!isPresetConfigured(preset)) return null;

  const { evalDir, bookDir, workDir } = derivePaths(preset, aiRoot);
  const options = usiOptionsOf({
    enginePath: preset.enginePath,
    workDir,
    evalDir,
    bookDir,
    bookFile: preset.bookEnabled ? preset.bookFilePath : null,
    options: preset.options,
  });

  return {
    kind: "engine",
    name: preset.label,
    enginePath: preset.enginePath,
    workDir,
    // **並べた順にそのまま送られる。** 置き場は値の後（`usiOptionsOf` の doc）
    options: Object.entries(options).map(([name, value]) => ({ name, value })),
    ponder,
  };
}

/**
 * 席の選択を `PlayerSpec` にする。**座れないなら `null`。**
 *
 * `null` が返る条件は2つ —— 選んだプリセットが見つからない、揃っていない。
 * どちらも「始められない」ので、呼ぶ側は送信を止めること。
 */
export function playerSpecOf(
  choice: SeatChoice,
  humanName: string,
  presets: readonly EnginePreset[],
  aiRoot: string | null,
  ponder: boolean,
): PlayerSpec | null {
  if (choice.kind === "human") return humanPlayer(humanName);
  if (aiRoot === null) return null;

  const preset = presets.find((candidate) => candidate.id === choice.presetId);
  return preset === undefined ? null : enginePlayer(preset, aiRoot, ponder);
}
