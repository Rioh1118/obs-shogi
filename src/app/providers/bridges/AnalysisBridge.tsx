import type { ReactNode } from "react";
import { AnalysisProvider } from "@/entities/analysis";
import { useEnginePositionSync } from "@/features/engine-position-sync";

export function AnalysisBridge({ children }: { children: ReactNode }) {
  const positionSync = useEnginePositionSync();

  return <AnalysisProvider positionSync={positionSync}>{children}</AnalysisProvider>;
}
