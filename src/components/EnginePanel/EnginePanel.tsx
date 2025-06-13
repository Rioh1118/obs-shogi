import React, { useState, useCallback } from "react";
import { EngineSetup } from "./EngineSetup";
import { AnalysisControls } from "./AnalysisControls";
import { AnalysisResults } from "./AnalysisResults";
import { type EngineInfo } from "@/commands/engine";
import "./EnginePanel.scss";

interface EnginePanelProps {
  className?: string;
}

export const EnginePanel: React.FC<EnginePanelProps> = ({ className }) => {
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEngineReady = useCallback((info: EngineInfo) => {
    setEngineInfo(info);
    setIsEngineReady(true);
    setError(null);
  }, []);

  const handleAnalysisStart = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
    setIsAnalyzing(true);
    setError(null);
  }, []);

  const handleAnalysisStop = useCallback(() => {
    setCurrentSessionId(null);
    setIsAnalyzing(false);
  }, []);

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    console.error("❌", errorMessage);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <div className={`engine-panel ${className || ""}`}>
      <div className="engine-panel__header">
        <h2 className="engine-panel__title">🔍 YaneuraOu Analysis Engine</h2>
        {isAnalyzing && (
          <div className="engine-panel__analyzing-badge">
            <div className="engine-panel__pulse" />
            Analyzing
          </div>
        )}
      </div>

      {error && (
        <div className="engine-panel__error">
          <div className="engine-panel__error-content">
            <strong>Error:</strong> {error}
          </div>
          <button onClick={clearError} className="engine-panel__error-close">
            ✕
          </button>
        </div>
      )}

      <div className="engine-panel__content">
        <EngineSetup onEngineReady={handleEngineReady} onError={handleError} />

        <AnalysisControls
          isEngineReady={isEngineReady}
          onAnalysisStart={handleAnalysisStart}
          onAnalysisStop={handleAnalysisStop}
          onError={handleError}
        />

        <AnalysisResults
          sessionId={currentSessionId}
          isAnalyzing={isAnalyzing}
          onError={handleError}
        />
      </div>

      <div className="engine-panel__help">
        <details>
          <summary>📖 How to Use</summary>
          <div className="engine-panel__help-content">
            <ol>
              <li>
                <strong>Setup Engine:</strong> Initialize YaneuraOu with
                recommended settings
              </li>
              <li>
                <strong>Move pieces:</strong> Change position on the board
              </li>
              <li>
                <strong>Start Analysis:</strong> Begin analyzing the current
                position
              </li>
              <li>
                <strong>View Results:</strong> See evaluation and best moves in
                real-time
              </li>
              <li>
                <strong>Stop Analysis:</strong> Stop when satisfied with results
              </li>
            </ol>
            <div className="engine-panel__help-note">
              <strong>Note:</strong> Analysis results update automatically every
              second while analyzing. Quick analysis buttons provide fast
              evaluation for specific time limits.
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

export default EnginePanel;
