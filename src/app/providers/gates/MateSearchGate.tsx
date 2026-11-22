import { useMemo, type ReactNode } from "react";
import { useAnalysis } from "@/entities/analysis";
import { useAppConfig } from "@/entities/app-config";
import { runtimeConfigOf, useEnginePresets } from "@/entities/engine-presets";
import { useGame } from "@/entities/game";
import { MateSearchProvider, resolveMateSearchLimit } from "@/entities/mate-search";

/**
 * 盤の局面、詰み探索に使うプリセット、検討の中断を `MateSearchProvider` へ渡す。
 *
 * `entities/mate-search` に読ませない。読ませると `entities` どうしの横断が4本増える
 * （`src/__tests__/crossSliceImports.ts`）。
 *
 * `AnalysisPositionSyncGate` の内側に置く。詰み探索を始めるときに検討の意思を下ろす
 */
export function MateSearchGate({ children }: { children: ReactNode }) {
  const { view } = useGame();
  const { config } = useAppConfig();
  const { state: presets } = useEnginePresets();
  const { state: analysis, stopAnalysis } = useAnalysis();

  const presetId = config?.mate_preset_id ?? null;
  // 削除したプリセットの ID が残っていれば、指定が無いのと同じ
  const preset = presets.presets.find((p) => p.id === presetId) ?? null;
  const engine = useMemo(() => (preset ? runtimeConfigOf(preset) : null), [preset]);

  return (
    <MateSearchProvider
      currentSfen={view.currentSfen}
      presetChosen={preset !== null}
      engine={engine}
      limitMs={resolveMateSearchLimit(config?.mate_search_limit).ms}
      analysisBusy={analysis.isAnalyzing || analysis.starting}
      stopAnalysis={stopAnalysis}
    >
      {children}
    </MateSearchProvider>
  );
}
