import type { ReactNode } from "react";
import { AnalysisProvider } from "@/entities/analysis";
import { usePositionSync } from "@/app/providers/bridges/position-sync";

export function AnalysisBridge({ children }: { children: ReactNode }) {
  const { currentSfen, syncedSfen, syncPosition } = usePositionSync();

  return (
    <AnalysisProvider positionSync={{ currentSfen, syncedSfen, syncPosition }}>
      {children}
    </AnalysisProvider>
  );
}
