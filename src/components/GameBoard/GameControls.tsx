import { useGame } from "@/contexts/GameContext";
import ControlButton from "./ControlButton";
import "./GameControls.scss";

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
        |&lt;
      </ControlButton>

      <ControlButton
        handleClick={previousMove}
        disabled={!canGoBack}
        title="前の手"
      >
        &lt;
      </ControlButton>

      <ControlButton
        handleClick={nextMove}
        disabled={!canGoNext}
        title="次の手"
      >
        &gt;
      </ControlButton>

      <ControlButton
        handleClick={goToEnd}
        disabled={!canGoNext}
        title="最後に進む"
      >
        &gt;|
      </ControlButton>
    </div>
  );
}
export default GameControls;
