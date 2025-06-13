import React, { useState, useCallback } from "react";
import EngineAPI from "@/commands/engine";
import { useGame } from "@/contexts/GameContext";
import "./AnalysisControls.scss";
import {
  getMovesFromJKFPlayer,
  createPositionCommand,
  testMoveConversion,
} from "@/utils/engineMove";
interface AnalysisControlsProps {
  isEngineReady: boolean;
  jkfPlayer?: any;
  onAnalysisStart: (sessionId: string) => void;
  onAnalysisStop: () => void;
  onError: (error: string) => void;
}

export const AnalysisControls: React.FC<AnalysisControlsProps> = ({
  isEngineReady,
  jkfPlayer,
  onAnalysisStart,
  onAnalysisStop,
  onError,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const handleStartAnalysis = useCallback(async () => {
    if (!isEngineReady) {
      onError("Engine is not ready");
      return;
    }

    try {
      setIsAnalyzing(true);

      // utilsを使用して指し手を取得・変換
      const moves = getMovesFromJKFPlayer(jkfPlayer);
      const positionCommand = createPositionCommand(moves);

      console.log("🔍 Analyzing position:", positionCommand);

      await EngineAPI.setPosition(positionCommand);

      const sessionId = await EngineAPI.startAnalysis();
      setCurrentSessionId(sessionId);
      onAnalysisStart(sessionId);
    } catch (error) {
      setIsAnalyzing(false);
      setCurrentSessionId(null);
      onError(`Failed to start analysis: ${error}`);
    }
  }, [isEngineReady, jkfPlayer, onAnalysisStart, onError]);

  const handleStopAnalysis = useCallback(async () => {
    if (!currentSessionId) return;

    try {
      await EngineAPI.stopAnalysis(currentSessionId);
      setIsAnalyzing(false);
      setCurrentSessionId(null);
      onAnalysisStop();
    } catch (error) {
      onError(`Failed to stop analysis: ${error}`);
    }
  }, [currentSessionId, onAnalysisStop, onError]);

  const handleQuickAnalysis = useCallback(
    async (timeInSeconds: number) => {
      if (!isEngineReady) {
        onError("Engine is not ready");
        return;
      }

      try {
        const moves = getMovesFromJKFPlayer(jkfPlayer);
        const positionCommand = createPositionCommand(moves);

        console.log(`⚡ Quick analysis (${timeInSeconds}s):`, positionCommand);

        await EngineAPI.setPosition(positionCommand);
        await EngineAPI.analyzeWithTime(timeInSeconds);
      } catch (error) {
        onError(`Quick analysis failed: ${error}`);
      }
    },
    [isEngineReady, jkfPlayer, onError],
  );

  // テスト用ボタン（開発時のみ）
  const handleTestConversion = useCallback(() => {
    testMoveConversion();
    const moves = getMovesFromJKFPlayer(jkfPlayer);
    console.log("Current moves:", moves);
  }, [jkfPlayer]);

  const getCurrentPositionInfo = useCallback(() => {
    if (!jkfPlayer) return null;

    return {
      tesuu: jkfPlayer.tesuu || 0,
      totalMoves: jkfPlayer.kifu?.moves?.length || 0,
      moves: getMovesFromJKFPlayer(jkfPlayer),
    };
  }, [jkfPlayer]);

  const positionInfo = getCurrentPositionInfo();

  return (
    <div className="analysis-controls">
      <div className="analysis-controls__header">
        <h3 className="analysis-controls__title">Analysis Controls</h3>
        <div className="analysis-controls__status">
          Engine: {isEngineReady ? "Ready" : "Not Ready"}
          {jkfPlayer && (
            <span className="analysis-controls__position-info">
              | Move: {positionInfo?.tesuu}/{positionInfo?.totalMoves}
            </span>
          )}
        </div>
      </div>

      <div className="analysis-controls__main">
        {!isAnalyzing ? (
          <button
            onClick={handleStartAnalysis}
            disabled={!isEngineReady}
            className="analysis-controls__start-button"
          >
            🔍 Start Analysis
          </button>
        ) : (
          <button
            onClick={handleStopAnalysis}
            className="analysis-controls__stop-button"
          >
            ⏹️ Stop Analysis
          </button>
        )}
      </div>

      <div className="analysis-controls__quick">
        <h4 className="analysis-controls__quick-title">Quick Analysis</h4>
        <div className="analysis-controls__time-buttons">
          {[1, 3, 5, 10].map((seconds) => (
            <button
              key={seconds}
              onClick={() => handleQuickAnalysis(seconds)}
              disabled={!isEngineReady || isAnalyzing}
              className="analysis-controls__time-button"
            >
              {seconds}s
            </button>
          ))}
        </div>
      </div>

      <div className="analysis-controls__debug">
        <details>
          <summary>🔧 Debug Info</summary>
          <div className="analysis-controls__debug-content">
            <div>Engine Ready: {isEngineReady ? "✅" : "❌"}</div>
            <div>Analyzing: {isAnalyzing ? "✅" : "❌"}</div>
            <div>Session ID: {currentSessionId || "None"}</div>
            <div>Move Count: {positionInfo?.tesuu || 0}</div>
            <div>Engine Moves: {JSON.stringify(positionInfo?.moves || [])}</div>
            <div>
              Position Command:{" "}
              {createPositionCommand(positionInfo?.moves || [])}
            </div>

            <button
              onClick={handleTestConversion}
              className="analysis-controls__test-button"
              style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}
            >
              🧪 Test Conversion
            </button>
          </div>
        </details>
      </div>
    </div>
  );
};
