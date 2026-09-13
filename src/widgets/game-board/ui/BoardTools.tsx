import { Navigation, Search, RotateCw, Bookmark } from "lucide-react";
import ControlButton from "@/shared/ui/ControlButton";
import "./BoardTools.scss";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useGame } from "@/entities/game";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import { useBoardOrientation } from "@/features/board-orientation";

/**
 * 盤の道具。**どれも「いま盤に出ている局面」に対する操作で、解析とは関わらない。**
 *
 * **ドックのタブに置かない。** 置くと、解析以外のタブを見ている間だけ
 * 盤の道具が消える —— 盤はどのタブを見ていても動かせる。
 */
function BoardTools() {
  const { view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;
  const { openModal } = useURLParams();
  const { findBySfen } = useStudyPositions();
  const isBookmarked = !!findBySfen(currentSfen);
  const { isGotePov, toggle: handleTogglePov } = useBoardOrientation();

  return (
    <div className="board-tools" role="toolbar" aria-label="盤の道具">
      <ControlButton
        handleClick={handleTogglePov}
        pressed={isGotePov}
        title={isGotePov ? "先手視点に戻す" : "後手視点にする"}
      >
        <RotateCw size={20} />
      </ControlButton>

      <ControlButton
        handleClick={() => openModal("navigation")}
        disabled={!currentSfen}
        title="局面ナビゲーション"
      >
        <Navigation size={20} />
      </ControlButton>

      <ControlButton
        handleClick={() => openModal("position-search")}
        disabled={!currentSfen}
        title="局面検索"
      >
        <Search size={20} />
      </ControlButton>

      <ControlButton
        handleClick={() => openModal("study-position-save")}
        disabled={!currentSfen}
        pressed={isBookmarked}
        title={isBookmarked ? "課題局面を編集" : "課題局面に登録"}
      >
        <Bookmark size={20} fill={isBookmarked ? "currentColor" : "none"} />
      </ControlButton>
    </div>
  );
}

export default BoardTools;
