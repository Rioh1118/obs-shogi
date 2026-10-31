import { Settings, Navigation, Search, RotateCw, Bookmark } from "lucide-react";
import "./AnalysisControls.scss";
import { EngineAction } from "./EngineAction";
import { EngineStatusLabel } from "./EngineStatusLabel";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useGame } from "@/entities/game";
import { engineStatusOf, useAnalysis } from "@/entities/analysis";
import { useEngine } from "@/entities/engine";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import { useBoardOrientation } from "@/features/board-orientation";
import { useOpenSettings } from "@/features/settings/model/useOpenSettings";

/**
 * 検討ビューの操作列。**ドックのタブ列の下の段に出る。**
 *
 * 左が状態（語と経過秒）、右が操作。並びは
 * 盤と検討（向き・開始／中断）→ 局面の道具（ナビ・検索・課題局面）→ 設定。
 *
 * **候補手の見せ方はここに置かない。** 局面ごとに変える値ではなく好みなので、
 * 置き場は設定「表示」（ADR-0010 決定4 の改訂）。
 *
 * 記号は `lucide-react` から取る。**このリポジトリの図案はすべてそこ**なので、
 * 新しい出どころを増やさない。
 */
function AnalysisControls() {
  const { state, startInfiniteAnalysis, stopAnalysis } = useAnalysis();
  const { state: engineState, initialize } = useEngine();
  const { view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;
  const status = engineStatusOf({ phase: engineState.phase, analysis: state, currentSfen });
  const { openModal } = useURLParams();
  const openSettings = useOpenSettings();
  const { findBySfen } = useStudyPositions();
  const isBookmarked = !!findBySfen(currentSfen);
  const { isGotePov, toggle: handleTogglePov } = useBoardOrientation();

  // 検討の開始／中断
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
      <EngineStatusLabel status={status} currentSfen={currentSfen} />

      <div className="analysis-controls__actions">
        {/*
          `role="toolbar"` を名乗らない。名乗ると矢印キーでの移動が期待されるが、
          この帯はそれを持たない。`group` なら並びの名前だけを伝える
        */}
        <div className="analysis-controls__group" role="group" aria-label="盤と検討">
          <button
            className="analysis-controls__iconBtn"
            onClick={handleTogglePov}
            title={isGotePov ? "先手視点に戻す" : "後手視点にする"}
            aria-pressed={isGotePov}
          >
            <RotateCw className="analysis-controls__icon" />
          </button>
          <EngineAction
            status={status}
            isAnalyzing={state.isAnalyzing}
            canStart={!!currentSfen}
            onToggle={handleToggleAnalysis}
            onRestart={() => void initialize()}
          />
        </div>

        <div className="analysis-controls__group" role="group" aria-label="局面の道具">
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
            className="analysis-controls__iconBtn"
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

        <button className="analysis-controls__iconBtn" onClick={handleOpenSettings} title="設定">
          <Settings className="analysis-controls__icon" />
        </button>
      </div>
    </div>
  );
}

export default AnalysisControls;
