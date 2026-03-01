import type { ReactNode } from "react";
import { AnalysisProvider } from "@/entities/analysis";
import { usePositionSync } from "@/app/providers/bridges/position-sync";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";

export function AnalysisBridge({ children }: { children: ReactNode }) {
  const { currentSfen, syncedSfen, syncPosition } = usePositionSync();
  const { analysisDefaults } = useEnginePresets();

  return (
    <AnalysisProvider
      positionSync={{ currentSfen, syncedSfen, syncPosition }}
      analysisDefaults={analysisDefaults}
    >
      {children}
    </AnalysisProvider>
  );
}
