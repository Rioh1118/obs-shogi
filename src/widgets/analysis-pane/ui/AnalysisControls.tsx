import { useEffect, useState, useRef } from "react";
import { Settings, Play, Square } from "lucide-react";
import "./AnalysisControls.scss";
import { useGame } from "@/entities/game";
import { useAnalysis } from "@/entities/analysis";
import { useOpenSettings } from "@/features/settings/model/useOpenSettings";

/**
 * 解析ビューの操作列。**ドックのタブ列の隣に出る。**
 *
 * **盤の道具（向き・ナビ・検索・課題局面）はここに置かない。** 解析と関係のない操作が
 * 「解析中 31s」と同じ帯に並ぶ形をやめるためにビューを分けた（ADR-0010）。
 * 置き場は盤ペインの `BoardTools`。
 *
 * **⚙ だけは残す。** 解析の断りが案内する復帰操作（プリセットのオプションを変えて
 * 保存し、起こし直す）はエンジン管理タブにしか無いので、解析の操作の一部として扱う。
 */
function AnalysisControls() {
  const { state, startInfiniteAnalysis, stopAnalysis } = useAnalysis();
  const { view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;
  const openSettings = useOpenSettings();
  const [elapsedTime, setElapsedTime] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastSfenRef = useRef<string | null>(null);

  // タイマー管理
  useEffect(() => {
    if (state.isAnalyzing) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
        setElapsedTime(0);
      }

      intervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setElapsedTime(elapsed);
        }
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      startTimeRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [state.isAnalyzing]);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds}s`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }
  };

  // 盤面変更時の処理
  useEffect(() => {
    if (currentSfen !== lastSfenRef.current) {
      lastSfenRef.current = currentSfen;

      if (state.isAnalyzing) {
        startTimeRef.current = Date.now();
        setElapsedTime(0);
      } else {
        setElapsedTime(0);
      }
    }
  }, [currentSfen, state.isAnalyzing]);

  // 解析開始/停止ハンドラー
  const handleToggleAnalysis = async () => {
    try {
      if (state.isAnalyzing) {
        await stopAnalysis();
      } else {
        await startInfiniteAnalysis();
      }
    } catch (error) {
      console.error("Failed to toggle analysis:", error);
    }
  };

  const handleOpenSettings = () => {
    // 解析の断りが案内する復帰操作（プリセットのオプションを変えて保存し、起こし直す）は
    // このタブにしか無い。**綴りは `useOpenSettings` が型で閉じる。**
    openSettings("engine");
  };

  return (
    <div className="analysis-controls">
      <div className="analysis-controls__indicator">
        <span
          className={`analysis-controls__dot ${state.isAnalyzing ? "analysis-controls__dot--analyzing" : "analysis-controls__dot--idle"}`}
        ></span>
        <span className="analysis-controls__status-text">
          {state.isAnalyzing ? "解析中" : "停止中"}
        </span>
        <span className="analysis-controls__timer">{formatTime(elapsedTime)}</span>
      </div>

      <nav className="analysis-controls__group" role="toolbar" aria-label="解析ツール">
        <button
          className="analysis-controls__iconBtn"
          onClick={handleToggleAnalysis}
          disabled={!state.isAnalyzing && !currentSfen}
          title={state.isAnalyzing ? "解析停止" : "解析開始"}
        >
          {state.isAnalyzing ? (
            <Square className="analysis-controls__icon" />
          ) : (
            <Play className="analysis-controls__icon" />
          )}
        </button>

        <button className="analysis-controls__iconBtn" onClick={handleOpenSettings} title="設定">
          <Settings className="analysis-controls__icon" />
        </button>
      </nav>
    </div>
  );
}

export default AnalysisControls;
