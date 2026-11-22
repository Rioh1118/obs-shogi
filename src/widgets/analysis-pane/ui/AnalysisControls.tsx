import { Settings, Navigation, Search, RotateCw, Bookmark, Play } from "lucide-react";
import "./AnalysisControls.scss";
import { EngineAction } from "./EngineAction";
import { EngineStatusLabel } from "./EngineStatusLabel";
import { MateSearchButton } from "./MateSearchButton";
import { MateStatusLabel } from "./MateStatusLabel";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useGame } from "@/entities/game";
import { useAnalysis } from "@/entities/analysis";
import { engineFailureNoticeOf, useEngine } from "@/entities/engine";
import { useMateSearch } from "@/entities/mate-search";
import { useEngineStatus } from "@/widgets/analysis-pane/lib/useEngineStatus";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import { useBoardOrientation } from "@/features/board-orientation";
import { useOpenSettings } from "@/features/settings/model/useOpenSettings";

/**
 * 検討ビューの操作列。ドックのタブ列の下の行に出る。
 *
 * 左が状態（語と経過秒）、右が操作。詰み探索が表を持つ間、語は詰み探索のもので、▶ は検討へ切り替える。並びは
 * 盤と検討（向き・開始／中断・詰み探索）→ 局面の道具（ナビ・検索・課題局面）→ 設定。
 *
 * **候補手の見せ方はここに置かない。** 局面ごとに変える値ではなく好みなので、
 * 置き場は設定「表示」（ADR-0010 決定4 の改訂）。
 *
 * 記号は `lucide-react` から取る。このリポジトリの図案はすべてそこなので、
 * 新しい出どころを増やさない。
 */
function AnalysisControls() {
  const { state, startInfiniteAnalysis, stopAnalysis } = useAnalysis();
  const { state: engine, initialize, cancelStart, presetIncomplete, slowStart } = useEngine();
  const { view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;
  const status = useEngineStatus(currentSfen);
  const notice = engineFailureNoticeOf({ ...engine, presetIncomplete });
  const mate = useMateSearch();
  const { openModal } = useURLParams();
  const openSettings = useOpenSettings();
  const { findBySfen } = useStudyPositions();
  const isBookmarked = !!findBySfen(currentSfen);
  const { isGotePov, toggle: handleTogglePov } = useBoardOrientation();

  const handleToggleAnalysis = async () => {
    try {
      if (state.isAnalyzing || state.starting) {
        await stopAnalysis();
      } else {
        await startInfiniteAnalysis();
      }
    } catch (error) {
      console.error("Failed to toggle analysis:", error);
    }
  };

  /**
   * 詰み探索が表を持つ間の ▶。表を検討に返し、検討を始める。
   * エンジンが動いていないときは返すだけにする。返した操作列に、その状態の次の一手（再起動など）が出る
   */
  const handleBackToAnalysis = async () => {
    mate.dismiss();
    if (status === "standing-by" || status === "starting") await handleToggleAnalysis();
  };

  const handleOpenSettings = () => {
    // 解析の断りが案内する復帰操作（プリセットのオプションを変えて保存し、起こし直す）は
    // このタブにしか無い。**綴りは `useOpenSettings` が型で閉じる。**
    openSettings("engine");
  };

  return (
    <div className="analysis-controls">
      {mate.ownsTable ? (
        <MateStatusLabel state={mate.state} />
      ) : (
        <EngineStatusLabel
          status={status}
          currentSfen={currentSfen}
          notice={notice}
          lastOutput={engine.error?.lastOutput ?? engine.lastOutput}
          onOpenSettings={handleOpenSettings}
        />
      )}

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
          {mate.ownsTable ? (
            <button
              className="analysis-controls__iconBtn"
              onClick={() => void handleBackToAnalysis()}
              title="検討を開始"
            >
              <Play className="analysis-controls__icon" />
            </button>
          ) : (
            <EngineAction
              status={status}
              isAnalyzing={state.isAnalyzing || state.starting}
              stopping={state.stopping}
              canStart={!!currentSfen}
              retry={notice?.retry ?? false}
              slowStart={slowStart}
              onToggle={handleToggleAnalysis}
              onRestart={() => void initialize()}
              onOpenSettings={handleOpenSettings}
              onCancelStart={cancelStart}
            />
          )}
          <MateSearchButton currentSfen={currentSfen} />
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
            title={isBookmarked ? "課題局面を編集" : "局面を保存"}
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
