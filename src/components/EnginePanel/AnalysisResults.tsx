import React, { useState, useEffect, useCallback } from "react";
import EngineAPI, {
  type AnalysisResult,
  createAnalysisSummary,
  formatEvaluation,
} from "@/commands/engine";
import "./AnalysisResults.scss";

interface AnalysisResultsProps {
  sessionId: string | null;
  isAnalyzing: boolean;
  onError: (error: string) => void;
}

export const AnalysisResults: React.FC<AnalysisResultsProps> = ({
  sessionId,
  isAnalyzing,
  onError,
}) => {
  const [latestResult, setLatestResult] = useState<AnalysisResult | null>(null);
  const [resultHistory, setResultHistory] = useState<AnalysisResult[]>([]);
  const [isPolling, setIsPolling] = useState(false);

  const fetchResult = useCallback(async () => {
    if (!sessionId) return;

    try {
      const result = await EngineAPI.getAnalysisResult(sessionId);
      if (result) {
        setLatestResult(result);
        setResultHistory((prev) => {
          const newHistory = [...prev, result];
          // 最新20件まで保持
          return newHistory.slice(-20);
        });
      }
    } catch (err) {
      onError(`Failed to fetch analysis result: ${err}`);
    }
  }, [sessionId, onError]);

  const clearResults = useCallback(() => {
    setLatestResult(null);
    setResultHistory([]);
  }, []);

  // ポーリング開始/停止
  useEffect(() => {
    if (isAnalyzing && sessionId) {
      setIsPolling(true);
      const interval = setInterval(fetchResult, 1000);
      return () => {
        clearInterval(interval);
        setIsPolling(false);
      };
    }
  }, [isAnalyzing, sessionId, fetchResult]);

  return (
    <div className="analysis-results">
      <div className="analysis-results__header">
        <h3 className="analysis-results__title">Analysis Results</h3>
        <div className="analysis-results__controls">
          {isPolling && (
            <span className="analysis-results__polling-indicator">
              <div className="analysis-results__spinner" />
              Updating...
            </span>
          )}
          <button
            onClick={clearResults}
            className="analysis-results__clear-button"
          >
            Clear
          </button>
        </div>
      </div>

      {latestResult && (
        <div className="analysis-results__latest">
          <h4 className="analysis-results__section-title">Latest Result</h4>
          <div className="analysis-results__result-card">
            <div className="analysis-results__evaluation">
              {latestResult.evaluation && (
                <span className="analysis-results__eval-value">
                  {formatEvaluation(latestResult.evaluation)}
                </span>
              )}
              {latestResult.depth_info && (
                <span className="analysis-results__depth">
                  Depth: {latestResult.depth_info.depth}
                </span>
              )}
            </div>

            <div className="analysis-results__summary">
              <pre>{createAnalysisSummary(latestResult)}</pre>
            </div>

            <details className="analysis-results__raw-data">
              <summary>Raw JSON</summary>
              <pre className="analysis-results__json">
                {JSON.stringify(latestResult, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}

      {resultHistory.length > 0 && (
        <div className="analysis-results__history">
          <h4 className="analysis-results__section-title">
            History ({resultHistory.length} results)
          </h4>
          <div className="analysis-results__history-list">
            {resultHistory
              .slice(-5)
              .reverse()
              .map((result, index) => (
                <div key={index} className="analysis-results__history-item">
                  <div className="analysis-results__history-header">
                    <span className="analysis-results__history-number">
                      #{resultHistory.length - index}
                    </span>
                    {result.evaluation && (
                      <span className="analysis-results__history-eval">
                        {formatEvaluation(result.evaluation)}
                      </span>
                    )}
                    {result.depth_info && (
                      <span className="analysis-results__history-depth">
                        D{result.depth_info.depth}
                      </span>
                    )}
                  </div>
                  <div className="analysis-results__history-moves">
                    {result.principal_variations[0]?.moves
                      .slice(0, 5)
                      .join(" ") || "No moves"}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {!latestResult && !isAnalyzing && (
        <div className="analysis-results__empty">
          <p>No analysis results yet. Start analysis to see results here.</p>
        </div>
      )}
    </div>
  );
};
