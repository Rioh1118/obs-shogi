import React from "react";
import { useAnalysis } from "@/contexts/AnalysisContext";
import ShogiButton from "@/components/ShogiButton";
import "./AnalysisControls.scss";
import { useEngine } from "@/entities/engine";
import { usePositionSync } from "@/app/providers/bridges/position-sync";

const AnalysisControls: React.FC<{
  size?: "small" | "medium" | "large";
  showPositionInfo?: boolean;
}> = () => {
  const {
    state: analysisState,
    startInfiniteAnalysis,
    stopAnalysis,
  } = useAnalysis();
  const { currentSfen, isPositionSynced, syncError } = usePositionSync();
  const { state: engineState, isReady } = useEngine();

  const handleStart = async () => {
    try {
      await startInfiniteAnalysis();
    } catch (error) {
      console.error("解析開始エラー:", error);
    }
  };

  const handleStop = async () => {
    try {
      await stopAnalysis();
    } catch (error) {
      console.error("解析停止エラー:", error);
    }
  };

  const canStartAnalysis = () => {
    return (
      isReady &&
      !analysisState.isAnalyzing &&
      isPositionSynced &&
      currentSfen !== null
    );
  };

  return (
    <div className="analysis-controls">
      <div className="analysis-controls__buttons">
        <ShogiButton
          onClick={handleStart}
          disabled={!canStartAnalysis()}
          variant="primary"
          size="large"
        >
          {analysisState.isAnalyzing ? "解析中..." : "解析開始"}
        </ShogiButton>

        <ShogiButton
          onClick={handleStop}
          disabled={!analysisState.isAnalyzing}
          variant="danger"
          size="large"
        >
          解析停止
        </ShogiButton>
      </div>

      {(analysisState.error || syncError || engineState.error) && (
        <div className="analysis-controls__error">
          ❌ {analysisState.error || syncError || engineState.error}
        </div>
      )}
    </div>
  );
};

export default AnalysisControls;
