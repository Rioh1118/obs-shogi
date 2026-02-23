import ControlButton from "../../../shared/ui/ControlButton";
import {
  ChevronFirst,
  ChevronLeft,
  ChevronRight,
  ChevronLast,
} from "lucide-react";
import "./GameControls.scss";
import { useGame } from "@/entities/game";

function GameControls() {
  const {
    goToStart,
    previousMove,
    nextMove,
    goToEnd,
    canGoBackward,
    canGoForward,
  } = useGame();

  const canGoBack = canGoBackward();
  const canGoNext = canGoForward();

  return (
    <div className="game-controls">
      <ControlButton
        handleClick={goToStart}
        disabled={!canGoBack}
        title="最初に戻る"
      >
        <ChevronFirst size={25} />
      </ControlButton>

      <ControlButton
        handleClick={previousMove}
        disabled={!canGoBack}
        title="前の手"
      >
        <ChevronLeft size={25} />
      </ControlButton>

      <ControlButton
        handleClick={nextMove}
        disabled={!canGoNext}
        title="次の手"
      >
        <ChevronRight size={25} />
      </ControlButton>

      <ControlButton
        handleClick={goToEnd}
        disabled={!canGoNext}
        title="最後に進む"
      >
        <ChevronLast size={25} />
      </ControlButton>
    </div>
  );
}
export default GameControls;
