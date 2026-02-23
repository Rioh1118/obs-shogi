// Dialogで使うだけなので、Presetには保存しない前提の util。

import type { EngineCandidate } from "@/entities/engine/api/aiLibrary";

export type EvalTypeId = string;

export const AI_NAME_TO_EVAL: Record<string, EvalTypeId> = {
  水匠11β: "NNUE_SFNNwoP1536",
  水匠11α: "NNUE_halfkp_1024x2_8_64",
  水匠10: "NNUE_halfkp_512x2_8_64",
  "tanuki-wcsc35": "NNUE_halfkp_512x2_8_96",
  水匠10beta3: "NNUE_halfkp_768x2_16_64",
  水匠10beta2: "NNUE_halfkp_768x2_16_64",
  水匠10beta: "NNUE_halfkp_512x2_8_64",
  "tanuki-wcsc34": "NNUE_halfkp_1024x2_8_64",
  振電3: "NNUE_halfkp_512x2_8_64",
  "BURNING BRIDGES halfkpe9": "NNUE_halfkpe9_256x2_32_32",
  Hao: "NNUE_halfkp_256x2_32_32",
  Lí: "NNUE_halfkp_1024x2_8_32",
  "tanuki-dr2": "NNUE_halfkpvm_256x2_32_32",
  "tttak halfkpe9(20240313)": "NNUE_halfkpe9_256x2_32_32",
  水匠5: "NNUE_halfkp_256x2_32_32",
  "elmo(WCSC27)": "KPPT",
  魚沼産やねうら王: "NNUE_kp_256x2_32_32",
};

export function listAiLabels(): string[] {
  return Object.keys(AI_NAME_TO_EVAL).sort((a, b) => a.localeCompare(b));
}

export function evalTypeOfAiLabel(
  aiLabel: string | null | undefined,
): EvalTypeId | null {
  const key = (aiLabel ?? "").trim();
  if (!key) return null;
  return AI_NAME_TO_EVAL[key] ?? null;
}

/**
 * エンジンファイル名から "YaneuraOu_<EVAL>-Vxxx_..." の <EVAL> を取り出す。
 * 例: YaneuraOu_NNUE_halfkp_512x2_8_64-V830Git_AVX2.exe
 *   -> NNUE_halfkp_512x2_8_64
 */
export function parseEvalTypeFromEngineEntry(entry: string): EvalTypeId | null {
  const name = (entry ?? "").trim();
  if (!name) return null;

  // .exe を剥がしてから見る（Windows以外でも害なし）
  const base = name.toLowerCase().endsWith(".exe") ? name.slice(0, -4) : name;

  // 先頭が YaneuraOu_ で、途中に -V がある前提
  // "YaneuraOu_" の次から "-V" の直前までが eval/core 部分
  const prefix = "YaneuraOu_";
  if (!base.startsWith(prefix)) return null;

  const i = base.indexOf("-V", prefix.length);
  if (i <= prefix.length) return null;

  return base.slice(prefix.length, i);
}

export type EngineLike = { entry: string; path: string };

/**
 * aiLabel（=水匠10等）が選ばれていれば、それに対応する EvalTypeId で絞る。
 * 未選択 or 未定義なら絞らず返す（=利便性だけ、強制しない）
 */
export function filterEnginesByAiLabel(
  engines: EngineCandidate[],
  aiLabel: string | null | undefined,
): { filtered: EngineCandidate[]; evalType: EvalTypeId | null } {
  const evalType = evalTypeOfAiLabel(aiLabel);
  if (!evalType) return { filtered: engines, evalType: null };

  const filtered = engines.filter(
    (e) => parseEvalTypeFromEngineEntry(e.entry) === evalType,
  );
  return { filtered, evalType };
}

/**
 * 既に選択されている enginePath から、フィルタ aiLabel を “推測” する。
 * （Dialogオープン時の利便性用。必須ではない）
 * 同じ EvalTypeId を持つ AI が複数ある場合は先頭を返す。
 */
export function guessAiLabelFromEngineEntry(entry: string): string | null {
  const et = parseEvalTypeFromEngineEntry(entry);
  if (!et) return null;

  const labels = Object.keys(AI_NAME_TO_EVAL);
  for (const label of labels) {
    if (AI_NAME_TO_EVAL[label] === et) return label;
  }
  return null;
}
