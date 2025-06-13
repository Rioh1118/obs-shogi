import React from "react";
import { useEngine } from "@/contexts/EngineContext";
import { useAnalysis } from "@/contexts/AnalysisContext";
import { usePosition } from "@/contexts/PositionContext";
import ShogiButton from "@/components/ShogiButton";
import "./AnalysisControls.scss";

const AnalysisControls: React.FC<{
  size?: "small" | "medium" | "large";
  showPositionInfo?: boolean;
}> = ({ showPositionInfo = false }) => {
  const {
    state: analysisState,
    startInfiniteAnalysis,
    stopAnalysis,
  } = useAnalysis();
  const { currentSfen, isPositionSynced, syncError } = usePosition();
  const { state: engineState } = useEngine();

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
      engineState.isReady &&
      !engineState.isInitializing &&
      !analysisState.isAnalyzing &&
      isPositionSynced &&
      currentSfen !== null
    );
  };

  return (
    <div className="analysis-controls">
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <ShogiButton
          onClick={handleStart}
          disabled={!canStartAnalysis()}
          variant="primary"
        >
          {analysisState.isAnalyzing ? "解析中..." : "解析開始"}
        </ShogiButton>

        <ShogiButton
          onClick={handleStop}
          disabled={!analysisState.isAnalyzing}
          variant="danger"
        >
          解析停止
        </ShogiButton>

        {showPositionInfo && currentSfen && (
          <span className="position-info">
            SFEN: {currentSfen.substring(0, 30)}...
          </span>
        )}
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
