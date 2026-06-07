import { useCallback, type ReactNode } from "react";
import { AnalysisProvider } from "@/entities/analysis";
import { usePositionSync } from "@/app/providers/bridges/position-sync";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { buildAnalysisConfig } from "@/entities/engine-presets/lib/buildAnalysisConfig";

export function AnalysisBridge({ children }: { children: ReactNode }) {
  const { currentSfen, syncedSfen, syncPosition } = usePositionSync();
  const { analysisDefaults } = useEnginePresets();

  const buildConfig = useCallback(() => buildAnalysisConfig(analysisDefaults), [analysisDefaults]);

  return (
    <AnalysisProvider
      positionSync={{ currentSfen, syncedSfen, syncPosition }}
      buildConfig={buildConfig}
    >
      {children}
    </AnalysisProvider>
  );
}
