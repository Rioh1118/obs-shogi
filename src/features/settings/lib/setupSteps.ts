import {
  canCreateEnginesDir,
  canListEnginesDir,
  type EnginesDir,
} from "@/entities/engine/lib/enginesDir";

export type StepState = "done" | "active" | "warn" | "locked";

type SetupProgress = {
  hasRoot: boolean;
  enginesDir: EnginesDir;
  engineCount: number;
  folderCount: number;
  /** 読み終えている。読んでいる間と失敗の間は、0件を注意にしない */
  scanReady: boolean;
};

function createEnginesState({ enginesDir }: SetupProgress): StepState {
  if (canListEnginesDir(enginesDir)) return "done";
  // フォルダでないものが在る間と読めていない間は塞ぐ。作成が通る保証が無く、すべきことは hero が言う
  return canCreateEnginesDir(enginesDir) ? "active" : "locked";
}

function placeEnginesState({ enginesDir, engineCount, scanReady }: SetupProgress): StepState {
  if (!canListEnginesDir(enginesDir)) return "locked";
  if (engineCount > 0) return "done";
  return scanReady ? "warn" : "active";
}

function placeAssetsState({ enginesDir, folderCount, scanReady }: SetupProgress): StepState {
  if (!canListEnginesDir(enginesDir)) return "locked";
  if (folderCount > 0) return "done";
  return scanReady ? "warn" : "locked";
}

/** 手順書の4段の状態を決める。 */
export function setupStepStates(progress: SetupProgress) {
  return {
    selectRoot: progress.hasRoot ? ("done" as const) : ("active" as const),
    createEngines: createEnginesState(progress),
    placeEngines: placeEnginesState(progress),
    placeAssets: placeAssetsState(progress),
  };
}
