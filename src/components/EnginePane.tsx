import React, { useState, useCallback, useEffect } from "react";
import EngineAPI, {
  type EngineInfo,
  type AnalysisResult,
  type AnalysisStatus,
  formatEvaluation,
  createAnalysisSummary,
} from "@/commands/engine";
import { useGame } from "@/contexts/GameContext";

interface EnginePaneProps {
  className?: string;
}

const EnginePane: React.FC<EnginePaneProps> = ({ className }) => {
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 解析関連の状態
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>({
    is_analyzing: false,
  });
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [latestResult, setLatestResult] = useState<AnalysisResult | null>(null);

  const { state } = useGame();
  const currentSfen = state.jkfPlayer?.shogi.toSFENString();

  // エラーハンドリング用のヘルパー
  const handleError = useCallback((operation: string, err: unknown) => {
    const errorMessage = `${operation} failed: ${err}`;
    console.error("❌", errorMessage);
    setError(errorMessage);
  }, []);

  // エンジン初期化（YaneuraOu推奨設定込み）
  const setupEngine = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    console.log("🔍 Setting up YaneuraOu engine...");

    try {
      const result = await EngineAPI.setupYaneuraOuEngine();
      console.log("✅ Engine setup completed:", result.engine_info.name);
      setEngineInfo(result.engine_info);
      setIsEngineReady(true);
    } catch (err) {
      handleError("Engine setup", err);
      setIsEngineReady(false);
    } finally {
      setIsLoading(false);
    }
  }, [handleError]);

  // エンジン停止
  const shutdownEngine = useCallback(async () => {
    setError(null);
    try {
      await EngineAPI.shutdownEngine();
      console.log("🛑 Engine shutdown completed");
      setEngineInfo(null);
      setIsEngineReady(false);
      setAnalysisStatus({ is_analyzing: false });
      setLatestResult(null);
      setAnalysisResults([]);
    } catch (err) {
      handleError("Engine shutdown", err);
    }
  }, [handleError]);

  // 解析開始
  const startAnalysis = useCallback(async () => {
    if (!currentSfen || !isEngineReady) {
      setError("No SFEN position available or engine not ready");
      return;
    }

    setError(null);
    setAnalysisResults([]);
    setLatestResult(null);

    try {
      console.log("🚀 Starting analysis for SFEN:", currentSfen);
      await EngineAPI.startAnalysisFromSfen(currentSfen);
      console.log("✅ Analysis started");

      // 解析状態を更新
      setAnalysisStatus({ is_analyzing: true, message: "Analysis started" });
    } catch (err) {
      handleError("Analysis start", err);
    }
  }, [currentSfen, isEngineReady, handleError]);

  // 解析停止
  const stopAnalysis = useCallback(async () => {
    setError(null);
    try {
      await EngineAPI.stopAnalysis();
      console.log("🛑 Analysis stopped");
      setAnalysisStatus({ is_analyzing: false, message: "Analysis stopped" });
    } catch (err) {
      handleError("Analysis stop", err);
    }
  }, [handleError]);

  // 解析状態確認
  const checkAnalysisStatus = useCallback(async () => {
    if (!isEngineReady) return;

    try {
      const status = await EngineAPI.getAnalysisStatus();
      setAnalysisStatus(status);
    } catch (err) {
      console.error("Failed to get analysis status:", err);
    }
  }, [isEngineReady]);

  // 解析結果を取得
  const fetchAnalysisResults = useCallback(async () => {
    if (!isEngineReady) return;

    try {
      // 最新の結果を取得
      const latest = await EngineAPI.getLatestAnalysisResult();
      if (latest) {
        setLatestResult(latest);
        console.log("📊 Latest result updated");
      }

      // 溜まった全ての結果を取得
      const allResults = await EngineAPI.getAllPendingAnalysisResults();
      if (allResults.length > 0) {
        setAnalysisResults((prev) => [...prev, ...allResults]);
        console.log("📊 Got", allResults.length, "new results");
      }
    } catch (err) {
      console.error("❌ Failed to fetch analysis results:", err);
    }
  }, [isEngineReady]);

  // 手動で全ての状態を更新
  const refreshAll = useCallback(async () => {
    await checkAnalysisStatus();
    await fetchAnalysisResults();
  }, [checkAnalysisStatus, fetchAnalysisResults]);

  // エンジンテスト
  const runEngineTest = useCallback(async () => {
    setError(null);
    try {
      console.log("🧪 Running engine test...");
      await EngineAPI.testAnalysis();
      console.log("✅ Engine test completed");
      alert("Engine test completed successfully! Check console for details.");
    } catch (err) {
      handleError("Engine test", err);
    }
  }, [handleError]);

  // 定期的な結果取得（解析中のみ）
  useEffect(() => {
    if (!analysisStatus.is_analyzing) return;

    const interval = setInterval(() => {
      fetchAnalysisResults();
      checkAnalysisStatus();
    }, 1500); // 1.5秒ごと

    return () => clearInterval(interval);
  }, [analysisStatus.is_analyzing, fetchAnalysisResults, checkAnalysisStatus]);

  return (
    <div className={`engine-pane p-6 space-y-4 ${className}`}>
      <h2 className="text-2xl font-bold">YaneuraOu Analysis Engine</h2>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* 現在の局面情報 */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-semibold mb-2">Current Position (SFEN)</h3>
        <div className="text-sm text-gray-700 break-all">
          {currentSfen || "No position available"}
        </div>
      </div>

      {/* エンジン状態表示 */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <div className="flex items-center space-x-3 mb-3">
          <div
            className={`w-4 h-4 rounded-full ${isEngineReady ? "bg-green-500" : "bg-red-500"}`}
          ></div>
          <span className="font-semibold text-lg">
            {isEngineReady ? "Engine Ready" : "Engine Not Ready"}
          </span>
          {analysisStatus.is_analyzing && (
            <span className="bg-blue-500 text-white px-2 py-1 rounded text-sm animate-pulse">
              Analyzing...
            </span>
          )}
        </div>

        {engineInfo && (
          <div className="text-sm text-gray-600 space-y-1">
            <p>
              <strong>Engine:</strong> {engineInfo.name}
            </p>
            <p>
              <strong>Author:</strong> {engineInfo.author}
            </p>
            <p>
              <strong>Options:</strong> {engineInfo.options.length} available
            </p>
          </div>
        )}

        {analysisStatus.message && (
          <div className="mt-2 text-sm text-blue-600">
            <strong>Status:</strong> {analysisStatus.message}
          </div>
        )}
      </div>

      {/* コントロールボタン */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <button
          onClick={setupEngine}
          disabled={isLoading || isEngineReady}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {isLoading ? "Setup..." : "Setup Engine"}
        </button>

        <button
          onClick={shutdownEngine}
          disabled={!isEngineReady}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          Shutdown
        </button>

        <button
          onClick={startAnalysis}
          disabled={
            !isEngineReady || analysisStatus.is_analyzing || !currentSfen
          }
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          Start Analysis
        </button>

        <button
          onClick={stopAnalysis}
          disabled={!analysisStatus.is_analyzing}
          className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          Stop Analysis
        </button>
      </div>

      {/* サブコントロール */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={refreshAll}
          disabled={!isEngineReady}
          className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50 text-sm"
        >
          Refresh
        </button>

        <button
          onClick={runEngineTest}
          disabled={!isEngineReady || analysisStatus.is_analyzing}
          className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 text-sm"
        >
          Run Test
        </button>

        <button
          onClick={() => setAnalysisResults([])}
          className="px-3 py-1 bg-gray-400 text-white rounded hover:bg-gray-500 text-sm"
        >
          Clear Results
        </button>
      </div>

      {/* ローディング表示 */}
      {isLoading && (
        <div className="flex items-center space-x-2 text-blue-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          <span>Setting up engine with recommended settings...</span>
        </div>
      )}

      {/* 最新の解析結果（整形表示） */}
      {latestResult && (
        <div className="bg-green-50 p-4 rounded-lg">
          <h3 className="font-semibold mb-2">Latest Analysis Result</h3>
          <div className="text-sm space-y-2">
            <div className="bg-white p-3 rounded border">
              <pre className="whitespace-pre-wrap text-xs">
                {createAnalysisSummary(latestResult)}
              </pre>
            </div>
            <details>
              <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                Show Raw JSON
              </summary>
              <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-40 mt-2">
                {JSON.stringify(latestResult, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}

      {/* 解析結果履歴（最新5件を整形表示） */}
      {analysisResults.length > 0 && (
        <div className="bg-yellow-50 p-4 rounded-lg">
          <h3 className="font-semibold mb-2">
            Analysis History ({analysisResults.length} results)
          </h3>
          <div className="max-h-96 overflow-y-auto space-y-3">
            {analysisResults.slice(-5).map((result, index) => (
              <div key={index} className="bg-white p-3 rounded border">
                <h4 className="text-sm font-semibold mb-2">
                  Result #{analysisResults.length - 5 + index + 1}
                </h4>
                <div className="text-xs space-y-2">
                  <div className="bg-gray-50 p-2 rounded">
                    <pre className="whitespace-pre-wrap">
                      {createAnalysisSummary(result)}
                    </pre>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                      Raw JSON
                    </summary>
                    <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto max-h-32 mt-1">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* デバッグ情報 */}
      <div className="mt-4 p-3 bg-gray-100 rounded text-xs">
        <details>
          <summary className="cursor-pointer font-semibold">
            Debug Information
          </summary>
          <div className="mt-2">
            <pre>
              {JSON.stringify(
                {
                  engineInfo: {
                    name: engineInfo?.name || null,
                    optionsCount: engineInfo?.options.length || 0,
                  },
                  status: {
                    isEngineReady,
                    isAnalyzing: analysisStatus.is_analyzing,
                    isLoading,
                    statusMessage: analysisStatus.message,
                  },
                  position: {
                    currentSfen: currentSfen
                      ? currentSfen.substring(0, 50) + "..."
                      : null,
                    sfenLength: currentSfen?.length || 0,
                  },
                  results: {
                    totalResults: analysisResults.length,
                    hasLatestResult: !!latestResult,
                    latestResultDepth: latestResult?.depth_info?.depth || null,
                    latestEvaluation: latestResult?.evaluation
                      ? formatEvaluation(latestResult.evaluation)
                      : null,
                  },
                  error: error ? error.substring(0, 100) + "..." : null,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </details>
      </div>

      {/* 使用方法のヘルプ */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <details>
          <summary className="cursor-pointer font-semibold text-blue-800">
            📖 How to Use
          </summary>
          <div className="mt-2 text-sm text-gray-700 space-y-2">
            <ol className="list-decimal list-inside space-y-1">
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
                <strong>View Results:</strong> See evaluation and best moves
              </li>
              <li>
                <strong>Stop Analysis:</strong> Stop when satisfied with results
              </li>
            </ol>
            <div className="mt-3 p-2 bg-white rounded border">
              <p className="text-xs">
                <strong>Note:</strong> Analysis results update automatically
                every 1.5 seconds while analyzing. Use "Refresh" to manually
                update results, or "Run Test" to test basic functionality.
              </p>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

export default EnginePane;
