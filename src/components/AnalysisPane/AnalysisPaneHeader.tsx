import { useAnalysis } from "@/contexts/AnalysisContext";
import { usePosition } from "@/contexts/PositionContext";
import { useEffect, useState, useRef } from "react";
import { Settings, Play, Square, Navigation, Search } from "lucide-react";
import "./AnalysisPaneHeader.scss";
import { useURLParams } from "@/hooks/useURLParams";

function AnalysisPaneHeader() {
  const { state, startInfiniteAnalysis, stopAnalysis } = useAnalysis();
  const { currentSfen } = usePosition();
  const { openModal } = useURLParams();
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
          const elapsed = Math.floor(
            (Date.now() - startTimeRef.current) / 1000,
          );
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

  // 局面ナビゲーションハンドラー
  const handlePositionNavigation = () => {
    openModal("navigation");
  };

  const handleOpenSettings = () => {
    openModal("settings", { tab: "general" });
  };

  const handlePositionSearch = () => {
    openModal("position-search");
  };

  return (
    <header className="analysis-header">
      <div className="analysis-header__status">
        <div className="analysis-header__indicator">
          <div
            className={`analysis-header__dot ${state.isAnalyzing ? "analysis-header__dot--analyzing" : "analysis-header__dot--idle"}`}
          ></div>
          <span className="analysis-header__status-text">
            {state.isAnalyzing ? "解析中" : "停止中"}
          </span>
          <span className="analysis-header__timer">
            {formatTime(elapsedTime)}
          </span>
        </div>
      </div>

      <div className="analysis-header__actions">
        <button
          className="analysis-header__button analysis-header__button--navigation"
          onClick={handlePositionNavigation}
          disabled={!currentSfen}
          title="局面ナビゲーション"
        >
          <Navigation className="analysis-header__icon" />
        </button>
        <button
          className="analysis-header__button analysis-header__button--possearch"
          onClick={handlePositionSearch}
          disabled={!currentSfen}
          title="局面検索"
        >
          <Search className="analysis-header__icon" />
        </button>

        <button
          className="analysis-header__button analysis-header__button--toggle"
          onClick={handleToggleAnalysis}
          disabled={!state.isAnalyzing && !currentSfen}
          title={state.isAnalyzing ? "解析停止" : "解析開始"}
        >
          {state.isAnalyzing ? (
            <Square className="analysis-header__icon" />
          ) : (
            <Play className="analysis-header__icon" />
          )}
        </button>

        <button
          className="analysis-header__button analysis-header__button--settings"
          onClick={handleOpenSettings}
          title="設定"
        >
          <Settings className="analysis-header__icon" />
        </button>
      </div>
    </header>
  );
}

export default AnalysisPaneHeader;
