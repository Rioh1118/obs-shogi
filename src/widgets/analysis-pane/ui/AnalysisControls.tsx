import { useEffect, useState, useRef } from "react";
import { Settings, Play, Square, Navigation, Search, RotateCw, Bookmark } from "lucide-react";
import "./AnalysisControls.scss";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useGame } from "@/entities/game";
import { useAnalysis } from "@/entities/analysis";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import { useBoardOrientation } from "@/features/board-orientation";
import { useOpenSettings } from "@/features/settings/model/useOpenSettings";
import { ANALYSIS_DISPLAY_MODES } from "@/widgets/analysis-pane/model/displayMode";
import { useAnalysisViewState } from "@/widgets/analysis-pane/model/AnalysisViewState";

/**
 * 解析ビューの操作列。**ドックのタブ列の下の段に出る。**
 *
 * 左が状態（`解析中` / `停止中` と経過秒）、右が操作。並びは
 * 盤の道具 → 候補手の見せ方 → 解析の開始・停止 → 設定。
 *
 * 記号は `lucide-react` から取る。**このリポジトリの図案はすべてそこ**なので、
 * 新しい出どころを増やさない。
 */
function AnalysisControls() {
  const { mode, setMode } = useAnalysisViewState();
  const { state, startInfiniteAnalysis, stopAnalysis } = useAnalysis();
  const { view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;
  const { openModal } = useURLParams();
  const openSettings = useOpenSettings();
  const { findBySfen } = useStudyPositions();
  const isBookmarked = !!findBySfen(currentSfen);
  const [elapsedTime, setElapsedTime] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastSfenRef = useRef<string | null>(null);
  const { isGotePov, toggle: handleTogglePov } = useBoardOrientation();

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
      <div className="analysis-controls__status">
        <span
          className={`analysis-controls__dot ${state.isAnalyzing ? "analysis-controls__dot--analyzing" : "analysis-controls__dot--idle"}`}
        ></span>
        <span className="analysis-controls__status-text">
          {state.isAnalyzing ? "解析中" : "停止中"}
        </span>
        <span className="analysis-controls__timer">{formatTime(elapsedTime)}</span>
      </div>

      <div className="analysis-controls__actions">
        {/*
          `role="toolbar"` を名乗らない。名乗ると矢印キーでの移動が期待されるが、
          この帯はそれを持たない。`group` なら並びの名前だけを伝える
        */}
        <div className="analysis-controls__group" role="group" aria-label="盤の道具">
          <button
            className="analysis-controls__iconBtn"
            onClick={handleTogglePov}
            title={isGotePov ? "先手視点に戻す" : "後手視点にする"}
            aria-pressed={isGotePov}
          >
            <RotateCw className="analysis-controls__icon" />
          </button>
          <button
            className="analysis-controls__iconBtn"
            onClick={() => openModal("navigation")}
            disabled={!currentSfen}
            title="局面ナビゲーション"
          >
            <Navigation className="analysis-controls__icon" />
          </button>
          <button
            className="analysis-controls__iconBtn"
            onClick={() => openModal("position-search")}
            disabled={!currentSfen}
            title="局面検索"
          >
            <Search className="analysis-controls__icon" />
          </button>
          <button
            className={`analysis-controls__iconBtn ${isBookmarked ? "analysis-controls__iconBtn--active" : ""}`}
            onClick={() => openModal("study-position-save")}
            disabled={!currentSfen}
            aria-pressed={isBookmarked}
            title={isBookmarked ? "課題局面を編集" : "課題局面に登録"}
          >
            <Bookmark
              className="analysis-controls__icon"
              fill={isBookmarked ? "currentColor" : "none"}
            />
          </button>
        </div>

        <div className="analysis-controls__modes" role="group" aria-label="候補手の見せ方">
          {ANALYSIS_DISPLAY_MODES.map((m) => (
            <button
              key={m.key}
              className={`analysis-controls__mode ${m.key === mode ? "analysis-controls__mode--active" : ""}`}
              onClick={() => setMode(m.key)}
              aria-pressed={m.key === mode}
              title={m.title}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="analysis-controls__group" role="group" aria-label="解析">
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
        </div>
      </div>
    </div>
  );
}

export default AnalysisControls;
