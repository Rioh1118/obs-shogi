import React, { useState, useCallback, useEffect, useRef } from "react";
import EngineAPI, {
  type EngineInfo,
  type AnalysisResult,
} from "@/commands/engine";
import {
  listenToAnalysisUpdates,
  listenToAnalysisComplete,
  listenToEngineErrors,
} from "@/commands/engine/events";
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null,
  );

  // イベントリスナーのクリーンアップ関数を保存
  const cleanupFunctionsRef = useRef<(() => void)[]>([]);

  const { state } = useGame();

  // SFENを取得
  const getCurrentSfen = useCallback(() => {
    try {
      return state.jkfPlayer?.shogi?.toSFENString() || null;
    } catch (error) {
      console.error("Failed to get SFEN:", error);
      return null;
    }
  }, [state.jkfPlayer]);

  const currentSfen = getCurrentSfen();

  // エラーハンドリング
  const handleError = useCallback((operation: string, err: unknown) => {
    const errorMessage = `${operation}: ${err}`;
    console.error("❌", errorMessage);
    setError(errorMessage);
  }, []);

  // イベントリスナーをセットアップ
  const setupEventListeners = useCallback(async () => {
    try {
      console.log("🎧 Setting up event listeners...");

      // 解析更新リスナー
      const removeUpdateListener = await listenToAnalysisUpdates(
        (result: AnalysisResult) => {
          console.log("📊 Analysis update received:", result);
          setAnalysisResult(result);
        },
      );

      // 解析完了リスナー
      const removeCompleteListener = await listenToAnalysisComplete(
        (sessionId: string, result: AnalysisResult) => {
          console.log("✅ Analysis completed:", sessionId, result);
          setAnalysisResult(result);
          setIsAnalyzing(false);
          setCurrentSessionId(null);
        },
      );

      // エラーリスナー
      const removeErrorListener = await listenToEngineErrors(
        (error: string) => {
          console.log("❌ Engine error received:", error);
          handleError("Analysis error", error);
          setIsAnalyzing(false);
          setCurrentSessionId(null);
        },
      );

      // クリーンアップ関数を保存
      cleanupFunctionsRef.current = [
        removeUpdateListener,
        removeCompleteListener,
        removeErrorListener,
      ];

      console.log("✅ Event listeners setup complete");
    } catch (err) {
      console.error("Failed to setup event listeners:", err);
      handleError("Event listener setup failed", err);
    }
  }, [handleError]);

  // イベントリスナーをクリーンアップ
  const cleanupEventListeners = useCallback(() => {
    console.log("🧹 Cleaning up event listeners...");
    cleanupFunctionsRef.current.forEach((cleanup, index) => {
      try {
        cleanup();
        console.log(`✅ Cleaned up listener ${index + 1}`);
      } catch (err) {
        console.error(`Failed to cleanup listener ${index + 1}:`, err);
      }
    });
    cleanupFunctionsRef.current = [];
  }, []);

  // エンジン初期化
  const handleSetup = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log("🔍 Setting up engine...");
      const engineInfo = await EngineAPI.setupYaneuraOuEngine();

      if (engineInfo) {
        setEngineInfo(engineInfo);
        setIsEngineReady(true);
        console.log("✅ Engine ready:", engineInfo.name);

        // イベントリスナーセットアップ
        setupEventListeners();
      }
    } catch (err) {
      handleError("Engine setup failed", err);
      setIsEngineReady(false);
    } finally {
      setIsLoading(false);
    }
  }, [handleError, setupEventListeners]);

  // 解析開始
  const handleStart = useCallback(async () => {
    if (!currentSfen || !isEngineReady) {
      setError("No position available or engine not ready");
      return;
    }

    setError(null);
    setAnalysisResult(null);

    try {
      console.log("🚀 Starting analysis...");
      const sessionId = await EngineAPI.startAnalysisFromSfen(currentSfen);
      setCurrentSessionId(sessionId);
      setIsAnalyzing(true);
      console.log("✅ Analysis started:", sessionId);
    } catch (err) {
      handleError("Analysis start failed", err);
    }
  }, [currentSfen, isEngineReady, handleError]);

  // 解析停止
  const handleStop = useCallback(async () => {
    if (!currentSessionId) return;

    try {
      console.log("🛑 Stopping analysis...");
      await EngineAPI.stopAnalysis(currentSessionId);
      setIsAnalyzing(false);
      setCurrentSessionId(null);
      console.log("✅ Analysis stopped");
    } catch (err) {
      handleError("Analysis stop failed", err);
    }
  }, [currentSessionId, handleError]);

  // エンジン終了
  const handleShutdown = useCallback(async () => {
    try {
      // イベントリスナー解除
      cleanupEventListeners();

      console.log("🛑 Shutting down engine...");
      await EngineAPI.shutdownEngine();

      // 状態リセット
      setEngineInfo(null);
      setIsEngineReady(false);
      setIsAnalyzing(false);
      setCurrentSessionId(null);
      setAnalysisResult(null);
      setError(null);

      console.log("✅ Engine shutdown complete");
    } catch (err) {
      handleError("Engine shutdown failed", err);
    }
  }, [handleError, cleanupEventListeners]);

  // コンポーネントのクリーンアップ
  useEffect(() => {
    return () => {
      cleanupEventListeners();
    };
  }, [cleanupEventListeners]);

  return (
    <div className={`engine-pane p-4 space-y-4 ${className}`}>
      <h2 className="text-xl font-bold">Shogi Engine</h2>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* エンジン状態 */}
      <div className="bg-gray-50 p-3 rounded-lg">
        <div className="flex items-center space-x-2 mb-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isEngineReady ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="font-semibold">
            {isEngineReady ? "Ready" : "Not Ready"}
          </span>
          {isAnalyzing && (
            <span className="bg-blue-500 text-white px-2 py-1 rounded text-xs animate-pulse">
              Analyzing...
            </span>
          )}
        </div>

        {engineInfo && (
          <div className="text-sm text-gray-600">
            {engineInfo.name} by {engineInfo.author}
          </div>
        )}
      </div>

      {/* 現在の局面 */}
      <div className="bg-blue-50 p-3 rounded-lg">
        <div className="text-sm font-semibold mb-1">
          Current Position (SFEN)
        </div>
        <div className="text-xs text-gray-700 break-all font-mono">
          {currentSfen || "No position"}
        </div>
        {state.jkfPlayer?.shogi && (
          <div className="text-xs text-gray-500 mt-1">
            Turn:{" "}
            {state.jkfPlayer.shogi.turn === 0 ? "Black (先手)" : "White (後手)"}
          </div>
        )}
      </div>

      {/* コントロールボタン */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleSetup}
          disabled={isLoading || isEngineReady}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Setting up..." : "Setup"}
        </button>

        <button
          onClick={handleShutdown}
          disabled={!isEngineReady}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Shutdown
        </button>

        <button
          onClick={handleStart}
          disabled={!isEngineReady || isAnalyzing || !currentSfen}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start
        </button>

        <button
          onClick={handleStop}
          disabled={!isAnalyzing}
          className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Stop
        </button>
      </div>

      {/* 解析結果 */}
      {analysisResult && (
        <div className="bg-green-50 p-4 rounded-lg">
          <h3 className="font-semibold mb-3">Analysis Result</h3>

          {/* 評価値 */}
          {analysisResult.evaluation && (
            <div className="mb-3">
              <div className="text-sm text-gray-600 mb-1">Evaluation</div>
              <div className="text-2xl font-bold text-center py-2 bg-white rounded border">
                {EngineAPI.formatEvaluation(analysisResult.evaluation)}
              </div>
            </div>
          )}

          {/* 最善手順 */}
          {analysisResult.principal_variations?.length > 0 && (
            <div className="mb-3">
              <div className="text-sm text-gray-600 mb-1">Best Line</div>
              <div className="bg-white p-3 rounded border">
                {analysisResult.principal_variations.map((pv, index) => (
                  <div key={index} className="mb-1">
                    <div className="text-sm font-mono">
                      {pv.moves.slice(0, 8).join(" ")}
                      {pv.moves.length > 8 && "..."}
                    </div>
                    {pv.evaluation && (
                      <div className="text-xs text-gray-500">
                        {EngineAPI.formatEvaluation(pv.evaluation)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 探索情報 */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            {analysisResult.depth_info && (
              <div>
                <div className="text-gray-600">Depth</div>
                <div className="font-semibold">
                  {analysisResult.depth_info.depth}
                </div>
              </div>
            )}

            {analysisResult.search_stats?.nodes && (
              <div>
                <div className="text-gray-600">Nodes</div>
                <div className="font-semibold">
                  {analysisResult.search_stats.nodes.toLocaleString()}
                </div>
              </div>
            )}

            {analysisResult.search_stats?.nps && (
              <div>
                <div className="text-gray-600">NPS</div>
                <div className="font-semibold">
                  {Math.round(analysisResult.search_stats.nps / 1000)}k
                </div>
              </div>
            )}

            {analysisResult.search_stats?.time_elapsed && (
              <div>
                <div className="text-gray-600">Time</div>
                <div className="font-semibold">
                  {(
                    analysisResult.search_stats.time_elapsed.secs +
                    analysisResult.search_stats.time_elapsed.nanos /
                      1_000_000_000
                  ).toFixed(1)}
                  s
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 使用方法 */}
      <div className="bg-blue-50 p-3 rounded-lg text-sm">
        <div className="font-semibold mb-2">Usage</div>
        <ol className="list-decimal list-inside space-y-1 text-gray-700">
          <li>
            Click <strong>Setup</strong> to initialize the engine
          </li>
          <li>Move pieces on the board to set position</li>
          <li>
            Click <strong>Start</strong> to begin analysis
          </li>
          <li>Watch real-time evaluation and best moves</li>
          <li>
            Click <strong>Stop</strong> when satisfied
          </li>
        </ol>
      </div>
    </div>
  );
};
export default EnginePane;
