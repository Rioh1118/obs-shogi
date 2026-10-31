import { engineStatusOf, useAnalysis, type EngineStatus } from "@/entities/analysis";
import { useEngine } from "@/entities/engine";

/** いまのエンジンの状態。**操作列と候補手の表が同じ値を見る** */
export function useEngineStatus(currentSfen: string | null): EngineStatus {
  const { state: analysis } = useAnalysis();
  const { state: engine, notReadyReason } = useEngine();
  return engineStatusOf({
    phase: engine.phase,
    notReadyReason,
    failureKind: engine.error?.kind ?? null,
    analysis,
    currentSfen,
  });
}
